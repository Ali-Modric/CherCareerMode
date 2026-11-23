// ---------------------------------------------------------------------------
// src/careerEngine.js — Multi-season Player Career engine, calendar, xG +
// Poisson simulator, standings/brackets, OVR progression, Coach Trust,
// National Team call-ups, transfers, AI report generator, and localStorage.
// Zero Math.random() calls; 100% deterministic seeded PRNG.
// ---------------------------------------------------------------------------

import {
  TACTICAL_STYLES,
  TACTIC_MATCHUP,
  LEAGUES,
  CLUBS,
  NATIONS,
  getTeamById,
  getClubsByLeague,
  pickStartingXI,
  buildOrderedSquad,
  getFormation,
  posToEngineRole,
  resolveMatchKits,
} from './careerDb.js';

export const STORAGE_KEY = 'fifacher_career_v1';

// ---- Deterministic PRNG & helpers ------------------------------------------

export function hashStr(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeDetRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function samplePoisson(lambda, rng) {
  const L = Math.exp(-clamp(lambda, 0.05, 6.5));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 12);
  return k - 1;
}

export function computeOvr(pos, attrs) {
  const a = attrs || {};
  const p = a.pace || 70;
  const sh = a.shooting || 70;
  const pa = a.passing || 70;
  const dr = a.dribbling || 70;
  const df = a.defending || 70;
  const ph = a.physical || 70;
  if (pos === 'GK') {
    return Math.round(df * 0.36 + ph * 0.24 + pa * 0.16 + p * 0.12 + dr * 0.12);
  }
  if (pos === 'CB') {
    return Math.round(df * 0.38 + ph * 0.28 + pa * 0.14 + p * 0.12 + dr * 0.08);
  }
  if (pos === 'LB' || pos === 'RB') {
    return Math.round(df * 0.26 + p * 0.24 + pa * 0.18 + dr * 0.16 + ph * 0.16);
  }
  if (pos === 'CDM') {
    return Math.round(df * 0.28 + pa * 0.26 + ph * 0.20 + dr * 0.14 + p * 0.12);
  }
  if (pos === 'CM') {
    return Math.round(pa * 0.30 + dr * 0.22 + df * 0.16 + ph * 0.14 + p * 0.10 + sh * 0.08);
  }
  if (pos === 'CAM') {
    return Math.round(pa * 0.28 + dr * 0.28 + sh * 0.22 + p * 0.14 + ph * 0.08);
  }
  if (pos === 'LW' || pos === 'RW') {
    return Math.round(p * 0.26 + dr * 0.28 + sh * 0.22 + pa * 0.16 + ph * 0.08);
  }
  // ST
  return Math.round(sh * 0.34 + p * 0.22 + dr * 0.20 + ph * 0.16 + pa * 0.08);
}

export function presetAttrsForTier(pos, tier) {
  const base = tier === 'academy' ? 64 : tier === 'star' ? 80 : 72;
  const role = posToEngineRole(pos);
  const w = {
    pace: role === 'FW' ? 4 : role === 'GK' ? -14 : role === 'DF' ? -2 : 0,
    shooting: role === 'FW' ? 5 : role === 'MF' ? 0 : -14,
    passing: role === 'MF' ? 5 : role === 'FW' ? -1 : -3,
    dribbling: (pos === 'LW' || pos === 'RW' || pos === 'CAM') ? 5 : role === 'FW' ? 2 : role === 'GK' ? -14 : -2,
    defending: (pos === 'CB' || pos === 'CDM') ? 6 : role === 'DF' ? 5 : role === 'GK' ? 7 : -22,
    physical: (pos === 'CB' || pos === 'ST' || pos === 'GK') ? 4 : 0,
  };
  const attrs = {
    pace: clamp(base + w.pace, 42, 95),
    shooting: clamp(base + w.shooting, 35, 95),
    passing: clamp(base + w.passing, 44, 95),
    dribbling: clamp(base + w.dribbling, 40, 95),
    defending: clamp(base + w.defending, 30, 95),
    physical: clamp(base + w.physical, 48, 95),
  };
  return attrs;
}

// ---- Calendar dates --------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateFromOffset(baseYear, daysOffset) {
  const d = new Date(Date.UTC(baseYear, 7, 9 + daysOffset)); // Starts Aug 9
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ---- Training Drills, Budgets & Player Valuation ---------------------------

export const TRAINING_DRILLS = [
  {
    id: 'finishing',
    title: 'Finishing & Volleys',
    short: 'Finishing',
    duration: 45,
    focus: ['shooting', 'pace', 'physical'],
    weights: { shooting: 1.0, pace: 0.42, physical: 0.34 },
    bronzeScore: 180,
    silverScore: 340,
    goldScore: 520,
    eliteScore: 720,
    desc: 'Strike into glowing corner zones past the keeper on timed runs.',
  },
  {
    id: 'passing',
    title: 'Passing & Vision',
    short: 'Passing',
    duration: 45,
    focus: ['passing', 'dribbling'],
    weights: { passing: 1.0, dribbling: 0.48, shooting: 0.20 },
    bronzeScore: 180,
    silverScore: 340,
    goldScore: 520,
    eliteScore: 720,
    desc: 'Thread crisp passes and through-balls into active teammate zones.',
  },
  {
    id: 'dribbling',
    title: 'Dribbling & 1v1 Slalom',
    short: 'Dribbling',
    duration: 45,
    focus: ['dribbling', 'pace', 'shooting'],
    weights: { dribbling: 1.0, pace: 0.54, shooting: 0.28 },
    bronzeScore: 200,
    silverScore: 380,
    goldScore: 580,
    eliteScore: 780,
    desc: 'Beat jockeying defenders through glowing pitch gates and finish on goal.',
  },
  {
    id: 'defending',
    title: 'Defending & Shot-Stopping',
    short: 'Defending',
    duration: 45,
    focus: ['defending', 'physical', 'passing'],
    weights: { defending: 1.0, physical: 0.56, passing: 0.26 },
    bronzeScore: 180,
    silverScore: 340,
    goldScore: 500,
    eliteScore: 680,
    desc: 'Intercept passes, win clean tackles, and stop waves of attackers.',
  },
];

export function initClubBudgetM(team) {
  if (!team || team.type === 'nation') return 0;
  const r = clamp(Number(team.rating) || 76, 68, 92);
  let base;
  if (r >= 87) base = 185 + (r - 87) * 16;
  else if (r >= 83) base = 110 + (r - 83) * 18;
  else if (r >= 79) base = 58 + (r - 79) * 12;
  else if (r >= 75) base = 32 + (r - 75) * 6;
  else base = 16 + (r - 68) * 2.2;
  const leagueMult = team.leagueId === 'eng' ? 1.18 : team.leagueId === 'esp' ? 1.04 : team.leagueId === 'ger' ? 0.98 : team.leagueId === 'ita' ? 0.94 : 0.90;
  return Math.round(base * leagueMult * 10) / 10;
}

export function estimatePlayerValueM(player) {
  if (!player) return 5;
  const ovr = clamp(Number(player.ovr) || 74, 55, 96);
  const age = clamp(Number(player.age) || 24, 16, 40);
  const base = Math.pow(Math.max(1, (ovr - 62) / 5.2), 2.35) * 2.2;
  const ageMult = age <= 21 ? 1.28 : age <= 25 ? 1.15 : age <= 28 ? 1.0 : age <= 31 ? 0.72 : 0.42;
  const roleMult = player.role === 'FW' ? 1.12 : player.role === 'MF' ? 1.04 : player.role === 'GK' ? 0.85 : 0.94;
  return Math.max(0.5, Math.round(base * ageMult * roleMult * 10) / 10);
}

function emptyAttrXp() {
  return { pace: 0, shooting: 0, passing: 0, dribbling: 0, defending: 0, physical: 0 };
}

function emptyDrillHighScores() {
  return { finishing: 0, passing: 0, dribbling: 0, defending: 0 };
}

function ensureCareerStateUpgrades(career) {
  if (!career || !career.pro) return career;
  const pro = career.pro;
  if (!pro.attrXp || typeof pro.attrXp !== 'object') pro.attrXp = emptyAttrXp();
  for (const k of ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical']) {
    if (typeof pro.attrXp[k] !== 'number' || Number.isNaN(pro.attrXp[k])) pro.attrXp[k] = 0;
  }
  if (!pro.training || typeof pro.training !== 'object') {
    pro.training = { lastWeekSlot: career.currentSlot ?? 0, sessionsUsed: 0, maxPerWeek: 2, history: [] };
  }
  if (typeof pro.training.maxPerWeek !== 'number') pro.training.maxPerWeek = 2;
  if (!Array.isArray(pro.training.history)) pro.training.history = [];
  if (!pro.drillHighScores || typeof pro.drillHighScores !== 'object') {
    pro.drillHighScores = emptyDrillHighScores();
  }
  if (!pro.ntDecision) {
    pro.ntDecision = pro.calledUp ? 'joined' : 'none';
  }
  if (!Array.isArray(career.transferHistory)) career.transferHistory = [];

  if (career.clubsState) {
    for (const t of [...CLUBS, ...NATIONS]) {
      if (!career.clubsState[t.id]) {
        career.clubsState[t.id] = {
          rating: t.rating,
          budget: initClubBudgetM(t),
          manager: { ...t.manager },
          form: [],
          fatigue: 0,
          squad: t.squad.map((p) => ({ ...p, attrs: { ...p.attrs } })),
        };
      } else {
        const st = career.clubsState[t.id];
        if (typeof st.budget !== 'number' || Number.isNaN(st.budget)) {
          st.budget = initClubBudgetM(t);
        }
      }
    }
  }
  return career;
}

// ---- Storage ---------------------------------------------------------------

export function loadCareer() {
  try {
    if (!window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.pro || !parsed.competitions) return null;
    if (!parsed.squadCurveVersion || parsed.squadCurveVersion < 3) {
      if (parsed.clubsState) {
        for (const t of [...CLUBS, ...NATIONS]) {
          if (parsed.clubsState[t.id]) {
            parsed.clubsState[t.id].rating = t.rating;
            parsed.clubsState[t.id].manager = { ...t.manager };
            parsed.clubsState[t.id].squad = t.squad.map((p) => ({ ...p, attrs: { ...p.attrs } }));
          } else {
            parsed.clubsState[t.id] = {
              rating: t.rating,
              budget: initClubBudgetM(t),
              manager: { ...t.manager },
              form: [],
              fatigue: 0,
              squad: t.squad.map((p) => ({ ...p, attrs: { ...p.attrs } })),
            };
          }
        }
      }
      parsed.squadCurveVersion = 3;
    }
    return ensureCareerStateUpgrades(parsed);
  } catch (e) {
    return null;
  }
}

export function saveCareer(career) {
  try {
    if (!window.localStorage || !career) return false;
    career.updatedAt = Date.now();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(career));
    return true;
  } catch (e) {
    return false;
  }
}

export function deleteCareer() {
  try {
    if (window.localStorage) window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) { /* ignore */ }
}

