# -*- coding: utf-8 -*-
"""
把 banner-fx/ 下的首页横幅动效注入到 finance-workbench/index.html。

特性：
- 幂等：重复执行先移除旧块，体积不变
- 安全：先在内存组装并校验，全部通过才写盘
- 不动原有代码：只在两处锚点插入
- 保留原文件换行风格（CRLF）

用法：
    python banner-fx/inject.py
    python banner-fx/inject.py --check
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

CSS_B, CSS_E = '<!-- BFX:CSS:BEGIN -->', '<!-- BFX:CSS:END -->'
JS_B, JS_E = '<!-- BFX:JS:BEGIN -->', '<!-- BFX:JS:END -->'

# 注入后必须仍然存在的原有特征（防止改坏主文件，也防止踩到分时图模块）
MUST_KEEP = [
    '<aside class="sidebar">',
    '<main class="main">',
    '<div class="fun-banner">',
    '.fun-banner .fb-title',
    'function renderDailyQuote(',
]


def read(p):
    """保留原始换行符读取（避免把 CRLF 文件整体改成 LF）"""
    return io.open(p, encoding='utf-8', newline='').read()


def detect_eol(txt):
    crlf = txt.count('\r\n')
    lf = txt.count('\n') - crlf
    return '\r\n' if crlf >= lf else '\n'


def to_eol(txt, eol):
    flat = txt.replace('\r\n', '\n').replace('\r', '\n')
    return flat if eol == '\n' else flat.replace('\n', '\r\n')


def strip_blocks(html):
    for a, b in ((CSS_B, CSS_E), (JS_B, JS_E)):
        html = re.sub(re.escape(a) + r'.*?' + re.escape(b) + r'[ \t]*\r?\n?', '', html, flags=re.S)
    return html


def err(msg):
    sys.stderr.write('[X] %s\n' % msg)
    sys.exit(1)


def main():
    check_only = '--check' in sys.argv
    if not os.path.exists(TARGET):
        err('找不到 %s' % TARGET)

    css = read(os.path.join(HERE, 'banner.css'))
    js = read(os.path.join(HERE, 'banner.js'))

    for name, txt in (('banner.css', css), ('banner.js', js)):
        if '</style>' in txt or '</script>' in txt:
            err('%s 含 </style> 或 </script>，会破坏注入块结构' % name)

    src = read(TARGET)
    had = CSS_B in src
    clean = strip_blocks(src)

    if check_only:
        print('当前状态：%s' % ('已注入' if had else '未注入'))
        print('  移除旧块后：%d 字节' % len(clean.encode('utf-8')))
        print('  磁盘文件  ：%d 字节' % len(src.encode('utf-8')))
        if had:
            print('  注入块体积：约 %d 字节' % (len(src.encode('utf-8')) - len(clean.encode('utf-8'))))
        return

    eol = detect_eol(clean)
    css_block = to_eol(CSS_B + '\n<style id="banner-fx-style">\n' + css + '\n</style>\n' + CSS_E + '\n', eol)
    js_block = to_eol(JS_B + '\n<script id="banner-fx-js">\n' + js + '\n</script>\n' + JS_E + '\n', eol)

    # ---- 锚点 1：</head> 之前插 CSS（确保在所有样式之后，优先级最高）----
    i = clean.rfind('</head>')
    if i < 0:
        err('找不到 </head> 锚点')
    out = clean[:i] + css_block + clean[i:]

    # ---- 锚点 2：</body> 之前插 JS ----
    k = out.rfind('</body>')
    if k < 0:
        err('找不到 </body> 锚点')
    out = out[:k] + js_block + out[k:]

    # ---- 校验 ----
    problems = []
    for feat in MUST_KEEP:
        if feat.startswith('annotate-'):
            continue
        if feat not in out:
            problems.append('原有特征丢失：%s' % feat)

    checks = [
        ('CSS 块', CSS_B in out and CSS_E in out),
        ('JS 块', JS_B in out and JS_E in out),
        ('样式 id', '<style id="banner-fx-style">' in out),
        ('脚本 id', '<script id="banner-fx-js">' in out),
        ('CSS 在 </head> 前', out.find(CSS_B) < out.find('</head>')),
        ('JS 在 </body> 前', out.find(JS_B) < out.find('</body>')),
        ('CSS 晚于分时图样式', out.find(CSS_B) > out.find('id="minute-chart-style"')),
        ('气泡层选择器', '.fb-goo' in out and '.fb-blob' in out),
        ('流光边框选择器', '.fb-beam' in out),
        ('高光层选择器', '.fb-sheen' in out),
        ('goo 滤镜', 'fb-goo-filter' in out),
        ('收尾完整', out.rstrip().endswith('</html>')),
        ('换行风格保持', detect_eol(out) == eol),
    ]
    for name, ok in checks:
        if not ok:
            problems.append('校验失败：%s' % name)

    if eol == '\r\n':
        stray = out.count('\n') - out.count('\r\n')
        if stray:
            problems.append('存在 %d 处 LF 换行（应为纯 CRLF）' % stray)
    else:
        if out.count('\r\n'):
            problems.append('存在 %d 处 CRLF 换行（应为纯 LF）' % out.count('\r\n'))

    if problems:
        print('[X] 校验未通过，未写入文件：')
        for p in problems:
            print('    - ' + p)
        sys.exit(1)

    io.open(TARGET, 'w', encoding='utf-8', newline='').write(out)

    b0, b1 = len(src.encode('utf-8')), len(out.encode('utf-8'))
    print('[OK] 已注入首页横幅动效：%s' % TARGET)
    print('   %s → %s 字节（+%d）' % (format(b0, ','), format(b1, ','), b1 - b0))
    print('   CSS %s 字节 / JS %s 字节'
          % (format(len(css.encode('utf-8')), ','), format(len(js.encode('utf-8')), ',')))
    print('   原有特征 %d 项全部保留' % len([x for x in MUST_KEEP if not x.startswith('annotate-')]))
    print('   换行风格：%s（与原文一致）' % ('CRLF' if eol == '\r\n' else 'LF'))
    if had:
        print('   （已替换上一版注入块，未累积）')


if __name__ == '__main__':
    main()
