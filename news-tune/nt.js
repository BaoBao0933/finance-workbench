/* ═══════════════════════════════════════════════════════════════════════════
   news-tune · 财经要闻「管理」面板
   ───────────────────────────────────────────────────────────────────────────
   用户 2026-10-25：「财经要闻那里我也想加个管理按钮，也是能让我自己删减
   添加想要关注的板块新闻。」

   做什么：
     · 新闻页标题栏加「管理」按钮（刷新左边）
     · 面板里列出当前关注的板块/关键词，点 × 删；输入框回车加自定义关键词
     · 「热门板块」区一点即加，省得手打
     · 完成 → 存 localStorage（wb_news_follow_v1）→ 让主文件重建标签行 + 重渲列表

   为什么能生效：
     主文件 renderNewsTags() 里 tags 来源优先读 window.__newsFollow.list()，
     返回 null（没设过）就沿用 SECTORS —— 不写存储时行为与原来完全一致。
     匹配逻辑本来就是 NEWS_KEYWORDS[tag] || [tag]，自定义词直接按词匹配标题/摘要。

   ⚠️ SECTORS / NEWS_KEYWORDS / activeNewsTag 是顶层变量不挂 window，
      所以走主文件里的 window.__newsFollowBridge（sectors / hasKeywords / rerender）。
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__ntInstalled) return;
  window.__ntInstalled = 1;

  var LS_FOLLOW = 'wb_news_follow_v1';
  var MAX_ITEMS = 24;                     /* 太多标签行会挤爆，给个上限 */
  var bridge = function () { return window.__newsFollowBridge || null; };

  /* ── 存储 ─────────────────────────────────────────────────────────────── */
  function readList() {
    try {
      var raw = localStorage.getItem(LS_FOLLOW);
      if (!raw) return null;              /* null = 从没设过 → 跟随热门板块 */
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return null;
      var out = [];
      arr.forEach(function (x) {
        var v = String(x || '').trim();
        if (v && out.indexOf(v) < 0) out.push(v);
      });
      return out;                          /* [] = 用户明确删光了 */
    } catch (e) { return null; }
  }
  function writeList(list) {
    try { localStorage.setItem(LS_FOLLOW, JSON.stringify(list)); } catch (e) {}
  }
  function clearList() {
    try { localStorage.removeItem(LS_FOLLOW); } catch (e) {}
  }

  /* 对外 API：主文件 renderNewsTags 会读它 */
  window.__newsFollow = {
    list: readList,
    set: writeList,
    reset: clearList
  };

  function defaults() {
    var b = bridge();
    return b ? b.sectors().slice() : [];
  }
  function currentList() {
    var l = readList();
    return l === null ? defaults() : l;
  }
  function isKeyword(name) {
    var b = bridge();
    return b ? !b.hasKeywords(name) : false;   /* 没有内置关键词表 = 自定义词 */
  }

  /* ── toast ────────────────────────────────────────────────────────────── */
  var toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'nt-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 1900);
  }

  /* ── 管理按钮 ─────────────────────────────────────────────────────────── */
  function ensureBtn() {
    var actions = document.querySelector('#page-news .header-actions');
    if (!actions || actions.querySelector('.nt-manage')) return false;
    var btn = document.createElement('div');
    btn.className = 'btn nt-manage';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/>'
      + '<circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>'
      + '<span>管理</span>';
    btn.setAttribute('role', 'button');
    btn.title = '管理关注的板块 / 关键词';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel) closePanel();
      else openPanel(btn);
    });
    actions.insertBefore(btn, actions.firstChild);
    return true;
  }

  /* ── 面板 ─────────────────────────────────────────────────────────────── */
  var panel = null, draft = [], curEl = null, poolEl = null, headEl = null;
  var placeRaf = 0, btnRef = null;

  function openPanel(btn) {
    if (panel) return;
    btnRef = btn || document.querySelector('.nt-manage');
    draft = currentList();
    panel = document.createElement('div');
    panel.className = 'nt-panel';
    panel.innerHTML = ''
      + '<div class="nt-head">关注哪些新闻<small id="nt-count"></small></div>'
      + '<div class="nt-cur" id="nt-cur"></div>'
      + '<div class="nt-search"><input class="nt-input" id="nt-input" type="text" '
      + 'placeholder="加关键词，回车（如：半导体）" autocomplete="off" maxlength="16">'
      + '<button class="nt-add" id="nt-add" type="button">添加</button></div>'
      + '<div class="nt-sub">热门板块 · 点一下加入</div>'
      + '<div class="nt-pool" id="nt-pool"></div>'
      + '<div class="nt-foot"><span class="nt-hint">只显示你关注板块的相关快讯</span>'
      + '<button class="nt-btn" id="nt-reset" type="button">恢复默认</button>'
      + '<button class="nt-btn pri" id="nt-done" type="button">完成</button></div>';
    document.body.appendChild(panel);

    curEl = panel.querySelector('#nt-cur');
    poolEl = panel.querySelector('#nt-pool');
    headEl = panel.querySelector('#nt-count');
    var inputEl = panel.querySelector('#nt-input');

    renderCur();
    renderPool();
    placePanel();

    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addTag(inputEl.value); inputEl.value = ''; }
    });
    panel.querySelector('#nt-add').addEventListener('click', function () {
      addTag(inputEl.value); inputEl.value = ''; inputEl.focus();
    });
    panel.querySelector('#nt-reset').addEventListener('click', resetFollow);
    panel.querySelector('#nt-done').addEventListener('click', saveAll);

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    if (btn) btn.classList.add('on');
    setTimeout(function () { if (inputEl) inputEl.focus(); }, 60);
  }

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null; curEl = poolEl = headEl = null; draft = [];
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    var b = document.querySelector('.nt-manage');
    if (b) b.classList.remove('on');
  }

  function onOutside(e) {
    if (!panel) return;
    if (panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.nt-manage')) return;
    closePanel();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
  }
  function onResize() { if (panel) placePanel(); }
  function onScroll() {
    if (!panel) return;
    if (placeRaf) return;
    placeRaf = requestAnimationFrame(function () { placeRaf = 0; placePanel(); });
  }

  function placePanel() {
    if (!panel) return;
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) return; /* CSS 居中 */
    var btn = btnRef || document.querySelector('.nt-manage');
    if (!btn) return;
    var r = btn.getBoundingClientRect();
    var pw = panel.offsetWidth || 332;
    var ph = panel.offsetHeight || 420;
    var left = Math.min(Math.max(12, r.left), window.innerWidth - pw - 12);
    var top = r.bottom + 10;
    if (top + ph > window.innerHeight - 12) {
      top = Math.max(12, r.top - ph - 10);   /* 下方放不下就翻到上面 */
    }
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  /* ── 当前关注 chips ───────────────────────────────────────────────────── */
  function renderCur() {
    if (!curEl) return;
    if (headEl) headEl.textContent = '已关注 ' + draft.length + ' 个';
    if (!draft.length) {
      curEl.innerHTML = '<span class="nt-empty">还没关注任何板块 —— 标签行只会显示「全部 / 快讯」。从下面加一个吧。</span>';
      return;
    }
    curEl.innerHTML = draft.map(function (name, i) {
      return '<span class="nt-chip' + (isKeyword(name) ? ' is-kw' : '') + '" data-i="' + i + '">'
        + escapeHtml(name) + '<b data-del="' + i + '" title="移除">×</b></span>';
    }).join('');
    Array.prototype.forEach.call(curEl.querySelectorAll('[data-del]'), function (x) {
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(x.getAttribute('data-del'), 10);
        draft.splice(idx, 1);
        renderCur(); renderPool();
      });
    });
  }

  /* ── 热门板块候选 ─────────────────────────────────────────────────────── */
  function renderPool() {
    if (!poolEl) return;
    var all = defaults();
    if (!all.length) {
      poolEl.innerHTML = '<div class="nt-empty" style="padding:12px;text-align:center">读取不到热门板块，直接在输入框里加关键词即可</div>';
      return;
    }
    var chosen = {};
    draft.forEach(function (n) { chosen[n] = 1; });
    /* 已关注的排后面（显示 ✓），没关注的排前面方便加 */
    var rows = all.slice().sort(function (a, b) {
      return (chosen[a] ? 1 : 0) - (chosen[b] ? 1 : 0);
    });
    poolEl.innerHTML = rows.map(function (name) {
      var on = !!chosen[name];
      return '<div class="nt-row' + (on ? ' on' : '') + '" data-name="' + escapeAttr(name) + '">'
        + '<span class="nt-row-name">' + escapeHtml(name) + '</span>'
        + (on ? '<span class="nt-row-flag">已关注</span>' : '')
        + '<span class="nt-row-add">' + (on ? '' : '+') + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(poolEl.querySelectorAll('.nt-row'), function (row) {
      row.addEventListener('click', function () {
        var name = row.getAttribute('data-name');
        if (draft.indexOf(name) >= 0) return;      /* 已关注，点了不动（要删去上面 × ） */
        addTag(name);
      });
    });
  }

  /* ── 增删 ─────────────────────────────────────────────────────────────── */
  function addTag(raw) {
    var name = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (name.length > 16) name = name.slice(0, 16);
    if (draft.indexOf(name) >= 0) { toast('「' + name + '」已经在关注里了'); return; }
    if (draft.length >= MAX_ITEMS) { toast('最多关注 ' + MAX_ITEMS + ' 个，先删几个吧'); return; }
    draft.push(name);
    renderCur(); renderPool();
    toast('已加入「' + name + '」，点完成保存');
  }

  function resetFollow() {
    clearList();
    draft = defaults();
    renderCur(); renderPool();
    toast('已恢复为默认（跟随热门板块），点完成保存');
  }

  /* ── 保存 ─────────────────────────────────────────────────────────────── */
  function saveAll() {
    var defs = defaults();
    var same = draft.length === defs.length && draft.every(function (n, i) { return n === defs[i]; });
    if (same) clearList(); else writeList(draft);   /* 和默认一致就不落存储，继续跟随板块 */
    var b = bridge();
    if (b) {
      try { b.rerender(); } catch (e) {}
    }
    toast(same ? '已恢复默认（跟随热门板块）' : '已保存：' + draft.length + ' 个关注');
    closePanel();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  /* ── 初始化：首屏 + 切页补挂 ──────────────────────────────────────────── */
  function init() {
    ensureBtn();
    /* 新闻页是 display:none 的，切过去时才需要按钮 —— 定时补挂几轮 */
    [400, 1200, 2600].forEach(function (ms) { setTimeout(ensureBtn, ms); });
    /* 点左侧导航后补挂（切页不重载 DOM，按钮只需一次） */
    document.addEventListener('click', function (e) {
      var nav = e.target.closest && e.target.closest('.nav-item');
      if (!nav) return;
      setTimeout(ensureBtn, 260);
    }, true);
    /* 兜底：观察 body 子树变化，出现新闻页 header 就补挂 */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { ensureBtn(); });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 调试入口 */
  window.__newsTune = {
    open: function () { ensureBtn(); var b = document.querySelector('.nt-manage'); if (b) openPanel(b); },
    close: closePanel,
    list: currentList,
    reset: function () { clearList(); var b = bridge(); if (b) b.rerender(); }
  };
})();
