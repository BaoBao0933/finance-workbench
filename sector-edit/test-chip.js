/* ==========================================================================
   sector-chip 行情刷新回归测试（离线，DOM 桩）
   --------------------------------------------------------------------------
   复现并锁死用户报的 bug：「添加板块后卡片一直显示 --% / -- 点」。
   根因（两个叠加）：
     A. sector-edit 的 buildSectorChip 自己 append 了一张空卡片，但没注册进
        主文件的 sectorCache，而 updateSectors 正是靠 sectorCache[secid] 找节点
        → 轮询路径永远更新不到它；
     B. doAdd 不触发刷新，只能等轮询（非交易时段 120s，页面隐藏时完全不跑）。
   修法：renderSectors 渲染「全部已配置板块」（缺数据显占位、且全部注册进
   sectorCache）；loadSectors 的判定改用「缓存条数 ≠ SECTORS 数」；
   doAdd 显式调 hook.refreshQuotes()。

   本测试直接抽 loadSectors / renderSectors / updateSectors 的真实函数体跑，
   绝不复制逻辑（复制会漂移，测试常绿而功能常坏）。
   用法：node sector-edit/test-chip.js
   ========================================================================== */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

const INDEX = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

let PASS = 0, FAIL = 0;
function ok(label, cond, extra) {
  if (cond) { PASS++; console.log('  [OK] ' + label); }
  else { FAIL++; console.log('  [X]  ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

function extract(name) {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('主文件未找到 ' + name);
  /* 带上前置修饰符（async）——漏掉它抽出来的函数体里 await 会直接语法报错 */
  const m = html.slice(Math.max(0, i - 8), i).match(/\basync\s+$/);
  if (m) i -= m[0].length;
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}') { d--; if (d === 0) { j++; break; } }
  }
  return html.slice(i, j).replace(/\r\n/g, '\n');
}

/* ---------------- DOM 桩 ---------------- */
function parseChips(src) {
  const out = [];
  src.split(/<div class="sector-chip/).slice(1).forEach(seg => {
    const secid = (seg.match(/data-secid="([^"]*)"/) || [])[1] || '';
    const name = (seg.match(/data-name="([^"]*)"/) || [])[1] || '';
    const valCls = (seg.match(/<div class="(sc-val[^"]*)">/) || [])[1] || '';
    const valTxt = (seg.match(/<div class="sc-val[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '';
    const priceTxt = (seg.match(/<div class="sc-price">([\s\S]*?)<\/div>/) || [])[1] || '';

    const chip = {
      dataset: { secid: secid, name: name, pct: '' },
      _cls: new Set(['sector-chip']),
      classList: {
        add: c => chip._cls.add(c),
        remove: c => chip._cls.delete(c),
        contains: c => chip._cls.has(c),
      },
    };
    chip._val = { textContent: valTxt, className: valCls, classList: chip.classList, offsetWidth: 12 };
    chip._bar = { className: '', style: {} };
    chip._price = { textContent: priceTxt };
    chip.querySelector = sel => {
      if (sel === '.sc-val') return chip._val;
      if (sel === '.sc-bar i') return chip._bar;
      if (sel === '.sc-price') return chip._price;
      return null;
    };
    out.push(chip);
  });
  return out;
}

const strip = {
  _html: '', _kids: [],
  get innerHTML() { return this._html; },
  set innerHTML(v) { this._html = v; this._kids = parseChips(v); },
  querySelectorAll() { return this._kids; },
  querySelector() { return this._kids[0] || null; },
};
const sourceEl = { textContent: '' };
const documentStub = {
  getElementById: id => (id === 'sector-strip' ? strip
    : id === 'sector-source' ? sourceEl : null),
  querySelector: sel => (String(sel).indexOf('sector-chip') >= 0 ? (strip._kids[0] || null) : null),
  querySelectorAll: () => strip._kids,
};

/* 腾讯板块源（模拟 QF.fetchQQBoards 的真实输出格式） */
const IND = [
  { bd_code: 'pt01801131', bd_name: 'CPO', bd_zdf: '1.20', bd_zxj: '1000' },
  { bd_code: 'pt01801132', bd_name: 'MLCC', bd_zdf: '-0.80', bd_zxj: '900' },
  { bd_code: 'pt01801133', bd_name: '光通信', bd_zdf: '2.50', bd_zxj: '1100' },
  { bd_code: 'pt01801134', bd_name: 'AI应用', bd_zdf: '-1.10', bd_zxj: '800' },
  { bd_code: 'pt01801135', bd_name: '电力', bd_zdf: '0.00', bd_zxj: '700' },
  { bd_code: 'pt01801136', bd_name: '算力租赁', bd_zdf: '3.30', bd_zxj: '1200' },
  { bd_code: 'pt01801993', bd_name: '旅游及景区', bd_zdf: '-1.50', bd_zxj: '1887.36' },  // ← 用户新加的那个
].map(x => ({
  secid: 'qq.' + x.bd_code, name: x.bd_name,
  bd_code: x.bd_code, bd_name: x.bd_name,
  f12: x.bd_code, f14: x.bd_name,
  f2: parseFloat(x.bd_zxj), f3: parseFloat(x.bd_zdf),
}));

const INIT6 = [
  ['qq.pt01801131', 'CPO'], ['qq.pt01801132', 'MLCC'], ['qq.pt01801133', '光通信'],
  ['qq.pt01801134', 'AI应用'], ['qq.pt01801135', '电力'], ['qq.pt01801136', '算力租赁'],
];

/* 把真实函数体拼成一段脚本一起跑 —— const/let 必须在同一脚本内才互相可见 */
const code = `
  var SECTORS = ${JSON.stringify(INIT6.map(p => ({ secid: p[0], name: p[1] })))};
  var sectorCache = {};
  var __qqRows = ${JSON.stringify(IND)};
  function $(id) { return document.getElementById(id); }
  function fmtNum(v, d) {
    if (v === undefined || v === null || isNaN(v)) return '--';
    return Number(v).toFixed(d === undefined ? 2 : d);
  }
  function fetchJson() { return Promise.reject(new Error('eastmoney blocked')); }
  var window = { QF: { fetchQQBoards: function (kind) {
    return Promise.resolve(kind === 'industry' ? __qqRows : []);
  } } };

  ${extract('renderSectors')}
  ${extract('updateSectors')}
  ${extract('loadSectors')}

  globalThis.__T = { renderSectors: renderSectors, updateSectors: updateSectors,
                     loadSectors: loadSectors, getSectors: function () { return SECTORS; },
                     getCache: function () { return sectorCache; } };
`;

const sandbox = { console, document: documentStub, isFinite, Object, Number, Promise, Error };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'sector-chain' });

