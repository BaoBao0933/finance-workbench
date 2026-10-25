/* ═══════════════════════════════════════════════════════════════════════════
   build-icons.mjs · 用 anatomy(2.5D SKILL) 的 kit 生成工作台标题图标
   ───────────────────────────────────────────────────────────────────────────
   ⭐ 2026-10-25 两轮用户反馈迭代出的纪律：
   ①「照着 EMOJI 来改，不要改的不像原来的 EMOJI」→ emoji 是设计稿，kit 只是渲染引擎，
     每枚先把 emoji 拆成构成元素（base64 解码原图），再用 kit 逐件复刻，颜色照 emoji 取。
   ②「别让 2.5D 躺着，尽量站着」→ 低俯角（elevation 14°）+ 竖立轮廓：
     · 躺姿 = 高俯角等距（30°），物体摊在地平面，只能看到顶面 → 公文包变盒子、
       报纸变纸片、虎头变球、星星变贴纸
     · 站姿 = 压低俯角到 14°，extrude 的 xy 轮廓投影后基本正立朝向观众，
       z 方向只留一点点厚度（立牌感）→ 虎有正脸、包有提手、报纸有页眉线
     图表类（柱状/K线/走势）也改成「竖立的图表牌 + 柱子浮雕凸出板面」。

   emoji 构成清单（从 index.html 静态标记 base64 解码的原图）：
     flame 热门行业板块 = 白框 + 三根方柱（中红最高 / 左黄绿 / 右浅蓝）+ 柱顶刻度线
     star  自选股票     = 黄色五角星
     bag   我的持仓     = 公文包：深棕提手 + 棕箱体 + 翻盖线 + 黄锁扣
     trophy 龙虎榜      = 老虎头：橙脸 + 白耳 + 黑条纹 + 胡须 + 银座
     news  财经要闻     = 报纸：深灰后页折边 + 灰白主页 + 页眉线 + 左下图框 + 右栏 4 行文字
     focus 重点关注     = 放大镜：白镜片 + 银圈 + 左上浅蓝反光 + 银杆深灰握把
     kline 期货市场     = 白框 + 浅蓝上升折线 + 轴线
     trend 走势分析     = 白框 + 红色上升折线（zigzag 5 点）+ 轴线
     grid  行业板块     = 浅蓝办公楼 + 白窗格 + 深色门
     flow  资金流向     = 带翅膀的钱：绿钱币 + 白瓣高光 + 左右双白翼

   产物：icons.gen.js    运行：node build-icons.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "file:///C:/Users/Administrator/.workbuddy/skills/anatomy/kit/iso-kit.mjs";
import * as G from "file:///C:/Users/Administrator/.workbuddy/skills/anatomy/kit/lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "icons.gen.js");

/* 画布 48×48；⚠️ cam 的点必须包含 z 向极值，否则厚的部分被 viewBox 切掉
   ⭐⭐⭐ 站姿的正确参数（2026-10-25 探针实测，两次返工换来的）：
     · elevation = **相机俯角**。14°=贴地平视 → xy 轮廓被压到 24%，物体全躺；
       72° → 轮廓充分展开（正立）。
     · azimuth 决定 x/y 在屏幕上的指向，实测：
         az=0   → x 竖直向下、y 水平向左   （画面转了 90°）
         az=90  → x **水平向右**、y **竖直向下**  ← 正常朝向
         az=10  → x 竖直、y 水平（错 90°，所以放大镜柄横着、提手跑到侧面）
       取 az=82：x 右偏 8°、y 下偏 8° —— 正立 + 一点斜度，立体感不死板。
     · z → 屏幕向上 2.5 单位 = 立牌侧厚（可见但不喧宾夺主）。
   约定：所有图标坐标里 x = 左右、y = 上下（y 负在上）、z = 牌子厚度。 */
const VB = 48;
const cam = (points, pad = 1.5, azimuth = 82, elevation = 72) =>
  k.fitProjection(points, VB, VB, { pad, azimuth, elevation });

