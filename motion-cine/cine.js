/* ═══════════════════════════════════════════════════════════════════════════
   motion-cine · 运行时桥接
   ───────────────────────────────────────────────────────────────────────────
   CSS 层负责「长什么样」，本层负责「什么时候动、动多快、模糊多少」。

   技法来源（prompt-motion.com 233 案例）：
     "Blur follows speed and direction on every move."
     "every shot enters already moving"
     "Springs are closed-form step responses."
     "Nothing freezes" / "never cuts on a still frame"
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  if (window.__motionCineInstalled) return;
  window.__motionCineInstalled = true;

  var REDUCED = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    installed: true,
    reduced: REDUCED,
    /* 滚动视差接管数量 */
    parallax: 0,
    /* 正在运动中的元素数 */
    moving: 0,
    /* 累计触发的速度模糊次数 —— 用来确认这套东西真的在跑 */
    blurHits: 0,
    /* 累计的页面切换次数 */
    pageIn: 0,
    /* 数字落定次数 */
    ticks: 0,
    /* 支持的能力探测 */
    support: {
      linearEase: false,
      viewTimeline: false,
      mask: false,
      waapi: false
    }
  };

  /* ═══ 能力探测 ══════════════════════════════════════════════════════
     linear() 是本层的地基。若不支持，必须退到 cubic-bezier 而不是崩。 */

  function detect() {
    var s = state.support;

    try {
      /* 用 CSS.supports 问，而不是直接赋值 —— 赋值法在旧内核会静默忽略 */
      s.linearEase = CSS.supports('transition-timing-function',
        'linear(0, 0.5, 1)');
    } catch (e) {
      s.linearEase = false;
    }

    try {
      s.viewTimeline = CSS.supports('animation-timeline', 'view()');
    } catch (e) {
      s.viewTimeline = false;
    }

    try {
      s.mask = CSS.supports('clip-path', 'inset(0)');
    } catch (e) {
      s.mask = false;
    }

    s.waapi = typeof Element !== 'undefined'
      && typeof Element.prototype.animate === 'function';

    /* ⚠️ linear() 不支持时，把 5 条弹簧曲线全部换成 cubic-bezier 近似值。
       这些近似值是各自弹簧曲线在 0~1 区间上的最佳单段拟合 ——
       保住手感，丢掉多次振荡。这是必须的兜底，不能让样式裸奔。 */
    if (!s.linearEase) {
      var rs = document.documentElement.style;
      rs.setProperty('--cine-spring', 'cubic-bezier(.22,1,.36,1)');
      rs.setProperty('--cine-snap', 'cubic-bezier(.2,.9,.3,1)');
      rs.setProperty('--cine-rubber', 'cubic-bezier(.34,1.56,.64,1)');
      rs.setProperty('--cine-calm', 'cubic-bezier(.25,.46,.45,.94)');
      rs.setProperty('--cine-settle', 'cubic-bezier(.2,.8,.2,1)');
      state.fallback = true;
    } else {
      state.fallback = false;
    }
  }

  /* ═══ 技法：速度感知模糊 ════════════════════════════════════════════
     prompt 原文： "Blur follows speed and direction on every move."

     实现要点：**速度必须在动画启动瞬间测一次**，而不是在动画过程中轮询。
     做法是读 getBoundingClientRect 的两次差值 —— 但这只能在 JS 触发的
     场景用（点击、拖拽、hover），CSS 动画的位移量 JS 读不到。

     所以本层的设计是：
       · JS 触发的运动（拖拽、点击、hover）→ 精确测速 → 模糊量按速度算
       · CSS 触发的运动（入场、滚动）→ 用 mc-par 的 CSS keyframes 内建模糊
     两者互补，不重复。

     blur 公式：距离越远越糊，但**封顶**。
     prompt 的 gotchas 写得很清楚：
       "Heavy blur tables can wipe a shape out completely:
        if a frame looks empty, lower the blur until the shape still reads."
     所以 maxBlur 必须小，且模糊要随距离**线性上升、随速度非线性上升**。 */

  var BLUR_PER_PX = 0.055;   /* 每移动 1px 的模糊增量 */
  var BLUR_MAX = 7;          /* 封顶 7px —— 再大就读不出形状了 */

  function blurFor(distance) {
    var b = distance * BLUR_PER_PX;
    /* 二次项让高速时糊得更明显，但整体仍受 BLUR_MAX 约束 */
    b += distance * distance * 0.0012;
    return Math.min(BLUR_MAX, Math.round(b * 10) / 10);
  }

  var lastPt = null;

  function onPointerDown(e) {
    if (REDUCED) return;
    lastPt = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  function onPointerMove(e) {
    if (REDUCED || !lastPt) return;

    var dx = e.clientX - lastPt.x;
    var dy = e.clientY - lastPt.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    /* 阈值以下不处理 —— 鼠标轻微抖动不该触发模糊 */
    if (dist < 8) return;

    var el = e.target && e.target.closest
      ? e.target.closest('.mc-speed') : null;
    if (!el) { lastPt = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }

    var blur = blurFor(dist);
    el.style.setProperty('--mc-blur', blur + 'px');
    el.classList.add('mc-moving');
    state.blurHits++;
    state.moving++;

    lastPt = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  function onPointerUp() {
    /* 抬起后移除 .mc-moving → filter 在 .3s 内回到 blur(0)，
       transform 用真弹簧曲线归位。这就是「加速离场 + 模糊回落」。 */
    var moving = document.querySelectorAll('.mc-speed.mc-moving');
    for (var i = 0; i < moving.length; i++) {
      (function (el) {
        setTimeout(function () {
          el.classList.remove('mc-moving');
          el.style.removeProperty('--mc-blur');
        }, 60);
      })(moving[i]);
    }
    lastPt = null;
  }

  /* ═══ 技法：页面切换接管 ════════════════════════════════════════════
     prompt 最强纪律： "the camera never cuts on a still frame"
     "Banned: crossfades"

     我们不劫持路由，只做一件事：**新页面出现时立刻加上入场类**。
     用 MutationObserver 观察主容器，不监听全局 click —— 监听 click 会
     误伤页内所有按钮，且拿不到「切到了哪个页面」这个语义。 */

  function markPageIn() {
    if (REDUCED) return;
    var main = document.querySelector('.page.active')
      || document.querySelector('[data-page].active')
      || document.querySelector('main');
    if (!main) return;

    /* 强制重排，让重复点击同一页也能重播 */
    void main.offsetWidth;
    main.classList.remove('mc-page-in');
    void main.offsetWidth;
    main.classList.add('mc-page-in');
    state.pageIn++;

    /* 一次性监听，播完摘掉，避免动画类长期挂在 DOM 上 */
    main.addEventListener('animationend', function once() {
      main.classList.remove('mc-page-in');
      main.removeEventListener('animationend', once);
    });
  }

  /* ═══ 技法：数字落定 ════════════════════════════════════════════════
     prompt 的 morph 纪律：容器不卸载重建，元素身份连续。
     用 MutationObserver 盯着行情数字的文本变化，变化时补一个落定动画。
     注意：**只监听 characterData**，不监听 childList —— 行情刷新是
     改文本内容，不是换节点。 */

  var NUM_SEL = '.price, .num, .val, [data-num], .chg, .pct, .amount';

  function onNumChange(node) {
    if (REDUCED) return;
    var el = node.parentElement;
    if (!el || !el.classList) return;
    /* 向上找到最近的数字容器 */
    var host = el.closest ? el.closest(NUM_SEL) : null;
    if (!host) host = el;

    void host.offsetWidth;
    host.classList.add('mc-tick');
    state.ticks++;
    clearTimeout(host.__mcTickTimer);
    host.__mcTickTimer = setTimeout(function () {
      host.classList.remove('mc-tick');
    }, 420);
  }

  function startNumWatch() {
    if (!document.body || typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].type === 'characterData') onNumChange(muts[i].target);
      }
    });
    try {
      mo.observe(document.body, {
        subtree: true,
        characterData: true,
        childList: false
      });
      state.numWatch = true;
    } catch (e) {
      state.numWatch = false;
    }
  }

  /* ═══ 滚动视差：给卡片打标记 ═══════════════════════════════════════
     CSS 的 animation-timeline: view() 只能作用于已有元素，
     且要求元素本身在滚动容器内。这里给主要卡片批量打 .mc-par。

     ⚠️ 必须用缓存列表，不能每次 scroll 都 querySelectorAll ——
     那是最典型的掉帧写法。 */

  var PAR_SEL = [
    '.index-card', '.sector-chip', '.sec-hot-card', '.ov-card',
    '.pos-row', '.lhb-row', '.fund-card', '.news-item', '.panel'
  ].join(',');

  function tagParallax() {
    if (REDUCED || !state.support.viewTimeline) return;
    var list = document.querySelectorAll(PAR_SEL);
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      /* 只给没有祖先已带该类的打标，避免重复计数 */
      if (!list[i].closest('.mc-par')) {
        list[i].classList.add('mc-par');
        n++;
      }
    }
    state.parallax = document.querySelectorAll('.mc-par').length;
    return n;
  }

  /* ═══ 交错入场：给列表容器打标记 ════════════════════════════════════
     ⭐ 2026-10-24 用户：「所有列表都那么丝滑」。
     资金流向那套错峰浮入（.mc-stagger）现在铺满全站列表与卡片网格：
       行列表  .fund-list .watch-list .news-list .ladder-list .feed-list
               #sec-stocks #focus-stocks #fd-list（.sec-row 家族）
       卡网格  .sec-grid .sec-hot-grid .overview-grid .senti-cards
               .pos-summary .sector-strip .index-grid
     ⚠️ 入场用 mc-rise（纯 opacity/transform，无 blur），代价极低；
        带 blur 的 mc-page-in 只保留给页面级容器。
     ⚠️ 首页 #index-areas 由 anime.js 弹性入场接管（anime-ready 会强制
        animation:none），不在此列，切页回首页时由 switchPage 补播。
     ⚠️ .lhb-list/.pos-list 是历史死选择器（实际容器是 .watch-list），移除。 */
  var STAGGER_SEL = '.fund-list, .watch-list, .news-list, .ladder-list, .feed-list, '
    + '.sec-grid, .sec-hot-grid, .overview-grid, .senti-cards, .pos-summary, '
    + '.sector-strip, .index-grid, #sec-stocks, #focus-stocks, #fd-list';

  function tagStagger() {
    var list = document.querySelectorAll(STAGGER_SEL);
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].classList.contains('mc-stagger')) {
        list[i].classList.add('mc-stagger');
        n++;
      }
    }
    return n;
  }

  /* ═══ 速度模糊：给可拖拽元素打标记 ═════════════════════════════════ */
  var DRAG_SEL = '.sector-chip, .sec-hot-card, .index-card, .senti-card';

  function tagSpeed() {
    var list = document.querySelectorAll(DRAG_SEL);
    for (var i = 0; i < list.length; i++) {
      list[i].classList.add('mc-speed');
    }
    return list.length;
  }

  /* ═══ 启动 ══════════════════════════════════════════════════════════ */

  function init() {
    detect();

    if (REDUCED) {
      state.skipped = 'prefers-reduced-motion';
      return;
    }

    /* 指针事件 —— 速度模糊的数据来源 */
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointercancel', onPointerUp, { passive: true });

    /* 首次扫描 */
    tagSpeed();
    tagStagger();
    tagParallax();
    startNumWatch();

    /* 页面重渲染后重新打标（行情面板会整体重绘） */
    if (typeof MutationObserver === 'function') {
      var ro = new MutationObserver(function () {
        clearTimeout(state.retagTimer);
        state.retagTimer = setTimeout(function () {
          tagSpeed();
          tagStagger();
          tagParallax();
        }, 400);
      });
      try {
        ro.observe(document.body, { childList: true, subtree: true });
        state.retag = true;
      } catch (e) { state.retag = false; }
    }

    state.ready = true;
  }

  /* ═══ 对外 API ══════════════════════════════════════════════════════ */

  window.__motionCine = {
    state: function () {
      return {
        ready: !!state.ready,
        reduced: state.reduced,
        fallback: !!state.fallback,
        support: state.support,
        parallax: state.parallax,
        moving: state.moving,
        blurHits: state.blurHits,
        pageIn: state.pageIn,
        ticks: state.ticks,
        numWatch: !!state.numWatch,
        retag: !!state.retag
      };
    },
    /* 手动触发一次页面入场（供测试与外部调用） */
    pageIn: markPageIn,
    /* 重新打标（行情面板重绘后外部可主动调） */
    retag: function () {
      return {
        speed: tagSpeed(),
        stagger: tagStagger(),
        parallax: tagParallax()
      };
    },
    /* 模糊量换算，测试用 —— 让"速度→模糊"这条规律可断言 */
    blurFor: blurFor,
    disable: function () {
      document.documentElement.setAttribute('data-cine-off', '');
      var on = document.querySelectorAll('.mc-par, .mc-mask-up, .mc-page-in');
      for (var i = 0; i < on.length; i++) on[i].classList.remove('mc-page-in');
    },
    enable: function () {
      document.documentElement.removeAttribute('data-cine-off');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
