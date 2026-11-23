// ---------------------------------------------------------------------------
// src/careerUi.js — Dark broadcast Start Menu, Quick Match, Create My Player,
// Multi-Season Career Hub (Home/Next Match, My Player, Competitions),
// Post-Match Rating & Summary, and Season Review & Awards overlays.
// Zero external CSS dependencies; pure DOM styled to match src/hud.js.
// ---------------------------------------------------------------------------

import {
  TACTICAL_STYLES,
  FORMATIONS,
  FORMATION_IDS,
  LEAGUES,
  POSITIONS,
  CLUBS,
  NATIONS,
  CLASSIC_PRESET_CLUBS,
  getTeamById,
  getClubsByLeague,
  getFormation,
  isSlotMismatch,
  buildOrderedSquad,
  pickStartingXI,
  resolveMatchKits,
  renderJerseySvg,
  HAIR_PALETTE,
  SKIN_PALETTE,
  HAIR_STYLE_OPTIONS,
  BOOT_OPTIONS,
} from './careerDb.js';

import {
  loadCareer,
  saveCareer,
  createNewCareer,
  computeOvr,
  presetAttrsForTier,
  getCalendarDate,
  getNextUserFixture,
  getMatchSquadForPreMatch,
  getTeamLineupWithPro,
  getStandings,
  getClubRank,
  getLeaders,
  simCurrentMatchday,
  simToSeasonEnd,
  advanceToNextSeason,
  editFixtureScore,
  quickEditPro,
  generateAiReport,
  findNationForCountry,
  TRAINING_DRILLS,
  getTrainingStatus,
  applyTrainingSession,
  computeWorldNtOpinion,
  setNationalTeamSelection,
  executeGlobalTransfer,
  estimatePlayerValueM,
} from './careerEngine.js';

const UI_CSS = `
.fc-root { position:fixed; inset:0; z-index:80; color:#eef2f8; display:none;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Segoe UI",Inter,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased; background:radial-gradient(120% 110% at 50% 0%, rgba(18,24,38,.86) 0%, rgba(7,10,16,.94) 70%);
  -webkit-backdrop-filter:blur(10px) saturate(1.25); backdrop-filter:blur(10px) saturate(1.25);
  overflow-y:auto; pointer-events:auto; }
.fc-root * { box-sizing:border-box; }
.fc-num { font-variant-numeric:tabular-nums; }
.fc-shell { max-width:1240px; margin:0 auto; padding:22px 26px 28px; min-height:100%; display:flex; flex-direction:column; gap:16px; }
.fc-card { background:linear-gradient(180deg, rgba(24,30,46,.90) 0%, rgba(10,14,22,.95) 100%);
  border:1px solid rgba(255,255,255,.12); border-radius:14px; padding:16px 18px;
  box-shadow:0 16px 44px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08); }
.fc-gold { color:#f4cd72; }
.fc-muted { color:rgba(218,228,244,.68); }
.fc-label { font-size:10px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; color:rgba(218,228,244,.66); }
.fc-title { font-size:20px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; color:#ffffff; margin:0; }
.fc-btn { padding:9px 15px; border-radius:8px; border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.06); color:#eef2f8; font-size:11px; font-weight:800;
  letter-spacing:.12em; text-transform:uppercase; cursor:pointer; transition:all .12s ease; white-space:nowrap; }
.fc-btn:hover { background:rgba(255,255,255,.13); border-color:rgba(255,255,255,.30); }
.fc-btn:disabled { opacity:.42; cursor:not-allowed; }
.fc-btn-gold { background:linear-gradient(180deg, #f4cd72 0%, #d49824 100%); color:#171206;
  border-color:rgba(255,255,255,.32); box-shadow:0 6px 20px rgba(0,0,0,.42); }
.fc-btn-gold:hover { filter:brightness(1.07); }
.fc-btn-sm { padding:5px 10px; font-size:10px; border-radius:6px; }
.fc-btn-pill { padding:6px 12px; border-radius:7px; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.04); color:rgba(226,234,248,.82); font-size:10.5px; font-weight:800;
  letter-spacing:.09em; cursor:pointer; white-space:nowrap; }
.fc-btn-pill.is-on { background:rgba(244,205,114,.22); border-color:rgba(244,205,114,.72); color:#f8df9b; }
.fc-input, .fc-select { width:100%; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,.22);
  background:rgba(8,11,18,.96); color:#f4f7fc; font-size:13.5px; font-weight:600; outline:none;
  -webkit-user-select:text !important; user-select:text !important; touch-action:manipulation !important; pointer-events:auto !important; }
.fc-input { cursor:text; -webkit-touch-callout:default; }
.fc-select { cursor:pointer; }
.fc-input:focus, .fc-select:focus { border-color:#f4cd72; box-shadow:0 0 0 2px rgba(244,205,114,.3); background:#0c111e; }
.fc-input::placeholder { color:rgba(218,228,244,.45); }
.fc-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.fc-grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.fc-grid-12 { display:grid; grid-template-columns:1.15fr .85fr; gap:16px; }
@media (max-width:960px) { .fc-grid-2, .fc-grid-12 { grid-template-columns:1fr; } }

/* Start Menu */
.fc-start-wrap { max-width:920px; margin:auto; width:100%; display:grid; grid-template-columns:1.1fr .9fr; gap:24px; align-items:center; }
@media (max-width:820px) { .fc-start-wrap { grid-template-columns:1fr; } }
.fc-brand-tag { display:inline-block; padding:4px 10px; border-radius:5px; border:1px solid rgba(244,205,114,.45);
  background:rgba(244,205,114,.12); color:#f4cd72; font-size:10px; font-weight:900; letter-spacing:.22em; }
.fc-brand-h1 { font-size:52px; font-weight:950; letter-spacing:.06em; line-height:1; margin:12px 0 8px;
  background:linear-gradient(180deg, #ffffff 30%, #cbd5e1 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.fc-menu-btns { display:flex; flex-direction:column; gap:11px; }
.fc-menu-btn { width:100%; padding:16px 18px; border-radius:12px; border:1px solid rgba(255,255,255,.16);
  background:linear-gradient(180deg, rgba(28,35,54,.88), rgba(12,16,26,.94)); color:#eef2f8;
  display:flex; align-items:center; justify-content:space-between; text-align:left; cursor:pointer; }
.fc-menu-btn:hover { border-color:rgba(244,205,114,.7); transform:translateY(-1px); }
.fc-menu-btn.is-primary { background:linear-gradient(135deg, rgba(244,205,114,.25), rgba(18,24,38,.95)); border-color:rgba(244,205,114,.65); }
.fc-menu-btn b { display:block; font-size:15px; font-weight:900; letter-spacing:.09em; color:#ffffff; }
.fc-menu-btn span { display:block; font-size:11px; color:rgba(218,228,244,.7); margin-top:3px; }

/* Hub Topbar */
.fc-topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;
  padding:12px 16px; border-radius:12px; background:rgba(14,19,30,.92); border:1px solid rgba(255,255,255,.12); }
.fc-tabs { display:flex; gap:6px; flex-wrap:wrap; }
.fc-tab { padding:8px 13px; border-radius:8px; border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.04); color:rgba(226,234,248,.78); font-size:10.5px; font-weight:900;
  letter-spacing:.11em; cursor:pointer; white-space:nowrap; }
.fc-tab.is-on { background:linear-gradient(180deg, #f4cd72, #d49824); color:#171206; border-color:rgba(255,255,255,.3); }

/* Club & Player UI */
.fc-club-list { max-height:220px; overflow-y:auto; display:grid; grid-template-columns:repeat(2,1fr); gap:6px; padding-right:4px; }
@media (max-width:640px) { .fc-club-list { grid-template-columns:1fr; } }
.fc-club-item { display:flex; align-items:center; gap:9px; padding:7px 9px; border-radius:8px;
  border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.03); cursor:pointer; text-align:left; color:#eef2f8; }
.fc-club-item:hover { background:rgba(255,255,255,.08); }
.fc-club-item.is-on { border-color:#f4cd72; background:rgba(244,205,114,.14); }

.fc-swatches { display:flex; gap:6px; flex-wrap:wrap; }
.fc-swatch { width:24px; height:24px; border-radius:6px; border:2px solid rgba(255,255,255,.22); cursor:pointer; }
.fc-swatch.is-on { border-color:#f4cd72; transform:scale(1.12); box-shadow:0 0 0 2px rgba(244,205,114,.3); }

/* Tables */
.fc-table { width:100%; border-collapse:collapse; font-size:12px; font-variant-numeric:tabular-nums; }
.fc-table th { text-align:left; padding:7px 8px; font-size:9.5px; font-weight:800; letter-spacing:.14em;
  color:rgba(218,228,244,.6); border-bottom:1px solid rgba(255,255,255,.12); }
.fc-table td { padding:7px 8px; border-bottom:1px solid rgba(255,255,255,.06); }
.fc-table tr.is-user { background:rgba(244,205,114,.12); font-weight:800; }
.fc-badge { display:inline-block; padding:2px 7px; border-radius:5px; font-size:9.5px; font-weight:800;
  letter-spacing:.08em; background:rgba(255,255,255,.10); color:#eef2f8; white-space:nowrap; }
.fc-badge-gold { background:rgba(244,205,114,.22); color:#f8df9b; border:1px solid rgba(244,205,114,.45); }
.fc-badge-green { background:rgba(34,197,94,.20); color:#86efac; border:1px solid rgba(74,222,128,.4); }
.fc-badge-blue { background:rgba(56,189,248,.18); color:#7dd3fc; border:1px solid rgba(56,189,248,.35); }

.fc-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:110;
  padding:9px 18px; border-radius:9px; background:#0f172a; border:1px solid #f4cd72; color:#f8df9b;
  font-size:12px; font-weight:800; letter-spacing:.1em; box-shadow:0 12px 30px rgba(0,0,0,.6); }
.fc-modal-bg { position:fixed; inset:0; z-index:100; background:rgba(4,7,13,.76);
  display:flex; align-items:center; justify-content:center; padding:18px; }
.fc-modal { width:100%; max-width:560px; max-height:90vh; overflow-y:auto; }

/* Training XP, World NT Meter & Global Market */
.fc-xp-track { width:100%; height:5px; border-radius:99px; background:rgba(255,255,255,.10); overflow:hidden; margin-top:5px; }
.fc-xp-fill { height:100%; border-radius:99px; background:linear-gradient(90deg, #f4cd72, #4ade80); transition:width .2s ease; }
.fc-nt-meter { width:100%; height:8px; border-radius:99px; background:rgba(255,255,255,.10); overflow:hidden; margin:8px 0; }
.fc-nt-fill { height:100%; border-radius:99px; transition:width .25s ease; }
.fc-market-list { max-height:360px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; padding-right:4px; }

/* Pre-Match Tactics, Formation & Starting XI */
.fc-prep-grid { display:grid; grid-template-columns:1.02fr .98fr; gap:16px; align-items:start; }
@media (max-width:960px) { .fc-prep-grid { grid-template-columns:1fr; } }
.fc-pitch-board { position:relative; width:100%; aspect-ratio:3/4; max-height:530px; border-radius:12px; overflow:hidden;
  background:linear-gradient(180deg, #0d261a 0%, #113222 50%, #0d261a 100%);
  border:1px solid rgba(255,255,255,.16); box-shadow:inset 0 0 40px rgba(0,0,0,.45); }
.fc-pitch-node { position:absolute; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center;
  gap:2px; background:none; border:none; padding:2px; cursor:pointer; color:#eef2f8; transition:transform .12s ease; }
.fc-pitch-node:hover { transform:translate(-50%,-52%) scale(1.06); }
.fc-pitch-disc { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font-size:12px; font-weight:900; font-variant-numeric:tabular-nums;
  border:2px solid rgba(255,255,255,.82); box-shadow:0 4px 12px rgba(0,0,0,.6); position:relative; }
.fc-pitch-node.is-selected .fc-pitch-disc { border-color:#f4cd72; box-shadow:0 0 0 3px rgba(244,205,114,.48), 0 6px 14px rgba(0,0,0,.7); }
.fc-pitch-node.is-pro .fc-pitch-disc { border-color:#f4cd72; }
.fc-pitch-name { padding:1px 6px; border-radius:4px; background:rgba(8,12,20,.88); border:1px solid rgba(255,255,255,.14);
  font-size:10px; font-weight:800; letter-spacing:.03em; white-space:nowrap; max-width:96px; overflow:hidden; text-overflow:ellipsis; }
.fc-pitch-ovr { font-size:9.5px; font-weight:900; color:#f4cd72; font-variant-numeric:tabular-nums; }
.fc-mismatch-dot { position:absolute; top:-3px; right:-3px; width:10px; height:10px; border-radius:50%;
  background:#f59e0b; border:1.5px solid #0b0f17; }
.fc-squad-scroll { max-height:400px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; padding-right:4px; }
.fc-squad-row { display:grid; grid-template-columns:44px 1fr 42px 38px; gap:8px; align-items:center;
  width:100%; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.03); color:#eef2f8; text-align:left; cursor:pointer; transition:background .12s ease, border-color .12s ease; }
.fc-squad-row:hover { background:rgba(255,255,255,.08); border-color:rgba(255,255,255,.22); }
.fc-squad-row.is-selected { background:rgba(244,205,114,.16); border-color:#f4cd72; }
.fc-squad-row.is-sub { background:rgba(255,255,255,.015); border-color:rgba(255,255,255,.06); opacity:.92; }
.fc-squad-row.is-readonly { cursor:default; }
.fc-squad-row.is-readonly:hover { background:rgba(255,255,255,.03); border-color:rgba(255,255,255,.08); }
.fc-ovr-num { font-size:14px; font-weight:950; font-variant-numeric:tabular-nums; text-align:right; color:#f4cd72; }
`;

function attachInputGuards(el) {
  if (!el) return el;
  const stop = (e) => {
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  };
  el.addEventListener('keydown', stop);
  el.addEventListener('keyup', stop);
  el.addEventListener('keypress', stop);
  return el;
}

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  const lower = typeof tag === 'string' ? tag.toLowerCase() : '';
  if (lower === 'input' || lower === 'textarea' || lower === 'select') {
    attachInputGuards(el);
  }
  return el;
}

function ratingColor(r) {
  if (r >= 8.5) return '#4ade80';
  if (r >= 7.2) return '#facc15';
  if (r >= 6.0) return '#e2e8f0';
  return '#f87171';
}

