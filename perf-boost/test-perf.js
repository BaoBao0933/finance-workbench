/* ==========================================================================
   perf-boost / test-perf.js —— 首屏加速模块回归测试
   用最小 DOM 桩验证 perf.js 的关键行为，不依赖浏览器。
   运行：node perf-boost/test-perf.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    style: {},
    _class: [],
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; this[k] = v; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      c.parentNode = null; return c;
    },
    prepend(c) { c.parentNode = this; this.children.unshift(c); return c; },
    querySelector() { return this._q || null; },
    querySelectorAll() { return this._qa || []; },
    classList: {
      add() {}, remove() {}, contains() { return false; },
      toggle() {}
    },
  };
  return el;
}

function runPerfJs(html) {
  // 从注入后的 index.html 里抽出 perf.js 真实内容
  const m = html.match(/<!-- PB:JS:BEGIN -->\s*<script id="pb-js">\s*([\s\S]*?)\s*<\/script>/);
  if (!m) throw new Error('未在 index.html 中找到 PB:JS 注入块');

  const head = makeEl('head');
  const body = makeEl('body');
  const removed = [];
  const appended = [];

  const fontLinks = [
    { tagName: 'LINK', attrs: { href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk&display=swap' }, parentNode: head },
    { tagName: 'LINK', attrs: { href: 'https://fonts.gstatic.com/x.woff2' }, parentNode: head },
  ];
  fontLinks.forEach(l => head.children.push(l));

  const listeners = {};
  const timers = [];

  const documentStub = {
    hidden: false,
    head,
    body,
    documentElement: { setAttribute() {}, getAttribute() { return 'dark'; } },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener() {},
    createElement: makeEl,
    getElementById(id) { return id === 'pb-boot' ? bootEl : null; },
    querySelector(sel) {
      if (sel === '.main') return mainEl;
      return null;
    },
    querySelectorAll(sel) {
      if (/fonts\.googleapis|fonts\.gstatic/.test(sel)) return fontLinks.slice();
      return [];
    },
  };

  const bootEl = makeEl('div');
  bootEl.id = 'pb-boot';
  bootEl.parentNode = body;
  bootEl.classList.add = function () { bootEl._out = true; };

  const mainEl = makeEl('main');
  mainEl.querySelector = () => ({ nodeName: 'DIV' });   // 模拟已有内容

  const sandbox = {
    console,
    document: documentStub,
    window: null,
    performance: { now: () => 1234.5 },
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
    setInterval: (fn, ms) => { timers.push(fn); return 1; },
    clearInterval() {},
    localStorage: { getItem: () => 'dark', setItem() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  sandbox.window.performance = sandbox.performance;
  sandbox.window.matchMedia = () => ({ matches: false });

  const ctx = vm.createContext(sandbox);
  vm.runInContext(m[1], ctx, { filename: 'perf.js' });

  return { listeners, sandbox, head, bootEl, mainEl, timers, removed };
}

console.log('\n=== perf-boost 回归测试 ===\n');

const HTML = fs.readFileSync(path.join(HERE, '..', 'index.html'), 'utf8');

/* ---------- 1. 注入块结构 ---------- */
console.log('[1] 注入块结构');
ok('PB:CSS 标记成对', (HTML.match(/<!-- PB:CSS:BEGIN -->/g) || []).length === 1 &&
                     (HTML.match(/<!-- PB:CSS:END -->/g) || []).length === 1);
ok('PB:JS 标记成对', (HTML.match(/<!-- PB:JS:BEGIN -->/g) || []).length === 1 &&
                    (HTML.match(/<!-- PB:JS:END -->/g) || []).length === 1);
ok('PB:BOOT 标记成对', (HTML.match(/<!-- PB:BOOT:BEGIN -->/g) || []).length === 1 &&
                      (HTML.match(/<!-- PB:BOOT:END -->/g) || []).length === 1);
ok('骨架屏 #pb-boot 已插入', /<div id="pb-boot" class="pb-boot">/.test(HTML));
const bootIdx = HTML.indexOf('id="pb-boot"');
const bodyIdx = HTML.indexOf('</body>');
ok('骨架屏在 </body> 之前', bootIdx > 0 && bootIdx < bodyIdx);
const cssIdx = HTML.indexOf('<!-- PB:CSS:BEGIN -->');
const headEnd = HTML.indexOf('</head>');
ok('PB:CSS 在 </head> 之前', cssIdx > 0 && cssIdx < headEnd);

