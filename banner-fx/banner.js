/* ==========================================================================
   首页横幅动效 · 装饰层装配 + 液态光斑跟随
   --------------------------------------------------------------------------
   设计原则：
     · 只往横幅里塞装饰层，不碰任何文字与结构
     · 幂等：重复执行不会叠加
     · 鼠标离开立即停止 rAF（零空转）；页面隐藏也停
     · 触屏 / 减少动效偏好下不初始化液态光斑
   ========================================================================== */
(function () {
  'use strict';

  var GOO_FILTER_ID = 'fb-goo-filter';

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  // 没有 hover 能力的设备（触屏）不需要液态光斑
  function canHover() {
    if (!window.matchMedia) return true;
    return window.matchMedia('(hover: hover)').matches;
  }

  /* ---- SVG goo 滤镜 -------------------------------------------------------
     liquid-gooey 的核心：feGaussianBlur 模糊 → feColorMatrix 把 alpha 对比
     拉陡，于是相邻图形在交界处"融"成一体。
     关键：这层滤镜只作用在装饰剪影层上，真实内容层绝不加。 */
  function ensureGooFilter() {
    if (document.getElementById(GOO_FILTER_ID)) return;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';

    var defs = document.createElementNS(ns, 'defs');
    var filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', GOO_FILTER_ID);
    filter.setAttribute('x', '-40%');
    filter.setAttribute('y', '-40%');
    filter.setAttribute('width', '180%');
    filter.setAttribute('height', '180%');

    var blur = document.createElementNS(ns, 'feGaussianBlur');
    blur.setAttribute('in', 'SourceGraphic');
    // 桥接能力 = blur 与间隙的比值，这里给足，让相距较远的光斑也能连起来
    blur.setAttribute('stdDeviation', '14');
    blur.setAttribute('result', 'b');

    var cm = document.createElementNS(ns, 'feColorMatrix');
    cm.setAttribute('in', 'b');
    cm.setAttribute('mode', 'matrix');
    cm.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9');
    cm.setAttribute('result', 'g');

    filter.appendChild(blur);
    filter.appendChild(cm);
    defs.appendChild(filter);
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }

  /* ---- 给一个横幅装配装饰层 ---- */
  function decorate(banner) {
    if (banner.querySelector('.fb-goo')) return;   // 幂等

    var goo = document.createElement('i');
    goo.className = 'fb-goo';
    goo.setAttribute('aria-hidden', 'true');
    goo.innerHTML = '<span class="fb-blob b1"></span>' +
                    '<span class="fb-blob b2"></span>' +
                    '<span class="fb-blob b3"></span>';

    var sheen = document.createElement('i');
    sheen.className = 'fb-sheen';
    sheen.setAttribute('aria-hidden', 'true');

    var beam = document.createElement('i');
    beam.className = 'fb-beam';
    beam.setAttribute('aria-hidden', 'true');

    // 插到最前面（都在背景之上、内容之下，靠 z-index 分层）
    banner.insertBefore(beam, banner.firstChild);
    banner.insertBefore(sheen, banner.firstChild);
    banner.insertBefore(goo, banner.firstChild);

    if (canHover() && !reduceMotion()) attachBlobs(banner, goo);
  }

  /* ---- 液态光斑：三个球依次追前一个，形成拖尾与融合 ---- */
  function attachBlobs(banner, goo) {
    var blobs = goo.querySelectorAll('.fb-blob');
    var n = blobs.length;
    if (!n) return;

    var pos = [], tgt = [];
    for (var i = 0; i < n; i++) { pos.push({ x: 0, y: 0 }); tgt.push({ x: 0, y: 0 }); }

    var raf = 0, active = false, seeded = false;
    // 追踪刚度递减：头球跟得快，后面的越来越"黏" → 液态拖尾
    var ease = [0.26, 0.17, 0.12];

    function frame() {
      if (!active) { raf = 0; return; }
      pos[0].x += (tgt[0].x - pos[0].x) * ease[0];
      pos[0].y += (tgt[0].y - pos[0].y) * ease[0];
      for (var i = 1; i < n; i++) {
        pos[i].x += (pos[i - 1].x - pos[i].x) * ease[i];
        pos[i].y += (pos[i - 1].y - pos[i].y) * ease[i];
      }
      for (var j = 0; j < n; j++) {
        blobs[j].style.transform = 'translate3d(' +
          pos[j].x.toFixed(1) + 'px,' + pos[j].y.toFixed(1) + 'px,0)';
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (active) return;
      active = true;
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function stop() { active = false; }   // 让当前帧自然收尾，不再起新帧

    banner.addEventListener('pointerenter', function (e) {
      if (!seeded) {
        // 首次进入直接把光斑摆到指针处，避免从画面外飞进来
        var r = banner.getBoundingClientRect();
        var x = e.clientX - r.left, y = e.clientY - r.top;
        for (var i = 0; i < n; i++) {
          pos[i].x = x; pos[i].y = y; tgt[i].x = x; tgt[i].y = y;
        }
        seeded = true;
      }
      start();
    });

    banner.addEventListener('pointermove', function (e) {
      var r = banner.getBoundingClientRect();
      tgt[0].x = e.clientX - r.left;
      tgt[0].y = e.clientY - r.top;
      start();
    }, { passive: true });

    banner.addEventListener('pointerleave', stop);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
    });
  }

  function init() {
    if (!document.body) return;
    ensureGooFilter();
    var banners = document.querySelectorAll('.fun-banner');
    for (var i = 0; i < banners.length; i++) decorate(banners[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 供调试 / 外部重新装配
  window.__bannerFx = { init: init, decorate: decorate, ensureGooFilter: ensureGooFilter };
})();
