#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
user-tune 注入器 —— 用户自定义：热点精选板块管理 + 头像替换（2026-10-24）

注入两块：
  UT:CSS -> user-tune/ut.css
  UT:JS  -> user-tune/ut.js

⚠️ 铁律 A2：锚点只用 `</head>` / `</body>`（见 iso-figure 的 F2 事故：
   「第一个模块标记之前」会落进未闭合的 <style> 里，整层静默失效）。
⚠️ 铁律 F：CSS/JS 块自带 <style>/<script> 包裹。
⚠️ 铁律 B：以标记位置为界插到锚点行之前，块自带首尾换行；剥离吃自己的尾随换行。

用法：
    python user-tune/inject.py                 # 注入默认 index.html
    python user-tune/inject.py <目标文件>        # 注入指定文件（测试用）
    python user-tune/inject.py --strip <文件>    # 剥离（测试用）
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_TARGET = os.path.join(ROOT, 'index.html')

CSS_ANCHOR = '</head>'
JS_ANCHOR = '</body>'

CSS_B = '<!-- UT:CSS:BEGIN -->'
CSS_E = '<!-- UT:CSS:END -->'
JS_B = '<!-- UT:JS:BEGIN -->'
JS_E = '<!-- UT:JS:END -->'

BANNER = ('<!-- user-tune (2026-10-24) | 热点精选板块管理 + 左上角头像替换 '
          '| 只写 localStorage，不动行情数据 | 改源文件后重跑本注入器 -->')


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
            if tag == 'style' and a.get('id') == 'user-tune-style':
                self.style_ids.append(self.in_head)
            if tag == 'script' and a.get('id') == 'user-tune-js':
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
        errs.append('解析后 <style id="user-tune-style"> 元素数=%d（应为 1）'
                    '→ 很可能被套进了别的 <style>（铁律 F 变体）' % len(p.style_ids))
    elif not p.style_ids[0]:
        errs.append('<style id="user-tune-style"> 不在 <head> 里')
    if len(p.script_ids) != 1:
        errs.append('解析后 <script id="user-tune-js"> 元素数=%d（应为 1）' % len(p.script_ids))
    return errs


def _insert_before_anchor(html, index, block, eol):
    return html[:index] + block + eol + html[index:]


# --------------------------------------------------------------------------
# 块构造
# --------------------------------------------------------------------------
def build_css_block(eol):
    css = read(os.path.join(HERE, 'ut.css'))
    css = to_eol(css, eol).rstrip() + eol
    return ('%s%s%s%s<style id="user-tune-style">%s%s%s</style>%s'
            % (CSS_B, eol, BANNER, eol, eol, css, eol, CSS_E))


def build_js_block(eol):
    js = ''
    pool = os.path.join(HERE, 'pool.js')
    if os.path.exists(pool):
        js += read(pool) + '\n'
    js += read(os.path.join(HERE, 'ut.js'))
    js = to_eol(js, eol).rstrip() + eol
    return ('%s%s%s%s<script id="user-tune-js">%s%s%s</script>%s'
            % (JS_B, eol, BANNER, eol, eol, js, eol, JS_E))


# --------------------------------------------------------------------------
# 特征守卫
# --------------------------------------------------------------------------
MUST_KEEP = [
    ('管理按钮', r'\.ut-manage'),
    ('自定义面板', r'\.ut-panel'),
    ('已选胶囊', r'\.ut-chip'),
    ('候选行', r'\.ut-row'),
    ('头像按钮', r'\.ut-avatar-btn'),
    ('自定义头像滤镜', r'\.logo-dog\.ut-custom'),
    ('toast', r'\.ut-toast'),
]