/* ---------- 2. Google Fonts 已摘除 ---------- */
console.log('\n[2] Google Fonts 摘除');
const hrefFonts = HTML.match(/href="https:\/\/fonts\.(googleapis|gstatic)\.com/g) || [];
ok('无 fonts 域名资源引用', hrefFonts.length === 0, '发现 ' + hrefFonts.length + ' 处');
ok('无 preconnect 残留', !/rel="preconnect"[^>]*fonts\.(googleapis|gstatic)/.test(HTML));
ok('本地字体栈已定义', /--pb-font-sans/.test(HTML) && /--pb-font-mono/.test(HTML));
ok('banner 字体已改本地栈', /\.fun-banner\s*,\s*\n?\.fun-banner \.fb-title\s*\{[\s\S]*?var\(--pb-font-sans\)/.test(HTML));
ok('anime.js CDN 仍保留', /cdn\.jsdelivr\.net\/npm\/animejs/.test(HTML));
ok('anime.js 已改为 defer', /<script\s+defer\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/animejs/.test(HTML));

/* ---------- 2b. 启动链路优化 ---------- */
console.log('\n[2b] 启动链路优化');
ok('首屏并发拉取（requestAnimationFrame 包裹）',
   /requestAnimationFrame\(\(\) => \{[\s\S]{0,400}refresh\(false\)/.test(HTML));
ok('轮询具备后台挂起能力', /if \(document\.hidden\) \{ running = false; return; \}/.test(HTML));
ok('暴露 __pbPollers 注册表', /const __pbPollers = \[\]/.test(HTML));
ok('定义 window.__pbOnVisible', /window\.__pbOnVisible = function/.test(HTML));
ok('旧的单点 visibilitychange 补刷已移除',
   !/addEventListener\('visibilitychange', \(\) => \{\s*if \(!document\.hidden\) refresh\(false\);/.test(HTML));
ok('返回前台会 kick 全部轮询', /__pbPollers\[i\]\.kick\(\)/.test(HTML));

/* ---------- 3. 原有特征未被破坏 ---------- */
console.log('\n[3] 原有特征完整性');
const mustKeep = ['<aside class="sidebar">', '<main class="main">', 'function jsonp(',
  'async function fetchJson(', 'function setDigitAnim(', 'animeEntrance', '.fx-tilt',
  'id="watch-list"', 'id="pos-list"', 'id="lhb-list"', 'function pollAdaptive(', 'loadSectors(true);'];
mustKeep.forEach(k => ok('保留 ' + k.slice(0, 34), HTML.includes(k)));

/* ---------- 4. 其它注入模块未被破坏 ---------- */
console.log('\n[4] 其它模块共存');
['MC:CSS', 'MC:BODY', 'BFX:CSS', 'SE:CSS'].forEach(t => {
  ok(t + ' 标记存在', HTML.includes('<!-- ' + t + ':BEGIN -->'));
});

/* ---------- 5. 运行时行为 ---------- */
console.log('\n[5] 运行时行为（DOM 桩）');
let r;
try {
  r = runPerfJs(HTML);
  ok('perf.js 可在沙箱中执行', true);
} catch (e) {
  ok('perf.js 可在沙箱中执行', false, e.message);
}

if (r) {
  ok('立即摘除了 <link href*=fonts...>',
     r.head.children.filter(l => /fonts\.(googleapis|gstatic)/.test(
       l.href || (l.attrs && l.attrs.href) || '')).length === 0,
     '仍残留 ' + r.head.children.filter(l => /fonts\.(googleapis|gstatic)/.test(
       l.href || (l.attrs && l.attrs.href) || '')).length + ' 个');

  // 预连接应在脚本执行时立即注入（不等 DOMContentLoaded），故此处即可断言
  const pre = r.head.children.filter(l => l.rel === 'preconnect');
  ok('注入了 preconnect（行情 4 + CDN 1）', pre.length === 5, '实际 ' + pre.length + ' 个');
  const preHrefs = pre.map(l => l.href || (l.attrs && l.attrs.href) || '');
  ok('preconnect 含 qt.gtimg.cn', preHrefs.indexOf('https://qt.gtimg.cn') >= 0,
     '实际: ' + JSON.stringify(preHrefs));
  ok('preconnect 含 push2', preHrefs.some(h => h.indexOf('push2.eastmoney.com') >= 0),
     '实际: ' + JSON.stringify(preHrefs));
  ok('preconnect 含 anime CDN', preHrefs.indexOf('https://cdn.jsdelivr.net') >= 0,
     '实际: ' + JSON.stringify(preHrefs));
  ok('preconnect 均带 crossOrigin', 
     pre.every(l => l.crossOrigin === 'anonymous' || l.attrs.crossOrigin === 'anonymous'),
     '实际: ' + JSON.stringify(preHrefs));

  // 触发 DOMContentLoaded，确认骨架屏撤除逻辑可用
  const domReady = r.listeners['DOMContentLoaded'] || [];
  ok('注册了 DOMContentLoaded', domReady.length > 0);
  domReady.forEach(fn => fn());
  ok('DOMContentLoaded 后不抛错', true);

  // 可见性开关
  ok('暴露 __pbVisible', typeof r.sandbox.window.__pbVisible === 'boolean');
  const visCb = r.listeners['visibilitychange'] || [];
  ok('注册了 visibilitychange', visCb.length > 0);

  if (visCb.length) {
    let called = false;
    r.sandbox.window.__pbOnVisible = () => { called = true; };
    r.sandbox.document.hidden = true;
    visCb.forEach(fn => fn());
    ok('转入后台时 __pbVisible=false', r.sandbox.window.__pbVisible === false);
    ok('后台不触发补刷', called === false);

    r.sandbox.document.hidden = false;
    visCb.forEach(fn => fn());
    ok('回前台时 __pbVisible=true', r.sandbox.window.__pbVisible === true);
    ok('回前台触发 __pbOnVisible 补刷', called === true);
  }
}

/* ---------- 6. CSS 关键规则 ---------- */
console.log('\n[6] CSS 规则');
ok('骨架屏遮罩规则', /\.pb-boot\s*\{[\s\S]*?position:\s*fixed/.test(HTML));
ok('骨架淡出类', /\.pb-boot--out/.test(HTML));
ok('浅色主题适配', /html\[data-theme="light"\] \.pb-boot/.test(HTML));
ok('减少动效偏好适配', /prefers-reduced-motion[\s\S]{0,200}pb-boot__bar/.test(HTML.replace(/\n/g, ' ')) ||
                      /@media \(prefers-reduced-motion: reduce\)/.test(HTML));
ok('列表项 contain 优化', /#watch-list[\s\S]{0,400}contain:\s*layout style/.test(HTML));
ok('侧栏点击即时反馈', /\.nav-item:active/.test(HTML));

/* ---------- 汇总 ---------- */
console.log('\n' + '─'.repeat(46));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('─'.repeat(46) + '\n');
process.exit(fail === 0 ? 0 : 1);