export function createCareerUi({ onLaunchMatch, onLaunchDrill, onExitToMenu } = {}) {
  const style = document.createElement('style');
  style.textContent = UI_CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'fc-root';
  root.dataset.testid = 'career-ui-root';
  document.body.appendChild(root);

  let screen = 'start'; // 'start' | 'quick' | 'create' | 'hub' | 'matchprep' | 'postmatch' | 'seasonreview' | 'hidden'
  let hubTab = 'home'; // 'home' | 'training' | 'player' | 'market' | 'comps'
  let compSubTab = 'standings'; // 'standings' | 'fixtures' | 'bracket' | 'managers' | 'leaders'
  let selectedCompId = null;
  let leaderSort = 'goals';
  let career = loadCareer();
  let postMatchSummary = null;
  let prepDraft = null;
  let lastDrillResult = null;
  let toastTimer = null;

  const mkt = {
    fromClubId: null,
    toClubId: null,
    fromFilter: 'all',
    toFilter: 'all',
    search: '',
    selectedId: null,
    selectedIsPro: false,
    feeM: 15,
    allowOverBudget: false,
  };

  // Quick Match Draft State
  const qm = {
    filter: 'all',
    homeId: CLASSIC_PRESET_CLUBS[0].id,
    awayId: CLASSIC_PRESET_CLUBS[1].id,
    homeKitPref: 'home',
    awayKitPref: 'auto',
    difficulty: 'pro',
    halfMinutes: 4,
    cameraMode: 'broadcast',
  };

  // Create Player Draft State
  const cp = {
    name: 'Alex Mercer',
    age: 19,
    nationality: 'England',
    position: 'ST',
    preferredFoot: 'Right',
    number: 9,
    leagueFilter: 'eng',
    clubId: CLUBS[0].id,
    tier: 'wonderkid',
    attrs: presetAttrsForTier('ST', 'wonderkid'),
    appearance: {
      skin: SKIN_PALETTE[1],
      hairStyle: 'quiff',
      hairColor: HAIR_PALETTE[1],
      bootIdx: 0,
      height: 1.82,
      build: 1.0,
    },
  };

  function showToast(msg) {
    const existing = document.querySelector('.fc-toast');
    if (existing) existing.remove();
    const t = h('div', 'fc-toast', msg);
    document.body.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.remove(); }, 2300);
  }

  function showScreen(nextScreen) {
    screen = nextScreen;
    if (screen === 'hidden') {
      root.style.display = 'none';
      return;
    }
    root.style.display = 'block';
    render();
  }

  function openStartMenu() {
    career = loadCareer();
    showScreen('start');
  }

  function openCareerHub(tab = 'home') {
    career = loadCareer();
    if (!career) { openStartMenu(); return; }
    hubTab = tab;
    if (!selectedCompId) {
      const club = getTeamById(career.pro.clubId);
      selectedCompId = `lg_${club.leagueId || 'eng'}`;
    }
    showScreen('hub');
  }

  function showPostMatch(summary) {
    career = loadCareer();
    postMatchSummary = summary;
    showScreen('postmatch');
  }

  function finishDrill3d(report) {
    career = loadCareer();
    if (!career) { openStartMenu(); return; }
    if (report && report.drillId) {
      const res = applyTrainingSession(career, report.drillId, {
        mode: '3d',
        score: report.score || 0,
      });
      lastDrillResult = res;
      if (res && res.ok) {
        showToast(`${res.drill.title}: ${res.grade} (${res.score} pts)${res.newOvr > res.oldOvr ? ` · +${res.newOvr - res.oldOvr} OVR!` : ''}`);
      } else {
        showToast('Weekly training allowance used — complete next match to reset.');
      }
    }
    openCareerHub('training');
  }

  function render() {
    root.innerHTML = '';
    if (screen === 'start') renderStartMenu();
    else if (screen === 'quick') renderQuickMatch();
    else if (screen === 'create') renderCreatePlayer();
    else if (screen === 'hub') renderCareerHub();
    else if (screen === 'matchprep') renderMatchPrep();
    else if (screen === 'postmatch') renderPostMatch();
    else if (screen === 'seasonreview') renderSeasonReview();
  }

  // ---- 1. START MENU -------------------------------------------------------

  function renderStartMenu() {
    const shell = h('div', 'fc-shell');
    const wrap = h('div', 'fc-start-wrap');

    const left = h('div');
    left.appendChild(h('span', 'fc-brand-tag', 'BROADCAST EDITION · 60 FPS ENGINE'));
    left.appendChild(h('h1', 'fc-brand-h1', 'FIFACHER'));
    const desc = h('p', 'fc-muted', 'Multi-season Player Career Mode across 5 European Leagues, Domestic & League Cups, Champions League, Europa League, and 32 National Teams.');
    desc.style.fontSize = '14px';
    desc.style.lineHeight = '1.5';
    left.appendChild(desc);

    const pills = h('div');
    pills.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;';
    ['96 Clubs · 5 Leagues', '32 National Teams', 'Manager Tactics AI', 'Live 0.0–10.0 Match Ratings'].forEach((t) => {
      pills.appendChild(h('span', 'fc-badge fc-badge-gold', t));
    });
    left.appendChild(pills);

    const right = h('div', 'fc-menu-btns');
    if (career) {
      const club = getTeamById(career.pro.clubId);
      const cont = h('button', 'fc-menu-btn is-primary');
      cont.dataset.testid = 'btn-continue-career';
      cont.innerHTML = `<div><b>CONTINUE CAREER</b><span>${career.pro.name} · ${career.pro.ovr} OVR · ${club.name} · Season ${career.season} (${getCalendarDate(career)})</span></div>`;
      const svgWrap = h('div');
      svgWrap.innerHTML = renderJerseySvg(club.homeKit, 42, career.pro.number);
      cont.appendChild(svgWrap);
      cont.addEventListener('click', () => openCareerHub('home'));
      right.appendChild(cont);
    }

    const newBtn = h('button', career ? 'fc-menu-btn' : 'fc-menu-btn is-primary');
    newBtn.dataset.testid = 'btn-new-career';
    newBtn.innerHTML = `<div><b>NEW PLAYER CAREER</b><span>Create Your Pro, pick any club in Europe, climb from Wonderkid or Academy to Ballon d'Or</span></div><b class="fc-gold">→</b>`;
    newBtn.addEventListener('click', () => showScreen('create'));
    right.appendChild(newBtn);

    const qmBtn = h('button', 'fc-menu-btn');
    qmBtn.dataset.testid = 'btn-quick-match';
    qmBtn.innerHTML = `<div><b>QUICK MATCH</b><span>Pick any of 96 Clubs or 32 Nations, or launch the Classic Derby</span></div><b class="fc-gold">→</b>`;
    qmBtn.addEventListener('click', () => showScreen('quick'));
    right.appendChild(qmBtn);

    wrap.appendChild(left);
    wrap.appendChild(right);
    shell.appendChild(wrap);
    root.appendChild(shell);
  }

  // ---- 2. QUICK MATCH ------------------------------------------------------

  function getFilteredTeams(filter) {
    if (filter === 'classic') return CLASSIC_PRESET_CLUBS;
    if (filter === 'nations') return NATIONS;
    if (filter === 'all') return [...CLASSIC_PRESET_CLUBS, ...CLUBS, ...NATIONS];
    return getClubsByLeague(filter);
  }

  function renderQuickMatch() {
    const shell = h('div', 'fc-shell');
    const head = h('div', 'fc-topbar');
    const hLeft = h('div');
    hLeft.appendChild(h('div', 'fc-label', 'EXHIBITION SETUP'));
    hLeft.appendChild(h('h2', 'fc-title', 'Quick Match'));
    head.appendChild(hLeft);

    const hRight = h('div');
    hRight.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const classicBtn = h('button', 'fc-btn fc-btn-gold');
    classicBtn.dataset.testid = 'btn-classic-derby';
    classicBtn.textContent = 'CLASSIC DERBY PRESET';
    classicBtn.addEventListener('click', () => {
      qm.homeId = CLASSIC_PRESET_CLUBS[0].id;
      qm.awayId = CLASSIC_PRESET_CLUBS[1].id;
      qm.homeKitPref = 'home';
      qm.awayKitPref = 'auto';
      render();
    });
    const backBtn = h('button', 'fc-btn');
    backBtn.textContent = 'BACK';
    backBtn.addEventListener('click', () => showScreen('start'));
    hRight.appendChild(classicBtn);
    hRight.appendChild(backBtn);
    head.appendChild(hRight);
    shell.appendChild(head);

    const homeTeam = getTeamById(qm.homeId);
    const awayTeam = getTeamById(qm.awayId);
    const resolved = resolveMatchKits(homeTeam, awayTeam, qm.homeKitPref, qm.awayKitPref);

    // Matchup card
    const card = h('div', 'fc-card');
    const topGrid = h('div', 'fc-grid-2');

    const buildSideBox = (label, team, kit, pref, setPref, isHomeSide) => {
      const box = h('div');
      box.style.cssText = 'display:flex;align-items:center;gap:14px;padding:10px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);';
      const j = h('div');
      j.innerHTML = renderJerseySvg(kit, 58, isHomeSide ? 10 : 9);
      box.appendChild(j);
      const meta = h('div');
      meta.style.flex = '1';
      meta.appendChild(h('div', 'fc-label', label));
      meta.appendChild(h('div', '', team.name)).style.cssText = 'font-size:17px;font-weight:900;margin:2px 0;';
      const sty = TACTICAL_STYLES[team.manager.style] || TACTICAL_STYLES.balanced;
      meta.appendChild(h('div', 'fc-muted', `${team.rating} OVR · Coach: ${team.manager.name} (${sty.short})`)).style.fontSize = '11px';
      const kitRow = h('div');
      kitRow.style.cssText = 'display:flex;gap:5px;margin-top:7px;';
      const opts = isHomeSide ? [['home', 'HOME KIT'], ['away', 'AWAY KIT']] : [['auto', 'AUTO CLASH'], ['home', 'HOME KIT'], ['away', 'AWAY KIT']];
      opts.forEach(([v, txt]) => {
        const b = h('button', `fc-btn-pill${pref === v ? ' is-on' : ''}`, txt);
        b.addEventListener('click', () => { setPref(v); render(); });
        kitRow.appendChild(b);
      });
      meta.appendChild(kitRow);
      box.appendChild(meta);
      return box;
    };

    topGrid.appendChild(buildSideBox('HOME TEAM (USER)', homeTeam, resolved.homeKit, qm.homeKitPref, (v) => { qm.homeKitPref = v; }, true));
    topGrid.appendChild(buildSideBox(resolved.autoSwitched ? 'AWAY TEAM (AUTO AWAY KIT)' : 'AWAY TEAM', awayTeam, resolved.awayKit, qm.awayKitPref, (v) => { qm.awayKitPref = v; }, false));
    card.appendChild(topGrid);

    // Filter tabs + pickers
    const filterRow = h('div');
    filterRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 10px;';
    [
      ['all', 'All Teams'],
      ['classic', 'Classic Derby'],
      ...LEAGUES.map((l) => [l.id, l.name]),
      ['nations', 'National Teams'],
    ].forEach(([fid, flbl]) => {
      const b = h('button', `fc-btn-pill${qm.filter === fid ? ' is-on' : ''}`, flbl);
      b.addEventListener('click', () => { qm.filter = fid; render(); });
      filterRow.appendChild(b);
    });
    card.appendChild(filterRow);

    const list = getFilteredTeams(qm.filter);
    const pickerGrid = h('div', 'fc-grid-2');
    const makePicker = (title, curId, onPick) => {
      const col = h('div');
      col.appendChild(h('div', 'fc-label', title)).style.marginBottom = '6px';
      const sc = h('div', 'fc-club-list');
      list.forEach((t) => {
        const btn = h('button', `fc-club-item${t.id === curId ? ' is-on' : ''}`);
        btn.innerHTML = `${renderJerseySvg(t.homeKit, 28)}<div><div style="font-size:12px;font-weight:800;">${t.name}</div><div style="font-size:10px;color:rgba(218,228,244,.65);">${t.rating} OVR · ${TACTICAL_STYLES[t.manager.style]?.short || ''}</div></div>`;
        btn.addEventListener('click', () => { onPick(t.id); render(); });
        sc.appendChild(btn);
      });
      col.appendChild(sc);
      return col;
    };
    pickerGrid.appendChild(makePicker('SELECT HOME CLUB / NATION', qm.homeId, (id) => { qm.homeId = id; }));
    pickerGrid.appendChild(makePicker('SELECT AWAY CLUB / NATION', qm.awayId, (id) => { qm.awayId = id; }));
    card.appendChild(pickerGrid);

    // Match settings & kickoff
    const foot = h('div');
    foot.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.10);';
    const optsWrap = h('div');
    optsWrap.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;align-items:center;';

    const addSeg = (lbl, items, cur, set) => {
      const g = h('div');
      g.style.cssText = 'display:flex;align-items:center;gap:5px;';
      g.appendChild(h('span', 'fc-label', lbl));
      items.forEach(([v, txt]) => {
        const b = h('button', `fc-btn-pill${cur === v ? ' is-on' : ''}`, txt);
        b.addEventListener('click', () => { set(v); render(); });
        g.appendChild(b);
      });
      optsWrap.appendChild(g);
    };
    addSeg('DIFF', [['casual', 'CASUAL'], ['pro', 'PRO'], ['legend', 'LEGEND']], qm.difficulty, (v) => { qm.difficulty = v; });
    addSeg('HALF', [[2, '2M'], [4, '4M'], [6, '6M']], qm.halfMinutes, (v) => { qm.halfMinutes = v; });
    addSeg('CAM', [['broadcast', 'BROADCAST'], ['closeup', 'CLOSEUP']], qm.cameraMode, (v) => { qm.cameraMode = v; });

    const kickBtn = h('button', 'fc-btn fc-btn-gold');
    kickBtn.dataset.testid = 'btn-quick-kickoff';
    kickBtn.textContent = 'TACTICS & STARTING XI →';
    kickBtn.style.padding = '12px 24px';
    kickBtn.addEventListener('click', () => {
      openMatchPrepForQuick(homeTeam, awayTeam, resolved);
    });
    foot.appendChild(optsWrap);
    foot.appendChild(kickBtn);
    card.appendChild(foot);
    shell.appendChild(card);
    root.appendChild(shell);
  }

  // ---- 3. CREATE MY PLAYER -------------------------------------------------

  function renderCreatePlayer() {
    const shell = h('div', 'fc-shell');
    const head = h('div', 'fc-topbar');
    const hLeft = h('div');
    hLeft.appendChild(h('div', 'fc-label', 'NEW PLAYER CAREER'));
    hLeft.appendChild(h('h2', 'fc-title', 'Create Your Player'));
    head.appendChild(hLeft);
    const backBtn = h('button', 'fc-btn', 'BACK TO MENU');
    backBtn.addEventListener('click', () => showScreen('start'));
    head.appendChild(backBtn);
    shell.appendChild(head);

    const grid = h('div', 'fc-grid-12');

    // Left Card: Identity + Starting Club
    const leftCard = h('div', 'fc-card');
    leftCard.appendChild(h('div', 'fc-label', 'IDENTITY, POSITION & STARTING CLUB')).style.marginBottom = '10px';

    const row1 = h('div', 'fc-grid-3');
    const addField = (lbl, el) => {
      const wrap = h('div');
      wrap.appendChild(h('div', 'fc-label', lbl)).style.marginBottom = '4px';
      wrap.appendChild(el);
      return wrap;
    };

    const nameIn = h('input', 'fc-input');
    nameIn.type = 'text';
    nameIn.autocomplete = 'off';
    nameIn.autocorrect = 'off';
    nameIn.autocapitalize = 'words';
    nameIn.spellcheck = false;
    nameIn.maxLength = 24;
    nameIn.placeholder = 'e.g. Alex Hunter';
    nameIn.dataset.testid = 'input-pro-name';
    nameIn.value = cp.name;
    nameIn.addEventListener('input', () => { cp.name = nameIn.value; });
    nameIn.addEventListener('change', () => { cp.name = nameIn.value; });
    nameIn.addEventListener('focus', () => {
      if (nameIn.value === 'Alex Hunter') {
        try { nameIn.select(); } catch (_) {}
      }
    });
    row1.appendChild(addField('Player Name', nameIn));

    const ageSel = h('select', 'fc-select');
    for (let a = 16; a <= 30; a++) {
      const opt = h('option', '', `${a} yrs`);
      opt.value = String(a);
      if (a === cp.age) opt.selected = true;
      ageSel.appendChild(opt);
    }
    ageSel.addEventListener('change', () => { cp.age = Number(ageSel.value); });
    row1.appendChild(addField('Age', ageSel));

    const natSel = h('select', 'fc-select');
    natSel.dataset.testid = 'select-pro-nat';
    NATIONS.forEach((n) => {
      const opt = h('option', '', n.name);
      opt.value = n.name;
      if (n.name === cp.nationality) opt.selected = true;
      natSel.appendChild(opt);
    });
    natSel.addEventListener('change', () => { cp.nationality = natSel.value; });
    row1.appendChild(addField('Nationality (NT)', natSel));
    leftCard.appendChild(row1);

    // Position & Foot & Number
    const row2 = h('div');
    row2.style.cssText = 'margin-top:12px;';
    row2.appendChild(h('div', 'fc-label', 'Position')).style.marginBottom = '5px';
    const posRow = h('div');
    posRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';
    const posBtns = [];
    POSITIONS.forEach((pos) => {
      const b = h('button', `fc-btn-pill${cp.position === pos ? ' is-on' : ''}`, pos);
      b.type = 'button';
      b.dataset.testid = `pos-${pos}`;
      b.addEventListener('click', () => {
        cp.position = pos;
        cp.attrs = presetAttrsForTier(pos, cp.tier);
        posBtns.forEach((item) => item.b.classList.toggle('is-on', item.pos === pos));
        updateAttrsUI();
      });
      posRow.appendChild(b);
      posBtns.push({ b, pos });
    });
    row2.appendChild(posRow);
    leftCard.appendChild(row2);

    const row3 = h('div', 'fc-grid-2');
    row3.style.marginTop = '12px';
    const footBox = h('div');
    footBox.appendChild(h('div', 'fc-label', 'Preferred Foot')).style.marginBottom = '4px';
    const footBtns = h('div');
    footBtns.style.cssText = 'display:flex;gap:6px;';
    const footBtnsList = [];
    ['Right', 'Left'].forEach((ft) => {
      const b = h('button', `fc-btn-pill${cp.preferredFoot === ft ? ' is-on' : ''}`, `${ft} Foot`);
      b.type = 'button';
      b.addEventListener('click', () => {
        cp.preferredFoot = ft;
        footBtnsList.forEach((item) => item.b.classList.toggle('is-on', item.ft === ft));
      });
      footBtns.appendChild(b);
      footBtnsList.push({ b, ft });
    });
    footBox.appendChild(footBtns);
    row3.appendChild(footBox);

    const numIn = h('input', 'fc-input');
    numIn.type = 'text';
    numIn.inputMode = 'numeric';
    numIn.pattern = '[0-9]*';
    numIn.maxLength = 2;
    numIn.dataset.testid = 'input-pro-number';
    numIn.value = String(cp.number);
    numIn.placeholder = 'e.g. 10';
    numIn.addEventListener('input', () => {
      const digits = numIn.value.replace(/[^0-9]/g, '');
      if (numIn.value !== digits) numIn.value = digits;
      if (digits.length > 0) {
        const val = parseInt(digits, 10);
        if (!isNaN(val) && val >= 1 && val <= 99) {
          cp.number = val;
          refreshClubJerseys();
        }
      }
    });
    numIn.addEventListener('blur', () => {
      const val = parseInt(numIn.value, 10);
      const clean = (!isNaN(val) && val >= 1 && val <= 99) ? val : (cp.number || 9);
      cp.number = clean;
      numIn.value = String(clean);
      refreshClubJerseys();
    });
    numIn.addEventListener('focus', () => {
      try { numIn.select(); } catch (_) {}
    });
    row3.appendChild(addField('Kit Number (1-99)', numIn));
    leftCard.appendChild(row3);

    // Starting Club Browser (5 Leagues)
    const clubSec = h('div');
    clubSec.style.marginTop = '14px';
    clubSec.appendChild(h('div', 'fc-label', 'Starting Club (5 Top Leagues)')).style.marginBottom = '6px';
    const lgTabs = h('div');
    lgTabs.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;';
    const lgBtns = [];
    LEAGUES.forEach((lg) => {
      const b = h('button', `fc-btn-pill${cp.leagueFilter === lg.id ? ' is-on' : ''}`, lg.name);
      b.type = 'button';
      b.addEventListener('click', () => {
        cp.leagueFilter = lg.id;
        lgBtns.forEach((item) => item.b.classList.toggle('is-on', item.lgId === lg.id));
        rebuildClubList();
      });
      lgTabs.appendChild(b);
      lgBtns.push({ b, lgId: lg.id });
    });
    clubSec.appendChild(lgTabs);

    const clubList = h('div', 'fc-club-list');
    const rebuildClubList = () => {
      clubList.innerHTML = '';
      const clubs = getClubsByLeague(cp.leagueFilter);
      clubs.forEach((c) => {
        const btn = h('button', `fc-club-item${cp.clubId === c.id ? ' is-on' : ''}`);
        btn.type = 'button';
        btn.dataset.testid = `pick-club-${c.id}`;
        const sty = TACTICAL_STYLES[c.manager.style]?.short || '';
        btn.innerHTML = `${renderJerseySvg(c.homeKit, 30, cp.number)}<div><div style="font-size:12px;font-weight:800;">${c.name}</div><div style="font-size:10px;color:rgba(218,228,244,.65);">${c.rating} OVR · ${c.manager.name} (${sty})</div></div>`;
        btn.addEventListener('click', () => {
          cp.clubId = c.id;
          clubList.querySelectorAll('.fc-club-item').forEach((item) => item.classList.remove('is-on'));
          btn.classList.add('is-on');
        });
        clubList.appendChild(btn);
      });
    };
    const refreshClubJerseys = () => {
      const items = clubList.querySelectorAll('.fc-club-item');
      const clubs = getClubsByLeague(cp.leagueFilter);
      items.forEach((btn, idx) => {
        const c = clubs[idx];
        if (!c) return;
        const svgEl = btn.querySelector('svg');
        if (svgEl) {
          const temp = document.createElement('div');
          temp.innerHTML = renderJerseySvg(c.homeKit, 30, cp.number);
          const newSvg = temp.firstElementChild;
          if (newSvg) svgEl.replaceWith(newSvg);
        }
      });
    };
    rebuildClubList();
    clubSec.appendChild(clubList);
    leftCard.appendChild(clubSec);

    // Right Card: Tier, Attributes & 3D Appearance
    const rightCard = h('div', 'fc-card');
    const curOvr = computeOvr(cp.position, cp.attrs);
    const attrHead = h('div');
    attrHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
    attrHead.appendChild(h('div', 'fc-label', 'STARTING TIER & ATTRIBUTES'));
    const ovrBadge = h('span', 'fc-badge fc-badge-gold fc-num', `${curOvr} OVR`);
    ovrBadge.dataset.testid = 'create-ovr-badge';
    attrHead.appendChild(ovrBadge);
    rightCard.appendChild(attrHead);

    const tierRow = h('div');
    tierRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;';
    const tierBtns = [];
    [
      ['academy', 'Academy (64)'],
      ['wonderkid', 'Wonderkid (72)'],
      ['star', 'Established Star (80)'],
    ].forEach(([tid, tlbl]) => {
      const b = h('button', `fc-btn-pill${cp.tier === tid ? ' is-on' : ''}`, tlbl);
      b.type = 'button';
      b.dataset.testid = `tier-${tid}`;
      b.addEventListener('click', () => {
        cp.tier = tid;
        cp.attrs = presetAttrsForTier(cp.position, tid);
        tierBtns.forEach((item) => item.b.classList.toggle('is-on', item.tid === tid));
        updateAttrsUI();
      });
      tierRow.appendChild(b);
      tierBtns.push({ b, tid });
    });
    rightCard.appendChild(tierRow);

    const slidersWrap = h('div');
    slidersWrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;';
    const sliderEntries = [];
    [
      ['pace', 'Pace'], ['shooting', 'Shooting'], ['passing', 'Passing'],
      ['dribbling', 'Dribbling'], ['defending', 'Defending'], ['physical', 'Physical'],
    ].forEach(([k, lbl]) => {
      const row = h('div');
      const top = h('div');
      top.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;font-weight:700;';
      top.appendChild(h('span', '', lbl));
      const valEl = h('span', 'fc-gold fc-num', String(cp.attrs[k]));
      top.appendChild(valEl);
      const sl = h('input');
      sl.type = 'range'; sl.min = '35'; sl.max = '94';
      sl.value = String(cp.attrs[k]);
      sl.style.cssText = 'width:100%;accent-color:#f4cd72;cursor:pointer;';
      sl.addEventListener('input', () => {
        cp.attrs[k] = Number(sl.value);
        valEl.textContent = String(cp.attrs[k]);
        ovrBadge.textContent = `${computeOvr(cp.position, cp.attrs)} OVR`;
      });
      row.appendChild(top);
      row.appendChild(sl);
      slidersWrap.appendChild(row);
      sliderEntries.push([k, valEl, sl]);
    });
    rightCard.appendChild(slidersWrap);

    const updateAttrsUI = () => {
      ovrBadge.textContent = `${computeOvr(cp.position, cp.attrs)} OVR`;
      sliderEntries.forEach(([k, valEl, sl]) => {
        valEl.textContent = String(cp.attrs[k]);
        sl.value = String(cp.attrs[k]);
      });
    };

    // 3D Appearance
    const appSec = h('div');
    appSec.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.10);';
    appSec.appendChild(h('div', 'fc-label', '3D PITCH APPEARANCE')).style.marginBottom = '8px';

    const addSwatches = (lbl, list, getVal, onPick) => {
      const box = h('div');
      box.style.marginBottom = '8px';
      box.appendChild(h('div', 'fc-label', lbl)).style.marginBottom = '4px';
      const row = h('div', 'fc-swatches');
      const swatches = [];
      list.forEach((col) => {
        const sw = h('button', `fc-swatch${getVal() === col ? ' is-on' : ''}`);
        sw.type = 'button';
        sw.style.background = col;
        sw.addEventListener('click', () => {
          onPick(col);
          swatches.forEach((s) => s.sw.classList.toggle('is-on', s.col === col));
        });
        row.appendChild(sw);
        swatches.push({ sw, col });
      });
      box.appendChild(row);
      return box;
    };

    appSec.appendChild(addSwatches('Skin Tone', SKIN_PALETTE, () => cp.appearance.skin, (c) => { cp.appearance.skin = c; }));
    appSec.appendChild(addSwatches('Hair Color', HAIR_PALETTE, () => cp.appearance.hairColor, (c) => { cp.appearance.hairColor = c; }));

    const hsBox = h('div');
    hsBox.style.marginBottom = '8px';
    hsBox.appendChild(h('div', 'fc-label', 'Hair Style')).style.marginBottom = '4px';
    const hsRow = h('div');
    hsRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';
    const hsBtns = [];
    HAIR_STYLE_OPTIONS.forEach((st) => {
      const b = h('button', `fc-btn-pill${cp.appearance.hairStyle === st ? ' is-on' : ''}`, st.toUpperCase());
      b.type = 'button';
      b.addEventListener('click', () => {
        cp.appearance.hairStyle = st;
        hsBtns.forEach((hb) => hb.b.classList.toggle('is-on', hb.st === st));
      });
      hsRow.appendChild(b);
      hsBtns.push({ b, st });
    });
    hsBox.appendChild(hsRow);
    appSec.appendChild(hsBox);

    const bootBox = h('div');
    bootBox.style.marginBottom = '8px';
    bootBox.appendChild(h('div', 'fc-label', 'Boot Colorway')).style.marginBottom = '4px';
    const bootRow = h('div');
    bootRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';
    const bootBtns = [];
    BOOT_OPTIONS.forEach((bt, idx) => {
      const b = h('button', `fc-btn-pill${cp.appearance.bootIdx === idx ? ' is-on' : ''}`, bt.name);
      b.type = 'button';
      b.style.borderLeft = `4px solid ${bt.flash}`;
      b.addEventListener('click', () => {
        cp.appearance.bootIdx = idx;
        bootBtns.forEach((bb) => bb.b.classList.toggle('is-on', bb.idx === idx));
      });
      bootRow.appendChild(b);
      bootBtns.push({ b, idx });
    });
    bootBox.appendChild(bootRow);
    appSec.appendChild(bootBox);

    const bodyGrid = h('div', 'fc-grid-2');
    const hWrap = h('div');
    const hTop = h('div');
    hTop.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;font-weight:700;';
    hTop.innerHTML = `<span>Height</span><span class="fc-gold fc-num">${Math.round(cp.appearance.height * 100)} cm</span>`;
    const hSl = h('input');
    hSl.type = 'range'; hSl.min = '168'; hSl.max = '198'; hSl.value = String(Math.round(cp.appearance.height * 100));
    hSl.style.cssText = 'width:100%;accent-color:#f4cd72;';
    hSl.addEventListener('input', () => { cp.appearance.height = Number(hSl.value) / 100; hTop.lastChild.textContent = `${hSl.value} cm`; });
    hWrap.appendChild(hTop); hWrap.appendChild(hSl);

    const bWrap = h('div');
    const bTop = h('div');
    bTop.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;font-weight:700;';
    bTop.innerHTML = `<span>Body Build</span><span class="fc-gold fc-num">${cp.appearance.build.toFixed(2)}x</span>`;
    const bSl = h('input');
    bSl.type = 'range'; bSl.min = '90'; bSl.max = '115'; bSl.value = String(Math.round(cp.appearance.build * 100));
    bSl.style.cssText = 'width:100%;accent-color:#f4cd72;';
    bSl.addEventListener('input', () => { cp.appearance.build = Number(bSl.value) / 100; bTop.lastChild.textContent = `${cp.appearance.build.toFixed(2)}x`; });
    bWrap.appendChild(bTop); bWrap.appendChild(bSl);

    bodyGrid.appendChild(hWrap);
    bodyGrid.appendChild(bWrap);
    appSec.appendChild(bodyGrid);
    rightCard.appendChild(appSec);

    const createFooter = h('div');
    createFooter.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;';
    const startBtn = h('button', 'fc-btn fc-btn-gold', 'START PLAYER CAREER →');
    startBtn.dataset.testid = 'btn-confirm-create';
    startBtn.style.padding = '12px 24px';
    startBtn.addEventListener('click', () => {
      const cleanName = (nameIn ? nameIn.value : cp.name).trim() || cp.name || 'Alex Hunter';
      const parsedNum = parseInt(numIn ? numIn.value : cp.number, 10);
      const cleanNum = (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= 99) ? parsedNum : (cp.number || 9);

      cp.name = cleanName;
      cp.number = cleanNum;

      const boot = BOOT_OPTIONS[cp.appearance.bootIdx] || BOOT_OPTIONS[0];
      career = createNewCareer({
        name: cleanName,
        age: cp.age,
        nationality: cp.nationality,
        position: cp.position,
        preferredFoot: cp.preferredFoot,
        number: cleanNum,
        clubId: cp.clubId,
        tier: cp.tier,
        attrs: { ...cp.attrs },
        appearance: {
          skin: cp.appearance.skin,
          hairStyle: cp.appearance.hairStyle,
          hairColor: cp.appearance.hairColor,
          bootUpper: boot.upper,
          bootFlash: boot.flash,
          bootSole: boot.sole,
          height: cp.appearance.height,
          build: cp.appearance.build,
        },
      });
      selectedCompId = `lg_${getTeamById(career.pro.clubId).leagueId}`;
      openCareerHub('home');
    });
    createFooter.appendChild(startBtn);
    rightCard.appendChild(createFooter);

    grid.appendChild(leftCard);
    grid.appendChild(rightCard);
    shell.appendChild(grid);
    root.appendChild(shell);
  }

  // ---- 4. CAREER HUB (TOP BAR + 3 TABS) ------------------------------------

  function renderCareerHub() {
    if (!career) { openStartMenu(); return; }
    const shell = h('div', 'fc-shell');
    const pro = career.pro;
    const club = getTeamById(pro.clubId);
    const rank = getClubRank(career, club.id);

    // Top Header
    const bar = h('div', 'fc-topbar');
    const infoLeft = h('div');
    infoLeft.style.cssText = 'display:flex;align-items:center;gap:12px;';
    const jWrap = h('div');
    jWrap.innerHTML = renderJerseySvg(club.homeKit, 40, pro.number);
    infoLeft.appendChild(jWrap);
    const meta = h('div');
    meta.appendChild(h('div', 'fc-label', `SEASON ${career.season} · ${getCalendarDate(career)}${rank ? ` · LEAGUE RANK #${rank}` : ''}`));
    const nameLine = h('div');
    nameLine.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;';
    nameLine.appendChild(h('b', '', `${pro.name} (${pro.pos})`)).style.fontSize = '16px';
    nameLine.appendChild(h('span', 'fc-badge fc-badge-gold fc-num', `${pro.ovr} OVR`));
    nameLine.appendChild(h('span', 'fc-badge', `${club.name}`));
    nameLine.appendChild(h('span', pro.coachTrust >= 42 ? 'fc-badge fc-badge-green' : 'fc-badge', `TRUST ${pro.coachTrust} · ${pro.coachTrust >= 42 ? 'STARTING XI' : 'SUB'}`));
    if (pro.calledUp) {
      nameLine.appendChild(h('span', 'fc-badge fc-badge-blue', `${findNationForCountry(pro.nationality).abbr} NT: ACTIVE`));
    } else {
      nameLine.appendChild(h('span', 'fc-badge', `${findNationForCountry(pro.nationality).abbr} NT: CLUB ONLY`));
    }
    meta.appendChild(nameLine);
    infoLeft.appendChild(meta);
    bar.appendChild(infoLeft);

    const tabsRight = h('div');
    tabsRight.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    const tabs = h('div', 'fc-tabs');
    [
      ['home', 'HOME / NEXT MATCH'],
      ['training', 'TRAINING'],
      ['player', 'MY PLAYER'],
      ['market', 'TRANSFER MARKET'],
      ['comps', 'COMPETITIONS'],
    ].forEach(([tid, tlbl]) => {
      const tb = h('button', `fc-tab${hubTab === tid ? ' is-on' : ''}`, tlbl);
      tb.dataset.testid = `tab-${tid}`;
      tb.addEventListener('click', () => { hubTab = tid; render(); });
      tabs.appendChild(tb);
    });
    tabsRight.appendChild(tabs);

    const menuBtn = h('button', 'fc-btn fc-btn-sm', 'MENU');
    menuBtn.dataset.testid = 'btn-hub-menu';
    menuBtn.addEventListener('click', () => openStartMenu());
    tabsRight.appendChild(menuBtn);
    bar.appendChild(tabsRight);
    shell.appendChild(bar);

    if (hubTab === 'home') renderHubHome(shell);
    else if (hubTab === 'training') renderHubTraining(shell);
    else if (hubTab === 'player') renderHubPlayer(shell);
    else if (hubTab === 'market') renderHubMarket(shell);
    else renderHubCompetitions(shell);

    root.appendChild(shell);
  }

  function renderHubHome(shell) {
    const pro = career.pro;
    const nextFx = getNextUserFixture(career);

    if (career.seasonCompleted || !nextFx) {
      const doneCard = h('div', 'fc-card');
      doneCard.style.textAlign = 'center';
      doneCard.style.padding = '32px 24px';
      doneCard.appendChild(h('div', 'fc-label fc-gold', `SEASON ${career.season} COMPLETE`));
      doneCard.appendChild(h('h2', 'fc-title', 'End-of-Season Review & Awards Ready')).style.margin = '8px 0 12px';
      const revBtn = h('button', 'fc-btn fc-btn-gold', 'OPEN SEASON REVIEW & TRANSFERS →');
      revBtn.dataset.testid = 'btn-open-season-review';
      revBtn.addEventListener('click', () => showScreen('seasonreview'));
      doneCard.appendChild(revBtn);
      shell.appendChild(doneCard);
      return;
    }

    const comp = career.competitions[nextFx.compId];
    const hTeam = getTeamById(nextFx.homeId);
    const aTeam = getTeamById(nextFx.awayId);
    const hSt = career.clubsState[nextFx.homeId] || { rating: hTeam.rating, manager: hTeam.manager };
    const aSt = career.clubsState[nextFx.awayId] || { rating: aTeam.rating, manager: aTeam.manager };
    const hStyle = TACTICAL_STYLES[hSt.manager?.style] || TACTICAL_STYLES.balanced;
    const aStyle = TACTICAL_STYLES[aSt.manager?.style] || TACTICAL_STYLES.balanced;
    const hRank = getClubRank(career, hTeam.id);
    const aRank = getClubRank(career, aTeam.id);

    const userIsHome = nextFx.homeId === pro.clubId || nextFx.homeId === pro.nationalTeamId;
    const userKitPref = career.prefs?.userKitPref || 'auto';
    const resolved = userIsHome
      ? resolveMatchKits(hTeam, aTeam, userKitPref === 'away' ? 'away' : 'home', 'auto')
      : resolveMatchKits(hTeam, aTeam, 'home', userKitPref);

    const grid = h('div', 'fc-grid-12');

    // Left: Next Match + Scouting + Launch Options
    const matchCard = h('div', 'fc-card');
    const mHead = h('div');
    mHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;';
    mHead.appendChild(h('span', 'fc-badge fc-badge-gold', `${comp.name.toUpperCase()} · ${nextFx.roundLabel.toUpperCase()}`));
    mHead.appendChild(h('span', 'fc-label', `${getCalendarDate(career, nextFx.slot)}${nextFx.neutral ? ' · NEUTRAL VENUE' : ''}`));
    matchCard.appendChild(mHead);

    // Matchup Display
    const vsRow = h('div');
    vsRow.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;padding:14px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);';

    const renderTeamSide = (t, st, sty, kit, rankNum, isUserSide) => {
      const box = h('div');
      box.style.textAlign = 'center';
      const svg = h('div');
      svg.innerHTML = renderJerseySvg(kit, 64, isUserSide ? pro.number : '');
      box.appendChild(svg);
      box.appendChild(h('div', '', `${t.name}`)).style.cssText = 'font-size:16px;font-weight:900;margin-top:6px;';
      box.appendChild(h('div', 'fc-muted fc-num', `${st.rating} OVR${rankNum ? ` · Rank #${rankNum}` : ''}`)).style.fontSize = '11px';
      box.appendChild(h('div', 'fc-badge', `${st.manager.name} (${st.manager.tacticalRating}) · ${sty.name}`)).style.marginTop = '6px';
      return box;
    };

    vsRow.appendChild(renderTeamSide(hTeam, hSt, hStyle, resolved.homeKit, hRank, userIsHome));
    vsRow.appendChild(h('div', 'fc-gold', 'VS')).style.cssText = 'font-size:22px;font-weight:900;letter-spacing:.15em;';
    vsRow.appendChild(renderTeamSide(aTeam, aSt, aStyle, resolved.awayKit, aRank, !userIsHome));
    matchCard.appendChild(vsRow);

    // Pre-Match Scouting Breakdown
    const oppSt = userIsHome ? aSt : hSt;
    const oppSty = userIsHome ? aStyle : hStyle;
    const scout = h('div');
    scout.style.cssText = 'margin-top:12px;padding:10px 12px;border-radius:9px;background:rgba(244,205,114,.07);border:1px solid rgba(244,205,114,.25);font-size:12px;';
    scout.innerHTML = `<b class="fc-gold" style="letter-spacing:.1em;font-size:10px;">OPPONENT SCOUTING REPORT</b><div style="margin-top:3px;"><b>${oppSt.manager.name}</b> (Tactical Rating ${oppSt.manager.tacticalRating}) deploys <b>${oppSty.name}</b> (${oppSty.formation}): ${oppSty.desc}</div>`;
    matchCard.appendChild(scout);

    // Pre-Match Toggles (Control Mode, Camera, Kit, Difficulty, Half)
    const prefs = career.prefs || (career.prefs = { controlMode: 'full', cameraMode: 'broadcast', difficulty: 'pro', halfMinutes: 4, userKitPref: 'auto' });
    const optsBox = h('div');
    optsBox.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:14px;';
    const addOptRow = (lbl, items, cur, setter, testPrefix) => {
      const r = h('div');
      r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;';
      r.appendChild(h('span', 'fc-label', lbl));
      const g = h('div');
      g.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';
      items.forEach(([v, txt]) => {
        const b = h('button', `fc-btn-pill${cur === v ? ' is-on' : ''}`, txt);
        if (testPrefix) b.dataset.testid = `${testPrefix}-${v}`;
        b.addEventListener('click', () => { setter(v); saveCareer(career); render(); });
        g.appendChild(b);
      });
      r.appendChild(g);
      optsBox.appendChild(r);
    };

    addOptRow('Control Mode', [['full', 'Full Team'], ['pro', 'Player-Lock (My Pro)']], prefs.controlMode, (v) => { prefs.controlMode = v; }, 'ctrl-mode');
    if (prefs.controlMode === 'pro') {
      addOptRow('Player-Lock Camera', [['broadcast', 'Broadcast + Call Pass'], ['pro', 'Pro Cam (3rd Person)']], prefs.cameraMode === 'pro' ? 'pro' : 'broadcast', (v) => { prefs.cameraMode = v; }, 'pro-cam');
    }
    addOptRow('My Team Kit', [['auto', 'Auto Clash'], ['home', 'Home Kit'], ['away', 'Away Kit']], prefs.userKitPref || 'auto', (v) => { prefs.userKitPref = v; }, 'kit-pref');
    addOptRow('Difficulty & Half', [['casual', 'Casual'], ['pro', 'Pro'], ['legend', 'Legend']], prefs.difficulty || 'pro', (v) => { prefs.difficulty = v; }, 'diff');
    addOptRow('Match Length', [[2, '2 Min'], [4, '4 Min'], [6, '6 Min'], [10, '10 Min']], prefs.halfMinutes || 4, (v) => { prefs.halfMinutes = v; }, 'half');
    matchCard.appendChild(optsBox);

    // Primary Actions: Play, Sim, Copy AI Report
    const actRow = h('div');
    actRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.10);';

    const playBtn = h('button', 'fc-btn fc-btn-gold', 'TACTICS & PLAY 3D MATCH →');
    playBtn.dataset.testid = 'btn-play-match';
    playBtn.style.flex = '1';
    playBtn.addEventListener('click', () => {
      openMatchPrepForCareer(nextFx, comp, resolved, userIsHome, prefs);
    });

    const simBtn = h('button', 'fc-btn', 'SIM MATCHWEEK');
    simBtn.dataset.testid = 'btn-sim-match';
    simBtn.addEventListener('click', () => {
      const summary = simCurrentMatchday(career);
      if (summary) showToast(`Simmed: ${summary.homeName} ${summary.scoreH}-${summary.scoreA} ${summary.awayName} · Pro ${summary.proPerf.rating.toFixed(1)}`);
      render();
    });

    const simEndBtn = h('button', 'fc-btn', 'SIM TO SEASON END');
    simEndBtn.dataset.testid = 'btn-sim-season-end';
    simEndBtn.addEventListener('click', () => {
      simToSeasonEnd(career);
      showScreen('seasonreview');
    });

    const copyBtn = h('button', 'fc-btn', 'COPY AI REPORT');
    copyBtn.dataset.testid = 'btn-copy-ai-report';
    copyBtn.addEventListener('click', async () => {
      const txt = generateAiReport(career);
      window.__LAST_AI_REPORT = txt;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(txt);
        }
      } catch (e) { /* headless fallback stored on window.__LAST_AI_REPORT */ }
      showToast('Copied Career AI Report to clipboard!');
    });

    actRow.appendChild(playBtn);
    actRow.appendChild(simBtn);
    actRow.appendChild(simEndBtn);
    actRow.appendChild(copyBtn);
    matchCard.appendChild(actRow);
    grid.appendChild(matchCard);

    // Right: Latest Match & Quick Standings Snapshot
    const rightCol = h('div');
    rightCol.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const lmCard = h('div', 'fc-card');
    lmCard.appendChild(h('div', 'fc-label', 'LATEST MATCH & FORM')).style.marginBottom = '8px';
    if (career.latestMatch) {
      const lm = career.latestMatch;
      const pp = lm.proPerf || {};
      lmCard.innerHTML += `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div><div style="font-size:11px;color:rgba(218,228,244,.65);">${lm.compName} · ${lm.date}</div>
          <div style="font-size:16px;font-weight:900;margin-top:2px;">${lm.homeName} ${lm.scoreH} – ${lm.scoreA} ${lm.awayName}</div></div>
          <div style="text-align:center;padding:6px 10px;border-radius:8px;background:rgba(244,205,114,.14);border:1px solid rgba(244,205,114,.45);">
            <div style="font-size:9px;font-weight:800;color:#f4cd72;">PRO RATING</div>
            <div class="fc-num" style="font-size:20px;font-weight:900;color:${ratingColor(pp.rating || 6.5)};">${(pp.rating || 6.5).toFixed(1)}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;">
          <span class="fc-badge">${pp.goals || 0} Goals</span>
          <span class="fc-badge">${pp.assists || 0} Assists</span>
          <span class="fc-badge">${pp.keyPasses || 0} Key Passes</span>
          <span class="fc-badge">${pp.tackles || 0} Tackles</span>
          ${pp.motm ? '<span class="fc-badge fc-badge-gold">MOTM</span>' : ''}
        </div>
      `;
    } else {
      lmCard.appendChild(h('div', 'fc-muted', 'No matches played yet this season. Kick off your debut match or simulate the opening fixture!')).style.fontSize = '12.5px';
    }
    rightCol.appendChild(lmCard);

    // Compact Development, National Team & Market Strip
    const devCard = h('div', 'fc-card');
    const trStatus = getTrainingStatus(career);
    const ntOp = computeWorldNtOpinion(career);
    const clubSt = career.clubsState?.[pro.clubId] || { budget: 0 };
    devCard.appendChild(h('div', 'fc-label', 'WEEKLY DEVELOPMENT, WORLD NT & CLUB BUDGET')).style.marginBottom = '8px';
    const devRows = h('div');
    devRows.style.cssText = 'display:flex;flex-direction:column;gap:8px;font-size:12px;';

    const mkShortcut = (title, sub, btnLbl, testId, onGo) => {
      const r = h('div');
      r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);';
      const txt = h('div');
      txt.innerHTML = `<div style="font-weight:800;">${title}</div><div class="fc-muted fc-num" style="font-size:11px;">${sub}</div>`;
      const b = h('button', 'fc-btn fc-btn-sm', btnLbl);
      b.dataset.testid = testId;
      b.addEventListener('click', onGo);
      r.appendChild(txt);
      r.appendChild(b);
      devRows.appendChild(r);
    };

    mkShortcut(
      'Weekly Training & 3D Drills',
      `${trStatus.remaining} / ${trStatus.maxPerWeek} Sessions Left This Matchweek · ${pro.ovr} OVR`,
      'TRAIN →',
      'btn-home-training',
      () => { hubTab = 'training'; render(); },
    );
    mkShortcut(
      `${ntOp.nation.abbr} National Team (${pro.calledUp ? 'JOINED' : 'CLUB FOCUS'})`,
      `World AI Readiness ${ntOp.readinessScore}/100 (${ntOp.tierLabel}) · You decide`,
      'NT DESK →',
      'btn-home-nt',
      () => { hubTab = 'player'; render(); },
    );
    mkShortcut(
      'Global Transfer Market',
      `${getTeamById(pro.clubId).abbr} Budget: €${(clubSt.budget || 0).toFixed(1)}M · Open All 96 Clubs`,
      'MARKET →',
      'btn-home-market',
      () => { hubTab = 'market'; render(); },
    );
    devCard.appendChild(devRows);
    rightCol.appendChild(devCard);

    // Compact League Table Top 8
    const club = getTeamById(pro.clubId);
    const lgId = `lg_${club.leagueId}`;
    const table = getStandings(career, lgId);
    const tblCard = h('div', 'fc-card');
    tblCard.appendChild(h('div', 'fc-label', `${career.competitions[lgId]?.name || 'LEAGUE'} STANDINGS SNAPSHOT`)).style.marginBottom = '6px';
    const tbl = h('table', 'fc-table');
    tbl.innerHTML = '<thead><tr><th>#</th><th>Club</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>';
    const tb = h('tbody');
    table.slice(0, 8).forEach((r, idx) => {
      const tr = h('tr', r.teamId === pro.clubId ? 'is-user' : '');
      const t = getTeamById(r.teamId);
      tr.innerHTML = `<td>${idx + 1}</td><td>${t.name}</td><td>${r.p}</td><td>${r.gd >= 0 ? '+' + r.gd : r.gd}</td><td><b>${r.pts}</b></td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    tblCard.appendChild(tbl);
    rightCol.appendChild(tblCard);

    grid.appendChild(rightCol);
    shell.appendChild(grid);
  }

  // ---- TAB 2: MY PLAYER ----------------------------------------------------

  function renderHubPlayer(shell) {
    const pro = career.pro;
    const club = getTeamById(pro.clubId);
    const nt = findNationForCountry(pro.nationality);
    const opinion = computeWorldNtOpinion(career);

    const grid = h('div', 'fc-grid-12');

    // Left: Bio, Attributes + XP, Stats Table
    const leftCard = h('div', 'fc-card');
    const top = h('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;';
    top.innerHTML = `
      <div style="display:flex;gap:14px;align-items:center;">
        ${renderJerseySvg(club.homeKit, 66, pro.number)}
        <div>
          <div class="fc-label">${club.name} · #${pro.number} ${pro.pos} · ${pro.preferredFoot} Foot</div>
          <h2 class="fc-title" style="margin:3px 0;">${pro.name}</h2>
          <div style="font-size:12px;color:rgba(218,228,244,.75);">${pro.age} yrs · ${pro.nationality} (${nt.name}: ${pro.calledUp ? 'ACTIVE IN SQUAD' : 'CLUB FOCUS ONLY'})</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="fc-badge fc-badge-gold fc-num" style="font-size:18px;padding:6px 12px;">${pro.ovr} OVR</div>
        <div style="font-size:11px;margin-top:6px;color:rgba(218,228,244,.75);">Coach Trust: <b>${pro.coachTrust}/100</b> (${pro.coachTrust >= 42 ? 'Starter' : 'Bench'})</div>
      </div>
    `;
    leftCard.appendChild(top);

    const attrGrid = h('div', 'fc-grid-3');
    attrGrid.style.marginTop = '16px';
    Object.entries(pro.attrs).forEach(([k, val]) => {
      const xp = pro.attrXp?.[k] || 0;
      const box = h('div');
      box.style.cssText = 'padding:9px 11px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);';
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span class="fc-label">${k}</span>
          <span class="fc-muted fc-num" style="font-size:9.5px;">${xp}/100 XP</span>
        </div>
        <div class="fc-num" style="font-size:20px;font-weight:900;color:${val >= 82 ? '#4ade80' : val >= 72 ? '#f4cd72' : '#eef2f8'};">${val}</div>
        <div class="fc-xp-track"><div class="fc-xp-fill" style="width:${Math.min(100, xp)}%;"></div></div>
      `;
      attrGrid.appendChild(box);
    });
    leftCard.appendChild(attrGrid);

    // Season vs Career Stats
    const stTable = h('table', 'fc-table');
    stTable.style.marginTop = '16px';
    stTable.innerHTML = `
      <thead><tr><th>Metric</th><th>Season ${career.season}</th><th>Career Total</th></tr></thead>
      <tbody>
        <tr><td>Appearances</td><td>${pro.seasonStats.apps}</td><td>${pro.careerStats.apps}</td></tr>
        <tr><td>Goals</td><td>${pro.seasonStats.goals}</td><td>${pro.careerStats.goals}</td></tr>
        <tr><td>Assists</td><td>${pro.seasonStats.assists}</td><td>${pro.careerStats.assists}</td></tr>
        <tr><td>Avg Match Rating</td><td><b>${pro.seasonStats.avgRating ? pro.seasonStats.avgRating.toFixed(1) : '-'}</b></td><td><b>${pro.careerStats.avgRating ? pro.careerStats.avgRating.toFixed(1) : '-'}</b></td></tr>
        <tr><td>Man of the Match</td><td>${pro.seasonStats.motm}</td><td>${pro.careerStats.motm}</td></tr>
        <tr><td>Key Passes / Tackles</td><td>${pro.seasonStats.keyPasses} / ${pro.seasonStats.tackles}</td><td>${pro.careerStats.keyPasses} / ${pro.careerStats.tackles}</td></tr>
        <tr><td>Cards (Y / R)</td><td>${pro.seasonStats.yellows} / ${pro.seasonStats.reds}</td><td>${pro.careerStats.yellows} / ${pro.careerStats.reds}</td></tr>
      </tbody>
    `;
    leftCard.appendChild(stTable);

    const editRow = h('div');
    editRow.style.cssText = 'display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;';
    const editBtn = h('button', 'fc-btn fc-btn-gold', 'EDIT PLAYER / QUICK TRANSFER');
    editBtn.dataset.testid = 'btn-edit-transfer-pro';
    editBtn.addEventListener('click', () => openQuickEditModal());
    const goTrainBtn = h('button', 'fc-btn', 'GO TO TRAINING →');
    goTrainBtn.addEventListener('click', () => { hubTab = 'training'; render(); });
    editRow.appendChild(editBtn);
    editRow.appendChild(goTrainBtn);
    leftCard.appendChild(editRow);
    grid.appendChild(leftCard);

    // Right: World Perception & Unconditional NT Decision Desk + Rating History & Trophies
    const rightCol = h('div');
    rightCol.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const ntCard = h('div', 'fc-card');
    ntCard.dataset.testid = 'nt-decision-desk';
    const ntHead = h('div');
    ntHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;';
    ntHead.appendChild(h('div', 'fc-label fc-gold', `${opinion.nation.name.toUpperCase()} NT · WORLD PERCEPTION AI`));
    const statusBadgeText = pro.calledUp
      ? `ACTIVE · PLAYING FOR ${opinion.nation.abbr}`
      : pro.ntDecision === 'declined'
        ? 'DECLINED · CLUB FOCUS'
        : 'NOT CALLED UP YET';
    const ntStatusBadge = h('span', `fc-badge ${pro.calledUp ? 'fc-badge-blue' : ''}`, statusBadgeText);
    ntStatusBadge.dataset.testid = 'nt-user-status';
    ntHead.appendChild(ntStatusBadge);
    ntCard.appendChild(ntHead);

    const meterColor = opinion.readinessScore >= 82 ? '#4ade80' : opinion.readinessScore >= 68 ? '#38bdf8' : opinion.readinessScore >= 52 ? '#f4cd72' : '#94a3b8';
    const meterWrap = h('div');
    meterWrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px;">
        <span>World Readiness: <b data-testid="nt-readiness-tier">${opinion.tierLabel}</b></span>
        <b class="fc-num" data-testid="nt-readiness-score" style="font-size:15px;color:${meterColor};">${opinion.readinessScore}/100</b>
      </div>
      <div class="fc-nt-meter"><div class="fc-nt-fill" style="width:${opinion.readinessScore}%;background:${meterColor};"></div></div>
      <div style="font-size:12.5px;font-weight:800;margin-bottom:4px;">${opinion.headline}</div>
      <div class="fc-muted" style="font-size:11.5px;font-style:italic;line-height:1.45;">${opinion.selectorQuote}</div>
      <div class="fc-muted fc-num" style="font-size:11px;margin-top:8px;">
        Your OVR: <b style="color:#eef2f8;">${opinion.userOvr}</b> · NT ${pro.role} Threshold: <b style="color:#eef2f8;">${opinion.thresholdOvr} OVR</b> · Position Depth Rank: <b style="color:#f4cd72;">#${opinion.positionRank}</b>
      </div>
    `;
    ntCard.appendChild(meterWrap);

    if (opinion.competitors && opinion.competitors.length) {
      const compLine = h('div');
      compLine.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;';
      opinion.competitors.forEach((c) => {
        compLine.appendChild(h('span', 'fc-badge', `${c.pos} ${c.name} (${c.ovr})`));
      });
      ntCard.appendChild(compLine);
    }

    const ntNote = h('div', 'fc-muted', 'World AI opinion is advisory only — you decide whether to represent your National Team or focus on club football anytime.');
    ntNote.style.cssText = 'font-size:11px;margin-top:10px;line-height:1.4;';
    ntCard.appendChild(ntNote);

    const ntBtns = h('div');
    ntBtns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;';
    const joinBtn = h('button', `fc-btn ${pro.calledUp ? '' : 'fc-btn-gold'}`, `JOIN ${opinion.nation.abbr} NATIONAL TEAM`);
    joinBtn.dataset.testid = 'btn-nt-join';
    joinBtn.style.flex = '1';
    joinBtn.addEventListener('click', () => {
      setNationalTeamSelection(career, true);
      showToast(`You chose to represent ${opinion.nation.name}!`);
      render();
    });
    const declineBtn = h('button', `fc-btn ${!pro.calledUp && pro.ntDecision === 'declined' ? 'fc-btn-gold' : ''}`, 'DECLINE / CLUB FOCUS ONLY');
    declineBtn.dataset.testid = 'btn-nt-decline';
    declineBtn.style.flex = '1';
    declineBtn.addEventListener('click', () => {
      setNationalTeamSelection(career, false);
      showToast(`You chose club focus only — stepped away from ${opinion.nation.abbr}.`);
      render();
    });
    ntBtns.appendChild(joinBtn);
    ntBtns.appendChild(declineBtn);
    ntCard.appendChild(ntBtns);
    rightCol.appendChild(ntCard);

    const rightCard = h('div', 'fc-card');
    rightCard.appendChild(h('div', 'fc-label', 'RECENT MATCH RATING HISTORY')).style.marginBottom = '8px';
    if (!pro.ratingHistory.length) {
      rightCard.appendChild(h('div', 'fc-muted', 'No recorded matches yet.')).style.fontSize = '12px';
    } else {
      const list = h('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;';
      pro.ratingHistory.slice(0, 12).forEach((m) => {
        const row = h('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:7px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);font-size:12px;';
        row.innerHTML = `<div><b>${m.scoreline}</b><div style="font-size:10px;color:rgba(218,228,244,.65);">S${m.season} · ${m.compName} · ${m.goals}G ${m.assists}A${m.motm ? ' · MOTM' : ''}</div></div><b class="fc-num" style="font-size:15px;color:${ratingColor(m.rating)};">${m.rating.toFixed(1)}</b>`;
        list.appendChild(row);
      });
      rightCard.appendChild(list);
    }

    rightCard.appendChild(h('div', 'fc-label', 'TROPHY CABINET')).style.cssText = 'margin-top:16px;margin-bottom:8px;';
    if (!pro.trophies.length) {
      rightCard.appendChild(h('div', 'fc-muted', 'Win League Titles, Domestic Cups, Europe, or International Tournaments to fill your cabinet.')).style.fontSize = '12px';
    } else {
      pro.trophies.forEach((tr) => {
        rightCard.appendChild(h('div', 'fc-badge fc-badge-gold', `S${tr.season} · ${tr.compName} (${tr.clubName})`)).style.margin = '0 6px 6px 0';
      });
    }
    rightCol.appendChild(rightCard);
    grid.appendChild(rightCol);
    shell.appendChild(grid);
  }

  function openQuickEditModal() {
    const pro = career.pro;
    const bg = h('div', 'fc-modal-bg');
    const modal = h('div', 'fc-card fc-modal');
    modal.appendChild(h('h3', 'fc-title', 'Edit Pro & Quick Transfer')).style.marginBottom = '12px';

    const form = h('div');
    form.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    const nameIn = h('input', 'fc-input');
    nameIn.type = 'text';
    nameIn.autocomplete = 'off';
    nameIn.spellcheck = false;
    nameIn.maxLength = 24;
    nameIn.value = pro.name;
    nameIn.placeholder = 'e.g. Alex Hunter';
    nameIn.addEventListener('focus', () => { try { nameIn.select(); } catch (_) {} });

    const numIn = h('input', 'fc-input');
    numIn.type = 'text';
    numIn.inputMode = 'numeric';
    numIn.pattern = '[0-9]*';
    numIn.maxLength = 2;
    numIn.value = String(pro.number);
    numIn.placeholder = 'e.g. 10';
    numIn.addEventListener('input', () => {
      const digits = numIn.value.replace(/[^0-9]/g, '');
      if (numIn.value !== digits) numIn.value = digits;
    });
    numIn.addEventListener('blur', () => {
      const val = parseInt(numIn.value, 10);
      const clean = (!isNaN(val) && val >= 1 && val <= 99) ? val : pro.number;
      numIn.value = String(clean);
    });
    numIn.addEventListener('focus', () => { try { numIn.select(); } catch (_) {} });

    const posSel = h('select', 'fc-select');
    POSITIONS.forEach((p) => { const o = h('option', '', p); o.value = p; if (p === pro.pos) o.selected = true; posSel.appendChild(o); });

    const clubSel = h('select', 'fc-select');
    clubSel.dataset.testid = 'select-transfer-club';
    CLUBS.forEach((c) => {
      const o = h('option', '', `${c.name} (${c.rating} OVR)`);
      o.value = c.id;
      if (c.id === pro.clubId) o.selected = true;
      clubSel.appendChild(o);
    });

    const addRow = (lbl, el) => {
      const w = h('div');
      w.appendChild(h('div', 'fc-label', lbl)).style.marginBottom = '4px';
      w.appendChild(el);
      form.appendChild(w);
    };
    addRow('Name', nameIn);
    addRow('Position', posSel);
    addRow('Shirt Number (1-99)', numIn);
    addRow('Transfer Club', clubSel);

    const paceIn = h('input', 'fc-input'); paceIn.type = 'number'; paceIn.value = String(pro.attrs.pace);
    const shootIn = h('input', 'fc-input'); shootIn.type = 'number'; shootIn.value = String(pro.attrs.shooting);
    const passIn = h('input', 'fc-input'); passIn.type = 'number'; passIn.value = String(pro.attrs.passing);
    const attrRow = h('div', 'fc-grid-3');
    attrRow.appendChild(paceIn); attrRow.appendChild(shootIn); attrRow.appendChild(passIn);
    form.appendChild(h('div', 'fc-label', 'Quick Stat Sync (Pace / Shooting / Passing)'));
    form.appendChild(attrRow);

    const btns = h('div');
    btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:12px;';
    const cancel = h('button', 'fc-btn', 'CANCEL');
    cancel.addEventListener('click', () => bg.remove());
    const saveBtn = h('button', 'fc-btn fc-btn-gold', 'SAVE CHANGES');
    saveBtn.dataset.testid = 'btn-save-edit-pro';
    saveBtn.addEventListener('click', () => {
      const cleanName = (nameIn.value || '').trim() || pro.name;
      const parsedNum = parseInt(numIn.value, 10);
      const cleanNum = (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= 99) ? parsedNum : pro.number;
      quickEditPro(career, {
        name: cleanName,
        pos: posSel.value,
        number: cleanNum,
        clubId: clubSel.value,
        attrs: { ...pro.attrs, pace: paceIn.value, shooting: shootIn.value, passing: passIn.value },
      });
      bg.remove();
      showToast('Player profile / transfer updated!');
      render();
    });
    btns.appendChild(cancel);
    btns.appendChild(saveBtn);
    form.appendChild(btns);
    modal.appendChild(form);
    bg.appendChild(modal);
    document.body.appendChild(bg);
  }

  // ---- TAB 2B: TRAINING & 3D PITCH DRILLS ----------------------------------

  function renderHubTraining(shell) {
    const pro = career.pro;
    const status = getTrainingStatus(career);
    const outOfSessions = status.remaining <= 0;

    // Header Summary & Attributes XP Card
    const topCard = h('div', 'fc-card');
    const headRow = h('div');
    headRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;';
    const hLeft = h('div');
    hLeft.appendChild(h('div', 'fc-label fc-gold', 'PLAYER DEVELOPMENT & PITCH DRILLS'));
    hLeft.appendChild(h('h2', 'fc-title', `${pro.name} · ${pro.ovr} OVR (${pro.pos})`)).style.marginTop = '2px';
    headRow.appendChild(hLeft);

    const badgeCol = h('div');
    badgeCol.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    const remBadge = h(
      'span',
      `fc-badge fc-num ${outOfSessions ? '' : 'fc-badge-green'}`,
      `${status.remaining} / ${status.maxPerWeek} SESSIONS LEFT THIS MATCHWEEK`,
    );
    remBadge.dataset.testid = 'training-remaining-badge';
    badgeCol.appendChild(remBadge);
    headRow.appendChild(badgeCol);
    topCard.appendChild(headRow);

    if (lastDrillResult && lastDrillResult.ok) {
      const banner = h('div');
      banner.dataset.testid = 'training-result-banner';
      banner.style.cssText = 'padding:11px 14px;border-radius:10px;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.38);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;';
      const xpParts = Object.entries(lastDrillResult.xpAdded || {}).map(([k, v]) => `${k.toUpperCase()} +${v} XP`).join(' · ');
      const gainParts = Object.entries(lastDrillResult.gains || {}).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', ');
      const ovrPop = lastDrillResult.newOvr > lastDrillResult.oldOvr ? ` · OVR ${lastDrillResult.oldOvr} → ${lastDrillResult.newOvr}!` : '';
      const info = h('div');
      info.innerHTML = `<div style="font-size:12.5px;font-weight:900;color:#86efac;">${lastDrillResult.drill.title} · ${lastDrillResult.mode === '3d' ? `${lastDrillResult.grade} (${lastDrillResult.score} pts)` : 'Quick Focus'}${ovrPop}</div><div class="fc-muted fc-num" style="font-size:11px;margin-top:2px;">${xpParts}${gainParts ? ` · ATTRIBUTE UP: ${gainParts}` : ''}</div>`;
      const dis = h('button', 'fc-btn fc-btn-sm', 'DISMISS');
      dis.addEventListener('click', () => { lastDrillResult = null; render(); });
      banner.appendChild(info);
      banner.appendChild(dis);
      topCard.appendChild(banner);
    }

    if (outOfSessions) {
      const warn = h('div', 'fc-muted', '0 sessions left this matchweek — play or simulate your next match to unlock fresh weekly training sessions.');
      warn.style.cssText = 'font-size:12px;padding:8px 12px;border-radius:8px;background:rgba(244,205,114,.08);border:1px solid rgba(244,205,114,.28);margin-bottom:12px;';
      topCard.appendChild(warn);
    }

    // 6 Attributes with XP Bars
    const attrGrid = h('div', 'fc-grid-3');
    [
      ['pace', 'Pace'], ['shooting', 'Shooting'], ['passing', 'Passing'],
      ['dribbling', 'Dribbling'], ['defending', 'Defending'], ['physical', 'Physical'],
    ].forEach(([k, lbl]) => {
      const val = pro.attrs[k] || 70;
      const xp = pro.attrXp?.[k] || 0;
      const box = h('div');
      box.style.cssText = 'padding:10px 12px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);';
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span class="fc-label">${lbl}</span>
          <span class="fc-muted fc-num" data-testid="attr-xp-${k}" style="font-size:10px;">${xp}/100 XP to +1</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:2px;">
          <b class="fc-num" data-testid="attr-val-${k}" style="font-size:22px;color:${val >= 82 ? '#4ade80' : val >= 72 ? '#f4cd72' : '#eef2f8'};">${val}</b>
          <span class="fc-muted" style="font-size:10px;">Max 99</span>
        </div>
        <div class="fc-xp-track"><div class="fc-xp-fill" style="width:${Math.min(100, xp)}%;"></div></div>
      `;
      attrGrid.appendChild(box);
    });
    topCard.appendChild(attrGrid);
    shell.appendChild(topCard);

    // 4 Drill Cards
    const drillGrid = h('div', 'fc-grid-2');
    TRAINING_DRILLS.forEach((d) => {
      const card = h('div', 'fc-card');
      const pb = status.highScores?.[d.id] || 0;
      const head = h('div');
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;';
      head.innerHTML = `
        <div>
          <div class="fc-label fc-gold">${d.focus.map((f) => f.toUpperCase()).join(' · ')}</div>
          <h3 style="margin:3px 0 0;font-size:16px;font-weight:900;">${d.title}</h3>
        </div>
        <span class="fc-badge fc-num">BEST: ${pb}</span>
      `;
      card.appendChild(head);
      card.appendChild(h('p', 'fc-muted', d.desc)).style.cssText = 'font-size:12px;line-height:1.45;margin:4px 0 10px;';
      card.appendChild(h('div', 'fc-muted fc-num', `Targets (${d.duration}s): Silver ${d.silverScore} · Gold ${d.goldScore} · Elite ${d.eliteScore}`)).style.cssText = 'font-size:11px;margin-bottom:12px;';

      const acts = h('div');
      acts.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
      const play3dBtn = h('button', 'fc-btn fc-btn-gold', `PLAY 3D DRILL (${d.duration}s) →`);
      play3dBtn.dataset.testid = `btn-drill-3d-${d.id}`;
      play3dBtn.disabled = outOfSessions;
      play3dBtn.style.flex = '1';
      play3dBtn.addEventListener('click', () => {
        if (outOfSessions || !onLaunchDrill) return;
        showScreen('hidden');
        onLaunchDrill({
          career,
          drillId: d.id,
          duration: d.duration,
          cameraMode: career.prefs?.cameraMode || 'broadcast',
        });
      });

      const quickBtn = h('button', 'fc-btn', 'QUICK SESSION');
      quickBtn.dataset.testid = `btn-drill-quick-${d.id}`;
      quickBtn.disabled = outOfSessions;
      quickBtn.addEventListener('click', () => {
        const res = applyTrainingSession(career, d.id, { mode: 'quick' });
        if (!res.ok) {
          showToast('No sessions remaining this matchweek!');
          return;
        }
        lastDrillResult = res;
        showToast(`${d.short} Focus completed!${res.newOvr > res.oldOvr ? ` OVR ${res.oldOvr} → ${res.newOvr}!` : ''}`);
        render();
      });

      acts.appendChild(play3dBtn);
      acts.appendChild(quickBtn);
      card.appendChild(acts);
      drillGrid.appendChild(card);
    });
    shell.appendChild(drillGrid);

    // Recent Training Log
    const logCard = h('div', 'fc-card');
    logCard.appendChild(h('div', 'fc-label', 'RECENT TRAINING SESSIONS')).style.marginBottom = '8px';
    if (!status.history.length) {
      logCard.appendChild(h('div', 'fc-muted', 'Complete a 3D Drill or Quick Session above to track your attribute growth.')).style.fontSize = '12px';
    } else {
      const tbl = h('table', 'fc-table');
      tbl.innerHTML = '<thead><tr><th>Date</th><th>Drill</th><th>Mode</th><th>Grade / Score</th><th>Attribute Gains</th><th>OVR</th></tr></thead>';
      const tb = h('tbody');
      status.history.slice(0, 10).forEach((row) => {
        const tr = h('tr');
        const gTxt = Object.entries(row.gains || {}).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', ') || '+XP';
        tr.innerHTML = `<td>${row.date}</td><td><b>${row.drillTitle}</b></td><td>${row.mode === '3d' ? '3D Pitch' : 'Quick'}</td><td>${row.grade}${row.score ? ` (${row.score})` : ''}</td><td>${gTxt}</td><td><b>${row.ovrAfter}</b></td>`;
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      logCard.appendChild(tbl);
    }
    shell.appendChild(logCard);
  }

  // ---- TAB 2C: OPEN GLOBAL TRANSFER MARKET (ALL 96 CLUBS) -----------------

  function renderHubMarket(shell) {
    const pro = career.pro;
    if (!mkt.fromClubId || !career.clubsState?.[mkt.fromClubId]) {
      const other = CLUBS.find((c) => c.id !== pro.clubId) || CLUBS[0];
      mkt.fromClubId = other.id;
    }
    if (!mkt.toClubId || !career.clubsState?.[mkt.toClubId]) {
      mkt.toClubId = pro.clubId;
    }

    const filterClubs = (leagueId) => (leagueId === 'all' ? CLUBS : getClubsByLeague(leagueId));
    const fromClubs = filterClubs(mkt.fromFilter);
    const toClubs = filterClubs(mkt.toFilter);

    const fromTeam = getTeamById(mkt.fromClubId);
    const toTeam = getTeamById(mkt.toClubId);
    const fromSt = career.clubsState[mkt.fromClubId];
    const toSt = career.clubsState[mkt.toClubId];

    // Build Selling Club player pool (including Pro if Pro plays there)
    const pool = [];
    if (pro.clubId === mkt.fromClubId) {
      pool.push({
        id: pro.id,
        name: pro.name,
        pos: pro.pos,
        role: pro.role,
        ovr: pro.ovr,
        age: pro.age,
        isPro: true,
      });
    }
    (fromSt?.squad || []).slice().sort((a, b) => b.ovr - a.ovr).forEach((p) => {
      pool.push({ ...p, isPro: false });
    });

    const query = (mkt.search || '').trim().toLowerCase();
    const visiblePool = query
      ? pool.filter((p) => p.name.toLowerCase().includes(query) || p.pos.toLowerCase().includes(query))
      : pool;

    let selectedPlayer = pool.find((p) => p.id === mkt.selectedId && !!p.isPro === !!mkt.selectedIsPro);
    if (!selectedPlayer && visiblePool.length) {
      selectedPlayer = visiblePool[0];
      mkt.selectedId = selectedPlayer.id;
      mkt.selectedIsPro = !!selectedPlayer.isPro;
      mkt.feeM = estimatePlayerValueM(selectedPlayer);
    }

    const topCard = h('div', 'fc-card');
    topCard.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <div class="fc-label fc-gold">OPEN GLOBAL TRANSFER MARKET · 96 CLUBS</div>
          <h2 class="fc-title" style="margin:2px 0;">Move Any Player · Custom Fees & Club Budgets</h2>
        </div>
        <div class="fc-muted" style="font-size:11.5px;">Buyer loses transfer fee from budget · Seller gains exact fee</div>
      </div>
    `;
    shell.appendChild(topCard);

    const grid = h('div', 'fc-grid-2');

    // Left Card: Selling Club & Squad Picker
    const sellCard = h('div', 'fc-card');
    sellCard.appendChild(h('div', 'fc-label', '1. SELLING CLUB & PLAYER')).style.marginBottom = '8px';

    const sellFilters = h('div');
    sellFilters.style.cssText = 'display:grid;grid-template-columns:130px 1fr;gap:8px;margin-bottom:8px;';
    const fromLgSel = h('select', 'fc-select');
    fromLgSel.dataset.testid = 'market-from-filter';
    [['all', 'All Leagues'], ...LEAGUES.map((l) => [l.id, l.name])].forEach(([id, nm]) => {
      const o = h('option', '', nm);
      o.value = id;
      if (mkt.fromFilter === id) o.selected = true;
      fromLgSel.appendChild(o);
    });
    fromLgSel.addEventListener('change', () => {
      mkt.fromFilter = fromLgSel.value;
      const list = filterClubs(mkt.fromFilter);
      if (list.length && !list.some((c) => c.id === mkt.fromClubId)) {
        mkt.fromClubId = list[0].id;
        mkt.selectedId = null;
      }
      render();
    });

    const fromClubSel = h('select', 'fc-select');
    fromClubSel.dataset.testid = 'market-from-club';
    fromClubs.forEach((c) => {
      const st = career.clubsState[c.id];
      const o = h('option', '', `${c.name} (${st?.rating || c.rating} OVR · €${(st?.budget ?? 0).toFixed(1)}M)`);
      o.value = c.id;
      if (c.id === mkt.fromClubId) o.selected = true;
      fromClubSel.appendChild(o);
    });
    fromClubSel.addEventListener('change', () => {
      mkt.fromClubId = fromClubSel.value;
      mkt.selectedId = null;
      render();
    });
    sellFilters.appendChild(fromLgSel);
    sellFilters.appendChild(fromClubSel);
    sellCard.appendChild(sellFilters);

    const sellBudgetBar = h('div');
    sellBudgetBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);margin-bottom:8px;font-size:12px;';
    sellBudgetBar.innerHTML = `<span><b>${fromTeam.name}</b> · ${fromSt.rating} OVR · ${fromSt.squad.length} Players</span><b class="fc-gold fc-num" data-testid="market-seller-budget">Budget: €${(fromSt.budget ?? 0).toFixed(1)}M</b>`;
    sellCard.appendChild(sellBudgetBar);

    const listWrap = h('div', 'fc-market-list');
    const populateMarketList = () => {
      listWrap.innerHTML = '';
      const q = (mkt.search || '').trim().toLowerCase();
      const filtered = q
        ? pool.filter((p) => p.name.toLowerCase().includes(q) || p.pos.toLowerCase().includes(q))
        : pool;
      if (!filtered.length) {
        listWrap.appendChild(h('div', 'fc-muted', 'No players match that search.')).style.padding = '8px';
        return;
      }
      filtered.forEach((p) => {
        const valM = estimatePlayerValueM(p);
        const isSel = selectedPlayer && selectedPlayer.id === p.id && !!selectedPlayer.isPro === !!p.isPro;
        const btn = h('button', `fc-squad-row${isSel ? ' is-selected' : ''}`);
        btn.type = 'button';
        btn.dataset.testid = p.isPro ? 'market-player-pro' : `market-player-${p.id}`;
        btn.innerHTML = `
          <span class="fc-label" style="color:${p.isPro ? '#f4cd72' : '#7dd3fc'};">${p.pos}</span>
          <div>
            <div style="font-size:12.5px;font-weight:${p.isPro ? '900' : '700'};color:${p.isPro ? '#f4cd72' : '#eef2f8'};">${p.name}${p.isPro ? ' ★ MY PRO' : ''}</div>
            <div class="fc-muted fc-num" style="font-size:10px;">Age ${p.age || 24} · Est. €${valM.toFixed(1)}M</div>
          </div>
          <span class="fc-muted fc-num" style="font-size:10.5px;text-align:center;">€${valM.toFixed(1)}M</span>
          <span class="fc-ovr-num">${p.ovr}</span>
        `;
        btn.addEventListener('click', () => {
          mkt.selectedId = p.id;
          mkt.selectedIsPro = !!p.isPro;
          mkt.feeM = valM;
          render();
        });
        listWrap.appendChild(btn);
      });
    };

    const searchIn = h('input', 'fc-input');
    searchIn.type = 'text';
    searchIn.placeholder = 'Search player name or position...';
    searchIn.dataset.testid = 'market-search';
    searchIn.value = mkt.search;
    searchIn.style.marginBottom = '8px';
    searchIn.addEventListener('input', () => {
      mkt.search = searchIn.value;
      populateMarketList();
    });
    sellCard.appendChild(searchIn);

    populateMarketList();
    sellCard.appendChild(listWrap);
    grid.appendChild(sellCard);

    // Right Card: Buying Club, Custom Fee & Transfer Execution
    const buyCard = h('div', 'fc-card');
    buyCard.appendChild(h('div', 'fc-label', '2. BUYING CLUB & TRANSFER FEE')).style.marginBottom = '8px';

    const buyFilters = h('div');
    buyFilters.style.cssText = 'display:grid;grid-template-columns:130px 1fr;gap:8px;margin-bottom:8px;';
    const toLgSel = h('select', 'fc-select');
    toLgSel.dataset.testid = 'market-to-filter';
    [['all', 'All Leagues'], ...LEAGUES.map((l) => [l.id, l.name])].forEach(([id, nm]) => {
      const o = h('option', '', nm);
      o.value = id;
      if (mkt.toFilter === id) o.selected = true;
      toLgSel.appendChild(o);
    });
    toLgSel.addEventListener('change', () => {
      mkt.toFilter = toLgSel.value;
      const list = filterClubs(mkt.toFilter);
      if (list.length && !list.some((c) => c.id === mkt.toClubId)) {
        mkt.toClubId = list[0].id;
      }
      render();
    });

    const toClubSel = h('select', 'fc-select');
    toClubSel.dataset.testid = 'market-to-club';
    toClubs.forEach((c) => {
      const st = career.clubsState[c.id];
      const o = h('option', '', `${c.name} (${st?.rating || c.rating} OVR · €${(st?.budget ?? 0).toFixed(1)}M)`);
      o.value = c.id;
      if (c.id === mkt.toClubId) o.selected = true;
      toClubSel.appendChild(o);
    });
    toClubSel.addEventListener('change', () => {
      mkt.toClubId = toClubSel.value;
      render();
    });
    buyFilters.appendChild(toLgSel);
    buyFilters.appendChild(toClubSel);
    buyCard.appendChild(buyFilters);

    const buyBudgetBar = h('div');
    buyBudgetBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);margin-bottom:12px;font-size:12px;';
    buyBudgetBar.innerHTML = `<span><b>${toTeam.name}</b> · ${toSt.rating} OVR · ${toSt.squad.length} Players</span><b class="fc-gold fc-num" data-testid="market-buyer-budget">Budget: €${(toSt.budget ?? 0).toFixed(1)}M</b>`;
    buyCard.appendChild(buyBudgetBar);

    const estVal = selectedPlayer ? estimatePlayerValueM(selectedPlayer) : 0;

    const dealBox = h('div');
    dealBox.style.cssText = 'padding:12px 14px;border-radius:10px;background:rgba(244,205,114,.06);border:1px solid rgba(244,205,114,.28);margin-bottom:12px;';
    dealBox.innerHTML = selectedPlayer
      ? `<div class="fc-label fc-gold">SELECTED TRANSFER TARGET</div>
         <div style="font-size:16px;font-weight:900;margin:4px 0;">${selectedPlayer.name} <span class="fc-badge fc-badge-gold fc-num">${selectedPlayer.pos} · ${selectedPlayer.ovr} OVR</span></div>
         <div class="fc-muted fc-num" style="font-size:11.5px;">${fromTeam.name} → ${toTeam.name} · Estimated Value €${estVal.toFixed(1)}M</div>`
      : '<div class="fc-muted">Select a player from the Selling Club roster on the left.</div>';
    buyCard.appendChild(dealBox);

    // Custom Fee Input
    buyCard.appendChild(h('div', 'fc-label', 'CUSTOM TRANSFER FEE (€M)')).style.marginBottom = '4px';
    const feeIn = h('input', 'fc-input fc-num');
    feeIn.type = 'number';
    feeIn.min = '0';
    feeIn.step = '0.5';
    feeIn.dataset.testid = 'market-fee-input';
    feeIn.value = String(mkt.feeM);
    feeIn.addEventListener('input', () => {
      const v = parseFloat(feeIn.value);
      mkt.feeM = Number.isNaN(v) ? 0 : Math.max(0, v);
      updatePreview();
    });
    buyCard.appendChild(feeIn);

    const quickFees = h('div');
    quickFees.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px;';
    [
      ['FREE €0M', 0],
      ['EST. VALUE', estVal],
      ['€25M', 25],
      ['€50M', 50],
      ['€100M', 100],
    ].forEach(([lbl, val]) => {
      const b = h('button', 'fc-btn-pill fc-num', lbl);
      b.type = 'button';
      b.addEventListener('click', () => {
        mkt.feeM = val;
        feeIn.value = String(val);
        updatePreview();
      });
      quickFees.appendChild(b);
    });
    buyCard.appendChild(quickFees);

    const previewEl = h('div');
    previewEl.dataset.testid = 'market-budget-preview';
    previewEl.style.cssText = 'padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);font-size:12px;margin-bottom:10px;';
    const updatePreview = () => {
      const f = Math.max(0, Math.round((Number(mkt.feeM) || 0) * 10) / 10);
      const sellerAfter = Math.round(((fromSt.budget ?? 0) + f) * 10) / 10;
      const buyerAfter = Math.round(((toSt.budget ?? 0) - f) * 10) / 10;
      previewEl.innerHTML = `
        <div class="fc-num" style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span>Seller (${fromTeam.abbr}) gains +€${f.toFixed(1)}M:</span>
          <b style="color:#4ade80;">€${(fromSt.budget ?? 0).toFixed(1)}M → €${sellerAfter.toFixed(1)}M</b>
        </div>
        <div class="fc-num" style="display:flex;justify-content:space-between;">
          <span>Buyer (${toTeam.abbr}) spends -€${f.toFixed(1)}M:</span>
          <b style="color:${buyerAfter < 0 ? '#f87171' : '#f4cd72'};">€${(toSt.budget ?? 0).toFixed(1)}M → €${buyerAfter.toFixed(1)}M</b>
        </div>
      `;
    };
    updatePreview();
    buyCard.appendChild(previewEl);

    const ovRow = h('label');
    ovRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:12px;cursor:pointer;';
    const ovCheck = h('input');
    ovCheck.type = 'checkbox';
    ovCheck.checked = !!mkt.allowOverBudget;
    ovCheck.dataset.testid = 'market-override-budget';
    ovCheck.addEventListener('change', () => { mkt.allowOverBudget = !!ovCheck.checked; });
    ovRow.appendChild(ovCheck);
    ovRow.appendChild(h('span', 'fc-muted', 'Allow Negative / Debt Override (ignore buyer budget cap)'));
    buyCard.appendChild(ovRow);

    const execBtn = h('button', 'fc-btn fc-btn-gold', 'EXECUTE TRANSFER →');
    execBtn.dataset.testid = 'btn-confirm-transfer';
    execBtn.style.width = '100%';
    execBtn.style.padding = '12px 18px';
    execBtn.disabled = !selectedPlayer || mkt.fromClubId === mkt.toClubId;
    execBtn.addEventListener('click', () => {
      if (!selectedPlayer) return;
      const res = executeGlobalTransfer(career, {
        playerId: selectedPlayer.id,
        fromClubId: mkt.fromClubId,
        toClubId: mkt.toClubId,
        feeM: mkt.feeM,
        isPro: !!selectedPlayer.isPro,
        allowOverBudget: mkt.allowOverBudget,
      });
      if (!res.ok) {
        if (res.reason === 'insufficient_budget') {
          showToast(`${toTeam.abbr} has €${res.buyerBudget.toFixed(1)}M (needs €${res.feeM.toFixed(1)}M) — lower fee or enable Debt Override.`);
        } else if (res.reason === 'min_squad_size') {
          showToast(`${fromTeam.abbr} needs at least 12 squad players.`);
        } else if (res.reason === 'need_one_gk') {
          showToast(`${fromTeam.abbr} must keep at least 1 Goalkeeper.`);
        } else if (res.reason === 'same_club') {
          showToast('Pick two different clubs to complete a transfer.');
        } else {
          showToast('Unable to complete transfer.');
        }
        return;
      }
      mkt.selectedId = null;
      showToast(`Transferred ${res.entry.playerName} (${fromTeam.abbr} → ${toTeam.abbr}) for €${res.entry.feeM.toFixed(1)}M!`);
      render();
    });
    buyCard.appendChild(execBtn);
    grid.appendChild(buyCard);
    shell.appendChild(grid);

    // Transfer Ledger
    const ledgerCard = h('div', 'fc-card');
    ledgerCard.appendChild(h('div', 'fc-label', 'GLOBAL TRANSFER LEDGER')).style.marginBottom = '8px';
    const history = career.transferHistory || [];
    if (!history.length) {
      ledgerCard.appendChild(h('div', 'fc-muted', 'No transfers recorded yet. Move any player above with custom fees.')).style.fontSize = '12px';
    } else {
      const tbl = h('table', 'fc-table');
      tbl.dataset.testid = 'market-ledger-table';
      tbl.innerHTML = '<thead><tr><th>Date</th><th>Player</th><th>Pos</th><th>OVR</th><th>From</th><th>To</th><th>Fee</th></tr></thead>';
      const tb = h('tbody');
      history.slice(0, 25).forEach((trEntry) => {
        const tr = h('tr', trEntry.isPro ? 'is-user' : '');
        const fT = getTeamById(trEntry.fromClubId);
        const tT = getTeamById(trEntry.toClubId);
        tr.innerHTML = `<td>${trEntry.date}</td><td><b>${trEntry.playerName}${trEntry.isPro ? ' ★' : ''}</b></td><td>${trEntry.pos}</td><td>${trEntry.ovr}</td><td>${fT.name}</td><td>${tT.name}</td><td class="fc-gold"><b>€${Number(trEntry.feeM || 0).toFixed(1)}M</b></td>`;
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      ledgerCard.appendChild(tbl);
    }
    shell.appendChild(ledgerCard);
  }

  // ---- TAB 3: COMPETITIONS -------------------------------------------------

  function renderHubCompetitions(shell) {
    const comps = Object.values(career.competitions);
    if (!selectedCompId || !career.competitions[selectedCompId]) selectedCompId = comps[0].id;
    const comp = career.competitions[selectedCompId];

    // Competition selector chips
    const selCard = h('div', 'fc-card');
    const cBar = h('div');
    cBar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    comps.forEach((c) => {
      const b = h('button', `fc-btn-pill${c.id === comp.id ? ' is-on' : ''}`, c.shortName || c.name);
      b.dataset.testid = `comp-${c.id}`;
      b.addEventListener('click', () => {
        selectedCompId = c.id;
        if (c.isKnockout && compSubTab === 'standings') compSubTab = 'bracket';
        if (!c.isKnockout && compSubTab === 'bracket') compSubTab = 'standings';
        render();
      });
      cBar.appendChild(b);
    });
    selCard.appendChild(cBar);

    // Sub-tabs
    const subRow = h('div');
    subRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);';
    const subTabs = comp.isKnockout
      ? [['bracket', 'Knockout Bracket'], ['fixtures', 'Fixtures & Edit Score'], ['managers', 'Managers & Tactics'], ['leaders', 'Stats Leaders']]
      : comp.standings
        ? [['standings', 'Standings'], ['fixtures', 'Fixtures & Edit Score'], ['managers', 'Managers & Tactics'], ['leaders', 'Stats Leaders']]
        : [['fixtures', 'Fixtures & Edit Score'], ['managers', 'Managers & Tactics'], ['leaders', 'Stats Leaders']];
    if (!subTabs.some(([id]) => id === compSubTab)) compSubTab = subTabs[0][0];

    subTabs.forEach(([sid, slbl]) => {
      const b = h('button', `fc-tab${compSubTab === sid ? ' is-on' : ''}`, slbl);
      b.dataset.testid = `subtab-${sid}`;
      b.addEventListener('click', () => { compSubTab = sid; render(); });
      subRow.appendChild(b);
    });
    selCard.appendChild(subRow);
    shell.appendChild(selCard);

    const body = h('div', 'fc-card');
    const userTeamId = (comp.type === 'intl_friendly' || comp.type === 'intl_tourney') ? career.pro.nationalTeamId : career.pro.clubId;

    if (compSubTab === 'standings' && comp.standings) {
      const rows = getStandings(career, comp.id);
      const tbl = h('table', 'fc-table');
      tbl.innerHTML = '<thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Form</th></tr></thead>';
      const tb = h('tbody');
      rows.forEach((r, i) => {
        const t = getTeamById(r.teamId);
        const tr = h('tr', r.teamId === userTeamId ? 'is-user' : '');
        tr.innerHTML = `<td>${i + 1}</td><td>${t.name}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gd >= 0 ? '+' + r.gd : r.gd}</td><td><b>${r.pts}</b></td><td>${(r.form || []).join(' ')}</td>`;
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      body.appendChild(tbl);
    } else if (compSubTab === 'bracket' && comp.isKnockout) {
      comp.roundNames.forEach((rName, rIdx) => {
        const rFx = comp.fixtures.filter((f) => f.roundIdx === rIdx);
        if (!rFx.length) return;
        body.appendChild(h('div', 'fc-label fc-gold', rName)).style.cssText = 'margin:12px 0 6px;';
        const gr = h('div', 'fc-grid-2');
        rFx.forEach((f) => {
          const ht = getTeamById(f.homeId);
          const at = getTeamById(f.awayId);
          const box = h('div');
          box.style.cssText = `padding:9px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.10);background:${(f.homeId === userTeamId || f.awayId === userTeamId) ? 'rgba(244,205,114,.10)' : 'rgba(255,255,255,.03)'};display:flex;justify-content:space-between;align-items:center;font-size:12px;`;
          const scoreStr = f.played ? `<b>${f.scoreH} - ${f.scoreA}</b>${f.penH != null ? ` (${f.penH}-${f.penA}p)` : ''}` : '<span class="fc-muted">vs</span>';
          box.innerHTML = `<span>${ht.name} ${scoreStr} ${at.name}</span>`;
          gr.appendChild(box);
        });
        body.appendChild(gr);
      });
    } else if (compSubTab === 'fixtures') {
      const fxList = comp.fixtures.slice(0, 60);
      const tbl = h('table', 'fc-table');
      tbl.innerHTML = '<thead><tr><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th></th></tr></thead>';
      const tb = h('tbody');
      fxList.forEach((f) => {
        const ht = getTeamById(f.homeId);
        const at = getTeamById(f.awayId);
        const tr = h('tr', (f.homeId === userTeamId || f.awayId === userTeamId) ? 'is-user' : '');
        const scTxt = f.played ? `${f.scoreH} - ${f.scoreA}${f.penH != null ? ` (${f.penH}-${f.penA}p)` : ''}` : 'TBD';
        tr.innerHTML = `<td>${f.roundLabel}</td><td>${ht.name}</td><td><b>${scTxt}</b></td><td>${at.name}</td>`;
        const tdAct = h('td');
        const eb = h('button', 'fc-btn fc-btn-sm', 'EDIT SCORE');
        eb.dataset.testid = `edit-score-${f.id}`;
        eb.addEventListener('click', () => openEditScoreModal(comp, f));
        tdAct.appendChild(eb);
        tr.appendChild(tdAct);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      body.appendChild(tbl);
    } else if (compSubTab === 'managers') {
      const tbl = h('table', 'fc-table');
      tbl.innerHTML = '<thead><tr><th>Club / Nation</th><th>OVR</th><th>Manager</th><th>Tac</th><th>Playing Style</th><th>Formation</th></tr></thead>';
      const tb = h('tbody');
      comp.teams.forEach((tid) => {
        const t = getTeamById(tid);
        const st = career.clubsState[tid] || { rating: t.rating, manager: t.manager };
        const sty = TACTICAL_STYLES[st.manager.style] || TACTICAL_STYLES.balanced;
        const tr = h('tr', tid === userTeamId ? 'is-user' : '');
        tr.innerHTML = `<td>${t.name}</td><td>${st.rating}</td><td><b>${st.manager.name}</b></td><td>${st.manager.tacticalRating}</td><td>${sty.name}</td><td>${sty.formation}</td>`;
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      body.appendChild(tbl);
    } else if (compSubTab === 'leaders') {
      const sBar = h('div');
      sBar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;';
      [['goals', 'Goals'], ['assists', 'Assists'], ['avgRating', 'Avg Rating'], ['yellows', 'Cards']].forEach(([k, lbl]) => {
        const b = h('button', `fc-btn-pill${leaderSort === k ? ' is-on' : ''}`, lbl);
        b.addEventListener('click', () => { leaderSort = k; render(); });
        sBar.appendChild(b);
      });
      body.appendChild(sBar);
      const rows = getLeaders(career, comp.id).sort((a, b) => (b[leaderSort] || 0) - (a[leaderSort] || 0)).slice(0, 25);
      const tbl = h('table', 'fc-table');
      tbl.innerHTML = '<thead><tr><th>#</th><th>Player</th><th>Club</th><th>Pos</th><th>Apps</th><th>G</th><th>A</th><th>Y/R</th><th>Rating</th></tr></thead>';
      const tb = h('tbody');
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="9" class="fc-muted">Play or simulate fixtures to populate competition stats leaders.</td></tr>';
      } else {
        rows.forEach((r, i) => {
          const tr = h('tr', r.id === career.pro.id ? 'is-user' : '');
          tr.innerHTML = `<td>${i + 1}</td><td><b>${r.name}</b></td><td>${getTeamById(r.teamId).abbr}</td><td>${r.pos}</td><td>${r.apps}</td><td><b>${r.goals}</b></td><td>${r.assists}</td><td>${r.yellows}/${r.reds}</td><td style="color:${ratingColor(r.avgRating)};"><b>${r.avgRating.toFixed(1)}</b></td>`;
          tb.appendChild(tr);
        });
      }
      tbl.appendChild(tb);
      body.appendChild(tbl);
    }

    shell.appendChild(body);
  }

  function openEditScoreModal(comp, fx) {
    const ht = getTeamById(fx.homeId);
    const at = getTeamById(fx.awayId);
    const bg = h('div', 'fc-modal-bg');
    const modal = h('div', 'fc-card fc-modal');
    modal.appendChild(h('h3', 'fc-title', `Edit Score · ${comp.shortName}`)).style.marginBottom = '10px';
    const g = h('div', 'fc-grid-2');
    const hIn = h('input', 'fc-input'); hIn.type = 'number'; hIn.min = '0'; hIn.max = '20'; hIn.value = String(fx.scoreH ?? 1); hIn.dataset.testid = 'edit-score-h';
    const aIn = h('input', 'fc-input'); aIn.type = 'number'; aIn.min = '0'; aIn.max = '20'; aIn.value = String(fx.scoreA ?? 0); aIn.dataset.testid = 'edit-score-a';
    const wH = h('div'); wH.appendChild(h('div', 'fc-label', ht.name)).style.marginBottom = '4px'; wH.appendChild(hIn);
    const wA = h('div'); wA.appendChild(h('div', 'fc-label', at.name)).style.marginBottom = '4px'; wA.appendChild(aIn);
    g.appendChild(wH); g.appendChild(wA);
    modal.appendChild(g);

    const btns = h('div');
    btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:14px;';
    const cBtn = h('button', 'fc-btn', 'CANCEL');
    cBtn.addEventListener('click', () => bg.remove());
    const sBtn = h('button', 'fc-btn fc-btn-gold', 'APPLY SCORE');
    sBtn.dataset.testid = 'btn-apply-edit-score';
    sBtn.addEventListener('click', () => {
      editFixtureScore(career, comp.id, fx.id, hIn.value, aIn.value);
      bg.remove();
      showToast(`Updated: ${ht.abbr} ${hIn.value}-${aIn.value} ${at.abbr}`);
      render();
    });
    btns.appendChild(cBtn); btns.appendChild(sBtn);
    modal.appendChild(btns);
    bg.appendChild(modal);
    document.body.appendChild(bg);
  }

  // ---- 4B. PRE-MATCH TACTICS, FORMATION & STARTING XI ----------------------

  function openMatchPrepForQuick(homeTeam, awayTeam, resolved) {
    const hStyleId = homeTeam.manager?.style || 'balanced';
    const aStyleId = awayTeam.manager?.style || 'balanced';
    const hFormId = getFormation(TACTICAL_STYLES[hStyleId]?.formation || '4-3-3').id;
    const aFormId = getFormation(TACTICAL_STYLES[aStyleId]?.formation || '4-3-3').id;
    const userBuilt = buildOrderedSquad(homeTeam.squad, null, hFormId);
    const oppBuilt = buildOrderedSquad(awayTeam.squad, null, aFormId);
    prepDraft = {
      mode: 'quick',
      userTeam: homeTeam,
      oppTeam: awayTeam,
      userKit: { ...resolved.homeKit, gkColor: homeTeam.gkKit.primary },
      oppKit: { ...resolved.awayKit, gkColor: awayTeam.gkKit.primary },
      userIsHome: true,
      formationId: hFormId,
      styleId: hStyleId,
      squadOrdered: userBuilt.ordered,
      proPlayer: null,
      oppFormationId: aFormId,
      oppStyleId: aStyleId,
      oppOrdered: oppBuilt.ordered,
      selectedIdx: null,
      viewTab: 'mine',
      competition: homeTeam.type === 'nation' || awayTeam.type === 'nation' ? 'International Friendly' : 'Exhibition Match',
      matchday: 'Exhibition',
      venue: `${homeTeam.short || homeTeam.name} Stadium`,
      difficulty: qm.difficulty,
      halfMinutes: qm.halfMinutes,
      cameraMode: qm.cameraMode,
      controlMode: 'full',
    };
    showScreen('matchprep');
  }

  function openMatchPrepForCareer(nextFx, comp, resolved, userIsHome, prefs) {
    const hTeam = getTeamById(nextFx.homeId);
    const aTeam = getTeamById(nextFx.awayId);
    const userTeam = userIsHome ? hTeam : aTeam;
    const oppTeam = userIsHome ? aTeam : hTeam;
    const userSt = career.clubsState[userTeam.id] || { manager: userTeam.manager };
    const oppSt = career.clubsState[oppTeam.id] || { manager: oppTeam.manager };
    const userStyleId = (prefs.tacticalStyle && TACTICAL_STYLES[prefs.tacticalStyle])
      ? prefs.tacticalStyle
      : (userSt.manager?.style || 'balanced');
    const oppStyleId = oppSt.manager?.style || 'balanced';
    const defaultUserForm = TACTICAL_STYLES[userStyleId]?.formation || '4-3-3';
    const userFormId = getFormation(prefs.formation || defaultUserForm).id;
    const oppFormId = getFormation(TACTICAL_STYLES[oppStyleId]?.formation || '4-3-3').id;
    const userBuilt = getMatchSquadForPreMatch(career, userTeam.id, userFormId);
    const oppBuilt = getMatchSquadForPreMatch(career, oppTeam.id, oppFormId);
    prepDraft = {
      mode: 'career',
      fixture: nextFx,
      comp,
      prefs,
      userTeam,
      oppTeam,
      userKit: userIsHome
        ? { ...resolved.homeKit, gkColor: hTeam.gkKit.primary }
        : { ...resolved.awayKit, gkColor: aTeam.gkKit.primary },
      oppKit: userIsHome
        ? { ...resolved.awayKit, gkColor: aTeam.gkKit.primary }
        : { ...resolved.homeKit, gkColor: hTeam.gkKit.primary },
      userIsHome,
      formationId: userFormId,
      styleId: userStyleId,
      squadOrdered: userBuilt.ordered,
      proPlayer: userBuilt.proPlayer,
      oppFormationId: oppFormId,
      oppStyleId,
      oppOrdered: oppBuilt.ordered,
      selectedIdx: null,
      viewTab: 'mine',
      competition: comp.name,
      matchday: nextFx.roundLabel,
      venue: `${hTeam.short || hTeam.name} Stadium${!userIsHome ? ' (Away)' : ''}`,
      difficulty: prefs.difficulty || 'pro',
      halfMinutes: prefs.halfMinutes || 4,
      cameraMode: prefs.controlMode === 'pro' ? prefs.cameraMode : 'broadcast',
      controlMode: prefs.controlMode || 'full',
    };
    showScreen('matchprep');
  }

  function computeLineAvgs(xi, form) {
    if (!xi || xi.length < 11) return { att: 75, mid: 75, def: 75, ovr: 75 };
    const buckets = { att: [], mid: [], def: [], all: [] };
    xi.forEach((p, idx) => {
      if (!p) return;
      const o = p.ovr || 76;
      buckets.all.push(o);
      if (idx === 0) {
        buckets.def.push(o);
      } else {
        const sl = form.slots[idx - 1];
        if (!sl || sl.line === 'DF') buckets.def.push(o);
        else if (sl.line === 'MF') buckets.mid.push(o);
        else buckets.att.push(o);
      }
    });
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 75);
    return { att: avg(buckets.att), mid: avg(buckets.mid), def: avg(buckets.def), ovr: avg(buckets.all) };
  }

  function renderMatchPrep() {
    if (!prepDraft) { showScreen('start'); return; }
    const viewingOpp = prepDraft.viewTab === 'opp';
    const activeTeam = viewingOpp ? prepDraft.oppTeam : prepDraft.userTeam;
    const activeKit = viewingOpp ? prepDraft.oppKit : prepDraft.userKit;
    const activeFormId = viewingOpp ? prepDraft.oppFormationId : prepDraft.formationId;
    const activeStyleId = viewingOpp ? prepDraft.oppStyleId : prepDraft.styleId;
    const activeSquad = viewingOpp ? prepDraft.oppOrdered : prepDraft.squadOrdered;
    const activeForm = getFormation(activeFormId);
    const activeStyle = TACTICAL_STYLES[activeStyleId] || TACTICAL_STYLES.balanced;
    const xi = activeSquad.slice(0, 11);
    const bench = activeSquad.slice(11);
    const avgs = computeLineAvgs(xi, activeForm);

    const shell = h('div', 'fc-shell');

    // Topbar
    const head = h('div', 'fc-topbar');
    const hLeft = h('div');
    hLeft.appendChild(h('div', 'fc-label fc-gold', `PRE-MATCH TACTICS & STARTING XI · ${prepDraft.competition.toUpperCase()}`));
    hLeft.appendChild(h('h2', 'fc-title', `${prepDraft.userTeam.name} vs ${prepDraft.oppTeam.name}`));
    head.appendChild(hLeft);

    const hRight = h('div');
    hRight.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    const mineTab = h('button', `fc-tab${!viewingOpp ? ' is-on' : ''}`, `MY SQUAD (${prepDraft.userTeam.abbr})`);
    mineTab.dataset.testid = 'prep-tab-mine';
    mineTab.addEventListener('click', () => { prepDraft.viewTab = 'mine'; prepDraft.selectedIdx = null; render(); });
    const oppTab = h('button', `fc-tab${viewingOpp ? ' is-on' : ''}`, `SCOUT ${prepDraft.oppTeam.abbr}`);
    oppTab.dataset.testid = 'prep-tab-opp';
    oppTab.addEventListener('click', () => { prepDraft.viewTab = 'opp'; prepDraft.selectedIdx = null; render(); });
    const backBtn = h('button', 'fc-btn', '← BACK');
    backBtn.dataset.testid = 'btn-prep-back';
    backBtn.addEventListener('click', () => {
      if (prepDraft.mode === 'career') openCareerHub('home');
      else showScreen('quick');
    });
    hRight.appendChild(mineTab);
    hRight.appendChild(oppTab);
    hRight.appendChild(backBtn);
    head.appendChild(hRight);
    shell.appendChild(head);

    // Main 2-col tactical workspace
    const grid = h('div', 'fc-prep-grid');

    // Left: Tactical Pitch + Team Summary
    const leftCard = h('div', 'fc-card');
    const summaryTop = h('div');
    summaryTop.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;';
    const tInfo = h('div');
    tInfo.appendChild(h('div', '', `${activeTeam.name} · ${activeForm.name}`)).style.cssText = 'font-size:15px;font-weight:900;';
    tInfo.appendChild(h('div', 'fc-muted fc-num', `${activeStyle.name} · ATT ${avgs.att} · MID ${avgs.mid} · DEF ${avgs.def} · XI ${avgs.ovr}`)).style.fontSize = '11.5px';
    summaryTop.appendChild(tInfo);
    if (!viewingOpp) {
      const autoBtn = h('button', 'fc-btn fc-btn-sm', 'AUTO-PICK BEST XI');
      autoBtn.dataset.testid = 'btn-auto-xi';
      autoBtn.addEventListener('click', () => {
        const rebuilt = buildOrderedSquad(prepDraft.squadOrdered, prepDraft.proPlayer, prepDraft.formationId);
        prepDraft.squadOrdered = rebuilt.ordered;
        prepDraft.selectedIdx = null;
        showToast(`Auto-picked best ${prepDraft.formationId} XI`);
        render();
      });
      summaryTop.appendChild(autoBtn);
    }
    leftCard.appendChild(summaryTop);

    // 2D Tactical Pitch Board
    const board = h('div', 'fc-pitch-board');
    board.innerHTML = `
      <svg viewBox="0 0 300 400" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.34;">
        <rect x="12" y="12" width="276" height="376" fill="none" stroke="#ffffff" stroke-width="1.6"/>
        <line x1="12" y1="200" x2="288" y2="200" stroke="#ffffff" stroke-width="1.4"/>
        <circle cx="150" cy="200" r="38" fill="none" stroke="#ffffff" stroke-width="1.4"/>
        <circle cx="150" cy="200" r="2.2" fill="#ffffff"/>
        <rect x="74" y="12" width="152" height="60" fill="none" stroke="#ffffff" stroke-width="1.4"/>
        <rect x="110" y="12" width="80" height="22" fill="none" stroke="#ffffff" stroke-width="1.4"/>
        <rect x="74" y="328" width="152" height="60" fill="none" stroke="#ffffff" stroke-width="1.4"/>
        <rect x="110" y="366" width="80" height="22" fill="none" stroke="#ffffff" stroke-width="1.4"/>
      </svg>
    `;

    const allSlots = [activeForm.gk, ...activeForm.slots];
    const discBg = activeKit.primary || '#dc2626';
    const discTxt = activeKit.numColor || '#ffffff';
    const gkBg = activeKit.gkColor || '#15803d';

    allSlots.forEach((slot, idx) => {
      const player = xi[idx];
      if (!player) return;
      const isSelected = !viewingOpp && prepDraft.selectedIdx === idx;
      const mismatch = !viewingOpp && isSlotMismatch(player, slot);
      const node = h('button', `fc-pitch-node${isSelected ? ' is-selected' : ''}${player.isPro ? ' is-pro' : ''}`);
      node.type = 'button';
      node.dataset.testid = `pitch-slot-${idx}`;
      node.style.left = `${slot.boardX}%`;
      node.style.top = `${slot.boardY}%`;

      const disc = h('div', 'fc-pitch-disc', player.number);
      disc.style.background = idx === 0 ? gkBg : discBg;
      disc.style.color = idx === 0 ? '#ffffff' : discTxt;
      if (mismatch) {
        const dot = h('span', 'fc-mismatch-dot');
        dot.title = `${player.pos} playing in ${slot.label} slot`;
        disc.appendChild(dot);
      }
      const last = String(player.name || '').trim().split(/\s+/).slice(-1)[0];
      const lbl = h('div', 'fc-pitch-name', `${slot.label} · ${last}`);
      const ovr = h('div', 'fc-pitch-ovr', `${player.ovr}`);
      node.appendChild(disc);
      node.appendChild(lbl);
      node.appendChild(ovr);

      if (!viewingOpp) {
        node.addEventListener('click', () => handlePrepSwapClick(idx));
      }
      board.appendChild(node);
    });
    leftCard.appendChild(board);

    const hintTxt = viewingOpp
      ? `${prepDraft.oppTeam.manager.name} (${prepDraft.oppTeam.manager.tacticalRating} TAC) · ${activeStyle.desc}`
      : (prepDraft.selectedIdx != null
        ? `Selected: ${prepDraft.squadOrdered[prepDraft.selectedIdx]?.name} — click any starter or substitute to swap positions.`
        : 'Click any player on the pitch or squad list, then click another player to swap into the Starting XI.');
    const hintEl = h('div', 'fc-muted', hintTxt);
    hintEl.style.cssText = 'font-size:11.5px;margin-top:10px;line-height:1.4;';
    leftCard.appendChild(hintEl);
    grid.appendChild(leftCard);

    // Right: Formation & Tactical Style Pickers + Starting XI & Bench Swap List
    const rightCol = h('div');
    rightCol.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    // Tactics Card
    const tacCard = h('div', 'fc-card');
    tacCard.appendChild(h('div', 'fc-label', viewingOpp ? 'OPPONENT FORMATION & STYLE' : 'FORMATION & TACTICAL STYLE')).style.marginBottom = '8px';

    const formRow = h('div');
    formRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;';
    FORMATION_IDS.forEach((fid) => {
      const b = h('button', `fc-btn-pill${activeFormId === fid ? ' is-on' : ''}`, fid);
      b.type = 'button';
      b.dataset.testid = `prep-form-${fid}`;
      if (viewingOpp) {
        b.disabled = true;
        b.style.opacity = activeFormId === fid ? '1' : '0.45';
      } else {
        b.addEventListener('click', () => {
          if (prepDraft.formationId === fid) return;
          prepDraft.formationId = fid;
          const rebuilt = buildOrderedSquad(prepDraft.squadOrdered, prepDraft.proPlayer, fid);
          prepDraft.squadOrdered = rebuilt.ordered;
          prepDraft.selectedIdx = null;
          render();
        });
      }
      formRow.appendChild(b);
    });
    tacCard.appendChild(formRow);

    const styleRow = h('div');
    styleRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;';
    Object.values(TACTICAL_STYLES).forEach((st) => {
      const b = h('button', `fc-btn-pill${activeStyleId === st.id ? ' is-on' : ''}`, st.short);
      b.type = 'button';
      b.dataset.testid = `prep-style-${st.id}`;
      if (viewingOpp) {
        b.disabled = true;
        b.style.opacity = activeStyleId === st.id ? '1' : '0.45';
      } else {
        b.addEventListener('click', () => {
          prepDraft.styleId = st.id;
          render();
        });
      }
      styleRow.appendChild(b);
    });
    tacCard.appendChild(styleRow);
    const lineLbl = activeStyle.lineShift >= 4 ? 'High Line' : activeStyle.lineShift <= -4 ? 'Deep Line' : 'Mid Block';
    const pressLbl = activeStyle.pressDist >= 16 ? 'Heavy Press' : activeStyle.pressDist <= 10 ? 'Compact Stand-Off' : 'Balanced Press';
    tacCard.appendChild(h('div', 'fc-muted', `${activeStyle.name} · ${lineLbl} · ${pressLbl} · ${activeForm.desc}`)).style.fontSize = '11.5px';
    rightCol.appendChild(tacCard);

    // Squad XI & Bench List Card
    const listCard = h('div', 'fc-card');
    const listHead = h('div');
    listHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    listHead.appendChild(h('div', 'fc-label', `STARTING XI (${xi.length}) & SUBSTITUTES (${bench.length})`));
    listHead.appendChild(h('span', 'fc-muted', viewingOpp ? 'Scout View' : 'Click 2 to Swap')).style.fontSize = '10.5px';
    listCard.appendChild(listHead);

    const scroll = h('div', 'fc-squad-scroll');
    activeSquad.forEach((p, idx) => {
      const isStarter = idx < 11;
      if (idx === 11) {
        const divLbl = h('div', 'fc-label', 'SUBSTITUTES BENCH');
        divLbl.style.cssText = 'margin:8px 0 4px;padding-top:6px;border-top:1px solid rgba(255,255,255,.10);';
        scroll.appendChild(divLbl);
      }
      const slot = isStarter ? allSlots[idx] : null;
      const mismatch = isStarter && !viewingOpp && isSlotMismatch(p, slot);
      const isSelected = !viewingOpp && prepDraft.selectedIdx === idx;
      const row = h('button', `fc-squad-row${!isStarter ? ' is-sub' : ''}${isSelected ? ' is-selected' : ''}${viewingOpp ? ' is-readonly' : ''}`);
      row.type = 'button';
      row.dataset.testid = `squad-row-${idx}`;

      const slotEl = h('span', 'fc-label', isStarter ? slot.label : 'SUB');
      slotEl.style.color = isStarter ? '#f4cd72' : 'rgba(218,228,244,.52)';
      const nameWrap = h('div');
      const a = p.attrs || {};
      const keyStat = p.role === 'GK' || p.role === 'DF' ? `DEF ${a.def ?? a.defending ?? p.ovr}` : `SHO ${a.shoot ?? a.shooting ?? p.ovr}`;
      nameWrap.innerHTML = `
        <div style="font-size:12.5px;font-weight:${p.isPro ? '900' : '700'};color:${p.isPro ? '#f4cd72' : '#eef2f8'};">
          #${p.number} ${p.name}${p.isPro ? ' ★' : ''}${mismatch ? ' <span style="color:#f59e0b;font-size:10px;">(Out of Pos)</span>' : ''}
        </div>
        <div class="fc-muted fc-num" style="font-size:10px;">${p.pos} · Age ${p.age || 24} · PAC ${a.pace ?? p.ovr} · PAS ${a.pass ?? a.passing ?? p.ovr} · ${keyStat}</div>
      `;
      const posEl = h('span', 'fc-muted', p.pos);
      posEl.style.cssText = 'font-size:10.5px;font-weight:700;text-align:center;';
      const ovrEl = h('span', 'fc-ovr-num', p.ovr);

      row.appendChild(slotEl);
      row.appendChild(nameWrap);
      row.appendChild(posEl);
      row.appendChild(ovrEl);

      if (!viewingOpp) {
        row.addEventListener('click', () => handlePrepSwapClick(idx));
      }
      scroll.appendChild(row);
    });
    listCard.appendChild(scroll);
    rightCol.appendChild(listCard);
    grid.appendChild(rightCol);
    shell.appendChild(grid);

    // Bottom Kick Off CTA Bar
    const foot = h('div', 'fc-card');
    foot.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 18px;';
    const footMeta = h('div');
    footMeta.appendChild(h('div', 'fc-label', `${prepDraft.matchday} · ${prepDraft.venue}`));
    footMeta.appendChild(h('div', 'fc-muted fc-num', `Difficulty: ${String(prepDraft.difficulty).toUpperCase()} · Half: ${prepDraft.halfMinutes}m · Control: ${prepDraft.controlMode === 'pro' ? 'Player-Lock' : 'Full Team'}`)).style.fontSize = '11.5px';
    const kickNowBtn = h('button', 'fc-btn fc-btn-gold', 'KICK OFF 3D MATCH →');
    kickNowBtn.dataset.testid = 'btn-kickoff-3d';
    kickNowBtn.style.padding = '12px 26px';
    kickNowBtn.addEventListener('click', () => launchFromMatchPrep());
    foot.appendChild(footMeta);
    foot.appendChild(kickNowBtn);
    shell.appendChild(foot);

    root.appendChild(shell);
  }

  function handlePrepSwapClick(idx) {
    if (!prepDraft) return;
    if (prepDraft.selectedIdx == null) {
      prepDraft.selectedIdx = idx;
      render();
      return;
    }
    if (prepDraft.selectedIdx === idx) {
      prepDraft.selectedIdx = null;
      render();
      return;
    }
    const a = prepDraft.selectedIdx;
    const b = idx;
    const arr = prepDraft.squadOrdered;
    const tmp = arr[a];
    arr[a] = arr[b];
    arr[b] = tmp;
    prepDraft.selectedIdx = null;
    showToast(`Swapped ${arr[a].name} ↔ ${arr[b].name}`);
    render();
  }

  function launchFromMatchPrep() {
    if (!prepDraft) return;
    const draft = prepDraft;
    showScreen('hidden');
    if (!onLaunchMatch) return;
    if (draft.mode === 'career') {
      if (draft.prefs) {
        draft.prefs.formation = draft.formationId;
        draft.prefs.tacticalStyle = draft.styleId;
        saveCareer(career);
      }
      onLaunchMatch({
        mode: 'career',
        career,
        fixture: draft.fixture,
        competition: draft.competition,
        matchday: draft.matchday,
        controlMode: draft.controlMode,
        cameraMode: draft.cameraMode,
        difficulty: draft.difficulty,
        halfMinutes: draft.halfMinutes,
        tacticalOverrides: {
          userLineup: draft.squadOrdered.slice(0, 11),
          userFormation: draft.formationId,
          userStyle: draft.styleId,
          oppFormation: draft.oppFormationId,
          oppStyle: draft.oppStyleId,
        },
      });
    } else {
      onLaunchMatch({
        mode: 'quick',
        homeTeam: draft.userTeam,
        awayTeam: draft.oppTeam,
        homeKit: draft.userKit,
        awayKit: draft.oppKit,
        homeLineup: draft.squadOrdered.slice(0, 11),
        awayLineup: draft.oppOrdered.slice(0, 11),
        homeFormation: draft.formationId,
        awayFormation: draft.oppFormationId,
        homeStyle: draft.styleId,
        awayStyle: draft.oppStyleId,
        difficulty: draft.difficulty,
        halfMinutes: draft.halfMinutes,
        cameraMode: draft.cameraMode,
        playerLock: false,
        competition: draft.competition,
        matchday: draft.matchday,
        venue: draft.venue,
      });
    }
  }

  // ---- 5. POST-MATCH RATING & SUMMARY --------------------------------------

  function renderPostMatch() {
    const shell = h('div', 'fc-shell');
    const sum = postMatchSummary || career?.latestMatch;
    if (!sum) { openCareerHub('home'); return; }
    const pp = sum.proPerf || {};
    const ovrDiff = (sum.ovrAfter || 0) - (sum.ovrBefore || 0);
    const trustDiff = (sum.trustAfter || 0) - (sum.trustBefore || 0);

    const card = h('div', 'fc-card');
    card.style.cssText = 'max-width:760px;margin:auto;width:100%;padding:24px 28px;';
    card.innerHTML = `
      <div class="fc-label fc-gold" style="text-align:center;">POST-MATCH RATING & CAREER SUMMARY · ${sum.compName.toUpperCase()}</div>
      <div style="text-align:center;font-size:28px;font-weight:900;margin:10px 0 18px;" class="fc-num">
        ${sum.homeName}  <span class="fc-gold">${sum.scoreH} – ${sum.scoreA}</span>  ${sum.awayName}
      </div>
      <div class="fc-grid-2" style="align-items:center;">
        <div style="text-align:center;padding:18px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);">
          <div class="fc-label">YOUR MATCH RATING</div>
          <div class="fc-num" style="font-size:52px;font-weight:950;color:${ratingColor(pp.rating || 6.5)};margin:4px 0;">${(pp.rating || 6.5).toFixed(1)}</div>
          ${pp.motm ? '<span class="fc-badge fc-badge-gold">MAN OF THE MATCH</span>' : sum.motm ? `<span class="fc-badge">MOTM: ${sum.motm.name} (${sum.motm.rating.toFixed(1)})</span>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
          <div class="fc-card" style="padding:10px;"><div class="fc-label">Goals / Assists</div><b class="fc-num" style="font-size:18px;">${pp.goals || 0} / ${pp.assists || 0}</b></div>
          <div class="fc-card" style="padding:10px;"><div class="fc-label">Shots On Target</div><b class="fc-num" style="font-size:18px;">${pp.shotsOnTarget || 0}</b></div>
          <div class="fc-card" style="padding:10px;"><div class="fc-label">Key Passes</div><b class="fc-num" style="font-size:18px;">${pp.keyPasses || 0}</b></div>
          <div class="fc-card" style="padding:10px;"><div class="fc-label">Tackles / Saves</div><b class="fc-num" style="font-size:18px;">${pp.tackles || 0} / ${pp.saves || 0}</b></div>
        </div>
      </div>
      <div style="display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-top:16px;">
        <span class="fc-badge fc-badge-gold">OVR: ${sum.ovrAfter} ${ovrDiff > 0 ? `(+${ovrDiff})` : ovrDiff < 0 ? `(${ovrDiff})` : ''}</span>
        <span class="fc-badge ${trustDiff >= 0 ? 'fc-badge-green' : ''}">Coach Trust: ${sum.trustAfter}/100 (${trustDiff >= 0 ? '+' : ''}${trustDiff})</span>
      </div>
    `;

    const acts = h('div');
    acts.style.cssText = 'display:flex;justify-content:center;margin-top:20px;';
    const contBtn = h('button', 'fc-btn fc-btn-gold', 'CONTINUE TO CAREER HUB →');
    contBtn.dataset.testid = 'btn-postmatch-continue';
    contBtn.addEventListener('click', () => {
      if (career.seasonCompleted) showScreen('seasonreview');
      else openCareerHub('home');
    });
    acts.appendChild(contBtn);
    card.appendChild(acts);
    shell.appendChild(card);
    root.appendChild(shell);
  }

  // ---- 6. SEASON REVIEW, AWARDS & OFF-SEASON TRANSFERS ---------------------

  let selectedNextClubId = null;
  function renderSeasonReview() {
    if (!career || !career.seasonReview) { openCareerHub('home'); return; }
    const rev = career.seasonReview;
    if (!selectedNextClubId) selectedNextClubId = career.pro.clubId;

    const shell = h('div', 'fc-shell');
    const card = h('div', 'fc-card');
    card.appendChild(h('div', 'fc-label fc-gold', `SEASON ${rev.season} REVIEW & WORLD AWARDS`));
    card.appendChild(h('h2', 'fc-title', 'End of Season Honours & Transfers')).style.margin = '4px 0 14px';

    const awardsGrid = h('div', 'fc-grid-3');
    const mkAward = (title, main, sub) => {
      const a = h('div');
      a.style.cssText = 'padding:12px;border-radius:10px;background:rgba(244,205,114,.08);border:1px solid rgba(244,205,114,.3);';
      a.innerHTML = `<div class="fc-label fc-gold">${title}</div><div style="font-size:17px;font-weight:900;margin:4px 0;">${main}</div><div class="fc-muted" style="font-size:11.5px;">${sub}</div>`;
      return a;
    };
    awardsGrid.appendChild(mkAward("BALLON D'OR / PLAYER OF THE SEASON", rev.ballonDor ? rev.ballonDor.name : '-', rev.ballonDor ? `${getTeamById(rev.ballonDor.teamId).name} · ${rev.ballonDor.avgRating.toFixed(1)} Avg Rating` : ''));
    awardsGrid.appendChild(mkAward('EUROPEAN GOLDEN BOOT', rev.goldenBoot ? rev.goldenBoot.name : '-', rev.goldenBoot ? `${getTeamById(rev.goldenBoot.teamId).name} · ${rev.goldenBoot.goals} Goals` : ''));
    awardsGrid.appendChild(mkAward('YOUR PRO SEASON', `${rev.proSummary.name} (${rev.proSummary.ovr} OVR)`, `${rev.proSummary.apps} Apps · ${rev.proSummary.goals}G ${rev.proSummary.assists}A · Avg ${rev.proSummary.avgRating ? rev.proSummary.avgRating.toFixed(1) : '-'}`));
    card.appendChild(awardsGrid);

    // Champions List
    card.appendChild(h('div', 'fc-label', 'COMPETITION CHAMPIONS')).style.cssText = 'margin:16px 0 8px;';
    const champWrap = h('div');
    champWrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    rev.champions.forEach((c) => {
      champWrap.appendChild(h('span', 'fc-badge', `${c.compName}: ${c.championName}`));
    });
    card.appendChild(champWrap);

    // Transfer Offers
    card.appendChild(h('div', 'fc-label', 'OFF-SEASON CLUB DECISION (STAY OR TRANSFER)')).style.cssText = 'margin:18px 0 8px;';
    const offerGrid = h('div', 'fc-grid-2');
    const curClub = getTeamById(career.pro.clubId);
    const stayBtn = h('button', `fc-club-item${selectedNextClubId === curClub.id ? ' is-on' : ''}`);
    stayBtn.dataset.testid = 'transfer-stay';
    stayBtn.innerHTML = `${renderJerseySvg(curClub.homeKit, 34, career.pro.number)}<div><b>STAY AT ${curClub.name.toUpperCase()}</b><div style="font-size:11px;color:rgba(218,228,244,.7);">Current Club · Trust ${career.pro.coachTrust}/100</div></div>`;
    stayBtn.addEventListener('click', () => { selectedNextClubId = curClub.id; render(); });
    offerGrid.appendChild(stayBtn);

    (rev.transferOffers || []).forEach((of) => {
      const oc = getTeamById(of.clubId);
      const ob = h('button', `fc-club-item${selectedNextClubId === of.clubId ? ' is-on' : ''}`);
      ob.dataset.testid = `transfer-offer-${of.clubId}`;
      ob.innerHTML = `${renderJerseySvg(oc.homeKit, 34, career.pro.number)}<div><b>SIGN FOR ${of.clubName.toUpperCase()}</b><div style="font-size:11px;color:rgba(218,228,244,.7);">${of.leagueName} · ${of.rating} OVR · ${of.managerName} · ${of.role}</div></div>`;
      ob.addEventListener('click', () => { selectedNextClubId = of.clubId; render(); });
      offerGrid.appendChild(ob);
    });
    card.appendChild(offerGrid);

    const foot = h('div');
    foot.style.cssText = 'display:flex;justify-content:flex-end;margin-top:18px;';
    const advBtn = h('button', 'fc-btn fc-btn-gold', `ADVANCE TO SEASON ${rev.season + 1} →`);
    advBtn.dataset.testid = 'btn-advance-season';
    advBtn.addEventListener('click', () => {
      const target = selectedNextClubId;
      selectedNextClubId = null;
      advanceToNextSeason(career, target);
      showToast(`Welcome to Season ${career.season}!`);
      openCareerHub('home');
    });
    foot.appendChild(advBtn);
    card.appendChild(foot);
    shell.appendChild(card);
    root.appendChild(shell);
  }

  return {
    openStartMenu,
    openCareerHub,
    showPostMatch,
    finishDrill3d,
    hide: () => showScreen('hidden'),
    isVisible: () => screen !== 'hidden',
  };
}
