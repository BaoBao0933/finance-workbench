/* ==========================================================================
   apple-fx / test-apple.js —— 苹果风质感层回归测试

   跑法：node apple-fx/test-apple.js
   覆盖：
   1. 注入块完整性（CSS / SVG 滤镜 / JS）
   2. 液态玻璃规则的兼容写法与作用域（仅 #page-home .index-card）
   3. 倾斜参数（maxTilt 5°）与交互委托
   4. 与 fps-boost 降档的联动（!important 磨砂规则存在 → 掉帧自动退回磨砂）
   5. apple.js 运行时冒烟（DOM 桩驱动 pointermove）
   6. 语法 / CRLF / 幂等相关静态检查
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

const page = fs.readFileSync(INDEX, 'utf8');

console.log('\n=== 1. 注入块完整性 ===');
eq('AF:CSS 块 1 组', (page.match(/<!-- AF:CSS:BEGIN -->/g) || []).length, 1);
eq('AF:HTML 块 1 组', (page.match(/<!-- AF:HTML:BEGIN -->/g) || []).length, 1);
eq('AF:JS 块 1 组', (page.match(/<!-- AF:JS:BEGIN -->/g) || []).length, 1);
ok('样式标签存在', page.includes('<style id="apple-style">'));
ok('脚本标签存在', page.includes('<script id="apple-js">'));

console.log('\n=== 2. 液态玻璃（SVG 折射滤镜） ===');
eq('apple-lg 滤镜定义 1 个', (page.match(/<filter id="apple-lg"/g) || []).length, 1);
ok('feTurbulence 存在', page.includes('feTurbulence'));
ok('feDisplacementMap 存在', page.includes('feDisplacementMap'));
ok('feGaussianBlur 存在', page.includes('feGaussianBlur'));
// 滤镜参数与 demo 验证过的值一致
ok('位移 scale=22', /feDisplacementMap[^>]*scale="22"/.test(page));
ok('湍流 baseFrequency 0.008', /feTurbulence[^>]*baseFrequency="0\.008 0\.011"/.test(page));
// 引用与定义在同文档
ok('CSS 引用 url(#apple-lg)', page.includes('backdrop-filter: url(#apple-lg)'));

console.log('\n=== 3. 液态玻璃作用域（克制：仅首页指数卡） ===');
// url() 规则必须限定在 #page-home 内，不允许全站 .index-card 上折射
const afCss = (function () {
  const m = /<!-- AF:CSS:BEGIN -->([\s\S]*?)<!-- AF:CSS:END -->/.exec(page);
  return m ? m[1] : '';
})();
ok('AF CSS 块能抽出', afCss.length > 0);
ok('规则限定 #page-home .index-card', afCss.includes('#page-home .index-card'));
ok('AF 内没有不限作用域的折射规则',
  !/^\s*\.index-card\s*\{/m.test(afCss) && !/^\s*\.ov-card\s*\{/m.test(afCss));
eq('折射声明 = 4（常态+hover × 标准+webkit 前缀）',
  (afCss.match(/backdrop-filter: url\(#apple-lg\)/g) || []).length, 4);
ok('blur 常态 22px', afCss.includes('blur(22px)'));
ok('blur hover 26px（比主文件 32px 低，折射替代部分模糊）', afCss.includes('blur(26px)'));

console.log('\n=== 4. 倾斜（maxTilt 5°） ===');
const afJs = (function () {
  const m = /<!-- AF:JS:BEGIN -->[\s\S]*?<script id="apple-js">([\s\S]*?)<\/script>/.exec(page);
  return m ? m[1] : '';
})();
ok('AF JS 块能抽出', afJs.length > 0);
eq('maxTilt = 5（用户要求小角度）', (afJs.match(/MAX_TILT = (\d+)/) || [])[1], '5');
ok('只响应鼠标指针', afJs.includes("e.pointerType !== 'mouse'"));
ok('reduced-motion 整体禁用', afJs.includes('prefers-reduced-motion'));
ok('无 rAF 循环（transition 负责平滑）', !afJs.includes('requestAnimationFrame'));
ok('事件委托（closest）', afJs.includes(".closest('#page-home .index-card')"));
ok('页面切走时复位', afJs.includes('visibilitychange'));

// CSS 侧
ok('倾斜 transform 变量驱动', afCss.includes('rotateX(var(--af-rx'));
ok('perspective 内联在 transform', afCss.includes('perspective(900px)'));
ok('hover 跟手快 / 离开回位慢（双段 transition）',
  afCss.includes('transition: transform .2s ease-out') &&
  afCss.includes('transition: transform .45s'));
ok('reduced-motion 关闭倾斜', afCss.includes('transform: none !important'));

console.log('\n=== 5. 与 fps-boost 降档联动 ===');
// 掉帧降档时，!important 磨砂规则必须能覆盖 url() 折射
ok('medium 档 .index-card 磨砂 !important 存在',
  /html\[data-fps-q="medium"\] \.index-card[^{]*\{[^}]*backdrop-filter:[^}]*!important/.test(page));
ok('low 档 .index-card 磨砂 !important 存在',
  /html\[data-fps-q="low"\] \.index-card[^{]*\{[^}]*backdrop-filter:[^}]*!important/.test(page));
ok('AF 折射规则没有 !important（保证会被降档覆盖）',
  !/backdrop-filter:\s*url\(#apple-lg\)[^;]*!important/.test(afCss));

console.log('\n=== 6. 与其他模块共存 ===');
eq('FPS 块仍在', (page.match(/<!-- FPS:CSS:BEGIN -->/g) || []).length, 1);
eq('MC 块仍在', (page.match(/<!-- MC:CSS:BEGIN -->/g) || []).length, 1);
eq('PB 块仍在', (page.match(/<!-- PB:CSS:BEGIN -->/g) || []).length, 1);
eq('BFX 块仍在', (page.match(/<!-- BFX:CSS:BEGIN -->/g) || []).length, 1);
eq('SE 块仍在', (page.match(/<!-- SE:CSS:BEGIN -->/g) || []).length, 1);
eq('QF 块仍在', (page.match(/<!-- QF:JS:BEGIN -->/g) || []).length, 1);
// AF 块顺序：CSS 在 </head> 前，HTML/JS 在 </body> 前
ok('AF CSS 在 </head> 前', page.indexOf('<!-- AF:CSS:BEGIN -->') < page.indexOf('</head>'));
ok('AF HTML 在 </body> 前', page.indexOf('<!-- AF:HTML:BEGIN -->') < page.indexOf('</body>'));

console.log('\n=== 7. apple.js 运行时冒烟（DOM 桩） ===');
(function () {
  const props = {};   // style 写入统一落到这里，供断言读取
  function makeCard() {
    const el = {
      _props: props,
      style: {
        setProperty(k, v) { props[k] = v; },
        removeProperty(k) { delete props[k]; },
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; },
      contains() { return false; },
    };
    return el;
  }
  const card = makeCard();
  // closest 桩：指针落在卡上时返回卡
  const pageHome = { style: { display: '' } };
  const listeners = {};
  const documentStub = {
    hidden: false,
    getElementById(id) { return id === 'page-home' ? pageHome : null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const sandbox = {
    window: {},
    matchMedia: () => ({ matches: false }),
    document: documentStub,
    console: { log() {} },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  // closest 桩挂到事件 target 上
  const target = { closest(sel) { return sel.includes('index-card') ? card : null; } };

  vm.createContext(sandbox);
  vm.runInContext(afJs.replace(/\r\n/g, '\n'), sandbox, { filename: 'apple.js' });

  const fire = (type, ev) => (listeners[type] || []).forEach(fn => fn(ev));

  // 鼠标移到卡片正中心 (100,50) → 应设置倾斜变量且角度为 0
  fire('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 50, target });
  ok('中心点 → rx=0', card._props['--af-rx'] === '0.00deg', card._props['--af-rx']);
  ok('中心点 → ry=0', card._props['--af-ry'] === '0.00deg', card._props['--af-ry']);
  ok('hover 放大 1.015', card._props['--af-sc'] === '1.015');

  // 移到右上角 → ry 正（朝右转），rx 正（顶部向后压）
  fire('pointermove', { pointerType: 'mouse', clientX: 200, clientY: 0, target });
  ok('右上角 ry=+5deg', card._props['--af-ry'] === '5.00deg', card._props['--af-ry']);
  ok('右上角 rx=+5deg', card._props['--af-rx'] === '5.00deg', card._props['--af-rx']);

  // 触摸指针 → 不响应
  fire('pointermove', { pointerType: 'touch', clientX: 100, clientY: 50, target });
  ok('触摸不改变角度', card._props['--af-ry'] === '5.00deg');

  // 鼠标移出卡片（target 不再命中）→ 复位（off 设 '0deg'）
  const outside = { closest() { return null; } };
  fire('pointermove', { pointerType: 'mouse', clientX: 500, clientY: 500, target: outside });
  ok('移出后 rx 复位', card._props['--af-rx'] === '0deg', card._props['--af-rx']);
  ok('移出后放大被移除', card._props['--af-sc'] === undefined);

  // 页面隐藏 → 复位
  fire('pointermove', { pointerType: 'mouse', clientX: 100, clientY: 50, target });
  documentStub.hidden = true;
  fire('visibilitychange', {});
  ok('切走页面后复位', card._props['--af-rx'] === '0deg', card._props['--af-rx']);

  // reduced-motion → 完全不动
  const sb2 = { window: {}, matchMedia: () => ({ matches: true }), console: { log() {} },
    document: { hidden: false, getElementById: () => pageHome, addEventListener() {} } };
  sb2.globalThis = sb2; sb2.window = sb2;
  vm.createContext(sb2);
  vm.runInContext(afJs.replace(/\r\n/g, '\n'), sb2, { filename: 'apple.js' });
  ok('reduced-motion 下装载不报错', true);
})();

console.log('\n=== 8. 语法 / 换行 ===');
(function () {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m, total = 0, bad = 0;
  while ((m = re.exec(page))) {
    if (/\bsrc=/.test(m[1])) continue;
    total++;
    try { new vm.Script(m[2].replace(/\r\n/g, '\n')); }
    catch (e) { bad++; console.log('      语法错误：' + e.message); }
  }
  ok(`全部内联脚本语法可解析（${total} 个）`, bad === 0);
  const crlf = (page.match(/\r\n/g) || []).length;
  const lf = (page.match(/\n/g) || []).length;
  eq('无裸 LF（纯 CRLF）', lf - crlf, 0);
  ok('收尾完整', page.trimEnd().endsWith('</html>'));
})();

console.log('\n' + '='.repeat(52));
console.log(`  通过 ${pass} 项 / 失败 ${fail} 项`);
console.log('='.repeat(52) + '\n');
process.exit(fail ? 1 : 0);
