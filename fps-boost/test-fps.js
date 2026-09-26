/* ==========================================================================
   fps-boost / test-fps.js —— 帧率优化层回归测试

   跑法：node fps-boost/test-fps.js
   覆盖：
   1. setDigitAnim 补丁（DOM 桩运行时校验：值缓存 / 增量更新 / 回退重建）
   2. fps.js 自适应状态机（可控制帧率驱动 rAF，验证降档、升档、冷却、基线自适应）
   3. 主文件注入块完整性 / 幂等性 / CRLF
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

/* ======================================================================
   1. setDigitAnim v2 —— 数字滚动列（DOM 桩）
   ====================================================================== */
console.log('\n=== 1. setDigitAnim v2（数字滚动列） ===');

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    _kids: [],
    _text: null,
    _cls: new Set(),
    offsetHeight: 120,
    dataset: {},
    style: {},
    className: '',
    classList: {
      add(c) { el._cls.add(c); },
      remove(c) { el._cls.delete(c); },
      contains(c) { return el._cls.has(c); },
    },
    get children() { return el._kids; },
    get firstChild() { return el._kids[0] || null; },
    get childElementCount() { return el._kids.length; },
    appendChild(c) { el._kids.push(c); return c; },
    get textContent() {
      if (el._text !== null) return el._text;
      return el._kids.map(k => k.textContent).join('');
    },
    set textContent(v) { el._text = v; el._kids = []; },
    set innerHTML(v) { el._kids = []; el._text = null; },
  };
  return el;
}

/* 计数桩：统计 createElement 次数 */
let created = 0;
const doc = {
  createElement(tag) { created++; return makeEl(tag); },
};

/* 从主文件里抽出 setDigitAnim 的当前实现，在桩环境跑 */
const html = fs.readFileSync(INDEX, 'utf8');
const fnSrc = (function () {
  const i = html.indexOf('function setDigitAnim(el, val) {');
  if (i < 0) return null;
  const j = html.indexOf('\n}', i);
  return html.slice(i, j + 2);
})();

ok('能从主文件抽出 setDigitAnim', !!fnSrc);
ok('是 v2 滚动列实现', fnSrc.includes('FPS:digit-cache v2'), fnSrc.slice(0, 80));

const sandbox = { document: doc, String, console, Number };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fnSrc.replace(/\r\n/g, '\n'), sandbox, { filename: 'setDigitAnim' });
const setDigitAnim = sandbox.setDigitAnim;

function colOf(el, i) { return el.__dgCols[i]; }

/* --- 场景 A：首次渲染（922.50 → 5 个数字位 + 1 个 '.'） --- */
created = 0;
let el = makeEl();
setDigitAnim(el, '922.50');
const wins = el._kids.filter(k => k.className === 'dg-win');
const fixes = el._kids.filter(k => k.className === 'dg-fix');
eq('数字位窗口数 = 5', wins.length, 5);
eq('静态位（小数点）数 = 1', fixes.length, 1);
eq('静态位内容', fixes[0].textContent, '.');
eq('每列 0-9 十格', wins[0]._kids[0]._kids.length, 10);
eq('第 1 位滚动到 9', colOf(el, 0).style.transform, 'translateY(-10.08em)');
eq('末位 0 在原位', colOf(el, 4).style.transform, 'translateY(-0.00em)');
ok('首次渲染创建了节点', created > 0);

/* --- 场景 B：同值重复调用 → 零操作 --- */
created = 0;
const colRef = colOf(el, 0);
const tfRef = colRef.style.transform;
setDigitAnim(el, '922.50');
eq('同值调用不创建节点', created, 0);
ok('列对象未替换', colOf(el, 0) === colRef);
eq('transform 未被重写', colRef.style.transform, tfRef);

/* --- 场景 C：同结构增量（922.50 → 921.80） --- */
created = 0;
setDigitAnim(el, '921.80');
eq('同结构不重建', created, 0);
ok('列对象被复用', colOf(el, 0) === colRef);
eq('位 3 滚动 2→1', colOf(el, 2).style.transform, 'translateY(-1.12em)');
eq('位 4 滚动 5→8', colOf(el, 3).style.transform, 'translateY(-8.96em)');
eq('未变位 9 不动', colOf(el, 0).style.transform, 'translateY(-10.08em)');
eq('未变位 0 不动', colOf(el, 4).style.transform, 'translateY(-0.00em)');

/* --- 场景 D：只有末位变（921.80 → 921.81） --- */
const c4 = colOf(el, 3);
setDigitAnim(el, '921.81');
eq('只末位变', colOf(el, 4).style.transform, 'translateY(-1.12em)');
eq('其他位对象未动', colOf(el, 3) === c4, true);

/* --- 场景 E：结构变化（出现 '%'）→ 重建 --- */
created = 0;
setDigitAnim(el, '+1.35%');
ok('结构变化时重建', created > 0, `created=${created}`);
eq('新结构数字位 = 3', el.__dgCols.length, 3);
eq('新结构静态位 = 3（+ . %）', el.__dgFix.length, 3);
eq('静态位依次为 + . %', el.__dgFix.map(f => f.textContent).join(''), '+.%');

