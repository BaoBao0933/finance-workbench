/* ==========================================================================
   focus-manage：「重点关注」板块自定义管理
   - 管理按钮（刷新按钮旁）→ 编辑模式：每格出现删除角标 + 尾部添加卡
   - 自定义板块存 finance-focus-list（qt.gtimg.cn 直查行情，与首页同机制）
   - 关键词板块的删除 = 加入 finance-focus-hide 黑名单（面板可恢复）
   ========================================================================== */
(function () {
  if (window.__focusManage) return;
  window.__focusManage = { version: '1.0.0' };

  var editMode = false, panel = null;
  var allCache = null, ALL_TTL = 5 * 60 * 1000;
  var RENDER_LIMIT = 80;

  function grid() { return document.getElementById('focus-sectors'); }
  function getList() { try { return JSON.parse(localStorage.getItem('finance-focus-list') || '[]'); } catch (e) { return []; } }
  function setList(l) { try { localStorage.setItem('finance-focus-list', JSON.stringify(l)); } catch (e) {} }
  function getHide() { try { return JSON.parse(localStorage.getItem('finance-focus-hide') || '[]'); } catch (e) { return []; } }
  function setHide(h) { try { localStorage.setItem('finance-focus-hide', JSON.stringify(h)); } catch (e) {} }
  function cells() { var g = grid(); return g ? [].slice.call(g.querySelectorAll('.sec-cell')) : []; }
  function toast(m) { if (typeof window.showToast === 'function') window.showToast(m); }
  function reload() { if (typeof window.loadFocusSectors === 'function') window.loadFocusSectors(); }

  /* ---------------- 管理按钮 ---------------- */
  function ensureBtn() {
    var rf = document.getElementById('btn-focus-refresh');
    if (!rf || document.getElementById('fmc-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'fmc-btn'; btn.className = 'fmc-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span>管理</span>';
    btn.addEventListener('click', function () { setEdit(!editMode); });
    rf.parentNode.insertBefore(btn, rf);
  }
  function setEdit(on) {
    editMode = on;
    var g = grid(); if (!g) return;
    g.classList.toggle('fmc-editing', on);
    var b = document.getElementById('fmc-btn');
    if (b) { b.classList.toggle('on', on); b.querySelector('span').textContent = on ? '完成' : '管理'; }
    if (on) { decorate(); buildAddCell(); }
    else { teardown(); closePanel(); }
  }

  /* ---------------- 编辑态角标 / 添加卡 ---------------- */
  function decorate() {
    cells().forEach(function (cell) {
      if (cell.querySelector('.fmc-del')) return;
      var d = document.createElement('button');
      d.type = 'button'; d.className = 'fmc-del';
      d.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      cell.appendChild(d);
    });
    buildAddCell();
  }
  function teardown() {
    var g = grid(); if (!g) return;
    g.querySelectorAll('.fmc-del').forEach(function (d) { d.remove(); });
    var a = g.querySelector('.fmc-add-cell'); if (a) a.remove();
  }
  function buildAddCell() {
    var g = grid(); if (!g || g.querySelector('.fmc-add-cell')) return;
    if (getList().length >= 24) return;
    var el = document.createElement('div');
    el.className = 'sec-cell fmc-add-cell';
    el.innerHTML = '<div class="scn" style="color:var(--accent)">＋ 添加板块</div><div class="scc">从全量板块中选取</div>';
    g.appendChild(el);
  }

  /* ---------------- 点击拦截（捕获，先于打开详情） ---------------- */
  document.addEventListener('click', function (e) {
    if (!editMode) return;
    if (!e.target.closest || !e.target.closest('#focus-sectors')) return;
    var del = e.target.closest('.fmc-del');
    if (del) { e.stopPropagation(); e.preventDefault(); doDelete(del); return; }
    if (e.target.closest('.fmc-add-cell')) { e.stopPropagation(); e.preventDefault(); openPanel(); return; }
    if (e.target.closest('.sec-cell')) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  function cellName(cell) {
    var n = cell.querySelector('.scn');
    return n ? n.textContent.replace(/\s*★$/, '') : '';
  }
  function doDelete(delBtn) {
    var cell = delBtn.closest('.sec-cell'); if (!cell) return;
    var name = cellName(cell); if (!name) return;
    if (getList().some(function (s) { return s.name === name; })) {
      setList(getList().filter(function (s) { return s.name !== name; }));
      toast('已删除「' + name + '」');
    } else {
      var h = getHide(); if (h.indexOf(name) < 0) h.push(name); setHide(h);
      toast('已隐藏「' + name + '」· 添加面板可恢复');
    }
    reload();
  }

  /* ---------------- 添加面板（复用 se-add-panel 样式） ---------------- */
  function normRows(rows) {
    return (rows || []).map(function (r) {
      var secid = '', name = '';
      if (r.secid) { secid = r.secid; name = r.name || ''; }
      else if (r.bd_code) { secid = 'qq.' + r.bd_code; name = r.bd_name || ''; }
      else if (r.f12) {
        name = r.f14 || '';
        secid = (/^BK/i.test(r.f12) || /^\d+$/.test(r.f12)) ? '90.' + r.f12 : 'qq.' + r.f12;
      }
      var okc = /^90\.BK\d+$/.test(secid) || /^qq\.\w+$/.test(secid);
      return (secid && name && okc) ? { secid: secid, name: name } : null;
    }).filter(Boolean);
  }
  function dedupe(rows) {
    var added = {}, seen = {}, out = [];
    getList().forEach(function (s) { added[s.secid] = 1; added['n:' + s.name] = 1; });
    getHide().forEach(function (n) { added['h:' + n] = 1; });
    rows.forEach(function (s) {
      if (!s || seen[s.secid] || added[s.secid] || added['n:' + s.name] || added['h:' + s.name]) return;
      seen[s.secid] = 1; out.push(s);
    });
    return out;
  }
  function fetchQQAll() {
    var Q = window.QF;
    if (Q && typeof Q.fetchQQBoards === 'function') {
      return Promise.all([Q.fetchQQBoards('industry'), Q.fetchQQBoards('concept')])
        .then(function (rs) { return normRows(rs[0].concat(rs[1])); });
    }
    return Promise.reject(new Error('no QF'));
  }
  function refreshAll() {
    if (allCache && (Date.now() - allCache.t) < ALL_TTL && allCache.list.length >= 100) return;
    fetchQQAll().then(function (rows) {
      if (rows.length < 30) return;
      allCache = { t: Date.now(), list: rows };
      if (panel) fillList(rows);
    }).catch(function () {});
  }
  function fillList(all) {
    if (!panel) return;
    panel.__all = (all || []).filter(function (s) { return !addedNow(s); });
    var cnt = panel.querySelector('#fmApCount');
    if (cnt) cnt.textContent = panel.__all.length ? '共 ' + panel.__all.length + ' 个可选' : '加载中…';
    renderList(panel.__kw || '');
  }
  function addedNow(s) {
    return getList().some(function (x) { return x.secid === s.secid || x.name === s.name; })
      || getHide().indexOf(s.name) >= 0;
  }
  function renderList(kw) {
    if (!panel) return;
    panel.__kw = kw;
    var box = panel.querySelector('#fmApList'); if (!box) return;
    var all = panel.__all || [];
    var rows = kw ? all.filter(function (s) {
      return s.name.toLowerCase().indexOf(kw) >= 0 || s.secid.toLowerCase().indexOf(kw) >= 0;
    }) : all;
    var html = rows.slice(0, RENDER_LIMIT).map(function (s, i) {
      return '<button type="button" class="se-ap-row" data-secid="' + s.secid + '" data-name="' + s.name + '" style="animation-delay:' + Math.min(i * 18, 360) + 'ms">'
        + '<span class="se-ap-name">' + s.name + '</span>'
        + '<span class="se-ap-code">' + s.secid.split('.')[1] + '</span>'
        + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>';
    }).join('');
    if (!html) html = '<div class="se-ap-empty">' + (kw ? '没有匹配「' + kw + '」的板块' : '正在获取全部板块…') + '</div>';
    else if (rows.length > RENDER_LIMIT) html += '<div class="se-ap-more">共 ' + rows.length + ' 个匹配，输入关键词缩小范围</div>';
    box.innerHTML = html + restoreHtml();
  }
  function restoreHtml() {
    var h = getHide();
    if (!h.length) return '';
    return '<div class="se-ap-restore"><span style="opacity:.7">已隐藏：</span>' + h.map(function (n) {
      return '<button type="button" class="se-ap-row se-restore-chip" data-restore="' + n + '">' + n + ' ↩</button>';
    }).join('') + '</div>';
  }
  function doAdd(secid, name) {
    var l = getList();
    if (l.some(function (s) { return s.name === name; })) { toast('已在关注列表'); return; }
    if (l.length >= 24) { toast('最多 24 个板块'); return; }
    l.push({ secid: secid, name: name });
    setList(l);
    setHide(getHide().filter(function (n) { return n !== name; }));
    if (panel && panel.__all) {
      panel.__all = panel.__all.filter(function (s) { return s.name !== name; });
      renderList(panel.__kw || '');
    }
    reload();
    toast('已添加「' + name + '」，行情刷新中…');
  }
  function closePanel() {
    if (!panel) return;
    panel.remove(); panel = null;
    document.removeEventListener('pointerdown', outsideClose, true);
    document.removeEventListener('keydown', escClose, true);
  }
  function outsideClose(e) { if (panel && !panel.contains(e.target)) closePanel(); }
  function escClose(e) { if (e.key === 'Escape') closePanel(); }
  function openPanel() {
    closePanel();
    panel = document.createElement('div');
    panel.className = 'se-add-panel';
    panel.innerHTML =
      '<div class="se-ap-title">添加关注板块 <span class="se-ap-count" id="fmApCount">加载中…</span></div>'
      + '<div class="se-ap-search"><input id="fmApSearch" type="text" placeholder="搜索板块名 / 代码" autocomplete="off" spellcheck="false"></div>'
      + '<div class="se-ap-list" id="fmApList"></div>';
    document.body.appendChild(panel);
    var b = document.getElementById('fmc-btn');
    if (b) {
      var r = b.getBoundingClientRect(), vw = window.innerWidth;
      panel.style.left = Math.min(Math.max(8, r.right - 240), vw - 248) + 'px';
      panel.style.top = Math.min(r.bottom + 8, window.innerHeight - panel.offsetHeight - 12) + 'px';
    }
    panel.querySelector('#fmApSearch').addEventListener('input', function () { renderList(this.value.trim().toLowerCase()); });
    panel.addEventListener('click', function (e) {
      var row = e.target.closest('.se-ap-row');
      if (!row) return;
      if (row.dataset.restore) {
        setHide(getHide().filter(function (n) { return n !== row.dataset.restore; }));
        reload(); fillList(allCache ? allCache.list : []); toast('已恢复「' + row.dataset.restore + '」');
        return;
      }
      doAdd(row.dataset.secid, row.dataset.name);
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', outsideClose, true);
      document.addEventListener('keydown', escClose, true);
    }, 0);
    fillList(allCache ? allCache.list : []);
    refreshAll();
    var inp = panel.querySelector('#fmApSearch');
    if (inp) setTimeout(function () { inp.focus(); }, 60);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    ensureBtn();
    if (!document.getElementById('fmc-btn')) setTimeout(boot, 800);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
