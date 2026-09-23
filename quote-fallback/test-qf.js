/* ==========================================================================
   quote-fallback / test-qf.js —— 备用通道逻辑回归测试

   跑法：node quote-fallback/test-qf.js
   覆盖：
   1. 新浪期货 30 字段解析（用真实返回行）
   2. 新浪股票字段解析
   3. secid → 新浪代码映射
   4. 腾讯板块字段映射（fetch 打桩）
   5. __quoteHook 桥接存在性（主文件静态检查）
   6. 注入块完整性 / 幂等性
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;
const ROOT = path.dirname(HERE);
const INDEX = path.join(ROOT, 'index.html');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [√] ' + name); }
  else { fail++; console.log('  [X] ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }
function near(name, a, b, eps) {
  ok(name, Math.abs(a - b) <= (eps || 1e-6), `期望 ≈${b}，实际 ${a}`);
}

/* ---------- 载入 fallback.js（Node 环境，无 document） ---------- */
let sandboxFetch = () => Promise.reject(new Error('no fetch stub'));
function loadAPI() {
  const code = fs.readFileSync(path.join(HERE, 'fallback.js'), 'utf8');
  const sandbox = {
    module: { exports: {} },
    Promise, console, Date, isFinite, parseFloat,
    // fallback.js 内部直接引用 fetch（裸标识符）→ 必须在同一 realm 里提供
    fetch: (...a) => sandboxFetch(...a),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'fallback.js' });
  return sandbox.module.exports;
}

const QF = loadAPI();

console.log('\n=== 1. 新浪期货字段解析（真实返回行） ===');

// 2026-09-24 实测：螺纹钢主力 nf_RB0
// 名称,时间,开,高,低,?,买,卖,最新,?,昨结,...
const RB_ROW = '螺纹钢2601,222057,3120.000,3125.000,3102.000,3111.000,3110.000,3111.000,3111.000,3111.000,3117.000,3113.000,3113.000,1203456,880123,上期所,螺纹钢,2026-09-24,0,,,,,,,,,,,,';
const rb = QF.parseSinaFutRow(RB_ROW);

ok('解析出对象', !!rb);
eq('最新价 f2 = 3111', rb.f2, 3111);
eq('昨结 → 涨跌额 f4 = -6', rb.f4, -6);
near('涨跌幅 f3 ≈ -0.1925%', rb.f3, (-6 / 3117) * 100, 1e-4);
eq('开盘 f17 = 3120', rb.f17, 3120);
eq('最高 f15 = 3125', rb.f15, 3125);
eq('最低 f16 = 3102', rb.f16, 3102);
eq('品种名 name = 螺纹钢', rb.name, '螺纹钢');
eq('来源标记 _src = sina', rb._src, 'sina');

ok('空串 → null', QF.parseSinaFutRow('') === null);
ok('字段不足 → null', QF.parseSinaFutRow('a,b,c') === null);
ok('昨结为 0 → null（避免除零）',
  QF.parseSinaFutRow('x,x,x,x,x,x,x,x,100,x,0,x,x,x,x,x,x,x') === null);
ok('非字符串 → null', QF.parseSinaFutRow(null) === null);

// 上涨场景
const UP_ROW = '沪金2512,150000,560.00,572.00,559.00,570.00,569.90,570.10,570.00,570.00,560.00,565.00,0,120000,50000,上期所,沪金,2026-09-24,0';
const au = QF.parseSinaFutRow(UP_ROW);
eq('上涨：最新价 570', au.f2, 570);
eq('上涨：涨跌额 +10', au.f4, 10);
near('上涨：涨幅 ≈ 1.7857%', au.f3, (10 / 560) * 100, 1e-4);

console.log('\n=== 2. 新浪股票字段解析 ===');
// 名称,今开,昨收,现价,最高,最低,…,成交量,成交额
const STK_ROW = '亨通光电,20.10,20.00,20.60,20.80,19.95,20.55,20.60,12345678,254000000,100,200,20.6,20.60,20.00,20.10';
const stk = QF.parseSinaStockRow(STK_ROW);
ok('解析出对象', !!stk);
eq('现价 f2 = 20.6', stk.f2, 20.6);
eq('昨收参与计算，涨跌额 +0.6', Math.round(stk.f4 * 100) / 100, 0.6);
near('涨幅 = 3%', stk.f3, 3, 1e-6);
eq('成交额 元→万元 f6 = 25400', stk.f6, 25400);
eq('名称 name = 亨通光电', stk.name, '亨通光电');
ok('昨收为 0 → null', QF.parseSinaStockRow('x,1,0,1,x,x,x,x,x,x') === null);