// ---- Schedule & Bracket Builders -------------------------------------------

function buildRoundRobin(teamIds, rng) {
  const ids = teamIds.slice();
  // Deterministic shuffle
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }
  const n = ids.length;
  const rounds = [];
  const half = n / 2;
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const t1 = arr[i];
      const t2 = arr[n - 1 - i];
      const flip = (r + i) % 2 === 1;
      pairs.push(flip ? [t2, t1] : [t1, t2]);
    }
    rounds.push(pairs);
    // Rotate keeping index 0 fixed
    const last = arr.pop();
    arr.splice(1, 0, last);
  }
  // Second half reverse fixtures
  const secondHalf = rounds.map((pairs) => pairs.map(([h, a]) => [a, h]));
  return [...rounds, ...secondHalf];
}

function makeEmptyStanding(teamId) {
  return {
    teamId,
    p: 0, w: 0, d: 0, l: 0,
    gf: 0, ga: 0, gd: 0, pts: 0,
    form: [],
  };
}

function makeKnockoutComp(id, name, shortName, type, country, teamIds, startRoundLabel, roundSlots, rng, neutralFinal = true) {
  const ids = teamIds.slice();
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }
  const fixtures = [];
  const count = ids.length;
  for (let i = 0; i < count; i += 2) {
    fixtures.push({
      id: `${id}_r0_${i / 2}`,
      compId: id,
      roundIdx: 0,
      roundLabel: startRoundLabel,
      slot: roundSlots[0],
      homeId: ids[i],
      awayId: ids[i + 1],
      neutral: false,
      played: false,
      scoreH: null,
      scoreA: null,
      penH: null,
      penA: null,
      winnerId: null,
      events: [],
    });
  }
  return {
    id,
    name,
    shortName,
    type, // 'cup' | 'league_cup' | 'ucl' | 'uel' | 'intl_tourney'
    country: country || null,
    isKnockout: true,
    neutralFinal,
    roundSlots,
    roundNames: count === 32
      ? ['Round of 32', 'Round of 16', 'Quarter-Final', 'Semi-Final', 'Final']
      : ['Round of 16', 'Quarter-Final', 'Semi-Final', 'Final'],
    currentRound: 0,
    teams: ids,
    fixtures,
    championId: null,
    leaders: {}, // playerId -> stat row
  };
}

// 50-slot full-season calendar layout (Aug -> late Jun)
// 38 League weeks + 4 League Cup + 4 Domestic Cup + 4 Euro + 3 Intl Breaks + 5 Intl Tournament
// Wait: we pair Domestic Cup + League Cup cleanly on non-league slots and Euro + Intl on their own slots
// Let's map 50 calendar slots cleanly so every competition flows in realistic seasonal order:
const SEASON_SLOTS = [
  { slot: 0, day: 0, kind: 'league', label: 'Matchweek 1', leagueRound: 0 },
  { slot: 1, day: 7, kind: 'league', label: 'Matchweek 2', leagueRound: 1 },
  { slot: 2, day: 14, kind: 'league', label: 'Matchweek 3', leagueRound: 2 },
  { slot: 3, day: 21, kind: 'league', label: 'Matchweek 4', leagueRound: 3 },
  { slot: 4, day: 28, kind: 'intl_break', label: 'International Break' },
  { slot: 5, day: 35, kind: 'league', label: 'Matchweek 5', leagueRound: 4 },
  { slot: 6, day: 39, kind: 'euro', label: 'Europe · Round of 16', roundIdx: 0 },
  { slot: 7, day: 42, kind: 'league', label: 'Matchweek 6', leagueRound: 5 },
  { slot: 8, day: 46, kind: 'league_cup', label: 'League Cup · Round of 16', roundIdx: 0 },
  { slot: 9, day: 49, kind: 'league', label: 'Matchweek 7', leagueRound: 6 },
  { slot: 10, day: 56, kind: 'league', label: 'Matchweek 8', leagueRound: 7 },
  { slot: 11, day: 63, kind: 'league', label: 'Matchweek 9', leagueRound: 8 },
  { slot: 12, day: 70, kind: 'intl_break', label: 'International Break' },
  { slot: 13, day: 77, kind: 'league', label: 'Matchweek 10', leagueRound: 9 },
  { slot: 14, day: 81, kind: 'league_cup', label: 'League Cup · Quarter-Final', roundIdx: 1 },
  { slot: 15, day: 84, kind: 'league', label: 'Matchweek 11', leagueRound: 10 },
  { slot: 16, day: 91, kind: 'league', label: 'Matchweek 12', leagueRound: 11 },
  { slot: 17, day: 95, kind: 'euro', label: 'Europe · Quarter-Final', roundIdx: 1 },
  { slot: 18, day: 98, kind: 'league', label: 'Matchweek 13', leagueRound: 12 },
  { slot: 19, day: 105, kind: 'league', label: 'Matchweek 14', leagueRound: 13 },
  { slot: 20, day: 109, kind: 'dom_cup', label: 'Domestic Cup · Round of 16', roundIdx: 0 },
  { slot: 21, day: 112, kind: 'league', label: 'Matchweek 15', leagueRound: 14 },
  { slot: 22, day: 119, kind: 'league', label: 'Matchweek 16', leagueRound: 15 },
  { slot: 23, day: 123, kind: 'league_cup', label: 'League Cup · Semi-Final', roundIdx: 2 },
  { slot: 24, day: 126, kind: 'league', label: 'Matchweek 17', leagueRound: 16 },
  { slot: 25, day: 133, kind: 'league', label: 'Matchweek 18', leagueRound: 17 },
  { slot: 26, day: 140, kind: 'league', label: 'Matchweek 19', leagueRound: 18 },
  { slot: 27, day: 147, kind: 'dom_cup', label: 'Domestic Cup · Quarter-Final', roundIdx: 1 },
  { slot: 28, day: 154, kind: 'league', label: 'Matchweek 20', leagueRound: 19 },
  { slot: 29, day: 161, kind: 'league', label: 'Matchweek 21', leagueRound: 20 },
  { slot: 30, day: 168, kind: 'league', label: 'Matchweek 22', leagueRound: 21 },
  { slot: 31, day: 172, kind: 'league_cup', label: 'League Cup · Final', roundIdx: 3 },
  { slot: 32, day: 175, kind: 'league', label: 'Matchweek 23', leagueRound: 22 },
  { slot: 33, day: 182, kind: 'league', label: 'Matchweek 24', leagueRound: 23 },
  { slot: 34, day: 189, kind: 'league', label: 'Matchweek 25', leagueRound: 24 },
  { slot: 35, day: 196, kind: 'intl_break', label: 'International Break' },
  { slot: 36, day: 203, kind: 'league', label: 'Matchweek 26', leagueRound: 25 },
  { slot: 37, day: 207, kind: 'euro', label: 'Europe · Semi-Final', roundIdx: 2 },
  { slot: 38, day: 210, kind: 'league', label: 'Matchweek 27', leagueRound: 26 },
  { slot: 39, day: 217, kind: 'league', label: 'Matchweek 28', leagueRound: 27 },
  { slot: 40, day: 221, kind: 'dom_cup', label: 'Domestic Cup · Semi-Final', roundIdx: 2 },
  { slot: 41, day: 224, kind: 'league', label: 'Matchweek 29', leagueRound: 28 },
  { slot: 42, day: 231, kind: 'league', label: 'Matchweek 30', leagueRound: 29 },
  { slot: 43, day: 238, kind: 'league', label: 'Matchweek 31', leagueRound: 30 },
  { slot: 44, day: 245, kind: 'league', label: 'Matchweek 32', leagueRound: 31 },
  { slot: 45, day: 252, kind: 'league', label: 'Matchweek 33', leagueRound: 32 },
  { slot: 46, day: 259, kind: 'league', label: 'Matchweek 34', leagueRound: 33 },
  { slot: 47, day: 266, kind: 'league', label: 'Matchweek 35', leagueRound: 34 },
  { slot: 48, day: 273, kind: 'league', label: 'Matchweek 36', leagueRound: 35 },
  { slot: 49, day: 280, kind: 'league', label: 'Matchweek 37', leagueRound: 36 },
  { slot: 50, day: 287, kind: 'league', label: 'Matchweek 38 (Final Day)', leagueRound: 37 },
  { slot: 51, day: 294, kind: 'dom_cup', label: 'Domestic Cup · Final', roundIdx: 3 },
  { slot: 52, day: 301, kind: 'euro', label: 'Europe · Finals', roundIdx: 3 },
  { slot: 53, day: 312, kind: 'intl_tourney', label: 'Intl Cup · Round of 32', roundIdx: 0 },
  { slot: 54, day: 316, kind: 'intl_tourney', label: 'Intl Cup · Round of 16', roundIdx: 1 },
  { slot: 55, day: 320, kind: 'intl_tourney', label: 'Intl Cup · Quarter-Final', roundIdx: 2 },
  { slot: 56, day: 324, kind: 'intl_tourney', label: 'Intl Cup · Semi-Final', roundIdx: 3 },
  { slot: 57, day: 328, kind: 'intl_tourney', label: 'Intl Cup · Final', roundIdx: 4 },
];

