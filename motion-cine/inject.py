#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
motion-cine 注入器 —— 真弹簧 + 速度模糊 + 滚动时间线（2026-10-11）

注入两块：
  CINE:CSS  -> motion-cine/cine.css
  CINE:JS   -> motion-cine/cine.js

技法来源：prompt-motion.com 全站 233 个案例的 prompt 全文（12.3 万字符）
提炼。核心三条：
  1. spring 出现 31 次 —— 真物理弹簧，不是 cubic-bezier 拟合
  2. "Blur follows speed and direction on every move." —— 速度感知模糊
  3. "the camera never cuts on a still frame" —— 状态切换必须带位移

⚠️ 铁律 A2（抢锚根治）：插到「第一个已存在的模块块之前」，不是闭合标签之前。
   候选表含 MT，因此无论谁先跑，本层恒定排最前，md5 必收敛。

⚠️ 铁律 F（2026-10-11 乱码事故）：CSS/JS 块必须自带 <style>/<script> 包裹。
   本层落点在 `</style>` 之后（裸 CSS 位置），不带包裹会被当正文渲染成乱码。

⚠️ 铁律 B（换行对称）：以 m.start() 为界插到锚点行之前，块自带首尾换行。

用法：
    python motion-cine/inject.py                # 注入默认 index.html
    python motion-cine/inject.py <目标文件>       # 注入指定文件（测试用）
    python motion-cine/inject.py --strip <文件>  # 剥离（测试用）
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_TARGET = os.path.join(ROOT, 'index.html')

CSS_ANCHOR = '</head>'
JS_ANCHOR = '</body>'

CSS_B = '<!-- CINE:CSS:BEGIN -->'
CSS_E = '<!-- CINE:CSS:END -->'
JS_B = '<!-- CINE:JS:BEGIN -->'
JS_E = '<!-- CINE:JS:END -->'

BANNER = ('<!-- motion-cine (2026-10-11) | 真弹簧 linear() + 速度模糊 + 滚动时间线 '
          '| 技法源自 prompt-motion.com 233 案例 | 改源文件后重跑本注入器 -->')


# --------------------------------------------------------------------------
# EOL / 换行工具（铁律 B）
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


# --------------------------------------------------------------------------
# 剥离（必须与插入严格互逆）
# --------------------------------------------------------------------------
def strip_block(html, b, e):
    """删块本身 + 其尾随换行，**不吃前导换行**。"""
    pat = re.compile(re.escape(b) + r'.*?' + re.escape(e) + r'[ \t]*\r?\n?',
                     re.S)
    out, n = pat.subn('', html)
    return out, n


def strip_all(html):
    total = 0
    for b, e in ((CSS_B, CSS_E), (JS_B, JS_E)):
        html, n = strip_block(html, b, e)
        total += n
    return html, total


# --------------------------------------------------------------------------
# 锚点选择 —— 铁律 A2
# --------------------------------------------------------------------------
# ⭐ 候选表里**必须包含 MT**，否则 motion-tune 重跑会插到本层之前，
#    改变块序 → md5 不收敛。这是 A2 铁律在多模块共存下的必要条件。
CSS_CANDIDATES = (
    'PB:CSS:BEGIN', 'FPS:CSS:BEGIN', 'MC:CSS:BEGIN', 'SE:CSS:BEGIN',
    'BFX:CSS:BEGIN', 'FM:CSS:BEGIN', 'MX:CSS:BEGIN', 'AF:CSS:BEGIN',
    'TG:CSS:BEGIN', 'IOS:CSS:BEGIN', 'MT:CSS:BEGIN',
)
JS_CANDIDATES = (
    'BFX:JS:BEGIN', 'MC:JS:BEGIN', 'PB:JS:BEGIN', 'FPS:JS:BEGIN',
    'SE:JS:BEGIN', 'AF:JS:BEGIN', 'FM:JS:BEGIN', 'MX:JS:BEGIN',
    'QF:JS:BEGIN', 'IOS:JS:BEGIN', 'MT:JS:BEGIN',
)


def pick_anchor(html, candidates, fallback):
    """返回「第一个已存在的模块块起点」；都没有则返回闭合标签。

    ⚠️ 返回值必须**连同前置换行一起让开**，否则会切坏原注释。
       各模块块标记常与上一行紧贴（`</style><!-- SE:CSS:BEGIN -->`），
       按标记文本定位插前面会残留 `<!-- ` 把原注释劈成两半（实测踩过）。
    """
    best = None
    for c in candidates:
        i = html.find(c)
        if i >= 0 and (best is None or i < best[0]):
            best = (i, c)
    if not best:
        return fallback, fallback + ' (无其它模块，回退)'
    i, c = best
    j = html.rfind('<!--', 0, i + 1)
    if j >= 0:
        i = j
    return _comment_head(html, i), c


