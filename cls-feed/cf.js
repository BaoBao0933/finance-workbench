/* ═══════════════════════════════════════════════════════════════════════════
   cls-feed · 财联社电报（重点关注）置顶区块
   ───────────────────────────────────────────────────────────────────────────
   用户 2026-10-25：「能否加入财联社的新闻呢？需要重点关注这个」

   为什么要"预生成 JSON"这条路：
     · 财联社接口需要 sign 签名，而且**没有 CORS 头** → 浏览器 fetch 会被拦，
       它也不是 JSONP（script 注入拿不到）→ 纯静态页拿不到。
     · 所以由 scripts/fetch_cls.py 定时抓成同源 cls-news.json，
       网页读 ./cls-news.json 是同源，没有跨域问题。
   展示规则：
     · 财联社 A/B 级（重要）= 红点 + 标题加粗；C/D 级普通
     · 命中用户「关注」关键词（news-tune 存的 wb_news_follow_v1）的条目 → 打「关注」标
     · 数据超过 8 小时视为过期，整块不显示（避免让人看到隔夜旧闻还以为是最新）
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__cfInstalled) return;
  window.__cfInstalled = 1;

  var JSON_URL = 'cls-news.json';
  /* ⭐⭐ 2026-10-25 桌面版必须走线上（实测结论，别再改回去）：
     Electron 是 loadFile + webSecurity:true → 页面源是 file://，
     在 file:// 源里 fetch('cls-news.json') 会被 Chromium 直接拦掉
     （实测 LOCAL_FAIL Failed to fetch），打包进 renderer/ 的那份根本读不到。
     而 GitHub Pages 对该文件返回 Access-Control-Allow-Origin: *（实测），
     从 file:// 跨域读得到（实测 REMOTE_OK 30 条）。
     ⇒ 网页端读同源文件；file:// 端读线上。两边都能拿到最新。 */
  var REMOTE_URL = 'https://baobao0933.github.io/finance-workbench/cls-news.json';
  var LS_FOLLOW = 'wb_news_follow_v1';
  var STALE_SEC = 8 * 3600;        /* 超过 8 小时算过期 */
  var MAX_ITEMS = 12;              /* 区块里最多显示多少条 */

  var cache = null;                /* 上一次成功拿到的数据 */
  var loading = false;
  var failCount = 0;

  /* ── 工具 ─────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function hhmm(ts) {
    var d = new Date((ts || 0) * 1000);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function ago(ts) {
    var s = Math.max(0, Math.round(Date.now() / 1000 - (ts || 0)));
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    return Math.floor(s / 3600) + ' 小时前';
  }
  function followList() {
    try {
      var raw = localStorage.getItem(LS_FOLLOW);
      if (!raw) return null;
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a.filter(function (x) { return x && String(x).trim(); }) : null;
    } catch (e) { return null; }
  }
  function hitFollow(item, list) {
    if (!list || !list.length) return '';
    var hay = (item.title || '') + ' ' + (item.brief || '') + ' ' + (item.tags || []).join(' ');
    for (var i = 0; i < list.length; i++) {
      if (hay.indexOf(list[i]) >= 0) return list[i];
    }
    return '';
  }

  /* ── 渲染 ─────────────────────────────────────────────────────────────── */
  function ensureBlock() {
    var page = document.getElementById('page-news');
    if (!page) return null;
    var block = page.querySelector('#cls-block');
    if (block) return block;
    var list = page.querySelector('#news-list');
    if (!list || !list.parentNode) return null;
    block = document.createElement('div');
    block.id = 'cls-block';
    block.className = 'cls-block';
    list.parentNode.insertBefore(block, list);
    return block;
  }

  function render(data) {
    var block = ensureBlock();
    if (!block) return;
    /* ⭐ 2026-10-25：重要级不能被「只取最新 N 条」截掉 ——
       实测抓 30 条时 A/B 级可能排在第 13/20 位，纯按时间截 12 条会漏。
       做法：最新 N 条 + 补入 24h 内的 A/B 级（不在前 N 里的），再按时间重排。 */
    var all = data.items || [];
    var picked = all.slice(0, MAX_ITEMS);
    var chosen = {};
    picked.forEach(function (x) { chosen[x.id] = 1; });
    var now = Date.now() / 1000;
    all.slice(MAX_ITEMS).forEach(function (x) {
      if ((x.level === 'A' || x.level === 'B') && (now - (x.ctime || 0)) < 24 * 3600 && !chosen[x.id]) {
        chosen[x.id] = 1;
        picked.push(x);
      }
    });
    var items = picked.sort(function (a, b) { return (b.ctime || 0) - (a.ctime || 0); }).slice(0, MAX_ITEMS + 4);
    if (!items.length) { block.innerHTML = ''; block.style.display = 'none'; return; }
    block.style.display = '';

    var follow = followList();
    var hot = items.filter(function (x) { return x.level === 'A' || x.level === 'B'; }).length;

    var rows = items.map(function (x, i) {
      var lv = x.level || '';
      var important = lv === 'A' || lv === 'B';
      var hit = hitFollow(x, follow);
      var title = esc(x.title || '');
      var brief = esc(x.brief || '');
      if (brief && brief.length > 96) brief = brief.slice(0, 96) + '…';
      var tags = (x.tags || []).slice(0, 2).map(function (t) {
        return '<span class="cls-tag">' + esc(t) + '</span>';
      }).join('');
      var href = x.url ? esc(x.url) : '';
      var tag = href ? 'a' : 'div';
      var attrs = href ? ' href="' + href + '" target="_blank" rel="noreferrer noopener"' : '';
      return '<' + tag + ' class="cls-item' + (important ? ' is-imp' : '') + '"' + attrs + '>'
        + '<span class="cls-rail"><i class="cls-dot' + (important ? ' on' : '') + '"></i></span>'
        + '<span class="cls-main">'
        + '<span class="cls-meta"><span class="cls-t">' + hhmm(x.ctime) + '</span>'
        + (important ? '<span class="cls-lv">' + (lv === 'A' ? '重要' : '关注') + '</span>' : '')
        + (hit ? '<span class="cls-hit">● ' + esc(hit) + '</span>' : '')
        + '</span>'
        + '<span class="cls-name">' + title + '</span>'
        + (brief ? '<span class="cls-brief">' + brief + '</span>' : '')
        + (tags ? '<span class="cls-tags">' + tags + '</span>' : '')
        + '</span></' + tag + '>';
    }).join('');

    block.innerHTML = '<div class="cls-head">'
      + '<span class="cls-badge">财联社</span>'
      + '<span class="cls-cap">电报 · 重点关注</span>'
      + (hot ? '<span class="cls-hot">' + hot + ' 条重要</span>' : '')
      + '<span class="cls-upd">更新 ' + hhmm(data.updated) + ' · ' + ago(data.updated) + '</span>'
      + '</div>'
      + '<div class="cls-body">' + rows + '</div>';
  }

  /* ── 数据 ─────────────────────────────────────────────────────────────── */
  function isStale(updated) {
    return !updated || (Date.now() / 1000 - updated) > STALE_SEC;
  }

  function getJSON(url) {
    var u = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    return fetch(u, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function load(force) {
    if (loading) return;
    if (!force && cache) { render(cache); return; }
    loading = true;

    function finish(d) {
      loading = false;
      if (!d || !d.items || !d.items.length) { failCount++; return; }
      cache = d;
      if (isStale(d.updated)) {          /* 过期数据不展示，避免误当最新 */
        var b = document.getElementById('cls-block');
        if (b) { b.innerHTML = ''; b.style.display = 'none'; }
        return;
      }
      render(d);
    }

    /* 数据源：file:// 端（桌面版）读线上，http(s) 端读同源文件 */
    var src = (location.protocol === 'file:') ? REMOTE_URL : JSON_URL;
    getJSON(src).then(finish);
  }

  /* ── 时机：进新闻页才渲染（省流量） ───────────────────────────────────── */
  var renderedOnce = false;
  function maybeLoad() {
    var page = document.getElementById('page-news');
    if (!page || page.style.display === 'none') return;
    if (!ensureBlock()) return;
    load(false);
    renderedOnce = true;
  }

  function init() {
    /* 首次 + 切到新闻页时 */
    [600, 1600, 3200].forEach(function (ms) { setTimeout(maybeLoad, ms); });
    document.addEventListener('click', function (e) {
      var nav = e.target.closest && e.target.closest('.nav-item');
      if (!nav) return;
      if (String(nav.textContent || '').indexOf('财经要闻') < 0) return;
      setTimeout(maybeLoad, 320);
    }, true);
    /* 点了刷新按钮也顺手刷一次财联社 */
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#btn-news-refresh')) {
        setTimeout(function () { load(true); }, 500);
      }
    }, true);
    /* 关注列表变了（news-tune 保存后）→ 重算「关注」标 */
    window.addEventListener('storage', function (ev) {
      if (ev.key === LS_FOLLOW && cache) render(cache);
    });
    /* 每 10 分钟静默刷新（页面在新闻页时才拉） */
    setInterval(function () {
      var page = document.getElementById('page-news');
      if (page && page.style.display !== 'none') load(true);
    }, 10 * 60 * 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__clsFeed = {
    load: function () { load(true); },
    data: function () { return cache; },
    render: function () { if (cache) render(cache); }
  };
})();
