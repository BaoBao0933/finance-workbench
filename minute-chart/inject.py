# -*- coding: utf-8 -*-
"""
把 minute-chart/ 下的分时图模块注入到 finance-workbench/index.html。

特性：
- 幂等：重复执行会先移除旧注入块，不会累积
- 安全：先在内存里组装并校验，全部通过才写盘
- 不动原有代码：只在两处锚点插入，原 style / script 一行不改

用法：
    python minute-chart/inject.py            # 注入
    python minute-chart/inject.py --check    # 只校验当前状态
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

CSS_B, CSS_E = '<!-- MC:CSS:BEGIN -->', '<!-- MC:CSS:END -->'
BODY_B, BODY_E = '<!-- MC:BODY:BEGIN -->', '<!-- MC:BODY:END -->'

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
]


def read(p):
    """保留原始换行符读取（避免把 CRLF 文件整体改成 LF，污染 diff）"""
    return io.open(p, encoding='utf-8', newline='').read()


def detect_eol(txt):
    crlf = txt.count('\r\n')
    lf = txt.count('\n') - crlf
    return '\r\n' if crlf >= lf else '\n'


def to_eol(txt, eol):
    flat = txt.replace('\r\n', '\n').replace('\r', '\n')
    return flat if eol == '\n' else flat.replace('\n', '\r\n')


def strip_blocks(html):
    """移除旧注入块（块自带尾部换行，一并吃掉），保证多次执行体积完全不变"""
    for a, b in ((CSS_B, CSS_E), (BODY_B, BODY_E)):
        html = re.sub(re.escape(a) + r'.*?' + re.escape(b) + r'[ \t]*\r?\n?',
                      '', html, flags=re.S)
    return html


def err(msg):
    sys.stderr.write('[X] %s\n' % msg)
    sys.exit(1)


def main():
    check_only = '--check' in sys.argv

    if not os.path.exists(TARGET):
        err('找不到 %s' % TARGET)

    css = read(os.path.join(HERE, 'minute.css'))
    frag = read(os.path.join(HERE, 'minute.html'))
    js = read(os.path.join(HERE, 'minute.js'))

    # 防止提前闭合注入块
    for name, txt in (('minute.css', css), ('minute.html', frag), ('minute.js', js)):
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
            injected = len(src.encode('utf-8')) - len(clean.encode('utf-8'))
            print('  注入块体积：约 %d 字节' % injected)
        return

    eol = detect_eol(clean)
    css_block = to_eol(CSS_B + '\n<style id="minute-chart-style">\n' + css + '\n</style>\n' + CSS_E + '\n', eol)
    body_block = to_eol(BODY_B + '\n' + frag + '\n<script id="minute-chart-js">\n' + js + '\n</script>\n' + BODY_E + '\n', eol)

    # ---- 锚点 1：主 </style> 之后插入 CSS（块自带换行，不再额外添加） ----
    i = clean.find('</style>')
    if i < 0:
        err('找不到主 </style> 锚点')
    j = i + len('</style>')
    out = clean[:j] + css_block + clean[j:]

    # ---- 锚点 2：</body> 之前插入 HTML + JS ----
    k = out.rfind('</body>')
    if k < 0:
        err('找不到 </body> 锚点')
    out = out[:k] + body_block + out[k:]

    # ---- 校验 ----
    problems = []
    for feat in MUST_KEEP:
        if feat not in out:
            problems.append('原有特征丢失：%s' % feat)

    checks = [
        ('CSS 块', CSS_B in out and CSS_E in out),
        ('HTML 块', BODY_B in out and BODY_E in out),
        ('分时图样式', '<style id="minute-chart-style">' in out),
        ('分时图脚本', '<script id="minute-chart-js">' in out),
        ('弹层容器', 'id="minute-mask"' in out),
        ('canvas', 'id="mm-canvas"' in out),
        ('注入顺序 CSS→BODY', out.find(CSS_B) < out.find(BODY_B)),
        ('CSS 在 </head> 前', out.find(CSS_B) < out.find('</head>')),
        ('BODY 在 </body> 前', out.find(BODY_B) < out.find('</body>')),
        ('收尾完整', out.rstrip().endswith('</html>')),
        ('花括号平衡', out.count('{') >= out.count('}')),
        ('换行风格保持', detect_eol(out) == eol),
    ]
    for name, ok in checks:
        if not ok:
            problems.append('校验失败：%s' % name)

    # 换行符必须统一，不能被注入块污染
    if eol == '\r\n':
        stray = out.count('\n') - out.count('\r\n')
        if stray:
            problems.append('存在 %d 处 LF 换行（应为纯 CRLF）' % stray)
    else:
        stray = out.count('\r\n')
        if stray:
            problems.append('存在 %d 处 CRLF 换行（应为纯 LF）' % stray)

    # 主 style 与主 script 段落未被破坏（标签计数必须成对增加）
    if out.count('<style') != clean.count('<style') + 1:
        problems.append('style 标签数异常')
    if out.count('</style>') != clean.count('</style>') + 1:
        problems.append('/style 标签数异常')
    if out.count('<script') != clean.count('<script') + 1:
        problems.append('script 标签数异常')
    if out.count('</script>') != clean.count('</script>') + 1:
        problems.append('/script 标签数异常')

    if problems:
        print('[X] 校验未通过，未写入文件：')
        for p in problems:
            print('    - ' + p)
        sys.exit(1)

    io.open(TARGET, 'w', encoding='utf-8', newline='').write(out)

    b0, b1 = len(src.encode('utf-8')), len(out.encode('utf-8'))
    print('[OK] 已注入分时图模块：%s' % TARGET)
    print('   %s → %s 字节（+%d）' % (format(b0, ','), format(b1, ','), b1 - b0))
    print('   CSS %s 字节 / HTML %s 字节 / JS %s 字节'
          % (format(len(css.encode('utf-8')), ','),
             format(len(frag.encode('utf-8')), ','),
             format(len(js.encode('utf-8')), ',')))
    print('   原有特征 %d 项全部保留' % len(MUST_KEEP))
    print('   换行风格：%s（与原文一致，未污染 diff）' % ('CRLF' if eol == '\r\n' else 'LF'))
    if had:
        print('   （已替换上一版注入块，未累积）')


if __name__ == '__main__':
    main()
