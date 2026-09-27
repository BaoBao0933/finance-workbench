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

def strip_existing(html):
    for bb, ee in [(CSS_B, CSS_E), (JS_B, JS_E)]:
        while True:
            i = html.find(bb)
            if i < 0: break
            j = html.find(ee, i)
            if j < 0: break
            html = html[:i] + html[j + len(ee):]
            html = html.replace(bb + '\r\n', '').replace(bb + '\n', '')
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

    mQF = re.search(r'<!-- QF:JS:BEGIN -->', clean)
    pos = mQF.start() if mQF else clean.rfind('</body>')
    if pos < 0: err('找不到锚点')
    out = clean[:pos] + css_b + js_b + clean[pos:]

    for feat in MUST_KEEP:
        if feat not in out: err('原有特征丢失: ' + feat)

    io.open(INDEX, 'w', encoding='utf-8', newline='').write(out)
    print('[OK] focus-manage 已注入：%d → %d 字节（锚 QF 之前，保序）' % (before, len(out.encode('utf-8'))))

if __name__ == '__main__':
    main()
