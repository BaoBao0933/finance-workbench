#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""stability 注入器测试：构造 / 注入 / 可逆 / 幂等 / 特征 / 位置。"""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INJECT_PATH = os.path.join(HERE, 'inject.py')

spec = importlib.util.spec_from_file_location('stability_inject', INJECT_PATH)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

ok_n = fail_n = 0


def ok(msg):
    global ok_n
    ok_n += 1
    print('  ok  ' + msg)


def fail(msg):
    global fail_n
    fail_n += 1
    print('  FAIL ' + msg)


def eq(label, got, want):
    if got == want:
        ok('%s = %r' % (label, got))
    else:
        fail('%s = %r（期望 %r）' % (label, got, want))


BASE = (
    '<!DOCTYPE html>\r\n<html>\r\n<head>\r\n'
    '<meta charset="utf-8">\r\n'
    '<title>t</title>\r\n'
    '</head>\r\n<body>\r\n'
    '<div id="app"></div>\r\n'
    '</body>\r\n</html>\r\n'
)

print('--- 1. 构造 ---')
eol = M.detect_eol(BASE)
eq('detect_eol', eol, '\r\n')
css_block = M.build_css_block(eol)
js_block = M.build_js_block(eol)
ok('CSS 块 %d 字节' % len(css_block))
ok('JS 块 %d 字节' % len(js_block))
if '<style id="stability-style">' in css_block and css_block.count('<style') == 1:
    ok('CSS 自带 <style> 包裹')
else:
    fail('CSS 包裹缺失')
if '<script id="stability-js">' in js_block and js_block.count('<script') == 1:
    ok('JS 自带 <script> 包裹')
else:
    fail('JS 包裹缺失')

print('--- 2. 注入 ---')
tmp = os.path.join(HERE, '_tmp_target.html')
M.write(tmp, BASE)
M.inject_once(tmp)
cur = M.read(tmp)
for mk in (M.CSS_B, M.CSS_E, M.JS_B, M.JS_E):
    eq('标记计数 %s' % mk, cur.count(mk), 1)
if cur.index(M.CSS_B) < cur.index('</head>'):
    ok('CSS 在 </head> 之前')
else:
    fail('CSS 跑出 head')
if cur.index(M.JS_B) < cur.index('</body>'):
    ok('JS 在 </body> 之前')
else:
    fail('JS 跑出 body')

print('--- 3. 可逆（strip 后与基线一致）---')
stripped, n = M.strip_all(cur)
eq('剥离块数', n, 2)
eq('字节还原', stripped, BASE)

print('--- 4. 幂等 ---')
M.inject_once(tmp)
cur2 = M.read(tmp)
eq('二次注入后标记数', cur2.count(M.CSS_B), 1)
eq('二次注入后字节不变', cur2, cur)

print('--- 5. 特征守卫 ---')
css_seg = cur2[cur2.index(M.CSS_B):cur2.index(M.CSS_E)]
js_seg = cur2[cur2.index(M.JS_B):cur2.index(M.JS_E)]
missing = [name for name, pat in M.MUST_KEEP if not re.search(pat, css_seg, re.S)]
if not missing:
    ok('CSS 特征 %d 项全在' % len(M.MUST_KEEP))
else:
    fail('CSS 缺 %s' % missing)
missing = [name for name, pat in M.JS_MUST_KEEP if not re.search(pat, js_seg, re.S)]
if not missing:
    ok('JS 特征 %d 项全在' % len(M.JS_MUST_KEEP))
else:
    fail('JS 缺 %s' % missing)

print('--- 6. 位置 / 解析 ---')
errs = M.verify(cur2) + M._parse_errs(cur2)
if not errs:
    ok('verify + parse 全过')
else:
    for e in errs:
        fail(e)

print('--- 7. 不落进别人区间 ---')
busy = BASE.replace('</head>', (
    '<!-- GP:CSS:BEGIN -->\r\n<style id="glass-pro-style">.x{}</style>\r\n<!-- GP:CSS:END -->\r\n'
    '</head>'))
M.write(tmp, busy)
M.inject_once(tmp)
cur3 = M.read(tmp)
gp_b, gp_e = cur3.index('GP:CSS:BEGIN'), cur3.index('GP:CSS:END')
bd_b = cur3.index(M.CSS_B)
if not (gp_b < bd_b < gp_e):
    ok('未落进 GP:CSS 区间')
else:
    fail('落进了 GP:CSS 区间')
errs = M.verify(cur3)
if not errs:
    ok('复杂页面 verify 通过')
else:
    for e in errs:
        fail(e)

print('--- 8. 幂等判断（内容比对）---')
if M._is_current(tmp):
    ok('_is_current 判真')
else:
    fail('_is_current 判假')
M.write(tmp, cur3.replace('st-diag-badge', 'st-diag-badgeX'))
if not M._is_current(tmp):
    ok('改数值后判假（逐字节生效）')
else:
    fail('改数值后仍判真')

print('--- 9. 语义检查（兜底规则齐全 / 演示数据真实标注）---')
checks = [
    ('has 兜底覆盖图标容器', r'\.ov-icon\.has-iso\s*\{'),
    ('浅色主题同名兜底', r':root\[data-theme="light"\]\s*\.ov-icon\.has-iso'),
    ('标题基线同步', r'\.title-ico\.has-iso\s*\{[^}]*vertical-align:\s*-12px'),
    ('资金流向容器尺寸同步', r'\.fund-ico\.has-iso\s*\{[^}]*width:\s*46px'),
    ('JS 会补 has-iso 类', r"classList\.add\('has-iso'\)"),
    ('JS 会补 has-flame 类', r"classList\.add\('has-flame'\)"),
    ('演示条明确写非实时', r'非实时行情'),
    ('演示只填空状态', r"indexOf\('恢复中'\) < 0"),
    ('真实数据回来自动退出', r'stopDemo\(false\)'),
]
for name, pat in checks:
    if re.search(pat, cur2, re.S):
        ok(name)
    else:
        fail(name + ' —— 规则缺失')

os.remove(tmp)
print('\n结果: %d ok, %d fail' % (ok_n, fail_n))
sys.exit(1 if fail_n else 0)
