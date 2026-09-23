/* ==========================================================================
   quote-fallback / fallback.js —— 行情备用通道（东财 push2 被限流时启用）

   背景
   ----
   东财行情集群按「服务」限流：push2（实时行情 ulist / 列表 clist）会整片被封，
   而 push2his（历史分时）通常仍可用。被封时特征为 HTTP 000 + 0.1s 快速失败。

   本模块只负责「把数据拿回来」，字段一律映射成东财同形，渲染层零改动：

   1. 期货行情      → 新浪 hq.sinajs.cn/list=nf_XXXX
                      12 个品种一次拉完，字段映射到东财 f2/f3/f4/f15/f16/f17
   2. 核心个股行情  → 新浪 hq.sinajs.cn/list=sh600487,sz300308,…
                      同样 script 注入，一次拿全
   3. 概念/行业板块 → 腾讯 proxy.finance.qq.com/…/mktHs/rank
                      t=02 概念（803 个，翻 2 页）/ t=01 行业
                      返回 Access-Control-Allow-Origin: * → 可直接 fetch

   三个源都实测过：
   - 新浪期货：12/12 品种返回，30 字段结构稳定，Content-Type application/javascript
   - 新浪个股：sh/sz 前缀直传，字段与期货同族
   - 腾讯板块：803 个概念板块，按 FOCUS_SECTOR_KW 命中 17 个光通信/AI 相关
   ========================================================================== */
