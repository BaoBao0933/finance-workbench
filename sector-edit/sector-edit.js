/* ==========================================================================
   首页「热门行业板块」自定义 —— 添加 / 删除 / 拖动排序
   依赖主脚本暴露的 window.__sectorsHook（由 inject.py 注入）
   动效：border-beam 流光边（@property + conic-gradient + mask 裁边）
         FLIP 拖拽排序 / backOut 弹入 / blur 缩出删除 —— 与工作台缓动一致
   ========================================================================== */
(function () {
  'use strict';
  var hook = window.__sectorsHook;
  var strip = document.getElementById('sector-strip');
  if (!hook || !strip) return;

  var MAX = 12;                 // 最多同时展示的板块数
  var LS_KEY = 'finance-sectors';
  var editMode = false;
  var panel = null;
  var toast = hook.toast || function () {};

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

  /* ---------------- 添加面板 ---------------- */
  function openPanel() {
    closePanel();
    var pool = (window.SECTOR_POOL || []).filter(function (s) {
      return !getList().some(function (x) { return x.secid === s.secid; });
    });
    if (!pool.length) { toast('板块都加上了，删一个再试'); return; }
    panel = document.createElement('div');
    panel.className = 'se-add-panel';
    panel.innerHTML =
      '<div class="se-ap-title">添加板块 <span>点击即加入，最多 ' + MAX + ' 个</span></div>' +
      pool.map(function (s, i) {
        return '<button type="button" class="se-ap-row" data-secid="' + s.secid + '" data-name="' + s.name + '" style="animation-delay:' + (i * 26) + 'ms">' +
          '<span class="se-ap-name">' + s.name + '</span>' +
          '<span class="se-ap-code">' + s.secid.split('.')[1] + '</span>' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
          '</button>';
      }).join('');
    document.body.appendChild(panel);
    var ac = addChip();
    if (ac) {
      var r = ac.getBoundingClientRect();
      var vw = window.innerWidth;
      var left = Math.min(Math.max(8, r.right - 236), vw - 244);
      panel.style.left = left + 'px';
      panel.style.top = Math.min(r.bottom + 8, window.innerHeight - panel.offsetHeight - 12) + 'px';
    }
    panel.addEventListener('click', function (e) {
      var row = e.target.closest('.se-ap-row');
      if (!row) return;
      doAdd(row.dataset.secid, row.dataset.name);
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', outsideClose, true);
      document.addEventListener('keydown', escClose, true);
    }, 0);
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
    closePanel();
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
