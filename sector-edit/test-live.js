/* ==========================================================================
   sector-edit 真实链路回归测试（需要联网）
   --------------------------------------------------------------------------
   为什么要有这个文件：
   之前的单测只验证「把腾讯原始行喂给 normRows」，而**真实链路中间还有一层**
   quote-fallback 的 fetchQQBoards，它把腾讯板块转成了东财同形的 f12/f14 字段。
   normRows 看到 f12 就加 '90.' 前缀 → '90.pt01801131' 通不过格式校验
   → 927 条板块被整批丢弃 → 面板只剩静态兜底那 5 个。
   单测通过、线上照坏。**验证路径必须等于运行路径**，所以这里：
     · 拉真实腾讯数据
     · 走真实的字段转换（模拟 fetchQQBoards 的输出）
     · 调用从 index.html 里抽出的真实 normRows / dedupe / fetchQQDirect
   用法：node sector-edit/test-live.js
   ========================================================================== */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

const HERE = __dirname;
const INDEX = path.join(HERE, '..', 'index.html');

let PASS = 0, FAIL = 0;
function ok(label, cond, extra) {
  if (cond) { PASS++; console.log('  [OK] ' + label); }
  else { FAIL++; console.log('  [X]  ' + label + (extra !== undefined ? '  → ' + extra : '')); }
}

const html = fs.readFileSync(INDEX, 'utf8');

