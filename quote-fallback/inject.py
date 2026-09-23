# -*- coding: utf-8 -*-
"""
quote-fallback / inject.py —— 行情备用通道注入器

把 quote-fallback/ 下的备用数据源（新浪期货 / 新浪个股 / 腾讯板块）
注入 finance-workbench/index.html，用于东财 push2 被限流时的兜底。

做两件事：
1. 插入备用源模块（fallback.js + patch.js，合并为一个 script 块）
2. 校验原有特征 + window.__quoteHook 桥接未被破坏

特性（与 minute-chart / perf-boost / sector-edit 注入器一致）：
- 幂等：重复执行会先移除旧注入块，不会累积
- 安全：先在内存里组装并校验，全部通过才写盘
- 保留 CRLF：用 newline='' 读写
- 不动原有逻辑：只在 </body> 前插入一块

用法：
    python quote-fallback/inject.py            # 注入
    python quote-fallback/inject.py --check    # 只校验当前状态，不写盘
    python quote-fallback/inject.py --revert   # 回退到未注入状态
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

JS_B, JS_E = '<!-- QF:JS:BEGIN -->', '<!-- QF:JS:END -->'

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
    # 备用通道依赖的桥接
    'window.__quoteHook',
    'getFutures: function ()',
    'getFocusStocks: function ()',
    # 其他模块的注入块（不能被本注入器吃掉）
    '<!-- MC:CSS:BEGIN -->',
    '<!-- PB:CSS:BEGIN -->',
    '<!-- BFX:CSS:BEGIN -->',
    # 期货 / 重点关注的挂载点
    'id="fut-grid"',
    'id="fut-status"',
    'id="focus-sectors"',
    'id="focus-stocks"',
    'id="fd-list"',
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
    return re.sub(re.escape(JS_B) + r'.*?' + re.escape(JS_E) + r'[ \t]*\r?\n?',
                  '', html, flags=re.S)


def err(msg):
    sys.stderr.write('[X] %s\n' % msg)
    sys.exit(1)


def main():
    argv = sys.argv[1:]
    check_only = '--check' in argv
    revert = '--revert' in argv

    if not os.path.exists(TARGET):
        err('找不到 %s' % TARGET)

    fb = read(os.path.join(HERE, 'fallback.js'))
    pt = read(os.path.join(HERE, 'patch.js'))

    # 防止提前闭合注入块
    for name, txt in (('fallback.js', fb), ('patch.js', pt)):
        if '</script>' in txt or '</style>' in txt:
            err('%s 含 </script> 或 </style>，会破坏注入块结构' % name)

    src = read(TARGET)
    had = JS_B in src
    clean = strip_blocks(src)

    if check_only:
        print('当前状态：%s' % ('已注入' if had else '未注入'))
        print('  移除旧块后：%d 字节' % len(clean.encode('utf-8')))
        print('  磁盘文件  ：%d 字节' % len(src.encode('utf-8')))
        if had:
            print('  注入块体积：约 %d 字节'
                  % (len(src.encode('utf-8')) - len(clean.encode('utf-8'))))
        return

    if revert:
        write_out = to_eol(clean, detect_eol(clean))
        io.open(TARGET, 'w', encoding='utf-8', newline='').write(write_out)
        print('[OK] 已回退：移除 QF 注入块')
        return

    eol = detect_eol(clean)

    body = (
        JS_B + '\n'
        '<script id="qf-fallback-js">\n'
        '/* ==== 1/2 备用数据源 ==== */\n'
        + fb + '\n'
        '/* ==== 2/2 接管补位 ==== */\n'
        + pt + '\n'
        '</script>\n'
        + JS_E + '\n'
    )
    block = to_eol(body, eol)

    k = clean.rfind('</body>')
    if k < 0:
        err('找不到 </body> 锚点')
    out = clean[:k] + block + clean[k:]

    # ---- 校验 ----
    problems = []
    for feat in MUST_KEEP:
        if feat not in out:
            problems.append('原有特征丢失：%s' % feat)

    checks = [
        ('JS 块', JS_B in out and JS_E in out),
        ('备用源脚本', '<script id="qf-fallback-js">' in out),
        ('新浪期货映射', 'FUT_SINA' in out),
        ('腾讯板块源', 'mktHs/rank' in out),
        ('桥接读取', 'window.__quoteHook' in out),
        ('块在 </body> 前', out.find(JS_B) < out.find('</body>')),
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
        stray = out.count('\r\n')
        if stray:
            problems.append('存在 %d 处 CRLF 换行（应为纯 LF）' % stray)

    if out.count('<script') != clean.count('<script') + 1:
        problems.append('script 标签数异常（应 +1）')
    if out.count('</script>') != clean.count('</script>') + 1:
        problems.append('/script 标签数异常（应 +1）')

    # 注入块不能吃掉别的模块标记
    if out.count('<!-- QF:JS:BEGIN -->') != 1:
        problems.append('QF 标记数量异常（应为 1）')

    if problems:
        print('[X] 校验未通过，未写入文件：')
        for p in problems:
            print('    - ' + p)
        sys.exit(1)

    io.open(TARGET, 'w', encoding='utf-8', newline='').write(out)

    b0, b1 = len(src.encode('utf-8')), len(out.encode('utf-8'))
    print('[OK] 已注入行情备用通道：%s' % TARGET)
    print('   %s → %s 字节（+%d）' % (format(b0, ','), format(b1, ','), b1 - b0))
    print('   fallback.js %s 字节 / patch.js %s 字节'
          % (format(len(fb.encode('utf-8')), ','), format(len(pt.encode('utf-8')), ',')))
    print('   原有特征 %d 项全部保留' % len(MUST_KEEP))
    print('   换行风格：%s（与原文一致，未污染 diff）' % ('CRLF' if eol == '\r\n' else 'LF'))
    if had:
        print('   （已替换上一版注入块，未累积）')


if __name__ == '__main__':
    main()
