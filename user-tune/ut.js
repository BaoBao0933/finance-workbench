/* ═══════════════════════════════════════════════════════════════════════════
   user-tune · 用户自定义（2026-10-24）
   ───────────────────────────────────────────────────────────────────────────
   ① 热点精选板块：标题栏「管理」→ 面板增删板块 → 存 localStorage 并立即刷新行情
   ② 左上角头像：hover 出相机按钮 → 选图 → 居中裁方压到 192px JPEG → 存 localStorage
   两处都只影响本机（单文件应用没有后端），换台电脑/换个人各用各的。
   ⚠️ SEC_HOT 是 let 不挂 window，列表读写走主文件里的 window.__secHotAPI
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__utInstalled) return;
  window.__utInstalled = true;

  var LS_AVATAR = 'wb_avatar';
  var AVATAR_SIZE = 192;

  /* ── 小工具 ─────────────────────────────────────────────────────── */
  var toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ut-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    void toastEl.offsetWidth;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 1900);
  }

  function hot() { return window.__secHotAPI || null; }

  /* ═════════════════════════════════════════════════════════════════
     ① 热点精选板块 · 管理
     ═════════════════════════════════════════════════════════════════ */
  var panel = null, panelBtn = null, draft = [], saveTimer = null, poolTimer = null;
  var curEl = null, poolEl = null, searchEl = null, countEl = null;

  function ensureManageBtn() {
    var title = document.querySelector('.sec-hot-title');
    if (!title) return false;
    if (title.querySelector('.ut-manage')) return true;

    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ut-manage';
    b.textContent = '管理';
    b.title = '自定义热点精选板块';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (panel) closePanel();
      else openPanel(b);
    });
    title.appendChild(b);
    return true;
  }

  function openPanel(btn) {
    var a = hot();
    if (!a) { toast('还没准备好，稍后再试'); return; }
    panelBtn = btn;
    btn.classList.add('on');
    draft = a.list();

    panel = document.createElement('div');
    panel.className = 'ut-panel';
    panel.innerHTML =
      '<div class="ut-head">热点精选 · 自定义<small></small></div>' +
      '<div class="ut-cur"></div>' +
      '<div class="ut-search"><input type="text" placeholder="搜索板块名 / 代码，如 光通信、BK1136"></div>' +
      '<div class="ut-pool"></div>' +
      '<div class="ut-foot">' +
        '<span class="ut-hint">改动自动保存</span>' +
        '<button type="button" class="ut-btn" data-act="reset">恢复默认</button>' +
        '<button type="button" class="ut-btn pri" data-act="done">完成</button>' +
      '</div>';

    document.body.appendChild(panel);
    placePanel();
    curEl = panel.querySelector('.ut-cur');
    poolEl = panel.querySelector('.ut-pool');
    searchEl = panel.querySelector('.ut-search input');
    countEl = panel.querySelector('.ut-head small');

    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    searchEl.addEventListener('input', function () { renderPool(); });
    searchEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var raw = (searchEl.value || '').trim();
      /* 支持 “光通信 BK1136” 或只是 “BK1136” */
      var m = /^(?:([^\s]+)\s+)?(BK\d{4})$/i.exec(raw);
      if (!m) { toast('粘贴东财板块代码后回车，如 BK1136'); return; }
      if (addSector({ name: m[1] || m[2].toUpperCase(), code: m[2].toUpperCase() })) {
        searchEl.value = '';
        renderCur(); renderPool();
      }
    });
    panel.querySelector('[data-act="reset"]').addEventListener('click', function () {
      draft = window.__secHotAPI ? (window.__secHotAPI.reset(), window.__secHotAPI.list()) : [];
      renderCur(); renderPool();
      toast('已恢复默认板块');
    });
    panel.querySelector('[data-act="done"]').addEventListener('click', function () {
      flushSave();
      closePanel();
    });

    renderCur();
    renderPool();
    fillPool();
    requestAnimationFrame(placePanel);
    setTimeout(function () { if (searchEl) searchEl.focus(); }, 60);

    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', onScroll, true);
  }

  /* 面板挂在 body 上，跟随按钮位置（滚动时也要跟） */
  var placeRaf = 0;
  function placePanel() {
    if (!panel || !panelBtn) return;
    var r = panelBtn.getBoundingClientRect();
    var w = panel.offsetWidth || 348;
    var h = panel.offsetHeight || 400;
    var left = Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w));
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 10 && r.top - h - 8 > 10) top = r.top - h - 8;
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }
  function onScroll() {
    if (!panel) return;
    if (placeRaf) return;
    placeRaf = requestAnimationFrame(function () { placeRaf = 0; placePanel(); });
  }

  function closePanel() {
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', placePanel);
    window.removeEventListener('scroll', onScroll, true);
    if (poolTimer) { clearInterval(poolTimer); poolTimer = null; }
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    if (panelBtn) panelBtn.classList.remove('on');
    panel = null; panelBtn = null; curEl = poolEl = searchEl = countEl = null;
  }

  function onOutside(e) {
    if (!panel) return;
    if (panel.contains(e.target)) return;
    if (panelBtn && panelBtn.contains(e.target)) return;
    closePanel();
  }

  function onKey(e) {
    if (e.key === 'Escape') { flushSave(); closePanel(); }
  }

  /* ── 已选列表 ── */
  function renderCur() {
    if (!curEl) return;
    var max = hot() ? hot().max() : 12;
    if (countEl) countEl.textContent = draft.length + ' / ' + max;

    if (!draft.length) {
      curEl.innerHTML = '<span class="ut-empty">还没有板块，在下面搜索添加</span>';
      return;
    }
    curEl.innerHTML = draft.map(function (b, i) {
      return '<span class="ut-chip" data-i="' + i + '">' + esc(b.name) +
             '<i>' + esc(b.code) + '</i><b title="移除">×</b></span>';
    }).join('');

    Array.prototype.forEach.call(curEl.querySelectorAll('.ut-chip b'), function (x) {
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        var i = +x.parentNode.getAttribute('data-i');
        draft.splice(i, 1);
        renderCur(); renderPool(); queueSave();
      });
    });
  }

  /* ── 候选列表 ── */
  function renderPool() {
    if (!poolEl) return;
    var a = hot();
    if (!a) return;
    var all = a.pool();
    if (!all.length) {
      poolEl.innerHTML = '<div class="ut-msg">板块列表还没加载出来…</div>';
      return;
    }
    var hasBK = all.some(function (s) { return /^BK\d+$/i.test(String(s.code || '')); });
    if (!hasBK) {
      poolEl.innerHTML = '<div class="ut-msg">行情源现在只给行业分类，没有可用的板块代码。<br>' +
        '在上面输入东财板块代码（如 <b>BK1136</b>）按回车就能加。</div>';
      return;
    }
    var kw = (searchEl && searchEl.value || '').trim().toLowerCase();
    var chosen = {};
    draft.forEach(function (b) { chosen[String(b.code).toUpperCase()] = 1; });
    var max = a.max();

    var list = all.filter(function (s) {
      /* 只认东财板块代码：行情是按 90.BKxxxx 拼的，新浪的 new_xxx 拉不到 */
      if (!/^BK\d+$/i.test(String(s.code || ''))) return false;
      if (chosen[String(s.code).toUpperCase()]) return false;
      if (!kw) return true;
      return (s.name || '').toLowerCase().indexOf(kw) >= 0 ||
             String(s.code || '').toLowerCase().indexOf(kw) >= 0;
    }).slice(0, 80);

    if (!list.length) {
      poolEl.innerHTML = '<div class="ut-msg">' + (kw ? '没找到「' + esc(kw) + '」' : '都已经在列表里了') + '</div>';
      return;
    }

    var full = draft.length >= max;
    poolEl.innerHTML = list.map(function (s) {
      return '<div class="ut-row' + (full ? ' on' : '') + '" data-code="' + esc(s.code) +
             '" data-name="' + esc(s.name) + '">' +
             '<span>' + esc(s.name) + '</span>' +
             '<span class="ut-row-code">' + esc(s.code) + '</span>' +
             '<span class="ut-row-add">' + (full ? '' : '+') + '</span></div>';
    }).join('');

    if (full) return;
    Array.prototype.forEach.call(poolEl.querySelectorAll('.ut-row'), function (row) {
      row.addEventListener('click', function () {
        if (addSector({ name: row.getAttribute('data-name'), code: row.getAttribute('data-code') })) {
          renderCur(); renderPool();
        }
      });
    });
  }

  function addSector(item) {
    var max = hot() ? hot().max() : 12;
    var code = String(item.code || '').toUpperCase();
    if (!/^BK\d{4}$/.test(code)) { toast('板块代码要形如 BK1136'); return false; }
    if (draft.some(function (b) { return String(b.code).toUpperCase() === code; })) {
      toast('这个板块已经在列表里了'); return false;
    }
    if (draft.length >= max) { toast('最多 ' + max + ' 个板块'); return false; }
    draft.push({ name: String(item.name || code), code: code });
    queueSave();
    return true;
  }

  /* ── 拉一次全量板块当候选池 ── */
  function fillPool() {
    var a = hot();
    if (!a) return;
    if (a.pool().length) { renderPool(); return; }
    poolEl.innerHTML = '<div class="ut-msg">板块列表加载中…</div>';
    try { a.loadPool(); } catch (e) {}
    var n = 0;
    poolTimer = setInterval(function () {
      n++;
      if (a.pool().length) {
        clearInterval(poolTimer); poolTimer = null; renderPool();
      } else if (n > 20) {
        clearInterval(poolTimer); poolTimer = null;
        if (poolEl) poolEl.innerHTML = '<div class="ut-msg">板块列表没加载出来（可能是行情源不通）</div>';
      }
    }, 400);
  }

  /* ── 保存（防抖：连续增删只拉一次行情）── */
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 420);
  }
  function flushSave() {
    clearTimeout(saveTimer); saveTimer = null;
    var a = hot();
    if (!a || !draft.length) return;
    a.set(draft);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ═════════════════════════════════════════════════════════════════
     ② 左上角头像
     ═════════════════════════════════════════════════════════════════ */
  var DEFAULT_AVATAR = '';

  function initAvatar() {
    var icon = document.querySelector('.logo .logo-icon');
    if (!icon) return false;
    var img = icon.querySelector('.logo-dog');
    if (!img) return false;

    if (!DEFAULT_AVATAR) DEFAULT_AVATAR = img.getAttribute('src') || '';

    var saved = null;
    try { saved = localStorage.getItem(LS_AVATAR); } catch (e) {}
    if (saved && saved.indexOf('data:image/') === 0) applyAvatar(saved);

    if (icon.querySelector('.ut-avatar-btn')) return true;
    icon.classList.add('ut-avatar');

    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ut-avatar-btn';
    b.title = '点击更换头像（右键恢复默认）';
    b.setAttribute('aria-label', '更换头像');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
                  'stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>' +
                  '<circle cx="12" cy="13" r="3"/></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); pickAvatar();
    });
    b.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation(); resetAvatar();
    });
    icon.appendChild(b);

    icon.addEventListener('click', function (e) {
      if (b.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      pickAvatar();
    });

    return true;
  }

  function pickAvatar() {
    var inp = document.getElementById('ut-file');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.id = 'ut-file';
      inp.style.position = 'fixed';
      inp.style.left = '-9999px';
      inp.style.top = '0';
      document.body.appendChild(inp);
      inp.addEventListener('change', onAvatarFile);
    }
    inp.value = '';
    inp.click();
  }

  function onAvatarFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type || '')) { toast('请选一张图片'); return; }
    if (f.size > 12 * 1024 * 1024) { toast('图片超过 12MB，换一张吧'); return; }

    shrinkSquare(f, AVATAR_SIZE).then(function (dataUrl) {
      try {
        localStorage.setItem(LS_AVATAR, dataUrl);
      } catch (err) {
        toast('保存失败：本地存储空间不足');
        return;
      }
      applyAvatar(dataUrl);
      toast('头像已更新');
    }).catch(function () {
      toast('这张图读不出来，换一张试试');
    });
  }

  /* 居中裁正方形 → 缩放 → JPEG（比 PNG 小一个量级） */
  function shrinkSquare(file, size) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var s = Math.min(w, h);
          var c = document.createElement('canvas');
          c.width = c.height = size;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.9));
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function applyAvatar(src) {
    var img = document.querySelector('.logo .logo-dog');
    if (!img) return;
    img.src = src;
    img.classList.add('ut-custom');
  }

  function resetAvatar() {
    try { localStorage.removeItem(LS_AVATAR); } catch (e) {}
    var img = document.querySelector('.logo .logo-dog');
    if (img && DEFAULT_AVATAR) {
      img.src = DEFAULT_AVATAR;
      img.classList.remove('ut-custom');
    }
    toast('已恢复默认头像');
  }

  /* ═════════════════════════════════════════════════════════════════
     启动：首屏可能还在渲染骨架，前几秒补几次
     ═════════════════════════════════════════════════════════════════ */
  function boot() {
    ensureManageBtn();
    initAvatar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  [300, 800, 1600, 3000].forEach(function (t) { setTimeout(boot, t); });

  window.__userTune = {
    openHot: function () {
      var b = document.querySelector('.sec-hot-title .ut-manage');
      if (b) { closePanel(); openPanel(b); }
    },
    resetAvatar: resetAvatar,
    avatarSize: AVATAR_SIZE
  };
})();
