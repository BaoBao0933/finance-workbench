/* ═══════════════════════════════════════════════════════════════════════════
   buddy-dog · 看盘小搭档（2026-10-24）
   ───────────────────────────────────────────────────────────────────────────
   一只安静的卡通狗（奶油脸 + 焦糖垂耳，同侧栏 logo 形象）：
     ① 时段问候 —— 每会话只问一次，气泡 6 秒自动收
     ② 点它 —— 说一句当前时段/情绪的话
     ③ 情绪联动 —— 观察 #mascot-deco 的 is-happy/is-shy（零耦合，
        不碰 lastQuotes / updateMascotMood），档位真变了才反应一次

   铁律：
     · 内容默认可见，绝不用 opacity:0 常驻（气泡用 display 开关）
     · 无无限循环动画（用户：不要太抢眼）
     · 降档 / reduced-motion 自动静音
     · 重复注入幂等（__bdBuddy 守卫）
   API: window.__buddy.state() / off() / on() / say(text)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__bdBuddy) return;
  window.__bdBuddy = true;

  var LS_KEY = 'wb_buddy_off';
  var bubbleTimer = null;
  var lastMood = '';

  function reduced() {
    return !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function lowQ() {
    return document.documentElement.getAttribute('data-fps-q') === 'low';
  }

  /* ── 形象：卡通狗 SVG（奶油脸 #f7efe2 + 杏色大垂耳 #d9a978）──────────
     ⭐ 2026-10-24 用户：「耳朵的边缘做干净的线条就好，现在看起来有点奇怪，
        之前那一版的线条更干净。」
     奇怪的来源：耳朵是「path + 耳垂椭圆」两块叠的，椭圆和 path 的接缝
     在轮廓上鼓出一小块，边缘就不干净了。
     现在改成**一条闭合曲线画出整个垂耳**（无叠加）：
       外缘从头顶 (36,21) 光滑外扩到 (3,46)，底部圆弧到 (15,88)，
       内缘贴脸收回 (29,68) 回到起点 —— 体量仍是「垂到下颌」的大垂耳，
       但轮廓只有一条线。 */
  function dogSvg() {
    return ''
      + '<svg viewBox="0 0 96 96" aria-hidden="true">'
      /* 整体缩到 92% 并居中 —— 大垂耳外缘在 x=3/93，不缩会被圆形按钮切出直边 */
      + '<g transform="translate(48 50) scale(.92) translate(-48 -50)">'
      + '<g class="bd-ear bd-ear-l">'
      + '<path d="M36 21 C22 14 6 26 3 46 C0 68 4 84 15 88 C24 91 30 82 29 68 C28 50 29 32 38 23 Z" fill="#d9a978"/>'
      + '</g>'
      + '<g class="bd-ear bd-ear-r">'
      + '<path d="M60 21 C74 14 90 26 93 46 C96 68 92 84 81 88 C72 91 66 82 67 68 C68 50 67 32 58 23 Z" fill="#d9a978"/>'
      + '</g>'
      + '<ellipse cx="48" cy="52" rx="30" ry="28" fill="#f7efe2"/>'
      + '<ellipse cx="48" cy="60" rx="14" ry="11" fill="#fffaf2"/>'
      + '<circle cx="37" cy="48" r="3.6" fill="#4a3426"/>'
      + '<circle cx="59" cy="48" r="3.6" fill="#4a3426"/>'
      + '<circle cx="38.3" cy="46.8" r="1.2" fill="#fff"/>'
      + '<circle cx="60.3" cy="46.8" r="1.2" fill="#fff"/>'
      + '<ellipse cx="48" cy="58" rx="5" ry="3.6" fill="#4a3426"/>'
      + '<path class="bd-mouth" d="M42 65 Q48 70 54 65" fill="none" stroke="#4a3426" stroke-width="2.2" stroke-linecap="round"/>'
      + '<ellipse cx="27" cy="57" rx="4.5" ry="3" fill="#f0b8a2" opacity=".55"/>'
      + '<ellipse cx="69" cy="57" rx="4.5" ry="3" fill="#f0b8a2" opacity=".55"/>'
      + '</g>'
      + '</svg>';
  }

  /* ── 时段问候（只陈述事实，不编行情数据）────────────────────────── */
  function greetText() {
    var now = new Date();
    var day = now.getDay();
    var mins = now.getHours() * 60 + now.getMinutes();
    if (day === 0 || day === 6) return '周末不开盘，出去走走吧';
    if (mins < 9 * 60 + 15) return '早上好，还没开盘';
    if (mins < 9 * 60 + 30) return '快开盘了，坐好';
    if (mins < 11 * 60 + 30) return '早盘盯盘辛苦啦';
    if (mins < 13 * 60) return '午休时间，吃口饭';
    if (mins < 15 * 60) return '下午盘，稳住节奏';
    if (mins < 21 * 60) return '收盘啦，今天辛苦了';
    return '夜深了，早点休息';
  }

  /* ⭐ 2026-10-24 「涨多了」判定（用户：大盘或者持仓股涨多了的时候再说触发祖训）：
     大盘(上证)涨 ≥1%，或 任一持仓涨 ≥3%，或 持仓平均涨 ≥2% —— 三条占一条就算。
     数据来自 #mascot-deco 的 dataset.idxpct / holdavg / holdmax（主文件
     updateMascotMood 每次行情刷新写入；lastQuotes/holdQuotes 不挂 window，
     注入层只能走 DOM 桥）。 */
  var ZUXUN_IDX = 1.0, ZUXUN_HOLD_MAX = 3.0, ZUXUN_HOLD_AVG = 2.0;

  function num(v) {
    var f = parseFloat(v);
    return isFinite(f) ? f : null;
  }

  function bigUp() {
    var deco = document.getElementById('mascot-deco');
    if (!deco) return false;
    var idx = num(deco.dataset.idxpct);
    var avg = num(deco.dataset.holdavg);
    var max = num(deco.dataset.holdmax);
    if (idx != null && idx >= ZUXUN_IDX) return true;
    if (max != null && max >= ZUXUN_HOLD_MAX) return true;
    if (avg != null && avg >= ZUXUN_HOLD_AVG) return true;
    return false;
  }

  function isWeekend() {
    var d = new Date().getDay();
    return d === 0 || d === 6;
  }

  function moodLine(mood) {
    /* ⭐ 2026-10-24 用户指定台词：
       跌 →「又砸！稳住心态，别慌」
       涨 → 只有大盘/持仓**涨多了**才提祖训；小涨只说平常话 */
    if (mood === 'happy') {
      if (isWeekend()) return '';                       // 周末不说行情台词
      return bigUp() ? '是不是又触发祖训了，拉高要怎么样？自己注意观察哦。'
                     : '红盘啦，今天不错';
    }
    if (mood === 'shy') return isWeekend() ? '' : '又砸！稳住心态，别慌';
    return '震荡中，多看少动';
  }

  function currentMood() {
    var deco = document.getElementById('mascot-deco');
    if (!deco) return '';
    if (deco.classList.contains('is-happy')) return 'happy';
    if (deco.classList.contains('is-shy')) return 'shy';
    return '';
  }

  /* ── DOM ─────────────────────────────────────────────────────────── */
  function build() {
    var wrap = document.createElement('div');
    wrap.className = 'bd-buddy';
    wrap.id = 'bd-buddy';
    wrap.innerHTML = ''
      + '<div class="bd-bubble" id="bd-bubble"></div>'
      + '<button class="bd-face" id="bd-face" type="button" '
      + 'aria-label="看盘小搭档" title="看盘小搭档">' + dogSvg() + '</button>';
    document.body.appendChild(wrap);

    wrap.querySelector('#bd-face').addEventListener('click', function () {
      /* ⭐ 2026-10-24 用户：周末就保留周末不开盘就好了 —— 周末只报时段，不拼情绪台词 */
      if (isWeekend()) { say(greetText()); return; }
      var m = currentMood();
      say(greetText() + ' —— ' + moodLine(m));
    });
    return wrap;
  }

  function say(text, ms) {
    var b = document.getElementById('bd-bubble');
    if (!b) return;
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;              // 强制回流，让气泡能重复播
    b.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      b.classList.remove('show');
    }, ms || 6000);
  }

  function hide() {
    var b = document.getElementById('bd-bubble');
    if (b) b.classList.remove('show');
    clearTimeout(bubbleTimer);
  }

  /* ── 情绪联动：只在档位真变化时反应一次 ─────────────────────────── */
  function react(mood) {
    var face = document.getElementById('bd-face');
    if (!face) return;
    face.classList.toggle('is-happy', mood === 'happy');
    face.classList.toggle('is-shy', mood === 'shy');
    if (reduced() || lowQ()) return;
    face.classList.remove('bd-hop', 'bd-dip');
    void face.offsetWidth;
    face.classList.add(mood === 'happy' ? 'bd-hop' : (mood === 'shy' ? 'bd-dip' : 'bd-hop'));
    if (mood === '') face.classList.remove('bd-hop', 'bd-dip');
  }

  function watchMood() {
    var deco = document.getElementById('mascot-deco');
    if (!deco || !window.MutationObserver) return;
    lastMood = currentMood();
    new MutationObserver(function () {
      var m = currentMood();
      if (m === lastMood) return;
      lastMood = m;
      react(m);
      /* ⭐ 2026-10-24 周末自动静默：行情台词不播（周五收盘残留的 is-happy 不算数） */
      if (m && !isWeekend()) say(moodLine(m), 6500);
    }).observe(deco, { attributes: true, attributeFilter: ['class'] });
  }

  /* ── 启动 ───────────────────────────────────────────────────────── */
  function init() {
    if (localStorage.getItem(LS_KEY) === '1') return;   // 用户关过就不再出现
    if (document.getElementById('bd-buddy')) return;
    build();
    watchMood();
    /* 进场 1.2 秒后再问候，不跟首屏抢注意力 */
    setTimeout(function () {
      if (!document.getElementById('bd-buddy')) return;
      say(greetText(), 6000);
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__buddy = {
    state: function () {
      var el = document.getElementById('bd-buddy');
      return {
        mounted: !!el,
        off: localStorage.getItem(LS_KEY) === '1',
        mood: currentMood(),
        reduced: reduced()
      };
    },
    off: function () {
      localStorage.setItem(LS_KEY, '1');
      var el = document.getElementById('bd-buddy');
      if (el) el.remove();
      clearTimeout(bubbleTimer);
    },
    on: function () {
      localStorage.removeItem(LS_KEY);
      init();
    },
    say: say,
    hide: hide
  };
})();