/* kit SolidPaths → 显式上色 SVG。shades[0] 最暗侧面 → shades[3] 最亮 */
function paint(paths, ramp) {
  const p = [];
  if (paths.fill) p.push(`<path d="${paths.fill}" fill="${ramp.fill}"/>`);
  paths.shades.forEach((d, i) => { if (d && ramp.shades[i]) p.push(`<path d="${d}" fill="${ramp.shades[i]}"/>`); });
  if (paths.top && ramp.top) p.push(`<path d="${paths.top}" fill="${ramp.top}"/>`);
  if (paths.crease && ramp.line) p.push(`<path d="${paths.crease}" fill="none" stroke="${ramp.line}" stroke-width=".45" opacity=".4"/>`);
  if (paths.bevel && ramp.top) p.push(`<path d="${paths.bevel}" fill="none" stroke="${ramp.top}" stroke-width=".7" opacity=".55"/>`);
  if (paths.outline && ramp.line) p.push(`<path d="${paths.outline}" fill="none" stroke="${ramp.line}" stroke-width=".75" stroke-linejoin="round" opacity=".9"/>`);
  return p.join("");
}
const poly = (pts, color, w) =>
  `<path d="M${pts.map((p) => p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" L")}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const dot = (pt, r, color) => `<circle cx="${pt[0].toFixed(2)}" cy="${pt[1].toFixed(2)}" r="${r}" fill="${color}"/>`;
const unit = (step, amp, inner, extra = "") => `<g class="hi-u" data-step="${step}" data-amp="${amp}"${extra}>${inner}</g>`;
/* 竖立牌面上的线（画在轮廓顶面 z 上，低俯角下贴在正面上） */
const faceLine = (from, to, z, P, color, w, opacity = 1) =>
  `<path d="${k.lineOnTop(from, to, z, P)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${opacity}"/>`;
const spaceLine = (from, to, P, color, w, opacity = 1) =>
  `<path d="${k.segment(from, to, P)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${opacity}"/>`;
const faceShape = (pts, z, P, fill, opacity = 1) =>
  `<path d="${k.onTop(pts, z, P, true)}" fill="${fill}" opacity="${opacity}"/>`;
/* 圆角矩形 plan（w=宽, h=高, d 在 kit 里是纵深，竖立后 d 当高用） */
const rr = (x, y, w, h, r) => ({ x, y, w, d: h, r });

/* ── 色阶：全部照 emoji 取色，不自己发挥 ── */
const YELLOW = { fill: "#e8d21f", shades: ["#a89a10", "#c4b414", "#efdb2a", "#fbeb6a"], top: "#fff8a0", line: "#7a6d0a" };
const LIME = { fill: "#9db82f", shades: ["#71871f", "#87a026", "#aec63c", "#c8dd63"], top: "#e2f08a", line: "#4a5a12" };
const RED = { fill: "#c94a38", shades: ["#962d20", "#b0392a", "#d65a44", "#ec8268"], top: "#ff9d82", line: "#7c2417" };
const RED_E = { fill: "#d22f27", shades: ["#9c1f1a", "#b52620", "#e0453a", "#ef7a6e"], top: "#ff9d8f", line: "#701410" };
const SKY = { fill: "#5fb6e8", shades: ["#3d84ad", "#4a97c4", "#6fc2ea", "#9adcf6"], top: "#c8ecfd", line: "#2a5d7d" };
const BLUE = { fill: "#2f6fc4", shades: ["#1f4e91", "#275ba9", "#3579cc", "#5b98e0"], top: "#8fc0f5", line: "#17386b" };
const SILVER = { fill: "#787e8a", shades: ["#5f656f", "#6c727d", "#858b96", "#9ba1ab"], top: "#b3b8c2", line: "#4a5058" };
const PAPER = { fill: "#c3c8d2", shades: ["#a4a9b5", "#b6bbc6", "#cdd2db", "#e2e6ec"], top: "#f4f6f9", line: "#6d7482" };
const INK = { fill: "#3F3F3F", shades: ["#2b2b2b", "#333333", "#4a4a4a", "#5c5c5c"], top: "#6a6a6a", line: "#1c1c1c" };
const BROWN = { fill: "#a57939", shades: ["#6a462f", "#825a31", "#b98d4d", "#d3a869"], top: "#e0b980", line: "#4a2f16" };
const GREEN = { fill: "#5c9e31", shades: ["#3c6c1e", "#478526", "#6cb53c", "#93d162"], top: "#b8e88f", line: "#2a4d14" };
const ORANGE = { fill: "#e27022", shades: ["#a04a10", "#b85516", "#f08a3c", "#ffab68"], top: "#ffc48a", line: "#6e3008" };
const starRing = (R, r) => { const o = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; o.push([Math.cos(a) * (i % 2 ? r : R), Math.sin(a) * (i % 2 ? r : R)]); } return o; };
const arcPts = (cx, cy, r, a0, a1, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const ellipsePts = (cx, cy, rx, ry, n = 16) =>
  Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });

const out = {};

/* ═══════════════════════════════════════════════════════════════════════════
   1) star · 自选股票（站着）
   emoji = 黄色五角星（正视）
   → 正立五角星 + 一点侧厚（立牌感）+ 内层高光星 + 一粒火星
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const ring = starRing(9.5, 4);
  const P = cam([...ring.map(([x, y]) => [x, y, 5]), [12, -11, 7]]);
  const body = k.extrude(ring, 0, 4.5, P, { convex: true, bevel: 1 });
  const hi = k.extrude(ring.map(([x, y]) => [x * 0.6, y * 0.6]), 4.5, 0.01, P, { convex: true });
  const spark = k.cylinder(12.5, -10.5, 1.7, 4.6, 2.4, P, 16);
  out.star = paint(body, YELLOW) + paint(hi, YELLOW)
    + unit(0, 2.6, paint(body, YELLOW) + paint(hi, YELLOW))
    + unit(1, 1.8, paint(spark, YELLOW), ' data-dx="-.5" data-dy="-.87" data-kick="down" data-roll="0"');
}

/* ═══════════════════════════════════════════════════════════════════════════
   2) bag · 我的持仓（站着）
   emoji = 公文包正视：深棕提手拱在箱顶上方 + 棕箱体 + 翻盖横线 + 黄锁扣
   → 正立箱体（圆角矩形 + 侧厚）+ 箱顶上方提手拱（半环 + 同厚度）
     + 箱面翻盖线 + 箱面中央黄锁扣
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const P = cam([[-11, -12, 0], [11, -12, 0], [-11, 12, 0], [11, 12, 0], [0, 0, 6]]);
  const T = 4.2;                                    /* 牌厚 */
  /* 提手：半圆环（拱形），立在箱顶上方，同厚度 */
  const arch = arcPts(0, -7.6, 3.6, Math.PI, Math.PI * 2, 14);
  const handle = k.extrude(arch, 0, T, P, { convex: true, bevel: 0.5 });
  /* 箱体 */
  const box = k.extrude(k.roundedPlan(rr(-9, -6.5, 18, 13.5, 1.6), 10), 0, T, P);
  /* 翻盖线：箱面上方三分之一处 */
  const flap = faceLine([-7.4, -1.8], [7.4, -1.8], T, P, "#6a462f", 1.4, 0.85);
  /* 黄锁扣：箱面中央 */
  const clasp = k.extrude(k.roundedPlan(rr(-2.2, -0.6, 4.4, 3.2, 0.7), 6), T, 1.1, P);
  out.bag = paint(handle, BROWN) + paint(box, BROWN) + flap
    + unit(0, 2.4, paint(box, BROWN) + flap)
    + unit(1, 2.0, paint(clasp, { fill: "#fcea2b", shades: ["#b8a410", "#d4be16", "#ffe63a", "#fff37a"], top: "#fffbc0", line: "#7a6a0a" }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   3) trophy · 龙虎榜（站着）
   ⚠️ emoji 是**老虎头**不是奖杯。用户两次点名：「中间应该有个王字」「这像猪一样了」。
   → 虎的识别特征是**额头「王」字**（三横一竖）+ 深色小三角鼻 + **小**白色口鼻区
     + 脸颊横向条纹 + 胡须 + 橙耳（带浅色内耳）。
     第一版做成了"大白椭圆口鼻 + 斜短线"→ 观感就是猪。教训：猪和虎的分界就是
     「王字、竖耳、横纹、小鼻」，白色口鼻区一大就变猪。
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const P = cam([[-13, -13, 0], [13, -13, 0], [-13, 13, 0], [13, 13, 0], [0, 0, 6]]);
  const T = 4;
  const INK2 = "#2a1a08";
  /* 耳朵：橙色圆 + 浅色内耳（先画，藏在脸后）；r 别大 —— 大了像米老鼠 */
  const earL = k.extrude(k.circleRing(-6.9, -6.6, 2.3, 16), 0, T, P);
  const earR = k.extrude(k.circleRing(6.9, -6.6, 2.3, 16), 0, T, P);
  const earInL = faceShape(ellipsePts(-6.9, -6.6, 1.05, 1.05, 12), T, P, "#ffd9b0", 0.95);
  const earInR = faceShape(ellipsePts(6.9, -6.6, 1.05, 1.05, 12), T, P, "#ffd9b0", 0.95);
  /* 脸 */
  const face = k.extrude(k.circleRing(0, 0.8, 8.6, 30), 0, T, P);
  /* 银座：脸下方 */
  const base = k.extrude(k.roundedPlan(rr(-5.2, 9.7, 10.4, 2.4, 1), 4), 0, T * 0.65, P);
  /* ── 额头「王」字：三横一竖（虎的核心标识） ── */
  const wang = faceLine([-3.2, -6.4], [3.2, -6.4], T, P, INK2, 1.6, 0.96)   /* 上横 */
    + faceLine([-2.5, -4.6], [2.5, -4.6], T, P, INK2, 1.6, 0.96)             /* 中横 */
    + faceLine([-3.2, -2.8], [3.2, -2.8], T, P, INK2, 1.6, 0.96)             /* 下横 */
    + faceLine([0, -6.9], [0, -2.3], T, P, INK2, 1.6, 0.96);                 /* 竖 */
  /* ── 眼睛：黑豆 + 上方一点白高光 ── */
  const eyes = faceShape(ellipsePts(-3.9, -0.5, 1.15, 1.4, 12), T, P, INK2, 0.96)
    + faceShape(ellipsePts(3.9, -0.5, 1.15, 1.4, 12), T, P, INK2, 0.96)
    + faceShape(ellipsePts(-3.6, -0.9, 0.34, 0.4, 8), T, P, "#ffffff", 0.9)
    + faceShape(ellipsePts(4.2, -0.9, 0.34, 0.4, 8), T, P, "#ffffff", 0.9);
  /* ── 鼻子：**倒**三角（上宽下尖）—— 尖朝上就成了箭头，必须尖朝下 ── */
  const nose = faceShape([[-1.5, 1.5], [1.5, 1.5], [0, 3.0]], T, P, INK2, 0.96)
    + faceLine([0, 3.0], [0, 4.2], T, P, INK2, 1.1, 0.95)
    + faceLine([0, 4.2], [-1.5, 5.1], T, P, INK2, 0.95, 0.9)
    + faceLine([0, 4.2], [1.5, 5.1], T, P, INK2, 0.95, 0.9);
  /* ── 白色口鼻区：小、扁，只垫在鼻下（大一点就变猪） ── */
  const muzzle = faceShape(ellipsePts(0, 3.6, 2.9, 1.9, 16), T, P, "#fff6ea", 0.95);
  /* ── 脸颊横向条纹：两侧各 3 道（横的，不是斜的） ── */
  let stripes = "";
  for (const sy of [1.0, 2.7, 4.4]) {
    stripes += faceLine([-6.9, sy], [-4.7, sy - 0.15], T, P, INK2, 1.25, 0.92);
    stripes += faceLine([6.9, sy], [4.7, sy - 0.15], T, P, INK2, 1.25, 0.92);
  }
  /* ── 胡须：两侧各 3 根 ── */
  let whisk = "";
  for (const wy of [2.0, 3.3, 4.6]) {
    whisk += faceLine([-8.1, wy], [-12.6, wy - 0.7], T, P, INK2, 0.9, 0.72);
    whisk += faceLine([8.1, wy], [12.6, wy - 0.7], T, P, INK2, 0.9, 0.72);
  }
  out.trophy = paint(earL, ORANGE) + paint(earR, ORANGE) + paint(base, SILVER)
    + unit(0, 2.4, paint(face, ORANGE) + muzzle + wang + eyes + nose + stripes + whisk)
    + unit(1, 1.8, paint(earL, ORANGE) + earInL)
    + unit(2, 1.8, paint(earR, ORANGE) + earInR);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4) news · 财经要闻（站着）
   emoji = 报纸正视：深灰后页露出 + 灰白主页 + 页眉线 + 左下图框 + 右栏 4 行文字
   → 正立报纸牌（主页 + 侧厚）+ 左后深灰折边 + 牌面页眉线/图框/文字行
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const P = cam([[-13, -12, 0], [13, -12, 0], [-13, 12, 0], [13, 12, 0], [0, 0, 4]]);
  const T = 3;
  /* 后页折边：左上偏移的深灰页 */
  const back = k.extrude(k.roundedPlan(rr(-11.4, -8.8, 20.4, 15.6, 0.8), 6), 0, T * 0.8, P);
  const sheet = k.extrude(k.roundedPlan(rr(-10, -7.6, 20, 14.6, 0.8), 6), T * 0.8, T * 0.25, P);
  const Z = T * 1.05;
  const rows = [-3.6, -1.4, 0.8, 3.0].map((y) =>
    faceLine([0.4, y], [8.6, y], Z, P, "#8f949e", 0.9, 0.9));
  const pic = k.extrude(k.roundedPlan(rr(-8.2, -4.4, 7.2, 6.4, 0.4), 4), Z, 0.7, P);
  out.news = paint(back, INK) + paint(sheet, PAPER)
    + faceLine([-8.4, -5.4], [8.4, -5.4], Z, P, "#8f949e", 1.1, 0.95)
    + paint(pic, SILVER) + rows.join("")
    + unit(0, 2.0, paint(sheet, PAPER) + paint(pic, SILVER) + rows.join(""));
}

/* ═══════════════════════════════════════════════════════════════════════════
   5) focus · 重点关注（站着）
   emoji = 放大镜正视：白镜片 + 银圈 + 左上浅蓝反光 + 银杆深灰握把
   → 正立镜环（圆 + 侧厚）+ 镜圈上一段浅蓝反光弧 + 右下伸出的银杆 + 深灰握把
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const P = cam([[-13, -14, 0], [13, -14, 0], [-13, 14, 0], [13, 14, 0], [0, 0, 5]]);
  const T = 3.6;
  const lens = k.extrude(k.circleRing(0, -4.4, 6.0, 28), 0, T, P);
  const glare = k.onTop(arcPts(0, -4.4, 3.7, Math.PI * 1.05, Math.PI * 1.5, 10), T, P, false);
  /* 手柄：emoji 是"圆镜 + 长粗柄"—— 柄必须够长够粗，否则读成"镜子+小尾巴" */
  const stem = k.extrude(k.roundedPlan(rr(4.0, 0.6, 4.4, 12.6, 1.9), 6), 0, T, P);
  const grip = k.extrude(k.roundedPlan(rr(4.3, 10.4, 3.8, 3.4, 1.2), 5), T, 1.1, P);
  out.focus = paint(lens, PAPER)
    + `<path d="${glare}" fill="none" stroke="#92D3F5" stroke-width="1.8" stroke-linecap="round" opacity=".95"/>`
    + unit(0, 2.2, paint(lens, PAPER))
    + unit(1, 1.8, paint(stem, INK) + paint(grip, INK));
}

/* ═══════════════════════════════════════════════════════════════════════════
   6) kline · 期货市场（站着）
   emoji = 白框图表 + 浅蓝上升折线 + 轴线
   → 竖立的图表牌（板 + 侧厚）+ 4 根蓝杆浮雕凸出板面 + 杆顶折线 + 基线
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const board = rr(-12, -9, 24, 18, 1.2);
  const BASE = 6.4;                                  /* 基线 y（板下缘上方） */
  const xs = [-8.4, -3.6, 1.2, 6.0];
  const hs = [3.2, 5.0, 7.4, 10.0];                  /* 柱高写在 y 方向（屏幕竖直） */
  const P = cam([[-14, -10, 0], [14, -10, 0], [-14, 10, 0], [14, 10, 0], [0, 0, 6]]);
  const plate = k.extrude(k.roundedPlan(board, 10), 0, 2.5, P);
  const ZF = 4.2;                                    /* 柱子凸出板面的厚度 */
  const tops = xs.map((x, i) => k.iso([x, BASE - hs[i], ZF], P));
  out.kline = paint(plate, PAPER) + faceLine([-10, BASE + 1.4], [10, BASE + 1.4], 2.5, P, "#8f949e", 0.9, 0.8);
  xs.forEach((x, i) => {
    const bar = k.extrude(k.roundedPlan(rr(x - 1.3, BASE - hs[i], 2.6, hs[i], 0.5), 4), 2.5, ZF - 2.5, P);
    out.kline += unit(i, 2.0, paint(bar, SKY));
  });
  out.kline += poly(tops, "#2f6fc4", 1.6)
    + tops.map((t, i) => dot(t, 1.15, i === tops.length - 1 ? "#d22f27" : "#2f6fc4")).join("");
}

/* ═══════════════════════════════════════════════════════════════════════════
   7) trend · 走势分析（站着）
   emoji = 白框 + 红色上升折线（zigzag 5 点，整体向右上）+ 轴线
   → 竖立图表牌 + 5 根红杆浮雕（高度照 emoji 5 点换算）+ 杆顶折线 + 基线
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const board = rr(-12, -9, 24, 18, 1.2);
  const BASE = 6.4;
  /* emoji 5 点（72 viewBox）：(22.56,52.8) (25.89,55.0) (30.55,40.2) (38.12,43.4) (47.42,21.3)
     y 越小越高 → 杆高 = (62 - y) * 0.28；高度写在 y 方向 */
  const pts = [
    { x: -8.6, h: (62 - 52.8) * 0.28 },
    { x: -4.1, h: (62 - 55.0) * 0.28 },
    { x: 0.4, h: (62 - 40.2) * 0.28 },
    { x: 4.9, h: (62 - 43.4) * 0.28 },
    { x: 9.4, h: (62 - 21.3) * 0.28 },
  ];
  const P = cam([[-14, -10, 0], [14, -10, 0], [-14, 10, 0], [14, 10, 0], [0, 0, 6]]);
  const plate = k.extrude(k.roundedPlan(board, 10), 0, 2.5, P);
  const ZF = 4.2;
  const tops = pts.map((p) => k.iso([p.x, BASE - p.h, ZF], P));
  out.trend = paint(plate, PAPER) + faceLine([-10, BASE + 1.4], [10, BASE + 1.4], 2.5, P, "#8f949e", 0.9, 0.8);
  pts.forEach((p, i) => {
    const bar = k.extrude(k.roundedPlan(rr(p.x - 1.15, BASE - p.h, 2.3, p.h, 0.45), 4), 2.5, ZF - 2.5, P);
    out.trend += unit(i, 2.0, paint(bar, RED));
  });
  out.trend += poly(tops, "#d22f27", 1.7)
    + tops.map((t) => dot(t, 1.1, "#d22f27")).join("")
    + dot(tops[tops.length - 1], 1.7, "#ff9d82");
}

/* ═══════════════════════════════════════════════════════════════════════════
   8) flame · 热门行业板块（站着）
   emoji = 白框图表板 + 三根方柱（左黄绿矮 / 中红最高 / 右浅蓝中）+ 柱顶刻度线
   → 竖立图表牌 + 三根方柱浮雕凸出板面（高度照 emoji 比例）+ 柱顶刻度短线
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const board = rr(-12.5, -9, 25, 18, 1.2);
  const BASE = 6.4;
  const H = { lime: 6.0, red: 10.5, sky: 4.1 };      /* 照 emoji 柱高比例（y 方向） */
  const bars = [
    { x: -9.2, h: H.lime, tone: LIME },
    { x: -2.3, h: H.red, tone: RED_E },
    { x: 4.6, h: H.sky, tone: SKY },
  ];
  const P = cam([[-14.5, -10, 0], [14.5, -10, 0], [-14.5, 10, 0], [14.5, 10, 0], [0, 0, 6]]);
  const plate = k.extrude(k.roundedPlan(board, 10), 0, 2.5, P);
  const ZF = 4.2;
  out.flame = paint(plate, PAPER);
  bars.forEach((b, i) => {
    const body = k.extrude(k.roundedPlan(rr(b.x, BASE - b.h, 4.6, b.h, 0.6), 4), 2.5, ZF - 2.5, P);
    const tick = faceLine([b.x - 0.6, BASE - b.h - 1.2], [b.x + 5.2, BASE - b.h - 1.2], ZF, P, b.tone.line, 0.8, 0.8);
    out.flame += unit(i, 2.2, paint(body, b.tone) + tick);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   9) grid · 行业板块（本来就站着，保留）
   emoji = 浅蓝办公楼：楼体 + 白色窗格（正面 3×3）+ 深色门
   ═══════════════════════════════════════════════════════════════════════════ */
{
  /* 楼 = 正立面轮廓（宽 15 × 高 13，y 从 -12 顶到 +1 底）+ z 方向楼深 12
     → 站姿下是"竖立的楼板"，窗格画在朝观众的前立面上 */
  const front = rr(-7.5, -12, 15, 13, 0.8);
  const DEPTH = 12;
  const P = cam([[-10, -13, 0], [10, -13, 0], [-10, 2, 0], [10, 2, 0], [0, 0, DEPTH]]);
  const tower = k.extrude(k.roundedPlan(front, 6), 0, DEPTH, P);
  const ZF = DEPTH;                                   /* 前立面 */
  let windows = "";
  for (const wx of [-4.2, -0.2, 3.8]) {
    windows += spaceLine([wx, -9.4, ZF], [wx, -3.0, ZF], P, "#eaf6ff", 0.9, 0.95);
  }
  for (const wy of [-9.4, -6.2, -3.0]) {
    windows += spaceLine([-6.4, wy, ZF], [6.4, wy, ZF], P, "#eaf6ff", 0.9, 0.95);
  }
  const door = spaceLine([-1.5, -1.6, ZF], [-1.5, 0.9, ZF], P, "#17386b", 1.3, 0.95)
    + spaceLine([1.5, -1.6, ZF], [1.5, 0.9, ZF], P, "#17386b", 1.3, 0.95)
    + spaceLine([-1.5, -1.6, ZF], [1.5, -1.6, ZF], P, "#17386b", 1.3, 0.95);
  out.grid = paint(tower, SKY) + windows + door
    + unit(0, 2.2, paint(tower, SKY) + windows + door);
}

/* ═══════════════════════════════════════════════════════════════════════════
   10) flow · 资金流向（站着）
   emoji = 带翅膀的钱：中间绿钱币（白瓣高光）+ 左右两片白翅膀
   → 正立绿钱牌（圆角矩形 + 侧厚 + 白瓣）+ 左右两片立起来的白翼
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const P = cam([[-14, -12, 0], [14, -12, 0], [-14, 12, 0], [14, 12, 0], [0, 0, 6]]);
  const T = 3.6;
  /* 钱币：竖立的圆角小牌 */
  const note = k.extrude(k.roundedPlan(rr(-4.4, -3.4, 8.8, 6.8, 1.6), 6), 0, T, P);
  const petal = faceShape(ellipsePts(0, 0, 2.1, 3, 14), T, P, "#ffffff", 0.9);
  /* 双翼：立起来的弯叶（左右展开） */
  const wing = (s) => [
    [s * 3.4, -2.6], [s * 7.4, -4.6], [s * 11.6, -3.4], [s * 12.8, -0.4],
    [s * 10.6, 1.6], [s * 6.2, 2.4], [s * 3.4, 1.2],
  ];
  const wingL = k.extrude(wing(-1), 0, T * 0.85, P, { convex: true, bevel: 0.4 });
  const wingR = k.extrude(wing(1), 0, T * 0.85, P, { convex: true, bevel: 0.4 });
  out.flow = `<g class="hi-wing-l">${paint(wingL, PAPER)}</g><g class="hi-wing-r">${paint(wingR, PAPER)}</g>`
    + unit(0, 2.4, paint(note, GREEN) + petal);
}

/* ═══════════════════════════════════════════════════════════════════════════
   11) cube · 市场概览标题（22px 小图标）
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const P = cam([[-15, -15, 0], [15, -15, 0], [-15, 15, 0], [15, 15, 0], [0, 0, 8]]);
  const c1 = k.extrude(k.roundedPlan(rr(-7, -7, 6.5, 6.5, 0.6), 4), 0, 6, P);
  const c2 = k.extrude(k.roundedPlan(rr(-0.5, -0.5, 6.5, 6.5, 0.6), 4), 0, 6, P);
  const GREEN2 = { fill: "#1e9e68", shades: ["#126e46", "#188655", "#28b478", "#4fd296"], top: "#8fe8bc", line: "#0d5233" };
  out.cube = paint(c1, BLUE)
    + unit(0, 2.2, paint(c2, GREEN2))
    + unit(1, 2.2, paint(c1, BLUE));
}

/* 输出：每枚一个 key，值 = SVG 片段字符串 */
{
  const lines = Object.entries(out).map(([k2, v]) => `    ${k2}: '${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',`);
  writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  const sizes = Object.entries(out).map(([k2, v]) => `${k2}:${(v.length / 1024).toFixed(1)}K`).join(" ");
  console.log("icons.gen.js written ->", sizes);
}
