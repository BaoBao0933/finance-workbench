/* ==========================================================================
   perf-boost / analyze.js —— 静态渲染阻塞分析（不依赖浏览器）
   精确计算 <head> 中的阻塞资源及理论首屏延迟。
   运行：node perf-boost/analyze.js <html路径> <标签>
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const label = process.argv[3] || 'target';
const html = fs.readFileSync(file, 'utf8');

const headEnd = html.indexOf('</head>');
const head = headEnd > 0 ? html.slice(0, headEnd) : html;

/* ---- 找出所有 head 中的外链资源 ---- */
const links = [];
const linkRe = /<link\b[^>]*>/gi;
let m;
while ((m = linkRe.exec(head))) {
  const tag = m[0];
  const rel = (tag.match(/rel="([^"]*)"/) || [])[1] || '';
  const href = (tag.match(/href="([^"]*)"/) || [])[1] || '';
  const as = (tag.match(/as="([^"]*)"/) || [])[1] || '';
  const media = (tag.match(/media="([^"]*)"/) || [])[1] || '';
  if (!href) continue;
  links.push({ rel, href, as, media, external: /^https?:/i.test(href) });
}

/* ---- head 中的外链脚本（同步阻塞） ---- */
const syncScripts = [];
const scRe = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi;
while ((m = scRe.exec(head))) {
  const tag = m[0];
  syncScripts.push({
    src: m[1],
    async: /\basync\b/.test(tag),
    defer: /\bdefer\b/.test(tag),
    external: /^https?:/i.test(m[1]),
  });
}

const stylesheetBlocking = links.filter(l => l.rel === 'stylesheet' && !l.media);
const externalBlocking = stylesheetBlocking.filter(l => l.external);
const fontLinks = links.filter(l => /fonts\.(googleapis|gstatic)\.com/.test(l.href));
const preconnect = links.filter(l => l.rel === 'preconnect');
const inlineStyles = (head.match(/<style\b/gi) || []).length;
const inlineScripts = (head.match(/<script(?![^>]*\bsrc=)/gi) || []).length;

/* ---- 体量 ---- */
const totalBytes = Buffer.byteLength(html, 'utf8');
const headBytes = Buffer.byteLength(head, 'utf8');

/* ---- CSS 规则数与 backdrop-filter 用量（合成开销指标） ---- */
const cssRanges = [];
const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
let sm;
while ((sm = styleRe.exec(html))) cssRanges.push(sm[1]);
const allCss = cssRanges.join('\n');
const ruleCount = (allCss.match(/\{/g) || []).length;
const backdropCount = (allCss.match(/backdrop-filter/g) || []).length;
const blurCount = (allCss.match(/blur\(/g) || []).length;
const keyframesCount = (allCss.match(/@keyframes/g) || []).length;
const containCount = (allCss.match(/\bcontain:\s*layout/g) || []).length;

/* ---- 首屏同步执行的内联脚本字节（解析阻塞） ---- */
const inlineJsBytes = [];
const isRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let im;
while ((im = isRe.exec(html))) inlineJsBytes.push(Buffer.byteLength(im[1], 'utf8'));

const report = {
  label,
  文件总字节: totalBytes,
  head字节: headBytes,
  _head资源: {
    外链样式表_阻塞: stylesheetBlocking.map(l => l.href),
    其中_外部域名: externalBlocking.length,
    外链样式表_总数: stylesheetBlocking.length,
    GoogleFonts_link: fontLinks.map(l => l.href),
    preconnect: preconnect.map(l => l.href),
    同步外链脚本: syncScripts.filter(s => !s.async && !s.defer).map(s => s.src),
    异步或延迟脚本: syncScripts.filter(s => s.async || s.defer).map(s => s.src),
    内联style块: inlineStyles,
    内联script块: inlineScripts,
  },
  _CSS指标: {
    CSS规则数: ruleCount,
    backdrop_filter用量: backdropCount,
    blur用量: blurCount,
    keyframes数: keyframesCount,
    contain_layout数: containCount,
  },
  _内联JS字节: {
    块数: inlineJsBytes.length,
    总计: inlineJsBytes.reduce((a, b) => a + b, 0),
    最大块: Math.max.apply(null, inlineJsBytes),
  },
};

console.log(JSON.stringify(report, null, 2));
fs.writeFileSync(
  path.join(process.env.TEMP || '.', 'perf-analyze-' + label + '.json'),
  JSON.stringify(report, null, 2)
);
