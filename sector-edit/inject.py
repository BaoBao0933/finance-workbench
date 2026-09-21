# -*- coding: utf-8 -*-
"""
把 sector-edit/ 模块注入 finance-workbench/index.html：
1. 对主脚本做两处「外科手术式」替换（幂等：已替换过就跳过）：
   R1  const SECTORS = [...]  →  SECTOR_POOL + localStorage 配置 + let SECTORS
   R2  const sectorCache = {} →  追加 window.__sectorsHook 暴露句柄
2. 在主 </style> 后追加编辑态 CSS，</body> 前追加管理 JS
特性：幂等 / 写盘前校验 / 保持 CRLF / 不破坏原有特征
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGET = os.path.join(ROOT, 'index.html')

CSS_B, CSS_E = '<!-- SE:CSS:BEGIN -->', '<!-- SE:CSS:END -->'
BODY_B, BODY_E = '<!-- SE:BODY:BEGIN -->', '<!-- SE:BODY:END -->'

MUST_KEEP = [
    '<aside class="sidebar">',
    '<main class="main">',
    'function jsonp(',
    'async function fetchJson(',
    'function renderSectors(',
    'async function loadSectors(',
    'id="sector-strip"',
    'sector-chip',
]

# ---------- R1：SECTORS 常量 → 池 + 配置 ----------
R1_FIND = re.compile(
    r"// 热门行业板块（东方财富概念板块 secid）\r?\n"
    r"const SECTORS = \[.*?\];",
    re.S)

R1_REPL = """// 热门行业板块：候选池（东方财富概念板块 secid）
const SECTOR_POOL = [
  { secid: '90.BK1128', name: 'CPO' },
  { secid: '90.BK0890', name: 'MLCC' },
  { secid: '90.BK1136', name: '光通信' },
  { secid: '90.BK1629', name: 'AI应用' },
  { secid: '90.BK0428', name: '电力' },
  { secid: '90.BK1134', name: '算力租赁' },
  { secid: '90.BK0448', name: '交换机' },
  { secid: '90.BK1660', name: '光纤' },
  { secid: '90.BK1137', name: '存储芯片' },
  { secid: '90.BK0883', name: '数字货币' },
  { secid: '90.BK0637', name: '互联网金融' },
];

// 用户自选的板块列表（顺序即展示顺序），存 localStorage
function loadSectorConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem('finance-sectors') || 'null');
    if (Array.isArray(raw) && raw.length &&
        raw.every(s => s && typeof s.secid === 'string' && typeof s.name === 'string') &&
        raw.every(s => SECTOR_POOL.some(p => p.secid === s.secid))) {
      return raw.slice(0, 12);
    }
  } catch (e) {}
  return SECTOR_POOL.slice(0, 6);
}
function saveSectorConfig() {
  try { localStorage.setItem('finance-sectors', JSON.stringify(SECTORS)); } catch (e) {}
}
let SECTORS = loadSectorConfig();"""


def read(p):
    return io.open(p, encoding='utf-8', newline='').read()


def detect_eol(txt):
    crlf = txt.count('\r\n')
    lf = txt.count('\n') - crlf
    return '\r\n' if crlf >= lf else '\n'


def to_eol(txt, eol):
    flat = txt.replace('\r\n', '\n').replace('\r', '\n')
    return flat if eol == '\n' else flat.replace('\n', '\r\n')


def strip_blocks(html):
    for a, b in ((CSS_B, CSS_E), (BODY_B, BODY_E)):
        html = re.sub(re.escape(a) + r'.*?' + re.escape(b) + r'[ \t]*\r?\n?', '', html, flags=re.S)
    return html


def err(msg):
    sys.stderr.write('[X] %s\n' % msg)
    sys.exit(1)


def main():
    if not os.path.exists(TARGET):
        err('找不到 %s' % TARGET)

    css = read(os.path.join(HERE, 'sector-edit.css'))
    js = read(os.path.join(HERE, 'sector-edit.js'))
    for name, txt in (('sector-edit.css', css), ('sector-edit.js', js)):
        if '</style>' in txt or '</script>' in txt:
            err('%s 含 </style> 或 </script>，会破坏注入块结构' % name)

    src = read(TARGET)
    clean = strip_blocks(src)
    eol = detect_eol(clean)
    out = clean
    applied = []

    # ---- R1：SECTORS → 池 + 配置（幂等） ----
    if 'SECTOR_POOL' in out:
        applied.append('R1(已应用,跳过)')
    else:
        m = R1_FIND.search(out)
        if not m:
            err('R1 锚点未命中：找不到 const SECTORS 块')
        out = out[:m.start()] + to_eol(R1_REPL, eol) + out[m.end():]
        applied.append('R1')

    # ---- R2：sectorCache 追加 hook（幂等；已存在则整块更新，保证新增字段能补上） ----
    R2_REPL_BODY = """/* SE: 暴露句柄给「热门行业板块」管理模块（sector-edit） */