function buildSeasonCompetitions(season, seedBase, clubsState, euroQualifiers = null) {
  const rng = makeDetRng(seedBase ^ (season * 0x9e3779b1));
  const competitions = {};

  // 1) 5 Top Leagues
  for (const lg of LEAGUES) {
    const clubs = getClubsByLeague(lg.id);
    const ids = clubs.map((c) => c.id);
    const rr = buildRoundRobin(ids, rng); // 38 rounds for 20 teams, 34 rounds for 18 teams
    const leagueSlots = SEASON_SLOTS.filter((s) => s.kind === 'league').map((s) => s.slot);
    // Distribute 34 rounds cleanly across the 38 league slots for 18-team leagues
    const fixtures = [];
    for (let r = 0; r < rr.length; r++) {
      const mappedIdx = rr.length === 34
        ? Math.round((r * 37) / 33)
        : r;
      const slot = leagueSlots[clamp(mappedIdx, 0, leagueSlots.length - 1)];
      rr[r].forEach(([hId, aId], idx) => {
        fixtures.push({
          id: `lg_${lg.id}_r${r}_${idx}`,
          compId: `lg_${lg.id}`,
          roundIdx: r,
          roundLabel: `Matchweek ${r + 1}`,
          slot,
          homeId: hId,
          awayId: aId,
          neutral: false,
          played: false,
          scoreH: null,
          scoreA: null,
          events: [],
        });
      });
    }
    const standings = {};
    ids.forEach((tid) => { standings[tid] = makeEmptyStanding(tid); });
    competitions[`lg_${lg.id}`] = {
      id: `lg_${lg.id}`,
      name: lg.name,
      shortName: lg.name,
      type: 'league',
      country: lg.country,
      leagueMeta: lg,
      isKnockout: false,
      teams: ids,
      standings,
      fixtures,
      championId: null,
      leaders: {},
    };

    // 2) Domestic Cup (Top 16 rated clubs in that nation)
    const sortedByPower = clubs.slice().sort((a, b) => (clubsState[b.id]?.rating || b.rating) - (clubsState[a.id]?.rating || a.rating));
    const cupSlots = SEASON_SLOTS.filter((s) => s.kind === 'dom_cup').map((s) => s.slot);
    competitions[`cup_${lg.id}`] = makeKnockoutComp(
      `cup_${lg.id}`,
      lg.cupName,
      lg.cupName,
      'cup',
      lg.country,
      sortedByPower.slice(0, 16).map((c) => c.id),
      'Round of 16',
      cupSlots,
      rng,
      true,
    );

    // 3) League Cup (16 clubs in that nation)
    const lcupPool = sortedByPower.slice(0, 16).map((c) => c.id);
    const lcupSlots = SEASON_SLOTS.filter((s) => s.kind === 'league_cup').map((s) => s.slot);
    competitions[`lcup_${lg.id}`] = makeKnockoutComp(
      `lcup_${lg.id}`,
      lg.leagueCupName,
      lg.leagueCupName,
      'league_cup',
      lg.country,
      lcupPool,
      'Round of 16',
      lcupSlots,
      rng,
      true,
    );
  }

  // 4) UCL & UEL (16 clubs each)
  let uclIds = [];
  let uelIds = [];
  if (euroQualifiers && euroQualifiers.ucl && euroQualifiers.ucl.length >= 16) {
    uclIds = euroQualifiers.ucl.slice(0, 16);
    uelIds = (euroQualifiers.uel || []).slice(0, 16);
  } else {
    // Season 1 qualification based on club prestige/ratings across all 5 leagues
    const uclSet = new Set();
    for (const lg of LEAGUES) {
      const clubs = getClubsByLeague(lg.id).slice().sort((a, b) => b.rating - a.rating);
      const uclCount = lg.id === 'eng' || lg.id === 'esp' ? 4 : lg.id === 'fra' ? 2 : 3;
      clubs.slice(0, uclCount).forEach((c) => { uclIds.push(c.id); uclSet.add(c.id); });
    }
    const rest = CLUBS.filter((c) => !uclSet.has(c.id)).sort((a, b) => b.rating - a.rating);
    while (uclIds.length < 16 && rest.length) {
      const next = rest.shift();
      uclIds.push(next.id);
      uclSet.add(next.id);
    }
    uelIds = rest.slice(0, 16).map((c) => c.id);
  }
  const euroSlots = SEASON_SLOTS.filter((s) => s.kind === 'euro').map((s) => s.slot);
  competitions.ucl = makeKnockoutComp('ucl', 'UEFA Champions League', 'Champions League', 'ucl', 'Europe', uclIds, 'Round of 16', euroSlots, rng, true);
  competitions.uel = makeKnockoutComp('uel', 'UEFA Europa League', 'Europa League', 'uel', 'Europe', uelIds, 'Round of 16', euroSlots, rng, true);

  // 5) International Friendlies (3 breaks x 16 fixtures across all 32 nations)
  const intlSlots = SEASON_SLOTS.filter((s) => s.kind === 'intl_break').map((s) => s.slot);
  const friendlies = [];
  const nationIds = NATIONS.map((n) => n.id);
  intlSlots.forEach((slot, bIdx) => {
    const shuf = nationIds.slice();
    for (let i = shuf.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = shuf[i]; shuf[i] = shuf[j]; shuf[j] = t;
    }
    for (let i = 0; i < shuf.length; i += 2) {
      friendlies.push({
        id: `intl_fr_${bIdx}_${i / 2}`,
        compId: 'intl_friendlies',
        roundIdx: bIdx,
        roundLabel: `International Break ${bIdx + 1}`,
        slot,
        homeId: shuf[i],
        awayId: shuf[i + 1],
        neutral: false,
        played: false,
        scoreH: null,
        scoreA: null,
        events: [],
      });
    }
  });
  competitions.intl_friendlies = {
    id: 'intl_friendlies',
    name: 'International Friendlies',
    shortName: 'Friendlies',
    type: 'intl_friendly',
    country: 'World',
    isKnockout: false,
    teams: nationIds,
    standings: null,
    fixtures: friendlies,
    championId: null,
    leaders: {},
  };

  // 6) Summer International Tournament (World Cup on even seasons, Continental Championship on odd seasons)
  const isWorldCup = season % 2 === 0;
  const tourneyName = isWorldCup ? 'FIFA World Cup' : 'Continental Championship';
  const tourneySlots = SEASON_SLOTS.filter((s) => s.kind === 'intl_tourney').map((s) => s.slot);
  competitions.intl_cup = makeKnockoutComp(
    'intl_cup',
    tourneyName,
    isWorldCup ? 'World Cup' : 'Continental Cup',
    'intl_tourney',
    'International',
    nationIds,
    'Round of 32',
    tourneySlots,
    rng,
    true,
  );

  return competitions;
}

// ---- Create New Career -----------------------------------------------------

export function createNewCareer(config) {
  const baseYear = 2026;
  const seed = hashStr(`${config.name}_${config.clubId}_${Date.now()}`) || 1337;
  const pos = config.position || 'ST';
  const role = posToEngineRole(pos);
  const attrs = config.attrs ? { ...config.attrs } : presetAttrsForTier(pos, config.tier || 'wonderkid');
  const ovr = computeOvr(pos, attrs);

  const pro = {
    id: 'pro_user',
    name: (config.name || 'Alex Mercer').trim() || 'Alex Mercer',
    age: clamp(Number(config.age) || 19, 16, 38),
    nationality: config.nationality || 'England',
    pos,
    role,
    preferredFoot: config.preferredFoot || 'Right',
    number: clamp(Number(config.number) || 9, 1, 99),
    clubId: config.clubId || CLUBS[0].id,
    ovr,
    attrs,
    tier: config.tier || 'wonderkid',
    appearance: {
      skin: (config.appearance && config.appearance.skin) || '#e5b48c',
      hairStyle: (config.appearance && config.appearance.hairStyle) || 'quiff',
      hairColor: (config.appearance && config.appearance.hairColor) || '#241a10',
      bootUpper: (config.appearance && config.appearance.bootUpper) || '#141418',
      bootFlash: (config.appearance && config.appearance.bootFlash) || '#f4cd72',
      bootSole: (config.appearance && config.appearance.bootSole) || '#5f666e',
      height: clamp(Number(config.appearance && config.appearance.height) || 1.81, 1.68, 1.98),
      build: clamp(Number(config.appearance && config.appearance.build) || 1.0, 0.90, 1.15),
    },
    coachTrust: config.tier === 'star' ? 76 : config.tier === 'wonderkid' ? 60 : 46,
    calledUp: false,
    ntDecision: 'none', // 'none' | 'joined' | 'declined' (always user-controlled)
    nationalTeamId: findNationForCountry(config.nationality || 'England').id,
    attrXp: emptyAttrXp(),
    training: { lastWeekSlot: 0, sessionsUsed: 0, maxPerWeek: 2, history: [] },
    drillHighScores: emptyDrillHighScores(),
    seasonStats: emptyCareerTotals(),
    careerStats: emptyCareerTotals(),
    ratingHistory: [], // { matchLabel, compName, rating, goals, assists, scoreline }
    trophies: [], // { season, compName, clubName }
  };

  const clubsState = {};
  for (const t of [...CLUBS, ...NATIONS]) {
    clubsState[t.id] = {
      rating: t.rating,
      budget: initClubBudgetM(t),
      manager: { ...t.manager },
      form: [],
      fatigue: 0,
      squad: t.squad.map((p) => ({ ...p, attrs: { ...p.attrs } })),
    };
  }

  const competitions = buildSeasonCompetitions(1, seed, clubsState, null);
  const career = {
    version: 1,
    squadCurveVersion: 3,
    seed,
    baseYear,
    season: 1,
    currentSlot: 0,
    seasonCompleted: false,
    pro,
    clubsState,
    competitions,
    transferHistory: [],
    latestMatch: null,
    seasonReview: null,
    prefs: {
      controlMode: 'full', // 'full' | 'pro'
      cameraMode: 'broadcast', // 'broadcast' | 'pro' | ...
      difficulty: 'pro',
      halfMinutes: 4,
      homeKitPref: 'home',
      awayKitPref: 'auto',
      formation: null,
      tacticalStyle: null,
    },
  };

  advanceSlotToNextUserOrEnd(career);
  career.pro.training.lastWeekSlot = career.currentSlot;
  saveCareer(career);
  return career;
}

function emptyCareerTotals() {
  return {
    apps: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    motm: 0,
    shotsOnTarget: 0,
    keyPasses: 0,
    tackles: 0,
    saves: 0,
    yellows: 0,
    reds: 0,
    ratingSum: 0,
    avgRating: 0,
  };
}

export function findNationForCountry(countryName) {
  const lower = String(countryName || '').toLowerCase().trim();
  const exact = NATIONS.find((n) =>
    (n.name && n.name.toLowerCase() === lower) ||
    (n.country && n.country.toLowerCase() === lower) ||
    (n.short && n.short.toLowerCase() === lower) ||
    (n.abbr && n.abbr.toLowerCase() === lower)
  );
  if (exact) return exact;
  return NATIONS[0];
}

