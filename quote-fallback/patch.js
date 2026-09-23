/* ==========================================================================
   quote-fallback / patch.js —— 把备用通道接进既有加载函数

   背景
   ----
   东财行情集群按服务限流：push2（实时 ulist / 列表 clist）会整片被封，
   特征为 HTTP 000 + 0.1s 快速失败。页面里「期货行情」「重点关注」用的
   正是 push2 的 ulist / clist，因此整页空白。

   做法
   ----
   不改页面原有函数，只做两件事：
   1. 拦包装载函数：调用原函数 → 若仍旧无数据 → 切备用源重跑一遍
   2. 额外挂低频守卫：原函数有 5s/10s 定时器直接读闭包变量、不走包装版，
      所以还需要独立轮询补位

   取内部数据统一走 window.__quoteHook（const/let 不挂 window，取不到）。
   ========================================================================== */
(function () {
  'use strict';

  var TAG = '[quote-fallback] ';
  var SRC_BADGE = '备用源：';

  function $(id) { return document.getElementById(id); }
  function on(el) { return !!(el && el.style && el.style.display !== 'none'); }
  function log(m) { try { console.log(TAG + m); } catch (e) {} }

  /* 页面脚本可能晚于本模块执行，hook 用惰性取值 */
  function hook() { return window.__quoteHook || null; }
  function qf() { return window.QF || null; }

  /* ======================================================================
     一、期货行情 —— 逐级降级
       第 1 级：新浪期货 script 注入（一次拿全 12 品种，最稳）
       第 2 级：腾讯股票接口的期货兜底（拿不到期货时静默跳过）
     ====================================================================== */

  function futHasData() {
    var g = $('fut-grid');
    if (!g) return false;
    var cards = g.querySelectorAll('.index-card');
    for (var i = 0; i < cards.length; i++) {
      var p = cards[i].querySelector('.ic-price');
      if (p && p.textContent && p.textContent.trim() && p.textContent.trim() !== '--') return true;
    }
    return false;
  }

  var futBusy = false;

  function futFallback(reason) {
    var H = hook(), Q = qf();
    if (!H || !Q || typeof Q.fetchFuturesSina !== 'function') return;
    if (futBusy) return;
    futBusy = true;

    var FUT = H.getFutures();
    if (!Array.isArray(FUT)) { futBusy = false; return; }

    Q.fetchFuturesSina(FUT).then(function (map) {
      var grid = $('fut-grid');
      if (!grid || !map) return;

      // 清掉「加载失败」占位（占位是 <span>，不是卡片）
      Array.prototype.slice.call(grid.children).forEach(function (n) {
        if (n.tagName === 'SPAN' && !n.classList.contains('index-card')) n.remove();
      });

      var cache = H.getFutCache() || {};
      var hit = 0;
      FUT.forEach(function (f) {
        var d = map[String(f.secid).toLowerCase()];
        if (!d) return;
        hit++;
        var card = cache[f.secid];
        if (!card) {
          card = H.buildFutCard(f);
          cache[f.secid] = card;
          grid.appendChild(card);
        }
        H.updateFutCard(card, d);
      });

      if (hit) {
        var now = new Date();
        var p = function (n) { return String(n).padStart(2, '0'); };
        H.setFutStatus(SRC_BADGE + '新浪 · 期货 ' + hit + ' 个品种 · 5秒刷新 · 更新 '
          + p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds()));
        log('期货走新浪备用源，命中 ' + hit + ' / ' + FUT.length + ' 个品种（' + (reason || '') + '）');
      }
    }).catch(function (e) {
      log('期货备用源失败：' + (e && e.message));
    }).then(function () {
      futBusy = false;
    });
  }

  /* ======================================================================
     二、重点关注 —— 分两条线
       A) 板块列表：腾讯概念板块全量 → 按 FOCUS_SECTOR_KW 过滤（覆盖 clist）
       B) 核心个股：新浪 hq.sinajs.cn 批量（覆盖 ulist.np）
       C) 板块成分股：新浪按行业名反查 node（覆盖 clist?fs=b:CODE）
     ====================================================================== */

  function focusSectorsHasData() {
    var g = $('focus-sectors');
    return !!(g && g.querySelector('.sec-cell'));
  }

  function focusStocksHasData() {
    var g = $('focus-stocks');
    if (!g) return false;
    var rows = g.querySelectorAll('.sec-row');
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i].querySelector('.sr-price b');
      if (p && p.textContent && p.textContent.trim() && p.textContent.trim() !== '--') return true;
    }
    return false;
  }

  var boardCache = null;      // 腾讯概念板块全量（5 分钟复用）
  var BOARD_TTL = 5 * 60 * 1000;
  var secBusy = false;

  function focusBoardFallback(reason) {
    var H = hook(), Q = qf();
    if (!H || !Q || typeof Q.fetchQQBoards !== 'function') return;
    if (secBusy) return;
    // 页面自己已经出数据了就别插手
    if (focusSectorsHasData()) return;
    secBusy = true;

    var p;
    if (boardCache && (Date.now() - boardCache.t) < BOARD_TTL) {
      p = Promise.resolve(boardCache.rows);
    } else {
      p = Q.fetchQQBoards('concept').then(function (rows) {
        boardCache = { t: Date.now(), rows: rows };
        return rows;
      });
    }

    p.then(function (rows) {
      var grid = $('focus-sectors');
      if (!grid || !rows || !rows.length) return;
      if (focusSectorsHasData()) return;   // 原通道抢到了，让位

      var KW = H.getFocusKw() || [];
      var rel = rows.filter(function (d) {
        var nm = d.f14 || '';
        for (var i = 0; i < KW.length; i++) { if (nm.indexOf(KW[i]) >= 0) return true; }
        return false;
      }).map(function (d) {
        return { code: d.f12, name: d.f14, pct: d.f3, price: d.f2 };
      });

      rel.sort(function (a, b) { return b.pct - a.pct; });

      var cache = H.getFocusSecCache();
      if (!cache) return;
      grid.querySelectorAll('.news-empty').forEach(function (el) { el.remove(); });

      var seen = {};
      rel.forEach(function (s) {
        seen[s.code] = 1;
        var cell = cache[s.code];
        if (!cell) {
          var div = document.createElement('div');
          div.className = 'sec-cell';
          div.innerHTML = '<div class="scn"></div><div class="scp">--</div><div class="scc">--</div>';
          (function (code, name, pct) {
            div.addEventListener('click', function () { H.openFocusDetail(code, name, pct); });
          })(s.code, s.name, s.pct);
          cell = cache[s.code] = {
            root: div,
            name: div.querySelector('.scn'),
            pct: div.querySelector('.scp'),
            code: div.querySelector('.scc')
          };
        }
        cell.name.textContent = s.name;
        var txt = (s.pct > 0 ? '+' : '') + fmt(s.pct, 2) + '%';
        cell.pct.className = 'scp ' + (window.clsOf ? window.clsOf(s.pct) : '');
        cell.pct.classList.add('t-digit-group');
        if (window.setDigitAnim) window.setDigitAnim(cell.pct, txt);
        else cell.pct.textContent = txt;
        cell.code.textContent = s.code + ' · ' + fmt(s.price);
        grid.appendChild(cell.root);
      });

      Object.keys(cache).forEach(function (c) {
        if (!seen[c] && cache[c] && cache[c].root) cache[c].root.remove();
      });

      // 「光引擎」自建板块（页面原有逻辑依赖东财行情，被封时补不上，这里显式补一个）
      var EC = '__OPT_ENGINE__';
      if (!cache[EC]) {
        var d2 = document.createElement('div');
        d2.className = 'sec-cell sec-custom';
        d2.innerHTML = '<div class="scn">光引擎 ★</div><div class="scp">--</div><div class="scc">自建 · 9 只成分股</div>';
        d2.addEventListener('click', function () { H.openFocusEngineDetail('光引擎', 0); });
        cache[EC] = { root: d2, name: d2.querySelector('.scn'), pct: d2.querySelector('.scp'), code: d2.querySelector('.scc') };
        grid.appendChild(d2);
      }

      if (!rel.length && !grid.querySelector('.sec-cell')) {
        grid.innerHTML = '<div class="news-empty">未匹配到相关板块</div>';
      }
      log('重点关注板块走腾讯备用源，命中 ' + rel.length + ' 个（' + (reason || '') + '）');
    }).catch(function (e) {
      log('重点关注板块备用源失败：' + (e && e.message));
    }).then(function () {
      secBusy = false;
    });
  }

  var stkBusy = false;

  function focusStocksFallback(reason) {
    var H = hook(), Q = qf();
    if (!H || !Q || typeof Q.fetchStocksSina !== 'function') return;
    if (stkBusy) return;
    if (focusStocksHasData()) return;
    stkBusy = true;

    var list = H.getFocusStocks();
    if (!Array.isArray(list) || !list.length) { stkBusy = false; return; }

    Q.fetchStocksSina(list).then(function (map) {
      var wrap = $('focus-stocks');
      if (!wrap || !map) return;
      if (focusStocksHasData()) return;

      var cache = H.getFocusStockCache();
      if (!cache) return;
      wrap.querySelectorAll('.news-empty').forEach(function (el) { el.remove(); });

      var seen = {};
      list.forEach(function (s, i) {
        var code = s[0];
        var d = map[String(code).toLowerCase()];
        seen[code] = 1;
        var row = cache[code];
        if (!row) {
          var div = document.createElement('div');
          div.className = 'sec-row';
          div.innerHTML = '<div class="sr-rank">' + (i + 1) + '</div>'
            + '<div class="sr-name">' + s[1] + '<small>' + code.split('.').pop() + '</small></div>'
            + '<div class="sr-price"><b class="t-digit-group">--</b></div>'
            + '<div class="sr-pct"><b class="t-digit-group">--</b></div>'
            + '<div class="sr-chg"><b class="t-digit-group">--</b></div>'
            + '<div class="sr-amt w-hide">--</div>';
          row = cache[code] = {
            root: div,
            price: div.querySelector('.sr-price b'),
            pct: div.querySelector('.sr-pct b'),
            chg: div.querySelector('.sr-chg b'),
            amt: div.querySelector('.sr-amt')
          };
        }
        if (d) {
          var cls = window.clsOf ? window.clsOf(d.f3) : '';
          if (window.setDigitAnim) window.setDigitAnim(row.price, fmt(d.f2)); else row.price.textContent = fmt(d.f2);
          row.pct.className = 'sr-pct ' + cls;
          row.pct.classList.add('t-digit-group');
          var ptxt = (d.f3 > 0 ? '+' : '') + fmt(d.f3, 2) + '%';
          if (window.setDigitAnim) window.setDigitAnim(row.pct, ptxt); else row.pct.textContent = ptxt;
          row.chg.className = 'sr-chg ' + cls;
          row.chg.classList.add('t-digit-group');
          var ctxt = (d.f4 > 0 ? '+' : '') + fmt(d.f4, 2);
          if (window.setDigitAnim) window.setDigitAnim(row.chg, ctxt); else row.chg.textContent = ctxt;
          row.amt.textContent = fmt(d.f6 || 0) + '万';
          wrap.appendChild(row.root);
        } else {
          row.price.textContent = '--';
          row.pct.textContent = '--';
          row.chg.textContent = '--';
          row.amt.textContent = '--';
          wrap.appendChild(row.root);
        }
      });
      Object.keys(cache).forEach(function (k) { if (!seen[k] && cache[k] && cache[k].root) cache[k].root.remove(); });

      var hit = Object.keys(map).length;
      if (hit) log('重点关注核心个股走新浪备用源，命中 ' + hit + ' / ' + list.length + ' 只（' + (reason || '') + '）');
    }).catch(function (e) {
      log('重点关注核心个股备用源失败：' + (e && e.message));
    }).then(function () {
      stkBusy = false;
    });
  }

  /* fmtNum / fmtFund 都是 function 声明 → 挂在 window 上，可直接用 */
  function fmt(v, d) {
    if (typeof window.fmtNum === 'function') return window.fmtNum(v, d === undefined ? 2 : d);
    return (v === null || v === undefined || isNaN(v)) ? '--' : Number(v).toFixed(d === undefined ? 2 : d);
  }

  /* ======================================================================
     三、包一层：原函数先跑，没数据再兜底
     ====================================================================== */

  function wrap(name, hasData, fallback, delayMs) {
    var orig = window[name];
    if (typeof orig !== 'function') return false;
    if (orig.__qfWrapped) return true;

    var wrapped = function () {
      var self = this, args = arguments, ret;
      try { ret = orig.apply(self, args); } catch (e) { ret = null; }
      var done = function () {
        setTimeout(function () {
          if (!hasData()) { try { fallback('原通道无数据'); } catch (e) {} }
        }, delayMs || 1500);
      };
      if (ret && typeof ret.then === 'function') ret.then(done, done);
      else done();
      return ret;
    };
    wrapped.__qfWrapped = true;
    try { window[name] = wrapped; } catch (e) { return false; }
    return true;
  }

  /* ======================================================================
     四、独立守卫：页面自带的 5s / 10s 定时器走闭包变量、不经过包装版，
        因此按页签可见性低频补位（期货 5s、重点关注 10s，与页面同节奏）
     ====================================================================== */

  var lastFocusTick = 0;

  function guard() {
    if (document.hidden) return;

    var pgFut = $('page-futures');
    if (on(pgFut) && !futHasData()) futFallback('定时守卫');

    var pgFocus = $('page-focus');
    if (on(pgFocus)) {
      if (!focusSectorsHasData()) focusBoardFallback('定时守卫');
      if (!focusStocksHasData()) focusStocksFallback('定时守卫');
      // 成分股弹层打开且为空时也补
      var det = $('focus-detail');
      var list = $('fd-list');
      if (on(det) && list) {
        var h = hook();
        var code = h && h.getFocusDetailCode ? h.getFocusDetailCode() : null;
        if (code && code !== '__OPT_ENGINE__' && list.querySelector('.news-empty') && !list.querySelector('.sec-row')) {
          if (Date.now() - lastFocusTick > 8000) {
            lastFocusTick = Date.now();
            if (typeof window.loadFocusDetailStocks === 'function') { try { window.loadFocusDetailStocks(); } catch (e) {} }
          }
        }
      }
    }
  }

  function install() {
    var okF = wrap('loadFutures', futHasData, futFallback, 1200);
    var okS = wrap('loadFocusSectors', focusSectorsHasData, focusBoardFallback, 1500);
    var okK = wrap('loadFocusStocks', focusStocksHasData, focusStocksFallback, 1500);

    setInterval(guard, 5000);

    // 回前台立刻补一次（perf-boost 也会调，双保险）
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(guard, 600);
    });

    log('已装载：loadFutures=' + okF + ' loadFocusSectors=' + okS + ' loadFocusStocks=' + okK);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