def _comment_head(html, i):
    """返回 html[i] 处注释的完整头部字符串（含结尾 ' -->'）。"""
    end = html.find('-->', i)
    return html[i:end + 3] if end > 0 else html[i:i + 8]


# --------------------------------------------------------------------------
# 插入
# --------------------------------------------------------------------------
def _insert_before_anchor(html, anchor, block, eol):
    """把 block 插到 anchor 所在行**之前**（铁律 B：m.start() 为界）。"""
    i = html.find(anchor)
    if i < 0:
        raise ValueError('锚点未找到: %s' % anchor)
    return html[:i] + block + eol + html[i:]


def build_css_block(eol):
    """⭐ CSS 自带 <style> 包裹（铁律 F，乱码事故教训）。"""
    css = read(os.path.join(HERE, 'cine.css'))
    css = to_eol(css, eol).rstrip() + eol
    return ('%s%s%s%s<style id="motion-cine-style">%s%s%s</style>%s'
            % (CSS_B, eol, BANNER, eol, eol, css, eol, CSS_E))


def build_js_block(eol):
    """同理，JS 自带 <script> 包裹。"""
    js = read(os.path.join(HERE, 'cine.js'))
    js = to_eol(js, eol).rstrip() + eol
    return ('%s%s%s%s<script id="motion-cine-js">%s%s%s</script>%s'
            % (JS_B, eol, BANNER, eol, eol, js, eol, JS_E))


# --------------------------------------------------------------------------
# 特征守卫（MUST_KEEP）—— 防止注入被静默吞掉/半截注入
# --------------------------------------------------------------------------
MUST_KEEP = [
    # 真弹簧：linear() 必须是多控制点，且必须有 overshoot（>1 的点）
    ('真弹簧 --cine-spring', r'--cine-spring:\s*linear\('),
    ('真弹簧 --cine-snap', r'--cine-snap:\s*linear\('),
    ('真弹簧 --cine-rubber', r'--cine-rubber:\s*linear\('),
    ('真弹簧 --cine-calm', r'--cine-calm:\s*linear\('),
    ('临界阻尼 --cine-settle', r'--cine-settle:\s*linear\('),
    ('离场加速 --cine-exit', r'--cine-exit:\s*cubic-bezier\(\.55'),
    ('linear() 多点', r'linear\(\s*0,?\s*0\.0\d+,'),
    # 技法1 速度模糊
    ('技法1 .mc-speed', r'\.mc-speed\b'),
    ('技法1 .mc-moving', r'\.mc-moving\b'),
    ('技法1 --mc-blur', r'--mc-blur'),
    # 技法2 滚动时间线
    ('技法2 view() 时间线', r'animation-timeline:\s*view\(\)'),
    ('技法2 @supports 包裹', r'@supports \(animation-timeline: view\(\)\)'),
    ('技法2 不支持时兜底', r'@supports not \(animation-timeline: view\(\)\)'),
    ('技法2 animation-range', r'animation-range:\s*entry'),
    # 技法3 遮罩揭示
    ('技法3 clip-path 揭示', r'clip-path:\s*inset\(100% 0 0 0\)'),
    ('技法3 mc-mask-up', r'\.mc-mask-up\b'),
    ('技法3 mc-mask-wipe', r'\.mc-mask-wipe\b'),
    # 技法4 永不安静帧
    ('技法4 mc-page-in', r'\.mc-page-in\b'),
    ('技法4 带位移非纯淡入', r'translate3d\(0, 12px, 0\)'),
    # 技法5 错峰
    ('技法5 mc-stagger', r'\.mc-stagger'),
    ('技法5 错峰档位', r'--mc-stagger:\s*38ms'),
    ('技法5 nth-child 封顶', r'nth-child\(n\+9\)'),
    # 技法6 morph / 数字落定
    ('技法6 mc-num', r'\.mc-num\b'),
    ('技法6 mc-tick', r'\.mc-tick\b'),
    ('技法6 临界阻尼用于数字', r'mc-num-settle.*?--cine-settle'),
    # 技法7 拖影
    ('技法7 mc-trail', r'\.mc-trail\b'),
    # 守卫与降级
    ('守卫 html:not([data-fps-q])', r'html:not\(\[data-fps-q\]\)'),
    ('降档整块失效', r'html\[data-fps-q\].*?\.mc-par'),
    ('reduced-motion 降级', r'@media \(prefers-reduced-motion: reduce\)'),
    # ⭐ 铁律 D：兜底态绝不能是 opacity:0
    ('兜底态可见（铁律D）', r'@supports not \(animation-timeline: view\(\)\)'),
]

