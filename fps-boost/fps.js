/* ==========================================================================
   fps-boost / fps.js —— 自适应帧率监控与降级

   为什么需要「自适应」而不是「一律降级」
   ------------------------------------
   一律把毛玻璃调弱，等于让高配机器也跟着吃亏；而完全不降级，低配机器就
   一直卡。所以这里实时测帧率，只在真的掉帧时才逐步降级，流畅后自动回升。

   关键设计
   --------
   1. **不写死 60fps 阈值** —— 先测这台机器的基线（屏幕可能是 60/120/144Hz），
      再按基线的百分比判断，换机器、换显示器都不用改代码。
   2. **降级快、升档慢** —— 掉帧要立刻救，恢复要谨慎，避免在临界点反复横跳。
   3. **档位记忆** —— 存 sessionStorage，刷新页面不用重新踩一遍坑。
   4. 默认档什么都不做，视觉与优化前 100% 一致。

   暴露：window.__fpsBoost = { state(), setQuality(), reset(), baseline }
   ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'fps-boost-quality';

  var HIGH = 'high', MEDIUM = 'medium', LOW = 'low';
  var ORDER = [HIGH, MEDIUM, LOW];
  function rank(q) { var i = ORDER.indexOf(q); return i < 0 ? 0 : i; }

  /* ---------------- 状态 ---------------- */
  var quality = HIGH;
  var baseline = 0;          // 基线 fps（预热期测得，吸附到屏幕标准刷新率）
  var warmupFrames = 3;      // 预热窗口数（每窗口 1 秒）
  var jankStreak = 0;        // 连续掉帧窗口数
  var goodStreak = 0;        // 连续流畅窗口数
  var lastDropT = 0;         // 上次降档时刻（rAF 时间戳）
  var lastRiseT = 0;         // 上次升档时刻（rAF 时间戳）
  var nowT = 0;              // 最近的 rAF 时间戳（统一时间源）
  var lowestEver = HIGH;     // 本次会话到过的最低档（仅作记录 / 排查用）
  var riseFailures = 0;      // 升档后又掉帧的次数 → 用来加长下次升档的观察期
  var frameCount = 0;
  var windowStart = 0;
  var rafId = 0;
  var disabled = false;

  /* 掉帧判定：低于基线 72% 视为掉帧；高于 88% 视为流畅 */
  var JANK_RATIO = 0.72;
  var GOOD_RATIO = 0.88;
  var DROP_AFTER = 2;        // 连续 2 个窗口掉帧 → 降一档
  var RISE_AFTER = 6;        // 连续 6 个窗口流畅 → 尝试升一档（失败一次就翻倍）
  var RISE_COOLDOWN = 12000; // 距上次降档至少 12s 才允许升档
  var RISE_FAIL_WINDOW = 20000; // 升档后 20s 内又掉帧 → 判定这次升档失败

  /* 屏幕刷新率是离散值，实测会因为窗口边界多算一两帧。
     吸附到标准值能让基线稳定，也避免「基线慢慢漂移」导致的误判。 */
  var COMMON_HZ = [60, 75, 90, 100, 120, 144, 165, 180, 240, 360];
  function snapHz(v) {
    if (!v || v <= 0) return 60;
    var best = COMMON_HZ[0], bestD = Infinity;
    for (var i = 0; i < COMMON_HZ.length; i++) {
      var d = Math.abs(COMMON_HZ[i] - v);
      if (d < bestD) { bestD = d; best = COMMON_HZ[i]; }
    }
    // 离最近的常见值太远（>12%）说明不是标准屏，就用实测值
    return (bestD / v) > 0.12 ? Math.round(v) : best;
  }

  /* ---------------- 档位读写 ---------------- */
  function applyQuality(q, reason) {
    if (rank(q) === rank(quality)) return;
    var rising = rank(q) < rank(quality);
    quality = q;
    if (rank(q) > rank(lowestEver)) lowestEver = q;

    var el = document.documentElement;
    if (q === HIGH) el.removeAttribute('data-fps-q');   // 默认档不设属性 → 零视觉改动
    else el.setAttribute('data-fps-q', q);

    try { sessionStorage.setItem(STORE_KEY, q); } catch (e) {}

    log('档位 ' + (rising ? '↑' : '↓') + ' ' + q + '（' + reason + '）'
      + (baseline ? ' · 基线 ' + Math.round(baseline) + 'fps' : ''));
  }

  function log(m) {
    try { console.log('[fps-boost] ' + m); } catch (e) {}
  }

  /* ---------------- 采样 ---------------- */
  function onWindow(fps) {
    // 预热期：确定这台机器的基线
    if (warmupFrames > 0) {
      warmupFrames--;
      if (fps > baseline) baseline = fps;
      if (warmupFrames === 0 && baseline > 0) {
        baseline = snapHz(baseline);
        log('基线测定 ' + baseline + 'fps');
      }
      return;
    }
    if (!baseline) { baseline = 60; return; }

    var jank = fps < baseline * JANK_RATIO;
    var good = fps > baseline * GOOD_RATIO;

    if (jank) {
      goodStreak = 0;
      jankStreak++;
      if (jankStreak >= DROP_AFTER && rank(quality) < ORDER.length - 1) {
        jankStreak = 0;
        // 刚升过档就又掉帧 → 这次升档判定为失败，下次观察期翻倍（指数退避）
        if (lastRiseT && nowT - lastRiseT < RISE_FAIL_WINDOW) {
          riseFailures = Math.min(riseFailures + 1, 4);
          log('升档失败，观察期加长到 ' + (RISE_AFTER * (riseFailures + 1)) + 's');
        }
        lastDropT = nowT;
        applyQuality(ORDER[rank(quality) + 1], '实测 ' + Math.round(fps) + 'fps');
      }
    } else if (good) {
      jankStreak = 0;
      goodStreak++;
      var cooled = nowT - lastDropT > RISE_COOLDOWN;
      // 连续掉过档的机器，升档要多观察几轮才放行
      var need = RISE_AFTER * (riseFailures + 1);
      if (goodStreak >= need && cooled && rank(quality) > 0) {
        goodStreak = 0;
        lastRiseT = nowT;
        applyQuality(ORDER[rank(quality) - 1], '已恢复 ' + Math.round(fps) + 'fps');
      }
    } else {
      // 灰色地带：两边计数都清零，不做动作（避免临界抖动）
      jankStreak = 0;
      goodStreak = 0;
    }
  }

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (disabled) return;

    // 统一用 rAF 时间戳：单调、不受系统时钟调整影响，也便于自动化测试驱动
    if (t > nowT) nowT = t;

    // 页面隐藏时 rAF 本身会暂停，这里再显式挡一次
    if (document.hidden) { windowStart = t; frameCount = 0; return; }

    frameCount++;
    if (!windowStart) { windowStart = t; return; }

    var elapsed = t - windowStart;
    if (elapsed >= 1000) {
      onWindow(frameCount * 1000 / elapsed);
      frameCount = 0;
      windowStart = t;
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    // 恢复上次会话的档位（弱机不必重新踩坑）
    var saved = null;
    try { saved = sessionStorage.getItem(STORE_KEY); } catch (e) {}
    if (saved && ORDER.indexOf(saved) >= 0 && saved !== HIGH) {
      quality = saved;
      lowestEver = saved;
      document.documentElement.setAttribute('data-fps-q', saved);
      log('沿用上次档位 ' + saved);
    }

    // 尊重系统「减少动效」：直接停在 low 档的模糊策略，但不动画
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        disabled = true;
        log('系统偏好减少动效 → 不做自适应调整');
      }
    } catch (e) {}

    if (!disabled) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- 对外接口 ---------------- */
  window.__fpsBoost = {
    state: function () {
      return {
        quality: quality,
        baseline: baseline,
        lowestEver: lowestEver,
        riseFailures: riseFailures,
        warmupLeft: warmupFrames,
        disabled: disabled,
      };
    },
    setQuality: function (q) {
      if (ORDER.indexOf(q) < 0) return false;
      warmupFrames = 0;
      if (!baseline) baseline = 60;
      applyQuality(q, '手动');
      return true;
    },
    reset: function () {
      try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
      quality = HIGH;
      lowestEver = HIGH;
      riseFailures = 0;
      document.documentElement.removeAttribute('data-fps-q');
      warmupFrames = 3;
      baseline = 0;
      jankStreak = 0;
      goodStreak = 0;
      lastDropT = 0;
      lastRiseT = 0;
      log('已重置');
    },
    stop: function () { disabled = true; if (rafId) cancelAnimationFrame(rafId); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
