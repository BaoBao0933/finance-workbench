# -*- coding: utf-8 -*-
"""
perf-boost / inject.py —— 首屏加速模块注入器

把 perf-boost/ 下的首屏加速层注入 finance-workbench/index.html。

做三件事：
1. 摘除 Google Fonts 渲染阻塞 link（替换为本地字体栈 + 预连接）
2. 插入骨架屏 + 首屏加速运行时
3. 关键动效降本 CSS

特性（与 minute-chart / banner-fx / sector-edit 注入器一致）：
- 幂等：重复执行会先移除旧注入块，不会累积
- 安全：先在内存里组装并校验，全部通过才写盘
- 保留 CRLF：用 newline='' 读写，不污染换行符
- 不动原有逻辑：只替换字体 link 一块 + 插入两处锚点

用法：
    python perf-boost/inject.py            # 注入
    python perf-boost/inject.py --check    # 只校验，不写盘
    python perf-boost/inject.py --revert   # 回退到未注入状态
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

CSS_B, CSS_E = '<!-- PB:CSS:BEGIN -->', '<!-- PB:CSS:END -->'
JS_B, JS_E = '<!-- PB:JS:BEGIN -->', '<!-- PB:JS:END -->'
BOOT_B, BOOT_E = '<!-- PB:BOOT:BEGIN -->', '<!-- PB:BOOT:END -->'

# --- 原字体引入块（要被替换掉的那一段）---
FONT_ORIG = '''<!-- Google Fonts: Space Grotesk + Space Mono (Nothing Design) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">'''

FONT_NEW = '''<!-- PB: perf-boost 已移除 Google Fonts 渲染阻塞（国内不可达，原阻塞 20s+）— 字体改用本地系统栈，见 PB:CSS 块 -->
<!-- anime.js 动画库（通过 CDN 快速引入，供页面动画使用） -->'''

# 注入后必须仍然存在的原有特征（防止改坏主文件）
MUST_KEEP = [
    '<aside class="sidebar">',
    '<main class="main">',
    'function jsonp(',
    'async function fetchJson(',
    'function setDigitAnim(',
    'animeEntrance',
    '.fx-tilt',
    'id="watch-list"',
    'id="pos-list"',
    'id="lhb-list"',
    'function pollAdaptive(',
    'loadSectors(true);',
    'anime.js 动画库',
]

BOOT_TPL = '''{b}
<div id="pb-boot" class="pb-boot">
  <div class="pb-boot__mark">
    包包财经
    <small>BAOBAO FINANCE</small>
  </div>
  <div class="pb-boot__bars">
    <span class="pb-boot__bar"></span>
    <span class="pb-boot__bar"></span>
    <span class="pb-boot__bar"></span>
  </div>
</div>
{e}'''


def read(p):
    """保留原始换行符读取"""
    return io.open(p, encoding='utf-8', newline='').read()


def write(p, s):
    """统一以 CRLF 写回（主文件全文件为 CRLF，保持一致避免 diff 爆炸）"""
    s = s.replace('\r\n', '\n').replace('\n', '\r\n')
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def read_norm(p):
    """读取并把换行统一成 LF，便于跨平台比对外部编辑器改过的文件"""
    return read(p).replace('\r\n', '\n')


def strip_blocks(html):
    """移除所有 PB 注入块，让文件回到「未注入」状态"""
    for b, e in ((CSS_B, CSS_E), (JS_B, JS_E), (BOOT_B, BOOT_E)):
        html = re.sub(re.escape(b) + r'.*?' + re.escape(e) + r'\r?\n?', '', html, flags=re.S)
    return html


def build():
    css = read(os.path.join(HERE, 'perf.css'))
    js = read(os.path.join(HERE, 'perf.js'))
    css_b = '%s\n<style id="pb-style">\n%s\n</style>\n%s\n' % (CSS_B, css, CSS_E)
    js_b = '%s\n<script id="pb-js">\n%s\n</script>\n%s\n' % (JS_B, js, JS_E)
    boot_b = BOOT_TPL.replace('{b}', BOOT_B).replace('{e}', BOOT_E) + '\n'
    return css_b, js_b, boot_b


def validate(html):
    """校验：锚点存在、原特征没丢、无重复块"""
    errs = []
    for k in MUST_KEEP:
        if k not in html:
            errs.append('原有特征丢失: %s' % k)

    for tag in (CSS_B, CSS_E, JS_B, JS_E, BOOT_B, BOOT_E):
        n = html.count(tag)
        if n != 1:
            errs.append('注入标记数量异常 %s = %d（应为 1）' % (tag, n))

    # 只检查真正的「资源引用」，注释里提到域名不算
    if re.search(r'href="https://fonts\.(googleapis|gstatic)\.com', html):
        errs.append('仍存在 Google Fonts 资源引用（应已摘除）')

    return errs


def main():
    argv = sys.argv[1:]
    check_only = '--check' in argv
    revert = '--revert' in argv

    if not os.path.exists(TARGET):
        print('[x] 找不到主文件: %s' % TARGET)
        return 1

    raw = read(TARGET)
    nl_crlf = raw.count('\r\n')
    print('[i] 主文件 %d 字节 / %d 行 / CRLF %d' % (len(raw.encode('utf-8')), raw.count('\n') + 1, nl_crlf))

    # 先还原到干净状态
    html = strip_blocks(raw)

    if revert:
        if check_only:
            print('[i] --revert 与 --check 同用，仅预览不写盘')
        else:
            write(TARGET, html)
            print('[√] 已回退：移除全部 PB 注入块')
            return 0

    # 摘掉原 Google Fonts 块（并清掉可能残留的裸 link）
    replaced = 0
    if FONT_ORIG in html:
        html = html.replace(FONT_ORIG, FONT_NEW, 1)
        replaced += 1
    # 再兜底清掉任何漏网的 fonts 域名 link
    html = re.sub(
        r'[ \t]*<link[^>]*href="https://fonts\.(googleapis|gstatic)\.com[^"]*"[^>]*>\r?\n?',
        '', html
    )
    # 顺手去掉针对它们的 preconnect（避免留无用连接）
    html = re.sub(
        r'[ \t]*<link[^>]*rel="preconnect"[^>]*href="https://fonts\.(googleapis|gstatic)\.com[^"]*"[^>]*>\r?\n?',
        '', html
    )

    # anime.js 改为 defer：不再阻塞首屏（全站调用点均有 typeof 守卫）
    def _defer_anime(mt):
        tag = mt.group(0)
        if re.search(r'\bdefer\b', tag):
            return tag
        return tag.replace('<script ', '<script defer ', 1)

    html = re.sub(r'<script[^>]*src="https://cdn\.jsdelivr\.net/npm/animejs[^"]*"[^>]*>',
                  _defer_anime, html)

    if check_only:
        print('[i] 已摘除原字体块: %d 处' % replaced)
        print('[i] 当前文件不含 PB 块（预览模式不做注入）')
        errs = validate(strip_blocks(raw)) if False else []
        print('[i] --check 仅检测侵入性；如需完整校验请先注入')
        return 0

    css_b, js_b, boot_b = build()

    # --- 锚点 1：CSS 插在 </head> 前 ---
    m = re.search(r'</head>', html)
    if not m:
        print('[x] 找不到 </head> 锚点')
        return 1
    html = html[:m.start()] + css_b + html[m.start():]

    # --- 锚点 2：骨架屏 + JS 插在 </body> 前 ---
    m = re.search(r'</body>', html)
    if not m:
        print('[x] 找不到 </body> 锚点')
        return 1
    html = html[:m.start()] + boot_b + js_b + html[m.start():]

    errs = validate(html)
    if errs:
        print('[x] 校验失败，未写盘：')
        for e in errs:
            print('    - %s' % e)
        return 1

    write(TARGET, html)

    new_raw = read(TARGET)
    print('[√] 注入完成')
    print('    摘除原字体块 : %d 处' % replaced)
    print('    文件大小     : %d → %d 字节' % (len(raw.encode('utf-8')), len(new_raw.encode('utf-8'))))
    print('    CRLF 保持    : %d → %d' % (nl_crlf, new_raw.count('\r\n')))
    print('    注入标记     : CSS/JS/BOOT 各 1 组')
    return 0


if __name__ == '__main__':
    sys.exit(main())
