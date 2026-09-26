# -*- coding: utf-8 -*-
"""
apple-fx / inject.py —— 苹果风质感层注入器

把 apple-fx/ 注入 finance-workbench/index.html：
1. AF:CSS   —— 液态玻璃（首页指数卡 url() 折射）+ 小角度倾斜样式（</head> 前）
2. AF:HTML  —— SVG feTurbulence/feDisplacementMap 折射滤镜（</body> 前）
3. AF:JS    —— 倾斜的事件委托交互（</body> 前）

特性（与 fps-boost / quote-fallback 注入器一致）：幂等、先组装后校验、CRLF 保持。
应用范围刻意克制：折射全站只给首页 4 张指数卡；倾斜 maxTilt 5°。
掉帧时 fps-boost 的 !important 磨砂规则自动覆盖折射，无需联动代码。

用法：
    python apple-fx/inject.py            # 注入
    python apple-fx/inject.py --check    # 只校验当前状态
    python apple-fx/inject.py --revert   # 回退
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

CSS_B, CSS_E = '<!-- AF:CSS:BEGIN -->', '<!-- AF:CSS:END -->'
HTML_B, HTML_E = '<!-- AF:HTML:BEGIN -->', '<!-- AF:HTML:END -->'
JS_B, JS_E = '<!-- AF:JS:BEGIN -->', '<!-- AF:JS:END -->'

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
    '<!-- FPS:CSS:BEGIN -->',
    # 依赖的挂载点
    'id="page-home"',
    'function buildFutCard',
    'window.__quoteHook',
    'window.__fpsBoost',
]


def read(p):
    return io.open(p, encoding='utf-8', newline='').read()


def detect_eol(txt):
    crlf = txt.count('\r\n')
    lf = txt.count('\n') - crlf
    return '\r\n' if crlf >= lf else '\n'


def to_eol(txt, eol):
    flat = txt.replace('\r\n', '\n').replace('\r', '\n')
    return flat if eol == '\n' else flat.replace('\n', '\r\n')


def strip_blocks(html):
    for b, e in ((CSS_B, CSS_E), (HTML_B, HTML_E), (JS_B, JS_E)):
        html = re.sub(re.escape(b) + r'.*?' + re.escape(e) + r'[ \t]*\r?\n?',
                      '', html, flags=re.S)
    return html


def err(msg):
    sys.stderr.write('[X] %s\n' % msg)
    sys.exit(1)


def main():
    argv = sys.argv[1:]
    check_only = '--check' in argv
    revert = '--revert' in argv

    if not os.path.exists(TARGET):
        err('找不到 %s' % TARGET)

    css = read(os.path.join(HERE, 'apple.css'))
    js = read(os.path.join(HERE, 'apple.js'))

    for name, txt in (('apple.css', css), ('apple.js', js)):
        if '</style>' in txt or '</script>' in txt:
            err('%s 含 </style> 或 </script>，会破坏注入块结构' % name)

    src = read(TARGET)
    had = CSS_B in src
    clean = strip_blocks(src)

    if check_only:
        print('当前状态：%s' % ('已注入' if had else '未注入'))
        print('  移除旧块后：%d 字节' % len(clean.encode('utf-8')))
        print('  磁盘文件  ：%d 字节' % len(src.encode('utf-8')))
        return

    if revert:
        io.open(TARGET, 'w', encoding='utf-8', newline='').write(
            to_eol(clean, detect_eol(clean)))
        print('[OK] 已回退：移除 AF 注入块')
        return

    eol = detect_eol(clean)

    css_block = to_eol(
        CSS_B + '\n<style id="apple-style">\n' + css + '\n</style>\n' + CSS_E + '\n', eol)

    html_frag = (
        '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">\n'
        '  <filter id="apple-lg" x="-20%" y="-20%" width="140%" height="140%">\n'
        '    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.011" numOctaves="2" seed="7" result="n"/>\n'
        '    <feGaussianBlur in="n" stdDeviation="2.4" result="s"/>\n'
        '    <feDisplacementMap in="SourceGraphic" in2="s" scale="22" xChannelSelector="R" yChannelSelector="G"/>\n'
        '  </filter>\n'
        '</svg>\n'
    )
    html_block = to_eol(HTML_B + '\n' + html_frag + HTML_E + '\n', eol)

    js_block = to_eol(
        JS_B + '\n<script id="apple-js">\n' + js + '\n</script>\n' + JS_E + '\n', eol)

    m = re.search(r'</head>', clean)
    if not m:
        err('找不到 </head> 锚点')
    out = clean[:m.start()] + css_block + clean[m.start():]

    k = out.rfind('</body>')
    if k < 0:
        err('找不到 </body> 锚点')
    out = out[:k] + html_block + js_block + out[k:]

    # ---- 校验 ----
    problems = []
    for feat in MUST_KEEP:
        if feat not in out:
            problems.append('原有特征丢失：%s' % feat)

    checks = [
        ('CSS 块', CSS_B in out and CSS_E in out),
        ('HTML 块', HTML_B in out and HTML_E in out),
        ('JS 块', JS_B in out and JS_E in out),
        ('折射滤镜', 'id="apple-lg"' in out and 'feDisplacementMap' in out),
        ('液态玻璃规则', 'url(#apple-lg) blur(22px)' in out),
        ('倾斜变量规则', '--af-rx' in out and '--af-ry' in out),
        ('倾斜 JS', 'MAX_TILT = 5' in out),
        ('CSS 在 </head> 前', out.find(CSS_B) < out.find('</head>')),
        ('HTML/JS 在 </body> 前',
         0 < out.find(HTML_B) < out.find('</body>')
         and 0 < out.find(JS_B) < out.find('</body>')),
        ('收尾完整', out.rstrip().endswith('</html>')),
        ('换行风格保持', detect_eol(out) == eol),
    ]
    for name, ok in checks:
        if not ok:
            problems.append('校验失败：%s' % name)

    # SVG 滤镜的 id 不得与页面既有 id 冲突
    ids = re.findall(r'<filter[^>]*id="([^"]+)"', out)
    if ids.count('apple-lg') != 1:
        problems.append('apple-lg 滤镜数量异常：%d' % ids.count('apple-lg'))

    if eol == '\r\n':
        stray = out.count('\n') - out.count('\r\n')
        if stray:
            problems.append('存在 %d 处 LF 换行（应为纯 CRLF）' % stray)

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

    io.open(TARGET, 'w', encoding='utf-8', newline='').write(out)

    b0, b1 = len(src.encode('utf-8')), len(out.encode('utf-8'))
    print('[OK] 已注入苹果风质感层：%s' % TARGET)
    print('   %s → %s 字节（+%d）' % (format(b0, ','), format(b1, ','), b1 - b0))
    print('   apple.css %s 字节 / apple.js %s 字节'
          % (format(len(css.encode('utf-8')), ','), format(len(js.encode('utf-8')), ',')))
    print('   液态玻璃：仅 #page-home .index-card（4 张）；倾斜 maxTilt 5°')
    print('   原有特征 %d 项全部保留' % len(MUST_KEEP))
    print('   换行风格：%s' % ('CRLF' if eol == '\r\n' else 'LF'))
    if had:
        print('   （已替换上一版注入块，未累积）')


if __name__ == '__main__':
    main()
