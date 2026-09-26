/* ==========================================================================
   apple-fx / apple.js —— 指数卡小角度倾斜（事件委托，无 rAF 循环）

   设计：
   - 委托到 document 的 pointermove（passive），只在鼠标进入
     #page-home .index-card 时写 CSS 变量；卡片是动态创建的，委托免去逐卡绑定。
   - 平滑与回位交给 apple.css 里的 transition（跟手 .2s / 回位 .45s），
     JS 只负责设目标值 —— 静止时零消耗。
   - maxTilt 5°（用户要求：倾斜不要太多）。
   - 只响应 mouse 指针；触摸不抢滚动。reduced-motion 整体禁用。
   ========================================================================== */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MAX_TILT = 5;
  var pageHome = null;
  var cur = null;

  function off(card) {
    card.style.setProperty('--af-rx', '0deg');
    card.style.setProperty('--af-ry', '0deg');
    card.style.removeProperty('--af-sc');
  }

  document.addEventListener('pointermove', function (e) {
    if (reduce || e.pointerType !== 'mouse') return;

    if (!pageHome) pageHome = document.getElementById('page-home');
    if (!pageHome || pageHome.style.display === 'none') {
      if (cur) { off(cur); cur = null; }
      return;
    }

    var t = e.target;
    var card = (t && t.closest) ? t.closest('#page-home .index-card') : null;
    if (card !== cur) {
      if (cur) off(cur);
      cur = card;
    }
    if (!cur) return;

    var r = cur.getBoundingClientRect();
    var nx = (e.clientX - r.left) / r.width;
    var ny = (e.clientY - r.top) / r.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) { off(cur); cur = null; return; }

    cur.style.setProperty('--af-ry', ((nx - 0.5) * 2 * MAX_TILT).toFixed(2) + 'deg');
    cur.style.setProperty('--af-rx', (-(ny - 0.5) * 2 * MAX_TILT).toFixed(2) + 'deg');
    cur.style.setProperty('--af-sc', '1.015');
  }, { passive: true });

  // 切走页面时复位，避免回来时残留角度
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && cur) { off(cur); cur = null; }
  });

  try { console.log('[apple-fx] 液态玻璃 + 小角度倾斜已装载（maxTilt ' + MAX_TILT + '°）'); } catch (e) {}
})();
