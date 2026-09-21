/* ==========================================================================
   分时图 —— 点击股票行查看当日分时走势
   数据：东方财富 push2his / trends2（主） → 腾讯 web.ifzq（兜底）
   视觉：完全复用工作台 CSS 变量与缓动，与整站保持一致
   ========================================================================== */
(function () {
  'use strict';

  var byId = function (id) { return document.getElementById(id); };
  var reduceMotion = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };

  /* ---------------- 状态 ---------------- */
  var S = {
    secid: null, code: '', name: '', nameHint: '',
    pre: 0, pts: [], open: 0, high: 0, low: 0, vol: 0, amt: 0, avg: 0, lastTime: '',
    book: null,
    progress: 0, cursor: -1,
    raf: 0, timer: 0, token: 0, open: false, mx: -1, my: -1
  };

  // 可点击查看分时的行：
  //   .watch-row 自选 / .pos-row 持仓 / .lhb-row 龙虎榜 / .sec-row 成分股与核心个股
  //   .lad-stock 连板梯队里的单只（注意不要用 .ladder-row，那行有多只股票）
  //   .fund-row  人气榜 / 资金流向个股（板块类型的 fund-row 会在解析时被排除）
  var ROW_SEL = '.watch-row, .pos-row, .lhb-row, .sec-row, .lad-stock, .fund-row';
  var SKIP_SEL = 'button, a, input, select, textarea, .w-del, .w-pin, [data-act]';
  var PAD = { l: 52, r: 56, t: 12, b: 17 };
  var GAP = 13;
  var SLOTS = 240;          // A 股全天 240 分钟

  /* ---------------- 工具 ---------------- */
  // 6 位代码 → 东财 secid（1=沪市，0=深市/北交所）
  function guessSecid(code) {
    code = String(code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) return null;
    var c = code.charAt(0);
    if (c === '6' || c === '5' || c === '9') return '1.' + code;
    return '0.' + code;
  }
  // 东财 secid → 腾讯代码
  function toTxCode(secid) {
    var p = String(secid).split('.');
    return (p[0] === '1' ? 'sh' : 'sz') + p[1];
  }
  // "2026-09-21 10:31" → 当日分钟槽位 0..240
  function slotOfHour(hh, mm) {
    var m = hh * 60 + mm;
    if (m <= 11 * 60 + 30) return Math.max(0, Math.min(SLOTS, m - (9 * 60 + 30)));
    return Math.max(0, Math.min(SLOTS, 120 + (m - 13 * 60)));
  }
  function withAlpha(c, a) {
    c = String(c || '').trim();
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      if (!isFinite(n)) return c;
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(',');
      return 'rgba(' + p[0].trim() + ',' + p[1].trim() + ',' + p[2].trim() + ',' + a + ')';
    }
    return c;
  }
  var fmt = function (v, d) {
    if (typeof window.fmtNum === 'function') return window.fmtNum(v, d === undefined ? 2 : d);
    return (v === null || v === undefined || !isFinite(v)) ? '--' : Number(v).toFixed(d === undefined ? 2 : d);
  };
  var clsOfVal = function (v) {
    return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  };

  /* ---------------- 主题色（每次主题变化重读，保证与整站一致） ---------------- */
  var TH = null, TH_KEY = '';
  function theme() {
    var key = document.documentElement.getAttribute('data-theme') || 'dark';
    if (TH && TH_KEY === key) return TH;
    var cs = getComputedStyle(document.documentElement);
    var g = function (n, fb) { var v = cs.getPropertyValue(n); return (v && v.trim()) || fb; };
    var light = key === 'light';
    TH = {
      up: g('--up', '#ff7a5c'),
      down: g('--down', '#3ddc84'),
      gold: g('--gold', '#e0a15b'),
      sub: g('--text-sub', '#9aa1a9'),
      main: g('--text-main', '#eef0f2'),
      accent: g('--accent', '#ff8a6b'),
      pane: light ? 'rgba(255,255,255,.55)' : 'rgba(24,25,30,.55)',
      tipBg: light ? 'rgba(255,255,255,.90)' : 'rgba(20,21,27,.90)',
      grid: light ? 'rgba(26,40,66,.10)' : 'rgba(255,255,255,.075)',
      mono: g('--font-mono', 'monospace').replace(/\s+/g, ' ')
    };
    TH_KEY = key;
    return TH;
  }

  /* ---------------- 数据获取 ---------------- */
  // 通用 JSON 请求（带超时；部分接口的 JSON 带 BOM，需要剥离）
  function getJson(url, timeout) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('timeout')); }
      }, timeout || 8000);
      fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.text();
      }).then(function (t) {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve(JSON.parse(t.replace(/^\uFEFF/, '').trim()));
      }).catch(function (e) {
        if (done) return;
        done = true; clearTimeout(timer);
        reject(e);
      });
    });
  }

  // 东财分时接口有多个域名，实测 push2his 经常连不上（RemoteDisconnected），
  // push2delay 更稳 —— 依次尝试，避免白白退到腾讯兜底源。
  var EAST_HOSTS = ['push2his.eastmoney.com', 'push2delay.eastmoney.com'];

  function fetchEast(secid) {
    var qs = '/api/qt/stock/trends2/get?secid=' + encodeURIComponent(secid) +
      '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13' +
      '&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1&_=' + Date.now();
    var i = 0;
    function attempt() {
      if (i >= EAST_HOSTS.length) return Promise.reject(new Error('east: all hosts failed'));
      var host = EAST_HOSTS[i++];
      return getJson('https://' + host + qs, 7000).then(function (j) {
        var d = j && j.data;
        if (!d || !d.trends || !d.trends.length) throw new Error('empty');
        return parseEast(d);
      }).catch(function () { return attempt(); });
    }
    return attempt();
  }

  function parseEast(d) {
    var pts = [];
    d.trends.forEach(function (s) {
      var f = String(s).split(',');
      if (f.length < 8) return;
      var hh = +f[0].slice(11, 13), mm = +f[0].slice(14, 16);
      var price = parseFloat(f[2]);
      if (!isFinite(price) || price <= 0) return;
      pts.push({
        slot: slotOfHour(hh, mm),
        t: f[0].slice(11, 16),
        price: price,
        avg: parseFloat(f[7]) || 0,
        vol: parseFloat(f[5]) || 0,
        amt: parseFloat(f[6]) || 0
      });
    });
    // 东财的 vol/amt 是「分钟增量」，累加即全天总量
    // （已与 push2 的 f47/f48 交叉核对：累加 1,991,764 手 = f47 ✓）
    var tv = 0, ta = 0;
    pts.forEach(function (p) { tv += p.vol; ta += p.amt; });
    return {
      name: d.name || '', pre: parseFloat(d.preClose) || 0, pts: pts,
      totalVol: tv, totalAmt: ta,
      date: (d.trends[0] || '').slice(0, 10)
    };
  }

  function txUrl(secid) {
    return 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + toTxCode(secid) + '&_=' + Date.now();
  }

  function fetchTencent(secid) {
    var code = toTxCode(secid);
    return getJson(txUrl(secid), 8000).then(function (j) {
      var node = j && j.data && j.data[code];
      if (!node || !node.data || !node.data.data || !node.data.data.length) throw new Error('empty');
      return parseTx(node, code);
    });
  }

  // 五档盘口：东财 trends2 不含盘口，单独向腾讯取一次（与分时并行）；
  // 失败返回 null，界面自动隐藏盘口区，不影响分时图。
  function fetchBook(secid) {
    var code = toTxCode(secid);
    return getJson(txUrl(secid), 7000).then(function (j) {
      var node = j && j.data && j.data[code];
      var qt = node && node.qt && node.qt[code];
      return parseBook(qt);
    }).catch(function () { return null; });
  }

  // ⚠ 腾讯 minute 的「量/额」是【当日累计值】，与东财的【分钟增量】口径不同！
  //   分钟增量 = 本分钟累计 − 上一分钟累计（画量柱用）
  //   全天总量 = 最后一个点的累计值（绝不能累加，否则会放大约 100~170 倍）
  function parseTx(node, code) {
    var qt = (node.qt && node.qt[code]) || [];
    var pre = parseFloat(qt[4]) || 0;
    var name = qt[1] || '';
    var rows = node.data.data;
    if (!pre && rows.length) pre = parseFloat(String(rows[0]).trim().split(/\s+/)[1]) || 0;
    var pts = [], prevV = 0, prevA = 0, cumV = 0, cumA = 0;
    rows.forEach(function (s) {
      var f = String(s).trim().split(/\s+/);
      if (f.length < 3) return;
      var hh = +f[0].slice(0, 2), mm = +f[0].slice(2, 4);
      var price = parseFloat(f[1]);
      if (!isFinite(price) || price <= 0) return;
      cumV = parseFloat(f[2]) || 0;
      cumA = parseFloat(f[3]) || 0;
      var dv = cumV - prevV, da = cumA - prevA;
      if (!(dv >= 0)) dv = 0;
      if (!(da >= 0)) da = 0;
      prevV = cumV; prevA = cumA;
      pts.push({
        slot: slotOfHour(hh, mm),
        t: f[0].slice(0, 2) + ':' + f[0].slice(2, 4),
        price: price,
        avg: cumV > 0 ? cumA / (cumV * 100) : price,
        vol: dv, amt: da
      });
    });
    return {
      name: name, pre: pre, pts: pts,
      totalVol: cumV, totalAmt: cumA,
      book: parseBook(qt), date: ''
    };
  }

  // 腾讯五档：买1~买5 在 [9]~[18]，卖1~卖5 在 [19]~[28]（价格/数量成对）
  function parseBook(qt) {
    if (!qt || qt.length < 29) return null;
    var bids = [], asks = [], i, p, v;
    for (i = 0; i < 5; i++) {
      p = parseFloat(qt[9 + i * 2]);
      v = parseFloat(qt[10 + i * 2]);
      if (isFinite(p) && p > 0) bids.push({ p: p, v: (isFinite(v) && v > 0) ? v : 0 });
    }
    for (i = 0; i < 5; i++) {
      p = parseFloat(qt[19 + i * 2]);
      v = parseFloat(qt[20 + i * 2]);
      if (isFinite(p) && p > 0) asks.push({ p: p, v: (isFinite(v) && v > 0) ? v : 0 });
    }
    if (!bids.length && !asks.length) return null;
    return { bids: bids, asks: asks };
  }

  function loadMinute(secid) {
    return fetchEast(secid).catch(function () { return fetchTencent(secid); });
  }

  /* ---------------- 绘制 ---------------- */
  function draw() {
    var cv = byId('mm-canvas');
    if (!cv || !S.pts.length) return;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var th = theme(), pts = S.pts, pre = S.pre || pts[0].price;
    var totalH = H - PAD.t - PAD.b;
    var volH = Math.max(34, Math.round(totalH * 0.22));
    var plotH = totalH - volH - GAP;
    var plotW = W - PAD.l - PAD.r;
    if (plotW < 60 || plotH < 50) return;

    /* ---- 纵轴：以昨收为中轴对称（券商软件画法） ---- */
    var dev = 0;
    pts.forEach(function (p) {
      dev = Math.max(dev, Math.abs(p.price - pre));
      if (isNum(p.avg) && p.avg > 0) dev = Math.max(dev, Math.abs(p.avg - pre));
    });
    if (!(dev > 0)) dev = Math.max(pre * 0.002, 0.01);
    var yTop = pre + dev * 1.12, yBot = pre - dev * 1.12;
    var yOf = function (v) { return PAD.t + (yTop - v) / (yTop - yBot) * plotH; };
    var slotX = function (s) { return PAD.l + s / SLOTS * plotW; };

    var volMax = 1;
    pts.forEach(function (p) { if (p.vol > volMax) volMax = p.vol; });
    var volBase = PAD.t + plotH + GAP;
    var volBottom = volBase + volH;
    var vOf = function (v) { return volBottom - (v / volMax) * volH; };

    var last = pts[pts.length - 1];
    var rising = last.price >= pre;
    var lineColor = rising ? th.up : th.down;
    var prog = S.progress > 0 ? S.progress : 1;

    /* ---- 网格 ---- */
    ctx.lineWidth = 1;
    ctx.strokeStyle = th.grid;
    ctx.beginPath();
    for (var k = 0; k <= 4; k++) {
      var gy = Math.round(PAD.t + plotH * k / 4) + 0.5;
      ctx.moveTo(PAD.l, gy); ctx.lineTo(PAD.l + plotW, gy);
    }
    [60, 120, 180].forEach(function (s) {
      var gx = Math.round(slotX(s)) + 0.5;
      ctx.moveTo(gx, PAD.t); ctx.lineTo(gx, volBottom);
    });
    ctx.stroke();

    /* ---- 左轴价格 / 右轴涨跌幅 ---- */
    ctx.font = '10px ' + th.mono;
    ctx.textBaseline = 'middle';
    for (var k2 = 0; k2 <= 4; k2++) {
      var v = yTop - (yTop - yBot) * k2 / 4;
      var pct = pre > 0 ? (v / pre - 1) * 100 : 0;
      var yy = PAD.t + plotH * k2 / 4;
      ctx.textAlign = 'right';
      ctx.fillStyle = th.sub;
      ctx.fillText(v.toFixed(2), PAD.l - 7, yy);
      ctx.textAlign = 'left';
      ctx.fillStyle = Math.abs(pct) < 0.006 ? th.sub : (pct > 0 ? th.up : th.down);
      ctx.fillText((pct > 0 ? '+' : '') + pct.toFixed(2) + '%', PAD.l + plotW + 6, yy);
    }

    /* ---- 时间轴 ---- */
    ctx.textBaseline = 'top';
    var times = ['09:30', '10:30', '11:30', '14:00', '15:00'];
    times.forEach(function (t, i) {
      var x = PAD.l + plotW * i / 4;
      ctx.textAlign = i === 0 ? 'left' : (i === 4 ? 'right' : 'center');
      ctx.fillStyle = th.sub;
      ctx.fillText(t, x, volBottom + 5);
    });

    /* ---- 昨收基准线 ---- */
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = th.sub;
    ctx.beginPath();
    var yPre = Math.round(yOf(pre)) + 0.5;
    ctx.moveTo(PAD.l, yPre); ctx.lineTo(PAD.l + plotW, yPre);
    ctx.stroke();
    ctx.restore();

    /* ---- 分时线 + 面积（带从左扫出的绘制动画） ---- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PAD.l + plotW * prog, H);
    ctx.clip();

    var grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + plotH);
    grad.addColorStop(0, withAlpha(lineColor, 0.24));
    grad.addColorStop(1, withAlpha(lineColor, 0));
    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = slotX(p.slot), y = yOf(p.price);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(slotX(last.slot), PAD.t + plotH);
    ctx.lineTo(slotX(pts[0].slot), PAD.t + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach(function (p, i) {
      var x = slotX(p.slot), y = yOf(p.price);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = withAlpha(lineColor, 0.45);
    ctx.shadowBlur = 9;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    /* ---- 均价线 ---- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PAD.l + plotW * prog, H);
    ctx.clip();
    ctx.beginPath();
    var started = false;
    pts.forEach(function (p) {
      if (!isNum(p.avg) || p.avg <= 0) return;
      var x = slotX(p.slot), y = yOf(p.avg);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    if (started) {
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = th.gold;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    /* ---- 成交量柱（错峰长高） ---- */
    var barW = Math.max(1, plotW / SLOTS * 0.66);
    var shown = pts.length * prog;
    for (var i = 0; i < pts.length; i++) {
      var frac = Math.min(1, shown - i);
      if (frac <= 0) break;
      var p = pts[i];
      var prevP = i > 0 ? pts[i - 1].price : pre;
      var barUp = p.price >= prevP;
      var h = (volBottom - vOf(p.vol)) * frac;
      if (h < 0.7) continue;
      ctx.fillStyle = withAlpha(barUp ? th.up : th.down, barUp ? 0.72 : 0.60);
      ctx.fillRect(slotX(p.slot) - barW / 2, volBottom - h, barW, h);
    }

    /* ---- 最新价光点 ---- */
    if (prog >= 1) {
      var lx = slotX(last.slot), ly = yOf(last.price);
      var pulse = reduceMotion() ? 1 : (0.55 + 0.45 * Math.sin(Date.now() / 520));
      ctx.beginPath();
      ctx.arc(lx, ly, 6 + pulse * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(lineColor, 0.18 * pulse);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly, 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly, 3, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#ffffff', 0.85);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* ---- 十字光标 + 浮动数据条 ---- */
    if (S.cursor >= 0 && S.cursor < pts.length) {
      var cp = pts[S.cursor];
      var cx = slotX(cp.slot), cy = yOf(cp.price);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = withAlpha(th.main, light_alpha());
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, PAD.t);
      ctx.lineTo(Math.round(cx) + 0.5, volBottom);
      ctx.moveTo(PAD.l, Math.round(cy) + 0.5);
      ctx.lineTo(PAD.l + plotW, Math.round(cy) + 0.5);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(lineColor, 0.30);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // 浮动信息条（分段排版：时间灰 / 价格白 / 涨跌彩色 / 均价金 / 量白）
      var dpct = pre > 0 ? (cp.price / pre - 1) * 100 : 0;
      var cgain = dpct > 0.006 ? th.up : (dpct < -0.006 ? th.down : th.sub);
      var segs = [
        { t: cp.t, c: th.sub },
        { t: cp.price.toFixed(2), c: cgain, b: true },
        { t: (dpct > 0 ? '+' : '') + dpct.toFixed(2) + '%', c: cgain, b: true }
      ];
      if (isNum(cp.avg) && cp.avg > 0) {
        segs.push({ t: '均价', c: th.sub });
        segs.push({ t: cp.avg.toFixed(2), c: th.gold, b: true });
      }
      segs.push({ t: '量', c: th.sub });
      segs.push({ t: fmtVol(cp.vol), c: th.main, b: true });
      drawTip(ctx, PAD.l + 8, PAD.t + 6, segs, th);
    }
  }

  function light_alpha() {
    return (document.documentElement.getAttribute('data-theme') === 'light') ? 0.42 : 0.5;
  }

  /* 浮动数据条：分段渲染，数字用工作台等宽字体，底色加实带投影，保证可读性 */
  function drawTip(ctx, x, y, segs, th) {
    var fs = 12, padX = 11, gap = 9, h = 27, r = 9;
    var ws = segs.map(function (s) {
      ctx.font = (s.b ? '700 ' : '400 ') + fs + 'px ' + th.mono;
      return ctx.measureText(s.t).width;
    });
    var w = padX * 2 + ws.reduce(function (a, b) { return a + b; }, 0) + gap * (segs.length - 1);
    var cw = ctx.canvas.width / (window.devicePixelRatio || 1);
    if (x + w > cw - 6) x = Math.max(6, cw - w - 6);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .32)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = th.tipBg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = withAlpha(th.main, 0.15);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var cx0 = x + padX;
    segs.forEach(function (s, i) {
      ctx.font = (s.b ? '700 ' : '400 ') + fs + 'px ' + th.mono;
      ctx.fillStyle = s.c;
      ctx.fillText(s.t, cx0, y + h / 2 + 0.5);
      cx0 += ws[i] + gap;
    });
    ctx.restore();
  }

  function fmtVol(v) {
    if (!isNum(v)) return '--';
    if (v >= 1e4) return (v / 1e4).toFixed(2) + '万手';
    return v.toFixed(0) + '手';
  }

  /* ---------------- 绘制动画（从左扫出） ---------------- */
  function animateIn() {
    cancelAnimationFrame(S.raf);
    if (reduceMotion()) { S.progress = 1; draw(); return; }
    var t0 = performance.now(), DUR = 880;
    S.progress = 0;
    var step = function (now) {
      var t = Math.min(1, (now - t0) / DUR);
      S.progress = 1 - Math.pow(1 - t, 3);
      draw();
      if (t < 1) S.raf = requestAnimationFrame(step);
      else { S.progress = 1; draw(); tickPulse(); }
    };
    S.raf = requestAnimationFrame(step);
  }

  // 结束后维持最新点脉冲
  function tickPulse() {
    if (reduceMotion() || !S.open) return;
    S.raf = requestAnimationFrame(function () {
      draw();
      if (S.open) S.timer2 = setTimeout(tickPulse, 90);
    });
  }

  /* ---------------- 统计与头部数字 ---------------- */
  function applyStats(meta) {
    var pts = S.pts;
    if (!pts.length) return;
    S.pre = meta.pre || S.pre || pts[0].price;
    // 名称优先级：接口返回 > 点击行的名字 > 已有的 > 代码
    S.name = meta.name || S.nameHint || S.name || '';
    S.open = pts[0].price;
    S.high = -Infinity; S.low = Infinity;
    S.vol = 0; S.amt = 0;
    pts.forEach(function (p) {
      if (p.price > S.high) S.high = p.price;
      if (p.price < S.low) S.low = p.price;
      S.vol += p.vol; S.amt += p.amt;
    });
    // 全天总量以数据源自报口径为准：
    // 东财是「分钟增量累加」，腾讯是「最后一个点的当日累计」（绝不能累加）
    if (isNum(meta.totalVol) && meta.totalVol > 0) S.vol = meta.totalVol;
    if (isNum(meta.totalAmt) && meta.totalAmt > 0) S.amt = meta.totalAmt;
    var last = pts[pts.length - 1];
    S.avg = (isNum(last.avg) && last.avg > 0) ? last.avg : (S.vol > 0 ? S.amt / (S.vol * 100) : last.price);
    S.lastTime = last.t;

    var pct = S.pre > 0 ? (last.price / S.pre - 1) * 100 : 0;
    var chg = last.price - S.pre;
    var cls = clsOfVal(pct);

    byId('mm-name').textContent = S.name || S.code;
    byId('mm-code').textContent = S.code;
    byId('mm-dot').className = 'mm-dot ' + cls;

    var priceEl = byId('mm-price');
    priceEl.className = 'mm-price ' + cls;
    var pctEl = byId('mm-pct');
    pctEl.className = 'mm-pct ' + cls;

    // 头部数字沿用工作台的错峰弹入动画
    var setD = window.setDigitAnim;
    var pTxt = fmt(last.price);
    var cTxt = (pct > 0 ? '+' : '') + fmt(pct) + '%';
    if (typeof setD === 'function' && !S.drawn) {
      try { setD(priceEl, pTxt); } catch (e) { priceEl.textContent = pTxt; }
      try { setD(pctEl, cTxt); } catch (e) { pctEl.textContent = cTxt; }
    } else {
      priceEl.textContent = pTxt;
      pctEl.textContent = cTxt;
    }
    S.drawn = true;

    var setStat = function (id, txt, cls2) {
      var el = byId(id);
      if (!el) return;
      el.textContent = txt;
      if (cls2 !== undefined) el.className = cls2 || '';
    };
    setStat('mm-open', fmt(S.open), clsOfVal(S.open - S.pre));
    setStat('mm-high', fmt(S.high), 'up');
    setStat('mm-low', fmt(S.low), 'down');
    setStat('mm-pre', fmt(S.pre), '');
    setStat('mm-vol', fmtVol(S.vol), '');
    setStat('mm-amt', (typeof window.fmtFund === 'function' ? window.fmtFund(S.amt) : (S.amt / 1e8).toFixed(2) + '亿'), '');
    setStat('mm-avg', fmt(S.avg), clsOfVal(S.avg - S.pre));
    setStat('mm-time', S.lastTime || '--', '');
    void chg;
  }

  /* ---------------- 五档盘口（买5 ~ 卖5） ---------------- */
  // 金额 = 价 × 手数 × 100（1 手 = 100 股）
  function fmtBookAmt(p, v) {
    var amt = p * v * 100;
    if (!isFinite(amt) || amt <= 0) return '--';
    if (amt >= 1e8) return (amt / 1e8).toFixed(2) + '亿';
    if (amt >= 1e4) return (amt / 1e4).toFixed(0) + '万';
    return amt.toFixed(0);
  }

  function renderBook(book) {
    var wrap = byId('mm-book');
    if (!wrap) return;
    if (!book || (!book.bids.length && !book.asks.length)) {
      wrap.innerHTML = '<div class="mb-empty">盘口暂不可用</div>';
      return;
    }
    var pre = S.pre || 0;
    var sideCls = function (p) { return p > pre ? 'up' : (p < pre ? 'down' : 'flat'); };
    var rowHtml = function (label, p, v, side) {
      return '<div class="mb-row ' + side + '">' +
        '<span class="mb-lb">' + label + '</span>' +
        '<span class="mb-p ' + sideCls(p) + '">' + p.toFixed(2) + '</span>' +
        '<span class="mb-a">' + fmtBookAmt(p, v) + '</span>' +
        '</div>';
    };

    var html = '<div class="mb-head"><span>档位</span><span>价格</span><span>金额</span></div>';
    // 卖 5 → 卖 1（自上而下）
    for (var i = 4; i >= 0; i--) {
      if (i < book.asks.length) html += rowHtml('卖' + (i + 1), book.asks[i].p, book.asks[i].v, 'ask');
    }
    // 中间：最新价
    var lp = S.pts.length ? S.pts[S.pts.length - 1].price : pre;
    html += '<div class="mb-mid"><span class="mb-p ' + sideCls(lp) + '">' + lp.toFixed(2) + '</span>' +
      '<span class="mb-mid-t">最新</span></div>';
    // 买 1 → 买 5（自上而下）
    for (var j = 0; j < 5; j++) {
      if (j < book.bids.length) html += rowHtml('买' + (j + 1), book.bids[j].p, book.bids[j].v, 'bid');
    }
    wrap.innerHTML = html;
  }

  /* ---------------- 打开 / 关闭 ---------------- */
  function openMinute(secid, codeHint, nameHint) {
    var mask = byId('minute-mask');
    if (!mask || (!secid && !nameHint)) return;

    var code = codeHint || (secid ? String(secid).split('.')[1] : '');
    var token = preparePanel(code, nameHint);

    // 没拿到代码（例如连板梯队里只有股票名）→ 先开面板，再按名字反查
    if (!secid) {
      var pending = nameHint;
      searchSecidByName(pending).then(function (r) {
        if (token !== S.token) return;
        if (!r) {
          byId('mm-loading').className = 'mm-loading';
          var err = byId('mm-err');
          err.className = 'mm-err on';
          err.textContent = '没找到「' + pending + '」对应的股票';
          return;
        }
        S.secid = r.secid;
        S.code = r.code;
        byId('mm-code').textContent = r.code;
        startLoad(r.secid, token);
      });
      return;
    }
    S.secid = secid;
    startLoad(secid, token);
  }

  // 清空面板并显示，返回本轮 token
  function preparePanel(code, nameHint) {
    var mask = byId('minute-mask');
    S.code = code || '';
    S.nameHint = nameHint || '';
    S.pts = []; S.progress = 0; S.cursor = -1; S.drawn = false;
    S.name = ''; S.book = null;
    var token = ++S.token;

    byId('mm-name').textContent = S.nameHint || '加载中…';
    byId('mm-code').textContent = S.code || '------';
    byId('mm-dot').className = 'mm-dot';
    byId('mm-price').className = 'mm-price';
    byId('mm-price').textContent = '--';
    byId('mm-pct').className = 'mm-pct flat';
    byId('mm-pct').textContent = '--';
    ['mm-open', 'mm-high', 'mm-low', 'mm-pre', 'mm-vol', 'mm-amt', 'mm-avg', 'mm-time'].forEach(function (id) {
      var el = byId(id); if (el) { el.textContent = '--'; el.className = ''; }
    });
    renderBook(null);
    byId('mm-err').className = 'mm-err';
    byId('mm-loading').className = 'mm-loading on';

    if (!S.open) {
      mask.className = 'on';
      mask.setAttribute('aria-hidden', 'false');
      S.open = true;
      document.body.style.overflow = 'hidden';
    }
    return token;
  }

  // 拉取分时 + 盘口（盘口失败只隐藏盘口区，不影响分时图）
  function startLoad(secid, token) {
    fetchBook(secid).then(function (book) {
      if (token !== S.token) return;
      if (book) { S.book = book; renderBook(book); }
    });
    loadMinute(secid).then(function (meta) {
      if (token !== S.token) return;
      if (!meta.pts.length) throw new Error('empty');
      S.pts = meta.pts;
      if (meta.book) { S.book = meta.book; renderBook(meta.book); }
      applyStats(meta);
      byId('mm-loading').className = 'mm-loading';
      byId('mm-err').className = 'mm-err';
      // 让布局先完成，再启动扫出动画
      requestAnimationFrame(function () { setTimeout(function () { animateIn(); }, 30); });
      scheduleRefresh();
    }).catch(function () {
      if (token !== S.token) return;
      byId('mm-loading').className = 'mm-loading';
      var err = byId('mm-err');
      err.className = 'mm-err on';
      err.textContent = '分时数据获取失败，请稍后重试';
    });
  }

  function closeMinute() {
    var mask = byId('minute-mask');
    if (!mask || !S.open) return;
    S.open = false;
    S.token++;
    clearInterval(S.timer);
    clearTimeout(S.timer2);
    cancelAnimationFrame(S.raf);
    mask.className = '';
    mask.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    S.pts = []; S.cursor = -1; S.progress = 0;
  }

  /* ---------------- 实时刷新（仅交易时段） ---------------- */
  function isTrading(now) {
    var d = now || new Date();
    var wd = d.getDay();
    if (wd === 0 || wd === 6) return false;
    var m = d.getHours() * 60 + d.getMinutes();
    return (m >= 570 && m <= 692) || (m >= 779 && m <= 902);
  }

  function scheduleRefresh() {
    clearInterval(S.timer);
    if (!isTrading()) return;
    S.timer = setInterval(function () {
      if (document.hidden || !S.open || !S.secid) return;
      var token = S.token;
      // 盘口与分时一起刷新（盘口独立失败不影响分时）
      fetchBook(S.secid).then(function (book) {
        if (token === S.token && book) { S.book = book; renderBook(book); }
      });
      loadMinute(S.secid).then(function (meta) {
        if (token !== S.token || !meta.pts.length) return;
        S.pts = meta.pts;
        if (meta.book) { S.book = meta.book; renderBook(meta.book); }
        S.progress = 1;
        applyStats(meta);
        draw();
      }).catch(function () { /* 静默失败，下轮再试 */ });
    }, 6000);
  }

  /* ---------------- 交互 ---------------- */
  function nearestIndex(clientX) {
    var cv = byId('mm-canvas');
    if (!cv || !S.pts.length) return -1;
    var r = cv.getBoundingClientRect();
    var x = clientX - r.left;
    var plotW = cv.clientWidth - PAD.l - PAD.r;
    if (plotW <= 0) return -1;
    var slot = (x - PAD.l) / plotW * SLOTS;
    var best = -1, bd = Infinity;
    for (var i = 0; i < S.pts.length; i++) {
      var d = Math.abs(S.pts[i].slot - slot);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function bind() {
    var mask = byId('minute-mask');
    if (!mask) return;
    var cv = byId('mm-canvas');

    byId('mm-close').addEventListener('click', closeMinute);
    mask.addEventListener('click', function (e) {
      if (e.target.closest('[data-mm="close"]')) closeMinute();
    });
    document.addEventListener('keydown', function (e) {
      if (S.open && e.key === 'Escape') { e.stopPropagation(); closeMinute(); }
    });

    // 十字光标
    cv.addEventListener('mousemove', function (e) {
      if (!S.pts.length) return;
      var i = nearestIndex(e.clientX);
      if (i !== S.cursor) { S.cursor = i; if (S.progress >= 1) draw(); }
    });
    cv.addEventListener('mouseleave', function () {
      if (S.cursor !== -1) { S.cursor = -1; draw(); }
    });
    // 触摸滑动查看
    cv.addEventListener('touchstart', function (e) {
      if (!S.pts.length || !e.touches[0]) return;
      S.cursor = nearestIndex(e.touches[0].clientX);
      if (S.progress >= 1) draw();
    }, { passive: true });
    cv.addEventListener('touchmove', function (e) {
      if (!S.pts.length || !e.touches[0]) return;
      S.cursor = nearestIndex(e.touches[0].clientX);
      if (S.progress >= 1) draw();
    }, { passive: true });
    cv.addEventListener('touchend', function () {
      if (S.cursor !== -1) { S.cursor = -1; draw(); }
    });

    window.addEventListener('resize', function () {
      if (S.open && S.pts.length) { S.progress = 1; draw(); }
    });

    // 全局点击：任意股票行 / 卡片 → 打开分时
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented) return;
      if (e.target.closest && e.target.closest(SKIP_SEL)) return;
      var row = e.target.closest && e.target.closest(ROW_SEL);
      if (!row) return;
      var t = resolveRow(row);
      if (!t) return;
      openMinute(t.secid, t.code, t.name);
    }, false);
  }

  // 从行元素里取股票名（不同列表的行结构不一样，逐个适配）
  function pickName(row) {
    // 1) 自选 / 持仓行：<span class="w-name">名称 <span class="w-flag">A股</span></span>
    var wn = row.querySelector && row.querySelector('.w-name');
    if (wn) {
      var flag = wn.querySelector('.w-flag');
      var t1 = flag ? wn.textContent.replace(flag.textContent, '') : wn.textContent;
      t1 = (t1 || '').trim();
      if (t1) return t1;
    }
    // 2) 榜单 / 成分股行：<div class="sr-name">名称<small>代码</small></div>
    var t2 = textBeforeChild(row.querySelector && row.querySelector('.sr-name'), 'small');
    if (t2) return t2;

    // 3) 人气榜 / 资金流向：<div class="fund-name"><div class="fn">名称</div>…</div>
    var fn = row.querySelector && row.querySelector('.fn');
    if (fn) {
      var t3 = (fn.textContent || '').trim();
      if (t3) return t3;
    }
    // 4) 连板梯队：<span class="lad-stock">名称<span class="pct">10.0%</span></span>
    //    只取纯文本节点，跳过涨跌幅等子元素
    return textNodesOnly(row);
  }

  // 取容器内、某个子标签之前的文本（适配「名称<small>代码</small>」结构）
  function textBeforeChild(el, childTag) {
    if (!el || !el.childNodes) return '';
    var skip = el.querySelector && el.querySelector(childTag);
    var buf = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n === skip) break;
      if (n.nodeType === 3) buf += n.nodeValue;
    }
    return buf.trim();
  }

  // 只取元素自身的文本节点，跳过所有子元素
  function textNodesOnly(el) {
    if (!el || !el.childNodes) return '';
    var buf = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) buf += n.nodeValue;
    }
    return buf.trim();
  }

  // 名字像不像一只股票（用来过滤「+3只」这类统计文字）
  function looksLikeStockName(s) {
    s = String(s || '').trim();
    if (!s || s.charAt(0) === '+') return false;
    if (s.length < 2 || s.length > 12) return false;
    if (/\d只$/.test(s)) return false;
    return /^[\u4e00-\u9fa5A-Za-z0-9*·\s]+$/.test(s);
  }

  // 从行元素解析出 secid，三级兜底：
  //   1) 行上带 data-secid（最准）
  //   2) 行内有 6 位代码（<small> / .w-code / .fc / 整行文本）
  //   3) 只有名字 → secid 留空，由调用方走「按名字反查」
  function resolveRow(row) {
    // 资金流向页的「板块」行不接个股点击（没有 .fc 即为板块行）
    if (row.classList && row.classList.contains('fund-row') &&
        !(row.querySelector && row.querySelector('.fc'))) return null;

    var name = pickName(row);
    var ds = row.getAttribute && row.getAttribute('data-secid');
    if (ds && /^\d\.\d{6}$/.test(ds)) {
      return { secid: ds, code: ds.split('.')[1], name: name };
    }
    var cands = [];
    var push = function (sel) {
      var el = row.querySelector && row.querySelector(sel);
      if (el && el.textContent) cands.push(el.textContent);
    };
    push('small');
    push('.w-code');
    push('.fc');
    cands.push(row.textContent || '');
    for (var i = 0; i < cands.length; i++) {
      var m = String(cands[i] || '').match(/(?:^|\D)(\d{6})(?:\D|$)/);
      if (m) {
        var sid = guessSecid(m[1]);
        if (sid) return { secid: sid, code: m[1], name: name };
      }
    }
    if (looksLikeStockName(name)) return { secid: null, code: '', name: name };
    return null;
  }

  // 只有股票名时，调东财搜索接口反查 secid
  function searchSecidByName(name) {
    return new Promise(function (resolve) {
      var url = 'https://searchapi.eastmoney.com/api/suggest/get?input=' +
        encodeURIComponent(name) + '&type=14&count=8&token=D43BF722C8E33BDC906FB84D85E326E8';
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 6000);
      function finish(v) { if (done) return; done = true; clearTimeout(timer); resolve(v); }
      function handle(j) {
        var list = (j && j.QuotationCodeTable && j.QuotationCodeTable.Data) || [];
        finish(pickBestMatch(list, name));
      }
      // 宿主页面已有 jsonp() 就直接用（该接口本身是 JSONP 风格）
      var jp = window.jsonp;
      if (typeof jp === 'function') {
        try {
          jp(url, 6000).then(handle).catch(function () { finish(null); });
        } catch (e) { finish(null); }
        return;
      }
      fetch(url, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(handle)
        .catch(function () { finish(null); });
    });
  }

  // 从搜索结果里挑最匹配的一条：名称完全相等优先，其次第一条有效 A 股
  function pickBestMatch(list, name) {
    if (!list || !list.length) return null;
    var target = String(name || '').trim();
    var exact = null, fallback = null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var qid = String(it.QuoteID || '');
      if (!/^\d\.\d{6}$/.test(qid)) continue;
      if (!fallback) fallback = it;
      if (String(it.Name || '').trim() === target) { exact = it; break; }
    }
    var pick = exact || fallback;
    if (!pick) return null;
    return { secid: pick.QuoteID, code: String(pick.Code || pick.QuoteID.split('.')[1]) };
  }

  /* ---------------- 启动 ---------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  // 供外部调用（例如从其他模块以名称打开）
  window.openMinuteChart = function (secid, code, name) {
    if (/^\d{6}$/.test(String(secid))) secid = guessSecid(secid);
    openMinute(secid, code, name);
  };

  // 纯函数导出，供自动化测试使用（无副作用）
  window.__minuteChartInternals = {
    guessSecid: guessSecid, slotOfHour: slotOfHour, withAlpha: withAlpha,
    parseEast: parseEast, parseTx: parseTx, parseBook: parseBook,
    fmtVol: fmtVol, fmtBookAmt: fmtBookAmt,
    looksLikeStockName: looksLikeStockName, pickBestMatch: pickBestMatch,
    pickName: pickName, resolveRow: resolveRow, searchSecidByName: searchSecidByName,
    state: S
  };
})();