// World Perception & NT Selector AI Appraisal (advisory only — user ALWAYS decides)
export function computeWorldNtOpinion(career) {
  ensureCareerStateUpgrades(career);
  const pro = career.pro;
  const nation = findNationForCountry(pro.nationality);
  const nationState = career.clubsState?.[pro.nationalTeamId || nation.id];
  const squad = (nationState && nationState.squad) || nation.squad || [];
  const sameRole = squad.filter((p) => p.role === pro.role).sort((a, b) => b.ovr - a.ovr);
  const competitors = sameRole.slice(0, 3).map((p) => ({ name: p.name, pos: p.pos, ovr: p.ovr, age: p.age }));
  const thresholdOvr = sameRole.length >= 2
    ? sameRole[Math.min(2, sameRole.length - 1)].ovr - 2
    : (nation.rating - 6);

  const apps = pro.seasonStats?.apps || 0;
  const avg = pro.seasonStats?.avgRating || 0;
  const ga = (pro.seasonStats?.goals || 0) + (pro.seasonStats?.assists || 0);
  const club = getTeamById(pro.clubId);
  const clubStatureBonus = clamp(((club?.rating || 75) - 74) * 0.6, -3, 8);
  const ovrDelta = pro.ovr - thresholdOvr;
  const formPoints = apps > 0 ? clamp((avg - 6.3) * 14, -12, 26) : -6;
  const samplePoints = clamp(apps * 2.2, 0, 18);
  const outputPoints = clamp(ga * 2.0 + (pro.seasonStats?.motm || 0) * 3.5 + (pro.seasonStats?.cleanSheets || 0) * 2.2, 0, 20);

  const readinessScore = Math.round(clamp(42 + ovrDelta * 3.1 + formPoints + samplePoints + outputPoints + clubStatureBonus, 5, 99));

  let tierLabel = 'Unproven Prospect';
  let headline = `${nation.short || nation.name} press still waiting to see ${pro.name} prove himself at club level.`;
  let selectorQuote = `"${pro.name} has talent, but our ${pro.role} spots are competitive. Show strong match ratings week in, week out."`;
  if (readinessScore >= 82) {
    tierLabel = 'Undroppable Star';
    headline = `National outcry to start ${pro.name} for ${nation.name}!`;
    selectorQuote = `"His club form (${avg ? avg.toFixed(1) : 'elite'} avg) and ${pro.ovr} OVR make him impossible to overlook — the shirt is his if he wants it."`;
  } else if (readinessScore >= 68) {
    tierLabel = 'Fan Favorite';
    headline = `Pundits push for ${pro.name} to join the ${nation.short || nation.name} camp.`;
    selectorQuote = `"${pro.name} is playing well above the threshold (${thresholdOvr} OVR). We'd love him in the squad whenever he chooses to commit."`;
  } else if (readinessScore >= 52) {
    tierLabel = 'Strong Contender';
    headline = `Scouts tracking ${pro.name} closely at ${club.name}.`;
    selectorQuote = `"He's pushing into our conversation against ${competitors[0]?.name || 'senior starters'}. A few more big performances will cement his claim."`;
  } else if (readinessScore >= 36) {
    tierLabel = 'On Scouting Radar';
    headline = `${nation.short || nation.name} staff monitoring ${pro.name}'s development.`;
    selectorQuote = `"Still building momentum at ${club.name}. Keep training and logging minutes — though the final call on international duty is always the player's."`;
  }

  let positionRank = 1;
  for (const r of sameRole) {
    if (r.ovr > pro.ovr) positionRank++;
  }

  return {
    nation,
    readinessScore,
    tierLabel,
    headline,
    selectorQuote,
    thresholdOvr,
    userOvr: pro.ovr,
    positionRank,
    competitors,
  };
}

// Explicit, unconditional user decision — World AI never blocks or overrides the player's choice
export function setNationalTeamSelection(career, joinNationalTeam) {
  ensureCareerStateUpgrades(career);
  career.pro.calledUp = !!joinNationalTeam;
  career.pro.ntDecision = joinNationalTeam ? 'joined' : 'declined';
  saveCareer(career);
  return career.pro;
}

// ---- Weekly Training & 3D Drill Progression --------------------------------

export function getTrainingStatus(career) {
  ensureCareerStateUpgrades(career);
  const t = career.pro.training;
  if (t.lastWeekSlot !== career.currentSlot) {
    t.lastWeekSlot = career.currentSlot;
    t.sessionsUsed = 0;
  }
  const remaining = Math.max(0, (t.maxPerWeek || 2) - (t.sessionsUsed || 0));
  return {
    sessionsUsed: t.sessionsUsed || 0,
    maxPerWeek: t.maxPerWeek || 2,
    remaining,
    weekSlot: t.lastWeekSlot,
    history: t.history || [],
    highScores: career.pro.drillHighScores || emptyDrillHighScores(),
  };
}

export function gradeForDrillScore(drill, score) {
  const s = Math.max(0, Number(score) || 0);
  if (!drill) return 'Bronze';
  if (s >= drill.eliteScore) return 'Elite';
  if (s >= drill.goldScore) return 'Gold';
  if (s >= drill.silverScore) return 'Silver';
  return 'Bronze';
}

export function applyTrainingSession(career, drillId, opts = {}) {
  ensureCareerStateUpgrades(career);
  const status = getTrainingStatus(career);
  if (status.remaining <= 0) {
    return { ok: false, reason: 'no_sessions_left' };
  }
  const drill = TRAINING_DRILLS.find((d) => d.id === drillId) || TRAINING_DRILLS[0];
  const mode = opts.mode === '3d' ? '3d' : 'quick';
  const pro = career.pro;
  const oldOvr = pro.ovr;

  let grade = 'Silver';
  let score = 0;
  let baseXp = 44;
  if (mode === '3d') {
    score = Math.max(0, Math.round(Number(opts.score) || 0));
    grade = gradeForDrillScore(drill, score);
    if (score > (pro.drillHighScores[drill.id] || 0)) {
      pro.drillHighScores[drill.id] = score;
    }
    baseXp = grade === 'Elite' ? 115 : grade === 'Gold' ? 88 : grade === 'Silver' ? 66 : 45;
  }

  const ageFactor = pro.age <= 21 ? 1.24 : pro.age <= 25 ? 1.05 : pro.age <= 29 ? 0.85 : 0.65;
  const xpAdded = {};
  const gains = {};
  for (const [k, w] of Object.entries(drill.weights)) {
    const add = Math.max(10, Math.round(baseXp * w * ageFactor));
    xpAdded[k] = add;
    pro.attrXp[k] = (pro.attrXp[k] || 0) + add;
    while (pro.attrXp[k] >= 100 && pro.attrs[k] < 99) {
      pro.attrXp[k] -= 100;
      pro.attrs[k] = clamp(pro.attrs[k] + 1, 35, 99);
      gains[k] = (gains[k] || 0) + 1;
    }
    if (pro.attrs[k] >= 99) pro.attrXp[k] = 0;
  }

  pro.ovr = computeOvr(pro.pos, pro.attrs);
  pro.training.sessionsUsed += 1;
  const entry = {
    season: career.season,
    date: getCalendarDate(career),
    drillId: drill.id,
    drillTitle: drill.title,
    mode,
    score,
    grade: mode === '3d' ? grade : 'Focus',
    gains,
    ovrBefore: oldOvr,
    ovrAfter: pro.ovr,
  };
  pro.training.history.unshift(entry);
  if (pro.training.history.length > 20) pro.training.history.length = 20;

  saveCareer(career);
  return {
    ok: true,
    drill,
    mode,
    score,
    grade: entry.grade,
    xpAdded,
    gains,
    oldOvr,
    newOvr: pro.ovr,
    remaining: Math.max(0, pro.training.maxPerWeek - pro.training.sessionsUsed),
  };
}

// ---- Global Transfer Market & Club Budgets ---------------------------------

function recomputeClubRatingFromState(clubState) {
  if (!clubState || !Array.isArray(clubState.squad) || !clubState.squad.length) return;
  const top11 = clubState.squad.slice().sort((a, b) => (b.ovr || 70) - (a.ovr || 70)).slice(0, 11);
  const avg11 = top11.reduce((s, p) => s + (p.ovr || 70), 0) / top11.length;
  clubState.rating = Math.round(clamp(avg11 + 1.0, 68, 93));
}

export function executeGlobalTransfer(career, { playerId, fromClubId, toClubId, feeM = 0, isPro = false, allowOverBudget = false }) {
  ensureCareerStateUpgrades(career);
  if (!fromClubId || !toClubId || fromClubId === toClubId) {
    return { ok: false, reason: 'same_club' };
  }
  const fromSt = career.clubsState?.[fromClubId];
  const toSt = career.clubsState?.[toClubId];
  if (!fromSt || !toSt) return { ok: false, reason: 'invalid_club' };

  const cleanFee = Math.max(0, Math.round((Number(feeM) || 0) * 10) / 10);
  if (!allowOverBudget && cleanFee > toSt.budget) {
    return { ok: false, reason: 'insufficient_budget', buyerBudget: toSt.budget, feeM: cleanFee };
  }

  let movedPlayer = null;
  if (isPro) {
    if (career.pro.clubId !== fromClubId) return { ok: false, reason: 'pro_not_at_club' };
    career.pro.clubId = toClubId;
    career.pro.coachTrust = Math.max(58, career.pro.coachTrust);
    movedPlayer = { id: career.pro.id, name: career.pro.name, pos: career.pro.pos, ovr: career.pro.ovr, isPro: true };
  } else {
    const idx = fromSt.squad.findIndex((p) => p.id === playerId);
    if (idx < 0) return { ok: false, reason: 'player_not_found' };
    if (fromSt.squad.length <= 12) return { ok: false, reason: 'min_squad_size' };
    const candidate = fromSt.squad[idx];
    const gkCount = fromSt.squad.filter((p) => p.role === 'GK').length;
    if (candidate.role === 'GK' && gkCount <= 1) return { ok: false, reason: 'need_one_gk' };

    const [removed] = fromSt.squad.splice(idx, 1);
    toSt.squad.push(removed);
    movedPlayer = removed;
    recomputeClubRatingFromState(fromSt);
    recomputeClubRatingFromState(toSt);
  }

  fromSt.budget = Math.round((fromSt.budget + cleanFee) * 10) / 10;
  toSt.budget = Math.round((toSt.budget - cleanFee) * 10) / 10;

  const logEntry = {
    id: `tr_${career.season}_${(career.transferHistory?.length || 0) + 1}`,
    season: career.season,
    date: getCalendarDate(career),
    playerId: movedPlayer.id,
    playerName: movedPlayer.name,
    pos: movedPlayer.pos,
    ovr: movedPlayer.ovr,
    fromClubId,
    toClubId,
    feeM: cleanFee,
    isPro: !!isPro,
  };
  career.transferHistory.unshift(logEntry);
  if (career.transferHistory.length > 80) career.transferHistory.length = 80;

  saveCareer(career);
  return {
    ok: true,
    entry: logEntry,
    sellerBudget: fromSt.budget,
    buyerBudget: toSt.budget,
    sellerRating: fromSt.rating,
    buyerRating: toSt.rating,
  };
}

// ---- Calendar navigation & fixture lookup ----------------------------------

export function getCalendarDate(career, slotIdx = career.currentSlot) {
  const s = SEASON_SLOTS[clamp(slotIdx, 0, SEASON_SLOTS.length - 1)];
  const year = career.baseYear + (career.season - 1);
  return formatDateFromOffset(year, s.day);
}

export function getSlotMeta(slotIdx) {
  return SEASON_SLOTS[clamp(slotIdx, 0, SEASON_SLOTS.length - 1)];
}

export function getUserFixtureAtSlot(career, slotIdx) {
  const clubId = career.pro.clubId;
  const ntId = career.pro.nationalTeamId;
  const slotMeta = SEASON_SLOTS[slotIdx];
  if (!slotMeta) return null;

  for (const comp of Object.values(career.competitions)) {
    const isIntl = comp.type === 'intl_friendly' || comp.type === 'intl_tourney';
    if (isIntl && !career.pro.calledUp) continue;
    const myId = isIntl ? ntId : clubId;
    const f = comp.fixtures.find(
      (fx) => fx.slot === slotIdx && !fx.played && (fx.homeId === myId || fx.awayId === myId),
    );
    if (f) return f;
  }
  return null;
}

export function getNextUserFixture(career) {
  if (!career || career.seasonCompleted) return null;
  for (let s = career.currentSlot; s < SEASON_SLOTS.length; s++) {
    const f = getUserFixtureAtSlot(career, s);
    if (f) return f;
  }
  return null;
}