JS_MUST_KEEP = [
    ('内置字典', r'__secPool'),
    ('幂等守卫', r'__utInstalled'),
    ('热点桥接', r'__secHotAPI'),
    ('管理按钮挂载', r'function ensureManageBtn'),
    ('面板开合', r'function openPanel'),
    ('已选渲染', r'function renderCur'),
    ('候选渲染', r'function renderPool'),
    ('防抖保存', r'function queueSave'),
    ('统一添加', r'function addSector'),
    ('只认 BK 代码', r'\^BK\\d\+\$'),
    ('头像初始化', r'function initAvatar'),
    ('居中裁方', r'function shrinkSquare'),
    ('本地存储', r'localStorage\.setItem\(LS_AVATAR'),
    ('恢复默认', r'function resetAvatar'),
    ('首屏补挂', r'\[300, 800, 1600, 3000\]'),
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

    for name, mk in (('UT:CSS', CSS_B), ('UT:CSS-E', CSS_E),
                     ('UT:JS', JS_B), ('UT:JS-E', JS_E)):
        c = html.count(mk)
        if c != 1:
            errs.append('%s 标记出现 %d 次（应为 1）' % (name, c))
    if errs:
        return errs

    cb, ce = html.index(CSS_B), html.index(CSS_E)
    jb, je = html.index(JS_B), html.index(JS_E)

    if cb > ce:
        errs.append('UT:CSS 块顺序颠倒')
    if jb > je:
        errs.append('UT:JS 块顺序颠倒')
    if cb >= html.index(CSS_ANCHOR):
        errs.append('UT:CSS 跑到了 </head> 之后')
    if jb >= html.index(JS_ANCHOR):
        errs.append('UT:JS 跑到了 </body> 之后')
    if cb > jb:
        errs.append('UT:CSS 跑到了 UT:JS 之后')

    for other, beg, end in (('motion-tune', 'MT:CSS:BEGIN', 'MT:CSS:END'),
                            ('ios-fx', 'IOS:CSS:BEGIN', 'IOS:CSS:END'),
                            ('type-glass', 'TG:CSS:BEGIN', 'TG:CSS:END'),
                            ('apple-fx', 'AF:CSS:BEGIN', 'AF:CSS:END'),
                            ('glass-pro', 'GP:CSS:BEGIN', 'GP:CSS:END'),
                            ('user-tune', 'UT:CSS:BEGIN', 'IF:CSS:END')):
        if beg in html and end in html:
            if html.index(beg) < cb < html.index(end):
                errs.append('UT:CSS 落进了 %s 区间' % other)
    for other, beg, end in (('motion-tune', 'MT:JS:BEGIN', 'MT:JS:END'),
                            ('ios-fx', 'IOS:JS:BEGIN', 'IOS:JS:END'),
                            ('quote-fallback', 'QF:JS:BEGIN', 'QF:JS:END'),
                            ('motion-fx', 'MX:JS:BEGIN', 'MX:JS:END'),
                            ('iso-figure', 'IF:JS:BEGIN', 'IF:JS:END')):
        if beg in html and end in html:
            if html.index(beg) < jb < html.index(end):
                errs.append('UT:JS 落进了 %s 区间' % other)

    css_seg = html[cb:ce]
    js_seg = html[jb:je]
    if '<style id="user-tune-style">' not in css_seg or '</style>' not in css_seg:
        errs.append('UT:CSS 未被 <style> 包裹 → 会被当正文渲染成乱码')
    if '<script id="user-tune-js">' not in js_seg or '</script>' not in js_seg:
        errs.append('UT:JS 未被 <script> 包裹 → 会被当正文渲染成乱码')
    if css_seg.count('<style') != 1 or css_seg.count('</style>') != 1:
        errs.append('UT:CSS 内 <style> 标签数量异常')
    if js_seg.count('<script') != 1 or js_seg.count('</script>') != 1:
        errs.append('UT:JS 内 <script> 标签数量异常')

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
        print('[user-tune] 剥离旧块 x%d' % n)

    css_anchor, css_why = pick_anchor(base, CSS_ANCHOR)
    out = _insert_before_anchor(base, css_anchor, build_css_block(eol), eol)

    js_anchor, js_why = pick_anchor(out, JS_ANCHOR)
    out = _insert_before_anchor(out, js_anchor, build_js_block(eol), eol)

    _check(out[out.index(CSS_B):out.index(CSS_E)], MUST_KEEP, 'UT:CSS')
    _check(out[out.index(JS_B):out.index(JS_E)], JS_MUST_KEEP, 'UT:JS')

    errs = verify(out)
    errs += _parse_errs(out)
    if errs:
        for e in errs:
            print('[user-tune][位置错误] %s' % e)
        raise AssertionError('位置校验未通过，未写盘')

    write(path, out)
    print('[user-tune] 注入完成 %s  +%d 字节  (EOL=%s)'
          % (os.path.basename(path), len(out) - len(html),
             'CRLF' if eol == '\r\n' else 'LF'))
    print('[user-tune]   CSS 锚: %s' % css_why)
    print('[user-tune]   JS  锚: %s' % js_why)
    return True


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    target = args[0] if args else DEFAULT_TARGET
    if '--strip' in sys.argv:
        cur = read(target)
        out, n = strip_all(cur)
        write(target, out)
        print('[user-tune] 已剥离 %d 块 -> %s' % (n, target))
    else:
        if _is_current(target):
            print('[user-tune] 已是最新，无需改动  (%s)' % os.path.basename(target))
            sys.exit(0)
        inject_once(target)