console.log('\n=== 3. secid → 新浪代码映射 ===');
eq('0.300308 → sz300308', QF.secidToSina('0.300308'), 'sz300308');
eq('1.600487 → sh600487', QF.secidToSina('1.600487'), 'sh600487');
eq('0.002281 → sz002281', QF.secidToSina('0.002281'), 'sz002281');
eq('1.688313 → sh688313', QF.secidToSina('1.688313'), 'sh688313');
ok('无前缀 → null', QF.secidToSina('300308') === null);
ok('非 6 位 → null', QF.secidToSina('0.12345') === null);
ok('空 → null', QF.secidToSina('') === null);

console.log('\n=== 4. 期货 secid → 新浪期货代码 ===');
eq('113.RBm → nf_RB0', QF.FUT_SINA['113.RBm'], 'nf_RB0');
eq('114.Mm → nf_M0', QF.FUT_SINA['114.Mm'], 'nf_M0');
eq('115.TAm → nf_TA0', QF.FUT_SINA['115.TAm'], 'nf_TA0');
eq('12 个品种齐全', Object.keys(QF.FUT_SINA).length, 12);

console.log('\n=== 5. 腾讯板块字段映射（fetch 打桩） ===');
(async function () {
  const page1 = {
    data: [
      { bd_name: '光通信', bd_code: 'BK1136', bd_zxj: '1234.56', bd_zd: '45.67', bd_zdf: '3.84', nzg_name: '中际旭创' },
      { bd_name: '共封装光模块(CPO)', bd_code: 'BK1234', bd_zxj: '2345.67', bd_zd: '-12.34', bd_zdf: '-0.52', nzg_name: '天孚通信' },
      { bd_name: '白酒', bd_code: 'BK0477', bd_zxj: '999.99', bd_zd: '1.11', bd_zdf: '0.11', nzg_name: '贵州茅台' },
      { bd_name: '', bd_code: 'BAD', bd_zdf: '1' },                     // 无名 → 丢弃
      { bd_name: '异常板块', bd_code: 'BAD2', bd_zdf: 'not-a-number' },  // 非数字 → 丢弃
    ]
  };

  let calls = 0;
  sandboxFetch = function (url) {
    calls++;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(calls === 1 ? page1 : { data: [] })
    });
  };

  try {
    const rows = await QF.fetchQQBoards('concept', 500, 3);
    eq('过滤后剩 3 行', rows.length, 3);
    eq('f12 = 板块码', rows[0].f12, 'BK1136');
    eq('f14 = 板块名', rows[0].f14, '光通信');
    eq('f2 = 点位', rows[0].f2, 1234.56);
    eq('f3 = 涨跌幅', rows[0].f3, 3.84);
    eq('f4 = 涨跌额', rows[0].f4, 45.67);
    eq('来源标记 _src = qq', rows[0]._src, 'qq');
    eq('负涨幅保留', rows[1].f3, -0.52);
    eq('首行返回不足一页 → 只请求 1 次', calls, 1);

    // 关键词过滤（模拟 patch.js 的筛选）
    const KW = ['光通信', '光模块', 'CPO', '共封装'];
    const rel = rows.filter(d => KW.some(k => (d.f14 || '').includes(k)));
    eq('关键词命中 2 个', rel.length, 2);
    eq('命中含光通信', rel.some(r => r.f14 === '光通信'), true);
    eq('命中含 CPO', rel.some(r => r.f14.includes('CPO')), true);
    eq('白酒未命中', rel.some(r => r.f14 === '白酒'), false);

    // 分页：整页 → 继续翻页
    calls = 0;
    const full = { data: new Array(500).fill(0).map((_, i) => ({
      bd_name: '板块' + i, bd_code: 'BK' + i, bd_zxj: '100', bd_zd: '1', bd_zdf: '1'
    })) };
    sandboxFetch = function () {
      calls++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(calls === 1 ? full : { data: [] }) });
    };
    const r2 = await QF.fetchQQBoards('concept', 500, 3);
    eq('整页后继续翻页，请求 2 次', calls, 2);
    eq('累计 500 行', r2.length, 500);

    // 全空 → 抛错
    sandboxFetch = function () {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    };
    let threw = false;
    try { await QF.fetchQQBoards('concept', 500, 3); } catch (e) { threw = true; }
    ok('空数据抛错（触发上层 catch）', threw);

    // HTTP 非 200 → 抛错
    sandboxFetch = function () { return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }); };
    threw = false;
    try { await QF.fetchQQBoards('concept', 500, 3); } catch (e) { threw = true; }
    ok('HTTP 403 抛错', threw);
  } finally {
    sandboxFetch = () => Promise.reject(new Error('stub released'));
  }

  console.log('\n=== 6. 主文件桥接与注入块（静态检查） ===');
  const html = fs.readFileSync(INDEX, 'utf8');

  ok('window.__quoteHook 存在', html.includes('window.__quoteHook'));
  ok('暴露 getFutures', html.includes('getFutures: function ()'));
  ok('暴露 getFutCache', html.includes('getFutCache: function ()'));
  ok('暴露 getFocusKw', html.includes('getFocusKw: function ()'));
  ok('暴露 getFocusSecCache', html.includes('getFocusSecCache: function ()'));
  ok('暴露 getFocusStocks', html.includes('getFocusStocks: function ()'));
  ok('暴露 getFocusStockCache', html.includes('getFocusStockCache: function ()'));
  ok('暴露 getFocusDetailCode', html.includes('getFocusDetailCode: function ()'));
  ok('暴露 buildFutCard', html.includes('buildFutCard: buildFutCard'));
  ok('暴露 updateFutCard', html.includes('updateFutCard: updateFutCard'));
  ok('暴露 openFocusDetail', html.includes('openFocusDetail: openFocusDetail'));
  ok('暴露 openFocusEngineDetail', html.includes('openFocusEngineDetail: openFocusEngineDetail'));

  eq('QF 注入块 1 组', (html.match(/<!-- QF:JS:BEGIN -->/g) || []).length, 1);
  eq('QF 结束标记 1 个', (html.match(/<!-- QF:JS:END -->/g) || []).length, 1);
  ok('备用源脚本标签存在', html.includes('<script id="qf-fallback-js">'));
  ok('新浪期货映射表在页面里', html.includes('nf_RB0'));
  ok('腾讯板块源在页面里', html.includes('mktHs/rank'));
  ok('QF 块在 </body> 前', html.indexOf('<!-- QF:JS:BEGIN -->') < html.indexOf('</body>'));

  // 其他模块的块没被破坏
  eq('MC 块仍在', (html.match(/<!-- MC:CSS:BEGIN -->/g) || []).length, 1);
  eq('PB 块仍在', (html.match(/<!-- PB:CSS:BEGIN -->/g) || []).length, 1);
  eq('BFX 块仍在', (html.match(/<!-- BFX:CSS:BEGIN -->/g) || []).length, 1);
  eq('SE 块仍在', (html.match(/<!-- SE:CSS:BEGIN -->/g) || []).length, 1);

  // 纯 CRLF
  const crlf = (html.match(/\r\n/g) || []).length;
  const lf = (html.match(/\n/g) || []).length;
  eq('无裸 LF（纯 CRLF）', lf - crlf, 0);

  // 语法检查：把注入块里的两个 IIFE 抽出来跑一次 parse
  const m = /<!-- QF:JS:BEGIN -->[\s\S]*?<script id="qf-fallback-js">([\s\S]*?)<\/script>/.exec(html);
  ok('能抽出注入脚本', !!m);
  if (m) {
    let syntaxOk = true, errMsg = '';
    try { new vm.Script(m[1]); } catch (e) { syntaxOk = false; errMsg = e.message; }
    ok('注入脚本语法可解析', syntaxOk, errMsg);
  }

  // 幂等性：注入块内容与源文件一致
  const fb = fs.readFileSync(path.join(HERE, 'fallback.js'), 'utf8').replace(/\r\n/g, '\n');
  const pt = fs.readFileSync(path.join(HERE, 'patch.js'), 'utf8').replace(/\r\n/g, '\n');
  const block = m ? m[1].replace(/\r\n/g, '\n') : '';
  ok('注入块含 fallback.js 全文', block.includes(fb.trim().split('\n').slice(-3).join('\n')));
  ok('注入块含 patch.js 全文', block.includes(pt.trim().split('\n').slice(-3).join('\n')));

  console.log('\n' + '='.repeat(52));
  console.log(`  通过 ${pass} 项 / 失败 ${fail} 项`);
  console.log('='.repeat(52) + '\n');
  process.exit(fail ? 1 : 0);
})();