(function () {
  'use strict';

  var QQ_RANK = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/mktHs/rank';
  var SINA_HQ = 'https://hq.sinajs.cn/list=';

  /* ---------- 期货：东财 secid → 新浪期货代码 ---------- */
  var FUT_SINA = {
    '113.RBm': 'nf_RB0', '113.HCm': 'nf_HC0', '113.CUm': 'nf_CU0',
    '113.AUm': 'nf_AU0', '113.AGm': 'nf_AG0',
    '114.Mm':  'nf_M0',  '114.Im':  'nf_I0',  '114.Cm':  'nf_C0',
    '114.JMm': 'nf_JM0',
    '115.TAm': 'nf_TA0', '115.SAm': 'nf_SA0', '115.MAm': 'nf_MA0'
  };

  /* ---------- 股票：东财 secid → 新浪代码 ---------- */
  // 0.=深 / 1.=沪；与页面 FOCUS_STOCKS 的写法一致
  function secidToSina(secid) {
    var s = String(secid || '');
    var i = s.indexOf('.');
    if (i < 0) return null;
    var mk = s.slice(0, i), code = s.slice(i + 1);
    if (!/^\d{6}$/.test(code)) return null;
    if (mk === '0') return 'sz' + code;
    if (mk === '1') return 'sh' + code;
    return null;
  }

  /* 新浪期货字段解析（30 段，逗号分隔）
     [0]名称 [1]时间 [2]开盘 [3]最高 [4]最低 [6]买价 [7]卖价
     [8]最新价 [10]昨结 [13]持仓量 [14]成交量 [16]品种名 [17]日期
     返回 {f2 最新价, f3 涨跌幅%, f4 涨跌额, f15 最高, f16 最低, f17 开盘} */
  function parseSinaFutRow(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    var f = raw.split(',');
    if (f.length < 18) return null;
    var last = parseFloat(f[8]);
    var pre = parseFloat(f[10]);
    if (!isFinite(last) || !isFinite(pre) || !pre) return null;
    var chg = last - pre;
    return {
      f2: last,
      f3: (chg / pre) * 100,
      f4: chg,
      f15: parseFloat(f[3]),
      f16: parseFloat(f[4]),
      f17: parseFloat(f[2]),
      name: f[16] || f[0],
      date: f[17] || '',
      _src: 'sina'
    };
  }

  /* 新浪股票字段解析（A股，33 段左右）
     [0]名称 [1]今开 [2]昨收 [3]现价 [4]最高 [5]最低 … [8]成交量(股) [9]成交额(元)
     注意：股票用「昨收」而非「昨结」算涨跌 */
  function parseSinaStockRow(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    var f = raw.split(',');
    if (f.length < 10) return null;
    var last = parseFloat(f[3]);
    var pre = parseFloat(f[2]);
    if (!isFinite(last) || !isFinite(pre) || !pre) return null;
    var chg = last - pre;
    return {
      f2: last,
      f3: (chg / pre) * 100,
      f4: chg,
      f5: parseFloat(f[8]),                       // 成交量（手 → 后面换算）
      f6: parseFloat(f[9]) / 1e4,                 // 成交额 元 → 万元（页面按万渲染）
      f15: parseFloat(f[4]),
      f16: parseFloat(f[5]),
      f17: parseFloat(f[1]),
      name: f[0],
      _src: 'sina'
    };
  }

  /* 通用：script 注入新浪 hq，读回 window.hq_str_* */
  function fetchSina(codes, parseFn, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!codes || !codes.length) return reject(new Error('no codes'));
      var script = document.createElement('script');
      script.charset = 'gbk';
      script.referrerPolicy = 'no-referrer';
      var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, timeoutMs || 8000);
      function cleanup() { clearTimeout(timer); if (script.parentNode) script.remove(); }

      script.onload = function () {
        cleanup();
        var map = {}, got = 0;
        for (var i = 0; i < codes.length; i++) {
          var c = codes[i];
          var parsed = parseFn(window['hq_str_' + c]);
          if (!parsed) continue;
          map[c] = parsed;
          got++;
        }
        got ? resolve(map) : reject(new Error('empty'));
      };
      script.onerror = function () { cleanup(); reject(new Error('network')); };
      script.src = SINA_HQ + codes.join(',');
      document.head.appendChild(script);
    });
  }

  /* 期货：一次拉全，返回 { '东财secid小写': {…} } */
  function fetchFuturesSina(list) {
    var pairs = [];
    var src = Array.isArray(list) && list.length
      ? list.map(function (f) { return String(f.secid); })
      : Object.keys(FUT_SINA);

    src.forEach(function (secid) {
      var sc = FUT_SINA[secid] || FUT_SINA[String(secid).toLowerCase()];
      if (!sc) {
        // 兜底：113.RBm → nf_RB0（主连 = 品种代码 + 0）
        var m = /^1\d{2}\.([A-Za-z]+)m$/.exec(secid);
        if (m) sc = 'nf_' + m[1].toUpperCase() + '0';
      }
      if (sc) pairs.push([secid, sc]);
    });

    if (!pairs.length) return Promise.reject(new Error('no futures'));

    return fetchSina(pairs.map(function (p) { return p[1]; }), parseSinaFutRow)
      .then(function (bySina) {
        var map = {};
        pairs.forEach(function (p) {
          var d = bySina[p[1]];
          if (!d) return;
          d.f12 = p[1].replace(/^nf_/, '');
          d.f14 = d.name;
          map[String(p[0]).toLowerCase()] = d;
        });
        if (!Object.keys(map).length) throw new Error('empty');
        return map;
      });
  }

  /* 核心个股：一次拉全，返回 { '东财secid小写': {…} } */
  function fetchStocksSina(list) {
    var pairs = [];
    (list || []).forEach(function (s) {
      var secid = Array.isArray(s) ? s[0] : s.secid;
      var sc = secidToSina(secid);
      if (sc) pairs.push([String(secid), sc]);
    });
    if (!pairs.length) return Promise.reject(new Error('no stocks'));

    return fetchSina(pairs.map(function (p) { return p[1]; }), parseSinaStockRow)
      .then(function (bySina) {
        var map = {};
        pairs.forEach(function (p) {
          var d = bySina[p[1]];
          if (!d) return;
          d.f12 = p[1].slice(2);
          d.f13 = p[1].slice(0, 2) === 'sh' ? 1 : 0;
          d.f14 = d.name;
          map[p[0].toLowerCase()] = d;
        });
        if (!Object.keys(map).length) throw new Error('empty');
        return map;
      });
  }

  /* ---------- 板块：腾讯 rank ---------- */
  // t: '01'=行业 '02'=概念；返回与东财 clist 同形的行数组
  function fetchQQBoards(kind, pageSize, maxPages) {
    var t = kind === 'industry' ? '01' : '02';
    var l = pageSize || 500;
    var maxP = maxPages || 3;
    var all = [];
    var page = 1;

    function step() {
      if (page > maxP) return Promise.resolve(all);
      var url = QQ_RANK + '?l=' + l + '&p=' + page + '&t=' + t + '/averatio&ordertype=0';
      return fetch(url, { referrerPolicy: 'no-referrer', cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (j) {
          var rows = (j && j.data) || [];
          if (!rows.length) return all;
          rows.forEach(function (x) {
            var pct = parseFloat(x.bd_zdf);
            if (!x.bd_name || !isFinite(pct)) return;
            all.push({
              f12: x.bd_code || '',        // 板块码
              f14: x.bd_name,              // 板块名
              f2: parseFloat(x.bd_zxj),    // 板块最新价（指数点位）
              f3: pct,                     // 涨跌幅 %
              f4: parseFloat(x.bd_zd),     // 涨跌额
              _src: 'qq'
            });
          });
          if (rows.length < l) return all;
          page++;
          return step();
        });
    }
    return step().then(function (rows) {
      if (!rows.length) throw new Error('empty');
      return rows;
    });
  }

  /* ---------- 暴露 ---------- */
  var API = {
    FUT_SINA: FUT_SINA,
    secidToSina: secidToSina,
    parseSinaFutRow: parseSinaFutRow,
    parseSinaStockRow: parseSinaStockRow,
    fetchFuturesSina: fetchFuturesSina,
    fetchStocksSina: fetchStocksSina,
    fetchQQBoards: fetchQQBoards,
    version: '1.1.0'
  };

  if (typeof window !== 'undefined') window.QF = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
