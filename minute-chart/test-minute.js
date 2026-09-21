/* ==========================================================================
   分时图模块逻辑测试（Node 环境，mock 最小 DOM）
   运行： node minute-chart/test-minute.js
   用真实接口数据（fixtures/）验证解析与坐标换算，不依赖浏览器
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  [!!] ' + name + (extra ? '   → ' + extra : ''));
  }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, '实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expect));
}
function group(t) { console.log('\n' + t); }

/* ---------- 最小 DOM stub ---------- */
function mkEl(id) {
  return {
    id: id, textContent: '', innerHTML: '', className: '', style: {},
    dataset: {}, width: 0, height: 0, clientWidth: 900, clientHeight: 330,
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, appendChild() {}, remove() {},
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 330 }; }
  };
}
const els = {};
const documentStub = {
  readyState: 'complete',
  hidden: false,
  documentElement: { getAttribute() { return 'dark'; }, setAttribute() {} },
  body: { style: {} },
  getElementById(id) { return els[id] || (els[id] = mkEl(id)); },
  addEventListener() {}, removeEventListener() {},
  querySelector() { return null; }, querySelectorAll() { return []; }
};
const windowStub = {
  matchMedia() { return { matches: false }; },
  devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {},
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval
};
const sandbox = {
  window: windowStub, document: documentStub, console: console,
  getComputedStyle() { return { getPropertyValue() { return ''; } }; },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  requestAnimationFrame(cb) { return setTimeout(cb, 0); },
  cancelAnimationFrame() {},
  performance: { now: () => Date.now() },
  fetch() { return Promise.reject(new Error('no network in test')); },
  Date: Date, Math: Math, JSON: JSON, parseFloat: parseFloat, parseInt: parseInt,
  isFinite: isFinite, isNaN: isNaN, Number: Number, String: String, Object: Object,
  Array: Array, RegExp: RegExp, Promise: Promise, Error: Error
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const code = fs.readFileSync(path.join(__dirname, 'minute.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'minute.js' });

const M = windowStub.__minuteChartInternals;
if (!M) {
  console.log('[X] 模块未导出测试接口 (window.__minuteChartInternals)');
  process.exit(1);
}

/* ================= A. 代码 → secid 映射 ================= */
group('A. guessSecid —— 6 位代码推断市场');
eq('沪市主板 600000', M.guessSecid('600000'), '1.600000');
eq('沪市科创板 688981', M.guessSecid('688981'), '1.688981');
eq('深市主板 000001', M.guessSecid('000001'), '0.000001');
eq('创业板 300750', M.guessSecid('300750'), '0.300750');
eq('北交所 830799', M.guessSecid('830799'), '0.830799');
eq('含字母的脏数据 6sh00000 → 600000', M.guessSecid('6sh00000'), '1.600000');
eq('非法输入 abc', M.guessSecid('abc'), null);
eq('长度不足 12345', M.guessSecid('12345'), null);

/* ================= B. 时间 → 当日分钟槽位 ================= */
group('B. slotOfHour —— 时间轴归位（A 股 240 分钟）');
eq('09:30 开盘 → 0', M.slotOfHour(9, 30), 0);
eq('10:00 → 30', M.slotOfHour(10, 0), 30);
eq('11:30 上午收盘 → 120', M.slotOfHour(11, 30), 120);
eq('13:00 下午开盘 → 120（与上午收盘无缝衔接）', M.slotOfHour(13, 0), 120);
eq('13:01 → 121', M.slotOfHour(13, 1), 121);
eq('14:00 → 180', M.slotOfHour(14, 0), 180);
eq('15:00 收盘 → 240', M.slotOfHour(15, 0), 240);
eq('越界 08:00 被夹到 0', M.slotOfHour(8, 0), 0);
eq('越界 16:00 被夹到 240', M.slotOfHour(16, 0), 240);

/* ================= C. 颜色透明度 ================= */
group('C. withAlpha —— 主题色转 rgba');
eq('#ff7a5c + 0.5', M.withAlpha('#ff7a5c', 0.5), 'rgba(255,122,92,0.5)');
eq('三位简写 #fff + 0.2', M.withAlpha('#fff', 0.2), 'rgba(255,255,255,0.2)');
eq('rgba 输入改 alpha', M.withAlpha('rgba(1,2,3,0.4)', 0.9), 'rgba(1,2,3,0.9)');

/* ================= D. 真实数据解析 ================= */
group('D. parseEast —— 用东方财富真实分时数据');
const fixtures = fs.readdirSync(path.join(__dirname, 'fixtures')).filter(f => f.endsWith('.json'));
ok('夹具文件存在（' + fixtures.length + ' 个）', fixtures.length >= 1);

fixtures.forEach(function (fn) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', fn), 'utf8'));
  const d = raw.data;
  const r = M.parseEast(d);
  const tag = '[' + fn.replace('east-', '').replace('.json', '') + ' ' + (d.name || '') + ']';

  eq(tag + ' 解析出 241 个点', r.pts.length, 241);
  ok(tag + ' 昨收 > 0', r.pre > 0, 'pre=' + r.pre);
  eq(tag + ' 首个槽位 = 0（09:30）', r.pts[0].slot, 0);
  eq(tag + ' 末个槽位 = 240（15:00）', r.pts[r.pts.length - 1].slot, 240);

  let mono = true, step1 = true, priceOk = true, avgOk = true;
  for (let i = 0; i < r.pts.length; i++) {
    if (i > 0) {
      if (r.pts[i].slot <= r.pts[i - 1].slot) mono = false;
      if (r.pts[i].slot - r.pts[i - 1].slot !== 1) step1 = false;
    }
    if (!(r.pts[i].price > 0)) priceOk = false;
    if (!(r.pts[i].avg > 0) || r.pts[i].avg > r.pre * 3) avgOk = false;
  }
  ok(tag + ' 槽位严格递增', mono);
  ok(tag + ' 每分钟恰好 +1（241 点无缝）', step1);
  ok(tag + ' 所有价格 > 0', priceOk);
  ok(tag + ' 均价合理（0 < avg < 3×昨收）', avgOk);

  // 与原始字段交叉核对最后一条
  const lastRaw = String(d.trends[d.trends.length - 1]).split(',');
  eq(tag + ' 末点价格 = 原始第3列', r.pts[240].price, parseFloat(lastRaw[2]));
  eq(tag + ' 末点均价 = 原始第8列', r.pts[240].avg, parseFloat(lastRaw[7]));
  eq(tag + ' 末点时间 = ' + lastRaw[0].slice(11, 16), r.pts[240].t, lastRaw[0].slice(11, 16));
  eq(tag + ' 名称透传', r.name, d.name);

  // 统计量：涨跌幅与手算一致
  let hi = -Infinity, lo = Infinity, vol = 0, amt = 0;
  r.pts.forEach(function (p) {
    if (p.price > hi) hi = p.price;
    if (p.price < lo) lo = p.price;
    vol += p.vol; amt += p.amt;
  });
  ok(tag + ' 最高 ≥ 最低', hi >= lo, 'high=' + hi + ' low=' + lo);
  ok(tag + ' 成交量合计 > 0', vol > 0, 'vol=' + vol);
  ok(tag + ' 成交额合计 > 0', amt > 0, 'amt=' + amt.toFixed(0));
  ok(tag + ' 全天总量 = 分钟增量累加（东财口径）', Math.abs(r.totalVol - vol) < 1,
     'totalVol=' + r.totalVol + ' 累加=' + vol.toFixed(0));
});

/* ================= E. 腾讯兜底解析（当日累计口径） ================= */
group('E. parseTx —— 腾讯兜底源（量/额是当日累计，必须差分）');

// 构造 qt：买1~买5 在 [9]~[18]，卖1~卖5 在 [19]~[28]（价/量成对）
const txQt = [];
txQt[1] = '浦发银行';
txQt[4] = '9.04';                       // 昨收
[9.02, 9.01, 9.00, 8.99, 8.98].forEach(function (p, i) {
  txQt[9 + i * 2] = String(p);
  txQt[10 + i * 2] = String(1000 * (5 - i));
});
[9.05, 9.06, 9.07, 9.08, 9.09].forEach(function (p, i) {
  txQt[19 + i * 2] = String(p);
  txQt[20 + i * 2] = String(800 * (5 - i));
});

// 逐分钟数据：第 3 列(量)/第 4 列(额) 都是「当日累计」，单调递增
const txNode = {
  qt: { sh600000: txQt },
  data: {
    data: [
      '0930 9.04 1798 1625392.00',
      '0931 9.05 76054 68370292.00',
      '1130 9.03 130000 117650000.00',
      '1301 9.02 132000 119450000.00',
      '1500 9.01 133500 120800000.00'
    ]
  }
};
const tx = M.parseTx(txNode, 'sh600000');
eq('解析 5 个点', tx.pts.length, 5);
eq('名称取自 qt[1]', tx.name, '浦发银行');
eq('昨收取 qt[4] = 9.04', tx.pre, 9.04);
eq('首点槽位 0', tx.pts[0].slot, 0);
eq('11:30 → 120', tx.pts[2].slot, 120);
eq('13:01 → 121（午后无缝）', tx.pts[3].slot, 121);
eq('15:00 → 240', tx.pts[4].slot, 240);
eq('时间格式 09:30', tx.pts[0].t, '09:30');
eq('末点价格 9.01', tx.pts[4].price, 9.01);

// 关键 1：每分钟的量必须是「差分」（本分钟累计 − 上一分钟累计）
eq('第1分钟增量 = 1798', tx.pts[0].vol, 1798);
eq('第2分钟增量 = 76054−1798 = 74256', tx.pts[1].vol, 74256);
eq('第3分钟增量 = 130000−76054 = 53946', tx.pts[2].vol, 53946);

// 关键 2：全天总量必须是「末值」，绝不能累加
eq('全天总量 = 末值 133500', tx.totalVol, 133500);
eq('全天总额 = 末值 120800000', tx.totalAmt, 120800000);

// 防回归：若哪天又写成累加，这条会立刻失败
const naiveVolSum = 1798 + 76054 + 130000 + 132000 + 133500;
ok('累加式会偏大约 ' + (naiveVolSum / tx.totalVol).toFixed(1) + ' 倍（此断言防回归）',
   naiveVolSum > tx.totalVol * 3);

// 均价 = 累计额 / (累计手数 × 100)
const lastCumV = 133500, lastCumA = 120800000;
ok('均价按累计额/累计量计算',
   Math.abs(tx.pts[4].avg - lastCumA / (lastCumV * 100)) < 1e-6,
   'avg=' + tx.pts[4].avg + ' 期望=' + (lastCumA / (lastCumV * 100)));

/* ================= E2. 五档盘口解析 ================= */
group('E2. parseBook —— 五档盘口');
ok('盘口已解析', !!tx.book);
eq('买档 5 条', tx.book.bids.length, 5);
eq('卖档 5 条', tx.book.asks.length, 5);
eq('买一价 = 9.02', tx.book.bids[0].p, 9.02);
eq('买一量 = 5000', tx.book.bids[0].v, 5000);
eq('买五量 = 1000', tx.book.bids[4].v, 1000);
eq('卖一价 = 9.05', tx.book.asks[0].p, 9.05);
eq('卖一量 = 4000', tx.book.asks[0].v, 4000);
eq('卖五量 = 800', tx.book.asks[4].v, 800);

eq('qt 为 null → null', M.parseBook(null), null);
eq('qt 过短 → null', M.parseBook(['1', 'x']), null);
eq('全 0 → null（收盘后无挂单）', M.parseBook(new Array(29).fill('0')), null);

/* ================= E3. 盘口金额格式化 ================= */
group('E3. fmtBookAmt（价 × 手数 × 100）');
eq('9.02 × 5000手 = 451万', M.fmtBookAmt(9.02, 5000), '451万');
eq('17.19 × 30000手 = 5157万', M.fmtBookAmt(17.19, 30000), '5157万');
eq('17.19 × 300000手 = 5.16亿', M.fmtBookAmt(17.19, 300000), '5.16亿');
eq('量为 0 → --', M.fmtBookAmt(9.02, 0), '--');

/* ================= F. 成交量格式化 ================= */
group('F. fmtVol');
eq('不足万手', M.fmtVol(8600), '8600手');
eq('万手', M.fmtVol(123456), '12.35万手');
eq('非法值', M.fmtVol(NaN), '--');

/* ================= 汇总 ================= */
console.log('\n' + '='.repeat(52));
console.log('通过 %d 项，失败 %d 项', pass, fail);
if (fail) {
  console.log('失败项：');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部通过 ✓');
