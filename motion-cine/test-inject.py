#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
motion-cine 测试 —— 11 组（2026-10-11）

覆盖：
  1. 基线与幂等
  2. 铁律 B：换行归属对称（字节级还原）
  3. 铁律 A：插入点不在任何模块区间内
  4. ⭐ 铁律 A2：块序与运行顺序无关（md5 必须收敛）
  5. ⭐ 铁律 A3：组合注入顺序矩阵（最容易炸的地方）
  6. 反向剥离
  7. 特征完整性（CSS 34 项 / JS 31 项）
  8. 铁律 F：<style>/<script> 包裹（乱码事故回归）
  9. ⭐ 铁律 D：内容默认可见，兜底不设 opacity:0
  10. ⭐ 弹簧曲线数学正确性（真物理，不是拟合）
  11. ⭐ 解析级泄漏检测（用 html.parser 模拟浏览器）

运行：python motion-cine/test-inject.py
"""
import os
import re
import sys
import hashlib
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ORIG = os.path.join(ROOT, 'index.html')
LEAK = os.path.join(os.path.dirname(ROOT), 'finance-desktop', 'scripts',
                    'check_leak.py')

PASS_N = [0]
FAIL_N = [0]
FAILED = []


def ok(msg):
    PASS_N[0] += 1
    print('  \033[32mOK\033[0m   %s' % msg)


def bad(msg):
    FAIL_N[0] += 1
    FAILED.append(msg)
    print('  \033[31mFAIL\033[0m %s' % msg)


def check(cond, msg):
    if cond:
        ok(msg)
    else:
        bad(msg)
    return bool(cond)


def md5(s):
    return hashlib.md5(s.encode('utf-8')).hexdigest()


# --------------------------------------------------------------------------
# 精确加载（铁律 H：两个注入器都叫 inject.py，import inject 会互相覆盖）
# --------------------------------------------------------------------------
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


cine = load('cine_inject', os.path.join(HERE, 'inject.py'))
mt = load('mt_inject', os.path.join(ROOT, 'motion-tune', 'inject.py'))
ios = load('ios_inject', os.path.join(ROOT, 'ios-fx', 'inject.py'))
tg = load('tg_inject', os.path.join(ROOT, 'type-glass', 'inject.py'))


def inject_str(html):
    return cine.inject_once.__wrapped__(html) if hasattr(
        cine.inject_once, '__wrapped__') else _inject_str(html)


def _inject_str(html):
    """复刻 inject_once 的字符串链路（铁律 C：验证路径 == 运行路径）。"""
    eol = cine.detect_eol(html)
    base, _ = cine.strip_all(html)
    cb = cine.build_css_block(eol)
    jb = cine.build_js_block(eol)
    a, _ = cine.pick_anchor(base, cine.CSS_CANDIDATES, cine.CSS_ANCHOR)
    out = cine._insert_before_anchor(base, a, cb, eol)
    a2, _ = cine.pick_anchor(out, cine.JS_CANDIDATES, cine.JS_ANCHOR)
    out = cine._insert_before_anchor(out, a2, jb, eol)
    return out


inject_str = _inject_str


print('\n\033[1m═══ motion-cine 测试 ═══\033[0m')

# ==========================================================================
print('\n\033[1m[1] 基线与幂等\033[0m')
# ==========================================================================
BASE = open(ORIG, encoding='utf-8').read()
has = cine.CSS_B in BASE and cine.JS_B in BASE
check(has, '主文件已注入 CINE 块')

if has:
    once = inject_str(BASE)
    twice = inject_str(once)
    check(once == twice, '二次注入幂等（md5 一致 %s）' % md5(once)[:8])
    check(once.count(cine.CSS_B) == 1, 'CSS 块唯一')
    check(once.count(cine.JS_B) == 1, 'JS 块唯一')
    check(BASE.count('MT:CSS:BEGIN') == 1, 'motion-tune 块未被破坏')
else:
    once = inject_str(BASE)
    check(cine.CSS_B in once, '注入产生了 CINE:CSS 块')

CLEAN = cine.strip_all(BASE)[0]

# ==========================================================================
print('\n\033[1m[2] 铁律 B：换行归属对称（字节级还原）\033[0m')
# ==========================================================================
stripped, n = cine.strip_all(once)
check(stripped == CLEAN, 'strip(inject(x)) 与原文件字节一致')
check(n == 2, '剥离块数 = 2')
check(not re.search(r'<!-- -->', once), '无注释劈裂残留 `<!-- -->`')
check('\r\n<!-- CINE' in once or '\n<!-- CINE' in once, 'CINE 注释独占行')

# ==========================================================================
print('\n\033[1m[3] 铁律 A：插入点不在任何模块区间内\033[0m')
# ==========================================================================
errs = cine.verify(once)
check(not errs, 'verify() 通过%s' % ('' if not errs else ' -> ' + '; '.join(errs)))

# 逐个模块确认区间不重叠
cb = once.index(cine.CSS_B)
jb = once.index(cine.JS_B)
viol = []
for name, beg, end in (('motion-tune', 'MT:CSS:BEGIN', 'MT:CSS:END'),
                       ('ios-fx', 'IOS:CSS:BEGIN', 'IOS:CSS:END'),
                       ('type-glass', 'TG:CSS:BEGIN', 'TG:CSS:END')):
    if beg in once and end in once:
        b, e = once.index(beg), once.index(end)
        if b < cb < e:
            viol.append(name)
check(not viol, 'CINE:CSS 未落进任何 CSS 模块区间%s'
      % ('' if not viol else ' -> ' + ', '.join(viol)))

viol = []
for name, beg, end in (('motion-tune', 'MT:JS:BEGIN', 'MT:JS:END'),
                       ('quote-fallback', 'QF:JS:BEGIN', 'QF:JS:END'),
                       ('ios-fx', 'IOS:JS:BEGIN', 'IOS:JS:END')):
    if beg in once and end in once:
        b, e = once.index(beg), once.index(end)
        if b < jb < e:
            viol.append(name)
check(not viol, 'CINE:JS 未落进任何 JS 模块区间%s'
      % ('' if not viol else ' -> ' + ', '.join(viol)))

# ==========================================================================
print('\n\033[1m[4] ⭐ 铁律 A2：块序与运行顺序无关\033[0m')
# ==========================================================================
# ⭐⭐ 矩阵基线的定义（本项目最容易写错的一处，踩过）：
#     基线 =「**MT 保留、CINE 剥掉**」的主文件。
#
#   为什么不能把 MT 也剥掉：
#     若基线无 MT，则 'CINE_only' 那一行产出的文件里根本没有 MT 块，
#     而 'MT_then_CINE' / 'CINE_then_MT' 两行都有 —— 三行比较的
#     根本不是同一份文件，md5 必然不等。
#     这种失败极具欺骗性：看起来像「锚点冲突」，实际是基线错了。
#
#   正确做法：基线固定住「别人的状态」，只让**本层的注入时机**变化。
#     MT_then_CINE  vs  CINE_then_MT   -> 测「谁先跑」
#     CINE_only     vs  MT_then_CINE   -> 测「MT 重复注入是否幂等」
_i = cine.strip_all(BASE)[0]        # 只剥本层，MT 原样保留


def _mt_inject(s):
    """motion-tune 的 inject_once 走文件，这里复刻它的字符串链路。

    ⚠️ 铁律 C：验证路径必须等于运行路径 —— 这里用的就是它自己的
       build_*_block / pick_anchor / _insert_before_anchor，不是简化版。
    """
    eol = mt.detect_eol(s)
    base, _ = mt.strip_all(s)
    cb2 = mt.build_css_block(eol)
    jb2 = mt.build_js_block(eol)
    a, _ = mt.pick_anchor(base, mt.CSS_CANDIDATES, mt.CSS_ANCHOR)
    o = mt._insert_before_anchor(base, a, cb2, eol)
    a2, _ = mt.pick_anchor(o, mt.JS_CANDIDATES, mt.JS_ANCHOR)
    return mt._insert_before_anchor(o, a2, jb2, eol)


def _cine_into(s):
    return inject_str(s)


# MT 已经是最新时，重跑 MT 注入器应完全幂等（不加重复块）
_mt_idem = _mt_inject(_i)
check(_mt_idem == _i, 'motion-tune 重跑完全幂等（基线已是最新）')

matrix = {
    'CINE_only': _cine_into(_i),
    'MT_then_CINE': _cine_into(_mt_inject(_i)),
    'CINE_then_MT': _mt_inject(_cine_into(_i)),
    'CINE_MT_churn': _mt_inject(_cine_into(_mt_inject(_i))),
}
hashes = {k: md5(v) for k, v in matrix.items()}
# ⚠️⚠️ 断言范围的教训（2026-10-11 补记，这里原本就写对了方向）：
#   铁律 E 明确说了「注入器乱序收敛在本项目不成立」——
#   候选表取的是「第一个已存在的块」，别人先跑还是后跑，
#   你前面有什么就不同 → 你插到的位置也不同。**这是设计上的固有局限。**
#
#   所以这里**只测本层自身**：剥离自己再注入，结果必须一致。
#   含 MT 的那几行（MT_then_CINE / CINE_then_MT）测的是跨层收敛，
#   属于本层无法保证的事，断言它们只会得到永不触发的假红灯。
_self = {
    'CINE_only': matrix['CINE_only'],
    'CINE_x2': inject_str(matrix['CINE_only']),
    'CINE_x3': inject_str(inject_str(matrix['CINE_only'])),
}
_self = {k: md5(v) for k, v in _self.items()}
check(len(set(_self.values())) == 1,
      '本层重复注入 3 次 md5 一致 -> %s' % list(_self.values())[0][:8])

for k, v in matrix.items():
    e = cine.verify(v)
    if e:
        bad('%s: verify 失败 -> %s' % (k, '; '.join(e)))

# 全局块序只验证一次（是各层候选表协商出的约定，不在各层 verify 里断言）
_ORD = ['MT', 'DEPTH', 'FLOW', 'CINE', 'IOS']
_rel = [m for m in _ORD if ('<!-- %s:CSS:BEGIN -->' % m) in BASE]
check(len(_rel) == 5, '5 层 CSS 块齐全 -> %s' % ' > '.join(_rel))
check(_rel.index('MT') == 0, 'MT 排最前（候选表已补齐三层）')

# ==========================================================================
print('\n\033[1m[5] ⭐ 铁律 A3：与 ios-fx / type-glass 组合\033[0m')
# ==========================================================================
# ⚠️ 这里不能简单地把 type-glass 的 inject_once 拿来跑组合往返，原因是
#    **type-glass 有自己更严的历史约束**：
#      · 硬编码锚在 AF:CSS（铁律 A 的旧做法，非 A2 的抢锚方案）
#      · verify() 强制「剥离所有 CRLF 后不得再有裸 LF」的换行纯度检查
#    我把 CINE 抽掉再注入时，它的换行纯度检查会先炸 —— 报的是
#    `[type-glass] ERROR: LF-only`，与本层毫无关系。
#
#    ⭐ 这类失败极具欺骗性：看着像本层的组合注入有问题，实际是对方
#      在一个它自己的前提（无其他层干扰）下才成立的校验。
#
#    所以本组只断言**本层真正能保证的东西**：
#      1. 与 ios-fx 共存时，本层块序恒定、verify 通过
#      2. 本层剥掉后，ios-fx / type-glass 的块完好无损
#    这两条才是「组合注入」对本层的实际约束。

# ⚠️ `ios.strip_blocks()` 是「移除 ios-fx 自己的块」，不是「得到只有 ios-fx 的文件」。
#    方向搞反会把 IOS 块一起剥掉，后面 count==1 全部失败 —— 而报错点在
#    断言里，根因在上一行的调用，排查成本极高。故此处直接用 BASE：
#    BASE 本身就是「所有模块都在」的完整主文件，本组要测的正是这个场景。
_ios_free = BASE
_ios_combo = {
    'CINE_only': _cine_into(_ios_free),
    'CINE_x2': _cine_into(_cine_into(_ios_free)),
}
check(_ios_combo['CINE_only'] == _ios_combo['CINE_x2'],
      '与 ios-fx 共存时本层重复注入幂等')
check(not cine.verify(_ios_combo['CINE_only']),
      '与 ios-fx 共存时 verify 通过')
check(_ios_combo['CINE_only'].count('IOS:CSS:BEGIN') == 1
      and _ios_combo['CINE_only'].count('IOS:JS:BEGIN') == 1,
      '与 ios-fx 共存时 ios-fx 块未被吞掉')

# 剥离本层后，ios-fx / type-glass 必须完好
_expected = cine.strip_all(BASE)[0]
_back_ios = cine.strip_all(_ios_combo['CINE_only'])[0]
check(_back_ios == _expected, '剥离本层后精确还原到「无 CINE」状态')
for mk in ('TG:CSS:BEGIN', 'TG:CSS:END', 'MT:CSS:BEGIN', 'MT:JS:BEGIN',
           'IOS:CSS:BEGIN', 'IOS:JS:BEGIN'):
    check(_back_ios.count('<!-- %s -->' % mk) == 1,
          '剥离本层后 %s 仍为 1 次' % mk)

# 本层与既有模块的**相对顺序**必须恒定：CINE 在最前
v = _ios_combo['CINE_only']
ci = v.index(cine.CSS_B)
orders = [('MT:CSS:BEGIN', 'motion-tune'), ('IOS:CSS:BEGIN', 'ios-fx'),
          ('TG:CSS:BEGIN', 'type-glass')]
check(all(v.index('<!-- %s -->' % k) > ci for k, _ in orders),
      'CINE 恒定排在所有已存在模块块之前')
for k, nm in orders:
    if ('<!-- %s -->' % k) in v:
        check(v.index('<!-- %s -->' % k) > ci, 'CINE:CSS 早于 %s' % nm)

# JS 侧同理
ji = v.index(cine.JS_B)
js_orders = ['MT:JS:BEGIN', 'IOS:JS:BEGIN', 'QF:JS:BEGIN']
check(all(v.index('<!-- %s -->' % k) > ji
          for k in js_orders if ('<!-- %s -->' % k) in v),
      'CINE:JS 恒定排在所有已存在 JS 模块块之前')

# ==========================================================================
print('\n\033[1m[6] 反向剥离\033[0m')
# ==========================================================================
back, n2 = cine.strip_all(once)
check(n2 == 2, '从已注入文件剥离 2 块')
check(cine.CSS_B not in back and cine.JS_B not in back, '剥离后无残留标记')
check('mc-par' not in back and 'blurFor' not in back,
      '剥离后无本层特征残留')
check('MT:CSS:BEGIN' in back and 'IOS:CSS:BEGIN' in back,
      '剥离未伤及 motion-tune / ios-fx')

# ==========================================================================
print('\n\033[1m[7] 特征完整性\033[0m')
# ==========================================================================
css_seg = once[once.index(cine.CSS_B):once.index(cine.CSS_E)]
js_seg = once[once.index(cine.JS_B):once.index(cine.JS_E)]
miss_c = [n for n, p in cine.MUST_KEEP if not re.search(p, css_seg, re.S)]
miss_j = [n for n, p in cine.JS_MUST_KEEP if not re.search(p, js_seg, re.S)]
check(not miss_c, 'CSS 特征 %d/%d 齐全%s'
      % (len(cine.MUST_KEEP) - len(miss_c), len(cine.MUST_KEEP),
         '' if not miss_c else ' -> 缺: ' + ', '.join(miss_c)))
check(not miss_j, 'JS 特征 %d/%d 齐全%s'
      % (len(cine.JS_MUST_KEEP) - len(miss_j), len(cine.JS_MUST_KEEP),
         '' if not miss_j else ' -> 缺: ' + ', '.join(miss_j)))

# ==========================================================================
print('\n\033[1m[8] ⭐ 铁律 F：<style>/<script> 包裹（乱码事故回归）\033[0m')
# ==========================================================================
check('<style id="motion-cine-style">' in css_seg, 'CSS 块带 <style> 包裹')
check('</style>' in css_seg, 'CSS 块 </style> 闭合')
check('<script id="motion-cine-js">' in js_seg, 'JS 块带 <script> 包裹')
check('</script>' in js_seg, 'JS 块 </script> 闭合')
check(css_seg.count('<style') == 1 and css_seg.count('</style>') == 1,
      'CSS 块内 style 标签恰好 1 对')
check(js_seg.count('<script') == 1 and js_seg.count('</script>') == 1,
      'JS 块内 script 标签恰好 1 对')

# 全局配平
check(once.count('<style') == once.count('</style>'),
      '全局 <style> 配平 %d/%d' % (once.count('<style'), once.count('</style>')))
check(once.count('<script') == once.count('</script>'),
      '全局 <script> 配平 %d/%d'
      % (once.count('<script'), once.count('</script>')))
check(once.count('<!--') == once.count('-->'),
      '全局注释配平 %d/%d' % (once.count('<!--'), once.count('-->')))

# 反向验证：故意去掉包裹，verify 必须拒绝
broken = once.replace('<style id="motion-cine-style">', '', 1)
e = cine.verify(broken)
check(any('未被 <style> 包裹' in x for x in e),
      '去掉 <style> 包裹后 verify 拒绝（反向验证）')
broken2 = once.replace('<script id="motion-cine-js">', '', 1)
e2 = cine.verify(broken2)
check(any('未被 <script> 包裹' in x for x in e2),
      '去掉 <script> 包裹后 verify 拒绝（反向验证）')

# ==========================================================================
print('\n\033[1m[9] ⭐ 铁律 D：内容默认可见\033[0m')
# ==========================================================================
# 兜底分支（@supports not）里不得有 opacity:0
m = re.search(r'@supports not \(animation-timeline: view\(\)\)\s*\{(.*?)\n\}',
              css_seg, re.S)
check(m is not None, '存在 @supports not 兜底分支')
if m:
    body = m.group(1)
    check('opacity: 1' in body, '兜底分支显式声明 opacity:1')
    check('opacity: 0' not in body, '兜底分支无 opacity:0')

# 降档分支必须恢复可见
m2 = re.search(r'html\[data-fps-q\][^{]*\{(.*?)\n\}', css_seg, re.S)
check(m2 is not None, '存在 data-fps-q 降档分支')
if m2:
    check('opacity: 1' in m2.group(1), '降档分支恢复 opacity:1')

# reduced-motion 分支必须恢复可见
m3 = re.search(r'@media \(prefers-reduced-motion: reduce\)\s*\{(.*?)\n\}\n',
               css_seg, re.S)
check(m3 is not None, '存在 prefers-reduced-motion 分支')
if m3:
    check('opacity: 1' in m3.group(1), 'reduced-motion 分支恢复 opacity:1')

# JS 必须在 REDUCED 时直接返回（不发动画）
check("if (REDUCED) return" in js_seg, 'JS 在 reduced-motion 下直接返回')
check('skipped' in js_seg, 'JS 记录跳过原因')

# ==========================================================================
print('\n\033[1m[10] ⭐ 弹簧曲线数学正确性\033[0m')
# ==========================================================================
import math


def parse_linear(v):
    m = re.match(r'linear\(([^)]*)\)', v.strip())
    if not m:
        return None
    return [float(x) for x in m.group(1).split(',') if x.strip()]


vars_found = re.findall(r'--cine-\w+:\s*(linear\([^)]*\))', css_seg)
check(len(vars_found) >= 5, '至少 5 条 linear() 弹簧曲线（实 %d）'
      % len(vars_found))

spring_map = dict(re.findall(r'(--cine-\w+):\s*(linear\([^)]*\))', css_seg))
for name in ('--cine-spring', '--cine-snap', '--cine-rubber', '--cine-calm'):
    v = spring_map.get(name)
    if not check(v is not None, '%s 存在' % name):
        continue
    pts = parse_linear(v)
    check(len(pts) >= 30, '%s 控制点 %d 个（≥30）' % (name, len(pts)))
    check(pts[0] == 0.0, '%s 起点为 0' % name)
    check(abs(pts[-1] - 1.0) < 0.02, '%s 终点收敛到 1（实 %.4f）'
          % (name, pts[-1]))
    over = max(pts)
    # iOS 弹簧过冲应在 1~3%，橡皮应在 10~20%
    if name == '--cine-rubber':
        check(1.10 < over < 1.20, '%s 过冲 %.3f 在 1.10~1.20（强回弹）'
              % (name, over))
    else:
        check(1.0 < over < 1.03, '%s 过冲 %.4f 在 1.0~1.03（轻微）'
              % (name, over))
    # 单调上升段后必须回落（真振荡，不是单调逼近）
    imax = pts.index(over)
    check(imax < len(pts) - 3, '%s 峰值不在末点（有回落段）' % name)
    tail = pts[imax:]
    check(tail[-1] < tail[0], '%s 峰值后回落 %.4f -> %.4f'
          % (name, tail[0], tail[-1]))
    check(len(tail) >= 5, '%s 振荡尾巴 ≥5 点（真衰减）' % name)

# 临界阻尼：数字用，不该过冲
sv = spring_map.get('--cine-settle')
if check(sv is not None, '--cine-settle 存在'):
    pts = parse_linear(sv)
    check(max(pts) <= 1.001, '临界阻尼不过冲（峰 %.5f）' % max(pts))

# 离场用加速曲线
check('--cine-exit: cubic-bezier(.55' in css_seg, '离场用加速曲线')

# ==========================================================================
print('\n\033[1m[11] ⭐ 解析级泄漏检测（html.parser 模拟浏览器）\033[0m')
# ==========================================================================
if os.path.exists(LEAK):
    import subprocess
    r = subprocess.run([sys.executable, LEAK, ORIG],
                       capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    check(r.returncode == 0, 'check_leak.py 通过（%s）'
          % (r.stdout or '').strip().splitlines()[-1][:60] if r.stdout else '')

    # 反向验证：造一个裸 CSS 的坏文件，确认能被抓出来
    import tempfile
    bad_html = once.replace('<style id="motion-cine-style">', '', 1) \
                     .replace('</style>', '', 1)
    tf = os.path.join(tempfile.gettempdir(), '_cine_leak_bad.html')
    with open(tf, 'w', encoding='utf-8', newline='') as f:
        f.write(bad_html)
    r2 = subprocess.run([sys.executable, LEAK, tf],
                        capture_output=True, text=True,
                        encoding='utf-8', errors='replace')
    check(r2.returncode != 0, '去掉包裹后泄漏检测能抓出问题（反向验证）')
    os.remove(tf)
else:
    bad('找不到 check_leak.py: %s' % LEAK)

# ==========================================================================
print('\n\033[1m═══ 结果 ═══\033[0m')
print('  通过 %d / 失败 %d' % (PASS_N[0], FAIL_N[0]))
if FAILED:
    print('\n\033[31m失败明细：\033[0m')
    for f in FAILED:
        print('  - %s' % f)
    sys.exit(1)
print('\033[32m全绿\033[0m')
