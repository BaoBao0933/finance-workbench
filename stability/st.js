/* ═══════════════════════════════════════════════════════════════════════════
   stability · 稳（2026-10-25，为 1024 造物挑战投稿前做的一轮加固）

   ① `:has()` 兜底    —— 给图标父级补 .has-iso / .has-flame
   ② 错误收集 + 诊断  —— JS 错误才亮角标，不打扰正常使用
   ③ 演示模式        —— 网络连不通时展示**真实收盘快照**并明确标注"非实时"
                        （绝不在没有标注的情况下冒充实时数据）
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__stInstalled) return;
  window.__stInstalled = 1;

  var VERSION = '1.0';
  var DEMO_QS = /[?&]demo=1/.test(location.search);

  /* ── ① :has() 兜底 ───────────────────────────────────────────────────── */
  function markHas() {
    var svgs = document.querySelectorAll('.hi-iso');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      if (svg.getAttribute('data-st-mark') === '1') continue;
      svg.setAttribute('data-st-mark', '1');
      var p = svg.parentNode;
      if (!p || !p.classList) continue;
      p.classList.add('has-iso');
      if (svg.getAttribute('data-hi') === 'flame') p.classList.add('has-flame');
    }
  }
  [200, 700, 1500, 3000, 5200, 8000].forEach(function (ms) { setTimeout(markHas, ms); });

  /* ── ② 错误收集 ──────────────────────────────────────────────────────── */
  var jsErrs = [];      /* JS 异常 / Promise 拒绝 */
  var resErrs = [];     /* 资源加载失败（接口被墙也会进来，单独归类） */
  var MAX = 30;

  function hhmmss(t) {
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) +
           ':' + ('0' + d.getSeconds()).slice(-2);
  }
  function trim(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  function add(kind, text) {
    var list = kind === 'res' ? resErrs : jsErrs;
    if (list.length >= MAX) list.shift();
    list.push({ t: Date.now(), m: text });
    if (kind !== 'res') paintBadge();
  }

  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.getAttribute && (t.getAttribute('src') || t.getAttribute('href')))) {
      var u = t.getAttribute('src') || t.getAttribute('href') || '';
      add('res', trim(u, 120));
      return;
    }
    add('js', trim((e.message || 'unknown') + ' @' +
      String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0), 160));
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    add('js', trim('Promise: ' + ((r && (r.message || r)) || 'rejected'), 160));
  });

  /* ── ② 诊断 UI ───────────────────────────────────────────────────────── */
  var badge = null, panel = null, panelBuilt = false;

  function paintBadge() {
    if (!jsErrs.length) {
      if (badge) badge.classList.remove('on');
      return;
    }
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'st-diag-badge';
      badge.setAttribute('aria-label', '查看诊断信息');
      badge.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePanel();
      });
      document.body.appendChild(badge);
    }
    badge.innerHTML = '<span class="st-dot"></span>诊断 ' + jsErrs.length;
    badge.classList.add('on');
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'st-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '诊断信息');
    panel.innerHTML =
      '<div class="st-panel-hd">诊断信息 · 稳 ' + VERSION +
      '<button class="st-x" type="button" aria-label="关闭">✕</button></div>' +
      '<div class="st-panel-bd" id="st-bd"></div>' +
      '<div class="st-panel-ft">' +
      '<button class="st-btn" type="button" id="st-copy">复制</button>' +
      '<button class="st-btn" type="button" id="st-clear">清空</button>' +
      '<button class="st-btn pri" type="button" id="st-close">关闭</button>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('.st-x').addEventListener('click', closePanel);
    panel.querySelector('#st-close').addEventListener('click', closePanel);
    panel.querySelector('#st-clear').addEventListener('click', function () {
      jsErrs.length = 0; resErrs.length = 0;
      paintBadge(); renderPanel(); closePanel();
    });
    panel.querySelector('#st-copy').addEventListener('click', function () {
      var txt = report();
      var done = function () {
        var b = panel.querySelector('#st-copy');
        b.textContent = '已复制'; setTimeout(function () { b.textContent = '复制'; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
      } else {
        fallbackCopy(txt, done);
      }
    });
    panelBuilt = true;
  }

  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function envLine() {
    return 'v' + VERSION + ' · ' + location.pathname + ' · ' +
      (window.innerWidth + '×' + window.innerHeight) + ' · dpr' + (window.devicePixelRatio || 1) + '<br>' +
      trim(navigator.userAgent, 150);
  }

  function renderPanel() {
    if (!panel) return;
    var bd = panel.querySelector('#st-bd');
    var h = '<div class="st-env">' + envLine() + '</div>';
    if (!jsErrs.length) {
      h += '<div class="st-empty">没有 JS 异常 —— 页面运行正常。</div>';
    } else {
      h += jsErrs.slice().reverse().map(function (e) {
        return '<div class="st-item"><span class="st-t">' + hhmmss(e.t) + '</span>' + esc(e.m) + '</div>';
      }).join('');
    }
    if (resErrs.length) {
      var seen = {}, uniq = [];
      for (var i = resErrs.length - 1; i >= 0 && uniq.length < 8; i--) {
        var host = resErrs[i].m.split('?')[0];
        if (seen[host]) continue;
        seen[host] = 1; uniq.push(resErrs[i].m);
      }
      h += '<div class="st-sub">资源加载失败 ' + resErrs.length + ' 次（接口被墙/网络受限时正常）</div>';
      h += uniq.map(function (u) { return '<div class="st-res">' + esc(u) + '</div>'; }).join('');
    }
    bd.innerHTML = h;
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function togglePanel() {
    if (!panelBuilt) buildPanel();
    var open = panel.classList.toggle('on');
    if (open) renderPanel();
  }
  function closePanel() { if (panel) panel.classList.remove('on'); }

  function report() {
    var lines = ['# 包包财经工作台 · 诊断', '时间: ' + new Date().toLocaleString(),
      '页面: ' + location.href, 'UA: ' + navigator.userAgent, ''];
    lines.push('## JS 异常 (' + jsErrs.length + ')');
    if (!jsErrs.length) lines.push('无');
    jsErrs.forEach(function (e) { lines.push('- [' + hhmmss(e.t) + '] ' + e.m); });
    lines.push('', '## 资源失败 (' + resErrs.length + ')');
    resErrs.forEach(function (e) { lines.push('- [' + hhmmss(e.t) + '] ' + e.m); });
    return lines.join('\n');
  }

  window.__diag = {
    list: function () { return { js: jsErrs.slice(), res: resErrs.slice() }; },
    report: report,
    open: function () { if (!panelBuilt) buildPanel(); renderPanel(); panel.classList.add('on'); },
    clear: function () { jsErrs.length = 0; resErrs.length = 0; paintBadge(); }
  };

  /* ── ③ 演示模式 ──────────────────────────────────────────────────────── */
  /* 数据说明：这是 2026-10-23（周五）收盘快照，实测取自腾讯财经接口，
     不是编造的数字；页面上会明确标注"非实时"。 */
  var DEMO = {
    /* A 股 / 港股：腾讯 qt.gtimg.cn，字段 [3]现价 [31]涨跌 [32]涨跌幅 [33]高 [34]低 [5]开 */
    '上证指数':   { price: '3,690.48', chg: 32.45, pct: 0.89, open: '3,623.57', high: '3,691.40', low: '3,574.27' },
    '科创50':     { price: '1,345.51', chg: 39.64, pct: 3.04, open: '1,287.87', high: '1,353.32', low: '1,257.29' },
    '创业板指数': { price: '2,684.10', chg: 107.20, pct: 4.16, open: '2,534.16', high: '2,695.08', low: '2,494.22' },
    '恒生指数':   { price: '23,093.37', chg: 158.69, pct: 0.69, open: '23,027.98', high: '23,231.63', low: '22,803.77' },
    /* 日韩：新浪 znb_NKY / znb_KOSPI（页面自己用的也是这条源），只取到价与涨跌 */
    '日经225':    { price: '62,692.94', chg: -214.90, pct: -0.34 },
    '韩国KOSPI':  { price: '5,550.30', chg: 16.53, pct: 0.30 },
    /* 美股：腾讯 usDJI / usIXIC / usINX；OHLC 只有道琼斯拿得到 */
    '道琼斯':     { price: '52,215.16', chg: -652.82, pct: -1.23, open: '52,696.70', high: '52,696.70', low: '52,055.10' },
    '纳斯达克':   { price: '25,955.34', chg: -53.52, pct: -0.21 },
    '标普500':    { price: '7,623.68', chg: -39.75, pct: -0.52 }
  };

  var demoOn = false, demoRaf = 0, sweepTimer = 0;

  function fmtChg(v) { return (v > 0 ? '↑ ' : '↓ ') + Math.abs(v).toFixed(2); }
  function fmtPct(v) { return (v > 0 ? '↑' : '↓') + Math.abs(v).toFixed(2) + '%'; }

  function fillCards() {
    if (!demoOn) return 0;
    var cards = document.querySelectorAll('.index-card');
    var filled = 0;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var nameEl = card.querySelector('.ic-name');
      if (!nameEl) continue;
      var d = DEMO[String(nameEl.textContent || '').trim()];
      if (!d) continue;
      var chgEl = card.querySelector('.ic-change');
      if (!chgEl) continue;
      /* 只在"没有行情"的状态下填充 —— 真实数据永远优先 */
      if (chgEl.textContent.indexOf('恢复中') < 0) continue;

      var priceEl = card.querySelector('.ic-price');
      if (priceEl) priceEl.textContent = d.price;
      var cls = d.pct > 0 ? 'up' : (d.pct < 0 ? 'down' : 'flat');
      chgEl.textContent = fmtChg(d.chg);
      chgEl.className = 'ic-change ' + cls;
      var badge = card.querySelector('.ic-badge');
      if (badge) { badge.textContent = fmtPct(d.pct); badge.className = 'ic-badge ' + cls; }
      var cols = card.querySelectorAll('.ic-ohl .col b');
      if (cols.length >= 3 && d.open && d.high && d.low) {
        cols[0].textContent = d.open;
        cols[1].textContent = d.high;
        cols[2].textContent = d.low;
      }
      card.setAttribute('data-demo', '1');
      var top = card.querySelector('.ic-top');
      if (top && !top.querySelector('.st-demo-tag')) {
        var tag = document.createElement('span');
        tag.className = 'st-demo-tag';
        tag.textContent = '演示';
        top.appendChild(tag);
      }
      filled++;
    }
    return filled;
  }

  function ensureBar() {
    if (document.getElementById('st-demo-bar')) return;
    var host = document.getElementById('index-areas');
    if (!host || !host.parentNode) return;
    var bar = document.createElement('div');
    bar.id = 'st-demo-bar';
    bar.className = 'st-demo-bar';
    bar.innerHTML = '<span class="st-demo-dot"></span>' +
      '<span><b>演示数据</b> · 当前网络连不上行情接口，以下为 <b>10-23 收盘快照</b>，非实时行情</span>' +
      '<button class="st-demo-x" type="button">退出演示</button>';
    bar.querySelector('.st-demo-x').addEventListener('click', function () { stopDemo(true); });
    host.parentNode.insertBefore(bar, host);
  }

  function removeBar() {
    var b = document.getElementById('st-demo-bar');
    if (b) b.remove();
  }

  function startDemo() {
    if (demoOn) return;
    demoOn = true;
    ensureBar();
    fillCards();
    /* 卡片会被主文件重渲 → 浅合并的观察器负责补填 */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        if (demoRaf) return;
        demoRaf = requestAnimationFrame(function () {
          demoRaf = 0;
          if (!demoOn) return;
          ensureBar();
          fillCards();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    /* 每 5 秒自检：只有"我们填进去的值被真实行情覆盖了"才算真实数据回来了。
       ⚠️ 不能拿"没有恢复中 + 有涨跌幅"当判据 —— 那正是我们刚填进去的样子，
          第一版就是这样，演示条自己消失、卡片却留着没有标注的假数值。 */
    sweepTimer = setInterval(function () {
      if (!demoOn) return;
      var cards = document.querySelectorAll('.index-card[data-demo]');
      if (!cards.length) return;
      var replaced = 0, stillDemo = 0;
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var nameEl = card.querySelector('.ic-name');
        var d = DEMO[String(nameEl ? nameEl.textContent : '').trim()];
        if (!d) continue;
        var pe = card.querySelector('.ic-price');
        if (!pe) continue;
        if (String(pe.textContent).trim() === d.price) stillDemo++;
        else replaced++;
      }
      if (replaced > 0 && stillDemo === 0) stopDemo(false);
    }, 5000);
  }

  /* 把演示数值还原成"没有行情"的原样，绝不留没有标注的假数字 */
  function revertFill() {
    var cards = document.querySelectorAll('.index-card[data-demo]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var pe = card.querySelector('.ic-price');
      if (pe) pe.textContent = '--';
      var ce = card.querySelector('.ic-change');
      if (ce) { ce.textContent = '行情通道恢复中…'; ce.className = 'ic-change'; }
      var be = card.querySelector('.ic-badge');
      if (be) { be.textContent = '--'; be.className = 'ic-badge'; }
      var cols = card.querySelectorAll('.ic-ohl .col b');
      for (var k = 0; k < cols.length; k++) cols[k].textContent = '--';
      var tags = card.querySelectorAll('.st-demo-tag');
      for (var j = 0; j < tags.length; j++) tags[j].remove();
      card.removeAttribute('data-demo');
    }
  }

  /* 只摘标记，不动数值 —— 用于"真实行情已经回来了"的自动退出：
     这时卡片里的数字已经是真实数据，再 revert 会把它们抹回 '--'。 */
  function clearMarks() {
    var cards = document.querySelectorAll('.index-card[data-demo]');
    for (var i = 0; i < cards.length; i++) {
      var tags = cards[i].querySelectorAll('.st-demo-tag');
      for (var j = 0; j < tags.length; j++) tags[j].remove();
      cards[i].removeAttribute('data-demo');
    }
  }

  function stopDemo(byUser) {
    if (!demoOn) return;
    demoOn = false;
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = 0; }
    removeBar();
    /* 用户主动退出 → 还原成"没有行情"的原样（绝不留没标注的假数字）
       网络恢复自动退出 → 只摘标记，真实数值必须留着 */
    if (byUser) revertFill(); else clearMarks();
    if (byUser) {
      try { sessionStorage.setItem('st-demo-off', '1'); } catch (e) {}
    }
  }

  function maybeDemo() {
    if (demoOn) return;
    var off = false;
    try { off = sessionStorage.getItem('st-demo-off') === '1'; } catch (e) {}
    if (off && !DEMO_QS) return;

    if (DEMO_QS) { startDemo(); return; }

    /* 等 9 秒：如果还有卡片停在"恢复中"，就认为网络受限 */
    setTimeout(function () {
      var cards = document.querySelectorAll('.index-card .ic-change');
      if (!cards.length) return;
      var waiting = 0;
      for (var i = 0; i < cards.length; i++) {
        if ((cards[i].textContent || '').indexOf('恢复中') >= 0) waiting++;
      }
      if (waiting >= Math.max(1, Math.ceil(cards.length * 0.5))) startDemo();
    }, 9000);
  }

  /* ── 统一调度：图标标记 + 演示检测 ───────────────────────────────────── */
  if (window.MutationObserver) {
    var mo2 = new MutationObserver(function () {
      if (window.__stMarkT) return;
      window.__stMarkT = setTimeout(function () { window.__stMarkT = 0; markHas(); }, 320);
    });
    mo2.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    markHas();
    maybeDemo();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.__stability = {
    version: VERSION,
    demo: function (on) {
      if (on === undefined) return demoOn;
      if (on) { try { sessionStorage.removeItem('st-demo-off'); } catch (e) {} startDemo(); }
      else stopDemo(false);
      return demoOn;
    },
    hasFallback: function () { return document.querySelectorAll('.has-iso').length; }
  };
})();
