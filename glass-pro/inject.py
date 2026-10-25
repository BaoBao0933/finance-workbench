# -*- coding: utf-8 -*-
"""
把 glass-pro/glass.css 注入到 finance-workbench/index.html。

特性：
- 幂等：先剥离旧块再插入；且 `_is_current()` 逐字节比对，内容没变就不写盘
  （⚠️ 只验「特征串在不在」会漏掉"改了数值但特征没变"的情况 ——
   项目在 motion-tune 上踩过，见铁律 I）
- 安全：只改 CSS，不动 backdrop-filter（type-glass / fps-boost 的地盘）
- 锚点：`</head>`，插入后位于 TG 之后（规范链 ... < TG < GL < </head>）
- 但**不依赖插入顺序**：所有规则用 `html:root` / 重复类名把特异性顶高，
  所以别的注入器重跑把块挪到前面也不影响生效

用法：
    python glass-pro/inject.py            # 注入
    python glass-pro/inject.py --check    # 只校验
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

CSS_B = '<!-- GL:CSS:BEGIN -->'
CSS_E = '<!-- GL:CSS:END -->'
STYLE_OPEN = '<style id="glass-pro-style">'
STYLE_CLOSE = '</style>'

# 注入后必须仍然存在的原有特征（防止改坏主文件）
MUST_KEEP = [
    '<aside class="sidebar">',
    '<main class="main">',
    'function jsonp(',
    '--tg-blur-lg',
    '--tg-spec',
    '<script id="minute-chart-js">',
]


def err(msg):
    print('[FAIL] ' + msg)
    sys.exit(1)


def read(p):
    with io.open(p, encoding='utf-8', newline='') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def detect_eol(s):
    return '\r\n' if s.count('\r\n') > s.count('\n') - s.count('\r\n') else '\n'


def to_eol(s, eol):
    return s.replace('\r\n', '\n').replace('\n', eol)


def strip_block(html):
    """剥掉 GL:CSS 块（连同其后的一个换行），其余原样返回。"""
    pat = re.escape(CSS_B) + r'.*?' + re.escape(CSS_E) + r'[ \t]*\r?\n'
    out, n = re.subn(pat, '', html, flags=re.S)
    if n == 0:
        # 没有块，也可能只残留了 BEGIN/END（异常状态），一并清掉
        return html
    if n > 1:
        err('GL:CSS 块数量异常 = %d' % n)
    return out


def build_css_block(eol):
    css = read(os.path.join(HERE, 'glass.css'))
    body = to_eol(css.strip('\r\n'), eol)
    block = (CSS_B + eol +
             STYLE_OPEN + eol +
             body + eol +
             STYLE_CLOSE + eol +
             CSS_E + eol)
    return block


def _is_current(path):
    """逐字节比对：主文件里现有的 GL 块是否与源文件构建结果一致。
    ⚠️ 不能只查特征串 —— 改了数值但特征不变就查不出来（铁律 I）。"""
    if not os.path.exists(path):
        return False
    cur = read(path)
    eol = detect_eol(cur)
    return build_css_block(eol) in cur


def main():
    check_only = '--check' in sys.argv
    if not os.path.exists(TARGET):
        err('找不到主文件：%s' % TARGET)

    raw = read(TARGET)
    eol = detect_eol(raw)
    clean = strip_block(raw)

    block = build_css_block(eol)

    # ---- 锚点：</head> 之前（该标签不属于任何模块区间） ----
    k = clean.find('</head>')
    if k < 0:
        err('找不到 </head> 锚点')
    out = clean[:k] + block + clean[k:]

    # ---- 校验 ----
    problems = []
    for feat in MUST_KEEP:
        if feat not in out:
            problems.append('原有特征丢失：%s' % feat)
    checks = [
        ('BEGIN 唯一', out.count(CSS_B) == 1),
        ('END 唯一', out.count(CSS_E) == 1),
        ('<style> 包裹', out.count(STYLE_OPEN) == 1),
        ('块在 </head> 前', out.find(CSS_B) > 0 and out.find(CSS_B) < out.find('</head>')),
        ('在 TG 之后', out.find('<!-- TG:CSS:END -->') < out.find(CSS_B)),
        ('变量已覆盖', '--tg-spec:' in out and '--tg-rim:' in out and '--tg-lift:' in out),
        ('浅色主题块', 'html:root[data-theme="light"]' in out),
        ('fps 降级兼容', 'html[data-fps-q] {' in out),
        ('减少透明偏好', 'prefers-reduced-transparency' in out),
        ('换行风格保持', detect_eol(out) == eol),
        ('收尾完整', out.rstrip().endswith('</html>')),
    ]
    for name, ok in checks:
        if not ok:
            problems.append('校验失败：' + name)

    if problems:
        for p in problems:
            print('  ✗ ' + p)
        err('注入中止，未写盘')

    if check_only:
        ok = block in raw
        print('[%s] glass-pro 状态：%s' % ('OK' if ok else 'STALE',
              '已是最新' if ok else '需要重新注入'))
        sys.exit(0 if ok else 1)

    if block in raw:
        print('[SKIP] 内容逐字节一致，不需要重注入')
        return

    write(TARGET, out)
    print('[OK] glass-pro 已注入：%d 字节（%s）' % (len(block), 'CRLF' if eol == '\r\n' else 'LF'))


if __name__ == '__main__':
    main()