JS_MUST_KEEP = [
    ('幂等守卫', r'__motionCineInstalled'),
    ('API __motionCine', r'window\.__motionCine'),
    # 能力探测 + linear() 兜底
    ('探测 linearEase', r"linearEase = CSS\.supports\('transition-timing-function'"),
    ('探测 viewTimeline', r"viewTimeline = CSS\.supports\('animation-timeline', 'view\(\)'\)"),
    ('探测 waapi', r'waapi'),
    ('linear() 不支持时兜底', r'if \(!s\.linearEase\)'),
    ('兜底写 CSS 变量', r"setProperty\('--cine-spring'"),
    # 速度模糊
    ('blurFor 函数', r'function blurFor'),
    ('模糊封顶常量', r'var BLUR_MAX = 7'),
    ('阈值过滤', r'if \(dist < 8\) return'),
    ('写入 --mc-blur', r"setProperty\('--mc-blur'"),
    ('加 mc-moving', r"classList\.add\('mc-moving'\)"),
    # 页面入场
    ('markPageIn', r'function markPageIn'),
    ('强制重排', r'void main\.offsetWidth'),
    ('animationend 摘类', r"addEventListener\('animationend'"),
    # 数字 morph
    ('MutationObserver 数字', r"new MutationObserver"),
    ('只监听 characterData', r'characterData: true'),
    ('不监听 childList', r'childList: false'),
    # 视差打标
    ('tagParallax', r'function tagParallax'),
    ('viewTimeline 门禁', r'if \(REDUCED \|\| !state\.support\.viewTimeline\) return'),
    ('tagStagger', r'function tagStagger'),
    ('tagSpeed', r'function tagSpeed'),
    # 重打标防抖
    ('retag 防抖', r'state\.retagTimer = setTimeout'),
    # reduced motion
    ('REDUCED 判定', r'prefers-reduced-motion: reduce'),
    ('REDUCED 直接返回', r"if \(REDUCED\) return"),
    # API
    ('state()', r'state:\s*function'),
    ('retag()', r'retag:\s*function'),
    ('blurFor 暴露', r'blurFor: blurFor'),
    ('disable/enable', r'disable:\s*function'),
    ('enable()', r'enable:\s*function'),
    ('DOMContentLoaded', r"DOMContentLoaded"),
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
    """位置断言 —— 铁律 A 的核心防护（软断言，缺对方标记则跳过）。"""
    errs = []

    # 1. 块必须在，且各只出现一次
    for name, mk in (('CINE:CSS', CSS_B), ('CINE:CSS-E', CSS_E),
                     ('CINE:JS', JS_B), ('CINE:JS-E', JS_E)):
        c = html.count(mk)
        if c != 1:
            errs.append('%s 标记出现 %d 次（应为 1）' % (name, c))

    if errs:
        return errs

    cb, ce = html.index(CSS_B), html.index(CSS_E)
    jb, je = html.index(JS_B), html.index(JS_E)

    # 2. 块必须完整，位置必须在闭合标签之前
    if cb > ce:
        errs.append('CINE:CSS 块顺序颠倒')
    if jb > je:
        errs.append('CINE:JS 块顺序颠倒')
    if cb >= html.index(CSS_ANCHOR):
        errs.append('CINE:CSS 跑到了 </head> 之后')
    if jb >= html.index(JS_ANCHOR):
        errs.append('CINE:JS 跑到了 </body> 之后')
    if cb > jb:
        errs.append('CINE:CSS 跑到了 CINE:JS 之后')

    # 2b. ⚠️ 2026-10-11：这里原本断言「本层恒定排最前」，现已移除。
    #   原因：块序是**各层候选表协商出来的全局约定**，任何单层都无权要求
    #   「排最前」。随着 icon-flow / motion-depth 加入、MT 候选表被补齐，
    #   MT 排到了最前，本层这条断言立刻开始误报 —— 而它报告的是**预期行为**。
    #   本层真正能保证的是：① 块唯一完整  ② 不落进别人区间  ③ 重跑内容不变。

    # 3. ⭐ 铁律 A：不得落进任何其它模块的区间
    for other, beg, end in (('motion-tune', 'MT:CSS:BEGIN', 'MT:CSS:END'),
                             ('ios-fx', 'IOS:CSS:BEGIN', 'IOS:CSS:END'),
                             ('type-glass', 'TG:CSS:BEGIN', 'TG:CSS:END'),
                             ('apple-fx', 'AF:CSS:BEGIN', 'AF:CSS:END')):
        if beg in html and end in html:
            if html.index(beg) < cb < html.index(end):
                errs.append('CINE:CSS 落进了 %s 区间（会让它的 strip 吞掉本块）'
                            % other)
    for other, beg, end in (('motion-tune', 'MT:JS:BEGIN', 'MT:JS:END'),
                             ('ios-fx', 'IOS:JS:BEGIN', 'IOS:JS:END'),
                             ('quote-fallback', 'QF:JS:BEGIN', 'QF:JS:END'),
                             ('motion-fx', 'MX:JS:BEGIN', 'MX:JS:END')):
        if beg in html and end in html:
            if html.index(beg) < jb < html.index(end):
                errs.append('CINE:JS 落进了 %s 区间（会让它的 strip 吞掉本块）'
                            % other)

    # 4. ⭐⭐ 铁律 F：块内容必须被 <style>/<script> 包裹，否则浏览器当正文
    #    渲染成满屏乱码。这个坑真实踩过一次，必须硬断言。
    css_seg = html[cb:ce]
    js_seg = html[jb:je]
    if '<style id="motion-cine-style">' not in css_seg \
            or '</style>' not in css_seg:
        errs.append('CINE:CSS 未被 <style> 包裹 → 浏览器会当正文渲染成乱码')
    if '<script id="motion-cine-js">' not in js_seg \
            or '</script>' not in js_seg:
        errs.append('CINE:JS 未被 <script> 包裹 → 浏览器会当正文渲染成乱码')

    # 5. ⭐ 包裹必须闭合正确 —— 标签数量配平 ≠ 内容被正确包裹，
    #    但配平是配平的必要条件，先查一遍便宜的。
    if css_seg.count('<style') != 1 or css_seg.count('</style>') != 1:
        errs.append('CINE:CSS 内 <style> 标签数量异常')
    if js_seg.count('<script') != 1 or js_seg.count('</script>') != 1:
        errs.append('CINE:JS 内 <script> 标签数量异常')

    # 6. ⚠️ 铁律 D：任何兜底分支都不得让内容默认不可见
    if re.search(r'@supports not \(animation-timeline: view\(\)\)[^{]*\{[^}]*opacity:\s*0',
                 css_seg):
        errs.append('兜底分支出现 opacity:0 → 不支持时内容永久消失（铁律 D）')

    return errs


def _is_current(path):
    """判断目标文件里的 CINE 块是否与源文件**逐字节一致**。

    ⚠️⚠️ 这里必须比对内容，不能只跑 `_check()`。
       `_check()` 只验「特征是否存在」，改了曲线**数值**它照样全过 ——
       于是 `__main__` 会打印「已是最新，无需改动」并跳过重注入，
       源文件改了却没进主文件。
       症状极具欺骗性：测试全绿（因为测试重新注入后再验），
       只有真实页面用的是旧值。实测踩过一次。

       正解：把当前文件里的 CSS/JS 块，与「按当前 EOL 重新构造的块」逐字节比。
    """
    cur = read(path)
    if CSS_B not in cur or JS_B not in cur:
        return False
    try:
        eol = detect_eol(cur)
        if build_css_block(eol) not in cur:
            return False
        if build_js_block(eol) not in cur:
            return False
        # 块唯一性：防止历史上出现过重复块
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
        print('[motion-cine] 剥离旧块 x%d' % n)

    css_block = build_css_block(eol)
    js_block = build_js_block(eol)

    css_anchor, css_why = pick_anchor(base, CSS_CANDIDATES, CSS_ANCHOR)
    out = _insert_before_anchor(base, css_anchor, css_block, eol)

    js_anchor, js_why = pick_anchor(out, JS_CANDIDATES, JS_ANCHOR)
    out = _insert_before_anchor(out, js_anchor, js_block, eol)

    c_body = out[out.index(CSS_B):out.index(CSS_E)]
    j_body = out[out.index(JS_B):out.index(JS_E)]
    _check(c_body, MUST_KEEP, 'CINE:CSS')
    _check(j_body, JS_MUST_KEEP, 'CINE:JS')

    errs = verify(out)
    if errs:
        for e in errs:
            print('[motion-cine][位置错误] %s' % e)
        raise AssertionError('位置校验未通过，未写盘')

    write(path, out)
    print('[motion-cine] 注入完成 %s  +%d 字节  (EOL=%s)'
          % (os.path.basename(path), len(out) - len(html),
             'CRLF' if eol == '\r\n' else 'LF'))
    print('[motion-cine]   CSS 锚: %s' % css_why)
    print('[motion-cine]   JS  锚: %s' % js_why)
    return True


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    target = args[0] if args else DEFAULT_TARGET
    if '--strip' in sys.argv:
        cur = read(target)
        out, n = strip_all(cur)
        write(target, out)
        print('[motion-cine] 已剥离 %d 块 -> %s' % (n, target))
    else:
        # ⭐ 逐字节比对内容，不是「特征在不在」
        if _is_current(target):
            print('[motion-cine] 已是最新，无需改动  (%s)'
                  % os.path.basename(target))
            sys.exit(0)
        inject_once(target)
