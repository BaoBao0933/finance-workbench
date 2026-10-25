#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
home-iso 注入器 —— 主页 2.5D 小图标（2026-10-24）

注入两块：
  HI:CSS -> home-iso/hi.css
  HI:JS  -> home-iso/hi.js

⚠️ 铁律 A2：锚点只用 `</head>` / `</body>`（见 iso-figure 的 F2 事故：
   「第一个模块标记之前」会落进未闭合的 <style> 里，整层静默失效）。
⚠️ 铁律 F：CSS/JS 块自带 <style>/<script> 包裹。
⚠️ 铁律 B：以标记位置为界插到锚点行之前，块自带首尾换行；剥离吃自己的尾随换行。

用法：
    python banner-iso/inject.py                 # 注入默认 index.html
    python banner-iso/inject.py <目标文件>        # 注入指定文件（测试用）
    python banner-iso/inject.py --strip <文件>    # 剥离（测试用）
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_TARGET = os.path.join(ROOT, 'index.html')

CSS_ANCHOR = '</head>'
JS_ANCHOR = '</body>'

CSS_B = '<!-- HI:CSS:BEGIN -->'
CSS_E = '<!-- HI:CSS:END -->'
JS_B = '<!-- HI:JS:BEGIN -->'
JS_E = '<!-- HI:JS:END -->'

BANNER = ('<!-- home-iso (2026-10-24) | 主页 5 枚 2.5D 图标：三柱/托盘金币/上升楼梯/下降楼梯/立方体 '
          '| 点击逐个弹跳 + 跟随大盘情绪 | 改源文件后重跑本注入器 -->')


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------
def detect_eol(text):
    return '\r\n' if '\r\n' in text else '\n'


def to_eol(text, eol):
    return text.replace('\r\n', '\n').replace('\n', eol)