function advanceSlotToNextUserOrEnd(career) {
  const rng = makeDetRng(career.seed ^ (career.season * 7919) ^ (career.currentSlot * 3571));
  while (career.currentSlot < SEASON_SLOTS.length) {
    const fx = getUserFixtureAtSlot(career, career.currentSlot);
    if (fx) return fx;
    // No user match in this slot -> simulate all fixtures in this slot cleanly
    simulateUnplayedInSlot(career, career.currentSlot, rng);
    career.currentSlot++;
  }
  career.seasonCompleted = true;
  if (!career.seasonReview) {
    career.seasonReview = buildSeasonReview(career);
  }
  return null;
}

// ---- Standings & Knockout Progression --------------------------------------

export function getStandings(career, compId) {
  const comp = career.competitions[compId];
  if (!comp || !comp.standings) return [];
  return Object.values(comp.standings).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return getTeamById(a.teamId).name.localeCompare(getTeamById(b.teamId).name);
  });
}

export function getClubRank(career, clubId) {
  const team = getTeamById(clubId);
  if (!team || !team.leagueId) return null;
  const rows = getStandings(career, `lg_${team.leagueId}`);
  const idx = rows.findIndex((r) => r.teamId === clubId);
  return idx >= 0 ? idx + 1 : null;
}

export function getLeaders(career, compId) {
  const comp = career.competitions[compId];
  if (!comp || !comp.leaders) return [];
  return Object.values(comp.leaders).map((r) => ({
    ...r,
    avgRating: r.apps > 0 ? Math.round((r.ratingSum / r.apps) * 10) / 10 : 6.5,
  }));
}

function applyFixtureToStandings(comp, fx, clubsState) {
  if (!comp.standings || !fx.played) return;
  const h = comp.standings[fx.homeId];
  const a = comp.standings[fx.awayId];
  if (!h || !a) return;
  const sh = fx.scoreH | 0;
  const sa = fx.scoreA | 0;
  h.p++; a.p++;
  h.gf += sh; h.ga += sa; h.gd = h.gf - h.ga;
  a.gf += sa; a.ga += sh; a.gd = a.gf - a.ga;
  let resH = 'D', resA = 'D';
  if (sh > sa) { h.w++; h.pts += 3; a.l++; resH = 'W'; resA = 'L'; }
  else if (sa > sh) { a.w++; a.pts += 3; h.l++; resH = 'L'; resA = 'W'; }
  else { h.d++; h.pts += 1; a.d++; a.pts += 1; }
  h.form = [...h.form.slice(-4), resH];
  a.form = [...a.form.slice(-4), resA];
  if (clubsState && clubsState[fx.homeId]) {
    clubsState[fx.homeId].form = [...(clubsState[fx.homeId].form || []).slice(-4), resH];
  }
  if (clubsState && clubsState[fx.awayId]) {
    clubsState[fx.awayId].form = [...(clubsState[fx.awayId].form || []).slice(-4), resA];
  }
}

function checkAdvanceKnockout(comp, roundIdx, rng) {
  if (!comp.isKnockout) return;
  const roundFixtures = comp.fixtures.filter((f) => f.roundIdx === roundIdx);
  if (!roundFixtures.length || roundFixtures.some((f) => !f.played)) return;

  const winners = roundFixtures.map((f) => f.winnerId || (f.scoreH >= f.scoreA ? f.homeId : f.awayId));
  if (winners.length <= 1) {
    comp.championId = winners[0] || null;
    return;
  }

  const nextRound = roundIdx + 1;
  // Already generated?
  if (comp.fixtures.some((f) => f.roundIdx === nextRound)) return;
  const nextSlot = comp.roundSlots[nextRound];
  const nextLabel = comp.roundNames[nextRound] || 'Next Round';
  const isFinal = winners.length === 2;
  for (let i = 0; i < winners.length; i += 2) {
    const flip = rng() < 0.5;
    const h = flip ? winners[i + 1] : winners[i];
    const a = flip ? winners[i] : winners[i + 1];
    comp.fixtures.push({
      id: `${comp.id}_r${nextRound}_${i / 2}`,
      compId: comp.id,
      roundIdx: nextRound,
      roundLabel: nextLabel,
      slot: nextSlot,
      homeId: h,
      awayId: a,
      neutral: isFinal && comp.neutralFinal,
      played: false,
      scoreH: null,
      scoreA: null,
      penH: null,
      penA: null,
      winnerId: null,
      events: [],
    });
  }
  comp.currentRound = nextRound;
}

// ---- Realistic xG + Poisson + Coach Tactics Simulation ---------------------

export function getMatchSquadForPreMatch(career, teamId, formationId = '4-3-3') {
  const st = career?.clubsState?.[teamId];
  const baseTeam = getTeamById(teamId);
  const squad = (st && st.squad) || baseTeam.squad;
  const isProTeam = career && career.pro &&
    ((teamId === career.pro.clubId) || (career.pro.calledUp && teamId === career.pro.nationalTeamId));
  let proEntry = null;
  if (isProTeam) {
    proEntry = {
      id: career.pro.id,
      name: career.pro.name,
      pos: career.pro.pos,
      role: career.pro.role,
      ovr: career.pro.ovr,
      number: career.pro.number,
      age: career.pro.age,
      nat: career.pro.nationality,
      preferredFoot: career.pro.preferredFoot,
      attrs: { ...career.pro.attrs },
      appearance: { ...career.pro.appearance },
      isPro: true,
    };
  }
  const built = buildOrderedSquad(squad, proEntry, formationId);
  return {
    lineup: built.lineup,
    bench: built.bench,
    ordered: built.ordered,
    proPlayer: proEntry,
    proInXi: !!(proEntry && built.lineup.some((p) => p && p.isPro)),
  };
}

export function getTeamLineupWithPro(career, teamId, formationId = '4-3-3') {
  return getMatchSquadForPreMatch(career, teamId, formationId).lineup;
}

function recordPlayerLeader(comp, player, teamId, statsDelta) {
  if (!comp.leaders) comp.leaders = {};
  let row = comp.leaders[player.id];
  if (!row) {
    row = {
      id: player.id,
      name: player.name,
      teamId,
      pos: player.pos,
      ovr: player.ovr,
      apps: 0,
      goals: 0,
      assists: 0,
      yellows: 0,
      reds: 0,
      ratingSum: 0,
    };
    comp.leaders[player.id] = row;
  }
  row.teamId = teamId;
  row.ovr = player.ovr;
  row.apps += statsDelta.apps || 0;
  row.goals += statsDelta.goals || 0;
  row.assists += statsDelta.assists || 0;
  row.yellows += statsDelta.yellows || 0;
  row.reds += statsDelta.reds || 0;
  row.ratingSum += statsDelta.rating || 0;
}