/* --- 场景 F：负号与小数（-12.34） --- */
el = makeEl();
setDigitAnim(el, '-12.34');
eq('负号是静态位', el.__dgFix[0].textContent, '-');
eq('数字位 = 4', el.__dgCols.length, 4);
eq('位 1 滚到 1', colOf(el, 0).style.transform, 'translateY(-1.12em)');

/* --- 场景 G：千分位逗号（1,234） --- */
el = makeEl();
setDigitAnim(el, '1,234');
eq('逗号是静态位', el.__dgFix[0].textContent, ',');
eq('数字位 = 4', el.__dgCols.length, 4);

/* --- 场景 H：v2 不再产出 t-digit / is-animating --- */
el = makeEl();
setDigitAnim(el, '123');
const hasTDigit = el._kids.some(k => k.className === 't-digit');
ok('不再产出 .t-digit（旧入场动画结构）', !hasTDigit);

/* ======================================================================
   2. fps.js 自适应状态机
   ====================================================================== */
console.log('\n=== 2. 自适应帧率状态机 ===');

function loadFps(sessionQ) {
  const store = {};
  if (sessionQ) store['fps-boost-quality'] = sessionQ;

  const rafQueue = [];
  const el = {
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
    getAttribute(k) { return this._attrs[k]; },
    hasAttribute(k) { return k in this._attrs; },
  };

  const sandbox = {
    console: { log() {} },
    Date,
    Math,
    requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame() {},
    sessionStorage: {
      getItem(k) { return k in store ? store[k] : null; },
      setItem(k, v) { store[k] = v; },
      removeItem(k) { delete store[k]; },
    },
    document: {
      readyState: 'complete',
      hidden: false,
      documentElement: el,
      addEventListener() {},
    },
    matchMedia: () => ({ matches: false }),
    window: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(HERE, 'fps.js'), 'utf8').replace(/\r\n/g, '\n'),
    sandbox, { filename: 'fps.js' });

  return { sandbox, rafQueue, el, store };
}

/* 以指定 fps 推进 ms 毫秒，驱动 rAF 回调 */
function drive(h, ms, fps) {
  const frameMs = 1000 / fps;
  let t = h.t;
  const end = t + ms;
  while (t < end) {
    t += frameMs;
    const cbs = h.rafQueue.splice(0);
    for (const cb of cbs) cb(t);
  }
  h.t = t;
}

function newHarness(sessionQ) {
  const h = loadFps(sessionQ);
  h.t = 0;
  return h;
}

/* --- 基线测定 + 掉帧降档 --- */
let h = newHarness();
drive(h, 3200, 60);                                     // 预热：3 个 1s 窗口
eq('基线测定为 60fps', h.sandbox.__fpsBoost.state().baseline, 60);
eq('预热后仍是 high 档', h.sandbox.__fpsBoost.state().quality, 'high');
ok('high 档不设 data-fps-q 属性', !h.el.hasAttribute('data-fps-q'));

drive(h, 2100, 30);                                     // 掉到 30fps（= 基线 50%）
eq('连续掉帧后降到 medium', h.sandbox.__fpsBoost.state().quality, 'medium');
eq('已写出 data-fps-q', h.el.getAttribute('data-fps-q'), 'medium');

drive(h, 2100, 20);                                     // 继续掉
eq('再掉帧后降到 low', h.sandbox.__fpsBoost.state().quality, 'low');
eq('low 档属性正确', h.el.getAttribute('data-fps-q'), 'low');

/* --- low 已到底，不再继续降 --- */
drive(h, 4000, 10);
eq('low 是最后一档，不再下探', h.sandbox.__fpsBoost.state().quality, 'low');

/* --- 恢复升档（需连续流畅 + 冷却） --- */
drive(h, 30000, 60);
const afterRecover = h.sandbox.__fpsBoost.state().quality;
ok('长时间恢复后升档', afterRecover !== 'low', `实际 ${afterRecover}`);

/* --- 灰色地带不抖动 --- */
h = newHarness();
drive(h, 3200, 60);
drive(h, 5000, 48);                                     // 48/60 = 80%，落在 72%~88% 灰色带
eq('灰色地带保持不变档（不抖动）', h.sandbox.__fpsBoost.state().quality, 'high');

/* --- 基线自适应高刷屏 --- */
h = newHarness();
drive(h, 3200, 120);                                    // 120Hz 屏
eq('高刷屏基线为 120fps', h.sandbox.__fpsBoost.state().baseline, 120);
drive(h, 2100, 60);                                     // 60/120 = 50% → 掉帧
eq('高刷屏掉到一半时降档', h.sandbox.__fpsBoost.state().quality, 'medium');