def read(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8')


def write(path, text):
    with open(path, 'wb') as f:
        f.write(text.encode('utf-8'))


def strip_block(html, b, e):
    """删块本身 + 其尾随换行，**不吃前导换行**（铁律 B）。"""
    pat = re.compile(re.escape(b) + r'.*?' + re.escape(e) + r'[ \t]*\r?\n?', re.S)
    out, n = pat.subn('', html)
    return out, n


def strip_all(html):
    total = 0
    for b, e in ((CSS_B, CSS_E), (JS_B, JS_E)):
        html, n = strip_block(html, b, e)
        total += n
    return html, total


def pick_anchor(html, fallback):
    """⭐ 只用闭合标签当锚点（铁律 F2：绝不按模块标记定位）。"""
    i = html.find(fallback)
    if i < 0:
        raise ValueError('锚点未找到: %s' % fallback)
    return i, fallback


def parse_check(html):
    """用 html.parser 验证本层的 style/script 真的是元素（而非被套进别人内部）。"""
    from html.parser import HTMLParser

    class P(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.in_head = False
            self.style_ids = []
            self.script_ids = []

        def handle_starttag(self, tag, attrs):
            a = dict(attrs)
            if tag == 'head':
                self.in_head = True
            if tag == 'style' and a.get('id') == 'home-iso-style':
                self.style_ids.append(self.in_head)
            if tag == 'script' and a.get('id') == 'home-iso-js':
                self.script_ids.append(True)

        def handle_endtag(self, tag):
            if tag == 'head':
                self.in_head = False

    p = P()
    p.feed(html)
    return p


def _parse_errs(html):
    errs = []
    p = parse_check(html)
    if len(p.style_ids) != 1:
        errs.append('解析后 <style id="home-iso-style"> 元素数=%d（应为 1）'
                    '→ 很可能被套进了别的 <style>（铁律 F 变体）' % len(p.style_ids))
    elif not p.style_ids[0]:
        errs.append('<style id="home-iso-style"> 不在 <head> 里')
    if len(p.script_ids) != 1:
        errs.append('解析后 <script id="home-iso-js"> 元素数=%d（应为 1）' % len(p.script_ids))
    return errs


def _insert_before_anchor(html, index, block, eol):
    return html[:index] + block + eol + html[index:]


# --------------------------------------------------------------------------
# 块构造
# --------------------------------------------------------------------------
def build_css_block(eol):
    css = read(os.path.join(HERE, 'hi.css'))
    css = to_eol(css, eol).rstrip() + eol
    return ('%s%s%s%s<style id="home-iso-style">%s%s%s</style>%s'
            % (CSS_B, eol, BANNER, eol, eol, css, eol, CSS_E))


def build_js_block(eol):
    js = read(os.path.join(HERE, 'hi.js'))
    js = to_eol(js, eol).rstrip() + eol
    return ('%s%s%s%s<script id="home-iso-js">%s%s%s</script>%s'
            % (JS_B, eol, BANNER, eol, eol, js, eol, JS_E))


# --------------------------------------------------------------------------
# 特征守卫
# --------------------------------------------------------------------------
MUST_KEEP = [
    ('等距图标尺寸', r'\.hi-iso'),
    ('弹跳单元', r'\.hi-u'),
    ('单元变换盒', r'transform-box: fill-box'),
    ('hover 微抬', r'\.ov-icon:has\(\.hi-iso\):hover'),
    ('按下回弹', r'\.ov-icon:has\(\.hi-iso\):active'),
    ('涨情绪', r'\.hi-happy'),
    ('跌情绪', r'\.hi-shy'),
    ('标题浮沉', r'hi-bob'),
    ('低帧率档降级', r'html\[data-fps-q="low"\] \.m-ico:has'),
    ('reduced-motion 降级', r'prefers-reduced-motion: reduce'),
]

JS_MUST_KEEP = [
    ('幂等守卫', r'__hiInstalled'),
    ('五枚图标', r"keys: Object\.keys\(ICONS\)"),
    ('弹簧常量', r'K_SPRING = 150, D_SPRING = 8\.5'),
    ('240Hz 子步', r'Math\.ceil\(dt \* 240\)'),
    ('逐个冲量', r'u\.v \+= u\.kick \* u\.amp \* GAIN'),
    ('路径流动引擎', r'function makeNorth'),
    ('路径起点', r'data-from="'),
    ('新币插入锚点', r'data-kerb="1"'),
    ('越积越多', r'maxPile'),
    ('斗满漏出', r'drainList'),
    ('补投新币', r'function spawn'),
    ('料斗下沉', r'data-dip="1"'),
    ('滚动压缩', r'data-roll="0\.36"'),
    ('重力下坠', r'u2 \* u2'),
    ('滚动内层', r'\.hi-roll'),
    ('弹跳步序', r"getAttribute\('data-step'\)"),
    ('单循环', r'function makeHopper'),
    ('事件委托', r"fireFrom\(e\.target\)"),
    ('按文案识别', r'function pickKey'),
    ('挂载卡片', r'function mountCards'),
    ('挂载标题', r'function mountModule'),
    ('标题批量挂载', r'mountTitles'),
    ('情绪监听', r"attributeFilter: \['class'\]"),
    ('情绪应用', r'function applyMood'),
    ('兜底补挂', r'12'),
]




def _check(text, rules, tag):
    missing = []
    for name, pat in rules:
        if not re.search(pat, text, re.S):
            missing.append(name)
    if missing:
        raise AssertionError('[%s] 特征缺失 %d 项: %s'
                             % (tag, len(missing), ', '.join(missing)))


def verify(html):
    """位置断言（铁律 A / F 的防护）。"""
    errs = []

    for name, mk in (('HI:CSS', CSS_B), ('HI:CSS-E', CSS_E),
                     ('HI:JS', JS_B), ('HI:JS-E', JS_E)):
        c = html.count(mk)
        if c != 1:
            errs.append('%s 标记出现 %d 次（应为 1）' % (name, c))
    if errs:
        return errs

    cb, ce = html.index(CSS_B), html.index(CSS_E)
    jb, je = html.index(JS_B), html.index(JS_E)

    if cb > ce:
        errs.append('HI:CSS 块顺序颠倒')
    if jb > je:
        errs.append('HI:JS 块顺序颠倒')
    if cb >= html.index(CSS_ANCHOR):
        errs.append('HI:CSS 跑到了 </head> 之后')
    if jb >= html.index(JS_ANCHOR):
        errs.append('HI:JS 跑到了 </body> 之后')
    if cb > jb:
        errs.append('HI:CSS 跑到了 HI:JS 之后')

    for other, beg, end in (('motion-tune', 'MT:CSS:BEGIN', 'MT:CSS:END'),
                            ('ios-fx', 'IOS:CSS:BEGIN', 'IOS:CSS:END'),
                            ('type-glass', 'TG:CSS:BEGIN', 'TG:CSS:END'),
                            ('apple-fx', 'AF:CSS:BEGIN', 'AF:CSS:END'),
                            ('glass-pro', 'GP:CSS:BEGIN', 'GP:CSS:END'),
                            ('banner-iso', 'HI:CSS:BEGIN', 'IF:CSS:END')):
        if beg in html and end in html:
            if html.index(beg) < cb < html.index(end):
                errs.append('HI:CSS 落进了 %s 区间' % other)
    for other, beg, end in (('motion-tune', 'MT:JS:BEGIN', 'MT:JS:END'),
                            ('ios-fx', 'IOS:JS:BEGIN', 'IOS:JS:END'),
                            ('quote-fallback', 'QF:JS:BEGIN', 'QF:JS:END'),
                            ('motion-fx', 'MX:JS:BEGIN', 'MX:JS:END'),
                            ('iso-figure', 'IF:JS:BEGIN', 'IF:JS:END')):
        if beg in html and end in html:
            if html.index(beg) < jb < html.index(end):
                errs.append('HI:JS 落进了 %s 区间' % other)

    css_seg = html[cb:ce]
    js_seg = html[jb:je]
    if '<style id="home-iso-style">' not in css_seg or '</style>' not in css_seg:
        errs.append('HI:CSS 未被 <style> 包裹 → 会被当正文渲染成乱码')
    if '<script id="home-iso-js">' not in js_seg or '</script>' not in js_seg:
        errs.append('HI:JS 未被 <script> 包裹 → 会被当正文渲染成乱码')
    if css_seg.count('<style') != 1 or css_seg.count('</style>') != 1:
        errs.append('HI:CSS 内 <style> 标签数量异常')
    if js_seg.count('<script') != 1 or js_seg.count('</script>') != 1:
        errs.append('HI:JS 内 <script> 标签数量异常')

    return errs


def _is_current(path):
    cur = read(path)
    if CSS_B not in cur or JS_B not in cur:
        return False
    try:
        eol = detect_eol(cur)
        if build_css_block(eol) not in cur:
            return False
        if build_js_block(eol) not in cur:
            return False
        if cur.count(CSS_B) != 1 or cur.count(JS_B) != 1:
            return False
        return not verify(cur)
    except (AssertionError, ValueError, IndexError):
        return False


def inject_once(path):
    html = read(path)
    eol = detect_eol(html)

    base, n = strip_all(html)
    if n:
        print('[home-iso] 剥离旧块 x%d' % n)

    css_anchor, css_why = pick_anchor(base, CSS_ANCHOR)
    out = _insert_before_anchor(base, css_anchor, build_css_block(eol), eol)

    js_anchor, js_why = pick_anchor(out, JS_ANCHOR)
    out = _insert_before_anchor(out, js_anchor, build_js_block(eol), eol)

    _check(out[out.index(CSS_B):out.index(CSS_E)], MUST_KEEP, 'HI:CSS')
    _check(out[out.index(JS_B):out.index(JS_E)], JS_MUST_KEEP, 'HI:JS')

    errs = verify(out)
    errs += _parse_errs(out)
    if errs:
        for e in errs:
            print('[home-iso][位置错误] %s' % e)
        raise AssertionError('位置校验未通过，未写盘')

    write(path, out)
    print('[home-iso] 注入完成 %s  +%d 字节  (EOL=%s)'
          % (os.path.basename(path), len(out) - len(html),
             'CRLF' if eol == '\r\n' else 'LF'))
    print('[home-iso]   CSS 锚: %s' % css_why)
    print('[home-iso]   JS  锚: %s' % js_why)
    return True


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    target = args[0] if args else DEFAULT_TARGET
    if '--strip' in sys.argv:
        cur = read(target)
        out, n = strip_all(cur)
        write(target, out)
        print('[home-iso] 已剥离 %d 块 -> %s' % (n, target))
    else:
        if _is_current(target):
            print('[home-iso] 已是最新，无需改动  (%s)' % os.path.basename(target))
            sys.exit(0)
        inject_once(target)