function pickWeighted(items, weightFn, rng) {
  let sum = 0;
  const ws = items.map((it) => {
    const w = Math.max(0.05, weightFn(it));
    sum += w;
    return w;
  });
  let r = rng() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function simulateFixture(career, comp, fx, rng) {
  if (fx.played) return null;
  const stH = career.clubsState[fx.homeId] || { rating: 75, manager: getTeamById(fx.homeId).manager, form: [], fatigue: 0 };
  const stA = career.clubsState[fx.awayId] || { rating: 75, manager: getTeamById(fx.awayId).manager, form: [], fatigue: 0 };

  const styleH = TACTICAL_STYLES[stH.manager?.style] || TACTICAL_STYLES.balanced;
  const styleA = TACTICAL_STYLES[stA.manager?.style] || TACTICAL_STYLES.balanced;
  const mgrH = stH.manager?.tacticalRating || 76;
  const mgrA = stA.manager?.tacticalRating || 76;

  // Base rating + tactical matchup + form + fatigue + home advantage
  const ratDiff = (stH.rating - stA.rating) * 0.048;
  const tacDiff = (mgrH - mgrA) * 0.014;
  const matchH = (TACTIC_MATCHUP[styleH.id] && TACTIC_MATCHUP[styleH.id][styleA.id]) || 0;
  const matchA = (TACTIC_MATCHUP[styleA.id] && TACTIC_MATCHUP[styleA.id][styleH.id]) || 0;

  const formScore = (arr) => (arr || []).reduce((acc, ch) => acc + (ch === 'W' ? 0.04 : ch === 'L' ? -0.04 : 0), 0);
  const homeAdv = fx.neutral ? 0.0 : 0.26;
  const fatH = clamp((stH.fatigue || 0) * 0.18, 0, 0.25);
  const fatA = clamp((stA.fatigue || 0) * 0.18, 0, 0.25);

  const lambdaH = clamp(
    1.28 + ratDiff + tacDiff + homeAdv + styleH.simAtt - styleA.simDef * 0.6 + matchH + formScore(stH.form) - fatH,
    0.32, 3.85,
  );
  const lambdaA = clamp(
    1.18 - ratDiff - tacDiff + styleA.simAtt - styleH.simDef * 0.6 + matchA + formScore(stA.form) - fatA,
    0.28, 3.65,
  );

  const scoreH = samplePoisson(lambdaH, rng);
  const scoreA = samplePoisson(lambdaA, rng);
  fx.scoreH = scoreH;
  fx.scoreA = scoreA;
  fx.played = true;

  // Fatigue update (high-press / gegenpress styles burn more)
  stH.fatigue = clamp((stH.fatigue || 0) * 0.6 + 0.16 * styleH.staminaDrain, 0, 1);
  stA.fatigue = clamp((stA.fatigue || 0) * 0.6 + 0.16 * styleA.staminaDrain, 0, 1);

  if (comp.isKnockout) {
    if (scoreH > scoreA) fx.winnerId = fx.homeId;
    else if (scoreA > scoreH) fx.winnerId = fx.awayId;
    else {
      // Extra time / penalties tiebreak weighted slightly by rating + GK + mgr rating
      const pEdge = 0.5 + clamp((stH.rating - stA.rating) * 0.008 + (mgrH - mgrA) * 0.004, -0.15, 0.15);
      const hWin = rng() < pEdge;
      fx.winnerId = hWin ? fx.homeId : fx.awayId;
      const basePen = 3 + Math.floor(rng() * 3);
      fx.penH = hWin ? basePen + 1 : basePen;
      fx.penA = hWin ? basePen : basePen + 1;
    }
  }

  // Assign individual goals, assists, cards, ratings & track Pro performance if present
  const xiH = getTeamLineupWithPro(career, fx.homeId);
  const xiA = getTeamLineupWithPro(career, fx.awayId);
  const events = [];
  const pPerf = new Map();
  const getP = (p) => {
    let o = pPerf.get(p.id);
    if (!o) {
      o = { goals: 0, assists: 0, yellows: 0, reds: 0, saves: 0, shotsOnTarget: 0, keyPasses: 0, tackles: 0 };
      pPerf.set(p.id, o);
    }
    return o;
  };

  const assignGoals = (xi, teamId, goals) => {
    const scorers = xi.filter((p) => p.role !== 'GK');
    for (let g = 0; g < goals; g++) {
      const scorer = pickWeighted(scorers, (p) => {
        const wRole = p.role === 'FW' ? 5.2 : p.role === 'MF' ? 2.2 : 0.45;
        const wSub = p.pos === 'ST' ? 1.5 : p.pos === 'CAM' ? 1.2 : 1.0;
        return wRole * wSub * (0.7 + (p.ovr - 60) / 50);
      }, rng);
      const sp = getP(scorer);
      sp.goals++;
      sp.shotsOnTarget++;
      let assister = null;
      if (rng() < 0.78) {
        const pool = scorers.filter((p) => p.id !== scorer.id);
        assister = pickWeighted(pool, (p) => {
          const wRole = p.role === 'MF' ? 4.4 : p.role === 'FW' ? 2.6 : 1.1;
          return wRole * (0.7 + (p.ovr - 60) / 55);
        }, rng);
        const ap = getP(assister);
        ap.assists++;
        ap.keyPasses++;
      }
      const min = 1 + Math.floor(rng() * 90);
      events.push({ type: 'goal', teamId, minute: min, scorer: scorer.name, scorerId: scorer.id, assister: assister?.name || null });
    }
  };

  assignGoals(xiH, fx.homeId, scoreH);
  assignGoals(xiA, fx.awayId, scoreA);

  const assignCards = (xi) => {
    const cardCount = Math.floor(rng() * 3.1);
    for (let c = 0; c < cardCount; c++) {
      const p = pickWeighted(xi, (x) => (x.role === 'DF' ? 2.5 : x.role === 'MF' ? 1.8 : 0.7), rng);
      const pf = getP(p);
      if (pf.yellows === 0 && rng() < 0.94) pf.yellows++;
      else if (pf.reds === 0) pf.reds++;
    }
  };
  assignCards(xiH);
  assignCards(xiA);

  let motm = null;
  let bestR = -1;
  let proOutcome = null;

  const finalizeSide = (xi, teamId, myG, oppG) => {
    const won = myG > oppG;
    const drew = myG === oppG;
    const cs = oppG === 0;
    for (const p of xi) {
      const pf = getP(p);
      if (p.role === 'GK') {
        pf.saves = Math.max(0, Math.round(lambdaH * (teamId === fx.awayId ? 2.4 : 1.8) - oppG + rng() * 2));
      } else {
        pf.tackles = (p.role === 'DF' || p.pos === 'CDM') ? Math.floor(rng() * 5) : Math.floor(rng() * 2.5);
        if (rng() < 0.45) pf.keyPasses += p.role === 'MF' ? 1 : 0;
        if (rng() < 0.4 && p.role !== 'DF') pf.shotsOnTarget += 1;
      }
      const base = 6.2 + ((p.ovr - 74) * 0.015) + (won ? 0.4 : drew ? 0.08 : -0.22);
      const raw = base
        + pf.goals * 1.15
        + pf.assists * 0.75
        + pf.saves * 0.22
        + (cs && (p.role === 'GK' || p.role === 'DF') ? 0.55 : 0)
        + (rng() - 0.45) * 0.7
        - pf.yellows * 0.35
        - pf.reds * 1.35
        - (p.role === 'GK' ? oppG * 0.32 : oppG * 0.10);
      const rating = Math.round(clamp(raw, 4.1, 10.0) * 10) / 10;
      recordPlayerLeader(comp, p, teamId, {
        apps: 1,
        goals: pf.goals,
        assists: pf.assists,
        yellows: pf.yellows,
        reds: pf.reds,
        rating,
      });
      if (rating > bestR) {
        bestR = rating;
        motm = { id: p.id, name: p.name, teamId, rating };
      }
      if (p.isPro) {
        proOutcome = {
          rating,
          goals: pf.goals,
          assists: pf.assists,
          cleanSheet: cs,
          shotsOnTarget: pf.shotsOnTarget,
          keyPasses: pf.keyPasses,
          tackles: pf.tackles,
          saves: pf.saves,
          yellows: pf.yellows,
          reds: pf.reds,
          motm: false,
        };
      }
    }
  };

  finalizeSide(xiH, fx.homeId, scoreH, scoreA);
  finalizeSide(xiA, fx.awayId, scoreA, scoreH);
  if (proOutcome && motm && motm.id === career.pro.id) proOutcome.motm = true;
  events.sort((a, b) => a.minute - b.minute);
  fx.events = events;
  fx.motm = motm;

  applyFixtureToStandings(comp, fx, career.clubsState);
  checkAdvanceKnockout(comp, fx.roundIdx, rng);

  return proOutcome;
}

function simulateUnplayedInSlot(career, slotIdx, rng) {
  for (const comp of Object.values(career.competitions)) {
    const due = comp.fixtures.filter((f) => f.slot === slotIdx && !f.played);
    for (const fx of due) {
      simulateFixture(career, comp, fx, rng);
    }
  }
  // Slight fatigue recovery across non-playing clubs
  for (const st of Object.values(career.clubsState)) {
    st.fatigue = clamp((st.fatigue || 0) * 0.85, 0, 1);
  }
}

// ---- Pro Progression, Coach Trust & NT Call-Ups ----------------------------

function applyProProgression(career, fixture, comp, proPerf, played3d) {
  const pro = career.pro;
  const rating = clamp(proPerf.rating || 6.5, 3.0, 10.0);
  const oldOvr = pro.ovr;
  const oldTrust = pro.coachTrust;

  // Update season & career stats
  for (const bag of [pro.seasonStats, pro.careerStats]) {
    bag.apps += 1;
    bag.goals += proPerf.goals || 0;
    bag.assists += proPerf.assists || 0;
    bag.cleanSheets += proPerf.cleanSheet ? 1 : 0;
    bag.motm += proPerf.motm ? 1 : 0;
    bag.shotsOnTarget += proPerf.shotsOnTarget || 0;
    bag.keyPasses += proPerf.keyPasses || 0;
    bag.tackles += proPerf.tackles || 0;
    bag.saves += proPerf.saves || 0;
    bag.yellows += proPerf.yellows || 0;
    bag.reds += proPerf.reds || 0;
    bag.ratingSum = Math.round((bag.ratingSum + rating) * 10) / 10;
    bag.avgRating = Math.round((bag.ratingSum / bag.apps) * 10) / 10;
  }

  // Record trophy if Final winner
  if (comp.isKnockout && comp.championId && (comp.championId === pro.clubId || comp.championId === pro.nationalTeamId)) {
    const already = pro.trophies.some((t) => t.season === career.season && t.compId === comp.id);
    if (!already) {
      pro.trophies.push({
        season: career.season,
        compId: comp.id,
        compName: comp.name,
        clubName: getTeamById(comp.championId).name,
      });
    }
  }

  // History entry
  const hTeam = getTeamById(fixture.homeId);
  const aTeam = getTeamById(fixture.awayId);
  const penStr = fixture.penH != null ? ` (${fixture.penH}-${fixture.penA} pen)` : '';
  const scoreline = `${hTeam.abbr} ${fixture.scoreH}-${fixture.scoreA} ${aTeam.abbr}${penStr}`;
  pro.ratingHistory.unshift({
    season: career.season,
    date: getCalendarDate(career, fixture.slot),
    compName: comp.shortName || comp.name,
    scoreline,
    rating,
    goals: proPerf.goals || 0,
    assists: proPerf.assists || 0,
    motm: !!proPerf.motm,
  });
  if (pro.ratingHistory.length > 25) pro.ratingHistory.length = 25;

  // Coach Trust delta
  const trustDelta = Math.round((rating - 6.4) * 3.2 + (proPerf.motm ? 3 : 0) - (proPerf.reds ? 8 : 0));
  pro.coachTrust = clamp(pro.coachTrust + trustDelta, 10, 100);

  // Attribute growth (younger players climb quicker; strong ratings boost key positional stats)
  const ageFactor = pro.age <= 21 ? 1.35 : pro.age <= 25 ? 1.0 : pro.age <= 29 ? 0.65 : 0.25;
  const playBonus = played3d ? 1.25 : 0.85;
  const perfScore = (rating - 6.1) * 0.42 * ageFactor * playBonus;
  const attrChanges = {};
  if (perfScore > 0.1) {
    const role = pro.role;
    const rng = makeDetRng(career.seed ^ (pro.careerStats.apps * 4999) ^ Math.round(rating * 100));
    const weights = {
      pace: role === 'FW' ? 0.55 : role === 'DF' ? 0.4 : 0.35,
      shooting: role === 'FW' ? 0.72 : role === 'MF' ? 0.42 : 0.22,
      passing: role === 'MF' ? 0.72 : 0.45,
      dribbling: (role === 'FW' || role === 'MF') ? 0.62 : 0.3,
      defending: (role === 'DF' || role === 'GK') ? 0.75 : 0.18,
      physical: 0.44,
    };
    for (const [k, w] of Object.entries(weights)) {
      const gain = (perfScore * w + rng() * 0.45) > 0.82 ? 1 : 0;
      if (gain > 0 && pro.attrs[k] < 96) {
        pro.attrs[k] = clamp(pro.attrs[k] + gain, 35, 97);
        attrChanges[k] = gain;
      }
    }
  } else if (rating < 5.0 && pro.age > 30) {
    pro.attrs.pace = clamp(pro.attrs.pace - 1, 40, 97);
    attrChanges.pace = -1;
  }
  pro.ovr = computeOvr(pro.pos, pro.attrs);

  career.latestMatch = {
    compId: comp.id,
    compName: comp.name,
    roundLabel: fixture.roundLabel,
    date: getCalendarDate(career, fixture.slot),
    homeId: fixture.homeId,
    awayId: fixture.awayId,
    homeName: hTeam.name,
    awayName: aTeam.name,
    scoreH: fixture.scoreH,
    scoreA: fixture.scoreA,
    penH: fixture.penH ?? null,
    penA: fixture.penA ?? null,
    motm: fixture.motm,
    proPerf,
    ovrBefore: oldOvr,
    ovrAfter: pro.ovr,
    trustBefore: oldTrust,
    trustAfter: pro.coachTrust,
    attrChanges,
  };
  return career.latestMatch;
}

// ---- Apply 3D Match Report OR Sim Matchweek --------------------------------

export function applyUserMatchResult(career, fixture, matchReport, swapped3dSides = false) {
  const comp = career.competitions[fixture.compId];
  if (!comp || fixture.played) return null;

  const rawH = matchReport?.score?.home ?? 0;
  const rawA = matchReport?.score?.away ?? 0;
  const h = swapped3dSides ? rawA : rawH;
  const a = swapped3dSides ? rawH : rawA;
  fixture.scoreH = h | 0;
  fixture.scoreA = a | 0;
  fixture.played = true;

  const rng = makeDetRng(career.seed ^ (career.season * 3137) ^ (fixture.slot * 997));
  if (comp.isKnockout) {
    if (h > a) fixture.winnerId = fixture.homeId;
    else if (a > h) fixture.winnerId = fixture.awayId;
    else {
      // Tiebreaker shootout if 3D knockout finishes level
      const userIsHome = fixture.homeId === career.pro.clubId || fixture.homeId === career.pro.nationalTeamId;
      const userEdge = userIsHome ? 0.54 : 0.46;
      const hWin = rng() < userEdge;
      fixture.winnerId = hWin ? fixture.homeId : fixture.awayId;
      fixture.penH = hWin ? 5 : 4;
      fixture.penA = hWin ? 4 : 5;
    }
  }

  // Record all 3D match player performances into competition leaders
  const players = (matchReport && matchReport.players) || [];
  let proReport = matchReport?.pro || null;
  const mapTeamId = (side) => {
    if (!swapped3dSides) return side === 'away' ? fixture.awayId : fixture.homeId;
    return side === 'away' ? fixture.homeId : fixture.awayId;
  };
  for (const pr of players) {
    const teamId = mapTeamId(pr.team);
    recordPlayerLeader(comp, {
      id: pr.isPro ? career.pro.id : pr.id,
      name: pr.name,
      pos: pr.role,
      ovr: pr.isPro ? career.pro.ovr : (pr.ovr || 76),
    }, teamId, {
      apps: 1,
      goals: pr.goals || 0,
      assists: pr.assists || 0,
      yellows: pr.yellows || 0,
      reds: pr.reds || 0,
      rating: pr.rating || 6.5,
    });
  }
  fixture.motm = matchReport?.motm ? {
    id: matchReport.motm.isPro ? career.pro.id : matchReport.motm.id,
    name: matchReport.motm.name,
    teamId: mapTeamId(matchReport.motm.team),
    rating: matchReport.motm.rating,
  } : null;

  applyFixtureToStandings(comp, fixture, career.clubsState);
  checkAdvanceKnockout(comp, fixture.roundIdx, rng);

  // Sim all other unplayed matches in the current slot across the world
  simulateUnplayedInSlot(career, fixture.slot, rng);

  const oppGoals = (fixture.homeId === career.pro.clubId || fixture.homeId === career.pro.nationalTeamId) ? a : h;
  const proPerf = proReport ? {
    rating: proReport.rating,
    goals: proReport.goals || 0,
    assists: proReport.assists || 0,
    cleanSheet: oppGoals === 0,
    shotsOnTarget: proReport.shotsOnTarget || 0,
    keyPasses: proReport.keyPasses || 0,
    tackles: proReport.tacklesWon || 0,
    saves: proReport.saves || 0,
    yellows: proReport.yellows || 0,
    reds: proReport.reds || 0,
    motm: !!proReport.motm,
    passesCompleted: proReport.passesCompleted || 0,
    passesAttempted: proReport.passesAttempted || 0,
  } : { rating: 6.6, goals: 0, assists: 0, cleanSheet: oppGoals === 0, shotsOnTarget: 0, keyPasses: 0, tackles: 0, saves: 0, yellows: 0, reds: 0, motm: false };

  const summary = applyProProgression(career, fixture, comp, proPerf, true);
  career.currentSlot = fixture.slot + 1;
  advanceSlotToNextUserOrEnd(career);
  saveCareer(career);
  return summary;
}

export function simCurrentMatchday(career) {
  const fx = getNextUserFixture(career);
  if (!fx) {
    career.seasonCompleted = true;
    if (!career.seasonReview) career.seasonReview = buildSeasonReview(career);
    saveCareer(career);
    return null;
  }
  const comp = career.competitions[fx.compId];
  const rng = makeDetRng(career.seed ^ (career.season * 6151) ^ (fx.slot * 1291));
  const proPerf = simulateFixture(career, comp, fx, rng) || {
    rating: 6.6, goals: 0, assists: 0, cleanSheet: false,
    shotsOnTarget: 0, keyPasses: 0, tackles: 0, saves: 0, yellows: 0, reds: 0, motm: false,
  };
  simulateUnplayedInSlot(career, fx.slot, rng);
  const summary = applyProProgression(career, fx, comp, proPerf, false);
  career.currentSlot = fx.slot + 1;
  advanceSlotToNextUserOrEnd(career);
  saveCareer(career);
  return summary;
}

export function simToSeasonEnd(career) {
  let guard = 0;
  while (!career.seasonCompleted && guard < 64) {
    const res = simCurrentMatchday(career);
    if (!res && career.seasonCompleted) break;
    guard++;
  }
  saveCareer(career);
  return career.seasonReview;
}

// ---- Match Lineup & Kit Preparation (Used by 3D Launch) --------------------

export function resolveLineupsForMatch(career, fixture, overrides = {}) {
  const fxHome = getTeamById(fixture.homeId);
  const fxAway = getTeamById(fixture.awayId);
  const hState = career.clubsState[fixture.homeId];
  const aState = career.clubsState[fixture.awayId];

  const userIsHome = fixture.homeId === career.pro.clubId || fixture.homeId === career.pro.nationalTeamId;
  const swapped3dSides = !userIsHome;

  const hMgr = { ...(hState ? hState.manager : fxHome.manager) };
  const aMgr = { ...(aState ? aState.manager : fxAway.manager) };
  if (overrides.userStyle && TACTICAL_STYLES[overrides.userStyle]) {
    if (userIsHome) hMgr.style = overrides.userStyle;
    else aMgr.style = overrides.userStyle;
  }
  if (overrides.oppStyle && TACTICAL_STYLES[overrides.oppStyle]) {
    if (userIsHome) aMgr.style = overrides.oppStyle;
    else hMgr.style = overrides.oppStyle;
  }

  const userDefaultForm = (TACTICAL_STYLES[userIsHome ? hMgr.style : aMgr.style]?.formation) || '4-3-3';
  const oppDefaultForm = (TACTICAL_STYLES[userIsHome ? aMgr.style : hMgr.style]?.formation) || '4-3-3';
  const userForm = getFormation(overrides.userFormation || career.prefs?.formation || userDefaultForm).id;
  const oppForm = getFormation(overrides.oppFormation || oppDefaultForm).id;
  const fxHomeForm = userIsHome ? userForm : oppForm;
  const fxAwayForm = userIsHome ? oppForm : userForm;

  const fxHomeLineup = (userIsHome && Array.isArray(overrides.userLineup) && overrides.userLineup.length >= 11)
    ? overrides.userLineup.slice(0, 11)
    : getTeamLineupWithPro(career, fixture.homeId, fxHomeForm);
  const fxAwayLineup = (!userIsHome && Array.isArray(overrides.userLineup) && overrides.userLineup.length >= 11)
    ? overrides.userLineup.slice(0, 11)
    : getTeamLineupWithPro(career, fixture.awayId, fxAwayForm);

  // Respect kit choices: home club uses homeKitPref, away uses awayKitPref (auto clash switch)
  const userChoice = career.prefs?.userKitPref || 'auto';
  const kits = userIsHome
    ? resolveMatchKits(fxHome, fxAway, userChoice === 'away' ? 'away' : 'home', 'auto')
    : resolveMatchKits(fxHome, fxAway, 'home', userChoice);

  const fxHomeMeta = {
    ...fxHome,
    manager: hMgr,
    rating: hState ? hState.rating : fxHome.rating,
  };
  const fxAwayMeta = {
    ...fxAway,
    manager: aMgr,
    rating: aState ? aState.rating : fxAway.rating,
  };

  return {
    homeTeam: swapped3dSides ? fxAwayMeta : fxHomeMeta,
    awayTeam: swapped3dSides ? fxHomeMeta : fxAwayMeta,
    homeKit: { ...(swapped3dSides ? kits.awayKit : kits.homeKit), gkColor: (swapped3dSides ? fxAway : fxHome).gkKit.primary },
    awayKit: { ...(swapped3dSides ? kits.homeKit : kits.awayKit), gkColor: (swapped3dSides ? fxHome : fxAway).gkKit.primary },
    homeLineup: swapped3dSides ? fxAwayLineup : fxHomeLineup,
    awayLineup: swapped3dSides ? fxHomeLineup : fxAwayLineup,
    homeFormation: swapped3dSides ? fxAwayForm : fxHomeForm,
    awayFormation: swapped3dSides ? fxHomeForm : fxAwayForm,
    swapped3dSides,
    venue: `${fxHome.short || fxHome.name} Stadium${swapped3dSides ? ' (Away)' : ''}`,
    proPlayerId: career.pro.id,
  };
}

// ---- Season End Review, Awards, Qualification & Season N+1 -----------------

export function buildSeasonReview(career) {
  const champions = [];
  const allScorers = [];
  const allPlayers = [];

  for (const comp of Object.values(career.competitions)) {
    if (comp.type === 'intl_friendly') continue;
    if (!comp.isKnockout) {
      const table = getStandings(career, comp.id);
      if (table[0]) {
        comp.championId = table[0].teamId;
        champions.push({ compId: comp.id, compName: comp.name, championId: table[0].teamId, championName: getTeamById(table[0].teamId).name, pts: table[0].pts });
      }
    } else if (comp.championId) {
      champions.push({ compId: comp.id, compName: comp.name, championId: comp.championId, championName: getTeamById(comp.championId).name });
    }
    for (const p of getLeaders(career, comp.id)) {
      allScorers.push({ ...p, compName: comp.shortName });
      if (p.apps >= 8) {
        const trophyBonus = champions.some((c) => c.championId === p.teamId) ? 0.35 : 0;
        const ballonScore = p.avgRating + p.goals * 0.05 + p.assists * 0.03 + trophyBonus;
        allPlayers.push({ ...p, ballonScore });
      }
    }
  }

  // Merge multi-comp totals by player id for Golden Boot & Ballon d'Or
  const agg = new Map();
  for (const r of allScorers) {
    let cur = agg.get(r.id);
    if (!cur) {
      cur = { ...r };
      agg.set(r.id, cur);
    } else {
      cur.goals += r.goals;
      cur.assists += r.assists;
      cur.apps += r.apps;
      cur.ratingSum += r.ratingSum;
      cur.avgRating = cur.apps > 0 ? Math.round((cur.ratingSum / cur.apps) * 10) / 10 : 6.5;
    }
  }
  const merged = Array.from(agg.values());
  merged.sort((a, b) => (b.goals - a.goals) || (b.assists - a.assists));
  const goldenBoot = merged[0] || null;

  const ballonList = merged.filter((p) => p.apps >= 10).map((p) => ({
    ...p,
    ballonScore: p.avgRating + p.goals * 0.045 + p.assists * 0.025 + (champions.some((c) => c.championId === p.teamId) ? 0.35 : 0),
  }));
  ballonList.sort((a, b) => b.ballonScore - a.ballonScore);
  const ballonDor = ballonList[0] || goldenBoot;

  // Transfer offers matching Pro's OVR & Season Avg Rating
  const rng = makeDetRng(career.seed ^ (career.season * 99991));
  const targetRating = clamp(career.pro.ovr + (career.pro.seasonStats.avgRating - 6.8) * 4, 66, 94);
  const candidates = CLUBS
    .filter((c) => c.id !== career.pro.clubId)
    .map((c) => ({ club: c, diff: Math.abs(c.rating - targetRating) + rng() * 3.5 }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 4);
  const transferOffers = candidates.map(({ club }) => ({
    clubId: club.id,
    clubName: club.name,
    leagueName: LEAGUES.find((l) => l.id === club.leagueId)?.name || '',
    rating: club.rating,
    managerName: career.clubsState[club.id]?.manager?.name || club.manager.name,
    style: career.clubsState[club.id]?.manager?.style || club.manager.style,
    role: club.rating <= career.pro.ovr + 2 ? 'Key Starter' : 'Rotation Prospect',
  }));

  return {
    season: career.season,
    champions,
    goldenBoot,
    ballonDor,
    proSummary: {
      name: career.pro.name,
      clubName: getTeamById(career.pro.clubId).name,
      ovr: career.pro.ovr,
      ...career.pro.seasonStats,
    },
    transferOffers,
  };
}

const AI_COACH_POOL = [
  { name: 'Xabi Alonso', style: 'possession', rating: 86 },
  { name: 'Rúben Amorim', style: 'gegenpress', rating: 83 },
  { name: 'Unai Emery', style: 'balanced', rating: 84 },
  { name: 'Gian Piero Gasperini', style: 'gegenpress', rating: 84 },
  { name: 'Diego Simeone', style: 'low_block', rating: 86 },
  { name: 'Thomas Frank', style: 'route_one', rating: 79 },
  { name: 'Nuno Espírito Santo', style: 'low_block', rating: 80 },
  { name: 'Roberto De Zerbi', style: 'possession', rating: 82 },
];

export function advanceToNextSeason(career, chosenClubId = null) {
  const rng = makeDetRng(career.seed ^ ((career.season + 1) * 44449));

  // 1) Compute UCL / UEL qualifiers from final league standings
  const ucl = [];
  const uel = [];
  for (const lg of LEAGUES) {
    const table = getStandings(career, `lg_${lg.id}`);
    const uclCount = lg.id === 'eng' || lg.id === 'esp' ? 4 : lg.id === 'fra' ? 2 : 3;
    table.slice(0, uclCount).forEach((r) => ucl.push(r.teamId));
    table.slice(uclCount, uclCount + 3).forEach((r) => uel.push(r.teamId));
  }

  // 2) Age Pro & AI squads + off-season coach changes
  career.pro.age += 1;
  if (career.pro.age >= 32) {
    career.pro.attrs.pace = clamp(career.pro.attrs.pace - 1, 45, 97);
    career.pro.attrs.physical = clamp(career.pro.attrs.physical - 1, 45, 97);
    career.pro.ovr = computeOvr(career.pro.pos, career.pro.attrs);
  }
  if (chosenClubId && chosenClubId !== career.pro.clubId) {
    career.pro.clubId = chosenClubId;
    career.pro.coachTrust = 62;
  }
  career.pro.seasonStats = emptyCareerTotals();
  if (career.pro.training) {
    career.pro.training.lastWeekSlot = 0;
    career.pro.training.sessionsUsed = 0;
  }

  for (const club of CLUBS) {
    const st = career.clubsState[club.id];
    if (!st) continue;
    st.form = [];
    st.fatigue = 0;
    if (typeof st.budget !== 'number') st.budget = initClubBudgetM(club);
    for (const p of st.squad) {
      p.age = (p.age || 23) + 1;
      if (p.age <= 23 && p.ovr < 90 && rng() < 0.45) p.ovr++;
      else if (p.age >= 32 && p.ovr > 66 && rng() < 0.4) p.ovr--;
    }
    // Occasional managerial change at underperforming or restless clubs (~10%)
    if (rng() < 0.10) {
      const pick = AI_COACH_POOL[Math.floor(rng() * AI_COACH_POOL.length)];
      st.manager = { name: pick.name, tacticalRating: pick.rating, style: pick.style };
    }
    recomputeClubRatingFromState(st);
  }
  for (const nat of NATIONS) {
    const st = career.clubsState[nat.id];
    if (st) { st.form = []; st.fatigue = 0; }
  }

  career.season += 1;
  career.currentSlot = 0;
  career.seasonCompleted = false;
  career.seasonReview = null;
  career.competitions = buildSeasonCompetitions(career.season, career.seed, career.clubsState, {
    ucl: ucl.slice(0, 16),
    uel: uel.slice(0, 16),
  });

  advanceSlotToNextUserOrEnd(career);
  saveCareer(career);
  return career;
}

// ---- Manual Score Editing, Quick Player Edit & Transfer --------------------

export function editFixtureScore(career, compId, fixtureId, newH, newA) {
  const comp = career.competitions[compId];
  if (!comp) return false;
  const fx = comp.fixtures.find((f) => f.id === fixtureId);
  if (!fx) return false;
  fx.scoreH = clamp(parseInt(newH, 10) || 0, 0, 20);
  fx.scoreA = clamp(parseInt(newA, 10) || 0, 0, 20);
  fx.played = true;

  if (comp.isKnockout) {
    if (fx.scoreH > fx.scoreA) { fx.winnerId = fx.homeId; fx.penH = null; fx.penA = null; }
    else if (fx.scoreA > fx.scoreH) { fx.winnerId = fx.awayId; fx.penH = null; fx.penA = null; }
    else { fx.winnerId = fx.homeId; fx.penH = 5; fx.penA = 4; }
    const rng = makeDetRng(career.seed ^ hashStr(fixtureId));
    checkAdvanceKnockout(comp, fx.roundIdx, rng);
  } else if (comp.standings) {
    // Recompute league standings cleanly from all played fixtures
    for (const tid of comp.teams) comp.standings[tid] = makeEmptyStanding(tid);
    for (const f of comp.fixtures) {
      if (f.played) applyFixtureToStandings(comp, f, null);
    }
  }
  saveCareer(career);
  return true;
}

export function quickEditPro(career, patch) {
  const p = career.pro;
  if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim();
  if (patch.age != null) p.age = clamp(parseInt(patch.age, 10) || p.age, 16, 42);
  if (patch.nationality) {
    p.nationality = patch.nationality;
    p.nationalTeamId = findNationForCountry(patch.nationality).id;
  }
  if (patch.pos) {
    p.pos = patch.pos;
    p.role = posToEngineRole(patch.pos);
  }
  if (patch.number != null) p.number = clamp(parseInt(patch.number, 10) || p.number, 1, 99);
  if (patch.preferredFoot) p.preferredFoot = patch.preferredFoot;
  if (patch.attrs) {
    p.attrs = {
      pace: clamp(Number(patch.attrs.pace) || p.attrs.pace, 35, 99),
      shooting: clamp(Number(patch.attrs.shooting) || p.attrs.shooting, 35, 99),
      passing: clamp(Number(patch.attrs.passing) || p.attrs.passing, 35, 99),
      dribbling: clamp(Number(patch.attrs.dribbling) || p.attrs.dribbling, 35, 99),
      defending: clamp(Number(patch.attrs.defending) || p.attrs.defending, 30, 99),
      physical: clamp(Number(patch.attrs.physical) || p.attrs.physical, 35, 99),
    };
  }
  p.ovr = computeOvr(p.pos, p.attrs);
  if (patch.clubId && patch.clubId !== p.clubId) {
    p.clubId = patch.clubId;
    p.coachTrust = Math.max(55, p.coachTrust);
  }
  saveCareer(career);
  return p;
}

// ---- Copy AI Report (Compact Plain-Text Summary) ---------------------------

export function generateAiReport(career) {
  ensureCareerStateUpgrades(career);
  const pro = career.pro;
  const club = getTeamById(pro.clubId);
  const clubSt = career.clubsState[club.id];
  const rank = getClubRank(career, club.id);
  const lg = LEAGUES.find((l) => l.id === club.leagueId);
  const lgComp = lg ? career.competitions[`lg_${lg.id}`] : null;
  const topScorer = lgComp ? getLeaders(career, lgComp.id).sort((a, b) => b.goals - a.goals)[0] : null;
  const lm = career.latestMatch;
  const nextFx = getNextUserFixture(career);
  const ntOpinion = computeWorldNtOpinion(career);
  const trStatus = getTrainingStatus(career);

  const lines = [
    `=== FIFACHER CAREER REPORT · SEASON ${career.season} (${getCalendarDate(career)}) ===`,
    `PLAYER: ${pro.name} (${pro.age}yo ${pro.nationality}) | #${pro.number} ${pro.pos} | OVR ${pro.ovr} (${pro.preferredFoot} Foot)`,
    `CLUB: ${club.name} (${lg ? lg.name : ''}${rank ? ` #${rank}` : ''}) | Budget €${(clubSt?.budget ?? 0).toFixed(1)}M | Coach: ${clubSt?.manager?.name} (${TACTICAL_STYLES[clubSt?.manager?.style]?.name || ''})`,
    `STATUS: Coach Trust ${pro.coachTrust}/100 (${pro.coachTrust >= 42 ? 'Starting XI' : 'Bench'}) | Training ${trStatus.remaining}/${trStatus.maxPerWeek} Left This Week`,
    `NATIONAL TEAM (${ntOpinion.nation.name}): World Perception ${ntOpinion.readinessScore}/100 (${ntOpinion.tierLabel}) | Player Decision: ${pro.calledUp ? 'JOINED NT' : (pro.ntDecision === 'declined' ? 'DECLINED / CLUB FOCUS' : 'NOT JOINED')}`,
    `SEASON STATS: ${pro.seasonStats.apps} Apps | ${pro.seasonStats.goals} G | ${pro.seasonStats.assists} A | Avg Rating ${pro.seasonStats.avgRating ? pro.seasonStats.avgRating.toFixed(1) : 'N/A'} | MOTM ${pro.seasonStats.motm}`,
  ];

  if (lm) {
    const pp = lm.proPerf || {};
    lines.push(
      `LAST MATCH (${lm.compName}): ${lm.homeName} ${lm.scoreH}-${lm.scoreA} ${lm.awayName} | Rating ${pp.rating?.toFixed(1) || '-'} | ${pp.goals || 0}G ${pp.assists || 0}A | ${pp.keyPasses || 0} KP | ${pp.tackles || 0} TKL${lm.motm ? ` | MOTM: ${lm.motm.name}` : ''}`,
    );
  }
  if (topScorer) {
    lines.push(`LEAGUE TOP SCORER: ${topScorer.name} (${getTeamById(topScorer.teamId).abbr}) - ${topScorer.goals} goals`);
  }
  if (nextFx) {
    const nComp = career.competitions[nextFx.compId];
    lines.push(`NEXT FIXTURE: ${getTeamById(nextFx.homeId).name} vs ${getTeamById(nextFx.awayId).name} (${nComp?.name || ''}, ${nextFx.roundLabel}) on ${getCalendarDate(career, nextFx.slot)}`);
  } else if (career.seasonCompleted) {
    lines.push(`SEASON ${career.season} COMPLETE · Ready for Season Review & Transfers`);
  }
  return lines.join('\n');
}