/* --- 档位记忆 --- */
h = newHarness('medium');
eq('刷新后沿用上次档位', h.sandbox.__fpsBoost.state().quality, 'medium');
eq('属性同步恢复', h.el.getAttribute('data-fps-q'), 'medium');

/* --- 手动接口 --- */
h = newHarness();
ok('setQuality 接受合法值', h.sandbox.__fpsBoost.setQuality('low') === true);
eq('手动设置生效', h.el.getAttribute('data-fps-q'), 'low');
ok('setQuality 拒绝非法值', h.sandbox.__fpsBoost.setQuality('ultra') === false);
h.sandbox.__fpsBoost.reset();
eq('reset 回到 high', h.sandbox.__fpsBoost.state().quality, 'high');
ok('reset 移除属性', !h.el.hasAttribute('data-fps-q'));
eq('reset 清掉记忆', h.store['fps-boost-quality'], undefined);

/* --- 系统减少动效时不干预 --- */
(function () {
  const store = {};
  const el = { _a: {}, setAttribute(k, v) { this._a[k] = v; }, removeAttribute(k) { delete this._a[k]; }, hasAttribute(k) { return k in this._a; }, getAttribute(k) { return this._a[k]; } };
  const sandbox = {
    console: { log() {} }, Date, Math,
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { readyState: 'complete', hidden: false, documentElement: el, addEventListener() {} },
    matchMedia: () => ({ matches: true }),
  };
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(HERE, 'fps.js'), 'utf8').replace(/\r\n/g, '\n'), sandbox, { filename: 'fps.js' });
  eq('系统偏好减少动效 → 监控停用', sandbox.__fpsBoost.state().disabled, true);
})();

/* --- 页面隐藏时不采样 --- */
h = newHarness();
drive(h, 3200, 60);
h.sandbox.document.hidden = true;
drive(h, 3200, 10);                                     // 隐藏期间疯狂掉帧
eq('页面隐藏期间不降档', h.sandbox.__fpsBoost.state().quality, 'high');

/* ======================================================================
   3. 注入块完整性
   ====================================================================== */
console.log('\n=== 3. 注入块与主文件 ===');

const page = fs.readFileSync(INDEX, 'utf8');

eq('FPS:CSS 块 1 组', (page.match(/<!-- FPS:CSS:BEGIN -->/g) || []).length, 1);
eq('FPS:JS 块 1 组', (page.match(/<!-- FPS:JS:BEGIN -->/g) || []).length, 1);
ok('样式标签存在', page.includes('<style id="fps-style">'));
ok('脚本标签存在', page.includes('<script id="fps-js">'));
ok('补丁标记存在', page.includes('FPS:digit-cache'));
ok('值缓存字段存在', page.includes('el.__tDigitVal'));
ok('自适应接口存在', page.includes('window.__fpsBoost'));
eq('setDigitAnim 只有一个定义', (page.match(/function setDigitAnim\(el, val\) \{/g) || []).length, 1);
ok('降级规则 medium', page.includes('data-fps-q="medium"'));
ok('降级规则 low', page.includes('data-fps-q="low"'));
ok('视口外跳过渲染', page.includes('content-visibility: auto'));
ok('装饰层合成提升', page.includes('body::before,') && page.includes('translateZ(0)'));

/* 其它模块的块未被破坏 */
eq('MC 块仍在', (page.match(/<!-- MC:CSS:BEGIN -->/g) || []).length, 1);
eq('PB 块仍在', (page.match(/<!-- PB:CSS:BEGIN -->/g) || []).length, 1);
eq('BFX 块仍在', (page.match(/<!-- BFX:CSS:BEGIN -->/g) || []).length, 1);
eq('SE 块仍在', (page.match(/<!-- SE:CSS:BEGIN -->/g) || []).length, 1);
eq('QF 块仍在', (page.match(/<!-- QF:JS:BEGIN -->/g) || []).length, 1);

/* 纯 CRLF */
const crlf = (page.match(/\r\n/g) || []).length;
const lf = (page.match(/\n/g) || []).length;
eq('无裸 LF（纯 CRLF）', lf - crlf, 0);
ok('收尾完整', page.trimEnd().endsWith('</html>'));

/* 全部内联脚本语法 */
(function () {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m, total = 0, bad = 0;
  while ((m = re.exec(page))) {
    if (/\bsrc=/.test(m[1])) continue;
    total++;
    try { new vm.Script(m[2].replace(/\r\n/g, '\n')); } catch (e) { bad++; console.log('      语法错误：' + e.message); }
  }
  ok(`全部内联脚本语法可解析（${total} 个）`, bad === 0);
})();

/* 视觉默认档不变：high 档不应有任何降级规则命中 */
ok('默认档不触发降级（无 data-fps-q 属性时不生效）',
  page.includes('html[data-fps-q="medium"]') && !page.includes('[data-fps-q="high"]'));

console.log('\n' + '='.repeat(52));
console.log(`  通过 ${pass} 项 / 失败 ${fail} 项`);
console.log('='.repeat(52) + '\n');
process.exit(fail ? 1 : 0);