/* 从 index.html 里抽出真实函数体（注入后的版本，与浏览器执行的一致） */
function extract(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('主文件中未找到 ' + name);
  let depth = 0, j = i;
  for (; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return html.slice(i, j).replace(/\r\n/g, '\n');
}

/* 已添加的 6 个默认板块（东财码 + 名字双索引，模拟真实 addedMap） */
const DEFAULT6 = [['90.BK1128', 'CPO'], ['90.BK0890', 'MLCC'], ['90.BK1136', '光通信'],
                  ['90.BK1629', 'AI应用'], ['90.BK0428', '电力'], ['90.BK1134', '算力租赁']];

const sb = {
  console,
  addedMap: function () {
    const m = {};
    DEFAULT6.forEach(function (p) { m[p[0]] = 1; m['n:' + p[1]] = 1; });
    return m;
  },
};
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(extract('normRows') + '\n' + extract('dedupe'), sb, { filename: 'se-fns' });

const QQ = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/mktHs/rank?l=500&p=';
const get = (t, p) => fetch(QQ + p + '&t=' + t + '/averatio&ordertype=0')
  .then(r => r.json()).then(j => (j && j.data) || []);

(async function main() {
  console.log('\n=== sector-edit 真实链路回归（联网） ===\n');

  let ind, c1, c2;
  try {
    [ind, c1, c2] = await Promise.all([get('01', 1), get('02', 1), get('02', 2)]);
  } catch (e) {
    console.log('  [!] 腾讯接口不可达，跳过联网断言：' + e.message);
    console.log('      （离线环境属正常，静态断言仍在下面跑）\n');
    ind = c1 = c2 = [];
  }
  const raw = ind.concat(c1, c2);
  if (raw.length) console.log('  真实腾讯数据: %d 行（行业 %d + 概念 %d）\n', raw.length, ind.length, c1.length + c2.length);

  /* ---- 场景 1：QF v1.2.0 输出（带 secid）—— 真实运行格式 ---- */
  console.log('场景 1 · quote-fallback 新格式（带 secid）');
  if (raw.length) {
    const v12 = raw.map(x => ({
      secid: 'qq.' + x.bd_code, name: x.bd_name,
      bd_code: x.bd_code, bd_name: x.bd_name,
      f12: x.bd_code, f14: x.bd_name, f3: parseFloat(x.bd_zdf), _src: 'qq',
    }));
    const r1 = sb.normRows(v12);
    ok('normRows 保留全部 ' + raw.length + ' 行', r1.length === raw.length, r1.length);
    ok('secid 形如 qq.pt0…', /^qq\.pt0/.test(r1[0].secid), r1[0].secid);

    const d1 = sb.dedupe(r1);
    const removed = raw.length - d1.length;
    ok('dedupe 剔除 5~7 个已添加板块', removed >= 5 && removed <= 7,
       '剔除 ' + removed + '，剩 ' + d1.length + ' 可选');
    ok('可选总数 ≥ 800（修复前只有 5）', d1.length >= 800, d1.length);

    const names = new Set(d1.map(s => s.name));
    ['共封装光模块(CPO）', '数字货币', '存储器', '长鑫存储', '机器人概念', '低空经济']
      .forEach(k => ok('「' + k + '」可添加', names.has(k)));
    ['光通信', '算力租赁', '电力'].forEach(k =>
      ok('「' + k + '」（已添加）已剔除', !names.has(k)));
    const hbm = d1.filter(s => /HBM|高带宽/.test(s.name)).map(s => s.name);
    ok('HBM 相关板块存在', hbm.length > 0, hbm.join(' / ') || '无');
  } else {
    console.log('  （跳过，无联网数据）');
  }

  /* ---- 场景 2：旧格式兼容（只有 f12，无 secid）—— 回归防复发 ---- */
  console.log('\n场景 2 · 旧格式兼容（只有 f12/f14）');
  if (raw.length) {
    const v11 = raw.map(x => ({ f12: x.bd_code, f14: x.bd_name, f3: parseFloat(x.bd_zdf), _src: 'qq' }));
    const r2 = sb.normRows(v11);
    ok('旧格式也能全量转换（前缀分流生效）', r2.length === raw.length, r2.length);
    ok('腾讯码识别为 qq. 而非 90.', /^qq\.pt0/.test(r2[0].secid), r2[0].secid);
  } else {
    console.log('  （跳过，无联网数据）');
  }

  /* ---- 场景 3：东财格式不能被误伤（静态） ---- */
  console.log('\n场景 3 · 东财 BK 码仍走 90. 前缀');
  const r3 = sb.normRows([
    { secid: '90.BK1136', name: '光通信' },
    { f12: 'BK0890', f14: 'MLCC' },
    { code: 'BK9999', name: '测试板块' },
  ]);
  ok('三条全部转换', r3.length === 3, r3.length);
  ok('secid 均为 90.BK…', r3.every(s => s.secid.indexOf('90.BK') === 0),
     JSON.stringify(r3.map(s => s.secid)));

  /* ---- 场景 4：脏数据不污染（静态，曾导致整批崩溃） ---- */
  console.log('\n场景 4 · 元素级脏数据过滤');
  const r4 = sb.normRows([
    { bd_code: '', bd_name: '无码' }, { bd_code: 'pt0X', bd_name: '' },
    { f12: '', f14: '' }, { secid: 'qq.pt0OK', name: '正常' }, null, undefined, 'str', 0,
  ]);
  ok('仅保留 1 条合法行（null/undefined/字符串不崩）',
     r4.length === 1 && r4[0].name === '正常', JSON.stringify(r4));

  /* ---- 场景 5：fetchQQDirect 自包含兜底（QF 模块缺席时） ---- */
  console.log('\n场景 5 · fetchQQDirect 自包含兜底');
  const sb2 = { console, fetch, Promise, Error };
  sb2.globalThis = sb2; sb2.window = sb2;   // window.QF 不存在 → 走自包含分支
  vm.createContext(sb2);
  vm.runInContext(extract('fetchQQDirect') + '\n' + extract('fetchQQAll'), sb2, { filename: 'qq-direct' });
  try {
    const rows5 = await sb2.fetchQQAll();
    ok('无 QF 时仍返回全量', rows5.length >= 800, rows5.length);
    ok('直接产出目标格式 secid', /^qq\.\w+$/.test(rows5[0].secid), JSON.stringify(rows5[0]));
  } catch (e) {
    console.log('  [!] 跳过（' + e.message + '）');
  }

  /* ---- 场景 6：静态特征在位 ---- */
  console.log('\n场景 6 · 源码关键特征');
  ok('normRows 按 f12 前缀分流', html.indexOf('BK/i.test(r.f12)') >= 0);
  ok('normRows 有元素级 null 守卫', html.indexOf("typeof r !== 'object'") >= 0);
  ok('refreshAll 双源并行竞速（腾讯 + 东财同时发起）',
     html.indexOf("fetchQQAll().then(function (rows) { apply(rows, '腾讯源'); })") >= 0 &&
     html.indexOf("apply(normRows(rs[0].concat(rs[1])), '东财源')") >= 0);
  ok('面板显示数据来源', html.indexOf("' · ' + panel.__src") >= 0);
  ok('两路都不通时给明确提示', html.indexOf('接口暂不可用，可重开面板重试') >= 0);
  ok('loadSectors 腾讯兜底有模糊名字匹配', html.indexOf('const fuzzyName = (name) =>') >= 0);
  ok('东财页超时已收紧为 2500ms', html.indexOf('QH.fetchJson(url, 2500)') >= 0);
  ok('面板 pending 不谎报可选数', html.indexOf('正在获取全部板块') >= 0);
  ok('normRows 不再是「一律 90.」', html.indexOf("'90.' + r.f12; name = r.f14") < 0);

  console.log('\n' + '='.repeat(52));
  console.log('  通过 %d 项 / 失败 %d 项', PASS, FAIL);
  console.log('='.repeat(52) + '\n');
  process.exit(FAIL ? 1 : 0);
})();