function sb2Run(src) {
  vm.runInContext(src, sandbox, { filename: 'chip-inline' });
}
const T = sandbox.__T;
const chipBy = secid => strip._kids.find(c => c.dataset.secid === secid);

(async function main() {
  console.log('\n=== sector-chip 行情刷新链路测试 ===\n');

  /* ---- 1. 首次渲染 6 个板块 ---- */
  await T.loadSectors(false);
  ok('首次渲染出 6 张卡片', strip._kids.length === 6, strip._kids.length);
  ok('sectorCache 注册 6 条', Object.keys(T.getCache()).length === 6, Object.keys(T.getCache()).length);
  ok('第 1 张卡片有数值（不是 --%）', chipBy('qq.pt01801131')._val.textContent.indexOf('%') > 0
     && chipBy('qq.pt01801131')._val.textContent.indexOf('--') < 0,
     chipBy('qq.pt01801131')._val.textContent);
  ok('第 1 张显示来源点位', /点$/.test(chipBy('qq.pt01801131')._price.textContent),
     chipBy('qq.pt01801131')._price.textContent);

  /* ---- 2. 用户新增第 7 个板块（sector-edit 会自己 append 一张空卡片）---- */
  T.getSectors().push({ secid: 'qq.pt01801993', name: '旅游及景区' });
  // 模拟 buildSectorChip：append 一张占位卡（未注册进 sectorCache）—— 这正是缺陷来源
  strip._html += '<div class="sector-chip" data-secid="qq.pt01801993" data-name="旅游及景区">'
    + '<div class="sc-val">--%</div><div class="sc-price">-- 点</div></div>';
  strip._kids = parseChips(strip._html);

  ok('（前置）DOM 已有 7 张卡片，但缓存仍 6 条',
     strip._kids.length === 7 && Object.keys(T.getCache()).length === 6,
     strip._kids.length + ' / ' + Object.keys(T.getCache()).length);
  ok('（前置）新卡片此刻是 --% 占位',
     chipBy('qq.pt01801993')._val.textContent === '--%',
     chipBy('qq.pt01801993')._val.textContent);

  /* ---- 3. doAdd 触发刷新（等价于 hook.refreshQuotes()）---- */
  await T.loadSectors(false);

  ok('刷新后仍 7 张卡片（DOM 与配置同步）', strip._kids.length === 7, strip._kids.length);
  ok('sectorCache 补齐到 7 条', Object.keys(T.getCache()).length === 7, Object.keys(T.getCache()).length);

  const newChip = chipBy('qq.pt01801993');
  ok('★ 新卡片拿到行情（不再是 --%）', newChip && newChip._val.textContent.indexOf('--') < 0,
     newChip ? newChip._val.textContent : '卡片不存在');
  ok('★ 新卡片显示跌（-1.50%）', newChip && /-1\.50%/.test(newChip._val.textContent),
     newChip ? newChip._val.textContent : '-');
  ok('★ 新卡片显示点位 1887.36 点', newChip && /1887\.36/.test(newChip._price.textContent),
     newChip ? newChip._price.textContent : '-');
  ok('★ 新卡片排名为 #7', /#7/.test(strip._html.split('pt01801993')[0].slice(-400)) ||
     strip._html.indexOf('#7') > 0);

  /* ---- 4. 再次轮询：此时缓存与配置同步 → 走原地更新，不重建 ---- */
  const beforeKids = strip._kids.slice();
  await T.loadSectors(false);
  ok('缓存已同步时不再重建 DOM（卡片对象复用）',
     strip._kids.length === 7 && strip._kids[0] === beforeKids[0]);
  ok('原地更新后新卡片仍有数据', chipBy('qq.pt01801993')._val.textContent.indexOf('--') < 0,
     chipBy('qq.pt01801993')._val.textContent);

  /* ---- 5. 缺数据的板块保留占位卡片，不会消失 ---- */
  const hold = sandbox.__T;
  T.getSectors().push({ secid: 'qq.ptNOTEXIST', name: '无行情板块' });
  await T.loadSectors(false);
  ok('无行情的板块仍渲染出卡片（不消失）', strip._kids.length === 8, strip._kids.length);
  ok('该卡片显示 --% 占位', chipBy('qq.ptNOTEXIST') && chipBy('qq.ptNOTEXIST')._val.textContent === '--%',
     chipBy('qq.ptNOTEXIST') ? chipBy('qq.ptNOTEXIST')._val.textContent : '卡片不存在');
  ok('该卡片显示 -- 点 占位', chipBy('qq.ptNOTEXIST') && chipBy('qq.ptNOTEXIST')._price.textContent === '-- 点',
     chipBy('qq.ptNOTEXIST') ? chipBy('qq.ptNOTEXIST')._price.textContent : '-');

  /* ---- 5.5 行业源失败 → 概念不受牵连 + 徽标诊断（行业/概念分开请求） ---- */
  console.log('\n场景 5.5 · 行业源失败只影响行业板块');
  // 桩按真实语义拆分：industry=t01 行业行、concept=t02 概念行（互补集合）
  sb2Run('window.QF = { fetchQQBoards: function (kind) {'
    + '  if (kind === "industry") return Promise.reject(new Error("t01 down"));'
    + '  return Promise.resolve(__qqRows.filter(function (r) { return r.secid !== "qq.pt01801993"; }));'
    + '} };');

  sourceEl.textContent = '';
  await T.loadSectors(false);
  ok('行业源挂掉时概念板块仍有行情', chipBy('qq.pt01801131')._val.textContent.indexOf('--') < 0,
     chipBy('qq.pt01801131')._val.textContent);
  ok('行业板块保留上一次的值（原地更新不清掉已有显示，优于闪成占位）',
     /-1\.50%/.test(chipBy('qq.pt01801993')._val.textContent),
     chipBy('qq.pt01801993')._val.textContent);
  ok('徽标显示腾讯源与未匹配项', /腾讯源/.test(sourceEl.textContent)
     && /旅游及景区/.test(sourceEl.textContent), sourceEl.textContent);

  // 恢复正常源 → 下一次轮询应把行业板块救回来（无行情板块仍缺席 → 7/8）
  sb2Run('window.QF = { fetchQQBoards: function (kind) {'
    + '  return Promise.resolve(kind === "industry"'
    + '    ? __qqRows.filter(function (r) { return r.secid === "qq.pt01801993"; })'
    + '    : __qqRows.filter(function (r) { return r.secid !== "qq.pt01801993"; }));'
    + '} };');
  await T.loadSectors(false);
  ok('源恢复后行业板块被救回', /-1\.50%/.test(chipBy('qq.pt01801993')._val.textContent),
     chipBy('qq.pt01801993')._val.textContent);
  ok('徽标显示 7/8（无行情板块如实未匹配）',
     /7\/8 命中/.test(sourceEl.textContent) && /未匹配: 无行情板块/.test(sourceEl.textContent),
     sourceEl.textContent);

  /* ---- 6. 源码特征 ---- */
  console.log('\n场景 · 源码关键特征');
  ok('doAdd 显式触发 refreshQuotes', html.indexOf('if (hook.refreshQuotes) { try { hook.refreshQuotes(); }') >= 0);
  ok('__sectorsHook 暴露 refreshQuotes',
     html.indexOf('refreshQuotes: function () { loadSectors(false); }') >= 0);
  ok('needRebuild 用缓存条数判定', html.indexOf('Object.keys(sectorCache).length !== SECTORS.length') >= 0);
  ok('renderSectors 渲染全集（占位 --%）', html.indexOf("'--%'") >= 0);
  ok('失败提示不清掉已有卡片',
     html.indexOf("if (isFirst && !document.querySelector('#sector-strip .sector-chip'))") >= 0);
  ok('renderSectors 重建前清空 sectorCache',
     html.indexOf('Object.keys(sectorCache).forEach(k => { delete sectorCache[k]; });') >= 0);
  ok('行业/概念分开请求（settle 包装）', html.indexOf("settle(window.QF.fetchQQBoards('industry'))") >= 0);
  ok('徽标显示实时匹配状态', html.indexOf("命中'") >= 0 && html.indexOf('未匹配: ') >= 0);
  ok('fetchQQBoards 有 8s 超时', html.indexOf('ctl.abort()') >= 0);

  console.log('\n' + '='.repeat(52));
  console.log('  通过 %d 项 / 失败 %d 项', PASS, FAIL);
  console.log('='.repeat(52) + '\n');
  process.exit(FAIL ? 1 : 0);
})();