window.__sectorsHook = {
  cache: sectorCache,
  pool: SECTOR_POOL,
  getList: function () { return SECTORS.slice(); },
  setList: function (list) { SECTORS = list; saveSectorConfig(); },
  reload: function () {
    Object.keys(sectorCache).forEach(function (k) { delete sectorCache[k]; });
    loadSectors(true);
  },
  toast: showToast
};"""
    R2_REPL = R2_REPL_BODY
    R2_OLD = re.compile(r"/\* SE: 暴露句柄给「热门行业板块」管理模块（sector-edit） \*/\r?\nwindow\.__sectorsHook = \{.*?\r?\n\};", re.S)
    m2 = R2_OLD.search(out)
    if m2:
        if 'pool: SECTOR_POOL' in m2.group(0):
            applied.append('R2(已是最新,跳过)')
        else:
            out = out[:m2.start()] + to_eol(R2_REPL_BODY, eol) + out[m2.end():]
            applied.append('R2(升级补 pool)')
    elif '__sectorsHook' in out:
        err('R2 异常：存在 __sectorsHook 但结构不匹配，请人工检查')
    else:
        if out.count('const sectorCache = {}; // secid -> {valEl, pctEl, barEl, barClass}') != 1:
            err('R2 锚点未命中或不唯一')
        out = out.replace(
            'const sectorCache = {}; // secid -> {valEl, pctEl, barEl, barClass}',
            'const sectorCache = {}; // secid -> {valEl, pctEl, barEl, barClass}\n' + R2_REPL, 1)
        applied.append('R2')

    # ---- 追加 CSS / JS 块 ----
    css_block = to_eol(CSS_B + '\n<style id="sector-edit-style">\n' + css + '\n</style>\n' + CSS_E + '\n', eol)
    body_block = to_eol(BODY_B + '\n<script id="sector-edit-js">\n' + js + '\n</script>\n' + BODY_E + '\n', eol)

    had_css = CSS_B in out
    if not had_css:
        i = out.find('</style>')
        if i < 0:
            err('找不到主 </style> 锚点')
        j = i + len('</style>')
        out = out[:j] + css_block + out[j:]

    had_body = BODY_B in out
    if not had_body:
        k = out.rfind('</body>')
        if k < 0:
            err('找不到 </body> 锚点')
        out = out[:k] + body_block + out[k:]

    # ---- 校验 ----
    problems = []
    for feat in MUST_KEEP:
        if feat not in out:
            problems.append('原有特征丢失：%s' % feat)
    for feat in ['SECTOR_POOL', 'loadSectorConfig', 'saveSectorConfig', '__sectorsHook',
                 'btn-sector-edit' if had_body else 'SE:BODY']:
        if feat not in out:
            problems.append('注入特征缺失：%s' % feat)
    checks = [
        ('CSS 在 </head> 前', out.find(CSS_B) < out.find('</head>')),
        ('BODY 在 </body> 前', out.find(BODY_B) < out.find('</body>')),
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
    if out.count('<style') != clean.count('<style') + (0 if had_css else 1):
        problems.append('style 标签数异常')
    if out.count('</style>') != clean.count('</style>') + (0 if had_css else 1):
        problems.append('/style 标签数异常')
    if out.count('<script') != clean.count('<script') + (0 if had_body else 1):
        problems.append('script 标签数异常')
    if out.count('</script>') != clean.count('</script>') + (0 if had_body else 1):
        problems.append('/script 标签数异常')

    if problems:
        print('[X] 校验未通过，未写入文件：')
        for p in problems:
            print('    - ' + p)
        sys.exit(1)

    io.open(TARGET, 'w', encoding='utf-8', newline='').write(out)

    b0, b1 = len(src.encode('utf-8')), len(out.encode('utf-8'))
    print('[OK] 已注入板块管理模块：%s' % TARGET)
    print('   %s → %s 字节' % (format(b0, ','), format(b1, ',')))
    print('   替换/追加: %s' % ' / '.join(applied))
    print('   换行风格: %s' % ('CRLF' if eol == '\r\n' else 'LF'))


if __name__ == '__main__':
    main()
