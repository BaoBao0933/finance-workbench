/* ==========================================================================
   perf-boost / perf.js —— 首屏加速运行时
   1. 立刻摘掉 Google Fonts（国内不可达，原为 20s+ 渲染阻塞）
   2. 骨架屏在首屏有内容后立刻淡出
   3. 页面可见性联动：后台标签页暂停轮询，回前台立刻补一次
   ========================================================================== */
(function () {
  'use strict';

  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();

  /* ---------- 1. 摘除 Google Fonts ---------- */
  function killRemoteFonts() {
    var nodes = document.querySelectorAll(
      'link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]'
    );
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      // 去掉 media 让它先不生效，再移除，避免触发一次无用请求
      n.media = 'not all';
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    return nodes.length;
  }

  // 立即执行：此时 <head> 里的 link 已解析，趁浏览器还没把它升级为阻塞请求
  var killed = 0;
  try { killed = killRemoteFonts(); } catch (e) {}

  // 兜底：DOM 就绪后再扫一次（防止运行时晚插入）
  document.addEventListener('DOMContentLoaded', function () {
    try { killRemoteFonts(); } catch (e) {}
  });

  /* ---------- 2. 骨架屏淡出 ---------- */
  var hidden = false;
  function hideBoot(force) {
    if (hidden) return;
    var el = document.getElementById('pb-boot');
    if (!el) { hidden = true; return; }

    // 等到主内容真的有节点了再撤，避免「骨架完了还是空白」
    var main = document.querySelector('.main');
    var ready = force || (main && main.querySelector('.index-card, .ov-card, .watch-row, .sec-hot-card'));

    if (!ready) {
      return false;
    }
    hidden = true;
    el.classList.add('pb-boot--out');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 340);

    try {
      var dt = ((window.performance && performance.now ? performance.now() : Date.now()) - t0);
      console.log('[perf-boost] 首屏可见耗时 ' + dt.toFixed(0) + 'ms · 摘除远程字体 ' + killed + ' 个');
    } catch (e) {}
    return true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // 观察主区变化，一旦有卡片就撤骨架
    var tick = 0;
    var iv = setInterval(function () {
      tick++;
      if (hideBoot(false) || tick > 100) {   // 最长 5s 保护
        clearInterval(iv);
        hideBoot(true);
      }
    }, 50);

    // 双保险：就算 50ms 轮询错过，window.load 后也强制撤
    window.addEventListener('load', function () { setTimeout(function () { hideBoot(true); }, 120); });
  });

  /* ---------- 3. 可见性联动 ---------- */
  window.__pbVisible = !document.hidden;
  document.addEventListener('visibilitychange', function () {
    var vis = !document.hidden;
    window.__pbVisible = vis;
    if (vis && typeof window.__pbOnVisible === 'function') {
      try { window.__pbOnVisible(); } catch (e) {}
    }
  });

  /* ---------- 4. 网络预热：提前建连，省掉首次 TLS 握手 ---------- */
  // 行情域名 + anime.js CDN（defer 后仍希望尽快到达）
  (function prewarm() {
    var pc = [
      'https://qt.gtimg.cn',
      'https://push2.eastmoney.com',
      'https://push2his.eastmoney.com',
      'https://vip.stock.finance.sina.com.cn'
    ];
    for (var i = 0; i < pc.length; i++) {
      var l = document.createElement('link');
      l.rel = 'preconnect';
      l.href = pc[i];
      l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
    }
    // anime.js CDN：dns+建连即可，实际下载交给它自己的 defer script
    var cdn = document.createElement('link');
    cdn.rel = 'preconnect';
    cdn.href = 'https://cdn.jsdelivr.net';
    cdn.crossOrigin = 'anonymous';
    document.head.appendChild(cdn);
  })();
})();
