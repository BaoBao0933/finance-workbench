#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""focus-manage 幂等注入器：FM:CSS / FM:JS 锚到 QF:JS 之前（链条 FPS<SE<AF<FM<QF）"""
import io, re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, '..', 'index.html')
CSS_B, CSS_E = '<!-- FM:CSS:BEGIN -->', '<!-- FM:CSS:END -->'
JS_B, JS_E = '<!-- FM:JS:BEGIN -->', '<!-- FM:JS:END -->'
MUST_KEEP = ['window.__sectorsHook', 'qf-fallback-js', 'finance-focus-list', 'btn-focus-refresh']

def to_eol(t, eol):
    return t.replace('\r\n', '\n').replace('\n', eol)

def block(b, e, inner, eol):
    return to_eol(b + '\n' + inner + '\n' + e + '\n', eol)


def _strip_block(html, bb, ee):
    """删除 [BEGIN..END] 及其前后紧贴的换行，避免块迁移后空行残留累积"""
    while True:
        i = html.find(bb)
        if i < 0: break
        j = html.find(ee, i)
        if j < 0: break
        j2 = j + len(ee)
        if html[j2:j2+2] == '\r\n': j2 += 2
        elif html[j2:j2+1] == '\n': j2 += 1
        i2 = i
        if html[i2-2:i2] == '\r\n': i2 -= 2
        elif html[i2-1:i2] == '\n': i2 -= 1
        html = html[:i2] + html[j2:]
    return html

def strip_existing(html):
    html = _strip_block(html, CSS_B, CSS_E)
    html = _strip_block(html, JS_B, JS_E)
    return html

def err(msg):
    print('[x] ' + msg); sys.exit(1)

def main():
    html = io.open(INDEX, encoding='utf-8', newline='').read()
    before = len(html.encode('utf-8'))
    eol = '\r\n' if '\r\n' in html else '\n'
    clean = strip_existing(html)

    css = io.open(os.path.join(HERE, 'fm.css'), encoding='utf-8').read()
    js = io.open(os.path.join(HERE, 'fm.js'), encoding='utf-8').read()

    css_b = block(CSS_B, CSS_E, '<style id="fm-style">\n' + css + '\n</style>', eol)
    js_b = block(JS_B, JS_E, '<script id="fm-js">\n' + js + '\n</script>', eol)

    # 保序：FM:CSS 锚 FPS:CSS 前（CSS 链 FM<FPS<AF</head），
    # FM:JS 锚 QF:JS 前（JS 链 FPS<SE<AF<FM<QF</body）。每个锚一个插入者。
    mCss = re.search(r'<!-- FPS:CSS:BEGIN -->', clean)
    cpos = mCss.start() if mCss else clean.find('</head>')
    if cpos < 0: err('找不到 CSS 锚点')
    out = clean[:cpos] + css_b + clean[cpos:]
    mQF = re.search(r'<!-- QF:JS:BEGIN -->', out)
    jpos = mQF.start() if mQF else out.rfind('</body>')
    if jpos < 0: err('找不到 JS 锚点')
    out = out[:jpos] + js_b + out[jpos:]

    for feat in MUST_KEEP:
        if feat not in out: err('原有特征丢失: ' + feat)

    io.open(INDEX, 'w', encoding='utf-8', newline='').write(out)
    print('[OK] focus-manage 已注入：%d → %d 字节（锚 QF 之前，保序）' % (before, len(out.encode('utf-8'))))

if __name__ == '__main__':
    main()
