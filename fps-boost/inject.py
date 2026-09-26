# -*- coding: utf-8 -*-
"""
fps-boost / inject.py —— 帧率优化注入器

把 fps-boost/ 下的帧率优化层注入 finance-workbench/index.html。

做三件事：
1. 优化 setDigitAnim —— 值未变化时跳过；长度相同时只改变化的字符节点，
   不再每次清空重建 N 个 span（盘中 2 秒一轮刷新，这是主线程上最大的白烧）
2. 插入 fps.css —— 合成层提升 / 视口外跳过渲染 / 分档降级规则
3. 插入 fps.js  —— 自适应帧率监控（只在真掉帧时降级，流畅后回升）

特性（与 minute-chart / perf-boost / quote-fallback 注入器一致）：
- 幂等：重复执行先移除旧注入块；setDigitAnim 补丁靠块内标记跳过
- 安全：先在内存里组装并校验，全部通过才写盘
- 保留 CRLF：用 newline='' 读写
- 默认档零视觉改动：不设 data-fps-q 属性时，fps.css 里的降级规则全不生效

用法：
    python fps-boost/inject.py            # 注入
    python fps-boost/inject.py --check    # 只校验当前状态
    python fps-boost/inject.py --revert   # 回退到未注入状态
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

CSS_B, CSS_E = '<!-- FPS:CSS:BEGIN -->', '<!-- FPS:CSS:END -->'
JS_B, JS_E = '<!-- FPS:JS:BEGIN -->', '<!-- FPS:JS:END -->'

PATCH_TAG = 'FPS:digit-cache'

# ---- setDigitAnim 原实现（唯一出现，精确匹配）----
ORIG_SETDIGIT = (
    "function setDigitAnim(el, val) {\r\n"
    "  const s = String(val);\r\n"
    "  el.classList.remove('is-animating');\r\n"
    "  el.innerHTML = '';\r\n"
    "  const chars = s.split('');\r\n"
    "  chars.forEach((ch, i) => {\r\n"
    "    const span = document.createElement('span');\r\n"
    "    span.className = 't-digit';\r\n"
    "    // 数字/符号用字符，小数点/分隔符特殊处理\r\n"
    "    span.textContent = ch;\r\n"
    "    // 后两位错峰\r\n"
    "    if (i === chars.length - 2) span.dataset.stagger = '1';\r\n"
    "    else if (i === chars.length - 1) span.dataset.stagger = '2';\r\n"
    "    el.appendChild(span);\r\n"
    "  });\r\n"
    "  void el.offsetHeight; // 强制回流\r\n"
    "  el.classList.add('is-animating');\r\n"
    "}"
)

# ---- 优化后的实现（v2：数字滚动列，借鉴 Spectrum UI number-ticker）----
NEW_SETDIGIT = (
    "function setDigitAnim(el, val) {\r\n"
    "  /* FPS:digit-cache v2 —— 数字滚动列（借鉴 Spectrum UI number-ticker）。\r\n"
    "     数字位 = 0-9 纵向列 + overflow 窗口，变化的位只 translateY 滚动；\r\n"
    "     非数字字符为静态位。首次构建后零重建、零强制回流。 */\r\n"
    "  const s = String(val);\r\n"
    "  if (el.__tDigitVal === s && el.firstChild) return;\r\n"
    "  el.__tDigitVal = s;\r\n"
    "  let shape = '';\r\n"
    "  for (const ch of s) shape += /\\d/.test(ch) ? 'd' : ch;\r\n"
    "  if (el.__dgShape !== shape) {\r\n"
    "    el.__dgShape = shape;\r\n"
    "    const cols = el.__dgCols = [];\r\n"
    "    const fix = el.__dgFix = [];\r\n"
    "    el.innerHTML = '';\r\n"
    "    for (const ch of s) {\r\n"
    "      if (/\\d/.test(ch)) {\r\n"
    "        const win = document.createElement('span');\r\n"
    "        win.className = 'dg-win';\r\n"
    "        const col = document.createElement('span');\r\n"
    "        col.className = 'dg-col';\r\n"
    "        col.__cur = -1;\r\n"
    "        for (let n = 0; n <= 9; n++) {\r\n"
    "          const dg = document.createElement('i');\r\n"
    "          dg.textContent = n;\r\n"
    "          col.appendChild(dg);\r\n"
    "        }\r\n"
    "        win.appendChild(col);\r\n"
    "        el.appendChild(win);\r\n"
    "        cols.push(col);\r\n"
    "      } else {\r\n"
    "        const p = document.createElement('span');\r\n"
    "        p.className = 'dg-fix';\r\n"
    "        p.textContent = ch;\r\n"
    "        el.appendChild(p);\r\n"
    "        fix.push(p);\r\n"
    "      }\r\n"
    "    }\r\n"
    "  }\r\n"
    "  let di = 0, fi = 0;\r\n"
    "  for (const ch of s) {\r\n"
    "    if (/\\d/.test(ch)) {\r\n"
    "      const col = el.__dgCols[di++];\r\n"
    "      const d = +ch;\r\n"
    "      if (col.__cur !== d) {\r\n"
    "        col.__cur = d;\r\n"
    "        col.style.transform = 'translateY(-' + (d * 1.12).toFixed(2) + 'em)';\r\n"
    "      }\r\n"
    "    } else {\r\n"
    "      el.__dgFix[fi++].textContent = ch;\r\n"
    "    }\r\n"
    "  }\r\n"
    "}"
)

# 注入后必须仍然存在的原有特征
MUST_KEEP = [
    '<aside class="sidebar">',
    '<main class="main">',
    'function jsonp(',
    'async function fetchJson(',
    'animeEntrance',
    '.fx-tilt',
    'id="watch-list"',
    'id="pos-list"',
    'id="lhb-list"',
    # 其他模块的块不能被吃掉
    '<!-- MC:CSS:BEGIN -->',
    '<!-- PB:CSS:BEGIN -->',
    '<!-- BFX:CSS:BEGIN -->',
    '<!-- SE:CSS:BEGIN -->',
    '<!-- QF:JS:BEGIN -->',
    # 帧率优化依赖
    'function setDigitAnim(el, val) {',
    'window.__quoteHook',
]


def read(p):
    return io.open(p, encoding='utf-8', newline='').read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def detect_eol(txt):
    crlf = txt.count('\r\n')
    lf = txt.count('\n') - crlf
    return '\r\n' if crlf >= lf else '\n'


def to_eol(txt, eol):
    flat = txt.replace('\r\n', '\n').replace('\r', '\n')
    return flat if eol == '\n' else flat.replace('\n', '\r\n')


def strip_blocks(html):
    for b, e in ((CSS_B, CSS_E), (JS_B, JS_E)):
        html = re.sub(re.escape(b) + r'.*?' + re.escape(e) + r'[ \t]*\r?\n?',
                      '', html, flags=re.S)
    return html


def strip_setdigit_patch(html):
    """把 setDigitAnim 还原成原实现（用于回退 / 幂等重注入）

    优先按「补丁版全文」精确匹配替换 —— 比按行号找函数结尾可靠得多
    （补丁体里有嵌套的 for/if 花括号，按行定位容易切错）。
    """
    if PATCH_TAG not in html:
        return html

    eol = '\r\n' if html.count('\r\n') else '\n'
    patched = to_eol(NEW_SETDIGIT, eol)
    if patched in html:
        return html.replace(patched, to_eol(ORIG_SETDIGIT, eol), 1)

    # 兜底：补丁被外部编辑过，退化为「函数头到函数尾」的段落替换
    i = html.find('function setDigitAnim(el, val) {')
    if i < 0:
        return html
    j = html.find('\n}', i)
    if j < 0:
        return html
    return html[:i] + to_eol(ORIG_SETDIGIT, eol) + html[j + 2:]


def err(msg):
    sys.stderr.write('[X] %s\n' % msg)
    sys.exit(1)


def main():
    argv = sys.argv[1:]
    check_only = '--check' in argv
    revert = '--revert' in argv

    if not os.path.exists(TARGET):
        err('找不到 %s' % TARGET)

    css = read(os.path.join(HERE, 'fps.css'))
    js = read(os.path.join(HERE, 'fps.js'))

    for name, txt in (('fps.css', css), ('fps.js', js)):
        if '</style>' in txt or '</script>' in txt:
            err('%s 含 </style> 或 </script>，会破坏注入块结构' % name)

    src = read(TARGET)
    had = CSS_B in src
    had_patch = PATCH_TAG in src

    clean = strip_setdigit_patch(strip_blocks(src))

    if check_only:
        print('当前状态：%s' % ('已注入' if had else '未注入'))
        print('  setDigitAnim 补丁：%s' % ('已应用' if had_patch else '未应用'))
        print('  移除旧块后：%d 字节' % len(clean.encode('utf-8')))
        print('  磁盘文件  ：%d 字节' % len(src.encode('utf-8')))
        if had:
            print('  注入块体积：约 %d 字节'
                  % (len(src.encode('utf-8')) - len(clean.encode('utf-8'))))
        return

    if revert:
        write(TARGET, to_eol(clean, detect_eol(clean)))
        print('[OK] 已回退：移除 FPS 注入块并还原 setDigitAnim')
        return

    eol = detect_eol(clean)

    # ---- 1. setDigitAnim 补丁 ----
    if ORIG_SETDIGIT not in clean:
        err('找不到 setDigitAnim 原实现（可能已被改动），中止以免误伤')
    clean = clean.replace(ORIG_SETDIGIT, to_eol(NEW_SETDIGIT, eol), 1)

    # ---- 2. CSS ----
    css_block = to_eol(
        CSS_B + '\n<style id="fps-style">\n' + css + '\n</style>\n' + CSS_E + '\n', eol)

    # ---- 3. JS ----
    js_block = to_eol(
        JS_B + '\n<script id="fps-js">\n' + js + '\n</script>\n' + JS_E + '\n', eol)

    # --- 锚点 1：CSS 插在 </head> 前 ---
    # 若 apple-fx 已注入（同为 </head> 前锚点），锚到它的前面 ——
    # 固定「FPS 在前、AF 在后」的规范顺序，两个注入器任意重跑 md5 稳定（幂等）。
    mAF = re.search(r'<!-- AF:CSS:BEGIN -->', clean)
    if mAF:
        pos = mAF.start()
    else:
        m = re.search(r'</head>', clean)
        if not m:
            err('找不到 </head> 锚点')
        pos = m.start()
    out = clean[:pos] + css_block + clean[pos:]

    # --- 锚点 2：骨架屏 + JS 插在 </body> 前（同理保序在 AF:HTML 之前） ---
    mAF = re.search(r'<!-- AF:HTML:BEGIN -->', out)
    if mAF:
        pos = mAF.start()
    else:
        pos = out.rfind('</body>')
        if pos < 0:
            err('找不到 </body> 锚点')
    out = out[:pos] + js_block + out[pos:]

    # ---- 校验 ----
    problems = []
    for feat in MUST_KEEP:
        if feat not in out:
            problems.append('原有特征丢失：%s' % feat)

    checks = [
        ('CSS 块', CSS_B in out and CSS_E in out),
        ('JS 块', JS_B in out and JS_E in out),
        ('样式标签', '<style id="fps-style">' in out),
        ('脚本标签', '<script id="fps-js">' in out),
        ('setDigitAnim 补丁标记', PATCH_TAG in out),
        ('补丁含值缓存', 'el.__tDigitVal' in out),
        ('自适应监控', 'window.__fpsBoost' in out),
        ('降级规则', 'data-fps-q="medium"' in out),
        ('视口外跳过渲染', 'content-visibility: auto' in out),
        ('CSS 在 </head> 前', out.find(CSS_B) < out.find('</head>')),
        ('JS 在 </body> 前', out.find(JS_B) < out.find('</body>')),
        ('收尾完整', out.rstrip().endswith('</html>')),
        ('换行风格保持', detect_eol(out) == eol),
        # 补丁不能改变调用契约：函数名与参数不变
        ('函数签名未变', out.count('function setDigitAnim(el, val) {') == 1),
    ]
    for name, ok in checks:
        if not ok:
            problems.append('校验失败：%s' % name)

    if eol == '\r\n':
        stray = out.count('\n') - out.count('\r\n')
        if stray:
            problems.append('存在 %d 处 LF 换行（应为纯 CRLF）' % stray)
    else:
        stray = out.count('\r\n')
        if stray:
            problems.append('存在 %d 处 CRLF 换行（应为纯 LF）' % stray)

    if out.count('<style') != clean.count('<style') + 1:
        problems.append('style 标签数异常（应 +1）')
    if out.count('</style>') != clean.count('</style>') + 1:
        problems.append('/style 标签数异常（应 +1）')
    if out.count('<script') != clean.count('<script') + 1:
        problems.append('script 标签数异常（应 +1）')
    if out.count('</script>') != clean.count('</script>') + 1:
        problems.append('/script 标签数异常（应 +1）')

    if problems:
        print('[X] 校验未通过，未写入文件：')
        for p in problems:
            print('    - ' + p)
        sys.exit(1)

    write(TARGET, out)

    b0, b1 = len(src.encode('utf-8')), len(out.encode('utf-8'))
    print('[OK] 已注入帧率优化层：%s' % TARGET)
    print('   %s → %s 字节（+%d）' % (format(b0, ','), format(b1, ','), b1 - b0))
    print('   fps.css %s 字节 / fps.js %s 字节'
          % (format(len(css.encode('utf-8')), ','), format(len(js.encode('utf-8')), ',')))
    print('   setDigitAnim 已优化（值缓存 + 长度一致时增量更新）')
    print('   原有特征 %d 项全部保留' % len(MUST_KEEP))
    print('   换行风格：%s（与原文一致）' % ('CRLF' if eol == '\r\n' else 'LF'))
    if had:
        print('   （已替换上一版注入块，未累积）')


if __name__ == '__main__':
    main()
