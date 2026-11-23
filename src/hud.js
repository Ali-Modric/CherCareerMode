// ---------------------------------------------------------------------------
// src/hud.js — broadcast graphics package for FIFACHER.
// Original TV-football design: top-left score bug (competition mark, procedural
// club crests, dark glass panel, integrated possession bar, clock pill),
// animated goal lower-third with wipe, kickoff matchup card, auto-fading
// controls hint (never shown in capture builds).
// All DOM lives inside #hud (pointer-events: none). No canvas. DOM is only
// touched on change; the clock repaints at 2 Hz. Every animation is driven by
// accumulated dt (NOT CSS animations / wall clock) so screenshot fast-forward
// renders the exact same frame deterministically.
// ---------------------------------------------------------------------------

import { TEAMS, VENUE, PITCH, clamp, lerp, damp } from './util.js';

// ---- tiny helpers ----------------------------------------------------------

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;

function setText(node, s) {
  if (node.__txt !== s) { node.__txt = s; node.textContent = s; }
}
function setStyle(node, prop, value) {
  const bag = node.__sty || (node.__sty = {});
  if (bag[prop] !== value) { bag[prop] = value; node.style[prop] = value; }
}
function el(cls, parent, tag = 'div') {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (parent) parent.appendChild(d);
  return d;
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** amt in [-1,1]: negative darkens toward black, positive lightens toward white. */
function shade(hex, amt) {
  const [r, g, b] = hexRgb(hex);
  const to = amt < 0 ? 0 : 255;
  const t = Math.abs(amt);
  const m = (c) => Math.round(lerp(c, to, t));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** Defensive extraction of goal-event payload — shape is owned by match.js. */
function extractGoalInfo(d) {
  const info = { team: null, name: '', number: null };
  if (d && typeof d === 'object') {
    const side = d.team || d.side;
    if (side === 'home' || side === 'away') info.team = side;
    const p = d.scorer || d.player || d.by ||
      ((typeof d.name === 'string' || typeof d.number === 'number') ? d : null);
    if (p && typeof p === 'object') {
      if (!info.team && (p.team === 'home' || p.team === 'away')) info.team = p.team;
      if (typeof p.name === 'string') info.name = p.name;
      if (typeof p.number === 'number') info.number = p.number;
    }
    if (!info.name && typeof d.scorerName === 'string') info.name = d.scorerName;
  }
  return info;
}

// Screen-friendly derivations of the kit colours (used for the possession
// pill / bar, where a near-white away primary would blow out).
const POSS_COLOR = {
  home: shade(TEAMS.home.primary, 0.04),
  away: shade(TEAMS.away.secondary, 0.14),
};

function compInitials(name) {
  const words = String(name || 'LF').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || 'LF').slice(0, 2).toUpperCase();
}

// ---- stylesheet ------------------------------------------------------------

const CSS = `
.fh-root { position:absolute; inset:0; overflow:hidden; color:#eef2f8;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Segoe UI",Inter,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; user-select:none; }
.fh-glass { background:linear-gradient(180deg, rgba(25,31,46,.80) 0%, rgba(8,11,18,.90) 100%);
  -webkit-backdrop-filter:blur(12px) saturate(1.3); backdrop-filter:blur(12px) saturate(1.3);
  border:1px solid rgba(255,255,255,.13);
  box-shadow:0 14px 38px rgba(0,0,0,.62), 0 3px 10px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.10); }

/* ---- score bug (top-left) ---- */
.fh-bug-wrap { position:absolute; top:26px; left:30px; transform-origin:top left; }
.fh-bug-main { position:relative; border-radius:11px; overflow:hidden; }
.fh-bug-row { display:flex; align-items:stretch; height:46px; }

/* competition mark */
.fh-comp { display:flex; align-items:center; padding:0 11px;
  border-right:1px solid rgba(255,255,255,.11);
  background:linear-gradient(180deg, rgba(255,255,255,.075) 0%, rgba(255,255,255,.015) 100%); }
.fh-comp-mark { position:relative; width:27px; height:27px; border-radius:7px; overflow:hidden;
  display:flex; align-items:center; justify-content:center;
  background:linear-gradient(152deg,#3a4a7d 0%, #1b2547 52%, #0e1530 100%);
  border:1px solid rgba(255,255,255,.24);
  box-shadow:0 2px 5px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.18); }
.fh-comp-mark b { font-size:11.5px; font-weight:900; letter-spacing:.01em; line-height:1;
  color:#f4cd72; text-shadow:0 1px 2px rgba(0,0,0,.55); transform:translateY(-1px); }
.fh-comp-mark i { position:absolute; left:4px; right:4px; bottom:3.5px; height:2px; border-radius:1px;
  background:linear-gradient(90deg,#f4cd72,#c78f22); }

/* team block */
.fh-teams { display:flex; align-items:center; padding:0 13px; }
.fh-crest-drop { flex:none; filter:drop-shadow(0 2px 3px rgba(0,0,0,.6)); }
.fh-crest { position:relative; }
.fh-crest, .fh-crest-inner { clip-path:polygon(0 0, 100% 0, 100% 63%, 50% 100%, 0 63%); }
.fh-crest-inner { position:absolute; }
.fh-crest-band { position:absolute; left:0; right:0;
  display:flex; align-items:center; justify-content:center; box-shadow:0 1px 4px rgba(0,0,0,.3); }
.fh-crest-abbr { font-weight:900; letter-spacing:.06em; text-indent:.06em; line-height:1; }

/* both sides always carry a tab, so the bug stays symmetric; the tab of the
   team on the ball fills with its kit colour — no floating underline */
.fh-abbr { position:relative; display:inline-block; padding:6px 8px 7px; border-radius:6px;
  background:rgba(255,255,255,.055); box-shadow:inset 0 0 0 1px rgba(255,255,255,.07); }
.fh-abbr b { position:relative; display:block; font-size:15px; font-weight:600;
  letter-spacing:.10em; text-indent:.10em; line-height:1; }
.fh-poss { position:absolute; inset:0; border-radius:6px; opacity:0;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22), 0 1px 3px rgba(0,0,0,.35); }
.fh-score { font-size:21px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums;
  display:inline-block; min-width:13px; text-align:center; }
.fh-dash { font-size:21px; font-weight:700; line-height:1; color:rgba(238,242,248,.42); }

/* clock block */
.fh-clockseg { display:flex; align-items:center; gap:9px; padding:0 13px;
  border-left:1px solid rgba(255,255,255,.11); background:rgba(255,255,255,.055); }
.fh-halfpill { padding:3.5px 6px 4.5px; border-radius:5px; background:rgba(255,255,255,.16);
  border:1px solid rgba(255,255,255,.15); font-size:9.5px; font-weight:800;
  letter-spacing:.13em; text-indent:.13em; line-height:1; color:rgba(246,249,255,.96); }
.fh-clock { font-size:18px; font-weight:700; font-variant-numeric:tabular-nums;
  letter-spacing:.03em; line-height:1; }
.fh-added { display:none; padding:3.5px 5px 4.5px; border-radius:5px; line-height:1;
  background:linear-gradient(180deg,#f8ce5f,#dfa227); color:#241a05;
  font-size:9.5px; font-weight:900; letter-spacing:.03em;
  box-shadow:0 1px 3px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.45); }

/* possession bar welded to the bottom edge of the panel */
.fh-possbar { position:absolute; left:0; right:0; bottom:0; height:3px;
  display:flex; background:rgba(255,255,255,.10); }
.fh-possbar i { display:block; height:100%; }

/* venue sub-tab — flush left with the panel, right edge on the clock divider */
.fh-bug-sub { display:block; padding:4.5px 0 5.5px; text-align:center;
  font-size:10px; font-weight:700; letter-spacing:.2em; text-indent:.2em;
  color:rgba(226,234,248,.74); background:rgba(6,8,14,.78);
  border:1px solid rgba(255,255,255,.10); border-top:none; border-radius:0 0 8px 8px;
  box-shadow:0 8px 18px rgba(0,0,0,.45); }

/* ---- goal lower-third ---- */
.fh-banner-wrap { position:absolute; left:64px; bottom:84px; transform-origin:bottom left; display:none; }
.fh-banner { position:relative; display:flex; align-items:stretch; height:80px; min-width:560px;
  border-radius:10px; overflow:hidden; will-change:transform,opacity; }
.fh-banner-slab { position:absolute; top:-8px; bottom:-8px; left:-36px; width:242px;
  transform:skewX(-16deg); box-shadow:6px 0 20px rgba(0,0,0,.35); }
.fh-goalcell { position:relative; width:200px; display:flex; align-items:center;
  justify-content:center; gap:11px; }
.fh-goaltxt { font-size:31px; font-weight:900; font-style:italic; letter-spacing:.03em; line-height:1;
  text-shadow:0 2px 10px rgba(0,0,0,.28); }
.fh-banner-body { position:relative; display:flex; flex-direction:column; justify-content:center;
  gap:9px; padding:0 34px 0 18px; }
.fh-banner-row { display:flex; align-items:center; gap:10px; }
.fh-num { padding:3px 6px 4px; border-radius:4px; font-size:11px; font-weight:900;
  line-height:1; font-variant-numeric:tabular-nums; }
.fh-banner-scorer { font-size:21px; font-weight:800; letter-spacing:.06em; line-height:1; white-space:nowrap; }
.fh-banner-team { font-size:11.5px; font-weight:700; letter-spacing:.17em; text-indent:.17em;
  color:rgba(228,235,246,.74); line-height:1; white-space:nowrap; }
.fh-min { padding:3px 6px 4px; border-radius:4px; background:rgba(255,255,255,.17);
  border:1px solid rgba(255,255,255,.14); font-size:10.5px; font-weight:800;
  letter-spacing:.04em; line-height:1; color:rgba(246,249,255,.95); }
.fh-bscore { position:relative; margin-left:auto; display:flex; flex-direction:column;
  justify-content:center; gap:8px; padding:0 22px; border-left:1px solid rgba(255,255,255,.13);
  background:rgba(255,255,255,.045); }
.fh-bscore-row { display:flex; align-items:center; gap:14px; }
.fh-bscore-tick { width:3px; height:13px; border-radius:1.5px; }
.fh-bscore-ab { font-size:11px; font-weight:700; letter-spacing:.15em; text-indent:.15em;
  line-height:1; min-width:34px; }
.fh-bscore-n { font-size:15px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums;
  margin-left:auto; }
.fh-banner-line { position:absolute; left:0; right:0; bottom:0; height:3px; }
.fh-banner-wipe { position:absolute; top:0; bottom:0; left:0; right:0;
  border-right:3px solid rgba(255,255,255,.95); will-change:transform; }
.fh-banner-sweep { position:absolute; top:-12px; bottom:-12px; left:0; width:110px; opacity:0;
  background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.85), rgba(255,255,255,0)); }

/* ---- kickoff card (center) ---- */
.fh-card-wrap { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
.fh-card-scale { transform-origin:center; }
.fh-card { position:relative; width:680px; border-radius:16px; padding:26px 36px 22px; overflow:hidden;
  text-align:center; will-change:transform,opacity;
  background:radial-gradient(130% 150% at 50% 0%, rgba(32,40,58,.85) 0%, rgba(9,12,19,.92) 72%);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:0 18px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08);
  -webkit-backdrop-filter:blur(14px) saturate(1.2); backdrop-filter:blur(14px) saturate(1.2); }
.fh-card-topline { position:absolute; top:0; left:0; right:0; height:3px; }
.fh-card-comp { display:flex; align-items:center; justify-content:center; gap:11px;
  font-size:10.5px; font-weight:700; letter-spacing:.24em; text-indent:.24em; color:rgba(226,232,244,.62); }
.fh-card-row { display:flex; align-items:center; justify-content:center; gap:30px; margin:22px 0 20px; }
.fh-card-team { display:flex; flex-direction:column; align-items:center; gap:13px; width:215px; }
.fh-card-name { font-size:20px; font-weight:800; letter-spacing:.07em; line-height:1.15; }
.fh-card-bar { width:30px; height:3px; border-radius:1.5px; margin-top:-4px; }
.fh-card-vs { display:flex; flex-direction:column; align-items:center; gap:7px; }
.fh-vs-big { font-size:23px; font-weight:300; letter-spacing:.18em; color:rgba(238,242,248,.5);
  text-indent:.18em; line-height:1; }
.fh-vs-tag { font-size:8.5px; font-weight:700; letter-spacing:.26em; color:rgba(226,232,244,.45); text-indent:.26em; }
.fh-card-venue { display:flex; align-items:center; justify-content:center; gap:14px; }
.fh-card-venue i { display:block; width:46px; height:1px; background:rgba(255,255,255,.22); }
.fh-card-venue span { font-size:11px; font-weight:700; letter-spacing:.3em; text-indent:.3em;
  color:rgba(230,236,246,.72); }

/* ---- controls hint (bottom-right left of team ratings rail, auto-fading, never in capture) ---- */
.fh-ctrl-wrap { position:absolute; right:264px; bottom:22px; transform-origin:bottom right; opacity:0;
  display:flex; flex-wrap:wrap; justify-content:flex-end; align-items:center;
  max-width:560px; gap:5px 11px; padding:7px 12px 8px; border-radius:9px;
  background:linear-gradient(180deg, rgba(20,26,38,.62), rgba(6,9,15,.7));
  border:1px solid rgba(255,255,255,.10);
  -webkit-backdrop-filter:blur(7px); backdrop-filter:blur(7px);
  box-shadow:0 6px 18px rgba(0,0,0,.4); color:#e6ecf6; }
.fh-ctrl-item { display:flex; align-items:center; gap:5px; white-space:nowrap; }
.fh-key { padding:2px 5px 3px; border:1px solid rgba(255,255,255,.42); border-bottom-width:2px;
  border-radius:4px; font-size:9px; font-weight:700; letter-spacing:.05em; line-height:1; }
.fh-ctrl-label { font-size:9.5px; font-weight:600; letter-spacing:.12em; color:rgba(230,237,247,.82); }

/* ---- kick power meter (bottom-center above radar, visible while charging/releasing) ---- */
.fh-pwr-wrap { position:absolute; left:50%; bottom:148px; transform:translateX(-50%);
  transform-origin:bottom center; opacity:0; pointer-events:none;
  transition:opacity .12s ease-out; }
.fh-pwr-card { width:240px; padding:7px 12px 9px; border-radius:9px;
  background:linear-gradient(180deg, rgba(22,28,42,.90) 0%, rgba(8,11,18,.95) 100%);
  border:1px solid rgba(255,255,255,.15);
  box-shadow:0 10px 28px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08); }
.fh-pwr-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:5px; }
.fh-pwr-kind { font-size:10px; font-weight:800; letter-spacing:.18em; text-indent:.18em;
  color:rgba(240,245,255,.92); }
.fh-pwr-pct { font-size:11px; font-weight:700; font-variant-numeric:tabular-nums;
  color:rgba(226,234,248,.78); }
.fh-pwr-track { position:relative; height:7px; border-radius:4px; overflow:hidden;
  background:rgba(255,255,255,.12); box-shadow:inset 0 1px 2px rgba(0,0,0,.5); }
.fh-pwr-sweet { position:absolute; top:0; bottom:0; left:58%; width:20%;
  background:rgba(74,222,128,.24); border-left:1px solid rgba(134,239,172,.75);
  border-right:1px solid rgba(134,239,172,.75); pointer-events:none; display:none; }
.fh-pwr-fill { position:absolute; inset:0; transform-origin:left center;
  transform:scaleX(0); will-change:transform;
  background:linear-gradient(90deg, #22c55e 0%, #eab308 58%, #ef4444 100%); }

/* ---- contextual control prompt (bottom-center above radar when power bar hidden) ---- */
.fh-ctx-wrap { position:absolute; left:50%; bottom:146px; transform:translateX(-50%);
  transform-origin:bottom center; opacity:0; pointer-events:none;
  padding:5px 12px 6px; border-radius:7px;
  background:linear-gradient(180deg, rgba(16,22,34,.82), rgba(7,10,16,.90));
  border:1px solid rgba(255,255,255,.14);
  font-size:10px; font-weight:700; letter-spacing:.12em; color:rgba(232,239,250,.88);
  white-space:nowrap; box-shadow:0 8px 20px rgba(0,0,0,.45); }

/* ---- PES 2D pitch radar (bottom-center) ---- */
.fh-radar-wrap { position:absolute; left:50%; bottom:20px; transform:translateX(-50%);
  transform-origin:bottom center; padding:6px; border-radius:10px;
  background:linear-gradient(180deg, rgba(16,22,34,.84) 0%, rgba(7,10,16,.92) 100%);
  border:1px solid rgba(255,255,255,.15);
  box-shadow:0 12px 30px rgba(0,0,0,.58), inset 0 1px 0 rgba(255,255,255,.08); }
.fh-radar-canvas { display:block; width:172px; height:112px; border-radius:5px; }

/* ---- controlled player plate + stamina (bottom-left) ---- */
.fh-plate-wrap { position:absolute; left:30px; bottom:22px; transform-origin:bottom left; }
.fh-plate { min-width:228px; padding:9px 13px 10px; border-radius:10px;
  background:linear-gradient(180deg, rgba(22,28,42,.88) 0%, rgba(8,11,18,.94) 100%);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:0 12px 28px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08); }
.fh-plate-top { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
.fh-plate-num { min-width:24px; padding:3px 5px 3.5px; border-radius:5px; text-align:center;
  font-size:11.5px; font-weight:900; line-height:1; font-variant-numeric:tabular-nums; }
.fh-plate-name { font-size:13.5px; font-weight:800; letter-spacing:.07em; line-height:1;
  color:#f4f7fc; white-space:nowrap; }
.fh-plate-role { padding:2.5px 5px 3px; border-radius:4px; background:rgba(255,255,255,.11);
  font-size:9px; font-weight:800; letter-spacing:.12em; color:rgba(228,236,248,.78); }
.fh-plate-card { display:none; width:9px; height:12px; border-radius:2px;
  background:#facc15; box-shadow:0 1px 3px rgba(0,0,0,.5); }
.fh-plate-tac { margin-left:auto; padding:2.5px 6px 3px; border-radius:4px;
  font-size:9px; font-weight:900; letter-spacing:.12em; text-indent:.12em; line-height:1;
  border:1px solid rgba(255,255,255,.18); }
.fh-stam-row { display:flex; align-items:center; gap:8px; }
.fh-stam-lbl { font-size:8.5px; font-weight:800; letter-spacing:.16em; color:rgba(220,230,245,.62); }
.fh-stam-track { position:relative; flex:1; height:6px; border-radius:3px; overflow:hidden;
  background:rgba(255,255,255,.12); box-shadow:inset 0 1px 2px rgba(0,0,0,.5); }
.fh-stam-cap { position:absolute; top:0; bottom:0; right:0; background:rgba(0,0,0,.45); }
.fh-stam-fill { position:absolute; inset:0; transform-origin:left center; will-change:transform;
  background:linear-gradient(90deg, #22c55e, #4ade80); }

/* ---- referee & event callout (top-center) ---- */
.fh-toast-wrap { position:absolute; top:26px; left:50%; transform:translateX(-50%);
  transform-origin:top center; display:none; }
.fh-toast { display:flex; align-items:center; gap:10px; padding:8px 16px 9px; border-radius:9px;
  background:linear-gradient(180deg, rgba(22,28,42,.92) 0%, rgba(8,11,18,.96) 100%);
  border:1px solid rgba(255,255,255,.16);
  box-shadow:0 12px 30px rgba(0,0,0,.60), inset 0 1px 0 rgba(255,255,255,.10); }
.fh-toast-dot { width:8px; height:11px; border-radius:2px; flex:none; }
.fh-toast-title { font-size:12px; font-weight:900; letter-spacing:.14em; text-indent:.14em;
  color:#ffffff; white-space:nowrap; }
.fh-toast-sub { font-size:11px; font-weight:700; letter-spacing:.08em;
  color:rgba(226,234,248,.78); white-space:nowrap; }

/* ---- halftime / fulltime match stats overlay ---- */
.fh-stats-wrap { position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  background:rgba(5,8,14,.52); pointer-events:none; }
.fh-stats-scale { transform-origin:center; }
.fh-stats-card { width:520px; border-radius:14px; padding:22px 28px 20px;
  background:linear-gradient(180deg, rgba(24,30,45,.95) 0%, rgba(9,12,19,.97) 100%);
  border:1px solid rgba(255,255,255,.16);
  box-shadow:0 24px 64px rgba(0,0,0,.72), inset 0 1px 0 rgba(255,255,255,.10); }
.fh-stats-head { text-align:center; margin-bottom:14px; }
.fh-stats-tag { font-size:10px; font-weight:800; letter-spacing:.26em; color:#f4cd72; margin-bottom:6px; }
.fh-stats-scoreline { display:flex; align-items:center; justify-content:center; gap:18px;
  font-size:26px; font-weight:900; font-variant-numeric:tabular-nums; }
.fh-stats-team { font-size:14px; font-weight:800; letter-spacing:.12em; color:rgba(235,241,252,.86); }
.fh-stats-rows { display:flex; flex-direction:column; gap:8px; margin-top:14px; }
.fh-srow { display:grid; grid-template-columns:48px 1fr 48px; align-items:center; gap:10px; }
.fh-srow-val { font-size:13px; font-weight:800; font-variant-numeric:tabular-nums; text-align:center; }
.fh-srow-mid { display:flex; flex-direction:column; gap:3px; align-items:center; }
.fh-srow-lbl { font-size:9.5px; font-weight:700; letter-spacing:.16em; color:rgba(218,228,244,.7); }
.fh-srow-bar { width:100%; height:4px; border-radius:2px; overflow:hidden; display:flex; background:rgba(255,255,255,.1); }
.fh-srow-bar i { display:block; height:100%; }
.fh-stats-actions { display:none; justify-content:center; margin-top:18px; pointer-events:auto; }
.fh-rematch-btn { padding:9px 22px; border-radius:8px; border:1px solid rgba(255,255,255,.24);
  background:linear-gradient(180deg, #f4cd72 0%, #d49824 100%); color:#171206;
  font-size:11.5px; font-weight:900; letter-spacing:.16em; cursor:pointer;
  box-shadow:0 6px 18px rgba(0,0,0,.45); }
.fh-rematch-btn:hover { filter:brightness(1.06); }

/* ---- top-right pause trigger & live settings drawer ---- */
.fh-pause-btn { position:absolute; top:26px; right:30px; transform-origin:top right;
  display:flex; align-items:center; gap:8px; height:36px; padding:0 12px;
  border-radius:9px; color:#eef2f8; cursor:pointer; pointer-events:auto;
  background:linear-gradient(180deg, rgba(25,31,46,.82) 0%, rgba(8,11,18,.92) 100%);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:0 8px 22px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.10);
  -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); }
.fh-pause-btn:hover { border-color:rgba(255,255,255,.3); }
.fh-pause-bars { display:flex; gap:3px; align-items:center; }
.fh-pause-bars i { display:block; width:3px; height:11px; border-radius:1px; background:#f4cd72; }
.fh-pause-lbl { font-size:10px; font-weight:800; letter-spacing:.14em; color:rgba(232,238,248,.88); }

.fh-drawer-wrap { position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  background:rgba(4,7,13,.62); -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
  pointer-events:auto; z-index:40; }
.fh-drawer-scale { transform-origin:center; }
.fh-drawer { width:820px; max-height:90vh; overflow-y:auto;
  border-radius:14px; padding:20px 24px 18px;
  background:linear-gradient(180deg, rgba(24,30,45,.96) 0%, rgba(9,12,19,.98) 100%);
  border:1px solid rgba(255,255,255,.16);
  box-shadow:0 28px 72px rgba(0,0,0,.78), inset 0 1px 0 rgba(255,255,255,.12); }
.fh-drawer-head { display:flex; align-items:baseline; justify-content:space-between;
  padding-bottom:12px; margin-bottom:14px; border-bottom:1px solid rgba(255,255,255,.10); }
.fh-drawer-title { font-size:16px; font-weight:900; letter-spacing:.14em; color:#ffffff; }
.fh-drawer-sub { font-size:10px; font-weight:700; letter-spacing:.2em; color:#f4cd72; }
.fh-drawer-grid { display:grid; grid-template-columns:1.05fr 1fr; gap:20px; align-items:start; }
@media (max-width:760px) { .fh-drawer-grid { grid-template-columns:1fr; gap:14px; } }
.fh-set-list { display:flex; flex-direction:column; gap:10px; }
.fh-set-row { display:grid; grid-template-columns:100px 1fr; align-items:center; gap:10px; }
.fh-set-lbl { font-size:10px; font-weight:800; letter-spacing:.15em; color:rgba(218,228,244,.72); }
.fh-seg-grp { display:flex; gap:5px; }
.fh-seg-btn { flex:1; padding:7px 5px; border-radius:6px; border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.05); color:rgba(226,234,248,.78);
  font-size:9.5px; font-weight:800; letter-spacing:.08em; cursor:pointer; white-space:nowrap; }
.fh-seg-btn:hover { background:rgba(255,255,255,.10); color:#ffffff; }
.fh-seg-btn.is-on { background:linear-gradient(180deg, rgba(244,205,114,.28), rgba(212,152,36,.22));
  border-color:rgba(244,205,114,.72); color:#f8df9b; }
.fh-vol-row { display:flex; align-items:center; gap:10px; }
.fh-vol-mute { padding:6px 10px; border-radius:6px; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.06); color:#eef2f8; font-size:10px; font-weight:800;
  letter-spacing:.10em; cursor:pointer; min-width:62px; }
.fh-vol-mute.is-muted { border-color:rgba(239,68,68,.55); color:#fca5a5; background:rgba(239,68,68,.15); }
.fh-vol-slider { flex:1; accent-color:#f4cd72; cursor:pointer; height:4px; }
.fh-vol-pct { width:36px; text-align:right; font-size:11px; font-weight:800; font-variant-numeric:tabular-nums;
  color:rgba(230,238,248,.85); }
.fh-ctrl-panel { padding:11px 13px; border-radius:9px; display:flex; flex-direction:column;
  background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.09); }
.fh-ctrl-head { display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding-bottom:8px; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,.08); }
.fh-ctrl-title { font-size:10px; font-weight:800; letter-spacing:.16em; color:rgba(218,228,244,.82); }
.fh-ctrl-actions { display:flex; align-items:center; gap:6px; }
.fh-tab-grp { display:flex; gap:4px; }
.fh-tab-btn { padding:4px 9px; border-radius:5px; border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.04); color:rgba(218,228,244,.72);
  font-size:9px; font-weight:800; letter-spacing:.12em; cursor:pointer; }
.fh-tab-btn:hover { background:rgba(255,255,255,.10); color:#ffffff; }
.fh-tab-btn.is-on { background:rgba(244,205,114,.22); border-color:rgba(244,205,114,.68); color:#f8df9b; }
.fh-reset-keys-btn { padding:4px 8px; border-radius:5px; border:1px solid rgba(255,255,255,.15);
  background:rgba(255,255,255,.05); color:rgba(226,234,248,.8);
  font-size:8.5px; font-weight:800; letter-spacing:.10em; cursor:pointer; }
.fh-reset-keys-btn:hover { border-color:rgba(244,205,114,.65); color:#f8df9b; background:rgba(244,205,114,.12); }
.fh-ctrl-status { display:flex; align-items:center; justify-content:space-between; gap:8px;
  min-height:22px; padding:3px 7px; margin-bottom:7px; border-radius:5px;
  background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06);
  font-size:8.5px; font-weight:800; letter-spacing:.09em; color:rgba(218,228,244,.65); }
.fh-ctrl-status.is-listening { background:rgba(244,205,114,.14); border-color:rgba(244,205,114,.55); color:#f8df9b; }
.fh-ctrl-status.is-ok { background:rgba(34,197,94,.12); border-color:rgba(74,222,128,.45); color:#86efac; }
.fh-ctrl-status.is-warn { background:rgba(239,68,68,.14); border-color:rgba(248,113,113,.50); color:#fca5a5; }
.fh-ctrl-rm-btn { padding:2px 7px; border-radius:4px; border:1px solid rgba(248,113,113,.55);
  background:rgba(239,68,68,.18); color:#fecaca; font-size:8px; font-weight:800;
  letter-spacing:.10em; cursor:pointer; flex:none; }
.fh-ctrl-rm-btn:hover { background:rgba(239,68,68,.32); color:#ffffff; }
.fh-ctrl-body { max-height:310px; overflow-y:auto; padding-right:4px;
  scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.22) transparent; }
.fh-ctrl-sec { margin-top:8px; }
.fh-ctrl-sec:first-of-type { margin-top:0; }
.fh-ctrl-sec-lbl { font-size:8.5px; font-weight:800; letter-spacing:.16em; color:#f4cd72; margin-bottom:4px; }
.fh-ctrl-rows { display:flex; flex-direction:column; gap:3px; }
.fh-ctrl-row { display:flex; align-items:center; justify-content:space-between; gap:8px;
  min-height:27px; padding:2px 4px; margin:0 -4px; border-radius:5px; font-size:10px; }
.fh-ctrl-row:hover { background:rgba(255,255,255,.04); }
.fh-ctrl-act { font-size:10px; font-weight:600; color:rgba(228,236,248,.88); letter-spacing:.03em; }
.fh-kcaps { display:flex; align-items:center; gap:3px; flex-wrap:wrap; justify-content:flex-end; }
.fh-kcap { padding:2px 5px 2.5px; border:1px solid rgba(255,255,255,.32); border-bottom-width:2px;
  border-radius:4px; background:rgba(255,255,255,.06); color:#f2f6fc;
  font-size:8.5px; font-weight:800; letter-spacing:.05em; line-height:1; white-space:nowrap; }
.fh-kcap-btn { min-width:26px; min-height:23px; padding:3px 7px; border:1px solid rgba(255,255,255,.34);
  border-bottom-width:2px; border-radius:5px; background:rgba(255,255,255,.08); color:#f4f7fc;
  font-size:9px; font-weight:800; letter-spacing:.05em; line-height:1; white-space:nowrap;
  cursor:pointer; font-variant-numeric:tabular-nums; }
.fh-kcap-btn:hover, .fh-kcap-btn:focus-visible { border-color:rgba(244,205,114,.88);
  background:rgba(244,205,114,.18); color:#ffffff; outline:none; }
.fh-kcap-btn.is-listening { border-color:#f4cd72; background:rgba(244,205,114,.30);
  color:#fff8dc; box-shadow:0 0 0 2px rgba(244,205,114,.28); }
.fh-kcap-add { min-width:23px; min-height:23px; padding:2px 6px; border:1px dashed rgba(255,255,255,.26);
  border-radius:5px; background:rgba(255,255,255,.03); color:rgba(226,234,248,.70);
  font-size:10px; font-weight:800; line-height:1; cursor:pointer; }
.fh-kcap-add:hover, .fh-kcap-add:focus-visible { border-color:rgba(244,205,114,.75);
  background:rgba(244,205,114,.12); color:#f8df9b; outline:none; }
.fh-kcap-add.is-listening { border-style:solid; border-color:#f4cd72; background:rgba(244,205,114,.28); color:#fff8dc; }
.fh-drawer-actions { display:flex; gap:10px; margin-top:16px; padding-top:13px;
  border-top:1px solid rgba(255,255,255,.10); }
.fh-btn-primary { flex:1; padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,.26);
  background:linear-gradient(180deg, #f4cd72 0%, #d49824 100%); color:#171206;
  font-size:11px; font-weight:900; letter-spacing:.16em; cursor:pointer; }
.fh-btn-secondary { padding:10px 16px; border-radius:8px; border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.06); color:#eef2f8;
  font-size:11px; font-weight:800; letter-spacing:.14em; cursor:pointer; }
.fh-btn-secondary:hover { background:rgba(255,255,255,.12); }

/* ---- live plate rating & bottom-right teammate ratings rail ---- */
.fh-plate-rat { padding:2.5px 6px 3px; border-radius:4px; font-size:11px; font-weight:900;
  font-variant-numeric:tabular-nums; background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.18);
  line-height:1; }
.fh-tm-wrap { position:absolute; right:30px; bottom:22px; width:218px; transform-origin:bottom right;
  border-radius:10px; overflow:hidden; pointer-events:auto;
  background:linear-gradient(180deg, rgba(20,26,40,.84) 0%, rgba(7,10,16,.92) 100%);
  border:1px solid rgba(255,255,255,.13);
  box-shadow:0 12px 28px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08); }
.fh-tm-head { width:100%; display:flex; align-items:center; justify-content:space-between; padding:7px 10px;
  background:rgba(255,255,255,.04); border:none; border-bottom:1px solid rgba(255,255,255,.09);
  color:#e2e8f0; font-size:9.5px; font-weight:900; letter-spacing:.14em; cursor:pointer; white-space:nowrap; }
.fh-tm-head:hover { background:rgba(255,255,255,.08); }
.fh-tm-list { display:flex; flex-direction:column; gap:1px; padding:4px 6px 6px; }
.fh-tm-row { display:grid; grid-template-columns:22px 1fr auto 32px; align-items:center; gap:5px;
  padding:2.5px 5px; border-radius:4px; font-size:10.5px; font-variant-numeric:tabular-nums; }
.fh-tm-row.is-pro { background:rgba(244,205,114,.14); }
.fh-tm-row.is-ctrl:not(.is-pro) { background:rgba(56,189,248,.13); }
.fh-tm-pos { font-size:8.5px; font-weight:800; color:rgba(218,228,244,.62); letter-spacing:.05em; }
.fh-tm-name { font-weight:700; color:#eef2f8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fh-tm-ga { font-size:9px; font-weight:800; color:#f4cd72; white-space:nowrap; }
.fh-tm-rat { font-weight:900; text-align:right; }

/* ---- 3D training drill HUD & finish overlay ---- */
.fh-drill-bar { position:absolute; top:26px; left:50%; transform:translateX(-50%); transform-origin:top center;
  display:none; align-items:center; gap:16px; padding:10px 18px; border-radius:11px;
  background:linear-gradient(180deg, rgba(22,28,42,.92) 0%, rgba(8,11,18,.96) 100%);
  border:1px solid rgba(244,205,114,.35);
  box-shadow:0 14px 36px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.09); }
.fh-drill-stat { display:flex; flex-direction:column; align-items:center; min-width:56px; font-variant-numeric:tabular-nums; }
.fh-drill-stat b { font-size:19px; font-weight:900; line-height:1.1; color:#ffffff; }
.fh-drill-stat span { font-size:8.5px; font-weight:800; letter-spacing:.14em; color:rgba(218,228,244,.66); }
.fh-drill-prompt { position:absolute; top:96px; left:50%; transform:translateX(-50%); transform-origin:top center;
  display:none; padding:5px 14px; border-radius:7px; background:rgba(8,11,18,.84);
  border:1px solid rgba(255,255,255,.13); font-size:10px; font-weight:800; letter-spacing:.13em;
  color:rgba(235,241,252,.9); white-space:nowrap; }
.fh-drill-end { position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  background:rgba(4,7,13,.62); pointer-events:auto; z-index:35; }
.fh-drill-card { width:440px; border-radius:14px; padding:24px 28px; text-align:center;
  background:linear-gradient(180deg, rgba(24,30,45,.96) 0%, rgba(9,12,19,.98) 100%);
  border:1px solid rgba(244,205,114,.42); box-shadow:0 24px 64px rgba(0,0,0,.75); }
`;

// ---- factory ---------------------------------------------------------------

export function createHud({ match, settings, input } = {}) {
  const host = document.getElementById('hud') || document.body;
  let H = { ...TEAMS.home };
  let A = { ...TEAMS.away };
  let curComp = VENUE.competition;
  let curMatchday = VENUE.matchday;
  let curVenue = `${VENUE.name} · ${VENUE.city}`;
  let curPlayerLock = false;
  let curProLabel = '';

  // Capture builds (?t=… screenshot mode) carry no input prompts at all.
  let CAPTURE = false;
  try {
    const q = new URLSearchParams(location.search);
    CAPTURE = (q.has('t') && q.get('live') !== '1') || q.get('nohint') === '1';
  } catch (e) { /* non-browser-ish host: keep the hint */ }

  const style = document.createElement('style');
  style.textContent = CSS;
  host.appendChild(style);

  const root = el('fh-root', host);

  /**
   * Procedural club crest: shield clip-path, diagonal kit-coloured field,
   * secondary band carrying the abbreviation (or a monogram at small sizes).
   */
  function buildCrest(parent, T, w, opts = {}) {
    const h = Math.round(w * 1.16);
    const rim = Math.max(1, Math.round(w * 0.05));
    const bandH = opts.bandH || Math.max(7, Math.round(h * 0.3));
    const drop = el('fh-crest-drop', parent);
    const crest = el('fh-crest', drop);
    crest.style.width = w + 'px';
    crest.style.height = h + 'px';
    // light shirts get a dark rim so the badge silhouette still reads on glass
    crest.style.background = luminance(T.primary) > 0.6 ? '#161d30' : 'rgba(238,243,252,.92)';
    const inner = el('fh-crest-inner', crest);
    inner.style.inset = rim + 'px';
    inner.style.background =
      `linear-gradient(118deg, ${shade(T.primary, 0.1)} 0%, ${T.primary} 49.5%, ` +
      `${shade(T.primary, -0.2)} 50.5%, ${shade(T.primary, -0.32)} 100%)`;
    const band = el('fh-crest-band', inner);
    band.style.background = T.secondary;
    band.style.height = bandH + 'px';
    band.style.top = `calc(50% - ${(bandH / 2).toFixed(1)}px)`;
    const abbr = el('fh-crest-abbr', band, 'span');
    abbr.style.fontSize = (opts.fontSize || Math.round(bandH * 0.62)) + 'px';
    abbr.style.color = luminance(T.secondary) > 0.6 ? '#10141c' : '#ffffff';
    // Both clubs abbreviate to an S-word, so a single-letter monogram reads as
    // the same badge twice. Always show the full abbreviation, just tighter.
    setText(abbr, T.abbr);
    if (opts.mono) abbr.style.fontSize = Math.max(6, Math.round(bandH * 0.46)) + 'px';
    return drop;
  }

  // ---- score bug ----
  const bugWrap = el('fh-bug-wrap', root);
  const bugMain = el('fh-bug-main fh-glass', bugWrap);
  const bugRow = el('fh-bug-row', bugMain);

  // competition mark (leads the package, like every real broadcast bug)
  const compSeg = el('fh-comp', bugRow);
  const compMark = el('fh-comp-mark', compSeg);
  const compMarkText = el('', compMark, 'b');
  setText(compMarkText, 'LF');
  el('', compMark, 'i');

  // team block: crest · abbr · score – score · abbr · crest
  const teamsSeg = el('fh-teams', bugRow);
  // one optical gap drives the whole internal rhythm: every neighbouring pair
  // (crest|tab, tab|score, score|dash, dash|score, score|tab, tab|crest) is G apart.
  const G = 10;
  const DASH_G = 8; // the en-dash carries ~2px of side bearing of its own

  const bugCrestSlotH = el('', teamsSeg);
  buildCrest(bugCrestSlotH, H, 26, { mono: true, bandH: 11, fontSize: 10 });

  const abbrH = el('fh-abbr', teamsSeg, 'span');
  abbrH.style.margin = `0 ${G}px`;
  const possH = el('fh-poss', abbrH, 'i');
  possH.style.background = POSS_COLOR.home;
  const abbrHB = el('', abbrH, 'b');
  setText(abbrHB, H.abbr);

  const scoreHEl = el('fh-score', teamsSeg, 'span');
  const dashEl = el('fh-dash', teamsSeg, 'span');
  dashEl.textContent = '–';
  dashEl.style.margin = `0 ${DASH_G}px`;
  const scoreAEl = el('fh-score', teamsSeg, 'span');

  const abbrA = el('fh-abbr', teamsSeg, 'span');
  abbrA.style.margin = `0 ${G}px`;
  const possA = el('fh-poss', abbrA, 'i');
  possA.style.background = POSS_COLOR.away;
  const abbrAB = el('', abbrA, 'b');
  setText(abbrAB, A.abbr);

  const bugCrestSlotA = el('', teamsSeg);
  buildCrest(bugCrestSlotA, A, 26, { mono: true, bandH: 11, fontSize: 10 });

  // clock block
  const clockSeg = el('fh-clockseg', bugRow);
  const halfEl = el('fh-halfpill', clockSeg, 'span');
  const clockEl = el('fh-clock', clockSeg, 'span');
  const addedEl = el('fh-added', clockSeg, 'span');

  // possession bar, welded into the bottom edge of the panel
  const possBar = el('fh-possbar', bugMain);
  const possFillH = el('', possBar, 'i');
  possFillH.style.background = `linear-gradient(180deg, ${shade(H.primary, 0.22)}, ${H.primary})`;
  const possFillA = el('', possBar, 'i');
  possFillA.style.background = `linear-gradient(180deg, ${shade(A.secondary, 0.4)}, ${shade(A.secondary, 0.14)})`;

  const subEl = el('fh-bug-sub', bugWrap);
  setText(subEl, `${VENUE.competition} · ${VENUE.city}`.toUpperCase());

  setText(scoreHEl, '0');
  setText(scoreAEl, '0');
  setText(clockEl, '00:00');
  setText(halfEl, '1ST');

  // ---- goal lower-third ----
  const bannerWrap = el('fh-banner-wrap', root);
  const bannerEl = el('fh-banner fh-glass', bannerWrap);
  const slabEl = el('fh-banner-slab', bannerEl);
  const goalCell = el('fh-goalcell', bannerEl);
  const bannerCrestSlot = el('', goalCell);
  let bannerCrest = null;
  const goalTxt = el('fh-goaltxt', goalCell, 'span');
  setText(goalTxt, 'GOAL');
  const bodyEl = el('fh-banner-body', bannerEl);
  const row1 = el('fh-banner-row', bodyEl);
  const numEl = el('fh-num', row1, 'span');
  const bScorerEl = el('fh-banner-scorer', row1, 'span');
  const row2 = el('fh-banner-row', bodyEl);
  const bTeamEl = el('fh-banner-team', row2, 'span');
  const minEl = el('fh-min', row2, 'span');

  // updated scoreline rides the tail of the plate
  const bScoreCell = el('fh-bscore', bannerEl);
  function bScoreRow(T) {
    const r = el('fh-bscore-row', bScoreCell);
    const tick = el('fh-bscore-tick', r, 'i');
    tick.style.background = `linear-gradient(180deg, ${shade(T.primary, 0.15)}, ${T.secondary})`;
    const ab = el('fh-bscore-ab', r, 'span');
    setText(ab, T.abbr);
    const n = el('fh-bscore-n', r, 'span');
    return { tick, ab, n };
  }
  const bScoreH = bScoreRow(H);
  const bScoreA = bScoreRow(A);

  const lineEl = el('fh-banner-line', bannerEl);
  const wipeEl = el('fh-banner-wipe', bannerEl);
  const sweepEl = el('fh-banner-sweep', bannerEl);

  // ---- kickoff card ----
  const cardWrap = el('fh-card-wrap', root);
  const cardScale = el('fh-card-scale', cardWrap);
  const cardEl = el('fh-card', cardScale);
  const topline = el('fh-card-topline', cardEl);
  topline.style.background =
    `linear-gradient(90deg, ${H.primary} 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0) 62%, ${A.secondary} 100%)`;
  const compRow = el('fh-card-comp', cardEl);
  const compRowSpan = el('', compRow, 'span');
  setText(compRowSpan, `${VENUE.competition} · ${VENUE.matchday}`.toUpperCase());

  const row = el('fh-card-row', cardEl);
  function makeCrestColumn(T) {
    const col = el('fh-card-team', row);
    const crestSlot = el('', col);
    buildCrest(crestSlot, T, 64, { bandH: 22, fontSize: 13 });
    const nameEl = el('fh-card-name', col);
    setText(nameEl, T.name.toUpperCase());
    const bar = el('fh-card-bar', col);
    bar.style.background = `linear-gradient(90deg, ${T.primary}, ${T.secondary})`;
    return { col, crestSlot, nameEl, bar };
  }
  const cardColH = makeCrestColumn(H);
  const vs = el('fh-card-vs', row);
  setText(el('fh-vs-big', vs), 'VS');
  setText(el('fh-vs-tag', vs), 'KICK-OFF');
  const cardColA = makeCrestColumn(A);

  const venueRow = el('fh-card-venue', cardEl);
  el('', venueRow, 'i');
  const venueRowSpan = el('', venueRow, 'span');
  setText(venueRowSpan, `${VENUE.name} · ${VENUE.city}`.toUpperCase());
  el('', venueRow, 'i');

  // ---- PES 2D pitch radar (bottom-center) ----
  const radarWrap = el('fh-radar-wrap', root);
  const radarCanvas = el('fh-radar-canvas', radarWrap, 'canvas');
  const RW = 172, RH = 112;
  radarCanvas.width = RW;
  radarCanvas.height = RH;
  const rCtx = radarCanvas.getContext('2d');
  // Pre-rendered static pitch surface so each 20Hz draw is one blit + 23 dots
  const pitchBg = document.createElement('canvas');
  pitchBg.width = RW;
  pitchBg.height = RH;
  {
    const g = pitchBg.getContext('2d');
    g.fillStyle = '#0d1c13';
    g.fillRect(0, 0, RW, RH);
    const pad = 6;
    const pw = RW - pad * 2, ph = RH - pad * 2;
    g.strokeStyle = 'rgba(255,255,255,0.34)';
    g.lineWidth = 1;
    g.strokeRect(pad, pad, pw, ph);
    // halfway line & center circle
    g.beginPath();
    g.moveTo(pad + pw / 2, pad);
    g.lineTo(pad + pw / 2, pad + ph);
    g.stroke();
    const cr = (PITCH.centerCircleR / PITCH.length) * pw;
    g.beginPath();
    g.arc(pad + pw / 2, pad + ph / 2, cr, 0, Math.PI * 2);
    g.stroke();
    // penalty areas
    const boxW = (PITCH.penAreaDepth / PITCH.length) * pw;
    const boxH = (PITCH.penAreaWidth / PITCH.width) * ph;
    g.strokeRect(pad, pad + (ph - boxH) / 2, boxW, boxH);
    g.strokeRect(pad + pw - boxW, pad + (ph - boxH) / 2, boxW, boxH);
    // 6-yard boxes
    const sW = (PITCH.sixBoxDepth / PITCH.length) * pw;
    const sH = (PITCH.sixBoxWidth / PITCH.width) * ph;
    g.strokeRect(pad, pad + (ph - sH) / 2, sW, sH);
    g.strokeRect(pad + pw - sW, pad + (ph - sH) / 2, sW, sH);
    // goal mouths
    const gH = (7.32 / PITCH.width) * ph;
    g.strokeRect(pad - 3, pad + (ph - gH) / 2, 3, gH);
    g.strokeRect(pad + pw, pad + (ph - gH) / 2, 3, gH);
  }

  // ---- controlled player plate + stamina (bottom-left) ----
  const plateWrap = el('fh-plate-wrap', root);
  const lockPill = el('', plateWrap);
  lockPill.style.cssText = 'display:none;margin-bottom:6px;padding:4px 9px;border-radius:6px;background:rgba(12,16,26,.88);border:1px solid rgba(244,205,114,.55);color:#f4cd72;font-size:9px;font-weight:900;letter-spacing:.14em;width:max-content;';
  const plateEl = el('fh-plate', plateWrap);
  const plateTop = el('fh-plate-top', plateEl);
  const plateNum = el('fh-plate-num', plateTop, 'span');
  const plateName = el('fh-plate-name', plateTop, 'span');
  const plateRole = el('fh-plate-role', plateTop, 'span');
  const plateCard = el('fh-plate-card', plateTop, 'span');
  const plateRating = el('fh-plate-rat', plateTop, 'span');
  plateRating.dataset.testid = 'hud-active-rating';
  setText(plateRating, '6.3');
  const plateTac = el('fh-plate-tac', plateTop, 'span');
  const stamRow = el('fh-stam-row', plateEl);
  setText(el('fh-stam-lbl', stamRow, 'span'), 'STM');
  const stamTrack = el('fh-stam-track', stamRow);
  const stamFill = el('fh-stam-fill', stamTrack);
  const stamCap = el('fh-stam-cap', stamTrack);
  setStyle(plateNum, 'background', H.primary);
  setStyle(plateNum, 'color', luminance(H.primary) > 0.6 ? '#10141c' : '#ffffff');

  // ---- live teammate ratings rail (bottom-right) ----
  const tmWrap = el('fh-tm-wrap', root);
  tmWrap.dataset.testid = 'hud-teammates-panel';
  const tmHead = el('fh-tm-head', tmWrap, 'button');
  tmHead.type = 'button';
  const tmHeadLabel = el('', tmHead, 'span');
  setText(tmHeadLabel, 'LIVE MATCH RATINGS');
  const tmToggleArrow = el('', tmHead, 'span');
  setText(tmToggleArrow, '▾');
  const tmList = el('fh-tm-list', tmWrap);
  let tmCollapsed = false;
  tmHead.addEventListener('click', () => {
    tmCollapsed = !tmCollapsed;
    setStyle(tmList, 'display', tmCollapsed ? 'none' : 'flex');
    setText(tmToggleArrow, tmCollapsed ? '▸' : '▾');
  });
  const tmRows = Array.from({ length: 11 }, (_, idx) => {
    const r = el('fh-tm-row', tmList);
    r.dataset.testid = `hud-tm-row-${idx}`;
    const pos = el('fh-tm-pos', r, 'span');
    const nm = el('fh-tm-name', r, 'span');
    const ga = el('fh-tm-ga', r, 'span');
    const rat = el('fh-tm-rat', r, 'span');
    rat.dataset.testid = `hud-tm-rat-${idx}`;
    return { row: r, pos, nm, ga, rat };
  });

  // ---- 3D training drill HUD & finish overlay ----
  const drillBar = el('fh-drill-bar', root);
  drillBar.dataset.testid = 'hud-drill-bar';
  const drillMetaCol = el('', drillBar);
  const drillTagEl = el('', drillMetaCol);
  drillTagEl.style.cssText = 'font-size:9px;font-weight:900;letter-spacing:.18em;color:#f4cd72;';
  setText(drillTagEl, '3D TRAINING PITCH');
  const drillTitleEl = el('', drillMetaCol);
  drillTitleEl.style.cssText = 'font-size:14px;font-weight:900;letter-spacing:.06em;color:#fff;white-space:nowrap;';
  const mkDrillStat = (lbl) => {
    const box = el('fh-drill-stat', drillBar);
    const val = el('', box, 'b');
    setText(val, '0');
    setText(el('', box, 'span'), lbl);
    return val;
  };
  const drillScoreVal = mkDrillStat('SCORE');
  drillScoreVal.dataset.testid = 'hud-drill-score';
  const drillStreakVal = mkDrillStat('STREAK');
  const drillGradeVal = mkDrillStat('GRADE');
  const drillTimeVal = mkDrillStat('TIME');
  drillTimeVal.dataset.testid = 'hud-drill-time';

  const drillPromptEl = el('fh-drill-prompt', root);
  const drillEndWrap = el('fh-drill-end', root);
  drillEndWrap.dataset.testid = 'hud-drill-end';
  const drillEndCard = el('fh-drill-card', drillEndWrap);
  const drillEndTag = el('', drillEndCard);
  drillEndTag.style.cssText = 'font-size:10px;font-weight:900;letter-spacing:.22em;color:#f4cd72;margin-bottom:6px;';
  setText(drillEndTag, 'DRILL SESSION COMPLETE');
  const drillEndTitle = el('', drillEndCard);
  drillEndTitle.style.cssText = 'font-size:20px;font-weight:900;color:#fff;margin-bottom:14px;';
  const drillEndScore = el('', drillEndCard);
  drillEndScore.style.cssText = 'font-size:44px;font-weight:950;font-variant-numeric:tabular-nums;color:#4ade80;line-height:1;';
  const drillEndMeta = el('', drillEndCard);
  drillEndMeta.style.cssText = 'font-size:12px;font-weight:700;color:rgba(218,228,244,.8);margin:10px 0 18px;';
  const drillEndActs = el('', drillEndCard);
  drillEndActs.style.cssText = 'display:flex;gap:10px;justify-content:center;';
  const drillCollectBtn = el('fh-rematch-btn', drillEndActs, 'button');
  drillCollectBtn.dataset.testid = 'btn-drill-collect';
  setText(drillCollectBtn, 'COLLECT XP & RETURN');
  drillCollectBtn.addEventListener('click', () => {
    if (settings && typeof settings.onDrillComplete === 'function' && match && match.getDrillReport) {
      settings.onDrillComplete(match.getDrillReport());
    }
  });
  const drillRetryBtn = el('fh-btn-secondary', drillEndActs, 'button');
  drillRetryBtn.dataset.testid = 'btn-drill-retry';
  setText(drillRetryBtn, 'RETRY DRILL');
  drillRetryBtn.addEventListener('click', () => {
    if (settings && typeof settings.onDrillRetry === 'function') {
      settings.onDrillRetry();
    }
  });

  // ---- referee & set-piece event toast (top-center) ----
  const toastWrap = el('fh-toast-wrap', root);
  const toastEl = el('fh-toast', toastWrap);
  const toastDot = el('fh-toast-dot', toastEl);
  const toastTitle = el('fh-toast-title', toastEl, 'span');
  const toastSub = el('fh-toast-sub', toastEl, 'span');

  // ---- halftime / fulltime match stats card ----
  const statsWrap = el('fh-stats-wrap', root);
  const statsScale = el('fh-stats-scale', statsWrap);
  const statsCard = el('fh-stats-card', statsScale);
  const statsHead = el('fh-stats-head', statsCard);
  const statsTag = el('fh-stats-tag', statsHead);
  const statsScoreline = el('fh-stats-scoreline', statsHead);
  const statsHomeTeam = el('fh-stats-team', statsScoreline, 'span');
  setText(statsHomeTeam, H.abbr);
  const statsScoreText = el('', statsScoreline, 'span');
  const statsAwayTeam = el('fh-stats-team', statsScoreline, 'span');
  setText(statsAwayTeam, A.abbr);
  const statsRowsEl = el('fh-stats-rows', statsCard);
  const STAT_DEFS = [
    ['POSSESSION', 'poss'],
    ['SHOTS', 'shots'],
    ['ON TARGET', 'onTarget'],
    ['CORNERS', 'corners'],
    ['TACKLES WON', 'tacklesWon'],
    ['FOULS', 'fouls'],
    ['OFFSIDES', 'offsides'],
    ['YELLOW / RED', 'cards'],
  ];
  const statRowRefs = STAT_DEFS.map(([label, key]) => {
    const r = el('fh-srow', statsRowsEl);
    const vH = el('fh-srow-val', r, 'span');
    const mid = el('fh-srow-mid', r);
    setText(el('fh-srow-lbl', mid, 'span'), label);
    const bar = el('fh-srow-bar', mid);
    const barH = el('', bar, 'i');
    const barA = el('', bar, 'i');
    barH.style.background = shade(H.primary, 0.15);
    barA.style.background = shade(A.primary, 0.08);
    const vA = el('fh-srow-val', r, 'span');
    return { key, vH, vA, barH, barA };
  });
  const statsActions = el('fh-stats-actions', statsCard);
  statsActions.style.gap = '10px';
  const continueMatchBtn = el('fh-rematch-btn', statsActions, 'button');
  continueMatchBtn.style.display = 'none';
  setText(continueMatchBtn, 'POST-MATCH REPORT');
  continueMatchBtn.addEventListener('click', () => {
    if (settings && typeof settings.onFulltimeContinue === 'function') {
      settings.onFulltimeContinue();
    }
  });
  const rematchBtn = el('fh-rematch-btn', statsActions, 'button');
  setText(rematchBtn, 'PLAY AGAIN');
  rematchBtn.addEventListener('click', () => {
    if (match && typeof match.restartMatch === 'function') {
      match.restartMatch();
      resetForMatch();
    }
  });

  // ---- kick power meter & contextual hint ----
  const pwrWrap = el('fh-pwr-wrap', root);
  const pwrCard = el('fh-pwr-card', pwrWrap);
  const pwrHead = el('fh-pwr-head', pwrCard);
  const pwrKind = el('fh-pwr-kind', pwrHead, 'span');
  const pwrPct = el('fh-pwr-pct', pwrHead, 'span');
  const pwrTrack = el('fh-pwr-track', pwrCard);
  const pwrSweet = el('fh-pwr-sweet', pwrTrack);
  const pwrFill = el('fh-pwr-fill', pwrTrack);
  setText(pwrKind, 'PASS');
  setText(pwrPct, '0%');
  const ctxHintEl = el('fh-ctx-wrap', root);

  const isCoarse = (() => {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  })();

  // ---- top-right pause trigger & live settings drawer ----
  let pauseBtn = null;
  if (!CAPTURE && settings) {
    pauseBtn = el('fh-pause-btn', root, 'button');
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('aria-label', 'Pause and Match Settings');
    const bars = el('fh-pause-bars', pauseBtn);
    el('', bars, 'i');
    el('', bars, 'i');
    setText(el('fh-pause-lbl', pauseBtn, 'span'), isCoarse ? 'PAUSE' : 'ESC');
    pauseBtn.addEventListener('click', () => settings.togglePaused());
  }

  const drawerWrap = el('fh-drawer-wrap', root);
  const drawerScale = el('fh-drawer-scale', drawerWrap);
  const drawerCard = el('fh-drawer', drawerScale);
  const drawerHead = el('fh-drawer-head', drawerCard);
  setText(el('fh-drawer-title', drawerHead), 'MATCH PAUSED');
  setText(el('fh-drawer-sub', drawerHead), 'SETTINGS, TACTICS & CONTROLS');
  const drawerGrid = el('fh-drawer-grid', drawerCard);
  const setList = el('fh-set-list', drawerGrid);

  const LEGEND_KB = [
    {
      sec: 'MOVEMENT & BALL',
      rows: [
        ['Move Player', ['WASD', 'ARROWS']],
        ['Sprint', ['SHIFT']],
        ['Shield / Finesse Shot', ['Z']],
      ],
    },
    {
      sec: 'PASS, SHOOT & DEFEND',
      rows: [
        ['Pass / Press & Tackle', ['X', 'N', 'J']],
        ['Through Ball / GK Rush', ['C', 'M', 'K']],
        ['Lob / Cross / Clear', ['V', 'B', 'L']],
        ['Shoot / Slide Tackle', ['SPC', 'ENT', 'I']],
        ['Fake Shot Cancel', ['SHOOT → PASS']],
        ['Chip Shot', ['Q + SHOOT']],
      ],
    },
    {
      sec: 'SKILLS, SWITCH & TACTICS',
      rows: [
        ['Switch Player / Trap', ['Q', 'TAB', 'T']],
        ['Skills (Step / Spin / Elas)', ['E', 'R', 'F', 'G']],
        ['Tactics & Pause', ['1–4', 'ESC', 'P']],
      ],
    },
  ];
  const LEGEND_PAD = [
    {
      sec: 'MOVEMENT & BALL',
      rows: [
        ['Move Player', ['L-STICK']],
        ['Sprint', ['ZR / RT']],
        ['Shield / Finesse Shot', ['RB / R1']],
      ],
    },
    {
      sec: 'PASS, SHOOT & DEFEND',
      rows: [
        ['Pass / Press & Tackle', ['B / ○']],
        ['Through Ball / GK Rush', ['Y / △']],
        ['Lob / Cross / Clear', ['X / □']],
        ['Shoot / Slide Tackle', ['A / ✕']],
        ['Fake Shot Cancel', ['A → B']],
        ['Chip Shot', ['ZL + A']],
      ],
    },
    {
      sec: 'SKILLS, SWITCH & TACTICS',
      rows: [
        ['Switch Player / Trap', ['LB', 'D-UP']],
        ['Skill Move / Mentality', ['R-STICK', 'D-L/R']],
        ['Tactics & Pause', ['MINUS', 'PLUS']],
      ],
    },
  ];

  const ctrlPanel = el('fh-ctrl-panel', drawerGrid);
  const ctrlHead = el('fh-ctrl-head', ctrlPanel);
  setText(el('fh-ctrl-title', ctrlHead), 'CONTROLS');
  const ctrlActions = el('fh-ctrl-actions', ctrlHead);
  const tabGrp = el('fh-tab-grp', ctrlActions);
  const tabKb = el('fh-tab-btn is-on', tabGrp, 'button');
  tabKb.type = 'button';
  setText(tabKb, 'KEYBOARD');
  const tabPad = el('fh-tab-btn', tabGrp, 'button');
  tabPad.type = 'button';
  setText(tabPad, 'GAMEPAD');
  let resetKeysBtn = null;
  if (input) {
    resetKeysBtn = el('fh-reset-keys-btn', ctrlActions, 'button');
    resetKeysBtn.type = 'button';
    setText(resetKeysBtn, 'RESET');
  }
  const ctrlStatus = el('fh-ctrl-status', ctrlPanel);
  const ctrlStatusTxt = el('', ctrlStatus, 'span');
  const ctrlBody = el('fh-ctrl-body', ctrlPanel);
  let legendMode = 'kb';
  let listening = null; // { actionId, label, slotIdx, isNew, removable }
  let statusFeedback = null; // { tone: ''|'ok'|'warn', text: string }
  let pendingReleaseTimer = null;
  let pendingReleaseCode = null;

  function setStatusBar(tone, text, showRemove = false) {
    ctrlStatus.classList.toggle('is-listening', tone === 'listening');
    ctrlStatus.classList.toggle('is-ok', tone === 'ok');
    ctrlStatus.classList.toggle('is-warn', tone === 'warn');
    setText(ctrlStatusTxt, text);
    const oldRm = ctrlStatus.querySelector('.fh-ctrl-rm-btn');
    if (oldRm) ctrlStatus.removeChild(oldRm);
    if (showRemove && listening && input) {
      const rmBtn = el('fh-ctrl-rm-btn', ctrlStatus, 'button');
      rmBtn.type = 'button';
      setText(rmBtn, 'REMOVE KEY');
      rmBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const target = listening;
        stopListen(false);
        if (target && input.removeBinding(target.actionId, target.slotIdx)) {
          statusFeedback = { tone: 'ok', text: `REMOVED ALT KEY FOR ${target.label.toUpperCase()}` };
        }
        renderLegend('kb');
      });
    }
  }

  function releaseCaptureAfterKey(code) {
    if (pendingReleaseTimer) { clearTimeout(pendingReleaseTimer); pendingReleaseTimer = null; }
    pendingReleaseCode = code || null;
    const onKeyUpRelease = (ev) => {
      if (pendingReleaseCode && ev.code !== pendingReleaseCode) return;
      window.removeEventListener('keyup', onKeyUpRelease, true);
      if (pendingReleaseTimer) { clearTimeout(pendingReleaseTimer); pendingReleaseTimer = null; }
      pendingReleaseCode = null;
      if (input && !listening) input.setCapture(false);
    };
    window.addEventListener('keyup', onKeyUpRelease, true);
    pendingReleaseTimer = setTimeout(() => {
      window.removeEventListener('keyup', onKeyUpRelease, true);
      pendingReleaseTimer = null;
      pendingReleaseCode = null;
      if (input && !listening) input.setCapture(false);
    }, 150);
  }

  function onCaptureKeydown(e) {
    if (!listening) return;
    const t = (e && e.target) || (typeof document !== 'undefined' ? document.activeElement : null);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.repeat) return;

    const cur = listening;
    if (e.code === 'Escape') {
      stopListen(true, 'Escape');
      statusFeedback = { tone: '', text: 'REBIND CANCELLED' };
      renderLegend('kb');
      return;
    }

    if ((e.code === 'Delete' || e.code === 'Backspace') && cur.removable && input) {
      stopListen(true, e.code);
      if (input.removeBinding(cur.actionId, cur.slotIdx)) {
        statusFeedback = { tone: 'ok', text: `REMOVED ALT KEY FOR ${cur.label.toUpperCase()}` };
      }
      renderLegend('kb');
      return;
    }

    if (!input) return;
    const res = input.setBinding(cur.actionId, cur.slotIdx, e.code);
    if (!res.ok) {
      if (res.reason === 'sole_key') {
        statusFeedback = {
          tone: 'warn',
          text: `${input.formatKeyCode(e.code)} IS SOLE KEY FOR ${res.conflictLabel.toUpperCase()}`,
        };
      } else {
        statusFeedback = { tone: 'warn', text: 'RESERVED SYSTEM KEY · PICK ANOTHER KEY' };
      }
      stopListen(true, e.code);
      renderLegend('kb');
      return;
    }

    stopListen(true, e.code);
    const keyLabel = input.formatKeyCode(e.code);
    if (res.swappedWith && res.swappedWith.length > 0) {
      const firstSwap = res.swappedWith[0];
      statusFeedback = {
        tone: 'ok',
        text: firstSwap.action === 'swapped'
          ? `${cur.label.toUpperCase()} → ${keyLabel} (SWAPPED WITH ${firstSwap.label.toUpperCase()})`
          : `${cur.label.toUpperCase()} → ${keyLabel} (MOVED FROM ${firstSwap.label.toUpperCase()})`,
      };
    } else {
      statusFeedback = { tone: 'ok', text: `BOUND ${cur.label.toUpperCase()} → ${keyLabel}` };
    }
    renderLegend('kb');
  }

  function stopListen(delayRelease = false, keyCode = null) {
    window.removeEventListener('keydown', onCaptureKeydown, true);
    const wasListening = !!listening;
    listening = null;
    if (input && wasListening) {
      if (delayRelease) releaseCaptureAfterKey(keyCode);
      else input.setCapture(false);
    }
  }

  function startListen(actionId, label, slotIdx, isNew, removable) {
    if (!input) return;
    if (pendingReleaseTimer) { clearTimeout(pendingReleaseTimer); pendingReleaseTimer = null; }
    stopListen(false);
    listening = { actionId, label, slotIdx, isNew, removable };
    statusFeedback = null;
    input.setCapture(true);
    window.addEventListener('keydown', onCaptureKeydown, true);
    renderLegend('kb');
  }

  function renderLegend(mode) {
    legendMode = mode === 'pad' ? 'pad' : 'kb';
    if (legendMode === 'pad' && listening) stopListen(false);
    tabKb.classList.toggle('is-on', legendMode === 'kb');
    tabPad.classList.toggle('is-on', legendMode === 'pad');
    tabKb.setAttribute('aria-pressed', String(legendMode === 'kb'));
    tabPad.setAttribute('aria-pressed', String(legendMode === 'pad'));
    if (resetKeysBtn) setStyle(resetKeysBtn, 'display', legendMode === 'kb' ? 'inline-block' : 'none');

    if (legendMode === 'pad') {
      setStyle(ctrlStatus, 'display', 'none');
    } else if (!input) {
      setStyle(ctrlStatus, 'display', 'none');
    } else {
      setStyle(ctrlStatus, 'display', 'flex');
      if (listening) {
        const hint = listening.removable
          ? `PRESS A KEY FOR ${listening.label.toUpperCase()} · ESC CANCEL`
          : `PRESS A KEY FOR ${listening.label.toUpperCase()} · ESC CANCEL`;
        setStatusBar('listening', hint, listening.removable);
      } else if (statusFeedback) {
        setStatusBar(statusFeedback.tone, statusFeedback.text, false);
      } else {
        setStatusBar('', 'CLICK ANY KEY SLOT TO REBIND · ESC CANCEL', false);
      }
    }

    while (ctrlBody.firstChild) ctrlBody.removeChild(ctrlBody.firstChild);

    if (legendMode === 'kb' && input) {
      const defs = input.getActionDefs();
      const binds = input.getKeybinds();
      const grouped = [];
      const groupMap = new Map();
      for (const def of defs) {
        let g = groupMap.get(def.group);
        if (!g) {
          g = { sec: def.group, defs: [] };
          groupMap.set(def.group, g);
          grouped.push(g);
        }
        g.defs.push(def);
      }
      for (const g of grouped) {
        const secEl = el('fh-ctrl-sec', ctrlBody);
        setText(el('fh-ctrl-sec-lbl', secEl), g.sec);
        const rowsEl = el('fh-ctrl-rows', secEl);
        for (const def of g.defs) {
          const rEl = el('fh-ctrl-row', rowsEl);
          setText(el('fh-ctrl-act', rEl, 'span'), def.label);
          const capsEl = el('fh-kcaps', rEl);
          const codes = binds[def.id] || [];
          codes.forEach((code, idx) => {
            const isActiveSlot = !!(listening && listening.actionId === def.id && !listening.isNew && listening.slotIdx === idx);
            const btn = el(isActiveSlot ? 'fh-kcap-btn is-listening' : 'fh-kcap-btn', capsEl, 'button');
            btn.type = 'button';
            btn.dataset.action = def.id;
            btn.dataset.slot = String(idx);
            setText(btn, isActiveSlot ? 'KEY…' : input.formatKeyCode(code));
            btn.setAttribute('aria-label', `Rebind ${def.label} slot ${idx + 1} (currently ${input.formatKeyCode(code)})`);
            btn.addEventListener('click', () => {
              if (isActiveSlot) {
                stopListen(false);
                statusFeedback = { tone: '', text: 'REBIND CANCELLED' };
                renderLegend('kb');
              } else {
                startListen(def.id, def.label, idx, false, codes.length > 1);
              }
            });
          });
          if (codes.length < 3) {
            const isAddSlot = !!(listening && listening.actionId === def.id && listening.isNew);
            const addBtn = el(isAddSlot ? 'fh-kcap-add is-listening' : 'fh-kcap-add', capsEl, 'button');
            addBtn.type = 'button';
            addBtn.dataset.action = def.id;
            addBtn.dataset.add = '1';
            setText(addBtn, isAddSlot ? '…' : '+');
            addBtn.setAttribute('aria-label', `Add alternate key for ${def.label}`);
            addBtn.addEventListener('click', () => {
              if (isAddSlot) {
                stopListen(false);
                statusFeedback = { tone: '', text: 'REBIND CANCELLED' };
                renderLegend('kb');
              } else {
                startListen(def.id, def.label, codes.length, true, false);
              }
            });
          }
        }
      }
      return;
    }

    const groups = legendMode === 'pad' ? LEGEND_PAD : LEGEND_KB;
    for (const g of groups) {
      const secEl = el('fh-ctrl-sec', ctrlBody);
      setText(el('fh-ctrl-sec-lbl', secEl), g.sec);
      const rowsEl = el('fh-ctrl-rows', secEl);
      for (const [act, keys] of g.rows) {
        const rEl = el('fh-ctrl-row', rowsEl);
        setText(el('fh-ctrl-act', rEl, 'span'), act);
        const capsEl = el('fh-kcaps', rEl);
        for (const k of keys) setText(el('fh-kcap', capsEl, 'span'), k);
      }
    }
  }

  tabKb.addEventListener('click', () => renderLegend('kb'));
  tabPad.addEventListener('click', () => renderLegend('pad'));
  if (resetKeysBtn && input) {
    resetKeysBtn.addEventListener('click', () => {
      stopListen(false);
      input.resetKeybinds();
      statusFeedback = { tone: 'ok', text: 'KEYS RESET TO DEFAULTS' };
      renderLegend('kb');
    });
  }
  renderLegend('kb');

  function addSegRow(label, options, getter, setter) {
    const rowEl = el('fh-set-row', setList);
    setText(el('fh-set-lbl', rowEl), label);
    const grp = el('fh-seg-grp', rowEl);
    const btns = options.map(([val, text]) => {
      const b = el('fh-seg-btn', grp, 'button');
      b.type = 'button';
      setText(b, text);
      b.addEventListener('click', () => {
        setter(val);
        syncDrawer();
      });
      return [val, b];
    });
    return () => {
      const cur = getter();
      for (const [val, b] of btns) b.classList.toggle('is-on', cur === val);
    };
  }

  const syncFns = [];
  if (settings) {
    syncFns.push(addSegRow('CAMERA', [
      ['broadcast', 'BROADCAST'], ['pro', 'PRO CAM'], ['closeup', 'CLOSEUP'], ['goal', 'GOAL'], ['stadium', 'STADIUM'], ['replay', 'REPLAY'],
    ], () => settings.getCameraMode(), (v) => settings.setCameraMode(v)));

    syncFns.push(addSegRow('DIFFICULTY', [
      ['casual', 'CASUAL'], ['pro', 'PRO'], ['legend', 'LEGEND'],
    ], () => settings.getDifficulty(), (v) => settings.setDifficulty(v)));

    syncFns.push(addSegRow('HALF LENGTH', [
      [2, '2 MIN'], [4, '4 MIN'], [6, '6 MIN'], [10, '10 MIN'],
    ], () => settings.getHalfMinutes(), (v) => settings.setHalfMinutes(v)));

    syncFns.push(addSegRow('TACTICS', [
      ['bal', 'BALANCED'], ['press', 'HIGH PRESS'], ['counter', 'COUNTER'], ['bus', 'LOW BLOCK'],
    ], () => settings.getTacticalPreset(), (v) => settings.setTacticalPreset(v)));

    const volRowEl = el('fh-set-row', setList);
    setText(el('fh-set-lbl', volRowEl), 'AUDIO');
    const volCtrl = el('fh-vol-row', volRowEl);
    const muteBtn = el('fh-vol-mute', volCtrl, 'button');
    muteBtn.type = 'button';
    const volSlider = el('fh-vol-slider', volCtrl, 'input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.step = '5';
    const volPct = el('fh-vol-pct', volCtrl, 'span');
    let prevVol = 0.85;
    muteBtn.addEventListener('click', () => {
      const cur = settings.getVolume();
      if (cur > 0.01) {
        prevVol = cur;
        settings.setVolume(0);
      } else {
        settings.setVolume(prevVol > 0.05 ? prevVol : 0.85);
      }
      syncDrawer();
    });
    volSlider.addEventListener('input', () => {
      const v = clamp(Number(volSlider.value) / 100, 0, 1);
      if (v > 0.05) prevVol = v;
      settings.setVolume(v);
      syncDrawer();
    });
    syncFns.push(() => {
      const v = settings.getVolume();
      const pct = Math.round(v * 100);
      volSlider.value = String(pct);
      setText(volPct, pct + '%');
      const muted = pct === 0;
      muteBtn.classList.toggle('is-muted', muted);
      setText(muteBtn, muted ? 'MUTED' : 'SOUND');
    });

    const dActs = el('fh-drawer-actions', drawerCard);
    const resumeBtn = el('fh-btn-primary', dActs, 'button');
    resumeBtn.type = 'button';
    setText(resumeBtn, 'RESUME MATCH');
    resumeBtn.addEventListener('click', () => settings.setPaused(false));

    const resetBtn = el('fh-btn-secondary', dActs, 'button');
    resetBtn.type = 'button';
    setText(resetBtn, 'RESTART MATCH');
    resetBtn.addEventListener('click', () => {
      settings.restartMatch();
      resetForMatch();
      syncDrawer();
    });

    const exitBtn = el('fh-btn-secondary', dActs, 'button');
    exitBtn.type = 'button';
    exitBtn.style.display = 'none';
    setText(exitBtn, 'EXIT TO HUB');
    exitBtn.addEventListener('click', () => {
      if (settings && typeof settings.onExitToMenu === 'function') {
        settings.setPaused(false);
        settings.onExitToMenu();
      }
    });
    syncFns.push(() => {
      const canExit = !!(settings && settings.onExitToMenu && (!settings.canExit || settings.canExit()));
      setStyle(exitBtn, 'display', canExit ? 'inline-block' : 'none');
      if (settings && typeof settings.getExitLabel === 'function') {
        setText(exitBtn, settings.getExitLabel());
      }
      if (settings && typeof settings.canRestartMatch === 'function') {
        setStyle(resetBtn, 'display', settings.canRestartMatch() ? 'inline-block' : 'none');
      }
    });
  }

  function syncDrawer() {
    for (const fn of syncFns) fn();
  }
  let wasPausedUI = false;

  // ---- controls hint ----
  let ctrlWrap = null;
  let padHinted = false;
  const CTRL_KB = [
    ['WASD', 'MOVE'], ['SHIFT', 'SPRINT'], ['X/N/J', 'PASS/PRESS'],
    ['C/M/K', 'THRU/GK'], ['V/B/L', 'LOB'], ['SPC/ENT/I', 'SHOOT'], ['SPC→X/J', 'FAKE SHOT'],
    ['Q/TAB', 'SWITCH'], ['Z', 'SHIELD/FINESSE'], ['1–4', 'TACTICS'], ['E/R/G', 'SKILL'], ['ESC', 'PAUSE'],
  ];
  const CTRL_PAD = [
    ['STICK', 'MOVE'], ['ZR', 'SPRINT'], ['B', 'PASS/PRESS'],
    ['Y', 'THRU/GK'], ['X', 'LOB'], ['A→B', 'FAKE SHOT'],
    ['RB', 'SHIELD/FINESSE'], ['ZL', 'CHIP'], ['D-UP', 'TRAP'], ['R-STICK', 'SKILL'], ['+', 'PAUSE'],
  ];
  function buildCtrlKbList() {
    if (!input) return CTRL_KB;
    const binds = input.getKeybinds();
    const first = (id) => input.formatKeyCode((binds[id] || [])[0] || '');
    const tacSpan = `${first('tacticBal')}–${first('tacticBus')}`;
    const skillSpan = `${first('skillStepover')}/${first('skillRoulette')}/${first('skillElastico')}`;
    return [
      [input.formatMoveSummary(), 'MOVE'],
      [input.formatActionKeys('sprint', 2), 'SPRINT'],
      [input.formatActionKeys('pass', 3), 'PASS/PRESS'],
      [input.formatActionKeys('through', 3), 'THRU/GK'],
      [input.formatActionKeys('lofted', 3), 'LOB'],
      [input.formatActionKeys('shoot', 3), 'SHOOT'],
      [`${first('shoot')}→${first('pass')}`, 'FAKE SHOT'],
      [input.formatActionKeys('switchPlayer', 2), 'SWITCH'],
      [input.formatActionKeys('modifier', 2), 'SHIELD/FINESSE'],
      [tacSpan, 'TACTICS'],
      [skillSpan, 'SKILL'],
      [`ESC/${first('pause')}`, 'PAUSE'],
    ];
  }
  function drawCtrl(list) {
    if (!ctrlWrap) return;
    while (ctrlWrap.firstChild) ctrlWrap.removeChild(ctrlWrap.firstChild);
    list.forEach(([key, label]) => {
      const item = el('fh-ctrl-item', ctrlWrap);
      setText(el('fh-key', item, 'span'), key);
      setText(el('fh-ctrl-label', item, 'span'), label);
    });
  }
  if (!CAPTURE && !isCoarse) {
    ctrlWrap = el('fh-ctrl-wrap', root);
    drawCtrl(buildCtrlKbList());
    window.addEventListener('gamepadconnected', () => {
      if (padHinted) return;
      padHinted = true;
      drawCtrl(CTRL_PAD);
    });
  }
  if (input && typeof input.onKeybindsChange === 'function') {
    input.onKeybindsChange(() => {
      if (!padHinted) drawCtrl(buildCtrlKbList());
      if (legendMode === 'kb') renderLegend('kb');
    });
  }

  // ---- responsive scale (crisp 1:1 at 1080p) ----
  let curScale = 0;
  let curDs = 0;
  function applyScale() {
    const vw = window.innerWidth || 1920;
    const vh = window.innerHeight || 1080;
    const s = clamp(vh / 1080, 0.46, 1.6);
    const dScale = Math.min(clamp(vh / 900, 0.56, 1.2), (vw * 0.94) / 820);
    if (Math.abs(s - curScale) < 0.001 && Math.abs(dScale - curDs) < 0.001) return;
    curScale = s;
    curDs = dScale;
    const t = `scale(${s.toFixed(4)})`;
    const ds = `scale(${dScale.toFixed(4)})`;
    setStyle(bugWrap, 'transform', t);
    setStyle(plateWrap, 'transform', t);
    setStyle(radarWrap, 'transform', `translateX(-50%) scale(${s.toFixed(4)})`);
    setStyle(toastWrap, 'transform', `translateX(-50%) scale(${s.toFixed(4)})`);
    setStyle(statsScale, 'transform', t);
    setStyle(drawerScale, 'transform', ds);
    if (pauseBtn) setStyle(pauseBtn, 'transform', t);
    if (ctrlWrap) setStyle(ctrlWrap, 'transform', t);
    setStyle(pwrWrap, 'transform', `translateX(-50%) scale(${s.toFixed(4)})`);
    setStyle(ctxHintEl, 'transform', `translateX(-50%) scale(${s.toFixed(4)})`);
    setStyle(bannerWrap, 'transform', t);
    setStyle(cardScale, 'transform', t);
    setStyle(tmWrap, 'transform', t);
    setStyle(drillBar, 'transform', `translateX(-50%) scale(${s.toFixed(4)})`);
    setStyle(drillPromptEl, 'transform', `translateX(-50%) scale(${s.toFixed(4)})`);
    setStyle(drillEndCard, 'transform', t);
  }
  window.addEventListener('resize', applyScale);
  applyScale();

  // ---- runtime state ---------------------------------------------------------

  const lastScore = { h: 0, a: 0 };
  let clockAcc = 1;      // force first paint
  let slowAcc = 1;       // 2 Hz bucket for the possession bar / added time
  let subFitted = false; // venue tab measured against the clock divider yet?

  // possession: live pill (who has it now) + match-share bar (accumulated)
  let possTarget = { home: 0, away: 0 };  // pill opacity targets
  let possOpa = { home: 0, away: 0 };
  let ballTime = { home: 0, away: 0 };
  let possMix = 0.5;

  // stoppage-time estimate, derived from what the HUD actually observed
  let goalsSeen = 0, stopsSeen = 0;

  // kickoff card timeline
  const CARD_FADE_START = 1.3, CARD_FADE_DUR = 0.7;
  let cardT = 0, cardDone = false;

  // goal banner timeline
  const B_IN = 0.5, B_HOLD = 3.5, B_OUT = 0.55, B_MAXHOLD = 8;
  const SLIDE_X = -880;
  let banner = null;      // { stage:'in'|'hold'|'out', t, holdT, outT, e, side }
  let pendingGoal = null; // { info, age } — from onEvent, awaiting score confirm
  let pulse = null;       // { el, t } — score digit pop

  // controls hint fade
  const HINT_HOLD = 5, HINT_FADE = 0.8, HINT_OPA = 0.5;
  let hintIdle = 0;
  if (ctrlWrap) {
    const poke = () => { hintIdle = 0; };
    window.addEventListener('keydown', poke, { passive: true });
    window.addEventListener('keyup', poke, { passive: true });
    window.addEventListener('mousedown', poke, { passive: true });
  }

  function triggerBanner(info, st) {
    const side = info.team === 'away' ? 'away' : 'home';
    if (banner && banner.side === side && banner.e < 3) return; // already showing this goal
    const T = side === 'away' ? A : H;
    // a near-white kit would bleach the slab (and swallow the crest on it), so
    // light-shirted sides run their slab in the secondary colour
    const light = luminance(T.primary) > 0.6;
    const slab = light ? T.secondary : T.primary;
    const trim = light ? T.primary : T.secondary;
    setStyle(slabEl, 'background',
      `linear-gradient(115deg, ${shade(slab, 0.14)} 0%, ${slab} 55%, ${shade(slab, -0.28)} 100%)`);
    setStyle(goalTxt, 'color', luminance(slab) > 0.6 ? '#10141c' : '#ffffff');
    setStyle(lineEl, 'background',
      `linear-gradient(90deg, rgba(0,0,0,0) 0%, ${shade(slab, 0.1)} 30%, ` +
      `${shade(trim, 0.32)} 74%, rgba(0,0,0,0) 100%)`);
    setStyle(wipeEl, 'background',
      `linear-gradient(100deg, ${shade(slab, 0.12)} 0%, ${shade(slab, -0.3)} 100%)`);

    // crest of the scoring side rides the coloured slab
    if (bannerCrest) bannerCrestSlot.removeChild(bannerCrest);
    bannerCrest = buildCrest(bannerCrestSlot, T, 34, { mono: true, bandH: 14, fontSize: 12 });

    setText(bScorerEl, (info.name || T.name).toUpperCase());
    if (typeof info.number === 'number') {
      setStyle(numEl, 'display', 'inline-block');
      setStyle(numEl, 'background', slab);
      setStyle(numEl, 'color', luminance(slab) > 0.6 ? '#10141c' : '#ffffff');
      setText(numEl, String(info.number));
    } else {
      setStyle(numEl, 'display', 'none');
    }
    setText(bTeamEl, T.name.toUpperCase());
    setText(minEl, Math.min(90 + 9, Math.floor((st.clockSec || 0) / 60) + 1) + '′');

    // updated scoreline, scorer's row highlighted
    const sc = st.score || { home: 0, away: 0 };
    setText(bScoreH.n, String(sc.home | 0));
    setText(bScoreA.n, String(sc.away | 0));
    for (const [k, r] of [['home', bScoreH], ['away', bScoreA]]) {
      const on = k === side;
      setStyle(r.ab, 'color', on ? 'rgba(246,249,255,.95)' : 'rgba(226,234,246,.5)');
      setStyle(r.n, 'color', on ? '#ffffff' : 'rgba(238,244,252,.55)');
    }

    banner = { stage: 'in', t: 0, holdT: 0, outT: 0, e: 0, side };
    setStyle(bannerWrap, 'display', 'block');
    setStyle(bannerEl, 'transform', `translateX(${SLIDE_X}px)`);
    setStyle(bannerEl, 'opacity', '0');
    setStyle(wipeEl, 'transform', 'translateX(0%)');
    pulse = { el: side === 'home' ? scoreHEl : scoreAEl, t: 0 };
  }

  function renderBanner(dt, phase) {
    if (!banner) return;
    const b = banner;
    b.e += dt;
    let x = 0, op = 1;
    if (b.stage === 'in') {
      b.t += dt;
      const p = Math.min(1, b.t / B_IN);
      x = lerp(SLIDE_X, 0, easeOutCubic(p));
      op = Math.min(1, p * 2.2);
      if (p >= 1) { b.stage = 'hold'; b.holdT = 0; }
    } else if (b.stage === 'hold') {
      b.holdT += dt;
      // hold at least 3.5 s; keep held while the match is still celebrating
      if ((b.holdT >= B_HOLD && phase !== 'goal') || b.holdT >= B_MAXHOLD) b.stage = 'out';
    } else if (b.stage === 'out') {
      b.outT += dt;
      const p = Math.min(1, b.outT / B_OUT);
      x = lerp(0, SLIDE_X, easeInCubic(p));
      op = clamp(1 - p * 1.3, 0, 1);
      if (p >= 1) {
        banner = null;
        setStyle(bannerWrap, 'display', 'none');
        return;
      }
    }
    setStyle(bannerEl, 'transform', `translateX(${x.toFixed(1)}px)`);
    setStyle(bannerEl, 'opacity', op.toFixed(3));
    // colour wipe travels off to the right, revealing the plate
    const wp = clamp((b.e - 0.22) / 0.4, 0, 1);
    setStyle(wipeEl, 'transform', `translateX(${(easeOutCubic(wp) * 101).toFixed(2)}%)`);
    setStyle(wipeEl, 'opacity', wp >= 1 ? '0' : '1');
    // glare sweep across the plate just behind the wipe
    const sp = clamp((b.e - 0.5) / 0.7, 0, 1);
    setStyle(sweepEl, 'transform', `translateX(${lerp(-190, 820, sp).toFixed(1)}px) skewX(-16deg)`);
    setStyle(sweepEl, 'opacity', (Math.sin(Math.PI * sp) * 0.4).toFixed(3));
  }

  function renderCard(dt, phase) {
    if (cardDone) return;
    cardT += dt;
    // respect the match: once the ball is in play, start dismissing immediately
    if (phase === 'play' && cardT < CARD_FADE_START) cardT = CARD_FADE_START;
    const fadeP = clamp((cardT - CARD_FADE_START) / CARD_FADE_DUR, 0, 1);
    if (fadeP >= 1) {
      cardDone = true;
      setStyle(cardWrap, 'display', 'none');
      return;
    }
    const inP = clamp(cardT / 0.45, 0, 1);
    const e = easeOutCubic(inP);
    setStyle(cardEl, 'transform', `translateY(${lerp(10, 0, e).toFixed(2)}px) scale(${lerp(0.962, 1, e).toFixed(4)})`);
    setStyle(cardEl, 'opacity', (Math.min(1, inP * 2.4) * (1 - fadeP)).toFixed(3));
  }

  // referee / event callout toast
  let toast = null; // { t, dur }
  function showToast(title, sub, dotColor, dur = 2.2) {
    setText(toastTitle, title);
    setText(toastSub, sub || '');
    setStyle(toastSub, 'display', sub ? 'inline' : 'none');
    setStyle(toastDot, 'background', dotColor || '#f4cd72');
    toast = { t: 0, dur };
    setStyle(toastWrap, 'display', 'block');
    setStyle(toastWrap, 'opacity', '1');
  }

  // radar 20Hz throttle
  let radarAcc = 1;
  const HALF_LEN = PITCH.length / 2;
  const HALF_WID = PITCH.width / 2;
  function drawRadar(radar, st) {
    if (!rCtx || !radar || !radar.players) return;
    rCtx.drawImage(pitchBg, 0, 0);
    const pad = 6;
    const pw = RW - pad * 2, ph = RH - pad * 2;
    // Screen-right is world -X, screen-up is world +Z (broadcast gantry on -Z)
    const toX = (wx) => pad + clamp((HALF_LEN - wx) / PITCH.length, 0, 1) * pw;
    const toY = (wz) => pad + clamp((HALF_WID - wz) / PITCH.width, 0, 1) * ph;

    if (st && st.offsideTrapT > 0 && typeof st.defLineHomeX === 'number') {
      const lx = toX(st.defLineHomeX);
      rCtx.save();
      rCtx.strokeStyle = '#38bdf8';
      rCtx.lineWidth = 1.4;
      rCtx.setLineDash([3, 3]);
      rCtx.beginPath();
      rCtx.moveTo(lx, pad + 1);
      rCtx.lineTo(lx, pad + ph - 1);
      rCtx.stroke();
      rCtx.restore();
    }

    for (const rp of radar.players) {
      if (rp.sentOff) continue;
      const x = toX(rp.x), y = toY(rp.z);
      const isCtrl = rp.id && rp.id === radar.controlledId;
      rCtx.beginPath();
      rCtx.arc(x, y, isCtrl ? 4.2 : 3.1, 0, Math.PI * 2);
      rCtx.fillStyle = rp.team === 'home' ? '#f8fafc' : '#ef4444';
      rCtx.fill();
      rCtx.lineWidth = isCtrl ? 1.6 : 1;
      rCtx.strokeStyle = isCtrl ? '#facc15' : '#0f172a';
      rCtx.stroke();
    }

    if (radar.referee) {
      const rx = toX(radar.referee.x), ry = toY(radar.referee.z);
      rCtx.beginPath();
      rCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
      rCtx.fillStyle = '#f59e0b';
      rCtx.fill();
      rCtx.lineWidth = 1;
      rCtx.strokeStyle = '#090d16';
      rCtx.stroke();
    }

    if (radar.ball) {
      const bx = toX(radar.ball.x), by = toY(radar.ball.z);
      rCtx.beginPath();
      rCtx.arc(bx, by, 2.8, 0, Math.PI * 2);
      rCtx.fillStyle = '#fde047';
      rCtx.fill();
      rCtx.lineWidth = 1;
      rCtx.strokeStyle = '#090d16';
      rCtx.stroke();
    }
  }

  function renderStatsOverlay(phase, st) {
    const show = phase === 'halftime' || phase === 'fulltime';
    setStyle(statsWrap, 'display', show ? 'flex' : 'none');
    if (!show) return;
    setText(statsTag, phase === 'halftime' ? 'HALF-TIME SUMMARY' : 'FULL-TIME MATCH STATS');
    const sc = st.score || { home: 0, away: 0 };
    setText(statsScoreText, `${sc.home | 0}  –  ${sc.away | 0}`);
    setStyle(statsActions, 'display', phase === 'fulltime' ? 'flex' : 'none');
    const showContinue = !!(settings && settings.hasFulltimeContinue && settings.hasFulltimeContinue());
    setStyle(continueMatchBtn, 'display', showContinue ? 'inline-block' : 'none');
    if (showContinue && typeof settings.getFulltimeLabel === 'function') {
      setText(continueMatchBtn, settings.getFulltimeLabel());
    }
    const hideRematch = !!(settings && settings.canRestartMatch && !settings.canRestartMatch());
    setStyle(rematchBtn, 'display', hideRematch ? 'none' : 'inline-block');

    const hs = (st.stats && st.stats.home) || {};
    const as = (st.stats && st.stats.away) || {};
    const totPoss = ballTime.home + ballTime.away;
    const possH = totPoss > 2 ? Math.round((ballTime.home / totPoss) * 100) : 50;
    const possA = 100 - possH;

    for (const row of statRowRefs) {
      let vhText = '0', vaText = '0', nh = 0, na = 0;
      if (row.key === 'poss') {
        nh = possH; na = possA;
        vhText = possH + '%'; vaText = possA + '%';
      } else if (row.key === 'cards') {
        nh = (hs.yellows | 0) + (hs.reds | 0);
        na = (as.yellows | 0) + (as.reds | 0);
        vhText = `${hs.yellows | 0} / ${hs.reds | 0}`;
        vaText = `${as.yellows | 0} / ${as.reds | 0}`;
      } else {
        nh = hs[row.key] | 0;
        na = as[row.key] | 0;
        vhText = String(nh);
        vaText = String(na);
      }
      setText(row.vH, vhText);
      setText(row.vA, vaText);
      const sum = nh + na;
      const pctH = sum > 0 ? clamp((nh / sum) * 100, 8, 92) : 50;
      setStyle(row.barH, 'width', pctH.toFixed(1) + '%');
      setStyle(row.barA, 'width', (100 - pctH).toFixed(1) + '%');
    }
  }

  // events from the match (goal may fire before or after the score increments)
  if (match && typeof match.onEvent === 'function') {
    try {
      match.onEvent((type, data) => {
        if (type === 'goal') { pendingGoal = { info: extractGoalInfo(data), age: 0 }; goalsSeen++; }
        else if (type === 'out' || type === 'save' || type === 'whistle') stopsSeen++;
        if (type === 'foul' && data) {
          const who = data.fouler ? `#${data.fouler.number} ${data.fouler.name}` : '';
          const imp = data.impulse ? ` · ${data.impulse} N·s` : '';
          showToast(data.penalty ? 'PENALTY KICK' : 'FREE KICK', who + imp, data.penalty ? '#ef4444' : '#f4cd72', 2.4);
        } else if (type === 'card' && data) {
          const isRed = data.card === 'red' || data.card === 'second_yellow';
          const who = data.player ? `#${data.player.number} ${data.player.name}` : '';
          const imp = data.impulse ? ` · ${data.impulse} N·s` : '';
          showToast(isRed ? 'RED CARD · SENT OFF' : 'YELLOW CARD', who + imp, isRed ? '#ef4444' : '#facc15', 2.8);
        } else if (type === 'corner' && data) {
          const tName = data.team === 'away' ? A.abbr : H.abbr;
          showToast('CORNER KICK', tName, '#38bdf8', 2.0);
        } else if (type === 'advantage') {
          showToast('ADVANTAGE · PLAY ON', '', '#22c55e', 1.7);
        } else if (type === 'offside' && data) {
          const who = data.player ? `#${data.player.number} ${data.player.name}` : '';
          showToast('OFFSIDE', who, '#fb923c', 2.1);
        } else if (type === 'offside_trap') {
          showToast('OFFSIDE TRAP', 'BACK LINE STEPPING UP', '#38bdf8', 1.6);
        } else if (type === 'tactics' && data) {
          const MAP = {
            bal: ['BALANCED', '#22c55e'],
            press: ['HIGH PRESS', '#ef4444'],
            counter: ['COUNTER ATTACK', '#f59e0b'],
            bus: ['LOW BLOCK', '#38bdf8'],
          };
          const [lbl, col] = MAP[data.preset] || MAP.bal;
          showToast('TACTICAL PRESET', lbl, col, 1.6);
        } else if (type === 'mentality' && data && !data.preset) {
          const m = data.mentality === 'att' ? 'ATTACKING' : data.mentality === 'def' ? 'DEFENSIVE' : 'BALANCED';
          const col = data.mentality === 'att' ? '#ef4444' : data.mentality === 'def' ? '#38bdf8' : '#22c55e';
          showToast('TEAM MENTALITY', m, col, 1.6);
        } else if (type === 'post') {
          showToast('WOODWORK!', 'OFF THE FRAME', '#f4cd72', 1.5);
        } else if (type === 'near_miss') {
          showToast('JUST WIDE!', '', '#e2e8f0', 1.2);
        } else if (type === 'call_pass') {
          showToast('CALLING FOR PASS', curProLabel || 'TO PRO', '#f4cd72', 0.9);
        } else if (type === 'forward_run' && data) {
          const who = data.runner ? `#${data.runner.number || ''} ${data.runner.name || ''}`.trim() : (data.name || 'ATTACKER');
          showToast('FORWARD RUN', who, '#38bdf8', 1.6);
        } else if (type === 'drill_hit' && data) {
          showToast(data.label || 'NICE!', `+${data.points || 0} PTS${data.streak > 1 ? ` · ${data.streak}x STREAK` : ''}`, '#4ade80', 1.15);
        }
      });
    } catch (e) { /* score-diff fallback below keeps the HUD functional */ }
  }

  function formatCtxHint(raw) {
    if (!raw || !input) return raw;
    const binds = input.getKeybinds();
    const first = (id) => input.formatKeyCode((binds[id] || [])[0] || '');
    const mv = input.formatMoveSummary();
    const ud = `${first('moveUp')}/${first('moveDown')}`;
    const pKey = input.formatActionKeys('pass', 2);
    const tKey = input.formatActionKeys('through', 2);
    const lKey = input.formatActionKeys('lofted', 2);
    const sKey = input.formatActionKeys('shoot', 2);
    if (raw.startsWith('GK HOLD')) return `GK HOLD · ${pKey} ROLL · ${tKey}/${lKey} THROW · ${sKey} PUNT`;
    if (raw.startsWith('PENALTY GK')) return `PENALTY GK · ${ud} CHOOSE DIVE LEFT / CENTER / RIGHT`;
    if (raw.startsWith('PENALTY ·')) return `PENALTY · AIM ${ud} · HOLD ${first('shoot')} TO SHOOT`;
    if (raw.startsWith('FREE KICK')) return `FREE KICK · AIM ${mv} · ${first('shoot')} CURL SHOT · ${first('pass')}/${first('lofted')} PASS`;
    if (raw.startsWith('CORNER')) return `CORNER · AIM ${mv} · ${first('pass')} SHORT · ${first('lofted')}/${first('shoot')} SWING CROSS`;
    if (raw.startsWith('THROW-IN')) return `THROW-IN · AIM ${mv} · ${first('pass')}/${first('through')}/${first('lofted')} THROW`;
    if (raw.startsWith('GOAL KICK')) return `GOAL KICK · AIM ${mv} · ${first('pass')} SHORT · ${first('lofted')}/${first('shoot')} LONG`;
    return raw;
  }

  function liveRatingHex(r) {
    if (r >= 8.5) return '#4ade80';
    if (r >= 7.2) return '#facc15';
    if (r >= 6.0) return '#e2e8f0';
    return '#f87171';
  }

  let tmAcc = 1; // 4 Hz refresh for live teammate ratings panel

  // ---- per-frame update ------------------------------------------------------

  function update(dt) {
    dt = clamp(dt || 0, 0, 0.25);
    const st = (match && match.state) || {};
    const phase = st.phase;
    const clockSec = st.clockSec || 0;
    const half = (st.half | 0) >= 2 ? 2 : 1;
    const isDrill = !!(st.drill && st.drill.active);

    setStyle(bugWrap, 'display', isDrill ? 'none' : 'block');
    setStyle(tmWrap, 'display', isDrill ? 'none' : 'block');
    setStyle(drillBar, 'display', isDrill ? 'flex' : 'none');
    setStyle(drillPromptEl, 'display', isDrill && !st.drill.finished ? 'block' : 'none');
    setStyle(drillEndWrap, 'display', isDrill && st.drill.finished ? 'flex' : 'none');

    if (isDrill) {
      setStyle(cardWrap, 'display', 'none');
      setText(drillTitleEl, st.drill.title || 'TRAINING DRILL');
      setText(drillScoreVal, String(st.drill.score | 0));
      setText(drillStreakVal, `${st.drill.streak | 0}x`);
      setText(drillGradeVal, String(st.drill.grade || 'Bronze').toUpperCase());
      const tSec = Math.ceil(Math.max(0, st.drill.timeLeft || 0));
      setText(drillTimeVal, `${tSec}s`);
      setStyle(drillTimeVal, 'color', tSec <= 10 ? '#f87171' : '#ffffff');
      setText(drillPromptEl, st.drill.prompt || '');
      if (st.drill.finished) {
        setText(drillEndTitle, st.drill.title || 'DRILL');
        setText(drillEndScore, `${st.drill.score | 0} PTS`);
        setText(drillEndMeta, `Grade: ${String(st.drill.grade || 'Bronze').toUpperCase()} · Reps Completed: ${st.drill.hits | 0} · Best Streak: ${st.drill.bestStreak | 0}x`);
      }
    }

    // one-shot: pin the venue tab's right edge onto the clock divider
    if (!subFitted && !isDrill) {
      const w = clockSeg.offsetLeft;
      if (w > 40) { subEl.style.width = (w + 1) + 'px'; subFitted = true; }
    }

    // clock + half pill at 2 Hz
    clockAcc += dt;
    if (clockAcc >= 0.5) {
      clockAcc %= 0.5;
      setText(clockEl, fmtClock(clockSec));
      setText(halfEl, half === 2 ? '2ND' : '1ST');
      // clock dims while the ball is not in play — a live indicator, not a REC dot
      const live = phase === 'play' || phase === 'out';
      setStyle(clockEl, 'opacity', live ? '1' : '0.62');
    }

    // score + goal detection (event payload enriches; score diff is the truth)
    if (!isDrill) {
      const sc = st.score || lastScore;
      const sh = sc.home | 0, sa = sc.away | 0;
      if (sh !== lastScore.h || sa !== lastScore.a) {
        const side = sh > lastScore.h ? 'home' : sa > lastScore.a ? 'away' : null;
        setText(scoreHEl, String(sh));
        setText(scoreAEl, String(sa));
        if (side) {
          const info = (pendingGoal && pendingGoal.age < 2) ? pendingGoal.info : {};
          if (info.team !== 'home' && info.team !== 'away') info.team = side;
          triggerBanner(info, st);
        }
        lastScore.h = sh; lastScore.a = sa;
        pendingGoal = null;
      } else if (pendingGoal) {
        pendingGoal.age += dt;
        if (pendingGoal.age > 0.35) { // event arrived but score never moved — trust it
          triggerBanner(pendingGoal.info, st);
          pendingGoal = null;
        }
      }
    }

    // possession: filled pill behind the abbreviation of the team on the ball
    const poss = (st.possession === 'home' || st.possession === 'away') ? st.possession : null;
    possTarget.home = poss === 'home' ? 1 : 0;
    possTarget.away = poss === 'away' ? 1 : 0;
    for (const side of ['home', 'away']) {
      const o = damp(possOpa[side], possTarget[side], 11, dt);
      possOpa[side] = o;
      setStyle(side === 'home' ? possH : possA, 'opacity', o.toFixed(2));
    }
    if (poss && phase === 'play' && !isDrill) ballTime[poss] += dt;

    // match possession share, on the bar under the panel (2 Hz DOM writes)
    slowAcc += dt;
    if (slowAcc >= 0.5) {
      const tot = ballTime.home + ballTime.away;
      possMix = damp(possMix, tot > 6 ? ballTime.home / tot : 0.5, 1.6, slowAcc);
      const pct = clamp(possMix, 0.1, 0.9) * 100; // always readable as a split
      setStyle(possFillH, 'width', pct.toFixed(1) + '%');
      setStyle(possFillA, 'width', (100 - pct).toFixed(1) + '%');

      // added time: shown in the closing minute of a half, like a fourth-official board
      const halfEnd = half === 2 ? 5400 : 2700;
      const show = !isDrill && clockSec > halfEnd - 60 && clockSec < halfEnd + 1 && phase !== 'kickoff';
      if (show) {
        setText(addedEl, '+' + clamp(1 + Math.floor(goalsSeen * 0.8 + stopsSeen * 0.05), 1, 9));
        setStyle(addedEl, 'display', 'inline-block');
      } else {
        setStyle(addedEl, 'display', 'none');
      }
      slowAcc = 0;
    }

    // score digit pop after a goal
    if (pulse) {
      pulse.t += dt;
      const p = Math.min(1, pulse.t / 0.5);
      if (p >= 1) {
        setStyle(pulse.el, 'transform', 'none');
        pulse = null;
      } else {
        setStyle(pulse.el, 'transform', `scale(${(1 + Math.sin(Math.PI * p) * 0.3).toFixed(3)})`);
      }
    }

    // controls hint: fades itself out after five idle seconds
    if (ctrlWrap) {
      hintIdle += dt;
      const o = HINT_OPA * (1 - clamp((hintIdle - HINT_HOLD) / HINT_FADE, 0, 1));
      setStyle(ctrlWrap, 'opacity', o.toFixed(3));
    }

    // kick power meter
    const kc = st.kickCharge;
    const pwrVisible = !!(kc && (kc.active || kc.fadeT > 0));
    if (pwrVisible) {
      const val = clamp(kc.active ? kc.value : kc.displayValue, 0, 1);
      const kind = (kc.active ? kc.kind : kc.displayKind) || 'pass';
      const LABELS = {
        shoot: 'SHOT POWER',
        lofted: 'LOB POWER',
        through: 'THROUGH POWER',
        gk_roll: 'GK ROLL',
        gk_throw: 'GK THROW',
        gk_punt: 'GK PUNT',
        corner: 'CORNER POWER',
        free_kick: 'FREE KICK POWER',
        penalty: 'PENALTY POWER',
        throw_in: 'THROW-IN POWER',
        goal_kick: 'GOAL KICK POWER',
      };
      const isShoot = kind === 'shoot';
      setStyle(pwrSweet, 'display', isShoot ? 'block' : 'none');
      const timedState = isShoot ? kc.timed : null;
      const baseLbl = LABELS[kind] || 'PASS POWER';
      setText(pwrKind, timedState === 'green' ? 'TIMED SHOT!' : baseLbl);
      setStyle(pwrCard, 'borderColor', timedState === 'green' ? 'rgba(74,222,128,.85)' : timedState === 'late' ? 'rgba(239,68,68,.75)' : 'rgba(255,255,255,.15)');
      setText(pwrPct, Math.round(val * 100) + '%');
      setStyle(pwrFill, 'transform', `scaleX(${val.toFixed(3)})`);
      const opa = kc.active ? 1 : clamp(kc.fadeT / 0.25, 0, 1);
      setStyle(pwrWrap, 'opacity', opa.toFixed(3));
    } else {
      setStyle(pwrWrap, 'opacity', '0');
    }

    // contextual GK / set-piece prompt when active and power bar is idle
    const hintStr = !CAPTURE && !pwrVisible && st.ctxHint ? formatCtxHint(st.ctxHint) : '';
    if (hintStr) {
      setText(ctxHintEl, hintStr);
      setStyle(ctxHintEl, 'opacity', '1');
    } else {
      setStyle(ctxHintEl, 'opacity', '0');
    }

    // controlled player plate + stamina + live 0.0-10.0 rating
    const ap = st.activePlayer;
    if (ap && ap.name) {
      setText(plateNum, String(ap.number || ''));
      setText(plateName, String(ap.name).toUpperCase());
      setText(plateRole, String(ap.role || 'MF'));
      setStyle(plateCard, 'display', (ap.yellowCards | 0) > 0 ? 'inline-block' : 'none');

      const rVal = typeof ap.rating === 'number' ? ap.rating : 6.3;
      setText(plateRating, rVal.toFixed(1));
      setStyle(plateRating, 'color', liveRatingHex(rVal));
      setStyle(plateRating, 'display', isDrill ? 'none' : 'inline-block');

      const pre = st.tacticalPreset || (st.mentality === 'att' ? 'press' : st.mentality === 'def' ? 'bus' : 'bal');
      const TAC_UI = {
        bal: ['BAL', 'rgba(34,197,94,.22)', '#86efac'],
        press: ['PRESS', 'rgba(239,68,68,.26)', '#fca5a5'],
        counter: ['CTR', 'rgba(245,158,11,.26)', '#fcd34d'],
        bus: ['BUS', 'rgba(56,189,248,.24)', '#7dd3fc'],
      };
      const [mLbl, mBg, mCol] = TAC_UI[pre] || TAC_UI.bal;
      setText(plateTac, mLbl);
      setStyle(plateTac, 'background', mBg);
      setStyle(plateTac, 'color', mCol);

      const stm = clamp(ap.stamina != null ? ap.stamina : 1, 0, 1);
      const stmCap = clamp(ap.staminaCap != null ? ap.staminaCap : 1, 0, 1);
      setStyle(stamFill, 'transform', `scaleX(${stm.toFixed(3)})`);
      const stmBg = stm < 0.28
        ? 'linear-gradient(90deg, #dc2626, #ef4444)'
        : stm < 0.55
          ? 'linear-gradient(90deg, #ca8a04, #facc15)'
          : 'linear-gradient(90deg, #16a34a, #4ade80)';
      setStyle(stamFill, 'background', stmBg);
      setStyle(stamCap, 'width', ((1 - stmCap) * 100).toFixed(1) + '%');
    }

    // Live Teammate Match Ratings rail (4 Hz)
    tmAcc += dt;
    if (!isDrill && tmAcc >= 0.25 && Array.isArray(st.teammates)) {
      tmAcc %= 0.25;
      for (let i = 0; i < tmRows.length; i++) {
        const ref = tmRows[i];
        const t = st.teammates[i];
        if (!t || !t.name || !t.active) {
          setStyle(ref.row, 'display', 'none');
          continue;
        }
        setStyle(ref.row, 'display', 'grid');
        ref.row.classList.toggle('is-pro', !!t.isPro);
        ref.row.classList.toggle('is-ctrl', !!t.isControlled);
        setText(ref.pos, String(t.role || 'MF'));
        setText(ref.nm, `${t.isPro ? '★ ' : ''}${t.name}`);
        const gaTxt = (t.goals || t.assists)
          ? `${t.goals ? t.goals + 'G' : ''}${t.goals && t.assists ? ' ' : ''}${t.assists ? t.assists + 'A' : ''}`
          : '';
        setText(ref.ga, gaTxt);
        const tr = typeof t.rating === 'number' ? t.rating : 6.3;
        setText(ref.rat, tr.toFixed(1));
        setStyle(ref.rat, 'color', liveRatingHex(tr));
      }
    }

    // 2D pitch radar (20 Hz, forced immediately while offside trap is active)
    radarAcc += dt;
    if (radarAcc >= 0.05 || (st.offsideTrapT > 0 && dt === 0)) {
      radarAcc %= 0.05;
      drawRadar(st.radar, st);
    }

    // referee / tactical callout toast
    if (toast) {
      toast.t += dt;
      if (toast.t >= toast.dur) {
        toast = null;
        setStyle(toastWrap, 'display', 'none');
      } else {
        const rem = toast.dur - toast.t;
        const opa = rem < 0.3 ? clamp(rem / 0.3, 0, 1) : clamp(toast.t / 0.14, 0, 1);
        setStyle(toastWrap, 'opacity', opa.toFixed(3));
      }
    }

    // Pause & Settings Drawer sync
    const isPausedNow = !!(settings && settings.isPaused());
    if (isPausedNow !== wasPausedUI) {
      wasPausedUI = isPausedNow;
      setStyle(drawerWrap, 'display', isPausedNow ? 'flex' : 'none');
      if (isPausedNow) {
        statusFeedback = null;
        syncDrawer();
        renderLegend(legendMode);
      } else {
        stopListen(false);
      }
    } else if (isPausedNow) {
      syncDrawer();
    }

    if (!isDrill) {
      renderStatsOverlay(phase, st);
      renderCard(dt, phase);
    } else {
      setStyle(statsWrap, 'display', 'none');
    }
    renderBanner(dt, phase);
  }

  function resetForMatch() {
    lastScore.h = 0;
    lastScore.a = 0;
    tmAcc = 1;
    setText(scoreHEl, '0');
    setText(scoreAEl, '0');
    setText(clockEl, '00:00');
    setText(halfEl, '1ST');
    clockAcc = 1;
    slowAcc = 1;
    ballTime.home = 0;
    ballTime.away = 0;
    possMix = 0.5;
    goalsSeen = 0;
    stopsSeen = 0;
    cardT = 0;
    cardDone = false;
    setStyle(cardWrap, 'display', 'flex');
    banner = null;
    pendingGoal = null;
    setStyle(bannerWrap, 'display', 'none');
    setStyle(statsWrap, 'display', 'none');
  }

  function setDrillMode(cfg) {
    resetForMatch();
    cardDone = true;
    setStyle(cardWrap, 'display', 'none');
    setStyle(bugWrap, 'display', 'none');
    setStyle(tmWrap, 'display', 'none');
    setStyle(drillBar, 'display', 'flex');
    setText(drillTitleEl, (cfg && cfg.title) || 'TRAINING DRILL');
  }

  function setMatchTeams({ homeTeam, awayTeam, homeKit, awayKit, competition, matchday, venue, playerLock, proName } = {}) {
    if (homeTeam) {
      H = {
        name: homeTeam.name || H.name,
        abbr: homeTeam.abbr || H.abbr,
        primary: (homeKit && homeKit.primary) || homeTeam.primary || H.primary,
        secondary: (homeKit && homeKit.secondary) || homeTeam.secondary || H.secondary,
      };
    }
    if (awayTeam) {
      A = {
        name: awayTeam.name || A.name,
        abbr: awayTeam.abbr || A.abbr,
        primary: (awayKit && awayKit.primary) || awayTeam.primary || A.primary,
        secondary: (awayKit && awayKit.secondary) || awayTeam.secondary || A.secondary,
      };
    }
    curComp = competition || curComp;
    curMatchday = matchday || curMatchday;
    curVenue = venue || (homeTeam ? `${homeTeam.short || homeTeam.name} Arena` : curVenue);
    curPlayerLock = !!playerLock;
    curProLabel = proName || '';

    setText(compMarkText, compInitials(curComp));
    while (bugCrestSlotH.firstChild) bugCrestSlotH.removeChild(bugCrestSlotH.firstChild);
    buildCrest(bugCrestSlotH, H, 26, { mono: true, bandH: 11, fontSize: 10 });
    while (bugCrestSlotA.firstChild) bugCrestSlotA.removeChild(bugCrestSlotA.firstChild);
    buildCrest(bugCrestSlotA, A, 26, { mono: true, bandH: 11, fontSize: 10 });
    setText(abbrHB, H.abbr);
    setText(abbrAB, A.abbr);
    POSS_COLOR.home = shade(H.primary, 0.04);
    POSS_COLOR.away = shade(luminance(A.primary) > 0.68 ? A.secondary : A.primary, 0.08);
    possH.style.background = POSS_COLOR.home;
    possA.style.background = POSS_COLOR.away;
    possFillH.style.background = `linear-gradient(180deg, ${shade(H.primary, 0.22)}, ${H.primary})`;
    possFillA.style.background = `linear-gradient(180deg, ${shade(A.secondary, 0.4)}, ${shade(A.secondary, 0.14)})`;
    setText(subEl, `${curComp} · ${curVenue}`.toUpperCase());
    subFitted = false;

    bScoreH.tick.style.background = `linear-gradient(180deg, ${shade(H.primary, 0.15)}, ${H.secondary})`;
    setText(bScoreH.ab, H.abbr);
    bScoreA.tick.style.background = `linear-gradient(180deg, ${shade(A.primary, 0.15)}, ${A.secondary})`;
    setText(bScoreA.ab, A.abbr);

    topline.style.background =
      `linear-gradient(90deg, ${H.primary} 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0) 62%, ${A.secondary} 100%)`;
    setText(compRowSpan, `${curComp} · ${curMatchday}`.toUpperCase());
    setText(venueRowSpan, curVenue.toUpperCase());

    while (cardColH.crestSlot.firstChild) cardColH.crestSlot.removeChild(cardColH.crestSlot.firstChild);
    buildCrest(cardColH.crestSlot, H, 64, { bandH: 22, fontSize: 13 });
    setText(cardColH.nameEl, H.name.toUpperCase());
    cardColH.bar.style.background = `linear-gradient(90deg, ${H.primary}, ${H.secondary})`;

    while (cardColA.crestSlot.firstChild) cardColA.crestSlot.removeChild(cardColA.crestSlot.firstChild);
    buildCrest(cardColA.crestSlot, A, 64, { bandH: 22, fontSize: 13 });
    setText(cardColA.nameEl, A.name.toUpperCase());
    cardColA.bar.style.background = `linear-gradient(90deg, ${A.primary}, ${A.secondary})`;

    setStyle(plateNum, 'background', H.primary);
    setStyle(plateNum, 'color', luminance(H.primary) > 0.6 ? '#10141c' : '#ffffff');
    setText(statsHomeTeam, H.abbr);
    setText(statsAwayTeam, A.abbr);
    for (const rowRef of statRowRefs) {
      rowRef.barH.style.background = shade(H.primary, 0.15);
      rowRef.barA.style.background = shade(luminance(A.primary) > 0.68 ? A.secondary : A.primary, 0.08);
    }

    if (curPlayerLock && !CAPTURE && input) {
      const pKey = input.formatActionKeys('pass', 1);
      const lKey = input.formatActionKeys('lofted', 1);
      setText(lockPill, `PRO LOCK · ${proName ? proName.toUpperCase() : 'MY PRO'} · ${pKey}/${lKey} CALL PASS`);
      setStyle(lockPill, 'display', 'block');
    } else {
      setStyle(lockPill, 'display', 'none');
    }
    resetForMatch();
  }

  function setVisible(visible) {
    setStyle(root, 'display', visible ? 'block' : 'none');
  }

  return { update, setMatchTeams, setDrillMode, resetForMatch, setVisible };
}
