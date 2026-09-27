/* ==========================================================================
   首页「热门行业板块」自定义 —— 添加 / 删除 / 拖动排序
   依赖主脚本暴露的 window.__sectorsHook（由 inject.py 注入）
   动效：border-beam 流光边（@property + conic-gradient + mask 裁边）
         FLIP 拖拽排序 / backOut 弹入 / blur 缩出删除 —— 与工作台缓动一致

   v2 添加面板：可选池从静态 SECTOR_POOL（11 个）升级为全量板块
   （东财 clist 行业 + 概念，600+ 个），带搜索框；数据源三级降级：
   内存缓存 → 主文件已拉的全量（__sectorsHook.getAllSectors）→ 现拉 clist → 静态池
   ========================================================================== */
(function () {
  'use strict';
  var hook = window.__sectorsHook;
  var strip = document.getElementById('sector-strip');
  if (!hook || !strip) return;

  var MAX = 24;                 // 最多同时展示的板块数（strip 横向可滚动）
  var LS_KEY = 'finance-sectors';
  var editMode = false;
  var panel = null;
  var toast = hook.toast || function () {};

  /* ---- 全量板块缓存（5 分钟）---- */
  var ALL_TTL = 5 * 60 * 1000;
  var allCache = null;          // { t, list: [{secid:'90.BKxxxx', name}] }
  var RENDER_LIMIT = 80;        // 面板单次最多渲染行数（900+ 行全渲染会卡）

  function getList() { return hook.getList(); }
  function setList(l) { hook.setList(l); }

  /* ---------------- 编辑按钮 ---------------- */
  var btn = null;
  function ensureButton() {
    if (btn) return;
    var head = document.querySelector('.sector-head');
    if (!head) return;
    var source = head.querySelector('.sector-source');
    var right = document.createElement('div');
    right.className = 'se-right';
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'se-edit-btn';
    btn.id = 'btn-sector-edit';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span>管理</span>';
    btn.addEventListener('click', function () { setEdit(!editMode); });
    if (source) {
      head.replaceChild(right, source);
      right.appendChild(source);
      right.appendChild(btn);
    } else {
      head.appendChild(btn);
    }
  }

  /* ---------------- 编辑模式 ---------------- */
  function setEdit(on) {
    editMode = on;
    strip.classList.toggle('se-editing', on);
    btn.classList.toggle('on', on);
    btn.querySelector('span').textContent = on ? '完成' : '管理';
    if (on) { decorate(); if (!strip.contains(addChip())) buildAddChip(); }
    else { teardown(); closePanel(); }
  }

  function chips() {
    return [].slice.call(strip.querySelectorAll('.sector-chip:not(.sc-add-chip)'));
  }
  function addChip() { return strip.querySelector('.sc-add-chip'); }

  /* 给每只板块卡装上删除角标（幂等） */
  function decorate() {
    chips().forEach(function (chip, i) {
      if (chip.querySelector('.sc-del')) return;
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'sc-del';
      d.style.animationDelay = (i * 30) + 'ms';
      d.setAttribute('aria-label', '删除 ' + (chip.dataset.name || ''));
      d.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      chip.appendChild(d);
    });
  }
  function teardown() {
    strip.querySelectorAll('.sc-del').forEach(function (d) { d.remove(); });
    var ac = addChip();
    if (ac) ac.remove();
    chips().forEach(function (c) { c.classList.remove('se-drag'); c.style.transform = ''; });
  }

  /* ---------------- 添加入口（流光边框卡） ---------------- */
  function buildAddChip() {
    if (addChip()) return;
    if (getList().length >= MAX) return;
    var el = document.createElement('div');
    el.className = 'sector-chip sc-add-chip';
    el.setAttribute('role', 'button');
    el.setAttribute('title', '添加板块');
    el.innerHTML = '<span class="sc-add-ico"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><span>添加</span>';
    strip.appendChild(el);
  }

  /* ---------------- 编辑态点击拦截（捕获阶段，先于主脚本的打开成分股） ---------------- */
  strip.addEventListener('click', function (e) {
    if (!editMode) return;
    var del = e.target.closest('.sc-del');
    if (del) { e.stopPropagation(); e.preventDefault(); doDelete(del); return; }
    if (e.target.closest('.sc-add-chip')) { e.stopPropagation(); e.preventDefault(); openPanel(); return; }
    if (e.target.closest('.sector-chip')) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  function doDelete(delBtn) {
    var chip = delBtn.closest('.sector-chip');
    if (!chip) return;
    var id = chip.dataset.secid;
    setList(getList().filter(function (s) { return s.secid !== id; }));
    /* 其余卡片 FLIP 补位 */
    var others = chips().filter(function (c) { return c !== chip; });
    var oldLeft = {};
    others.forEach(function (c) { oldLeft[c.dataset.secid] = c.getBoundingClientRect().left; });
    chip.classList.add('sc-out');
    setTimeout(function () {
      chip.remove();
      delete hook.cache[id];
      renumber();
      others.forEach(function (c) { flipFrom(c, oldLeft[c.dataset.secid]); });
    }, 180);
    toast('已删除「' + (chip.dataset.name || '') + '」');
  }

  /* ---------------- 拖拽排序（FLIP） ---------------- */
  var drag = null;
  strip.addEventListener('pointerdown', function (e) {
    if (!editMode || e.button !== 0) return;
    var chip = e.target.closest('.sector-chip');
    if (!chip || chip.classList.contains('sc-add-chip')) return;
    if (e.target.closest('.sc-del')) return;
    e.preventDefault();
    drag = {
      chip: chip,
      id: chip.dataset.secid,
      startX: e.clientX,
      baseLeft: chip.getBoundingClientRect().left,
      moved: false,
      width: chip.getBoundingClientRect().width
    };
    try { chip.setPointerCapture(e.pointerId); } catch (err) {}
  });
  strip.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.chip.classList.add('se-drag');
    }
    drag.chip.style.transform = 'translateX(' + dx + 'px) scale(1.05)';
    /* 拖拽卡中心（基准取拖拽起始位置，不受 DOM 重排影响） */
    var center = drag.baseLeft + dx + drag.width / 2;
    var target = null;
    var list = chips();
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === drag.chip) continue;
      var r = c.getBoundingClientRect();
      if (center < r.left + r.width / 2) { target = c; break; }
    }
    if (target !== drag.over) {
      drag.over = target;
      reorderDOM(drag.chip, target);
    }
  });
  function endDrag(e) {
    if (!drag) return;
    var d = drag; drag = null;
    d.chip.classList.remove('se-drag');
    d.chip.style.transform = '';
    if (d.moved) commitOrder();
  }
  strip.addEventListener('pointerup', endDrag);
  strip.addEventListener('pointercancel', endDrag);

  function reorderDOM(chip, before) {
    var others = chips().filter(function (c) { return c !== chip; });
    var oldLeft = {};
    others.forEach(function (c) { oldLeft[c.dataset.secid] = c.getBoundingClientRect().left; });
    if (before) strip.insertBefore(chip, before);
    else strip.insertBefore(chip, addChip());   /* 拖到最右：插到「添加」卡之前 */
    others.forEach(function (c) { flipFrom(c, oldLeft[c.dataset.secid]); });
  }

  /* FLIP：从旧位置平滑滑到新位置 */
  function flipFrom(el, oldLeft) {
    var newLeft = el.getBoundingClientRect().left;
    var dx = oldLeft - newLeft;
    if (Math.abs(dx) < 1) return;
    el.style.transition = 'none';
    el.style.transform = 'translateX(' + dx + 'px)';
    requestAnimationFrame(function () {
      el.style.transition = 'transform .3s cubic-bezier(.22, 1, .36, 1)';
      el.style.transform = '';
      setTimeout(function () { el.style.transition = ''; }, 320);
    });
  }

  function commitOrder() {
    var order = chips().map(function (c) { return c.dataset.secid; });
    var byId = {};
    getList().forEach(function (s) { byId[s.secid] = s; });
    setList(order.map(function (id) { return byId[id]; }).filter(Boolean));
    renumber();
  }
  function renumber() {
    var i = 0;
    chips().forEach(function (c) {
      var r = c.querySelector('.sc-rank');
      if (r) r.textContent = '#' + (++i);
    });
  }

  /* ================= 添加面板（v2：全量板块 + 搜索） ================= */

  /* 统一行格式：{secid, name}
     secid 两种：'90.BKxxxx'（东财源，可拉成分股）/'qq.pt02GNxxxx'（腾讯源）。
     兼容三种输入：clist 行（f12/f14）、secAllList 项（code/name，注意是 code 不是 f12）、
     腾讯板块（bd_code/bd_name，用 qq 前缀避免与东财码混淆）。 */
  function normRows(rows) {
    return (rows || []).map(function (r) {
      /* 元素级守卫：上游数组可能混入 null / 非对象（东财或腾讯任一源异常时）。
         此前只在数组层兜了 (rows || [])，一个 null 元素就会让整批转换抛错，
         全量池直接归零（回到只有静态兜底那几条）。 */
      if (!r || typeof r !== 'object') return null;
      var secid = '', name = '';
      if (r.secid) {                       // 已是目标格式（最可靠，直接采用）
        secid = r.secid;
        name = r.name || r.f14 || r.bd_name || '';
      } else if (r.bd_code) {               // 腾讯原始行
        secid = 'qq.' + r.bd_code; name = r.bd_name || '';
      } else if (r.f12) {
        /* f12 有两个来源，必须按前缀分流：
           - 东财 clist          → 'BK1136'    → '90.BK1136'
           - quote-fallback 转换 → 'pt01801131' → 'qq.pt01801131'
           曾经一律加 '90.'，导致腾讯行变成 '90.pt01801131' 通不过格式校验，
           927 条板块被整批丢弃（面板只剩静态池那 5 个）。 */
        name = r.f14 || '';
        secid = (/^BK/i.test(r.f12) || /^\d+$/.test(r.f12)) ? '90.' + r.f12 : 'qq.' + r.f12;
      } else if (r.code) {                  // 主文件 secAllList（code 字段）
        name = r.name || '';
        secid = (/^BK/i.test(r.code) || /^\d+$/.test(r.code)) ? '90.' + r.code : 'qq.' + r.code;
      } else if (r.name && r.qq) {          // sector-edit 内部格式
        secid = 'qq.' + r.qq; name = r.name;
      }
      var ok = /^90\.BK\d+$/.test(secid) || /^qq\.\w+$/.test(secid);
      return (secid && name && ok) ? { secid: secid, name: name } : null;
    }).filter(Boolean);
  }

  /* 东财全量拿不到时的兜底：腾讯板块（行业 124 + 概念 803） */
  function fetchQQDirect(kind, pageSize, maxP) {
    /* 自包含腾讯板块拉取（不依赖 quote-fallback 模块）。
       直接产出 {secid:'qq.xxx', name} 的目标格式，绕开 f12 字段歧义。 */
    var t = kind === 'industry' ? '01' : '02';
    var l = pageSize || 500, maxP = maxP || 3;
    var base = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/mktHs/rank';
    var out = [], page = 1;
    function step() {
      if (page > maxP) return Promise.resolve(out);
      return fetch(base + '?l=' + l + '&p=' + page + '&t=' + t + '/averatio&ordertype=0',
                   { referrerPolicy: 'no-referrer', cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) {
          var rows = (j && j.data) || [];
          if (!rows.length) return out;
          rows.forEach(function (x) {
            if (x.bd_code && x.bd_name) out.push({ secid: 'qq.' + x.bd_code, name: x.bd_name });
          });
          if (rows.length < l) return out;
          page++;
          return step();
        });
    }
    return step();
  }

  function fetchQQAll() {
    /* 东财全量拿不到（push2 被限流）时的兜底：腾讯板块 124 行业 + 803 概念。
       优先复用 quote-fallback 的 QF.fetchQQBoards；若该模块不在（加载失败 /
       注入顺序变动），就地自包含拉取——不让整个全量池因另一个模块缺席而失效。 */
    var Q = window.QF;
    if (Q && typeof Q.fetchQQBoards === 'function') {
      return Promise.all([Q.fetchQQBoards('industry'), Q.fetchQQBoards('concept')])
        .then(function (rs) { return normRows(rs[0].concat(rs[1])); })
        .then(function (rows) {
          if (rows.length) return rows;
          throw new Error('qf empty');       // 拿到行但全被丢弃 → 走自包含实现
        })
        .catch(function () {
          return Promise.all([fetchQQDirect('industry'), fetchQQDirect('concept')])
            .then(function (rs) { return rs[0].concat(rs[1]); });
        });
    }
    return Promise.all([fetchQQDirect('industry'), fetchQQDirect('concept')])
      .then(function (rs) { return rs[0].concat(rs[1]); });
  }

  /* 去重（按 secid，再按板块名去重——同名时保留东财码那条，它能拉成分股）+ 剔除已添加 */
  function dedupe(rows) {
    var added = addedMap();
    var seenSecid = {}, seenName = {}, out = [];
    rows.forEach(function (s) {
      if (!s) return;
      if (seenSecid[s.secid] || added[s.secid] || added['n:' + s.name]) return;
      // 同名板块优先保留东财码（90.BK），腾讯码只在没有东财版本时保留
      var nameKey = s.name.toLowerCase();
      if (seenName[nameKey]) {
        if (s.secid.indexOf('90.BK') === 0 && out[seenName[nameKey] - 1].secid.indexOf('qq.') === 0) {
          out[seenName[nameKey] - 1] = s;   // 用东财版替换腾讯版
        }
        return;
      }
      seenSecid[s.secid] = 1;
      seenName[nameKey] = out.length + 1;   // 1-based 位置
      out.push(s);
    });
    return out;
  }

  /* 已添加集合：secid 与板块名双索引。
     必须按名字也索引 —— 同一板块在东财是 '90.BK1136'、在腾讯是 'qq.pt02GN2190'，
     只比 secid 会让「已加过的板块」在另一个源的列表里再次出现，导致重复添加。 */
  function addedMap() {
    var m = {};
    getList().forEach(function (s) {
      m[s.secid] = 1;
      if (s.name) m['n:' + s.name] = 1;
    });
    return m;
  }

  /* 已有的全量数据：主文件行业板块页加载后 secAllList 非空 */
  function getCachedAll() {
    var now = Date.now();
    if (allCache && (now - allCache.t) < ALL_TTL && allCache.list.length) return allCache.list;
    var local = hook.getAllSectors ? hook.getAllSectors() : [];
    if (local.length >= 60) {
      allCache = { t: now, list: normRows(local) };
      return allCache.list;
    }
    return hook.pool || [];
  }

  /* 后台拉东财 clist 全量（行业 t:2 + 概念 t:3，翻页到拉完） */
  function fetchBoardType(t) {
    var QH = window.__quoteHook;
    if (!QH || typeof QH.fetchJson !== 'function') return Promise.reject(new Error('no hook'));
    var all = [], page = 1;
    function step() {
      if (page > 12) return Promise.resolve(all);
      var url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=' + page +
        '&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:' + t +
        '+f:!50&fields=f12,f14';
      return QH.fetchJson(url, 2500).then(function (res) {
        var diff = res && res.data && res.data.diff;
        if (!diff || !diff.length) return all;
        all = all.concat(diff);
        if (diff.length < 100) return all;
        page++;
        return step();
      });
    }
    return step();
  }

  function refreshAll() {
    if (allCache && (Date.now() - allCache.t) < ALL_TTL && allCache.list.length >= 100) return;

    var settled = false;
    function apply(list) {
      if (settled) return false;
      var out = dedupe(list);
      if (out.length < 30) return false;     // 太少视为无效（别让静态池顶掉真实全量）
      settled = true;
      allCache = { t: Date.now(), list: out };
      if (panel) fillList(out);              // 原地刷新（保留搜索词）
      return true;
    }

    /* 两个源并行竞速，谁先给出有效全量就用谁。
       原先东财串行翻页在前、失败才走腾讯，一旦东财慢或半通，用户要干等；
       并行后腾讯通常 0.5s 内返回，面板几乎是立刻从「加载中…」跳到全量。 */
    fetchQQAll().then(apply).catch(function () {});

    /* 东财带 BK 码、能拉成分股，更优；先探首页（短超时），失败立即放弃翻页 */
    Promise.all([fetchBoardType('2'), fetchBoardType('3')])
      .then(function (rs) { apply(normRows(rs[0].concat(rs[1]))); })
      .catch(function () {});
  }

  /* ---- 面板 ---- */
  function positionPanel() {
    var ac = addChip();
    if (!ac || !panel) return;
    var r = ac.getBoundingClientRect();
    var vw = window.innerWidth;
    var left = Math.min(Math.max(8, r.right - 240), vw - 248);
    panel.style.left = left + 'px';
    panel.style.top = Math.min(r.bottom + 8, window.innerHeight - panel.offsetHeight - 12) + 'px';
  }

  function openPanel() {
    closePanel();

    panel = document.createElement('div');
    panel.className = 'se-add-panel';
    panel.innerHTML =
      '<div class="se-ap-title">添加板块 <span class="se-ap-count" id="seApCount">加载中…</span></div>' +
      '<div class="se-ap-search"><input id="seApSearch" type="text" placeholder="搜索板块名 / 代码" autocomplete="off" spellcheck="false"></div>' +
      '<div class="se-ap-list" id="seApList"></div>';
    document.body.appendChild(panel);
    positionPanel();

    panel.querySelector('#seApSearch').addEventListener('input', function () {
      renderList(this.value.trim().toLowerCase());
    });
    panel.addEventListener('click', function (e) {
      var row = e.target.closest('.se-ap-row');
      if (!row) return;
      doAdd(row.dataset.secid, row.dataset.name);
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', outsideClose, true);
      document.addEventListener('keydown', escClose, true);
    }, 0);

    // 先用已有数据秒填，再后台拉全量（拉到后原地刷新，保留搜索词）
    // 传 pending=true：不足 30 条时只显示「加载中…」，不谎报可选数
    fillList(getCachedAll(), true);
    refreshAll();
    var inp = panel.querySelector('#seApSearch');
    if (inp) setTimeout(function () { inp.focus(); }, 60);
  }

  function fillList(all, pending) {
    if (!panel) return;
    var added = addedMap();
    panel.__all = (all || []).filter(function (s) { return !added[s.secid]; });
    /* pending：全量尚未返回时，不要把那几条静态兜底当成真实可选数报出去
       —— 用户看到「共 5 个可选」会直接以为功能坏了（这次的真实反馈）。 */
    panel.__pending = !!pending && panel.__all.length < 30;
    var cnt = panel.querySelector('#seApCount');
    if (cnt) cnt.textContent = panel.__pending
      ? '加载中…'
      : (panel.__all.length ? '共 ' + panel.__all.length + ' 个可选' : '暂无可添加');
    renderList(panel.__kw || '');
    positionPanel();   // 列表高度变化后重新定位
  }

  function renderList(kw) {
    if (!panel) return;
    panel.__kw = kw;
    var box = panel.querySelector('#seApList');
    if (!box) return;
    var all = panel.__all || [];
    var rows = kw ? all.filter(function (s) {
      return s.name.toLowerCase().indexOf(kw) >= 0 ||
             s.secid.toLowerCase().indexOf(kw) >= 0;
    }) : all;
    var total = rows.length;
    var html = rows.slice(0, RENDER_LIMIT).map(function (s, i) {
      return '<button type="button" class="se-ap-row" data-secid="' + s.secid + '" data-name="' + s.name + '" style="animation-delay:' + Math.min(i * 18, 360) + 'ms">' +
        '<span class="se-ap-name">' + s.name + '</span>' +
        '<span class="se-ap-code">' + s.secid.split('.')[1] + '</span>' +
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
        '</button>';
    }).join('');
    if (!html) {
      html = '<div class="se-ap-empty">' + (kw
        ? '没有匹配「' + kw + '」的板块'
        : (panel.__pending ? '正在获取全部板块…' : '暂无可添加的板块')) + '</div>';
    } else if (total > RENDER_LIMIT) {
      html += '<div class="se-ap-more">共 ' + total + ' 个匹配，输入关键词缩小范围</div>';
    }
    box.innerHTML = html;
  }

  function outsideClose(e) {
    if (panel && !panel.contains(e.target) && !e.target.closest('.sc-add-chip')) closePanel();
  }
  function escClose(e) { if (e.key === 'Escape') closePanel(); }
  function closePanel() {
    if (!panel) return;
    var p = panel; panel = null;
    p.classList.add('se-closing');
    setTimeout(function () { p.remove(); }, 160);
    document.removeEventListener('pointerdown', outsideClose, true);
    document.removeEventListener('keydown', escClose, true);
  }

  function doAdd(secid, name) {
    if (getList().length >= MAX) { toast('最多 ' + MAX + ' 个板块'); return; }
    var list = getList();
    list.push({ secid: secid, name: name });
    setList(list);
    buildSectorChip({ secid: secid, name: name, pct: null, price: null });
    // 从面板可选列表里摘掉这条
    if (panel && panel.__all) {
      panel.__all = panel.__all.filter(function (s) { return s.secid !== secid; });
      var cnt = panel.querySelector('#seApCount');
      if (cnt) cnt.textContent = panel.__all.length ? '共 ' + panel.__all.length + ' 个可选' : '都加上了';
      renderList(panel.__kw || '');
    }
    toast('已添加「' + name + '」，行情刷新中…');
  }

  /* 按主脚本同款结构造一只新卡（数据留空，由下一轮 updateSectors 填充） */
  function buildSectorChip(s) {
    var el = document.createElement('div');
    el.className = 'sector-chip sc-in';
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.dataset.secid = s.secid;
    el.dataset.code = s.secid.split('.').pop();
    el.dataset.name = s.name;
    el.dataset.pct = '0';
    el.title = s.name + ' · 点击查看成分股';
    el.innerHTML =
      '<div class="sc-top"><span class="sc-name">' + s.name + '</span><span class="sc-rank">#0</span></div>' +
      '<div class="sc-val flat">--%</div>' +
      '<div class="sc-bar"><i style="width:0%"></i></div>' +
      '<div class="sc-price">-- 点</div>';
    var anchor = addChip();
    if (anchor) strip.insertBefore(el, anchor); else strip.appendChild(el);
    hook.cache[s.secid] = {
      root: el,
      pctEl: el.querySelector('.sc-val'),
      barEl: el.querySelector('.sc-bar i'),
      priceEl: el.querySelector('.sc-price')
    };
    renumber();
    if (editMode) decorate();
    setTimeout(function () { el.classList.remove('sc-in'); }, 500);
  }

  /* ---------------- 启动 ---------------- */
  ensureButton();
  /* 编辑态下重建 DOM 后自动补角标（比如刷新后） */
  new MutationObserver(function () {
    if (editMode) { decorate(); if (!addChip()) buildAddChip(); renumber(); }
  }).observe(strip, { childList: true });
})();
