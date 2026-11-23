import * as THREE from 'three';
import { PITCH, GOAL, clamp, lerp, v3 } from './util.js';
import { createRefereeSystem } from './referee.js';

// ---------------------------------------------------------------------------
// match.js — PES-style tactical football brain & rules engine.
// Handles stamina/fatigue, fouls/cards/free-kicks/penalties/corners/offsides,
// aerial headers/volleys/chest traps, finesse/chip shots, jockey/2nd-man
// press/GK rush, dynamic teammate runs, team mentality, halftime/fulltime,
// and lightweight 2D radar telemetry.
// ---------------------------------------------------------------------------

const HALF_X = PITCH.length / 2; // 52.5
const HALF_Z = PITCH.width / 2;  // 34

// Formation slots in attack-normalized coords (team attacks +X). Full 68m wing spread.
const FORMATIONS_3D = {
  '4-3-3': [
    { x: -32, z: -24, line: 'DF', pos: 'LB' }, { x: -35, z: -8.5, line: 'DF', pos: 'CB' },
    { x: -35, z: 8.5, line: 'DF', pos: 'CB' }, { x: -32, z: 24, line: 'DF', pos: 'RB' },
    { x: -15, z: -13.5, line: 'MF', pos: 'CM' }, { x: -21, z: 0, line: 'MF', pos: 'CDM' },
    { x: -15, z: 13.5, line: 'MF', pos: 'CM' },
    { x: 2, z: -24.5, line: 'FW', pos: 'LW' }, { x: 6, z: 0, line: 'FW', pos: 'ST' },
    { x: 2, z: 24.5, line: 'FW', pos: 'RW' },
  ],
  '4-4-2': [
    { x: -32, z: -24, line: 'DF', pos: 'LB' }, { x: -35, z: -8.5, line: 'DF', pos: 'CB' },
    { x: -35, z: 8.5, line: 'DF', pos: 'CB' }, { x: -32, z: 24, line: 'DF', pos: 'RB' },
    { x: -12, z: -23.5, line: 'MF', pos: 'LW' }, { x: -17, z: -7.5, line: 'MF', pos: 'CM' },
    { x: -17, z: 7.5, line: 'MF', pos: 'CM' }, { x: -12, z: 23.5, line: 'MF', pos: 'RW' },
    { x: 6, z: -7.5, line: 'FW', pos: 'ST' }, { x: 6, z: 7.5, line: 'FW', pos: 'ST' },
  ],
  '4-2-3-1': [
    { x: -32, z: -24, line: 'DF', pos: 'LB' }, { x: -35, z: -8.5, line: 'DF', pos: 'CB' },
    { x: -35, z: 8.5, line: 'DF', pos: 'CB' }, { x: -32, z: 24, line: 'DF', pos: 'RB' },
    { x: -21, z: -8.5, line: 'MF', pos: 'CDM' }, { x: -21, z: 8.5, line: 'MF', pos: 'CDM' },
    { x: -5, z: -21, line: 'MF', pos: 'LW' }, { x: -6, z: 0, line: 'MF', pos: 'CAM' },
    { x: -5, z: 21, line: 'MF', pos: 'RW' },
    { x: 7, z: 0, line: 'FW', pos: 'ST' },
  ],
  '3-5-2': [
    { x: -35, z: -14.5, line: 'DF', pos: 'CB' }, { x: -36, z: 0, line: 'DF', pos: 'CB' },
    { x: -35, z: 14.5, line: 'DF', pos: 'CB' },
    { x: -17, z: -25.5, line: 'MF', pos: 'LB' }, { x: -17, z: -9.5, line: 'MF', pos: 'CM' },
    { x: -9, z: 0, line: 'MF', pos: 'CAM' }, { x: -17, z: 9.5, line: 'MF', pos: 'CM' },
    { x: -17, z: 25.5, line: 'MF', pos: 'RB' },
    { x: 6, z: -7.5, line: 'FW', pos: 'ST' }, { x: 6, z: 7.5, line: 'FW', pos: 'ST' },
  ],
  '4-1-4-1': [
    { x: -32, z: -24, line: 'DF', pos: 'LB' }, { x: -35, z: -8.5, line: 'DF', pos: 'CB' },
    { x: -35, z: 8.5, line: 'DF', pos: 'CB' }, { x: -32, z: 24, line: 'DF', pos: 'RB' },
    { x: -23, z: 0, line: 'MF', pos: 'CDM' },
    { x: -8, z: -23.5, line: 'MF', pos: 'LW' }, { x: -13, z: -8.5, line: 'MF', pos: 'CM' },
    { x: -13, z: 8.5, line: 'MF', pos: 'CM' }, { x: -8, z: 23.5, line: 'MF', pos: 'RW' },
    { x: 7, z: 0, line: 'FW', pos: 'ST' },
  ],
};

function statVal(p, key) {
  if (!p) return 76;
  const a = p.attrs;
  if (a) {
    if (key === 'shoot' && a.shoot != null) return a.shoot;
    if (key === 'pass' && a.pass != null) return a.pass;
    if (key === 'dribble' && a.dribble != null) return a.dribble;
    if (key === 'def' && a.def != null) return a.def;
    if (key === 'phys' && a.phys != null) return a.phys;
    if (key === 'pace' && a.pace != null) return a.pace;
  }
  return p.ovr || 76;
}

function stat01(p, key) {
  return clamp((statVal(p, key) - 75) / 20, -1, 1);
}

const MENTALITY_ORDER = ['def', 'bal', 'att'];
const TACTICAL_PRESETS = ['bal', 'press', 'counter', 'bus'];
const PRESET_TO_MENTALITY = { bal: 'bal', press: 'att', counter: 'bal', bus: 'def' };
const DIFFICULTY_PROFILES = {
  casual: { reactMult: 1.32, aiDecMin: 0.64, aiDecVar: 0.42, passErr: 0.14, shotScatter: 0.72, tackleAggro: 0.72, gkSweepDelta: 0.28 },
  pro:    { reactMult: 1.00, aiDecMin: 0.46, aiDecVar: 0.32, passErr: 0.05, shotScatter: 0.35, tackleAggro: 1.00, gkSweepDelta: 0.16 },
  legend: { reactMult: 0.72, aiDecMin: 0.32, aiDecVar: 0.22, passErr: 0.015, shotScatter: 0.14, tackleAggro: 1.24, gkSweepDelta: 0.06 },
};
const COACH_TACTIC_PROFILES = {
  balanced:   { id: 'balanced',   lineShift: 0,    pressDist: 0,    doublePress: false, tempoMult: 1.00, longBallBias: 0,     counterSpeed: 0,   widthMult: 1.00, staminaDrain: 1.00 },
  low_block:  { id: 'low_block',  lineShift: -7.5, pressDist: -4.0, doublePress: false, tempoMult: 1.04, longBallBias: 0.45,  counterSpeed: 6.5, widthMult: 0.86, staminaDrain: 0.86 },
  possession: { id: 'possession', lineShift: 4.8,  pressDist: 2.5,  doublePress: true,  tempoMult: 0.84, longBallBias: -0.45, counterSpeed: 0,   widthMult: 1.08, staminaDrain: 1.08 },
  gegenpress: { id: 'gegenpress', lineShift: 6.2,  pressDist: 4.5,  doublePress: true,  tempoMult: 0.88, longBallBias: 0.15,  counterSpeed: 7.5, widthMult: 1.00, staminaDrain: 1.28 },
  route_one:  { id: 'route_one',  lineShift: -2.2, pressDist: -1.0, doublePress: false, tempoMult: 0.96, longBallBias: 0.85,  counterSpeed: 4.5, widthMult: 0.94, staminaDrain: 0.96 },
};

function emptyStats() {
  return {
    shots: 0,
    onTarget: 0,
    corners: 0,
    fouls: 0,
    offsides: 0,
    yellows: 0,
    reds: 0,
    tacklesWon: 0,
  };
}

function emptyPlayerPerf() {
  return {
    goals: 0,
    ownGoals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    keyPasses: 0,
    passesCompleted: 0,
    passesAttempted: 0,
    tacklesWon: 0,
    interceptions: 0,
    fouls: 0,
    yellows: 0,
    reds: 0,
    saves: 0,
    goalsConceded: 0,
    bigChancesMissed: 0,
    touches: 0,
  };
}

export function createMatch(ctx, { ball, teams, pitch }) {
  const rng = ctx.rng;

  // ---- squads --------------------------------------------------------------
  const listOf = (t) => (Array.isArray(t) ? t : (t && t.players) || []);
  const referee =
    (teams.players || []).find((p) => p && (p.role === 'REF' || !p.team)) || null;

  function buildSquad(list, side) {
    const slotOrdered = list.some((p) => p && p.slotOrdered);
    const gk = slotOrdered ? (list[0] || list.find((p) => p.role === 'GK')) : (list.find((p) => p.role === 'GK') || list[0]);
    const out = list.filter((p) => p !== gk);
    if (!slotOrdered) {
      const pr = { DF: 0, MF: 1, FW: 2 };
      out.sort((a, b) => (pr[a.role] ?? 1) - (pr[b.role] ?? 1));
    }
    return { side, gk, out, all: list };
  }
  const squads = {
    home: buildSquad(listOf(teams.home), 'home'),
    away: buildSquad(listOf(teams.away), 'away'),
  };
  const meta = new Map(); // player -> { tackleCd }
  const perfMap = new Map();
  for (const s of ['home', 'away']) {
    for (const p of squads[s].all) {
      meta.set(p, { tackleCd: 0 });
      perfMap.set(p, emptyPlayerPerf());
    }
  }

  // Pre-allocated radar snapshot (zero per-frame allocations)
  const radarPlayers = [];
  for (const s of ['home', 'away']) {
    for (const p of squads[s].all) {
      radarPlayers.push({ id: p.id, team: s, role: p.role, x: 0, z: 0, sentOff: false });
    }
  }

  function syncSquads() {
    squads.home = buildSquad(listOf(teams.home), 'home');
    squads.away = buildSquad(listOf(teams.away), 'away');
    let idx = 0;
    for (const s of ['home', 'away']) {
      for (const p of squads[s].all) {
        if (!meta.has(p)) meta.set(p, { tackleCd: 0 });
        if (!perfMap.has(p)) perfMap.set(p, emptyPlayerPerf());
        if (radarPlayers[idx]) {
          radarPlayers[idx].id = p.id;
          radarPlayers[idx].team = s;
          radarPlayers[idx].role = p.role;
          radarPlayers[idx].sentOff = false;
        }
        idx++;
      }
    }
  }

  const DRILL_THRESHOLDS = {
    finishing: { title: 'Finishing Box Drill', prompt: 'SCORE PAST KEEPER & DEFENDER · SPACE SHOOT · Z FINESSE', silver: 180, gold: 340, elite: 520 },
    passing: { title: 'Through-Ball Vision', prompt: 'THREAD PASS TO TEAMMATE · X PASS · C THROUGH · V LOB', silver: 160, gold: 300, elite: 460 },
    dribbling: { title: '1v1 Slalom & Beat Man', prompt: 'DRIBBLE THROUGH GLOWING GATES · E/R/G SKILL MOVES', silver: 180, gold: 330, elite: 500 },
    defending: { title: 'Pressing & Interception', prompt: 'WIN BALL FROM ATTACKERS · X PRESS · SPACE SLIDE TACKLE', silver: 180, gold: 340, elite: 520 },
  };

  function computeLivePlayerRating(p, pf, myS, oppS) {
    const r = pf || emptyPlayerPerf();
    const won = myS > oppS;
    const drew = myS === oppS;
    const cleanSheet = oppS === 0;
    const passAcc = r.passesAttempted > 0 ? r.passesCompleted / r.passesAttempted : 0.78;
    const passBonus = r.passesAttempted >= 3 ? clamp((passAcc - 0.62) * 1.1, -0.2, 0.55) : 0;
    const touchBonus = clamp((r.touches || 0) * 0.012, 0, 0.25);
    const rawRating = 6.2
      + (r.goals || 0) * 1.15
      + (r.assists || 0) * 0.75
      + (r.keyPasses || 0) * 0.28
      + (r.shotsOnTarget || 0) * 0.22
      + passBonus
      + touchBonus
      + (r.tacklesWon || 0) * 0.25
      + (r.interceptions || 0) * 0.18
      + (r.saves || 0) * 0.35
      + (cleanSheet && (p.role === 'GK' || p.role === 'DF') ? 0.55 : 0)
      + (won ? 0.35 : drew ? 0.1 : -0.15)
      - (r.bigChancesMissed || 0) * 0.45
      - (r.goalsConceded || 0) * (p.role === 'GK' ? 0.35 : 0.15)
      - (r.yellows || 0) * 0.35
      - (r.reds || 0) * 1.4
      - (r.ownGoals || 0) * 0.9;
    return Math.round(clamp(rawRating, 3.2, 10.0) * 10) / 10;
  }

  // Pre-allocated live teammate ratings snapshot (zero per-frame allocations)
  const liveTeammates = Array.from({ length: 11 }, () => ({
    id: null,
    number: 0,
    name: '',
    role: 'MF',
    rating: 6.3,
    goals: 0,
    assists: 0,
    isPro: false,
    isControlled: false,
    active: false,
  }));

  // ---- state ---------------------------------------------------------------
  const state = {
    phase: 'kickoff',
    setPieceType: null,
    score: { home: 0, away: 0 },
    clockSec: 0,
    half: 1,
    halfMinutes: 6,
    difficulty: 'pro',
    possession: null,
    excitement: 0.15,
    attackDirHome: 1,
    mentality: 'bal',
    tacticalPreset: 'bal',
    offsideTrapT: 0,
    offsideTrapCd: 0,
    defLineHomeX: -33,
    shieldingActive: false,
    gkHolding: false,
    playerLock: false,
    callPassActive: false,
    ctxHint: '',
    kickCharge: { active: false, kind: null, value: 0, displayKind: null, displayValue: 0, fadeT: 0, timed: null },
    stats: { home: emptyStats(), away: emptyStats() },
    lastFoulImpulse: 0,
    activePlayer: { id: null, number: 0, name: '', role: 'MF', stamina: 1, staminaCap: 1, yellowCards: 0, sentOff: false, rating: 6.3, isPro: false },
    teammates: liveTeammates,
    drill: {
      active: false,
      id: 'finishing',
      title: '',
      subtitle: '',
      timeLeft: 45,
      duration: 45,
      score: 0,
      reps: 0,
      hits: 0,
      streak: 0,
      bestStreak: 0,
      grade: 'Bronze',
      finished: false,
      prompt: '',
    },
    radar: {
      players: radarPlayers,
      ball: { x: 0, z: 0 },
      referee: referee ? { x: 0, z: 0 } : null,
      attackDirHome: 1,
      controlledId: null,
    },
  };

  const teamTactics = {
    home: { ...COACH_TACTIC_PROFILES.balanced, rating: 78 },
    away: { ...COACH_TACTIC_PROFILES.balanced, rating: 78 },
  };
  const teamFormations = {
    home: FORMATIONS_3D['4-3-3'],
    away: FORMATIONS_3D['4-3-3'],
  };
  function setFormation(side, formationId) {
    if (side === 'home' || side === 'away') {
      teamFormations[side] = FORMATIONS_3D[formationId] || FORMATIONS_3D['4-3-3'];
    }
  }
  const sideCounterBurst = { home: 0, away: 0 };
  const playerLock = { enabled: false, playerId: null };
  const callForPassReq = { active: false, kind: 'pass', t: 0 };
  const matchEvents = [];
  let lastPassMeta = null;
  let assistCandidate = null;
  let lastShooter = null;

  const getPerf = (p) => {
    if (!p) return null;
    let r = perfMap.get(p);
    if (!r) { r = emptyPlayerPerf(); perfMap.set(p, r); }
    return r;
  };
  const resetPerf = () => {
    matchEvents.length = 0;
    lastPassMeta = null;
    assistCandidate = null;
    lastShooter = null;
    for (const s of ['home', 'away']) {
      for (const p of squads[s].all) perfMap.set(p, emptyPlayerPerf());
    }
  };
  const findProPlayer = () => {
    for (const p of squads.home.all) {
      if (playerLock.playerId && p.id === playerLock.playerId) return p;
      if (p.isPro) return p;
    }
    return null;
  };
  const recordPassAttempt = (passer, target, dir) => {
    if (!passer) return;
    const pf = getPerf(passer);
    if (pf) pf.passesAttempted++;
    lastPassMeta = { passer, target: target || null, side: passer.team, t: state.clockSec, x: passer.pos.x, dir };
  };

  const listeners = [];
  const emit = (type, data) => {
    for (const cb of listeners) { try { cb(type, data); } catch (e) { /* HUD errors must not kill sim */ } }
  };
  ball.onImpact = (kind, info) => emit(kind, info);

  // ---- runtime -------------------------------------------------------------
  let controller = null;      // player currently dribbling
  let lastKicker = null;
  let lastTouchSide = 'home';
  let lockPlayer = null, kickLock = 0;   // kicker can't instantly re-claim
  let decisionT = 0, settleT = 0, touchPhase = 0;
  let kickoffT = 0, kickoffSide = 'home', kickoffNext = 'home';
  let goalT = 0, halftimeT = 0;
  let passTarget = null, passT = 0;
  let restart = null;         // { kind, side, taker, x, z, aimX, aimZ, power, gkDiveChoice, wallPlayers, t, freezeT, ready, aiWaitT, autoT, throwIn }
  let shot = null;            // { shooter, side, aimZ, aimY, gk, reacted, reactT, dived, isPenalty, userDiveUsed }
  let sinceShot = 0;
  let pending = [];           // [{ t, fn }] delayed celebrations / misc
  let activeKick = null;      // { player, kind, style, power, aimX, aimZ, aimY, target, spinY, isSetPiece, isGiveAndGo, t, impactT, after }
  let gkDist = null;          // { player, mode, ax, az, power, target, t, releaseT }
  let gkHoldTimer = 0;
  let activeWall = null;      // { players, t }
  let previewTarget = null;
  const _footPos = v3();
  let userInput = null, userT = 0, ctrlPickT = 0;
  let manualPick = null, manualT = 0;
  let autoSwitchCd = 0;
  let lastPossState = null;
  let skill = null;
  let skillCd = 0;
  let evadePlayer = null, evadeT = 0;
  let fakeShotConsumeT = 0;
  let chargeHoldTime = 0;
  let offsideWatch = null;    // { side, dir, flagged: Set<Player>, posMap: Map<Player,{x,z}> }
  let aerialIntent = null;    // { kind, dirX, dirZ, t }
  const inputBuf = { passT: 0, throughT: 0, loftedT: 0, shootT: 0, mod: false, chip: false, aimX: 0, aimZ: 0 };
  const preQueue = { kind: null, power: 0.45, mod: false, chip: false, aimX: 0, aimZ: 0, t: 0, holdKind: null, holdTime: 0 };
  const magnetState = { player: null, strength: 0, mode: 'none', queued: false };
  const passGrace = { timer: 0, aimX: 0, aimZ: 0, hadAim: false, target: null };
  let pursuitOverridden = false;
  const prevMoveVec = { x: 0, z: 0 };
  const oneTwoMap = new Map(); // player -> timer (1-2 give-and-go sprint forward)
  const deceivedMap = new Map(); // defender -> { mode, vx, vz, t, dur, faceAng }
  const switchSkip = new Map(); // player -> cooldown to cycle cleanly across top defenders
  const defLineCache = { home: -33, away: -33 };
  const gkRecoverMap = new Map(); // gk -> recovery seconds after diving parry
  let counterBurstT = 0;
  let lastPossTeam = null;
  const markAssign = new Map(); // defender -> runner
  const oppRunnersTmp = [];
  const freeDefsTmp = [];
  let endWhistled = false;
  const attackingRuns = new Map(); // player -> { targetX, targetZ, t, maxT, kind }
  let autoRunScanCd = 0;
  let proPassCooldown = 0;

  function triggerForwardRun(source, dirX, dirZ) {
    if (!source || !isActive(source) || state.phase !== 'play') return null;
    const side = source.team;
    if (state.possession !== side) return null;
    const dir = dirFor(side);
    const oppSide = other(side);

    // Deepest opponent outfielder for offside reference
    let oppLine2nd = dir * HALF_X;
    let deep1 = -1e9, deep2 = -1e9;
    for (const o of squads[oppSide].all) {
      if (!isActive(o)) continue;
      const ox = o.pos.x * dir;
      if (ox > deep1) { deep2 = deep1; deep1 = ox; }
      else if (ox > deep2) { deep2 = ox; }
    }
    if (deep2 > -1e8) oppLine2nd = deep2;

    const aimLen = Math.hypot(dirX || 0, dirZ || 0);
    const hasAim = aimLen > 0.15;
    const normAimX = hasAim ? (dirX / aimLen) : dir;
    const normAimZ = hasAim ? (dirZ / aimLen) : 0;

    let bestCand = null;
    let bestScore = -1e9;

    for (const cand of squads[side].out) {
      if (!isActive(cand) || cand === source || cand === controller) continue;
      if (attackingRuns.has(cand)) continue;
      const fwdRel = (cand.pos.x - source.pos.x) * dir;
      if (fwdRel < -3.5) continue;

      const dist = d2(source.pos.x, source.pos.z, cand.pos.x, cand.pos.z);
      if (dist < 4.0 || dist > 40.0) continue;

      let score = 0;
      if (cand.role === 'FW') score += 5.5;
      else if (cand.role === 'MF') score += 2.5;
      else score -= 3.5;

      if (hasAim) {
        const dx = (cand.pos.x - source.pos.x) / dist;
        const dz = (cand.pos.z - source.pos.z) / dist;
        const dot = dx * normAimX + dz * normAimZ;
        score += dot * 4.5;
      } else {
        score += fwdRel * 0.15;
      }

      const ahead = spaceAhead(cand);
      score += Math.min(ahead, 12) * 0.25;

      if (cand.pos.x * dir > oppLine2nd + 0.3) score -= 2.0;

      if (score > bestScore) {
        bestScore = score;
        bestCand = cand;
      }
    }

    if (!bestCand) return null;

    const runDist = clamp(13.0 + (bestCand.pace || 75) * 0.05, 11.0, 18.0);
    const targetX = clamp(bestCand.pos.x + dir * runDist, -HALF_X + 2.5, HALF_X - 2.5);
    let targetZ = bestCand.pos.z;
    if (Math.abs(bestCand.pos.z) < 8.0) {
      const cut = (Math.abs(bestCand.pos.z) < 2.5) ? (rng() < 0.5 ? 4.5 : -4.5) : Math.sign(bestCand.pos.z) * 3.8;
      targetZ = clamp(bestCand.pos.z + cut, -15, 15);
    } else {
      targetZ = clamp(bestCand.pos.z * 0.82, -26, 26);
    }

    attackingRuns.set(bestCand, {
      targetX,
      targetZ,
      t: 0,
      maxT: 3.2,
      kind: 'manual',
    });
    spendStamina(bestCand, 0.035);
    emit('forward_run', { runner: { name: bestCand.name, number: bestCand.number, id: bestCand.id } });
    return bestCand;
  }

  function armPassGrace(target) {
    const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
    const ml = Math.hypot(m.x, m.z);
    if (ml > 0.15) {
      passGrace.aimX = m.x / ml;
      passGrace.aimZ = m.z / ml;
      passGrace.hadAim = true;
    } else {
      passGrace.aimX = 0;
      passGrace.aimZ = 0;
      passGrace.hadAim = false;
    }
    passGrace.timer = 0.36;
    passGrace.target = target || null;
  }

  function clearInputBuffers() {
    inputBuf.passT = 0;
    inputBuf.throughT = 0;
    inputBuf.loftedT = 0;
    inputBuf.shootT = 0;
    inputBuf.mod = false;
    inputBuf.chip = false;
    preQueue.kind = null;
    preQueue.t = 0;
    preQueue.holdKind = null;
    preQueue.holdTime = 0;
  }

  const refSys = createRefereeSystem({
    referee,
    squads,
    ball,
    state,
    emit: (type, data) => {
      if (type === 'foul' && data && data.fouler) {
        const fp = squads[data.fouler.team]?.all.find((pl) => pl.number === data.fouler.number && pl.name === data.fouler.name);
        if (fp) {
          const pf = getPerf(fp);
          if (pf) {
            pf.fouls++;
            if (data.ballFirst && pf.tacklesWon > 0) pf.tacklesWon--;
            if (data.card === 'yellow') pf.yellows++;
            else if (data.card === 'second_yellow') { pf.yellows++; pf.reds++; }
            else if (data.card === 'red') pf.reds++;
          }
          if (data.card) {
            matchEvents.push({
              min: Math.max(1, Math.min(90, Math.ceil(state.clockSec / 60))),
              type: data.card === 'yellow' ? 'yellow' : 'red',
              team: fp.team,
              playerId: fp.id,
              playerName: fp.fullName || fp.name,
            });
          }
        }
      }
      emit(type, data);
    },
    isActive: (p) => !!p && !p.sentOff && !p.drillOff,
    dirFor: (s) => (s === 'home' ? state.attackDirHome : -state.attackDirHome),
    other: (s) => (s === 'home' ? 'away' : 'home'),
    releaseBall: () => releaseBall(),
    setupSetPiece: (...args) => setupSetPiece(...args),
    switchControlled: (fouler) => {
      if (fouler && fouler === match.controlledPlayer && !playerLock.enabled) switchControlled();
    },
    getController: () => controller,
    getEvadeState: () => ({ player: evadePlayer, t: evadeT }),
    getSkillState: () => skill,
    onCleanTackleWin: (tackler, victim) => {
      state.stats[tackler.team].tacklesWon++;
      const pf = getPerf(tackler);
      if (pf) pf.tacklesWon++;
      lastTouchSide = tackler.team;
      lastKicker = tackler;
      if (victim) {
        lockPlayer = victim;
        kickLock = 0.62;
      }
    },
  });

  const other = (s) => (s === 'home' ? 'away' : 'home');
  const dirFor = (s) => (s === 'home' ? state.attackDirHome : -state.attackDirHome);
  const isActive = (p) => !!p && !p.sentOff && !p.drillOff;

  const TMP = v3(), TMP2 = v3();
  const tgtMap = new Map();
  const tgtOf = (p) => {
    let t = tgtMap.get(p);
    if (!t) { t = v3(); tgtMap.set(p, t); }
    return t;
  };

  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const pdist = (a, b) => d2(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
  const ballDist = (p) => d2(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
  const ballSpeed = () => Math.hypot(ball.vel.x, ball.vel.z);

  function nearestOpp(p) {
    let best = null, bd = 1e9;
    for (const o of squads[other(p.team)].all) {
      if (!isActive(o)) continue;
      const d = pdist(p, o);
      if (d < bd) { bd = d; best = o; }
    }
    return { opp: best, d: bd };
  }

  function laneBlockers(fx, fz, tx, tz, oppSide, skipGK) {
    let n = 0;
    const dx = tx - fx, dz = tz - fz;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1) return 0;
    for (const o of squads[oppSide].all) {
      if (!isActive(o)) continue;
      if (skipGK && o.role === 'GK') continue;
      const t = ((o.pos.x - fx) * dx + (o.pos.z - fz) * dz) / len2;
      if (t < 0.07 || t > 0.93) continue;
      const px = fx + dx * t, pz = fz + dz * t;
      if (d2(o.pos.x, o.pos.z, px, pz) < 1.6) n++;
    }
    return n;
  }

  function spaceAhead(p) {
    const dir = dirFor(p.team);
    let best = 30;
    for (const o of squads[other(p.team)].all) {
      if (!isActive(o)) continue;
      const fwd = (o.pos.x - p.pos.x) * dir;
      if (fwd < -1 || fwd > 12) continue;
      if (Math.abs(o.pos.z - p.pos.z) > 5) continue;
      const d = pdist(p, o);
      if (d < best) best = d;
    }
    return best;
  }

  // ---- tactical presets, mentality, synchronized def line & formation spots -
  function diffProfile() {
    return DIFFICULTY_PROFILES[state.difficulty] || DIFFICULTY_PROFILES.pro;
  }

  function setTacticalPreset(preset) {
    if (!TACTICAL_PRESETS.includes(preset)) return;
    state.tacticalPreset = preset;
    state.mentality = PRESET_TO_MENTALITY[preset] || 'bal';
    emit('tactics', { preset, mentality: state.mentality });
    emit('mentality', { mentality: state.mentality, preset });
  }

  function triggerOffsideTrap() {
    if (state.phase !== 'play' || state.offsideTrapCd > 0) return false;
    state.offsideTrapT = 1.6;
    state.offsideTrapCd = 7.5;
    emit('offside_trap', { dur: 1.6 });
    return true;
  }

  function setTeamTactics(side, styleId, rating = 78) {
    if (side !== 'home' && side !== 'away') return;
    const prof = COACH_TACTIC_PROFILES[styleId] || COACH_TACTIC_PROFILES.balanced;
    teamTactics[side] = { ...prof, rating: clamp(Number(rating) || 78, 55, 99) };
  }

  function mentalityShift(side) {
    const coachShift = teamTactics[side] ? teamTactics[side].lineShift : 0;
    if (side !== 'home') return coachShift;
    const pre = state.tacticalPreset;
    let userShift = 0;
    if (pre === 'press') userShift = 7.2;
    else if (pre === 'bus') userShift = -8.5;
    else if (pre === 'counter') userShift = state.possession === 'home' ? 2.5 : -3.8;
    else if (state.mentality === 'att') userShift = 6.5;
    else if (state.mentality === 'def') userShift = -7.0;
    return clamp(userShift + coachShift, -11.5, 11.5);
  }

  function updateDefLines(dt) {
    for (const side of ['home', 'away']) {
      const dir = dirFor(side);
      const oppSide = other(side);
      const poss = state.possession === side;
      const bx = ball.pos.x * dir;
      const mShift = mentalityShift(side);
      const trapPush = (side === 'home' && !poss && state.offsideTrapT > 0) ? 4.8 : 0;
      const highCoach = teamTactics[side] && teamTactics[side].lineShift > 4.0;

      // Measure ball pressure on carrier/ball
      const px = controller ? controller.pos.x : ball.pos.x;
      const pz = controller ? controller.pos.z : ball.pos.z;
      let pressDist = 99;
      for (const m of squads[side].out) {
        if (!isActive(m)) continue;
        const d = d2(m.pos.x, m.pos.z, px, pz);
        if (d < pressDist) pressDist = d;
      }
      const carrierTurnedBack = !!(controller && controller.team === oppSide &&
        Math.cos(controller.facing) * dir > 0.28);
      const isPressed = pressDist < 4.5 + (teamTactics[side]?.pressDist || 0) * 0.25 || carrierTurnedBack || trapPush > 0;

      // Deepest active opposing MF/FW runner in this team's frame
      let threatX = 45;
      for (const o of squads[oppSide].out) {
        if (!isActive(o) || o.role === 'DF') continue;
        const ox = o.pos.x * dir;
        if (ox < threatX) threatX = ox;
      }

      let targetLine;
      if (poss) {
        const highCap = (highCoach || (side === 'home' && (state.mentality === 'att' || state.tacticalPreset === 'press'))) ? -2.0 : -7.5;
        targetLine = clamp(bx - 22.0 + mShift * 0.45, -40, highCap);
      } else {
        targetLine = (isPressed ? bx - 11.5 : bx - 18.0) + mShift * 0.45 + trapPush;
        const runnerGuard = trapPush > 0 ? (threatX + 1.8) : (isPressed ? (threatX - 0.8) : (threatX - 2.8));
        targetLine = Math.min(targetLine, runnerGuard);
        const defCap = trapPush > 0 ? -1.5 : ((highCoach || (side === 'home' && (state.mentality === 'att' || state.tacticalPreset === 'press'))) ? -3.5 : -9.5);
        targetLine = clamp(targetLine, -46.5, defCap);
      }

      const prev = defLineCache[side];
      const stepUpRate = trapPush > 0 ? 14.5 : 8.5;
      defLineCache[side] = clamp(targetLine, prev - 12.0 * dt, prev + stepUpRate * dt);
    }
    state.defLineHomeX = defLineCache.home * dirFor('home');
  }

  function spotFor(side, i, out) {
    const dir = dirFor(side);
    const poss = state.possession === side;
    const bx = ball.pos.x * dir, bz = ball.pos.z;
    const form = teamFormations[side] || FORMATIONS_3D['4-3-3'];
    const s = form[Math.min(i, form.length - 1)];
    const mShift = mentalityShift(side);
    const coach = teamTactics[side] || COACH_TACTIC_PROFILES.balanced;
    const pre = side === 'home' ? state.tacticalPreset : (coach.id === 'low_block' ? 'bus' : coach.id === 'gegenpress' ? 'press' : 'bal');
    const lineX = defLineCache[side];
    let x;
    if (s.line === 'DF') {
      // Synchronized defensive line: fullbacks tuck ball-side slightly when defending, support wide in possession
      const isFB = Math.abs(s.z) > 18;
      const ballSide = isFB && Math.sign(s.z) === Math.sign(bz);
      const trapFlat = side === 'home' && !poss && state.offsideTrapT > 0;
      const stagger = trapFlat ? 0 : (isFB ? (poss ? (ballSide ? 2.2 : 0.8) : (ballSide ? 0.45 : -0.35)) : (poss ? 0 : -0.2));
      x = clamp(lineX + stagger, -47.5, -1.5);
    } else if (s.line === 'MF') {
      // Midfield bank: stay vertically compact ahead of the defensive line
      const busDrop = ((pre === 'bus' || coach.id === 'low_block') && !poss) ? -3.2 : 0;
      const pressFwd = ((pre === 'press' || coach.id === 'gegenpress' || coach.id === 'possession') && !poss) ? 3.2 : 0;
      x = s.x + clamp(bx * 0.40, -14, 18) + (poss ? 5.0 : -6.5) + mShift * 0.75 + busDrop + pressFwd;
      x = Math.max(x, lineX + (poss ? 11.0 : (pre === 'bus' ? 6.8 : 9.2)));
      x = clamp(x, -41, 37);
    } else {
      // Attacking line: stretch width & press/drop cleanly with midfield
      const userCounter = (pre === 'counter' && poss && counterBurstT > 0) ? 10.5 : 0;
      const coachCounter = (poss && sideCounterBurst[side] > 0 && coach.counterSpeed > 0) ? coach.counterSpeed : 0;
      const counterBreak = Math.max(userCounter, coachCounter);
      const runPush = poss ? (bx > 5 ? 8.5 : 6.0) : ((pre === 'press' || coach.id === 'gegenpress') ? 1.5 : -5.0);
      x = s.x + clamp(bx * 0.42, -12, 21) + runPush + mShift + counterBreak;
      if (poss && bx > 12 && Math.abs(s.z) > 15) x += 3.5;
      if (!poss) x = Math.max(x, lineX + (pre === 'bus' ? 14.0 : 18.0));
      x = clamp(x, -30, 47.0);
      const oppDefX = -defLineCache[other(side)];
      if (poss && x > oppDefX - 0.75) {
        x = Math.min(x, oppDefX - 0.75);
      }
    }
    const width = (poss ? 0.96 : (pre === 'bus' ? 0.60 : 0.68)) * (coach.widthMult || 1.0);
    const lean = poss ? 0.24 : 0.48;
    let z = s.z * width + bz * lean;
    const maxOff = poss ? (s.x > 0 ? 27 : 22) : 14;
    z = clamp(z, bz - maxOff, bz + maxOff);
    z = clamp(z, -31.5, 31.5);

    // Teammate spacing: prevent carrier cluster bunching; maintain 8.5m - 14m passing angles
    if (poss && controller && controller.team === side && controller.role !== 'GK') {
      const cDirX = controller.pos.x * dir;
      const cZ = controller.pos.z;
      const distToCarrier = Math.hypot(x - cDirX, z - cZ);
      if (distToCarrier < 7.6) {
        const pushZ = Math.sign(z - cZ) || (s.z !== 0 ? Math.sign(s.z) : (i % 2 === 0 ? 1 : -1));
        z = clamp(z + pushZ * (7.8 - distToCarrier) * 0.75, -HALF_Z + 2.5, HALF_Z - 2.5);
        if (s.line === 'MF') {
          const depthStagger = (i % 2 === 0) ? -2.8 : 2.5;
          x = clamp(x + depthStagger, -41, 40);
        }
      }
    }

    // Third-man / half-space support & checking short when carrier is pressed
    if (poss && controller && controller.team === side && controller.role !== 'GK') {
      const cPress = nearestOpp(controller).d < 2.8;
      if (cPress && s.line === 'MF' && Math.abs(s.z) > 4) {
        const sameFlank = Math.sign(s.z) === Math.sign(controller.pos.z || 1);
        if (sameFlank) {
          x = clamp(lerp(x, controller.pos.x * dir - 4.5, 0.38), -38, 36);
          z = clamp(z * 0.86, -24, 24);
        } else if (bx > -5) {
          x = clamp(x + 6.5, -35, 39);
          z = clamp(z * 0.72, -18, 18);
        }
      }
    }

    // Dynamic wing-cross box runs when ball is carried wide in the final third
    if (poss && bx > 18 && Math.abs(bz) > 14) {
      if (s.line === 'FW' && Math.abs(s.z) < 10) {
        x = clamp(44.5, -32, 47.5);
        z = clamp(-Math.sign(bz) * 1.4, -7, 7);
      } else if ((s.line === 'FW' || (s.line === 'MF' && s.x > -10)) && Math.abs(s.z) > 15 && Math.sign(s.z) !== Math.sign(bz)) {
        x = clamp(43.5, -32, 47.5);
        z = -Math.sign(bz) * 5.2;
      } else if (s.line === 'MF' && s.x > -20 && Math.abs(s.z) <= 15 && Math.sign(s.z) === Math.sign(bz)) {
        x = clamp(34.5, -32, 40);
        z = Math.sign(bz) * 2.5;
      }
    }

    return out.set(dir * x, 0, z);
  }

  // ---- stamina & telemetry sync --------------------------------------------
  function updateStamina(dt) {
    const activePlay = state.phase === 'play';
    for (const s of ['home', 'away']) {
      const coachDrain = teamTactics[s] ? teamTactics[s].staminaDrain : 1.0;
      for (const p of squads[s].all) {
        if (!isActive(p)) continue;
        if (!activePlay) {
          p.stamina = clamp(p.stamina + 0.015 * dt, 0, p.staminaCap);
          continue;
        }
        const sp = Math.hypot(p.vel.x, p.vel.z);
        const userSpr = p === match.controlledPlayer && userT > 0 && userInput && userInput.sprint && userInput.active;
        const pressBoost = (s === 'home' && state.tacticalPreset === 'press' && state.possession !== 'home') ? 1.18 : 1.0;
        const sprinting = userSpr || sp > p.maxSpeed * 0.82;
        if (sprinting && sp > 2.0) {
          p.stamina = clamp(p.stamina - 0.044 * pressBoost * coachDrain * dt, 0, p.staminaCap);
          p.staminaCap = clamp(p.staminaCap - 0.0005 * dt, 0.78, 1.0);
        } else if (sp > 2.2) {
          p.stamina = clamp(p.stamina + 0.016 * dt, 0, p.staminaCap);
        } else {
          p.stamina = clamp(p.stamina + 0.036 * dt, 0, p.staminaCap);
        }
      }
    }
  }

  function spendStamina(p, amt) {
    if (!p) return;
    p.stamina = clamp(p.stamina - amt, 0, p.staminaCap);
  }

  function syncTelemetry() {
    state.radar.attackDirHome = state.attackDirHome;
    state.radar.ball.x = ball.pos.x;
    state.radar.ball.z = ball.pos.z;
    state.gkHolding = !!(controller && controller.role === 'GK' && controller.holdingBall);
    state.playerLock = !!playerLock.enabled;
    state.callPassActive = !!(playerLock.enabled && callForPassReq.active);
    if (state.gkHolding && controller === squads.home.gk && userT > 0) {
      state.ctxHint = 'GK HOLD · X/J ROLL · C/K/V/L THROW · SPC/I PUNT';
    } else if (state.phase === 'out' && restart && restart.ready && userT > 0) {
      if (restart.side === 'away' && restart.kind === 'penalty') {
        state.ctxHint = 'PENALTY GK · W/S CHOOSE DIVE LEFT / CENTER / RIGHT';
      } else if (restart.side === 'home') {
        if (restart.kind === 'penalty') state.ctxHint = 'PENALTY · AIM W/S · HOLD SPACE TO SHOOT';
        else if (restart.kind === 'free_kick') state.ctxHint = 'FREE KICK · AIM WASD · SPACE CURL SHOT · X/V PASS';
        else if (restart.kind === 'corner') state.ctxHint = 'CORNER · AIM WASD · X SHORT · V/SPACE SWING CROSS';
        else if (restart.kind === 'throw_in') state.ctxHint = 'THROW-IN · AIM WASD · X/C/V THROW';
        else if (restart.kind === 'goal_kick') state.ctxHint = 'GOAL KICK · AIM WASD · X SHORT · V/SPACE LONG';
        else state.ctxHint = '';
      } else {
        state.ctxHint = '';
      }
    } else {
      state.ctxHint = '';
    }
    if (referee && state.radar.referee) {
      state.radar.referee.x = referee.pos.x;
      state.radar.referee.z = referee.pos.z;
    }
    const cp = match.controlledPlayer;
    state.radar.controlledId = cp ? cp.id : null;
    if (cp) {
      const cpSide = cp.team === 'away' ? 'away' : 'home';
      const myS = cpSide === 'home' ? state.score.home : state.score.away;
      const oppS = cpSide === 'home' ? state.score.away : state.score.home;
      state.activePlayer.id = cp.id;
      state.activePlayer.number = cp.number;
      state.activePlayer.name = cp.name;
      state.activePlayer.role = cp.posRole || cp.role;
      state.activePlayer.stamina = cp.stamina;
      state.activePlayer.staminaCap = cp.staminaCap;
      state.activePlayer.yellowCards = cp.yellowCards;
      state.activePlayer.sentOff = cp.sentOff;
      state.activePlayer.isPro = !!cp.isPro;
      state.activePlayer.rating = computeLivePlayerRating(cp, getPerf(cp), myS, oppS);
    }
    const homeAll = squads.home.all;
    for (let i = 0; i < 11; i++) {
      const slot = liveTeammates[i];
      const p = homeAll[i];
      if (!p) {
        slot.active = false;
        continue;
      }
      const pf = getPerf(p) || emptyPlayerPerf();
      slot.id = p.id;
      slot.number = p.number;
      slot.name = p.name;
      slot.role = p.posRole || p.role;
      slot.rating = computeLivePlayerRating(p, pf, state.score.home, state.score.away);
      slot.goals = pf.goals || 0;
      slot.assists = pf.assists || 0;
      slot.isPro = !!p.isPro;
      slot.isControlled = p === cp;
      slot.active = isActive(p);
    }
    let idx = 0;
    for (const s of ['home', 'away']) {
      for (const p of squads[s].all) {
        const rp = radarPlayers[idx++];
        rp.x = p.pos.x;
        rp.z = p.pos.z;
        rp.sentOff = !!p.sentOff || !!p.drillOff;
      }
    }
  }

  // ---- offside snapshot & check --------------------------------------------
  function snapshotOffside(passer, side) {
    if (state.phase !== 'play' || !passer || passer.role === 'GK') { offsideWatch = null; return; }
    const dir = dirFor(side);
    const oppSide = other(side);
    const oppXs = [];
    for (const o of squads[oppSide].all) {
      if (isActive(o)) oppXs.push(o.pos.x * dir);
    }
    oppXs.sort((a, b) => b - a); // furthest defending opponents first
    const secondLastX = oppXs.length >= 2 ? oppXs[1] : (oppXs[0] || 0);
    const ballDirX = ball.pos.x * dir;
    const flagged = new Set();
    const posMap = new Map();
    for (const m of squads[side].out) {
      if (m === passer || !isActive(m)) continue;
      const mx = m.pos.x * dir;
      if (mx > 0.2 && mx > ballDirX + 0.25 && mx > secondLastX + 0.22) {
        flagged.add(m);
        posMap.set(m, { x: m.pos.x, z: m.pos.z });
      }
    }
    offsideWatch = flagged.size > 0 ? { side, dir, flagged, posMap } : null;
  }

  function callOffside(player) {
    const offSide = player.team;
    const defSide = other(offSide);
    const posSnap = offsideWatch && offsideWatch.posMap.get(player);
    const fx = clamp(posSnap ? posSnap.x : player.pos.x, -HALF_X + 3, HALF_X - 3);
    const fz = clamp(posSnap ? posSnap.z : player.pos.z, -HALF_Z + 2, HALF_Z - 2);
    offsideWatch = null;
    state.stats[offSide].offsides++;
    emit('offside', { team: offSide, player: { number: player.number, name: player.name } });
    emit('whistle', { reason: 'offside' });
    setupSetPiece('free_kick', defSide, fx, fz, false);
  }

  // ---- ball control --------------------------------------------------------
  function gainControl(p) {
    if (!isActive(p)) return;
    if (offsideWatch && p.team !== offsideWatch.side) offsideWatch = null;
    if (controller && controller !== p) controller.holdingBall = false;
    const incomingSp = ballSpeed();
    const pfRecv = getPerf(p);
    if (pfRecv) pfRecv.touches++;
    if (lastPassMeta && (state.clockSec - lastPassMeta.t) < 22) {
      if (lastPassMeta.side === p.team && lastPassMeta.passer !== p) {
        const pfPasser = getPerf(lastPassMeta.passer);
        if (pfPasser) pfPasser.passesCompleted++;
        const dirP = dirFor(p.team);
        if (p.pos.x * dirP > 20 || (p.pos.x - lastPassMeta.x) * dirP > 9) {
          assistCandidate = { passer: lastPassMeta.passer, receiver: p, side: p.team, t: state.clockSec };
        }
      } else if (lastPassMeta.side !== p.team) {
        if (pfRecv) pfRecv.interceptions++;
        assistCandidate = null;
      }
      lastPassMeta = null;
    }
    callForPassReq.active = false;
    controller = p;
    p.holdingBall = false;
    gkDist = null;
    gkHoldTimer = 0;
    ball.controlledBy = p;
    state.possession = p.team;
    lastTouchSide = p.team;
    lastKicker = p;
    passTarget = null;
    shot = null;
    skill = null;
    activeKick = null;
    state.kickCharge.active = false;
    chargeHoldTime = 0;

    magnetState.player = null;
    magnetState.strength = 0;
    magnetState.mode = 'none';
    magnetState.queued = false;
    passGrace.timer = 0;
    passGrace.target = null;
    pursuitOverridden = false;
    if (p.team !== 'home') clearInputBuffers();

    if (p.role === 'GK') {
      settleT = 1.85 + rng() * 0.55;
      decisionT = 0.5;
    } else {
      const isUser = p === match.controlledPlayer && userT > 0;
      const userSpr = isUser && userInput && userInput.sprint;
      const userJock = isUser && userInput && userInput.modifier;
      const fastPass = incomingSp > 12.2;
      const tired = p.stamina < 0.30;
      const pSp = Math.hypot(p.vel.x, p.vel.z);
      const bvx = incomingSp > 0.4 ? ball.vel.x / incomingSp : Math.cos(p.facing);
      const bvz = incomingSp > 0.4 ? ball.vel.z / incomingSp : Math.sin(p.facing);
      const headOn = -(bvx * Math.cos(p.facing) + bvz * Math.sin(p.facing));
      const mVec = isUser && userInput && userInput.moveVec;
      const mLen = mVec ? Math.hypot(mVec.x, mVec.z) : 0;
      const exX = mLen > 0.15 ? mVec.x / mLen : (pSp > 0.8 ? p.vel.x / pSp : Math.cos(p.facing));
      const exZ = mLen > 0.15 ? mVec.z / mLen : (pSp > 0.8 ? p.vel.z / pSp : Math.sin(p.facing));
      const forwardStride = bvx * exX + bvz * exZ;
      const alignedRun = isUser && pSp > 1.2 && (headOn > 0.10 || forwardStride > 0.35);
      const cushionScale = userJock ? 0.62 : (alignedRun ? 0.68 : ((userSpr || tired) && fastPass ? 1.28 : 1.0));
      settleT = clamp((0.24 + rng() * 0.14) * cushionScale, 0.14, 0.56);
      decisionT = 0.44 + rng() * 0.32;

      // Smooth run-to-trap placement along player's exit vector rather than snapping behind heels
      if (fastPass && (userSpr || tired) && !alignedRun) {
        const touchPush = clamp((incomingSp - 10.5) * 0.040, 0.16, 0.48);
        ball.pos.x = clamp(p.pos.x + exX * (0.42 + touchPush), -HALF_X + 0.5, HALF_X - 0.5);
        ball.pos.z = clamp(p.pos.z + exZ * (0.42 + touchPush), -HALF_Z + 0.5, HALF_Z - 0.5);
      } else if (pSp > 1.0) {
        const strideLead = 0.38 + clamp(pSp * 0.025, 0, 0.14);
        const trapX = p.pos.x + exX * strideLead;
        const trapZ = p.pos.z + exZ * strideLead;
        const blendPos = alignedRun ? 0.58 : 0.44;
        ball.pos.x = clamp(lerp(ball.pos.x, trapX, blendPos), -HALF_X + 0.5, HALF_X - 0.5);
        ball.pos.z = clamp(lerp(ball.pos.z, trapZ, blendPos), -HALF_Z + 0.5, HALF_Z - 0.5);
      }
    }

    if (p.team === 'home' && p.role !== 'GK') {
      manualPick = null;
      manualT = 0;
    }
    const pSpExit = Math.hypot(p.vel.x, p.vel.z);
    const velBlend = pSpExit > 1.2 ? 0.68 : 0.52;
    ball.vel.x = lerp(ball.vel.x * 0.25, p.vel.x, velBlend);
    ball.vel.z = lerp(ball.vel.z * 0.25, p.vel.z, velBlend);
    ball.vel.y = 0;
    if (ball.spin) ball.spin.multiplyScalar(0.3);
    if (ball.pos.y > 0.6) ball.pos.y = 0.4;
  }

  function releaseBall() {
    if (controller) controller.holdingBall = false;
    controller = null;
    gkDist = null;
    gkHoldTimer = 0;
    ball.controlledBy = null;
    skill = null;
    state.kickCharge.active = false;
    chargeHoldTime = 0;
  }

  function schedulePhysicalKick(p, opts) {
    if (!isActive(p)) return false;
    if (activeKick && activeKick.player === p) return false;
    const action = opts.action || 'pass';
    if (action && (opts.forceAction || !p.actionBusy())) p.playAction(action);
    p.face(Math.atan2(opts.aimZ - p.pos.z, opts.aimX - p.pos.x));
    activeKick = {
      player: p,
      kind: opts.kind || 'pass',
      style: opts.style || 'normal',
      power: opts.power != null ? opts.power : 0.6,
      aimX: opts.aimX,
      aimZ: opts.aimZ,
      aimY: opts.aimY != null ? opts.aimY : 0.35,
      target: opts.target || null,
      spinX: opts.spinX || 0,
      spinY: opts.spinY || 0,
      spinZ: opts.spinZ || 0,
      knuckle: opts.knuckle || 0,
      timed: opts.timed || null,
      speedOverride: opts.speedOverride || null,
      vyOverride: opts.vyOverride || null,
      isSetPiece: !!opts.isSetPiece,
      isGiveAndGo: !!opts.isGiveAndGo,
      t: 0,
      impactT: opts.impactT != null ? opts.impactT : 0.14,
      after: opts.after || null,
    };
    return true;
  }

  function updateActiveKick(dt) {
    if (!activeKick) return;
    const k = activeKick;
    const p = k.player;
    if (!isActive(p) || (state.phase !== 'play' && state.phase !== 'out')) {
      activeKick = null;
      return;
    }
    // If another player stole the ball cleanly during windup -> cancel kick
    if (controller && controller !== p) {
      activeKick = null;
      return;
    }

    // Cancel pending Shoot windup into Fake Shot if Pass arrives before foot impact!
    if (k.player === match.controlledPlayer && k.kind === 'shoot' && userT > 0 && userInput &&
        (userInput.passPressed || userInput.holdPass)) {
      const kAim = { shotAimX: k.aimX, shotAimZ: k.aimZ };
      activeKick = null;
      fakeShotConsumeT = 0.24;
      startSkill(p, 'fakeShot', kAim);
      return;
    }

    k.t += dt;
    // Physically turn toward target during swing windup (bounded by players.js maxTurn!)
    p.face(Math.atan2(k.aimZ - p.pos.z, k.aimX - p.pos.x));

    if (k.t < k.impactT) return;

    // Physical foot-to-ball impact check at impact instant!
    activeKick = null;
    if (typeof p.getFootWorldPos === 'function') p.getFootWorldPos(true, _footPos);
    else _footPos.set(p.pos.x + Math.cos(p.facing) * 0.42, 0.1, p.pos.z + Math.sin(p.facing) * 0.42);

    const dFoot = d2(_footPos.x, _footPos.z, ball.pos.x, ball.pos.z);
    const dStride = d2(
      p.pos.x + Math.cos(p.facing) * 0.44,
      p.pos.z + Math.sin(p.facing) * 0.44,
      ball.pos.x,
      ball.pos.z,
    );
    const dBody = ballDist(p);
    const pSp = Math.hypot(p.vel.x, p.vel.z);
    const reach = k.isSetPiece ? 1.60 : clamp(1.18 + pSp * 0.055, 1.18, 1.56);
    const minDist = Math.min(dFoot, dStride, dBody);

    if (minDist > reach || (!k.isSetPiece && k.kind !== 'gk_dist' && ball.pos.y > 1.42)) {
      // Ball was tackled away or rolled past reach -> genuine whiff!
      if (controller === p) releaseBall();
      return;
    }

    const hadBall = controller === p;
    if (hadBall) releaseBall();
    else p.holdingBall = false;

    const dxRaw = k.aimX - ball.pos.x;
    const dzRaw = k.aimZ - ball.pos.z;
    const flat = Math.hypot(dxRaw, dzRaw) || 1;
    let ix = dxRaw / flat, iz = dzRaw / flat;

    // Body alignment against intended kick vector at physical impact instant
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const cosAlign = ix * fx + iz * fz; // +1 = square on, 0 = 90 deg, -1 = back turned!

    let speed;
    let vy;
    let curl = k.spinY || 0;
    let spinX = k.spinX || 0;
    let spinZ = k.spinZ || 0;
    let knuckle = k.knuckle || 0;

    if (k.kind === 'shoot') {
      const pwr = clamp(k.power, 0.25, 1.0);
      if (k.style === 'finesse') {
        speed = k.speedOverride || lerp(16.5, 25.5, pwr);
        const t = flat / speed;
        vy = k.vyOverride != null ? k.vyOverride : ((k.aimY - ball.pos.y) / t + 4.905 * t * 0.86);
      } else if (k.style === 'chip') {
        speed = k.speedOverride || lerp(12.5, 18.5, pwr);
        const t = flat / speed;
        const peakLift = clamp(3.0 + flat * 0.08, 3.1, 4.5);
        vy = k.vyOverride != null ? k.vyOverride : clamp(4.905 * t * 0.95 + peakLift * 0.55, 7.4, 11.2);
      } else {
        speed = k.speedOverride || lerp(17.5, 29.5, pwr);
        const t = flat / speed;
        vy = k.vyOverride != null ? k.vyOverride : ((k.aimY - ball.pos.y) / t + 4.905 * t * 0.84);
      }

      if (!k.isSetPiece) {
        if (cosAlign < 0.10) {
          // Player has back turned to goal -> weak, off-balance scuffed strike!
          const backT = clamp((cosAlign + 1) / 1.10, 0, 1);
          speed *= lerp(0.32, 0.52, backT);
          const dirBlend = lerp(0.76, 0.48, backT);
          let bx = lerp(ix, fx, dirBlend);
          let bz = lerp(iz, fz, dirBlend) + (rng() - 0.5) * 0.55;
          const bl = Math.hypot(bx, bz) || 1;
          ix = bx / bl; iz = bz / bl;
          vy = clamp(vy * 0.42, 0.4, 3.6);
          curl *= 0.25; spinX *= 0.25; spinZ *= 0.25; knuckle = 0;
        } else if (cosAlign < 0.68) {
          // Half-turned / off-balance shot -> sliced accuracy and reduced power
          const alignT = clamp((cosAlign - 0.10) / 0.58, 0, 1);
          speed *= lerp(0.58, 0.94, alignT);
          const dirBlend = lerp(0.42, 0.06, alignT);
          const scatter = (rng() - 0.5) * lerp(0.32, 0.04, alignT);
          let bx = lerp(ix, fx, dirBlend) - iz * scatter;
          let bz = lerp(iz, fz, dirBlend) + ix * scatter;
          const bl = Math.hypot(bx, bz) || 1;
          ix = bx / bl; iz = bz / bl;
          vy *= lerp(0.74, 0.98, alignT);
          curl *= lerp(0.45, 1.0, alignT);
          spinX *= lerp(0.45, 1.0, alignT);
          spinZ *= lerp(0.45, 1.0, alignT);
          knuckle *= alignT;
        }
      }
    } else if (k.kind === 'pass' || k.kind === 'through' || k.kind === 'lofted') {
      speed = k.speedOverride || 13.5;
      vy = k.vyOverride != null ? k.vyOverride : 0.2;
      if (!k.isSetPiece && cosAlign < 0.05) {
        // Blind behind-the-back pass -> awkward weaker turn/back-heel with error
        const backT = clamp((cosAlign + 1) / 1.05, 0, 1);
        speed *= lerp(0.60, 0.85, backT);
        const err = (rng() - 0.5) * 0.34;
        const c = Math.cos(err), s = Math.sin(err);
        const nx = ix * c - iz * s;
        const nz = ix * s + iz * c;
        ix = nx; iz = nz;
      }
    } else {
      speed = k.speedOverride || 16;
      vy = k.vyOverride != null ? k.vyOverride : 1.0;
    }

    // Check immediate defender shin-block directly in front of kicking foot
    if (!k.isSetPiece && k.kind !== 'gk_dist') {
      for (const o of squads[other(p.team)].all) {
        if (!isActive(o)) continue;
        const ox = o.pos.x - ball.pos.x, oz = o.pos.z - ball.pos.z;
        const od = Math.hypot(ox, oz);
        if (od > 0.1 && od < 0.98) {
          const forwardDot = (ox / od) * ix + (oz / od) * iz;
          if (forwardDot > 0.72) {
            // Deflected off defender's shin!
            speed *= 0.44;
            const perp = (ox * iz - oz * ix) >= 0 ? 1 : -1;
            const dAng = perp * (0.65 + rng() * 0.45);
            const ca = Math.cos(dAng), sa = Math.sin(dAng);
            const rx = ix * ca - iz * sa, rz = ix * sa + iz * ca;
            ix = rx; iz = rz;
            vy = 1.8 + rng() * 2.2;
            curl = 0; spinX = 0; spinZ = 0; knuckle = 0;
            break;
          }
        }
      }
    }

    TMP.set(ix * speed, vy, iz * speed);
    const hasSpin = (Math.abs(spinX) + Math.abs(curl) + Math.abs(spinZ)) > 0.01;
    ball.kick(
      TMP,
      hasSpin ? TMP2.set(spinX, curl, spinZ) : undefined,
      (knuckle > 0.01 || k.timed === 'green') ? { knuckle, timed: k.timed === 'green' } : undefined,
    );
    emit('kick', {
      kind: k.kind,
      power: k.power != null ? k.power : 0.6,
      pos: { x: ball.pos.x, z: ball.pos.z },
      vel: { x: TMP.x, z: TMP.z },
      timed: k.timed,
    });
    lastKicker = p;
    lastTouchSide = p.team;
    lockPlayer = p;
    kickLock = 0.52;
    if (k.after) k.after(TMP, cosAlign);
  }

  function kickBall(p, vel, spin, action, delay, after, forceAction) {
    if (action && (forceAction || !p.actionBusy())) p.playAction(action);
    const v = vel.clone();
    const s = spin ? spin.clone() : null;
    const hadBall = controller === p;
    const sfxKind = (action === 'shoot' || action === 'finesse_shoot') ? 'shoot'
      : action === 'throw_in' ? 'throw_in' : 'pass';
    const doIt = () => {
      if (hadBall && controller !== p) return;
      if (controller === p) releaseBall();
      ball.kick(v, s || undefined);
      emit('kick', { kind: sfxKind, power: clamp(v.length() / 28, 0.3, 1.0) });
      lastKicker = p;
      lastTouchSide = p.team;
      lockPlayer = p;
      kickLock = 0.55;
      if (after) after();
    };
    if (delay > 0) pending.push({ t: delay, fn: doIt });
    else doIt();
  }

  // ---- passing & crossing --------------------------------------------------
  function bestPass(p) {
    const side = p.team, dir = dirFor(side);
    const oppSide = other(side);
    const coach = teamTactics[side] || COACH_TACTIC_PROFILES.balanced;
    const longBias = coach.longBallBias || 0;
    const inWingCross = p.pos.x * dir > 21 && Math.abs(p.pos.z) > 14.5;
    let best = null, bestScore = -1e9, bestAx = 0, bestAz = 0, bestLoft = false, bestThrough = false;
    const urg = clamp((sinceShot - 12) / 8, 0, 1);
    for (const m of squads[side].all) {
      if (!isActive(m) || m === p || m.role === 'GK') continue;
      const isUnderRun = attackingRuns.has(m);
      const forwardRun = isUnderRun || (m.vel.x * dir > 1.8 && (m.pos.x - p.pos.x) * dir > 3 && spaceAhead(m) > 3.5);
      const leadForward = isUnderRun ? 7.2 : (forwardRun ? 6.2 : (m.role === 'FW' ? 4 : 2));
      const ax = clamp(m.pos.x + m.vel.x * 0.45 + dir * leadForward, -HALF_X + 1.5, HALF_X - 1.5);
      const az = clamp(m.pos.z + m.vel.z * 0.45, -HALF_Z + 1.5, HALF_Z - 1.5);
      const d = d2(p.pos.x, p.pos.z, ax, az);
      if (d < 5.5 || d > 36) continue;
      const progress = (ax - p.pos.x) * dir;
      let score = 0.4 + progress * 0.05 * (1 + urg * 0.8 + Math.max(0, longBias) * 0.5);
      let space = 20;
      for (const o of squads[oppSide].all) {
        if (!isActive(o)) continue;
        const od = d2(o.pos.x, o.pos.z, ax, az);
        if (od < space) space = od;
      }
      score += Math.min(space, 9) * 0.09;
      const isLongSwitch = d > 18 && progress > 10;
      const isCross = (inWingCross && ax * dir > 34 && Math.abs(az) < 11.5) || (longBias > 0.5 && isLongSwitch && d > 22);
      const blockers = laneBlockers(p.pos.x, p.pos.z, ax, az, oppSide, false);
      score -= blockers * (isCross ? 0.25 : 0.85);
      if (isCross) score += 1.65;
      if (longBias < 0 && d < 16) score += 0.48;
      if (longBias > 0.2 && progress > 12) score += 0.42 * longBias;
      if (forwardRun && blockers === 0) score += 0.65;
      if (isUnderRun && blockers === 0) score += 1.45;
      const isUserPro = (playerLock.enabled && (m.id === playerLock.playerId || m.isPro)) ||
        (!playerLock.enabled && m === match.controlledPlayer && m.team === 'home');
      if (isUserPro) {
        if (space >= 3.6 && blockers === 0) {
          score += 2.5 + clamp((space - 3.5) * 0.35, 0, 1.5);
          if (progress > 1.5) score += 0.85;
          if (forwardRun) score += 0.6;
        } else if (space >= 2.6 && blockers <= 1) {
          score += 1.1;
        }
      }
      if (m.role === 'FW') score += 0.28;
      if (m.star) score += 2.2;
      score += clamp(((m.ovr || 76) - 75) * 0.018, -0.25, 0.35);
      if (d > 25 && !isCross && longBias <= 0) score -= 0.3;
      if (progress < -13) score -= 0.7;
      if (score > bestScore) {
        bestScore = score;
        best = m;
        bestAx = ax;
        bestAz = az;
        bestLoft = isCross;
        bestThrough = forwardRun && !isCross;
      }
    }
    return { target: best, score: bestScore, ax: bestAx, az: bestAz, loftBias: bestLoft, isThrough: bestThrough };
  }

  function userBestPass(p, power, preferBoxCross) {
    const side = p.team;
    const oppSide = other(side);
    const dir = dirFor(side);
    const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
    const mLen = Math.hypot(m.x, m.z);
    const axDir = mLen > 0.15 ? m.x / mLen : Math.cos(p.facing);
    const azDir = mLen > 0.15 ? m.z / mLen : Math.sin(p.facing);
    const pwr = power != null ? clamp(power, 0.25, 1.0) : 0.55;
    const idealDist = lerp(8, 28, pwr);

    let bestCone = null, coneScore = -1e9, coneAx = 0, coneAz = 0;
    let bestWide = null, wideScore = -1e9, wideAx = 0, wideAz = 0;

    for (const mate of squads[side].all) {
      if (!isActive(mate) || mate === p) continue;
      const dx = mate.pos.x - p.pos.x;
      const dz = mate.pos.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2.2 || dist > 54) continue;

      const dot = (dx / dist) * axDir + (dz / dist) * azDir;
      if (dot < -0.15) continue;

      const leadT = clamp(dist / 36, 0.10, 0.32);
      const ax = clamp(mate.pos.x + mate.vel.x * leadT, -HALF_X + 1.2, HALF_X - 1.2);
      const az = clamp(mate.pos.z + mate.vel.z * leadT, -HALF_Z + 1.2, HALF_Z - 1.2);

      let space = 20;
      for (const o of squads[oppSide].all) {
        if (!isActive(o)) continue;
        const od = d2(o.pos.x, o.pos.z, ax, az);
        if (od < space) space = od;
      }
      const blockers = laneBlockers(p.pos.x, p.pos.z, ax, az, oppSide, false);
      const boxBonus = (preferBoxCross && ax * dir > 34 && Math.abs(az) < 15) ? 2.4 : 0;

      const score = dot * 6.5 - Math.abs(dist - idealDist) * 0.055 +
        Math.min(space, 8) * 0.04 - blockers * 0.35 + (mate.role === 'GK' ? -1.2 : 0) + boxBonus;

      if (dot >= 0.22 && score > coneScore) {
        coneScore = score; bestCone = mate; coneAx = ax; coneAz = az;
      }
      if (score > wideScore) {
        wideScore = score; bestWide = mate; wideAx = ax; wideAz = az;
      }
    }

    if (bestCone) return { target: bestCone, ax: coneAx, az: coneAz };
    if (bestWide) return { target: bestWide, ax: wideAx, az: wideAz };
    const freeDist = lerp(8, 22, pwr);
    return {
      target: null,
      ax: clamp(p.pos.x + axDir * freeDist, -HALF_X + 1, HALF_X - 1),
      az: clamp(p.pos.z + azDir * freeDist, -HALF_Z + 1, HALF_Z - 1),
    };
  }

  const CROSS_DRAG_K = 0.0125;
  const CROSS_MAGNUS_K = 0.0052;
  const _avoidPos = v3();

  function buildCrossDelivery(p, target, baseAx, baseAz, pwr) {
    const dir = dirFor(p.team);
    const charge = pwr != null ? clamp(pwr, 0.25, 1.0) : 0.65;

    const rawDist = Math.hypot(baseAx - ball.pos.x, baseAz - ball.pos.z) || 1;
    const estFlyT = clamp(0.95 + rawDist * 0.036, 1.25, 2.05);
    let landX = baseAx;
    let landZ = baseAz;
    if (target && isActive(target)) {
      const leadT = clamp(estFlyT * 0.52, 0.28, 0.92);
      landX = clamp(target.pos.x + target.vel.x * leadT, -HALF_X + 1.5, HALF_X - 1.5);
      landZ = clamp(target.pos.z + target.vel.z * leadT, -HALF_Z + 1.5, HALF_Z - 1.5);
    }

    // Very strong crosses (>80% charge) have a realistic chance to carry slightly past the target toward the far post
    let overHit = false;
    if (charge > 0.80) {
      const overFrac = clamp((charge - 0.80) / 0.20, 0, 1);
      if (rng() < overFrac * 0.65) {
        overHit = true;
        const dx0 = landX - ball.pos.x;
        const dz0 = landZ - ball.pos.z;
        const d0 = Math.hypot(dx0, dz0) || 1;
        const extraCarry = lerp(2.0, 3.8, overFrac) * lerp(0.88, 1.15, rng());
        landX = clamp(landX + (dx0 / d0) * extraCarry * 0.72 + dir * extraCarry * 0.22, -HALF_X + 1.4, HALF_X - 1.4);
        landZ = clamp(landZ + (dz0 / d0) * extraCarry * 0.90, -HALF_Z + 1.4, HALF_Z - 1.4);
      }
    }

    const dx = landX - ball.pos.x;
    const dz = landZ - ball.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const ix = dx / dist;
    const iz = dz / dist;
    const tFly = clamp((1.05 + dist * 0.038) * lerp(1.08, 0.92, charge) * (overHit ? 1.04 : 1.0), 1.24, 2.34);
    // Exact quadratic drag compensation so the cross carries cleanly onto (landX, landZ)
    const speed = clamp((Math.exp(CROSS_DRAG_K * dist) - 1) / (CROSS_DRAG_K * tFly), 12.2, 23.2);
    const vy = clamp((0.78 - ball.pos.y) / tFly + 4.905 * tFly * 1.035, 7.6, 13.0);

    // Flank-aware in-swinging curl (toward goal) with Magnus aim compensation
    const curlMag = lerp(11.5, 17.5, charge);
    const spinY = dir * Math.sign(iz || -Math.sign(p.pos.z || 1)) * curlMag;
    const spinAvg = spinY * (1 - 0.10 * tFly);
    const magShift = 0.43 * CROSS_MAGNUS_K * spinAvg * dist * tFly;
    const compX = clamp(landX - iz * magShift, -HALF_X + 1.0, HALF_X - 1.0);
    const compZ = clamp(landZ + ix * magShift, -HALF_Z + 1.0, HALF_Z - 1.0);

    return { aimX: compX, aimZ: compZ, speed, vy, spinY, landX, landZ, overHit };
  }

  function doPass(p, target, ax, az, loftBias, power, isGiveAndGo) {
    const dir = dirFor(p.team);
    const isCross = loftBias && Math.abs(p.pos.z) > 12.5 && p.pos.x * dir > 14;
    const pwr = power != null ? clamp(power, 0.25, 1.0) : null;

    let aimX = ax;
    let aimZ = az;
    let speed;
    let vy;
    let spinY = 0;

    if (isCross) {
      const c = buildCrossDelivery(p, target, ax, az, pwr);
      aimX = c.aimX;
      aimZ = c.aimZ;
      speed = c.speed;
      vy = c.vy;
      spinY = c.spinY;
    } else {
      const dx = ax - ball.pos.x, dz = az - ball.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      // Pass accuracy scatter inversely scaled by player's passing attribute for longer/rushed balls
      const pass01 = stat01(p, 'pass');
      if (!p.star && dist > 12) {
        const oppClose = nearestOpp(p).d < 2.4 ? 1.35 : 1.0;
        const errSpan = clamp((dist - 12) / 30, 0, 1) * clamp(0.70 - pass01 * 0.52, 0.12, 1.30) * oppClose;
        aimX = clamp(aimX + (rng() - 0.5) * errSpan, -HALF_X + 1.0, HALF_X - 1.0);
        aimZ = clamp(aimZ + (rng() - 0.5) * errSpan, -HALF_Z + 1.0, HALF_Z - 1.0);
      }
      // Turf rolling friction is 3.2 m/s^2: scale pass velocity with distance so far passes stay crisp even on taps
      const vArrive = lerp(6.8, 9.4, clamp((dist - 6) / 32, 0, 1));
      const reqSp = Math.sqrt(vArrive * vArrive + 6.45 * dist) + (dist > 22 ? (dist - 22) * 0.08 : 0);
      const minTapScale = lerp(0.84, 0.98, clamp((dist - 14) / 20, 0, 1));
      const baseSp = clamp(reqSp, 9.6, 22.2);
      speed = pwr != null ? clamp(baseSp * lerp(minTapScale, 1.20, pwr), 9.0, 23.6) : baseSp;
      const t = dist / speed;
      const loftScale = pwr != null ? lerp(0.88, 1.22, pwr) : 1.0;
      vy = loftBias
        ? clamp(4.905 * t * 0.84 * loftScale, 4.4, 10.6)
        : (dist > 25 ? clamp(4.905 * t * 0.24, 0.35, 2.6) : 0.2);
    }

    const wasUser = p === match.controlledPlayer;
    passTarget = target;
    passT = 0;
    snapshotOffside(p, p.team);
    if (isGiveAndGo) oneTwoMap.set(p, 2.8);
    schedulePhysicalKick(p, {
      kind: loftBias ? 'lofted' : 'pass',
      power: pwr,
      aimX,
      aimZ,
      aimY: 0.2,
      target,
      spinY,
      speedOverride: speed,
      vyOverride: vy,
      action: 'pass',
      impactT: 0.14,
      forceAction: wasUser,
      after: () => {
        recordPassAttempt(p, target, dir);
        passTarget = target;
        passT = 0;
        if (wasUser && !playerLock.enabled && target && target.team === 'home' && target.role !== 'GK' && isActive(target)) {
          match.controlledPlayer = target;
          manualPick = null;
          manualT = 0;
          autoSwitchCd = 0.25;
          armPassGrace(target);
        }
      },
    });
  }

  // ---- shooting & saves ----------------------------------------------------
  function doShoot(p, power, style = 'normal', timed = null) {
    const dir = dirFor(p.team);
    const gx = dir * HALF_X;
    const wasUser = p === match.controlledPlayer;
    const cheat = !!p.star;
    const prof = diffProfile();
    const pwr = power != null ? clamp(power, 0.25, 1.0) : null;
    const closeIn = cheat && Math.abs(gx - ball.pos.x) < 13;
    const oppGk = squads[other(p.team)].gk;
    const shoot01 = stat01(p, 'shoot');
    const skillScat = cheat ? 0.35 : clamp(1.0 - shoot01 * 0.38, 0.58, 1.42);

    let aimZ;
    if (wasUser && userInput && userInput.moveVec && Math.hypot(userInput.moveVec.x, userInput.moveVec.z) > 0.15) {
      const scat = (timed === 'green' ? 0.14 : (timed === 'late' ? 0.85 : 0.42)) * skillScat;
      aimZ = clamp(userInput.moveVec.z * 3.35 + (rng() - 0.5) * scat, -3.55, 3.55);
    } else if (style === 'finesse') {
      aimZ = (p.pos.z >= 0 ? -1 : 1) * (2.68 + rng() * 0.46);
    } else {
      const openSide = oppGk ? (oppGk.pos.z >= 0.15 ? -1 : oppGk.pos.z <= -0.15 ? 1 : (rng() < 0.5 ? -1 : 1)) : (rng() < 0.5 ? -1 : 1);
      const aiScat = (p.team === 'away' ? prof.shotScatter : 0.45) * skillScat;
      aimZ = cheat
        ? openSide * (closeIn ? 2.25 + rng() * 0.75 : 2.95 + rng() * 0.5)
        : openSide * (2.25 + rng() * 1.1) + (rng() - 0.5) * aiScat;
      aimZ = clamp(aimZ, -3.45, 3.45);
    }

    let aimY = pwr != null
      ? lerp(0.28, 2.28, Math.pow(pwr, 1.18))
      : (cheat ? (closeIn ? 1.45 + rng() * 0.55 : 0.45 + rng() * 0.45) : 0.35 + rng() * 1.45);
    if (timed === 'green') aimY = clamp(aimY * 0.92 + 0.12, 0.32, 2.08);
    else if (timed === 'late') aimY = clamp(aimY + 0.48, 0.5, 2.9);

    const dx = gx - ball.pos.x, dz = aimZ - ball.pos.z;
    const flat = Math.hypot(dx, dz) || 1;
    const ix = dx / flat, iz = dz / flat;
    let speed;
    let vy;
    let curl = (rng() - 0.5) * 6;
    let topspin = 0;
    let knuckle = 0;
    let actionName = 'shoot';
    const shotSpeedScale = cheat ? 1.0 : (1 + shoot01 * 0.06);

    if (style === 'finesse') {
      speed = (pwr != null ? lerp(17.5, 26.8, pwr) : clamp(19.5 + flat * 0.22, 20, 26)) * shotSpeedScale;
      if (timed === 'green') speed *= 1.12;
      const t = flat / speed;
      aimY = clamp(aimY * 0.86 + 0.25, 0.45, 2.02);
      vy = (aimY - ball.pos.y) / t + 4.905 * t * 0.86;
      const bendSign = aimZ >= ball.pos.z ? -1 : 1;
      curl = bendSign * (18 + (pwr || 0.6) * 9.5 + (timed === 'green' ? 3.5 : 0)) * (1 + shoot01 * 0.12);
      topspin = clamp(speed * 0.35, 5, 11);
      actionName = 'finesse_shoot';
    } else if (style === 'chip') {
      const gkAdv = oppGk ? Math.abs(oppGk.pos.x - gx) : 3.0;
      const gkClearance = oppGk ? clamp(2.8 + gkAdv * 0.12, 2.9, 3.85) : 3.2;
      speed = pwr != null ? lerp(12.2, 18.2, pwr) : clamp(13.2 + flat * 0.12, 13.0, 17.8);
      const t = flat / speed;
      vy = clamp(4.905 * t * 0.98 + gkClearance * 0.46, 7.6, 11.4);
      curl = 0;
      topspin = -2.5; // slight backspin for soft chip drop
    } else {
      speed = (pwr != null
        ? lerp(18.5, 31.2, pwr)
        : (cheat ? clamp(29 + flat * 0.14, 29, 36) : clamp(21.5 + flat * 0.28 + rng() * 3.5, 22, 30.5))) * shotSpeedScale;
      if (timed === 'green') speed *= 1.14;
      const t = flat / speed;
      const gFactor = cheat ? clamp(1.24 - flat * 0.008, 1.0, 1.24) : 0.84;
      vy = (aimY - ball.pos.y) / t + 4.905 * t * gFactor;
      if (!cheat && ((pwr != null && pwr >= 0.72) || timed === 'green') && Math.abs(aimZ) < 1.9) {
        knuckle = clamp(((pwr || 0.78) - 0.65) / 0.35, 0.38, 0.92);
        curl *= 0.2;
      } else {
        topspin = clamp(speed * 0.28, 3.5, 9.0);
      }
    }

    // World spin vector matching cross(spin, vel): lateral axis (-iz, 0, ix) adds downward dip for +topspin
    const spinX = iz * topspin;
    const spinZ = -ix * topspin;

    const gk = oppGk;
    const side = p.team;
    const blockers = laneBlockers(ball.pos.x, ball.pos.z, gx, aimZ, other(side), true);
    const reactBase = clamp(0.15 + blockers * 0.035 + (style === 'finesse' ? 0.035 : 0) + (knuckle > 0.3 ? 0.03 : 0), 0.15, 0.28);
    const gkReactScale = clamp(1.0 - stat01(gk, 'def') * 0.16, 0.84, 1.16);
    const reactDelay = reactBase * gkReactScale * (gk.team === 'away' ? prof.reactMult : 1.0);

    schedulePhysicalKick(p, {
      kind: 'shoot',
      style,
      power: pwr,
      aimX: gx,
      aimZ,
      aimY,
      spinX,
      spinY: curl,
      spinZ,
      knuckle,
      timed,
      speedOverride: speed,
      vyOverride: vy,
      action: actionName,
      impactT: style === 'finesse' ? 0.20 : 0.22,
      forceAction: wasUser,
      after: (launchVel, cosAlign) => {
        state.stats[side].shots++;
        const onTgt = cosAlign >= 0.45 && Math.abs(aimZ) < GOAL.width / 2 && aimY < GOAL.height + 0.15;
        if (onTgt) {
          state.stats[side].onTarget++;
        }
        const spf = getPerf(p);
        if (spf) {
          spf.shots++;
          if (onTgt) spf.shotsOnTarget++;
          else if (d2(p.pos.x, p.pos.z, gx, 0) < 14) spf.bigChancesMissed++;
        }
        if (assistCandidate && assistCandidate.receiver === p && assistCandidate.side === side && (state.clockSec - assistCandidate.t) < 18) {
          const apf = getPerf(assistCandidate.passer);
          if (apf && assistCandidate.passer !== p) apf.keyPasses++;
        }
        lastShooter = p;
        shot = { shooter: p, side, aimZ, aimY, gk, reacted: false, reactT: reactDelay, dived: false };
        sinceShot = 0;
        state.excitement = Math.max(state.excitement, 0.55);
      },
    });
  }

  function predictGoalArrival(gk) {
    const dirDef = dirFor(gk.team); // defending team's attacking dir; own goal is at -dirDef * HALF_X
    const gx = -dirDef * HALF_X;
    const interceptX = gx + dirDef * 1.15;
    // Check if ball is moving toward this goal
    if (ball.vel.x * (-dirDef) <= 2.5) return null;
    const dx = interceptX - ball.pos.x;
    const sp = ball.vel.length();
    // Quadratic drag slows long shots over tArr -> compensate flight duration slightly
    const tRaw = clamp(dx / ball.vel.x, 0.02, 1.8);
    const dragBoost = 1 + clamp(0.011 * sp * tRaw, 0, 0.28);
    const tArr = clamp(tRaw * dragBoost, 0.02, 1.9);
    const magnusZ = ball.spin ? clamp(0.0052 * (ball.spin.y * ball.vel.x), -10.5, 10.5) : 0;
    const magnusY = ball.spin ? clamp(0.0046 * (ball.spin.z * ball.vel.x - ball.spin.x * ball.vel.z), -5.0, 5.0) : 0;
    const zArr = clamp(ball.pos.z + ball.vel.z * tArr + 0.5 * magnusZ * tArr * tArr, -GOAL.width / 2 - 1.8, GOAL.width / 2 + 1.8);
    const yArr = Math.max(0.15, ball.pos.y + ball.vel.y * tArr + 0.5 * (-9.81 + magnusY) * tArr * tArr);
    return { tArr, zArr, yArr, interceptX, gx, dirDef };
  }

  function defendShotWithKeeper(gk, dt, activeShot) {
    if (lockPlayer === gk && kickLock > 0) return false;
    const pred = predictGoalArrival(gk);
    if (!pred) return false;
    const { tArr, zArr, yArr, interceptX, dirDef } = pred;
    const threateningFrame = Math.abs(zArr) < GOAL.width / 2 + 1.4 && yArr < GOAL.height + 1.1;
    if (!threateningFrame) return false;

    if (activeShot) {
      if (!activeShot.reacted) {
        activeShot.reactT -= dt;
        if (activeShot.reactT > 0) return false;
        activeShot.reacted = true;
      }
    }

    const gk01 = stat01(gk, 'def');
    const dz = zArr - gk.pos.z;
    const onTargetZ = Math.abs(zArr) < GOAL.width / 2 + 0.55;
    if (onTargetZ && !(activeShot && activeShot.isPenalty && gk.team === 'home' && activeShot.userDiveUsed)) {
      const targetX = clamp(interceptX, Math.min(-dirDef * (HALF_X - 0.5), -dirDef * 4), Math.max(-dirDef * (HALF_X - 0.5), -dirDef * 4));
      const targetZ = clamp(zArr, -GOAL.width / 2 - 0.3, GOAL.width / 2 + 0.3);
      if (Math.abs(dz) > 0.55 && tArr < 0.52 && (!activeShot || !activeShot.dived) && !gk.actionBusy()) {
        const sGoal = -dirDef; // +1 if defending +X goal, -1 if defending -X goal
        const isLeft = dz * sGoal > 0;
        const diveAct = yArr > 1.35
          ? (isLeft ? 'gk_parry_left' : 'gk_parry_right')
          : (isLeft ? 'gk_dive_left' : 'gk_dive_right');
        gk.playAction(diveAct);
        const burst = clamp((Math.abs(dz) / Math.max(0.24, tArr)) * 0.62 * (1 + gk01 * 0.10), 2.4, 5.9);
        gk.pushVel(0, Math.sign(dz) * burst);
        gkRecoverMap.set(gk, 0.42);
        emit('tackle', { isSlide: false, pos: { x: gk.pos.x, z: gk.pos.z }, vel: { x: gk.vel.x, z: gk.vel.z } });
        if (activeShot) activeShot.dived = true;
      } else if (!gk.actionBusy()) {
        const tMove = tgtOf(gk).set(targetX, 0, targetZ);
        gk.moveTo(tMove, 0.86, { snappy: true });
      }
      gk.face(ball.pos);
    }

    // Physical 3D reach capsule check for actual save / catch / parry
    const dxBall = Math.abs(ball.pos.x - gk.pos.x);
    const dzBall = ball.pos.z - gk.pos.z;
    const diving = !!(gk.actionBusy() && activeShot && activeShot.dived);
    const maxLatReach = (diving ? 1.24 : 0.80) + gk01 * 0.09;
    const maxHeightReach = diving ? 2.20 : 2.10;

    if (dxBall < 0.94 && Math.abs(dzBall) <= maxLatReach && ball.pos.y <= maxHeightReach) {
      const sp = ballSpeed();
      const canCatch = sp < (16.5 + gk01 * 1.8) && Math.abs(dzBall) < 0.55 && ball.pos.y < 1.85;
      if (canCatch) {
        shot = null;
        if (!gk.actionBusy()) gk.playAction('gk_catch');
        gainControl(gk);
        gk.holdingBall = true;
        gkHoldTimer = 0;
        gkDist = null;
        settleT = 1.9 + rng() * 0.65;
        ball.pos.set(gk.pos.x + Math.cos(gk.facing) * 0.35, 1.14, gk.pos.z + Math.sin(gk.facing) * 0.35);
        state.excitement = Math.max(state.excitement, 0.62);
        const gkPf = getPerf(gk);
        if (gkPf) gkPf.saves++;
        emit('save', {
          gk: { number: gk.number, name: gk.name },
          shooter: activeShot && activeShot.shooter ? activeShot.shooter.number : null,
          side: other(gk.team),
          catch: true,
        });
        return true;
      }

      // Danger-aware outward parry away from lurking opposing attackers in the box
      shot = null;
      ball.controlledBy = null;
      const attSide = other(gk.team);
      let leftHazard = 0, rightHazard = 0;
      for (const att of squads[attSide].out) {
        if (!isActive(att)) continue;
        if (Math.abs(att.pos.x - gk.pos.x) < 18) {
          if (att.pos.z >= 0) rightHazard += 1 / Math.max(2, d2(att.pos.x, att.pos.z, gk.pos.x, 4));
          else leftHazard += 1 / Math.max(2, d2(att.pos.x, att.pos.z, gk.pos.x, -4));
        }
      }
      let wideSign = Math.abs(dzBall) > 0.12 ? Math.sign(dzBall) : (gk.pos.z >= 0 ? 1 : -1);
      if (Math.abs(leftHazard - rightHazard) > 0.08 && Math.abs(dzBall) < 0.35) {
        wideSign = rightHazard > leftHazard ? -1 : 1;
      }
      const tipBehind = (ball.pos.y > 1.45 && sp > 14.0) || Math.abs(dzBall) > 0.66;
      const outX = tipBehind ? -dirDef * (2.6 + rng() * 2.4) : dirDef * (4.6 + rng() * 5.0);
      const outY = tipBehind ? (3.8 + rng() * 2.4) : (2.2 + rng() * 2.4);
      const outZ = wideSign * (tipBehind ? (3.6 + rng() * 3.4) : (7.2 + rng() * 5.4));
      TMP.set(outX, outY, outZ);
      ball.kick(TMP.clone(), TMP2.set(0, -wideSign * 8, 0));
      gkRecoverMap.set(gk, 0.45);
      lastTouchSide = gk.team;
      lastKicker = gk;
      lockPlayer = gk;
      kickLock = 0.38;
      state.excitement = Math.max(state.excitement, 0.78);
      const gkPfP = getPerf(gk);
      if (gkPfP) gkPfP.saves++;
      emit('save', {
        gk: { number: gk.number, name: gk.name },
        shooter: activeShot && activeShot.shooter ? activeShot.shooter.number : null,
        side: attSide,
        catch: false,
      });
      return true;
    }

    return onTargetZ;
  }

  function monitorShot(dt) {
    const sp = ballSpeed();
    if (shot) {
      if (sp < 4.5 && !shot.reacted) { shot = null; return; }
      defendShotWithKeeper(shot.gk, dt, shot);
      if (sp < 4.5) shot = null;
      return;
    }
    // Even without formal shot flag, guard against fast deflections / long shots
    if (!controller && sp > 7.5) {
      const targetGk = ball.vel.x > 0 ? (dirFor('home') > 0 ? squads.away.gk : squads.home.gk)
        : (dirFor('home') > 0 ? squads.home.gk : squads.away.gk);
      defendShotWithKeeper(targetGk, dt, null);
    }
  }

  // ---- carrier brain -------------------------------------------------------
  function decide(p) {
    const dir = dirFor(p.team);
    const gx = dir * HALF_X;
    const distG = d2(p.pos.x, p.pos.z, gx, 0);
    const urg = clamp((sinceShot - 12) / 8, 0, 1);
    const coach = teamTactics[p.team] || COACH_TACTIC_PROFILES.balanced;
    const near = nearestOpp(p);
    let uShoot = -1;
    const range = p.star ? 60 : 21 + 9 * urg;
    if (distG < range) {
      const blockers = laneBlockers(p.pos.x, p.pos.z, gx, 0, other(p.team), true);
      uShoot = 1.15 * (1 - distG / 36) + 0.9 * urg - 0.45 * blockers +
        (p.role === 'FW' ? 0.15 : 0);
      if (p.star) uShoot = 3.0 - distG * 0.012;
    }
    if (urg >= 1 && distG < 34) uShoot = 99;
    const bp = bestPass(p);
    let uPass = bp.target
      ? 0.42 + bp.score * 0.5 + (near.d < 2.6 ? 0.4 : 0) + urg * 0.1 + (coach.id === 'possession' ? 0.25 : 0)
      : -1;
    const ahead = spaceAhead(p);
    let uDrib = 0.55 + clamp(ahead - 3, 0, 6) * 0.07 - (near.d < 2.1 ? 0.45 : 0) - urg * 0.2 - (coach.id === 'possession' ? 0.14 : 0);
    if (p.pos.x * dir > 40) uDrib -= 0.35;

    if (uShoot >= uPass && uShoot >= uDrib) {
      const oppGk = squads[other(p.team)].gk;
      if (!p.star && distG < 18) {
        if (oppGk && pdist(p, oppGk) < 7.8 && Math.abs(oppGk.pos.x - gx) > 5.5) {
          doShoot(p, 0.56, 'chip');
          return;
        }
        if (Math.abs(p.pos.z) > 5.5 && distG < 19) {
          doShoot(p, 0.72, 'finesse');
          return;
        }
      }
      doShoot(p);
    } else if (uPass >= uDrib && bp.target) {
      doPass(p, bp.target, bp.ax, bp.az, !!bp.loftBias);
    }
  }

  function dribbleMove(p) {
    const dir = dirFor(p.team);
    let tx = dir * HALF_X, tz = p.pos.z * 0.4;
    let sx = tx - p.pos.x, sz = tz - p.pos.z;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl; sz /= sl;
    const near = nearestOpp(p);
    if (near.opp && near.d < 5) {
      const fwd = (near.opp.pos.x - p.pos.x) * dir;
      if (fwd > -0.5) {
        const side = Math.sign(p.pos.z - near.opp.pos.z) || (rng() < 0.5 ? 1 : -1);
        sz += side * (1.2 - near.d * 0.18);
        const l2 = Math.hypot(sx, sz) || 1;
        sx /= l2; sz /= l2;
      }
    }
    const t = tgtOf(p).set(p.pos.x + sx * 6, 0, clamp(p.pos.z + sz * 6, -HALF_Z + 1, HALF_Z - 1));
    p.moveTo(t, near.d < 3.5 ? 0.95 : 0.8);
    if (Math.hypot(p.vel.x, p.vel.z) > 0.8) p.face(Math.atan2(p.vel.z, p.vel.x));
  }

  function triggerSkillDeception(p, type, side, dirX, dirZ, wrapOpp) {
    const oppSide = other(p.team);
    const rx = -dirZ, rz = dirX;
    if (type === 'elastico') {
      for (const o of squads[oppSide].out) {
        if (!isActive(o) || o.holdingBall) continue;
        const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 4.3 || d < 0.2) continue;
        const fwdDot = (dx / d) * dirX + (dz / d) * dirZ;
        if (fwdDot < -0.25) continue;
        // Defender bites on initial outside whip (+side), stumbling the wrong way while carrier cuts (-side)
        const bx = (rx * side * 0.85 + dirX * 0.35);
        const bz = (rz * side * 0.85 + dirZ * 0.35);
        const bl = Math.hypot(bx, bz) || 1;
        const vx = (bx / bl) * 4.4, vz = (bz / bl) * 4.4;
        const fAng = Math.atan2(vz, vx);
        o.stop();
        o.face(fAng);
        o.pushVel(vx, vz);
        o.playAction('deceived_stumble');
        deceivedMap.set(o, { mode: 'wrong_way', vx: vx * 0.52, vz: vz * 0.52, t: 0, dur: 0.62, faceAng: fAng });
        const m = meta.get(o);
        if (m) m.tackleCd = Math.max(m.tackleCd, 0.78);
      }
      return;
    }
    if (type === 'fakeShot') {
      for (const o of squads[oppSide].out) {
        if (!isActive(o) || o.holdingBall) continue;
        const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 5.2 || d < 0.2) continue;
        const fwdDot = (dx / d) * dirX + (dz / d) * dirZ;
        const latDot = Math.abs(dx * rx + dz * rz);
        if (fwdDot < 0.12 || latDot > 3.0) continue;
        // Defender commits an actual blocking slide tackle at the phantom shot!
        const tx = p.pos.x + dirX * 1.4 - o.pos.x;
        const tz = p.pos.z + dirZ * 1.4 - o.pos.z;
        const tl = Math.hypot(tx, tz) || 1;
        const sx = tx / tl, sz = tz / tl;
        const fAng = Math.atan2(sz, sx);
        o.stop();
        o.face(fAng);
        o.pushVel(sx * 7.8, sz * 7.8);
        o.playAction('tackle');
        emit('tackle', { isSlide: true });
        deceivedMap.set(o, { mode: 'slide_bait', vx: sx * 7.8, vz: sz * 7.8, t: 0, dur: 0.68, faceAng: fAng });
        const m = meta.get(o);
        if (m) m.tackleCd = Math.max(m.tackleCd, 1.15);
      }
      return;
    }
    if (type === 'roulette' && wrapOpp && isActive(wrapOpp) && !wrapOpp.holdingBall) {
      const vx = -rx * side * 1.8 + dirX * 0.2;
      const vz = -rz * side * 1.8 + dirZ * 0.2;
      const fAng = Math.atan2(p.pos.z - wrapOpp.pos.z, p.pos.x - wrapOpp.pos.x);
      wrapOpp.pushVel(vx, vz);
      deceivedMap.set(wrapOpp, { mode: 'wrapped', vx: vx * 0.4, vz: vz * 0.4, t: 0, dur: 0.44, faceAng: fAng });
      const m = meta.get(wrapOpp);
      if (m) m.tackleCd = Math.max(m.tackleCd, 0.58);
    }
  }

  function startSkill(p, type, opts = null) {
    if (skill || (type !== 'fakeShot' && skillCd > 0)) return false;
    const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
    const mLen = Math.hypot(m.x, m.z);
    let dirX = mLen > 0.15 ? m.x / mLen : Math.cos(p.facing);
    let dirZ = mLen > 0.15 ? m.z / mLen : Math.sin(p.facing);
    if (type === 'fakeShot') {
      // Phantom shot vector: cancelled kick aim if winding up, else active velocity or goal direction
      if (opts && opts.shotAimX != null && opts.shotAimZ != null) {
        const sdx = opts.shotAimX - p.pos.x, sdz = opts.shotAimZ - p.pos.z;
        const sl = Math.hypot(sdx, sdz) || 1;
        dirX = sdx / sl; dirZ = sdz / sl;
      } else {
        const pSp = Math.hypot(p.vel.x, p.vel.z);
        if (pSp > 1.2) {
          dirX = p.vel.x / pSp; dirZ = p.vel.z / pSp;
        } else {
          const gx = dirFor(p.team) * HALF_X - p.pos.x;
          const gz = clamp(p.pos.z * 0.25, -3.5, 3.5) - p.pos.z;
          const gl = Math.hypot(gx, gz) || 1;
          dirX = gx / gl; dirZ = gz / gl;
        }
      }
    }

    let side = (userInput && userInput.skillRollSide) ? userInput.skillRollSide : 0;
    const rx = -dirZ, rz = dirX;
    let wrapOpp = null;
    const near = nearestOpp(p);

    if (type === 'fakeShot' && mLen > 0.15) {
      const mDotLat = (m.x / mLen) * rx + (m.z / mLen) * rz;
      if (Math.abs(mDotLat) > 0.25) side = mDotLat >= 0 ? 1 : -1;
    }
    if (!side) {
      if (near.opp && near.d < 6) {
        const oppDot = (near.opp.pos.x - p.pos.x) * rx + (near.opp.pos.z - p.pos.z) * rz;
        // Elastico exits in -side; all other skills exit/arc in +side
        side = type === 'elastico' ? (oppDot >= 0 ? 1 : -1) : (oppDot >= 0 ? -1 : 1);
      } else {
        side = rng() < 0.5 ? 1 : -1;
      }
    }

    let dur = 0.44;
    let actionName = 'stepover';
    let evadeDur = 0.55;
    if (type === 'roulette') {
      dur = 0.52;
      actionName = 'roulette';
      evadeDur = 0.68;
      if (near.opp && near.d < 2.9) {
        const oppFwd = ((near.opp.pos.x - p.pos.x) * dirX + (near.opp.pos.z - p.pos.z) * dirZ) / (near.d || 1);
        if (oppFwd > -0.35) {
          wrapOpp = near.opp;
          const oppLat = (near.opp.pos.x - p.pos.x) * rx + (near.opp.pos.z - p.pos.z) * rz;
          side = oppLat >= 0 ? -1 : 1;
        }
      }
    } else if (type === 'ballRoll') {
      dur = 0.36;
      actionName = side < 0 ? 'ball_roll_l' : 'ball_roll_r';
      evadeDur = 0.45;
    } else if (type === 'elastico') {
      dur = 0.42;
      actionName = side < 0 ? 'elastico_l' : 'elastico_r';
      evadeDur = 0.58;
    } else if (type === 'fakeShot') {
      dur = 0.38;
      actionName = side < 0 ? 'fake_shot_l' : 'fake_shot_r';
      evadeDur = 0.56;
    }

    skill = { player: p, type, t: 0, dur, side, dirX, dirZ, wrapOpp };
    skillCd = dur + 0.14;
    evadePlayer = p;
    evadeT = evadeDur;
    p.face(Math.atan2(dirZ, dirX));
    p.playAction(actionName);
    spendStamina(p, 0.022);
    triggerSkillDeception(p, type, side, dirX, dirZ, wrapOpp);
    return true;
  }

  function updateSkill(p, dt) {
    if (!skill || skill.player !== p) return false;
    skill.t += dt;
    if (skill.t >= skill.dur) {
      skill = null;
      return false;
    }
    const u = skill.t / skill.dur;
    const fx = skill.dirX, fz = skill.dirZ;
    const rx = -fz, rz = fx;
    let mx = fx, mz = fz, spd = 0.85;
    if (skill.type === 'stepover') {
      const lat = u < 0.45 ? skill.side * 0.45 : skill.side * 0.12;
      mx = fx + rx * lat;
      mz = fz + rz * lat;
      spd = u > 0.45 ? 1.0 : 0.72;
    } else if (skill.type === 'roulette') {
      const arc = skill.wrapOpp ? 0.72 : 0.34;
      const lat = skill.side * arc * Math.sin(u * Math.PI);
      mx = fx + rx * lat;
      mz = fz + rz * lat;
      spd = skill.wrapOpp ? 0.96 : 0.88;
    } else if (skill.type === 'ballRoll') {
      mx = fx * 0.45 + rx * skill.side * 0.90;
      mz = fz * 0.45 + rz * skill.side * 0.90;
      spd = 0.82;
    } else if (skill.type === 'elastico') {
      if (u < 0.24) {
        // Brief plant / shoulder dip while foot whips ball outside (+side)
        mx = fx * 0.95 + rx * skill.side * 0.14;
        mz = fz * 0.95 + rz * skill.side * 0.14;
        spd = 0.72;
      } else {
        // Explosive inside snap exit (-side)
        mx = fx * 0.78 - rx * skill.side * 0.65;
        mz = fz * 0.78 - rz * skill.side * 0.65;
        spd = 1.08;
      }
    } else if (skill.type === 'fakeShot') {
      if (u < 0.26) {
        mx = fx; mz = fz;
        spd = 0.32;
      } else {
        if (!skill.chopped) {
          skill.chopped = true;
          p.pushVel(fx * 2.8 + rx * skill.side * 4.8, fz * 2.8 + rz * skill.side * 4.8);
        }
        mx = fx * 0.45 + rx * skill.side * 0.89;
        mz = fz * 0.45 + rz * skill.side * 0.89;
        spd = 1.08;
      }
    }
    const ml = Math.hypot(mx, mz) || 1;
    const t = tgtOf(p).set(p.pos.x + (mx / ml) * 4, 0, p.pos.z + (mz / ml) * 4);
    p.moveTo(t, spd, { snappy: true });
    p.face(skill.type === 'fakeShot' && u >= 0.26 ? Math.atan2(mz, mx) : Math.atan2(fz, fx));
    return true;
  }

  function dribbleBall(p, dt) {
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (skill && skill.player === p) {
      const u = clamp(skill.t / skill.dur, 0, 1);
      const fx = skill.dirX, fz = skill.dirZ;
      const rx = -fz, rz = fx;
      let fwd = 0.44, lat = 0;
      if (skill.type === 'stepover') {
        fwd = 0.46 + (u > 0.65 ? (u - 0.65) * 0.75 : 0);
        lat = Math.sin(u * Math.PI * 2) * 0.18 * (1 - u) * skill.side;
      } else if (skill.type === 'roulette') {
        fwd = 0.40 - 0.36 * Math.sin(u * Math.PI) + (u > 0.7 ? (u - 0.7) * 0.6 : 0);
        lat = -skill.side * 0.34 * Math.sin(u * Math.PI);
      } else if (skill.type === 'ballRoll') {
        const s = Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5);
        fwd = 0.42 + 0.16 * u;
        lat = skill.side * (0.12 + 0.58 * s);
      } else if (skill.type === 'elastico') {
        if (u < 0.30) {
          const w = Math.sin((u / 0.30) * Math.PI * 0.5);
          fwd = 0.44 + 0.12 * w;
          lat = skill.side * 0.44 * w;
        } else {
          const w = (u - 0.30) / 0.70;
          fwd = 0.54 + 0.26 * w;
          lat = skill.side * (0.44 - 0.94 * w);
        }
      } else if (skill.type === 'fakeShot') {
        if (u < 0.28) {
          fwd = 0.42;
          lat = 0;
        } else {
          const w = (u - 0.28) / 0.72;
          fwd = 0.42 + 0.16 * w;
          lat = skill.side * 0.52 * w;
        }
      }
      const tx = p.pos.x + fx * fwd + rx * lat;
      const tz = p.pos.z + fz * fwd + rz * lat;
      ball.pos.x = THREE.MathUtils.damp(ball.pos.x, tx, 28, dt);
      ball.pos.z = THREE.MathUtils.damp(ball.pos.z, tz, 28, dt);
      ball.vel.x = p.vel.x;
      ball.vel.z = p.vel.z;
      return;
    }

    // While winding up a physical kick, keep ball inside natural strike-stride envelope so sprint kicks never whiff
    if (activeKick && activeKick.player === p) {
      const adx = activeKick.aimX - p.pos.x;
      const adz = activeKick.aimZ - p.pos.z;
      const adl = Math.hypot(adx, adz) || 1;
      const fx = adx / adl, fz = adz / adl;
      const strikeLead = clamp(0.44 + sp * 0.032, 0.44, 0.66);
      const sx = p.pos.x + fx * strikeLead;
      const sz = p.pos.z + fz * strikeLead;
      ball.pos.x = THREE.MathUtils.damp(ball.pos.x, sx, 22, dt);
      ball.pos.z = THREE.MathUtils.damp(ball.pos.z, sz, 22, dt);
      ball.vel.x = p.vel.x * 0.72;
      ball.vel.z = p.vel.z * 0.72;
      return;
    }

    const isUser = p === match.controlledPlayer && userT > 0 && userInput;
    const shielding = !!(isUser && userInput.modifier && !state.kickCharge.active && (!skill || skill.player !== p));
    const sprinting = !shielding && !!(isUser && userInput.sprint && p.stamina > 0.08);
    touchPhase += (sp * 2.0 + 1.1) * dt;
    let dx = Math.cos(p.facing), dz = Math.sin(p.facing);
    let cutting = false;
    let diagTurning = false;
    let turnAlign = 1;
    if (shielding) {
      // Tuck ball gently onto the safe side away from the nearest defender
      const near = nearestOpp(p);
      if (near.opp && near.d < 3.6) {
        const ax = p.pos.x - near.opp.pos.x, az = p.pos.z - near.opp.pos.z;
        const al = Math.hypot(ax, az) || 1;
        dx = ax / al; dz = az / al;
      }
    } else if (isUser) {
      const m = userInput.moveVec || { x: 0, z: 0 };
      const ml = Math.hypot(m.x, m.z);
      if (ml > 0.15) {
        const mx = m.x / ml, mz = m.z / ml;
        if (sp > 2.0) {
          turnAlign = (p.vel.x / sp) * mx + (p.vel.z / sp) * mz;
          cutting = turnAlign < 0.35;
          diagTurning = turnAlign < 0.80;
        }
        const prevLen = Math.hypot(prevMoveVec.x, prevMoveVec.z);
        if (prevLen > 0.15 && (prevMoveVec.x * mx + prevMoveVec.z * mz) < 0.82) {
          diagTurning = true;
        }
        prevMoveVec.x = mx;
        prevMoveVec.z = mz;
        dx = mx; dz = mz;
      }
    } else if (sp > 1.0) {
      dx = p.vel.x / sp;
      dz = p.vel.z / sp;
    }

    const drib01 = stat01(p, 'dribble');
    const pace = clamp(sp / 7.0, 0, 1);
    const suppressPush = shielding || cutting || diagTurning;
    const pushPulse = (sp > 0.7 && !suppressPush) ? (0.03 + 0.085 * pace) * Math.max(0, Math.sin(touchPhase)) : 0;
    const diagLead = lerp(0.32, 0.41, clamp((turnAlign - 0.10) / 0.70, 0, 1));
    const baseLead = (shielding ? 0.35 : (cutting ? 0.32 : (diagTurning ? diagLead : (0.37 + 0.18 * pace + pushPulse)))) * (1 - drib01 * 0.07);
    const tiredLoosen = p.stamina < 0.30 ? 1.08 : 1.0;
    const sprintMult = (sprinting ? (diagTurning ? 1.03 : 1.10) : 1.0) * tiredLoosen;
    const lead = baseLead * sprintMult;
    const trackRate = (shielding ? 23.0 : (diagTurning && sprinting ? 23.5 : (cutting ? 15.0 : (sprinting ? 16.5 : 18.5)))) * (1 + drib01 * 0.10);
    const tx = p.pos.x + dx * lead;
    const tz = p.pos.z + dz * lead;
    ball.pos.x = THREE.MathUtils.damp(ball.pos.x, tx, trackRate, dt);
    ball.pos.z = THREE.MathUtils.damp(ball.pos.z, tz, trackRate, dt);
    ball.vel.x = p.vel.x;
    ball.vel.z = p.vel.z;
  }

  function clampGkInBox(p) {
    const dir = dirFor(p.team);
    const minX = dir > 0 ? -HALF_X + 0.9 : HALF_X - PITCH.penAreaDepth + 0.9;
    const maxX = dir > 0 ? -HALF_X + PITCH.penAreaDepth - 0.9 : HALF_X - 0.9;
    p.pos.x = clamp(p.pos.x, minX, maxX);
    p.pos.z = clamp(p.pos.z, -PITCH.penAreaWidth / 2 + 1.0, PITCH.penAreaWidth / 2 - 1.0);
  }

  function updateGkBallCradle(p) {
    const hf = p.facing;
    const bob = Math.sin(gkHoldTimer * 4.5) * 0.012;
    let fwdOff = 0.34;
    let handY = 1.14 + bob;
    if (gkDist) {
      const u = clamp(gkDist.t / gkDist.releaseT, 0, 1);
      if (gkDist.mode === 'roll') { handY = lerp(1.14, 0.36, u); fwdOff = lerp(0.34, 0.48, u); }
      else if (gkDist.mode === 'throw') { handY = lerp(1.14, 1.68, u); fwdOff = lerp(0.34, 0.25, u); }
      else { handY = lerp(1.14, 0.72, u); fwdOff = lerp(0.34, 0.45, u); }
    }
    ball.pos.set(p.pos.x + Math.cos(hf) * fwdOff, handY, p.pos.z + Math.sin(hf) * fwdOff);
    ball.vel.set(p.vel.x, 0, p.vel.z);
  }

  function startGkDistribution(p, mode, power, isUser) {
    if (gkDist) return;
    const dir = dirFor(p.team);
    const oppSide = other(p.team);
    const pwr = clamp(power != null ? power : 0.6, 0.25, 1.0);
    let ax, az, target = null;

    if (isUser) {
      if (mode === 'punt') {
        const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
        const ml = Math.hypot(m.x, m.z);
        const dx = ml > 0.15 ? m.x / ml : dir;
        const dz = ml > 0.15 ? m.z / ml : 0;
        const range = lerp(28, 54, pwr);
        ax = clamp(p.pos.x + dx * range, -HALF_X + 2, HALF_X - 2);
        az = clamp(p.pos.z + dz * range, -HALF_Z + 2, HALF_Z - 2);
        let bd = 14;
        for (const m8 of squads[p.team].out) {
          if (!isActive(m8)) continue;
          const d = d2(m8.pos.x, m8.pos.z, ax, az);
          if (d < bd) { bd = d; target = m8; }
        }
      } else {
        const bp = userBestPass(p, pwr, false);
        target = bp.target;
        ax = bp.ax;
        az = bp.az;
      }
    } else {
      const pressDist = nearestOpp(p).d;
      let bs = -1e9;
      for (const m of squads[p.team].out) {
        if (!isActive(m)) continue;
        const candX = clamp(m.pos.x + m.vel.x * 0.45 + dir * 3.5, -HALF_X + 2, HALF_X - 2);
        const candZ = clamp(m.pos.z + m.vel.z * 0.45, -HALF_Z + 2, HALF_Z - 2);
        const d = d2(p.pos.x, p.pos.z, candX, candZ);
        if (d < 8 || d > 50) continue;
        let space = 20;
        for (const o of squads[oppSide].all) {
          if (isActive(o)) space = Math.min(space, d2(o.pos.x, o.pos.z, candX, candZ));
        }
        const prog = (candX - p.pos.x) * dir;
        const distPref = pressDist > 9 ? (d < 26 ? 0.9 : -0.25) : (prog > 18 ? 0.9 : 0);
        const s = prog * 0.04 + Math.min(space, 12) * 0.14 + distPref -
          laneBlockers(p.pos.x, p.pos.z, candX, candZ, oppSide, false) * 0.9;
        if (s > bs) { bs = s; target = m; ax = candX; az = candZ; }
      }
      if (!target) {
        ax = clamp(p.pos.x + dir * 36, -HALF_X + 2, HALF_X - 2);
        az = clamp((rng() - 0.5) * 14, -HALF_Z + 2, HALF_Z - 2);
        mode = 'punt';
      } else {
        const dist = d2(p.pos.x, p.pos.z, ax, az);
        const blk = laneBlockers(p.pos.x, p.pos.z, ax, az, oppSide, false);
        mode = (dist < 22 && blk === 0) ? 'roll' : (dist < 33 ? 'throw' : 'punt');
      }
    }

    const actName = mode === 'roll' ? 'gk_roll' : mode === 'throw' ? 'gk_throw' : 'gk_punt';
    const releaseT = mode === 'roll' ? 0.28 : mode === 'throw' ? 0.34 : 0.34;
    p.stop();
    p.face(Math.atan2(az - p.pos.z, ax - p.pos.x));
    p.playAction(actName);
    gkDist = { player: p, mode, ax, az, power: pwr, target, t: 0, releaseT };
  }

  function gkCarrier(p, dt) {
    const dir = dirFor(p.team);
    gkHoldTimer += dt;

    if (!p.holdingBall) {
      dribbleBall(p, dt);
      if (p === match.controlledPlayer && userT > 0) {
        userCarrier(p, dt);
        return;
      }
      settleT -= dt;
      if (settleT > 0.12) {
        p.stop();
        p.face(dir > 0 ? 0 : Math.PI);
        return;
      }
      decide(p);
      if (controller === p && !activeKick) {
        const clearZ = (p.pos.z >= 0 ? 1 : -1) * (6 + rng() * 6);
        TMP.set(dir * (18 + rng() * 5), 5.5 + rng() * 2, clearZ);
        kickBall(p, TMP, null, 'pass', 0.12);
      }
      return;
    }

    if (gkDist) {
      p.stop();
      p.face(Math.atan2(gkDist.az - p.pos.z, gkDist.ax - p.pos.x));
      clampGkInBox(p);
      gkDist.t += dt;
      updateGkBallCradle(p);
      if (gkDist.t < gkDist.releaseT) return;

      const gd = gkDist;
      gkDist = null;
      gkHoldTimer = 0;
      p.holdingBall = false;
      releaseBall();
      const hf = p.facing;
      const ry = gd.mode === 'roll' ? 0.26 : gd.mode === 'throw' ? 1.62 : 0.58;
      const rfwd = gd.mode === 'roll' ? 0.55 : gd.mode === 'throw' ? 0.42 : 0.52;
      ball.pos.set(p.pos.x + Math.cos(hf) * rfwd, ry, p.pos.z + Math.sin(hf) * rfwd);
      const dx = gd.ax - ball.pos.x, dz = gd.az - ball.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      let speed, vy, spin = undefined;
      if (gd.mode === 'roll') {
        speed = clamp(dist * 0.62 + 6.5, 10, 17.5);
        vy = 0.25;
      } else if (gd.mode === 'throw') {
        speed = clamp(dist * 0.54 + 8.0, 13, 21.5);
        const t = dist / speed;
        vy = clamp(4.905 * t * 0.56 + (0.2 - ry) / t, 1.4, 5.4);
      } else {
        speed = clamp(dist * 0.45 + lerp(8.5, 13.0, gd.power), 17, 28.5);
        const t = dist / speed;
        vy = clamp(4.905 * t * 0.90, 6.0, 12.2);
        spin = TMP2.set(0, (rng() - 0.5) * 4, 0);
      }
      TMP.set((dx / dist) * speed, vy, (dz / dist) * speed);
      ball.kick(TMP, spin);
      emit('kick', { kind: gd.mode === 'punt' ? 'punt' : 'pass', power: gd.power });
      lastKicker = p;
      lastTouchSide = p.team;
      lockPlayer = p;
      kickLock = 0.65;
      offsideWatch = null;
      recordPassAttempt(p, gd.target, dir);
      passTarget = gd.target || null;
      passT = 0;
      if (p.team === 'home' && !playerLock.enabled && gd.target && isActive(gd.target)) {
        match.controlledPlayer = gd.target;
        manualPick = null;
        manualT = 0;
        autoSwitchCd = 0.35;
      }
      return;
    }

    if (p.team === 'home' && userT > 0 && gkHoldTimer < 5.8 && userInput) {
      const m = userInput.moveVec || { x: 0, z: 0 };
      const ml = Math.hypot(m.x, m.z);
      if (ml > 0.15) {
        const dest = tgtOf(p).set(p.pos.x + (m.x / ml) * 2.5, 0, p.pos.z + (m.z / ml) * 2.5);
        p.moveTo(dest, 0.42, { snappy: true });
        p.face(Math.atan2(m.z, m.x));
      } else {
        p.stop();
        p.face(dir > 0 ? 0 : Math.PI);
      }
      clampGkInBox(p);
      updateGkBallCradle(p);

      const kc = state.kickCharge;
      const heldKind = userInput.holdShoot ? 'gk_punt'
        : (userInput.holdLob || userInput.holdThrough) ? 'gk_throw'
          : userInput.holdPass ? 'gk_roll' : null;
      const tapKind = userInput.shootPressed ? 'gk_punt'
        : (userInput.loftedPressed || userInput.throughPressed) ? 'gk_throw'
          : userInput.passPressed ? 'gk_roll' : null;

      if (!kc.active) {
        if (heldKind) {
          kc.active = true;
          kc.kind = heldKind;
          kc.value = 0.08;
          chargeHoldTime = 0;
        } else if (tapKind) {
          const mode = tapKind === 'gk_punt' ? 'punt' : tapKind === 'gk_throw' ? 'throw' : 'roll';
          kc.displayKind = tapKind;
          kc.displayValue = 0.55;
          kc.fadeT = 0.35;
          startGkDistribution(p, mode, 0.55, true);
          return;
        }
      } else {
        if (heldKind === kc.kind) {
          chargeHoldTime += dt;
          kc.value = clamp(chargeHoldTime / 0.58, 0.08, 1.0);
          if (chargeHoldTime >= 0.78) {
            const knd = kc.kind;
            const mode = knd === 'gk_punt' ? 'punt' : knd === 'gk_throw' ? 'throw' : 'roll';
            kc.active = false;
            kc.displayKind = knd;
            kc.displayValue = 1.0;
            kc.fadeT = 0.38;
            chargeHoldTime = 0;
            startGkDistribution(p, mode, 1.0, true);
            return;
          }
        } else {
          const knd = kc.kind;
          const pwr = clamp(0.28 + kc.value * 0.72, 0.28, 1.0);
          const mode = knd === 'gk_punt' ? 'punt' : knd === 'gk_throw' ? 'throw' : 'roll';
          kc.active = false;
          kc.displayKind = knd;
          kc.displayValue = pwr;
          kc.fadeT = 0.38;
          chargeHoldTime = 0;
          startGkDistribution(p, mode, pwr, true);
          return;
        }
      }
      return;
    }

    // AI GK distribution (or 5.8 s safety release / capture mode)
    p.face(dir > 0 ? 0 : Math.PI);
    const boxWalkX = clamp(-dir * (HALF_X - 12.0), -HALF_X + 2.5, HALF_X - 2.5);
    const boxWalkZ = clamp(p.pos.z * 0.65, -4.5, 4.5);
    const distBox = d2(p.pos.x, p.pos.z, boxWalkX, boxWalkZ);
    if (distBox > 0.6 && settleT > 0.35) {
      p.moveTo(tgtOf(p).set(boxWalkX, 0, boxWalkZ), 0.34);
    } else {
      p.stop();
    }
    clampGkInBox(p);
    updateGkBallCradle(p);
    settleT -= dt;
    if (settleT > 0 && gkHoldTimer < 5.8) return;
    startGkDistribution(p, 'throw', 0.65, false);
  }

  function carrierTick(p, dt) {
    if (p.role === 'GK') {
      if (playerLock.enabled && callForPassReq.active && p.team === 'home' && p.holdingBall && !gkDist) {
        const pro = findProPlayer();
        if (pro && isActive(pro)) {
          callForPassReq.active = false;
          const actName = 'gk_throw';
          p.stop();
          p.face(Math.atan2(pro.pos.z - p.pos.z, pro.pos.x - p.pos.x));
          p.playAction(actName);
          gkDist = { player: p, mode: 'throw', ax: pro.pos.x + pro.vel.x * 0.35, az: pro.pos.z + pro.vel.z * 0.35, power: 0.65, target: pro, t: 0, releaseT: 0.32 };
          return;
        }
      }
      gkCarrier(p, dt);
      return;
    }
    dribbleBall(p, dt);
    if (p === match.controlledPlayer && userT > 0) { userCarrier(p, dt); return; }
    if (activeKick && activeKick.player === p) return;
    if (playerLock.enabled && callForPassReq.active && p.team === 'home') {
      const pro = findProPlayer();
      if (pro && pro !== p && isActive(pro)) {
        callForPassReq.active = false;
        const ax = clamp(pro.pos.x + pro.vel.x * 0.42, -HALF_X + 1.5, HALF_X - 1.5);
        const az = clamp(pro.pos.z + pro.vel.z * 0.42, -HALF_Z + 1.5, HALF_Z - 1.5);
        doPass(p, pro, ax, az, callForPassReq.kind === 'lofted', 0.62, false);
        return;
      }
    }
    // Natural teammate vision pass to user Pro when open in space
    if (p.team === 'home' && !activeKick && settleT <= 0.12 && proPassCooldown <= 0) {
      const pro = playerLock.enabled ? findProPlayer() : (match.controlledPlayer && match.controlledPlayer.team === 'home' ? match.controlledPlayer : null);
      if (pro && pro !== p && isActive(pro)) {
        const pDist = d2(p.pos.x, p.pos.z, pro.pos.x, pro.pos.z);
        if (pDist >= 6.0 && pDist <= 34.0) {
          const dir = dirFor('home');
          const blockers = laneBlockers(p.pos.x, p.pos.z, pro.pos.x, pro.pos.z, other('home'), false);
          if (blockers === 0) {
            let proSpace = 25;
            for (const o of squads.away.all) {
              if (!isActive(o)) continue;
              const od = d2(o.pos.x, o.pos.z, pro.pos.x, pro.pos.z);
              if (od < proSpace) proSpace = od;
            }
            const proFwd = (pro.pos.x - p.pos.x) * dir;
            const proMovingFwd = pro.vel.x * dir > 1.3;
            if (proSpace >= 3.8 && (proFwd > -6.0 || proMovingFwd)) {
              proPassCooldown = 1.35;
              const isLead = proMovingFwd && proFwd > 1.5;
              const leadPwr = clamp(pDist / 22.0, 0.45, 0.85);
              if (isLead) {
                doThroughBall(p, false, leadPwr, false);
              } else {
                const ax = clamp(pro.pos.x + pro.vel.x * 0.38, -HALF_X + 1.5, HALF_X - 1.5);
                const az = clamp(pro.pos.z + pro.vel.z * 0.38, -HALF_Z + 1.5, HALF_Z - 1.5);
                doPass(p, pro, ax, az, false, leadPwr, false);
              }
              return;
            }
          }
        }
      }
    }
    settleT -= dt;
    decisionT -= dt;
    if (settleT > 0) {
      p.face(Math.atan2(-p.pos.z, dirFor(p.team) * HALF_X - p.pos.x));
      const t = tgtOf(p).set(
        p.pos.x + Math.cos(p.facing) * 1.2, 0, p.pos.z + Math.sin(p.facing) * 1.2);
      p.moveTo(t, 0.3);
      return;
    }
    dribbleMove(p);
    if (decisionT <= 0) {
      const prof = diffProfile();
      const tempoMult = teamTactics[p.team] ? teamTactics[p.team].tempoMult : 1.0;
      decisionT = (prof.aiDecMin + rng() * prof.aiDecVar) * tempoMult;
      decide(p);
    }
  }

  // ---- user control --------------------------------------------------------
  function pickControlled(dt) {
    autoSwitchCd = Math.max(0, autoSwitchCd - dt);
    manualT = Math.max(0, manualT - dt);

    if (playerLock.enabled) {
      const pro = findProPlayer();
      if (pro && isActive(pro)) {
        match.controlledPlayer = pro;
        manualT = 0;
        manualPick = null;
        return;
      }
    }

    const possNow = controller ? controller.team : 'loose';
    const possFlipped = possNow !== lastPossState;
    lastPossState = possNow;

    if (controller && controller === squads.home.gk && controller.holdingBall) {
      match.controlledPlayer = squads.home.gk;
      manualT = 0;
      manualPick = null;
      return;
    }

    if (state.phase === 'out' && restart && restart.kind === 'penalty' && restart.side === 'away') {
      match.controlledPlayer = squads.home.gk;
      return;
    }

    if (controller && controller.team === 'home' && controller.role !== 'GK' && isActive(controller)) {
      match.controlledPlayer = controller;
      manualT = 0;
      manualPick = null;
      return;
    }

    if (manualT > 0 && manualPick && isActive(manualPick)) {
      if (!(passTarget && passTarget.team === 'home' && passTarget.role !== 'GK' && !controller)) {
        match.controlledPlayer = manualPick;
        return;
      }
    }

    if (!controller && passTarget && passTarget.team === 'home' && passTarget.role !== 'GK' && isActive(passTarget)) {
      match.controlledPlayer = passTarget;
      return;
    }

    ctrlPickT -= dt;
    const cur = isActive(match.controlledPlayer) ? match.controlledPlayer : null;

    const bSp = ballSpeed();
    const bx = ball.pos.x + ball.vel.x * 0.26;
    const bz = ball.pos.z + ball.vel.z * 0.26;
    const defending = controller && controller.team === 'away';
    const incomingLoose = !controller && bSp > 2.5;
    const homeDir = dirFor('home');

    const scoreFor = (p) => {
      if (incomingLoose) {
        computePassMeetPoint(p, _meetTmp);
        const dMeet = Math.hypot(_meetTmp.x - p.pos.x, _meetTmp.z - p.pos.z);
        const dDirect = ballDist(p);
        let s = dMeet + _meetTmp.dPerp * 0.22 + dDirect * 0.14;
        if (_meetTmp.proj < -1.5) s += 2.2;
        if (p === lockPlayer && kickLock > 0) s += 8.5;
        return s;
      }
      let s = d2(p.pos.x, p.pos.z, bx, bz);
      if (defending && (p.pos.x - bx) * homeDir > 1.0) s += 2.8;
      return s;
    };

    let best = null, bestScore = 1e9;
    for (const p of squads.home.out) {
      if (!isActive(p)) continue;
      const s = scoreFor(p);
      if (s < bestScore) { bestScore = s; best = p; }
    }
    if (!best) return;

    if (!cur || possFlipped) {
      match.controlledPlayer = best;
      autoSwitchCd = 0.35;
      return;
    }

    if (cur !== best && (autoSwitchCd <= 0 || ctrlPickT <= 0)) {
      const curScore = scoreFor(cur);
      const margin = incomingLoose ? 1.35 : 1.8;
      if (bestScore + margin < curScore) {
        match.controlledPlayer = best;
        autoSwitchCd = incomingLoose ? 0.26 : 0.38;
        ctrlPickT = 0.22;
      }
    }
  }

  const _meetTmp = { x: 0, z: 0, dPerp: 99, proj: 0, ux: 1, uz: 0, sMax: 0, eta: 0 };
  function computePassMeetPoint(p, out = _meetTmp) {
    const vx = ball.vel.x, vz = ball.vel.z;
    const bv = Math.hypot(vx, vz);
    if (bv < 0.7) {
      out.x = clamp(ball.pos.x, -HALF_X + 0.8, HALF_X - 0.8);
      out.z = clamp(ball.pos.z, -HALF_Z + 0.8, HALF_Z - 0.8);
      out.dPerp = Math.hypot(out.x - p.pos.x, out.z - p.pos.z);
      out.proj = 0;
      out.ux = Math.cos(p.facing);
      out.uz = Math.sin(p.facing);
      out.sMax = 0;
      out.eta = out.dPerp / Math.max(4.5, p.maxSpeed || 6.6);
      return out;
    }
    const ux = vx / bv, uz = vz / bv;
    const rx = p.pos.x - ball.pos.x, rz = p.pos.z - ball.pos.z;
    const proj = rx * ux + rz * uz;
    const dPerp = Math.hypot(rx - ux * proj, rz - uz * proj);
    const isGround = ball.pos.y <= 0.35 && Math.abs(ball.vel.y) < 0.8;
    const sMax = isGround ? (bv * bv) / (2 * 3.2) : bv * 1.65;
    const pSpCap = Math.max(4.8, (p.maxSpeed || 6.6) * 0.92);
    const pFwd = p.vel.x * ux + p.vel.z * uz;

    // Lateral Magnus curl accel for airborne curved balls (matches ball.js MAGNUS_K = 0.0052)
    let magAx = 0, magAz = 0;
    if (!isGround && ball.spin && Math.abs(ball.spin.y) > 1.5) {
      magAx = ball.spin.y * vz * 0.0052;
      magAz = -ball.spin.y * vx * 0.0052;
      const mLen = Math.hypot(magAx, magAz);
      if (mLen > 12) { magAx *= 12 / mLen; magAz *= 12 / mLen; }
    }

    // Two-step trajectory intercept refinement factoring ground decel / bounce / curl / runner pace
    const maxAirHorizon = (!isGround && (ball.pos.y > 0.9 || ball.vel.y > 3.2)) ? 2.20 : 1.45;
    let tMeet;
    if (proj >= 0) {
      const tClose = dPerp / pSpCap;
      const relFwd = Math.max(2.2, bv - Math.max(0, pFwd) * 0.72);
      const tBallProj = proj / relFwd;
      if (pFwd > 1.2) {
        tMeet = clamp(Math.max(tBallProj, tClose * 0.88 + 0.08), 0.08, maxAirHorizon);
      } else {
        tMeet = clamp(Math.max(tBallProj * 0.90, Math.min(tBallProj, tClose * 0.92 + 0.08)), 0.06, maxAirHorizon);
      }
    } else {
      tMeet = clamp(d2(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z) / (bv + pSpCap), 0.08, 0.45);
    }

    let mx = ball.pos.x, mz = ball.pos.z;
    for (let iter = 0; iter < 2; iter++) {
      let sBall;
      if (isGround) {
        const tc = Math.min(tMeet, bv / 3.2);
        sBall = Math.min(sMax, bv * tc - 1.6 * tc * tc);
      } else {
        const tGround = ball.vel.y > -0.2
          ? (ball.vel.y + Math.sqrt(Math.max(0, ball.vel.y * ball.vel.y + 19.62 * Math.max(0, ball.pos.y - 0.11)))) / 9.81
          : 0.12;
        const airFrac = clamp(Math.min(tMeet, tGround), 0, tMeet);
        const dampAir = bv * (1 - Math.exp(-0.22 * tMeet)) / 0.22;
        sBall = Math.min(sMax, lerp(bv * tMeet * 0.90, dampAir, 0.5) + airFrac * 0.08);
      }
      if (proj >= 0 && sMax < proj) {
        sBall = Math.max(0.25, Math.min(sMax, proj * 0.94));
      } else if (proj >= 0 && pFwd > 1.2) {
        const fwdReach = Math.max(0.65, pFwd * tMeet * 0.85);
        sBall = clamp(sBall, Math.min(proj + 0.2, sMax), Math.min(sMax, proj + fwdReach));
      } else if (proj >= 0 && dPerp < 0.95 && proj > 1.0) {
        sBall = Math.max(0.25, Math.min(sBall, proj - Math.min(0.85, proj * 0.18)));
      } else if (proj >= 0) {
        sBall = clamp(sBall, Math.min(proj * 0.72, 0.35), Math.min(sMax, proj + 0.75));
      } else {
        sBall = clamp(bv * 0.15, 0.10, Math.min(1.75, sMax));
      }
      const curlShift = 0.5 * tMeet * tMeet * 0.82;
      mx = clamp(ball.pos.x + ux * sBall + magAx * curlShift, -HALF_X + 0.8, HALF_X - 0.8);
      mz = clamp(ball.pos.z + uz * sBall + magAz * curlShift, -HALF_Z + 0.8, HALF_Z - 0.8);
      if (iter === 0 && proj >= 0) {
        const dToMeet = d2(p.pos.x, p.pos.z, mx, mz);
        const tRun = dToMeet / pSpCap;
        tMeet = clamp(lerp(tMeet, Math.max(tMeet, tRun), 0.45), 0.06, maxAirHorizon);
      }
    }

    out.x = mx;
    out.z = mz;
    out.dPerp = dPerp;
    out.proj = proj;
    out.ux = ux;
    out.uz = uz;
    out.sMax = sMax;
    out.eta = tMeet;
    return out;
  }

  function isReceivingMode(p) {
    if (controller || !isActive(p)) return false;
    if (p === lockPlayer && kickLock > 0) return false;
    if (p === passTarget) return true;
    const bSp = ballSpeed();
    const d = ballDist(p);
    if (lastTouchSide === p.team && bSp > 1.3 && d < 16.0) return true;
    if (d < 13.5 && (magnetState.player === p || bSp <= 2.5)) return true;
    if (magnetState.player === p && magnetState.mode !== 'carrier' && magnetState.strength > 0.14 && d < 15.0) return true;
    return false;
  }

  function userMove(p, dt) {
    if (!userInput) {
      p.stop();
      return;
    }
    if (activeKick && activeKick.player === p) {
      if (!controller && ballDist(p) > 0.42) {
        p.moveTo(tgtOf(p).set(ball.pos.x, 0, ball.pos.z), 0.48, { snappy: true, ballClose: true });
      } else {
        const pSp = Math.hypot(p.vel.x, p.vel.z);
        if (pSp > 2.2) {
          p.moveTo(
            tgtOf(p).set(p.pos.x + Math.cos(p.facing) * 1.4, 0, p.pos.z + Math.sin(p.facing) * 1.4),
            0.22,
            { snappy: true, ballClose: true },
          );
        } else {
          p.stop();
        }
      }
      return;
    }
    const m = userInput.moveVec || { x: 0, z: 0 };
    const len = Math.hypot(m.x, m.z);
    const carrying = controller === p;
    const bDist = ballDist(p);
    const ballClose = carrying || bDist < 2.4;
    const shielding = carrying && !!(userInput && userInput.modifier && !state.kickCharge.active);
    state.shieldingActive = shielding;
    const sprinting = !shielding && !!(userInput && userInput.sprint && p.stamina > 0.08);
    const jockeying = !carrying && !!(userInput && userInput.modifier);
    const controlScale = (carrying && sprinting) ? (p.stamina < 0.30 ? 0.88 : 0.94) : 1.0;

    magnetState.player = null;
    magnetState.strength = 0;
    magnetState.mode = 'none';
    pursuitOverridden = false;

    // Auto-pursuit & closing assist: passes, loose/lost balls & rebounds, and opponent ball carriers
    const bSp = ballSpeed();
    const canPull = !carrying && !(p === lockPlayer && kickLock > 0);
    const isPassRecv = canPull && p === passTarget;
    let pullMode = 'none';
    let tx = ball.pos.x, tz = ball.pos.z;

    if (canPull && !controller) {
      if (isPassRecv) {
        computePassMeetPoint(p, _meetTmp);
        pullMode = 'pass';
        tx = _meetTmp.x;
        tz = _meetTmp.z;
      } else if (bSp > 1.3 && bDist < 18.0) {
        computePassMeetPoint(p, _meetTmp);
        const maxPerp = lastTouchSide === p.team ? 7.2 : 4.8;
        const maxDist = lastTouchSide === p.team ? 18.0 : 12.5;
        if (bDist < maxDist && _meetTmp.proj > -2.2 && _meetTmp.proj < 17.5 && _meetTmp.dPerp < maxPerp) {
          pullMode = 'pass';
          tx = _meetTmp.x;
          tz = _meetTmp.z;
        }
      }
      if (pullMode === 'none' && bDist < 18.0) {
        pullMode = 'loose';
        if (bSp > 0.7) {
          computePassMeetPoint(p, _meetTmp);
          tx = _meetTmp.x;
          tz = _meetTmp.z;
        } else {
          tx = clamp(ball.pos.x + ball.vel.x * 0.12, -HALF_X + 0.6, HALF_X - 0.6);
          tz = clamp(ball.pos.z + ball.vel.z * 0.12, -HALF_Z + 0.6, HALF_Z - 0.6);
        }
      }
    } else if (canPull && controller && controller.team !== p.team && !controller.holdingBall) {
      const opp = controller;
      const oppD = pdist(p, opp);
      if (oppD < 11.5 || bDist < 11.5) {
        pullMode = 'carrier';
        tx = clamp(lerp(ball.pos.x, opp.pos.x, 0.35) + opp.vel.x * 0.14, -HALF_X + 0.6, HALF_X - 0.6);
        tz = clamp(lerp(ball.pos.z, opp.pos.z, 0.35) + opp.vel.z * 0.14, -HALF_Z + 0.6, HALF_Z - 0.6);
      }
    }

    let mdx = 0, mdz = 0, md = 0, px = 0, pz = 0;
    if (pullMode !== 'none' && !jockeying) {
      mdx = tx - p.pos.x;
      mdz = tz - p.pos.z;
      md = Math.hypot(mdx, mdz);
      if (md > 0.04) { px = mdx / md; pz = mdz / md; }
    }

    if (len > 0.05) {
      const ux = m.x / len, uz = m.z / len;
      let dx = ux, dz = uz;
      let align = 1;
      let magnetW = 0;
      if (pullMode !== 'none' && !jockeying && md > 0.12) {
        align = ux * px + uz * pz;
        if (pullMode === 'pass') {
          const perpX = (ball.pos.x + _meetTmp.ux * _meetTmp.proj) - p.pos.x;
          const perpZ = (ball.pos.z + _meetTmp.uz * _meetTmp.proj) - p.pos.z;
          const perpLen = Math.hypot(perpX, perpZ);
          const lineDot = perpLen > 0.25 ? ((ux * perpX + uz * perpZ) / perpLen) : align;
          const inHandoffGrace = isPassRecv && passGrace.timer > 0 && passGrace.target === p;
          const steeringOpposite = !inHandoffGrace && (
            align <= -0.35 ||
            (perpLen > 0.5 && lineDot <= -0.45 && align < 0.05)
          );
          if (inHandoffGrace) {
            magnetW = 1.0;
          } else if (steeringOpposite) {
            magnetW = 0;
            pursuitOverridden = true;
          } else {
            const distNear = clamp(1 - bDist / 16.0, 0.35, 1.0);
            const baseW = isPassRecv ? (0.78 + distNear * 0.18) : (0.62 + distNear * 0.24);
            const dirScale = align < 0.0 ? lerp(0.55, 1.0, (align + 0.35) / 0.35) : 1.0;
            magnetW = baseW * dirScale * clamp((md - 0.08) / 0.35, 0.42, 1.0);
          }
        } else if (pullMode === 'loose') {
          if (align <= -0.35) {
            // Sharp directional turn away overrides loose-ball auto-sprint immediately
            magnetW = 0;
            pursuitOverridden = true;
          } else {
            const nearT = clamp(1 - bDist / 16.0, 0.32, 1.0);
            const coneT = align > 0.42
              ? clamp((align - 0.42) / 0.38, 0.72, 1.0)
              : lerp(0.42, 0.72, (align + 0.35) / 0.77);
            magnetW = clamp((0.68 + nearT * 0.26) * coneT * clamp((md - 0.08) / 0.32, 0.40, 1.0), 0.32, 0.96);
          }
        } else if (pullMode === 'carrier') {
          const pressingPass = !!userInput.pressAssist;
          if (pressingPass && align > -0.45) {
            const nearT = clamp(1 - md / 11.5, 0.30, 1.0);
            magnetW = (0.66 + nearT * 0.26) * clamp((md - 0.10) / 0.35, 0.35, 1.0);
          } else if (align > 0.25) {
            const coneT = clamp((align - 0.25) / 0.50, 0.48, 1.0);
            const nearT = clamp(1 - md / 10.5, 0.26, 1.0);
            magnetW = (0.44 + nearT * 0.28) * coneT * clamp((md - 0.10) / 0.38, 0.30, 1.0);
          }
        }

        if (magnetW > 0.02) {
          const bx = ux * (1 - magnetW) + px * magnetW;
          const bz = uz * (1 - magnetW) + pz * magnetW;
          const bl = Math.hypot(bx, bz);
          if (bl > 0.05) { dx = bx / bl; dz = bz / bl; }
          magnetState.player = p;
          magnetState.strength = magnetW;
          magnetState.mode = pullMode;
        }
      }
      const t = tgtOf(p).set(p.pos.x + dx * 4, 0, p.pos.z + dz * 4);
      const tilt = clamp(userInput.magnitude != null ? userInput.magnitude : 1, 0, 1);
      let speed = shielding
        ? clamp(0.28 + tilt * 0.28, 0.28, 0.56)
        : (jockeying
          ? clamp(0.32 + tilt * 0.30, 0.32, 0.62)
          : (sprinting ? (carrying ? 0.94 : 1.0) : clamp(0.30 + tilt * 0.52, 0.30, 0.82)));
      const autoSprintActive = !shielding && !jockeying && magnetW > 0.50 &&
        (pullMode === 'pass' || pullMode === 'loose' || (pullMode === 'carrier' && userInput.pressAssist));
      if (autoSprintActive) {
        speed = Math.max(speed, md > 1.6 ? 1.0 : 0.90);
      }
      p.moveTo(t, speed, { snappy: true, ballClose, jockey: jockeying, shield: shielding, controlScale });
      if (magnetW > 0.12 && md > 0.16 && (pullMode === 'pass' ? bDist < 12.0 : md < 11.5)) {
        // Trim sideways momentum drift so 8-way WASD / pursuit curves cleanly onto target
        const distFade = clamp((md - 0.12) / 0.75, 0.25, 1.0);
        const pullAccel = clamp(magnetW * 9.8, 1.6, 6.2) * distFade * dt;
        const curSp = Math.hypot(p.vel.x, p.vel.z);
        const maxCap = (p.maxSpeed || 6.6) * ((sprinting || autoSprintActive) ? 1.0 : 0.84);
        if (curSp > 0.5) {
          const vDot = p.vel.x * px + p.vel.z * pz;
          const perpVx = p.vel.x - px * vDot;
          const perpVz = p.vel.z - pz * vDot;
          const trim = (align > 0.15 || magnetW > 0.55) ? clamp(magnetW * 6.5 * dt, 0, 0.42) : 0;
          let nvx = p.vel.x - perpVx * trim + px * pullAccel;
          let nvz = p.vel.z - perpVz * trim + pz * pullAccel;
          const nLen = Math.hypot(nvx, nvz);
          if (nLen > maxCap) {
            nvx *= maxCap / nLen;
            nvz *= maxCap / nLen;
          }
          p.pushVel(nvx, nvz);
        }
      }
      if (jockeying) {
        p.face(controller ? controller.pos : ball.pos);
      } else if (shielding) {
        const near = nearestOpp(p);
        if (near.opp && near.d < 3.5) {
          p.face(Math.atan2(p.pos.z - near.opp.pos.z, p.pos.x - near.opp.pos.x));
        } else {
          p.face(Math.atan2(m.z, m.x));
        }
      } else if (pullMode !== 'none' && pullMode !== 'carrier' && bDist < 4.5 && magnetW > 0.12 &&
          (isPassRecv || (ball.pos.x - p.pos.x) * dx + (ball.pos.z - p.pos.z) * dz > -0.25 * bDist)) {
        // Open hips toward incoming pass / loose ball as it arrives for a clean front-foot trap
        p.face(ball.pos);
      } else {
        p.face(Math.atan2(dz, dx));
      }
    } else if ((pullMode === 'pass' || pullMode === 'loose') && !jockeying && md > 0.14) {
      // Idle keys: automatically sprint onto incoming pass or loose ball/rebound
      const autoSp = md > 1.6 ? 1.0 : clamp(md / 1.15, 0.52, 0.96);
      const t = tgtOf(p).set(tx, 0, tz);
      p.moveTo(t, autoSp, { snappy: true, ballClose });
      p.face(bDist < 4.5 ? ball.pos : t);
      magnetState.player = p;
      magnetState.strength = 0.88;
      magnetState.mode = pullMode;
    } else if (pullMode === 'carrier' && !jockeying && userInput.pressAssist && md > 0.25) {
      const t = tgtOf(p).set(tx, 0, tz);
      p.moveTo(t, 0.96, { snappy: true, ballClose });
      p.face(controller.pos);
      magnetState.player = p;
      magnetState.strength = 0.78;
      magnetState.mode = 'carrier';
    } else {
      p.stop();
      if (shielding) {
        const near = nearestOpp(p);
        if (near.opp && near.d < 4.0) p.face(Math.atan2(p.pos.z - near.opp.pos.z, p.pos.x - near.opp.pos.x));
      } else {
        p.face(controller && jockeying ? controller.pos : ball.pos);
      }
    }
  }

  function steerAroundBlockers(p, t) {
    const dx = t.x - p.pos.x, dz = t.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) return t;
    const ux = dx / dist, uz = dz / dist;
    const rx = -uz, rz = ux;
    const look = Math.min(3.5, dist + 0.4);
    let sidePush = 0;

    for (const side of ['home', 'away']) {
      for (const o of squads[side].out) {
        if (o === p || !isActive(o) || o === controller) continue;
        const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
        const fwd = ox * ux + oz * uz;
        if (fwd < -0.15 || fwd > look) continue;
        const lat = ox * rx + oz * rz;
        if (Math.abs(lat) >= 1.28) continue;
        const w = (1 - Math.max(0, fwd) / look) * ((1.28 - Math.abs(lat)) / 1.28);
        // Symmetric right-hand local pass rule on dead-center head-on meets breaks opponent lockouts cleanly
        const pushDir = Math.abs(lat) > 0.10 ? -Math.sign(lat) : (o.team !== p.team ? 1 : (p.id < o.id ? 1 : -1));
        sidePush += pushDir * w * 2.15;
      }
    }

    if (Math.abs(sidePush) > 0.08) {
      sidePush = clamp(sidePush, -2.6, 2.6);
      const step = Math.min(dist, 2.8);
      _avoidPos.set(
        clamp(p.pos.x + ux * step + rx * sidePush, -HALF_X + 1.0, HALF_X - 1.0),
        0,
        clamp(p.pos.z + uz * step + rz * sidePush, -HALF_Z + 1.0, HALF_Z - 1.0),
      );
      return _avoidPos;
    }
    return t;
  }

  function resolveShoulderJostles(dt) {
    for (const h of squads.home.out) {
      if (!isActive(h) || deceivedMap.has(h) || h.actionBusy()) continue;
      for (const a of squads.away.out) {
        if (!isActive(a) || deceivedMap.has(a) || a.actionBusy()) continue;
        const dx = a.pos.x - h.pos.x, dz = a.pos.z - h.pos.z;
        const dist = Math.hypot(dx, dz);
        const hCtrl = h === controller;
        const aCtrl = a === controller;
        const shieldH = hCtrl && state.shieldingActive;
        const jostleEnv = (shieldH ? 1.04 : ((hCtrl || aCtrl) ? 0.94 : 0.86));
        if (dist <= 0.04 || dist >= jostleEnv) continue;
        const nx = dx / dist, nz = dz / dist;
        const hStr = (h.mass || 74) * (0.65 + 0.35 * h.stamina) * (1 + stat01(h, 'phys') * 0.18) * (shieldH ? 1.48 : (hCtrl ? 1.12 : 1.0));
        const aStr = (a.mass || 74) * (0.65 + 0.35 * a.stamina) * (1 + stat01(a, 'phys') * 0.18) * (aCtrl ? 1.12 : 1.0);
        const tot = hStr + aStr;
        const hShare = shieldH ? 0.20 : (aStr / tot);
        const aShare = 1 - hShare;

        if (!hCtrl && !aCtrl && !shieldH) {
          // Non-carrier off-ball contact: resolve overlap and glide tangentially without wiping running stride
          const pen = (jostleEnv - dist) * 0.62;
          const tx = -nz, tz = nx;
          const rvx = a.vel.x - h.vel.x, rvz = a.vel.z - h.vel.z;
          const tangRel = rvx * tx + rvz * tz;
          const tangSign = Math.abs(tangRel) > 0.18 ? -Math.sign(tangRel) : (h.id < a.id ? 1 : -1);
          h.pos.x -= nx * pen * hShare - tx * tangSign * pen * 0.36;
          h.pos.z -= nz * pen * hShare - tz * tangSign * pen * 0.36;
          a.pos.x += nx * pen * aShare - tx * tangSign * pen * 0.36;
          a.pos.z += nz * pen * aShare - tz * tangSign * pen * 0.36;

          const vn = rvx * nx + rvz * nz;
          if (vn < 0) {
            h.vel.x += nx * vn * hShare * 0.92;
            h.vel.z += nz * vn * hShare * 0.92;
            a.vel.x -= nx * vn * aShare * 0.92;
            a.vel.z -= nz * vn * aShare * 0.92;
          }
          const slide = clamp(pen * 11 + 1.4, 1.2, 3.6) * dt * 11;
          h.vel.x += tx * tangSign * slide * hShare;
          h.vel.z += tz * tangSign * slide * hShare;
          a.vel.x -= tx * tangSign * slide * aShare;
          a.vel.z -= tz * tangSign * slide * aShare;
        } else {
          const pen = (jostleEnv - dist) * 0.48;
          h.pos.x -= nx * pen * hShare;
          h.pos.z -= nz * pen * hShare;
          a.pos.x += nx * pen * aShare;
          a.pos.z += nz * pen * aShare;
          const push = clamp(pen * 18, 0.4, 2.4) * dt * 10;
          if (shieldH) {
            a.pushVel(nx * push * 1.38, nz * push * 1.38);
          } else {
            h.pushVel(-nx * push * hShare, -nz * push * hShare);
            a.pushVel(nx * push * aShare, nz * push * aShare);
          }
        }
      }
    }
  }

  function tackleDirection(p) {
    if (controller && controller.team !== p.team && pdist(p, controller) < 3.6) {
      const dx = controller.pos.x - p.pos.x, dz = controller.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      return [dx / d, dz / d];
    }
    if (!controller && ballDist(p) < 3.6) {
      const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      return [dx / d, dz / d];
    }
    const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
    const ml = Math.hypot(m.x, m.z);
    if (ml > 0.15) return [m.x / ml, m.z / ml];
    return [Math.cos(p.facing), Math.sin(p.facing)];
  }

  function doStandTackle(p) {
    if (controller && controller.holdingBall) return false;
    const m = meta.get(p);
    if (!m || m.tackleCd > 0) return false;
    m.tackleCd = 0.85;
    spendStamina(p, 0.032);
    const [lx, lz] = tackleDirection(p);
    p.face(Math.atan2(lz, lx));
    p.pushVel(lx * 4.4, lz * 4.4);
    p.playAction('stand_tackle');
    emit('tackle', { isSlide: false, pos: { x: p.pos.x, z: p.pos.z }, vel: { x: p.vel.x, z: p.vel.z } });
    refSys.beginTackle(p, { isSlide: false, reach: 1.62, dur: 0.24, lx, lz, kickMin: 2.2, kickRange: 1.8 });
    return true;
  }

  function doSlideTackle(p) {
    if (controller && controller.holdingBall) return false;
    const m = meta.get(p);
    if (!m || m.tackleCd > 0) return false;
    m.tackleCd = 1.55;
    spendStamina(p, 0.052);
    const [lx, lz] = tackleDirection(p);
    const ang = Math.atan2(lz, lx);
    p.face(ang);
    p.pushVel(lx * 8.6, lz * 8.6);
    p.playAction('tackle');
    emit('tackle', { isSlide: true, pos: { x: p.pos.x, z: p.pos.z }, vel: { x: lx * 8.6, z: lz * 8.6 }, angle: ang });
    refSys.beginTackle(p, { isSlide: true, reach: 1.95, dur: 0.36, lx, lz, kickMin: 3.2, kickRange: 2.6 });
    return true;
  }

  function consumeBufferedCarrierKick() {
    if (preQueue.t > 0 && preQueue.kind) {
      const q = {
        kind: preQueue.kind,
        power: preQueue.power,
        mod: preQueue.mod,
        chip: preQueue.chip,
      };
      clearInputBuffers();
      return q;
    }
    const mod = inputBuf.mod;
    const chip = inputBuf.chip;
    if (inputBuf.shootT > 0) { clearInputBuffers(); return { kind: 'shoot', power: 0.36, mod, chip }; }
    if (inputBuf.loftedT > 0) { clearInputBuffers(); return { kind: 'lofted', power: 0.42, mod, chip }; }
    if (inputBuf.throughT > 0) { clearInputBuffers(); return { kind: 'through', power: 0.42, mod, chip }; }
    if (inputBuf.passT > 0) { clearInputBuffers(); return { kind: 'pass', power: 0.38, mod, chip }; }
    return null;
  }

  function resolveQueuedOneTouch(p) {
    if (p !== match.controlledPlayer || userT <= 0 || !userInput) return null;
    const isMod = !!(userInput.modifier || inputBuf.mod);
    const isChip = !!(userInput.chipMod || inputBuf.chip);
    const m = userInput.moveVec || { x: 0, z: 0 };
    const mLen = Math.hypot(m.x, m.z);
    const dirX = mLen > 0.15 ? m.x : inputBuf.aimX;
    const dirZ = mLen > 0.15 ? m.z : inputBuf.aimZ;
    if (preQueue.t > 0 && preQueue.kind) {
      const q = {
        kind: preQueue.kind,
        power: clamp(preQueue.power || 0.56, 0.32, 0.96),
        mod: preQueue.mod || isMod,
        chip: preQueue.chip || isChip,
        dirX: mLen > 0.15 ? m.x : preQueue.aimX,
        dirZ: mLen > 0.15 ? m.z : preQueue.aimZ,
      };
      clearInputBuffers();
      return q;
    }
    if (userInput.shootPressed || inputBuf.shootT > 0) {
      clearInputBuffers();
      return { kind: 'shoot', power: 0.62, mod: isMod, chip: isChip, dirX, dirZ };
    }
    if (userInput.loftedPressed || inputBuf.loftedT > 0) {
      clearInputBuffers();
      return { kind: 'lofted', power: 0.58, mod: isMod, chip: isChip, dirX, dirZ };
    }
    if (userInput.throughPressed || inputBuf.throughT > 0) {
      clearInputBuffers();
      return { kind: 'through', power: 0.58, mod: isMod, chip: isChip, dirX, dirZ };
    }
    if (userInput.passPressed || inputBuf.passT > 0) {
      clearInputBuffers();
      return { kind: 'pass', power: 0.54, mod: isMod, chip: isChip, dirX, dirZ };
    }
    return null;
  }

  function executeOneTouchGroundKick(p, q) {
    releaseBall();
    ball.vel.x = lerp(ball.vel.x * 0.25, p.vel.x, 0.45);
    ball.vel.z = lerp(ball.vel.z * 0.25, p.vel.z, 0.45);
    ball.vel.y = 0;
    const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
    const mLen = Math.hypot(m.x, m.z);
    const fx = mLen > 0.15 ? m.x / mLen : (Math.hypot(q.dirX, q.dirZ) > 0.15 ? q.dirX : Math.cos(p.facing));
    const fz = mLen > 0.15 ? m.z / mLen : (Math.hypot(q.dirX, q.dirZ) > 0.15 ? q.dirZ : Math.sin(p.facing));
    ball.pos.x = clamp(p.pos.x + fx * 0.42, -HALF_X + 0.5, HALF_X - 0.5);
    ball.pos.z = clamp(p.pos.z + fz * 0.42, -HALF_Z + 0.5, HALF_Z - 0.5);
    const kc = state.kickCharge;
    kc.active = false;
    kc.displayKind = q.kind;
    kc.displayValue = q.power;
    kc.timed = null;
    kc.fadeT = 0.35;
    if (q.kind === 'shoot') {
      doShoot(p, q.power, q.chip ? 'chip' : (q.mod ? 'finesse' : 'normal'), null);
    } else if (q.kind === 'through') {
      doThroughBall(p, false, q.power, q.mod);
    } else if (q.kind === 'lofted') {
      doThroughBall(p, true, q.power, q.mod);
    } else {
      const bp = userBestPass(p, q.power, false);
      doPass(p, bp.target, bp.ax, bp.az, false, q.power, q.mod);
    }
    if (activeKick && activeKick.player === p) activeKick.impactT = Math.min(activeKick.impactT, 0.045);
  }

  function userDefend(p, dt) {
    if (!userInput) return;
    if (userInput.standTacklePressed) { clearInputBuffers(); doStandTackle(p); return; }
    if (userInput.slideTacklePressed) { clearInputBuffers(); doSlideTackle(p); return; }
    const lockedSelf = p === lockPlayer && kickLock > 0;
    const receiving = isReceivingMode(p);
    const bDist = ballDist(p);

    // Near a loose low ball within direct foot strike reach: immediate one-touch strike!
    if (!controller && !lockedSelf && bDist < 1.85 && ball.pos.y <= 1.38) {
      if (userInput.shootPressed) {
        clearInputBuffers();
        doShoot(p, 0.62, userInput.chipMod ? 'chip' : (userInput.modifier ? 'finesse' : 'normal'));
        if (activeKick && activeKick.player === p) activeKick.impactT = Math.min(activeKick.impactT, 0.055);
        return;
      }
      if (userInput.loftedPressed) {
        clearInputBuffers();
        doThroughBall(p, true, 0.58, !!userInput.modifier);
        if (activeKick && activeKick.player === p) activeKick.impactT = Math.min(activeKick.impactT, 0.05);
        return;
      }
      if (userInput.throughPressed) {
        clearInputBuffers();
        doThroughBall(p, false, 0.58, !!userInput.modifier);
        if (activeKick && activeKick.player === p) activeKick.impactT = Math.min(activeKick.impactT, 0.05);
        return;
      }
      if (userInput.passPressed) {
        clearInputBuffers();
        const bp = userBestPass(p, 0.55, false);
        doPass(p, bp.target, bp.ax, bp.az, false, 0.55, !!userInput.modifier);
        if (activeKick && activeKick.player === p) activeKick.impactT = Math.min(activeKick.impactT, 0.05);
        return;
      }
    }

    // While waiting on an incoming pass, recovering from own touch/kick, or approaching any unowned
    // loose/lost ball, preserve pre-arrival one-touch buffers instead of wiping them with empty tackles.
    if (receiving || lockedSelf) return;
    if (!controller) {
      if (bDist < 14.0 || (magnetState.player === p && magnetState.mode !== 'carrier')) return;
      let oppNearBall = 99;
      for (const o of squads[other(p.team)].all) {
        if (!isActive(o)) continue;
        const od = ballDist(o);
        if (od < oppNearBall) oppNearBall = od;
      }
      if (lastTouchSide === p.team || oppNearBall > 1.8) return;
    }

    if (userInput.passPressed) {
      clearInputBuffers();
      if (!controller || pdist(p, controller) <= 2.6 || bDist <= 2.4) {
        doStandTackle(p);
      }
    }
    if (userInput.shootPressed) {
      clearInputBuffers();
      if (!controller && ball.pos.y > 0.95 && bDist < 3.4) return;
      doSlideTackle(p);
    }
  }

  function executeChargedKick(p, kind, power, timed = null, modOverride = false, chipOverride = false) {
    skill = null;
    clearInputBuffers();
    const isMod = !!(modOverride || (userInput && userInput.modifier));
    const isChip = !!(chipOverride || (userInput && userInput.chipMod));
    if (kind === 'shoot') {
      const style = isChip ? 'chip' : (isMod ? 'finesse' : 'normal');
      doShoot(p, power, style, timed);
      return;
    }
    if (kind === 'through') { doThroughBall(p, false, power, isMod); return; }
    if (kind === 'lofted') { doThroughBall(p, true, power, isMod); return; }
    const bp = userBestPass(p, power, false);
    doPass(p, bp.target, bp.ax, bp.az, false, power, isMod);
  }

  function userCarrier(p, dt) {
    if (!userInput) return;
    if (!updateSkill(p, dt)) {
      userMove(p, dt);
    }

    const kc = state.kickCharge;
    // Shoot -> Pass Fake Shot cancel (during charge OR during shot kick windup)
    if ((userInput.passPressed || userInput.holdPass) &&
        ((kc.active && kc.kind === 'shoot') || (activeKick && activeKick.player === p && activeKick.kind === 'shoot'))) {
      const kAim = (activeKick && activeKick.player === p && activeKick.kind === 'shoot')
        ? { shotAimX: activeKick.aimX, shotAimZ: activeKick.aimZ }
        : null;
      kc.active = false;
      kc.fadeT = 0;
      kc.timed = null;
      chargeHoldTime = 0;
      activeKick = null;
      fakeShotConsumeT = 0.24;
      clearInputBuffers();
      startSkill(p, 'fakeShot', kAim);
      return;
    }
    if (fakeShotConsumeT > 0) return;
    // Keep any post-kick buffered inputs intact during windup rather than discarding them
    if (activeKick && activeKick.player === p) return;

    const heldKind = userInput.holdShoot ? 'shoot'
      : userInput.holdLob ? 'lofted'
        : userInput.holdThrough ? 'through'
          : userInput.holdPass ? 'pass' : null;
    const tapKind = userInput.shootPressed ? 'shoot'
      : userInput.loftedPressed ? 'lofted'
        : userInput.throughPressed ? 'through'
          : userInput.passPressed ? 'pass' : null;

    if (!kc.active) {
      if (heldKind) {
        clearInputBuffers();
        kc.active = true;
        kc.kind = heldKind;
        kc.value = 0.08;
        kc.timed = null;
        chargeHoldTime = 0;
      } else if (tapKind) {
        const pwr = 0.34;
        kc.displayKind = tapKind;
        kc.displayValue = pwr;
        kc.timed = null;
        kc.fadeT = 0.35;
        executeChargedKick(p, tapKind, pwr, null);
        return;
      } else {
        const buffered = consumeBufferedCarrierKick();
        if (buffered) {
          kc.displayKind = buffered.kind;
          kc.displayValue = buffered.power;
          kc.timed = null;
          kc.fadeT = 0.35;
          executeChargedKick(p, buffered.kind, buffered.power, null, buffered.mod, buffered.chip);
          return;
        }
      }
    } else {
      if (heldKind === kc.kind) {
        chargeHoldTime += dt;
        kc.value = clamp(chargeHoldTime / 0.58, 0.08, 1.0);
        if (kc.kind === 'shoot') {
          kc.timed = (kc.value >= 0.58 && kc.value <= 0.78) ? 'green' : (kc.value > 0.90 ? 'late' : null);
        } else {
          kc.timed = null;
        }
        if (chargeHoldTime >= 0.78) {
          const kind = kc.kind;
          const timed = kc.kind === 'shoot' ? 'late' : null;
          kc.active = false;
          kc.displayKind = kind;
          kc.displayValue = 1.0;
          kc.timed = timed;
          kc.fadeT = 0.38;
          chargeHoldTime = 0;
          executeChargedKick(p, kind, 1.0, timed);
          return;
        }
      } else {
        const kind = kc.kind;
        const pwr = clamp(0.28 + kc.value * 0.72, 0.28, 1.0);
        const timed = kind === 'shoot' ? kc.timed : null;
        kc.active = false;
        kc.displayKind = kind;
        kc.displayValue = pwr;
        kc.timed = timed;
        kc.fadeT = 0.42;
        chargeHoldTime = 0;
        executeChargedKick(p, kind, pwr, timed);
        return;
      }
    }

    if (!kc.active) {
      if (userInput.skillStepoverPressed) { startSkill(p, 'stepover'); return; }
      if (userInput.skillRoulettePressed) { startSkill(p, 'roulette'); return; }
      if (userInput.skillElasticoPressed) { startSkill(p, 'elastico'); return; }
      if (userInput.skillBallRollPressed) { startSkill(p, 'ballRoll'); return; }
    }
  }

  function doThroughBall(p, lofted, power, isGiveAndGo) {
    const side = p.team, dir = dirFor(side);
    const oppSide = other(side);
    const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
    const aimLen = Math.hypot(m.x, m.z);
    const axDir = aimLen > 0.15 ? m.x / aimLen : Math.cos(p.facing);
    const azDir = aimLen > 0.15 ? m.z / aimLen : Math.sin(p.facing);
    const pwr = power != null ? clamp(power, 0.25, 1.0) : 0.65;
    const isWideCross = lofted && Math.abs(p.pos.z) > 12.5 && p.pos.x * dir > 14;

    // Locate deepest opponent outfielder (offside reference) so through balls lead cleanly into space
    let oppLine2nd = dir * HALF_X;
    {
      let deep1 = -1e9, deep2 = -1e9;
      for (const o of squads[oppSide].all) {
        if (!isActive(o)) continue;
        const ox = o.pos.x * dir;
        if (ox > deep1) { deep2 = deep1; deep1 = ox; }
        else if (ox > deep2) { deep2 = ox; }
      }
      if (deep2 > -1e8) oppLine2nd = deep2;
    }

    let best = null, bestScore = -1e9, bx = 0, bz = 0;
    for (const t of squads[side].all) {
      if (!isActive(t) || t === p || t.role === 'GK') continue;
      const tSp = Math.hypot(t.vel.x, t.vel.z);
      const isUnderRun = attackingRuns.has(t);
      const runnerFwd = Math.max(0, (t.vel.x * dir) + (t.vel.z * Math.sign(azDir)) * 0.25);
      const estFlightT = clamp(d2(p.pos.x, p.pos.z, t.pos.x, t.pos.z) / 17.0, 0.35, 1.35);
      const dynamicLead = (lofted ? 5.2 : 3.8) + runnerFwd * estFlightT * 1.15 + (isUnderRun ? 2.5 : 0) + lerp(0, 3.2, pwr);
      const leadDist = clamp(dynamicLead, 4.0, 11.2);
      const runDirX = tSp > 1.0 ? (t.vel.x / tSp) : (dir * 0.85 + axDir * 0.15);
      const runDirZ = tSp > 1.0 ? (t.vel.z / tSp) : (azDir * 0.45);
      const corrX = runDirX * 0.58 + dir * 0.30 + axDir * 0.22;
      const corrZ = runDirZ * 0.62 + azDir * 0.38;
      const corrLen = Math.hypot(corrX, corrZ) || 1;
      let ax = t.pos.x + (corrX / corrLen) * leadDist;
      const sweepThreshold = dir * (HALF_X - 12.8);
      if (t.pos.x * dir < HALF_X - 15.0 && ax * dir > HALF_X - 12.8) {
        ax = sweepThreshold;
      }
      ax = clamp(ax, -HALF_X + 1.5, HALF_X - 1.5);
      const az = clamp(t.pos.z + (corrZ / corrLen) * leadDist * 0.72, -HALF_Z + 1.5, HALF_Z - 1.5);
      const d = d2(p.pos.x, p.pos.z, ax, az);
      if (d < 4.5 || d > 56) continue;
      const tx = (ax - p.pos.x) / d, tz = (az - p.pos.z) / d;
      const dot = tx * axDir + tz * azDir;
      if (dot < -0.05) continue;

      let score = dot * 6.0 + ((ax - p.pos.x) * dir) * 0.045;
      if (t.vel.x * dir > 1.2 || isUnderRun) score += 0.85;
      if (isWideCross && ax * dir > 30 && Math.abs(az) < 15) score += 2.6;
      let space = 25;
      for (const o of squads[oppSide].all) {
        if (!isActive(o)) continue;
        const od = d2(o.pos.x, o.pos.z, ax, az);
        if (od < space) space = od;
      }
      score += Math.min(space, 14) * 0.10;
      if (t.pos.x * dir > oppLine2nd + 0.35 && t.pos.x * dir > p.pos.x * dir + 0.35 && t.pos.x * dir > 0.2) {
        score -= 1.8; // Prefer onside runners over offside traps
      }
      score -= laneBlockers(p.pos.x, p.pos.z, ax, az, oppSide, false) * (lofted ? 0.22 : 0.65);
      if (score > bestScore) { bestScore = score; best = t; bx = ax; bz = az; }
    }

    // Open-space corridor fallback: thread ball into forward space along user aim for best runner
    if (!best) {
      const corridorDist = (lofted ? 22 : 17) * lerp(0.75, 1.35, pwr);
      const spaceX = clamp(p.pos.x + axDir * corridorDist, -HALF_X + 1.5, HALF_X - 1.5);
      const spaceZ = clamp(p.pos.z + azDir * corridorDist, -HALF_Z + 1.5, HALF_Z - 1.5);
      let bestRunner = null, bestRd = 28;
      for (const t of squads[side].out) {
        if (!isActive(t) || t === p) continue;
        const rd = d2(t.pos.x, t.pos.z, spaceX, spaceZ);
        if (rd < bestRd) { bestRd = rd; bestRunner = t; }
      }
      if (bestRunner && (spaceX - p.pos.x) * axDir + (spaceZ - p.pos.z) * azDir > 2.5) {
        best = bestRunner;
        bx = clamp(lerp(spaceX, bestRunner.pos.x + dir * 6.5, 0.28), -HALF_X + 1.5, HALF_X - 1.5);
        bz = clamp(lerp(spaceZ, bestRunner.pos.z, 0.28), -HALF_Z + 1.5, HALF_Z - 1.5);
      } else {
        const bp = userBestPass(p, pwr, isWideCross);
        doPass(p, bp.target, bp.ax, bp.az, lofted, pwr, isGiveAndGo);
        return;
      }
    }

    let aimX = bx, aimZ = bz, speed, vy, spinY = 0;
    if (isWideCross) {
      const c = buildCrossDelivery(p, best, bx, bz, pwr);
      aimX = c.aimX;
      aimZ = c.aimZ;
      speed = c.speed;
      vy = c.vy;
      spinY = c.spinY;
    } else {
      const dx = bx - ball.pos.x, dz = bz - ball.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const pass01 = stat01(p, 'pass');
      if (!p.star && dist > 12) {
        const oppClose = nearestOpp(p).d < 2.4 ? 1.35 : 1.0;
        const errSpan = clamp((dist - 12) / 30, 0, 1) * clamp(0.70 - pass01 * 0.52, 0.12, 1.30) * oppClose;
        aimX = clamp(aimX + (rng() - 0.5) * errSpan, -HALF_X + 1.0, HALF_X - 1.0);
        aimZ = clamp(aimZ + (rng() - 0.5) * errSpan, -HALF_Z + 1.0, HALF_Z - 1.0);
      }
      speed = lofted
        ? clamp(lerp(11.2, 19.8, pwr) + dist * 0.12, 11.4, 21.0)
        : clamp(lerp(10.6, 19.2, pwr) + dist * 0.13, 10.8, 20.8);
      const t = dist / speed;
      vy = lofted ? 4.905 * t * lerp(0.92, 1.28, pwr) : (dist > 22 ? clamp(4.905 * t * 0.30, 0.35, 2.8) : 0.15);
    }

    const wasUser = p === match.controlledPlayer;
    passTarget = best;
    passT = 0;
    snapshotOffside(p, side);
    if (isGiveAndGo) oneTwoMap.set(p, 2.8);
    schedulePhysicalKick(p, {
      kind: lofted ? 'lofted' : 'through',
      power: pwr,
      aimX,
      aimZ,
      aimY: 0.2,
      target: best,
      spinY,
      speedOverride: speed,
      vyOverride: vy,
      action: 'pass',
      impactT: lofted ? 0.13 : 0.11,
      forceAction: wasUser,
      after: () => {
        recordPassAttempt(p, best, dir);
        passTarget = best;
        passT = 0;
        if (wasUser && !playerLock.enabled && best.team === 'home' && best.role !== 'GK' && isActive(best)) {
          match.controlledPlayer = best;
          manualPick = null;
          manualT = 0;
          autoSwitchCd = 0.25;
          armPassGrace(best);
        }
      },
    });
  }

  function switchControlled() {
    if (playerLock.enabled) return;
    const cur = match.controlledPlayer;
    if (cur && isActive(cur)) switchSkip.set(cur, 0.95);
    const bx = ball.pos.x + ball.vel.x * 0.26;
    const bz = ball.pos.z + ball.vel.z * 0.26;
    const homeDir = dirFor('home');
    const defending = controller && controller.team === 'away';
    const incomingLoose = !controller && ballSpeed() > 2.2;
    const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
    const mLen = Math.hypot(m.x, m.z);
    const mx = mLen > 0.15 ? m.x / mLen : 0;
    const mz = mLen > 0.15 ? m.z / mLen : 0;

    const scoreCand = (p, allowSkip) => {
      if (!isActive(p) || p === cur) return 1e9;
      if (allowSkip && switchSkip.has(p)) return 1e9;
      let s;
      if (incomingLoose) {
        computePassMeetPoint(p, _meetTmp);
        s = Math.hypot(_meetTmp.x - p.pos.x, _meetTmp.z - p.pos.z) + _meetTmp.dPerp * 0.25;
      } else {
        s = d2(p.pos.x, p.pos.z, bx, bz);
      }
      if (defending) {
        const wrongSide = (p.pos.x - bx) * homeDir > 0.8;
        s += wrongSide ? 3.5 : -1.6;
        s += Math.abs(p.pos.z - bz * 0.72) * 0.12;
      }
      if (mLen > 0.15 && cur) {
        const dx = p.pos.x - cur.pos.x, dz = p.pos.z - cur.pos.z;
        const dl = Math.hypot(dx, dz) || 1;
        s -= ((dx / dl) * mx + (dz / dl) * mz) * 2.2;
      }
      return s;
    };

    let best = null, bestS = 1e9;
    for (const p of squads.home.out) {
      const s = scoreCand(p, true);
      if (s < bestS) { bestS = s; best = p; }
    }
    if (!best) {
      switchSkip.clear();
      for (const p of squads.home.out) {
        const s = scoreCand(p, false);
        if (s < bestS) { bestS = s; best = p; }
      }
    }
    if (!best) return;
    match.controlledPlayer = best;
    manualPick = best;
    manualT = 1.6;
    ctrlPickT = 0.4;
    autoSwitchCd = 0.4;
  }

  // ---- off-ball movement & compact defending -------------------------------
  function offBall(dt) {
    const lx = ball.pos.x + ball.vel.x * 0.4;
    const lz = ball.pos.z + ball.vel.z * 0.4;
    const secondPressActive = !!(userT > 0 && userInput && userInput.pressAssist &&
      (!controller || controller.team !== 'home'));
    const gkRushActive = !!(userT > 0 && userInput && userInput.gkRush &&
      (!controller || controller.team !== 'home'));

    // Determine optional 2nd-man presser for home when defending
    let secondPresser = null;
    if (secondPressActive) {
      let bd = 1e9;
      const targetPos = controller ? controller.pos : ball.pos;
      for (const p of squads.home.out) {
        if (!isActive(p) || p === match.controlledPlayer) continue;
        const d = d2(p.pos.x, p.pos.z, targetPos.x, targetPos.z);
        if (d < bd) { bd = d; secondPresser = p; }
      }
    }

    for (const side of ['home', 'away']) {
      const sq = squads[side];
      const oppSide = other(side);
      const dir = dirFor(side);
      const gxOwn = -dir * HALF_X;
      const oppHasBall = controller && controller.team !== side;
      const loose = !controller && state.phase === 'play';
      let p1 = null, p2 = null, d1 = 1e9, d2v = 1e9;
      for (const p of sq.out) {
        if (!isActive(p)) continue;
        if (loose && side === 'home' && userT > 0 && p === match.controlledPlayer && pursuitOverridden) continue;
        const d = d2(p.pos.x, p.pos.z, lx, lz);
        if (d < d1) { p2 = p1; d2v = d1; p1 = p; d1 = d; }
        else if (d < d2v) { p2 = p; d2v = d; }
      }

      // Assign free defenders/DMs to mark dangerous opposing off-ball runners goal-side
      markAssign.clear();
      if (oppHasBall) {
        oppRunnersTmp.length = 0;
        freeDefsTmp.length = 0;
        for (const o of squads[oppSide].out) {
          if (!isActive(o) || o === controller || o === passTarget) continue;
          const ox = o.pos.x * dir;
          const sprintingIn = o.vel.x * dir < -1.8;
          if (ox < 14 || sprintingIn) oppRunnersTmp.push(o);
        }
        oppRunnersTmp.sort((a, b) => (a.pos.x * dir) - (b.pos.x * dir));
        for (let di = 0; di < Math.min(6, sq.out.length); di++) {
          const dp = sq.out[di];
          if (!isActive(dp) || dp === p1 || dp === p2 || dp === secondPresser) continue;
          if (dp === match.controlledPlayer && userT > 0) continue;
          if (deceivedMap.has(dp)) continue;
          freeDefsTmp.push(dp);
        }
        const maxPairs = Math.min(3, oppRunnersTmp.length, freeDefsTmp.length);
        for (let r = 0; r < maxPairs; r++) {
          const runner = oppRunnersTmp[r];
          let bestIdx = -1, bestD = 11.5;
          for (let j = 0; j < freeDefsTmp.length; j++) {
            const cand = freeDefsTmp[j];
            if (!cand) continue;
            const d = pdist(cand, runner);
            if (d < bestD) { bestD = d; bestIdx = j; }
          }
          if (bestIdx >= 0) {
            markAssign.set(freeDefsTmp[bestIdx], runner);
            freeDefsTmp[bestIdx] = null;
          }
        }
      }

      for (let i = 0; i < sq.out.length; i++) {
        const p = sq.out[i];
        if (!isActive(p)) { p.stop(); continue; }
        if (p === controller) continue;
        if (p === match.controlledPlayer && userT > 0) {
          userMove(p, dt); userDefend(p, dt); continue;
        }
        if (p === passTarget) {
          computePassMeetPoint(p, _meetTmp);
          p.moveTo(steerAroundBlockers(p, tgtOf(p).set(_meetTmp.x, 0, _meetTmp.z)), 1);
          p.face(ball.pos);
          continue;
        }
        if (restart && p === restart.taker) continue;

        // Deceived defender stunned, sliding past fake shot, or wrapped by roulette
        const dec = deceivedMap.get(p);
        if (dec) {
          if (dec.mode === 'wrong_way') {
            const t = tgtOf(p).set(p.pos.x + dec.vx * 0.6, 0, p.pos.z + dec.vz * 0.6);
            p.moveTo(t, 0.55, { snappy: true });
          } else if (dec.mode === 'wrapped') {
            p.stop();
          }
          p.face(dec.faceAng);
          continue;
        }

        // 1-2 Give-and-go forward sprint
        if (oneTwoMap.has(p) && state.possession === side) {
          const runT = tgtOf(p).set(clamp(p.pos.x + dir * 9, -HALF_X + 3, HALF_X - 3), 0, p.pos.z);
          p.moveTo(steerAroundBlockers(p, runT), 0.98);
          p.face(runT);
          continue;
        }

        // Active forward attacking channel run (manual trigger or auto penetrating run)
        if (attackingRuns.has(p) && state.possession === side) {
          const run = attackingRuns.get(p);
          const runT = tgtOf(p).set(run.targetX, 0, run.targetZ);
          p.moveTo(steerAroundBlockers(p, runT), 1.0, { sprint: true });
          p.face(runT);
          continue;
        }

        // User-commanded 2nd-man press (never press into a holding goalkeeper)
        if (p === secondPresser && !(controller && controller.holdingBall)) {
          const tx = controller ? controller.pos.x - dir * 0.7 : lx;
          const tz = controller ? controller.pos.z : lz;
          const t = tgtOf(p).set(tx, 0, tz);
          p.moveTo(t, 0.98);
          p.face(ball.pos);
          tryTackle(p, dt);
          continue;
        }

        // Primary presser / loose-ball chaser
        if ((oppHasBall || loose) && p === p1) {
          if (controller && controller.role === 'GK' && controller.holdingBall) {
            const dx = p.pos.x - controller.pos.x, dz = p.pos.z - controller.pos.z;
            const dl = Math.hypot(dx, dz) || 1;
            if (dl < 5.5) {
              const t = tgtOf(p).set(controller.pos.x + (dx / dl) * 5.8, 0, controller.pos.z + (dz / dl) * 5.8);
              p.moveTo(t, 0.65);
            } else {
              p.stop();
            }
            p.face(ball.pos);
            continue;
          }
          if (loose || !controller) {
            if (ballSpeed() > 1.2) {
              computePassMeetPoint(p, _meetTmp);
              p.moveTo(tgtOf(p).set(_meetTmp.x, 0, _meetTmp.z), 1);
            } else {
              const t = tgtOf(p).set(lx, 0, lz);
              p.moveTo(t, 1);
            }
            p.face(ball.pos);
            continue;
          }
          // Goal-side jockey containment on ball carrier
          const dxG = controller.pos.x - gxOwn;
          const dzG = controller.pos.z;
          const lenG = Math.hypot(dxG, dzG) || 1;
          const jockDist = 1.82;
          const jx = clamp(controller.pos.x - (dxG / lenG) * jockDist, -HALF_X + 1.2, HALF_X - 1.2);
          const jz = clamp(controller.pos.z - (dzG / lenG) * jockDist, -HALF_Z + 1.2, HALF_Z - 1.2);
          const dJock = d2(p.pos.x, p.pos.z, jx, jz);
          const wrongSide = (p.pos.x - controller.pos.x) * dir > 0.35;
          const t = tgtOf(p).set(jx, 0, jz);
          if (!wrongSide && dJock < 2.2) {
            p.moveTo(t, clamp(dJock / 1.35, 0.38, 0.84), { jockey: true });
          } else {
            p.moveTo(t, wrongSide ? 1.0 : clamp(dJock / 2.8, 0.72, 1.0));
          }
          p.face(controller.pos);
          tryTackle(p, dt);
          continue;
        }

        // Secondary defender: scramble for second-ball rebounds/parries OR cover passing lane
        if (!controller && sinceShot < 2.2 && p === p2 && d2v < 14) {
          const t = tgtOf(p).set(lx, 0, lz);
          p.moveTo(t, 0.98);
          p.face(ball.pos);
          continue;
        }
        if (controller && controller.team !== side && p === p2 && d2v < 14 && !controller.holdingBall) {
          const coachDouble = !!(teamTactics[side] && teamTactics[side].doublePress);
          const allowDoublePress = ((side === 'home' && state.tacticalPreset === 'press') || coachDouble) && controller.pos.x * dir < 15;
          const dxG = controller.pos.x - gxOwn;
          const dzG = controller.pos.z;
          const lenG = Math.hypot(dxG, dzG) || 1;
          const coverD = allowDoublePress ? 2.1 : 4.4;
          const baseCx = controller.pos.x - (dxG / lenG) * coverD;
          const baseCz = controller.pos.z - (dzG / lenG) * coverD;
          const laneSign = Math.sign(-controller.pos.z) || 1;
          const tx = clamp(baseCx, -HALF_X + 2, HALF_X - 2);
          const tz = clamp(baseCz + (allowDoublePress ? 0 : laneSign * 1.4), -HALF_Z + 2, HALF_Z - 2);
          const t = tgtOf(p).set(tx, 0, tz);
          const dc = d2(p.pos.x, p.pos.z, tx, tz);
          if (dc > 0.7) p.moveTo(t, allowDoublePress ? 0.96 : clamp(dc / 4.0, 0.52, 0.90));
          else p.stop();
          p.face(controller.pos);
          if (allowDoublePress) tryTackle(p, dt);
          continue;
        }

        // Tight goal-side runner marking
        const markRunner = (controller && controller.team !== side) ? markAssign.get(p) : null;
        if (markRunner) {
          const rxG = markRunner.pos.x - gxOwn;
          const rzG = markRunner.pos.z;
          const rLen = Math.hypot(rxG, rzG) || 1;
          const mx = clamp(markRunner.pos.x - (rxG / rLen) * 2.15, -HALF_X + 1.8, HALF_X - 1.8);
          const mz = clamp(markRunner.pos.z - (rzG / rLen) * 2.15, -HALF_Z + 1.8, HALF_Z - 1.8);
          const t = tgtOf(p).set(mx, 0, mz);
          const dm = d2(p.pos.x, p.pos.z, mx, mz);
          if (dm > 0.65) p.moveTo(steerAroundBlockers(p, t), clamp(dm / 4.2, 0.55, 0.94));
          else p.stop();
          p.face(ball.pos);
          continue;
        }

        const t = spotFor(side, i, tgtOf(p));
        const d = d2(p.pos.x, p.pos.z, t.x, t.z);
        const slotDef = (teamFormations[side] || FORMATIONS_3D['4-3-3'])[i];
        const droppingBack = !!(slotDef && slotDef.line === 'DF') && oppHasBall && (t.x - p.pos.x) * dir < -0.6;
        const isFwInPoss = !oppHasBall && state.possession === side && !!(slotDef && slotDef.line === 'FW');
        const pace = droppingBack
          ? clamp(d / 4.8, 0.66, 1.0)
          : isFwInPoss
            ? clamp(d / 5.5, 0.38, 0.94)
            : clamp(d / 8.5, 0.28, 0.86);
        if (d > (isFwInPoss ? 0.35 : 0.55)) p.moveTo(steerAroundBlockers(p, t), pace);
        else p.stop();
        p.face(ball.pos);
      }
      gkTick(sq, dt, side === 'home' && gkRushActive);
    }
  }

  function tryTackle(p, dt) {
    if (!controller || controller.team === p.team || controller.holdingBall || !isActive(p)) return;
    if (deceivedMap.has(p)) return;
    const m = meta.get(p);
    if (!m || m.tackleCd > 0) return;
    const prof = diffProfile();
    const def01 = stat01(p, 'def');
    const aggro = (p.team === 'away' ? prof.tackleAggro : 1.0) * (1 + def01 * 0.08);
    const dist = pdist(p, controller);
    if (dist > 1.38 * clamp(aggro, 0.85, 1.15)) return;

    const dx = controller.pos.x - p.pos.x, dz = controller.pos.z - p.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    const lx = dx / dl, lz = dz / dl;
    const cfx = Math.cos(controller.facing), cfz = Math.sin(controller.facing);
    const alignDot = lx * cfx + lz * cfz; // <0 = frontal, >0 = behind

    // Defenders beaten behind the carrier cannot poke-steal cleanly through their back
    if (alignDot > 0.16) return;
    if (controller === match.controlledPlayer && state.shieldingActive && alignDot > -0.25) return;

    // Wait patiently in jockey unless a genuine tackle window opens
    const hasHeavyWindow = settleT > 0.14 || (activeKick && activeKick.player === controller);
    const touchlineTrap = Math.abs(controller.pos.z) > HALF_Z - 3.2 && dist < 1.15;
    const windowOpen = hasHeavyWindow || touchlineTrap || (dist < 0.88 && alignDot <= 0.10);
    if (!windowOpen) return;

    m.tackleCd = (2.05 / aggro) * clamp(1 - def01 * 0.12, 0.84, 1.16);
    spendStamina(p, 0.025);
    const fromFrontOrSide = alignDot < 0.22;
    const isSlide = fromFrontOrSide && rng() < 0.13 && dist > 0.90 && hasHeavyWindow;
    const ang = Math.atan2(lz, lx);
    p.face(ang);
    p.pushVel(lx * (isSlide ? 6.8 : 3.6), lz * (isSlide ? 6.8 : 3.6));
    if (!p.actionBusy()) p.playAction(isSlide ? 'tackle' : 'stand_tackle');
    emit('tackle', { isSlide, pos: { x: p.pos.x, z: p.pos.z }, vel: { x: lx * (isSlide ? 6.8 : 3.6), z: lz * (isSlide ? 6.8 : 3.6) }, angle: ang });
    refSys.beginTackle(p, {
      isSlide,
      reach: isSlide ? 1.60 : 1.28,
      dur: isSlide ? 0.34 : 0.22,
      lx,
      lz,
      kickMin: isSlide ? 3.0 : 2.3,
      kickRange: 2.2,
    });
  }

  function gkTick(sq, dt, rushOut) {
    const gk = sq.gk;
    if (gk === controller) return;
    if (shot && shot.gk === gk && shot.reacted) return;
    const rec = gkRecoverMap.get(gk) || 0;
    if (rec > 0) {
      gkRecoverMap.set(gk, Math.max(0, rec - dt));
      if (gk.actionBusy()) return;
    }

    const dir = dirFor(sq.side);
    const gx = -dir * HALF_X;
    const inOwnBox =
      ball.pos.x * (-dir) > HALF_X - PITCH.penAreaDepth &&
      Math.abs(ball.pos.z) < PITCH.penAreaWidth / 2;

    // Cross-claiming: GK comes out for high crosses / corners landing inside the box
    if (!controller && !shot && state.phase === 'play' && ball.pos.y >= 1.0 && ball.pos.y <= 3.15) {
      const landX = ball.pos.x + ball.vel.x * 0.42;
      const landZ = ball.pos.z + ball.vel.z * 0.42;
      const landInBox = landX * (-dir) > HALF_X - PITCH.penAreaDepth + 0.5 &&
        Math.abs(landZ) < PITCH.penAreaWidth / 2 - 1.2;
      if (landInBox) {
        const gkEta = d2(gk.pos.x, gk.pos.z, landX, landZ) / 6.3;
        let oppEta = 99;
        for (const o of squads[other(sq.side)].out) {
          if (!isActive(o)) continue;
          oppEta = Math.min(oppEta, d2(o.pos.x, o.pos.z, landX, landZ) / (o.maxSpeed || 6.6));
        }
        const inSixBox = landX * (-dir) > HALF_X - PITCH.sixBoxDepth - 1.0 && Math.abs(landZ) < PITCH.sixBoxWidth / 2 + 1.5;
        if (inSixBox || gkEta < oppEta + 0.14) {
          const t = tgtOf(gk).set(landX, 0, landZ);
          gk.moveTo(t, 1.0, { snappy: true });
          gk.face(ball.pos);
          if (!(lockPlayer === gk && kickLock > 0) && ballDist(gk) < 1.65 && ball.pos.y <= 2.75) {
            if (nearestOpp(gk).d < 2.2 || ballSpeed() > 14.5) {
              const sideZ = gk.pos.z >= 0 ? 1 : -1;
              TMP.set(dir * (11 + rng() * 4), 4.6 + rng() * 1.8, sideZ * (7 + rng() * 5));
              gk.playAction('gk_catch');
              kickBall(gk, TMP, null, null, 0.04, () => {
                const gkPf = getPerf(gk);
                if (gkPf) gkPf.saves++;
                emit('save', { gk: { number: gk.number, name: gk.name }, catch: false });
              });
            } else {
              if (!gk.actionBusy()) gk.playAction('gk_catch');
              gainControl(gk);
              gk.holdingBall = true;
              gkHoldTimer = 0;
              gkDist = null;
              settleT = 1.9 + rng() * 0.65;
              ball.pos.set(gk.pos.x + Math.cos(gk.facing) * 0.35, 1.14, gk.pos.z + Math.sin(gk.facing) * 0.35);
              const gkPf = getPerf(gk);
              if (gkPf) gkPf.saves++;
              emit('save', { gk: { number: gk.number, name: gk.name }, catch: true });
            }
          }
          return;
        }
      }
    }

    // Auto sweeper-keeper rush if loose/through ball is behind defense and GK beats striker to it
    let autoSweep = false;
    if (!controller && !shot && state.phase === 'play' && ball.pos.y < 2.2) {
      const ballInDefZone = ball.pos.x * (-dir) > HALF_X - 22;
      if (ballInDefZone) {
        const gkEta = ballDist(gk) / 6.0;
        let oppEta = 99;
        for (const o of squads[other(sq.side)].out) {
          if (!isActive(o)) continue;
          oppEta = Math.min(oppEta, d2(o.pos.x, o.pos.z, ball.pos.x, ball.pos.z) / (o.maxSpeed || 6.6));
        }
        if (gkEta + 0.18 < oppEta) autoSweep = true;
      }
    }

    if ((rushOut || autoSweep) && state.phase === 'play') {
      const lx = ball.pos.x + ball.vel.x * 0.25;
      const lz = ball.pos.z + ball.vel.z * 0.25;
      const rx = clamp(lx, Math.min(gx, gx + dir * 22), Math.max(gx, gx + dir * 22));
      const rz = clamp(lz, -14, 14);
      const t = tgtOf(gk).set(rx, 0, rz);
      gk.moveTo(t, 1.0, { snappy: true });
      gk.face(ball.pos);
      if (!(lockPlayer === gk && kickLock > 0) && !controller && !shot && ballDist(gk) < 1.65 && ball.pos.y < 1.85) {
        if (!inOwnBox && (nearestOpp(gk).d < 3.6 || ballSpeed() > 11)) {
          // Outside box: first-time sweeper clearance upfield toward sidelines
          const clearZ = (gk.pos.z >= 0 ? 1 : -1) * (8 + rng() * 6);
          TMP.set(dir * (16 + rng() * 5), 5.2 + rng() * 2, clearZ);
          kickBall(gk, TMP, null, 'pass', 0.08);
          settleT = 0.6;
        } else {
          // Inside box: catch & cradle cleanly in hands!
          if (!gk.actionBusy()) gk.playAction('gk_catch');
          gainControl(gk);
          gk.holdingBall = true;
          gkHoldTimer = 0;
          gkDist = null;
          settleT = 1.85 + rng() * 0.65;
          ball.pos.set(gk.pos.x + Math.cos(gk.facing) * 0.35, 1.14, gk.pos.z + Math.sin(gk.facing) * 0.35);
        }
      }
      return;
    }

    // Angle-bisecting shot-stopper arc + 1v1 aggressive narrowing
    const tbx = ball.pos.x - gx, tbz = ball.pos.z;
    const d = Math.hypot(tbx, tbz) || 1;
    const oneVone = !!(controller && controller.team !== sq.side && d < 20 &&
      Math.abs(ball.pos.z) < 14 && (defLineCache[sq.side] * dir < ball.pos.x * dir));
    const off = oneVone ? clamp(d * 0.24, 2.2, 7.8) : clamp(d * 0.11, 1.15, 5.0);
    let px = gx + (tbx / d) * off;
    let pz = clamp((tbz / d) * off * (oneVone ? 1.2 : 1.45) + ball.pos.z * 0.08, -2.95, 2.95);
    const maxStep = oneVone ? 8.2 : 5.2;
    px = clamp(px, Math.min(gx + dir * 0.7, gx + dir * maxStep), Math.max(gx + dir * 0.7, gx + dir * maxStep));
    const t = tgtOf(gk).set(px, 0, pz);
    const gd = d2(gk.pos.x, gk.pos.z, px, pz);
    if (gd > 0.20) gk.moveTo(t, clamp(gd / (oneVone ? 1.8 : 2.2), 0.35, 0.96), { snappy: true });
    else gk.stop();
    gk.face(ball.pos);
    if (!(lockPlayer === gk && kickLock > 0) && !controller && !shot && ballDist(gk) < 1.55 && ballSpeed() < 12 && ball.pos.y < 1.85) {
      if (!gk.actionBusy()) gk.playAction('gk_catch');
      gainControl(gk);
      gk.holdingBall = true;
      gkHoldTimer = 0;
      gkDist = null;
      settleT = 1.9 + rng() * 0.65;
      ball.pos.set(gk.pos.x + Math.cos(gk.facing) * 0.35, 1.14, gk.pos.z + Math.sin(gk.facing) * 0.35);
    }
  }

  // ---- aerial & ground ball reception --------------------------------------
  function resolveAerialPlay(p) {
    const dir = dirFor(p.team);
    const gx = dir * HALF_X;
    const sp = ballSpeed();
    const isUser = p === match.controlledPlayer && userT > 0;
    const queued = isUser ? resolveQueuedOneTouch(p) : null;
    const hasIntent = !!(queued || (isUser && aerialIntent && aerialIntent.t > 0));
    const intentKind = queued ? queued.kind : (aerialIntent ? aerialIntent.kind : null);
    const intentDirX = queued ? queued.dirX : (aerialIntent ? aerialIntent.dirX : 0);
    const intentDirZ = queued ? queued.dirZ : (aerialIntent ? aerialIntent.dirZ : 0);
    const intendShoot = hasIntent && intentKind === 'shoot';
    const intendPass = hasIntent && (intentKind === 'pass' || intentKind === 'through' || intentKind === 'lofted');
    const inAttBox = p.pos.x * dir > 32 && Math.abs(p.pos.z) < 18;
    const inDefBox = p.pos.x * dir < -30;

    // 1. High ball -> Header
    if (ball.pos.y > 1.62) {
      spendStamina(p, 0.038);
      p.playAction('header');
      lastKicker = p;
      lastTouchSide = p.team;
      lockPlayer = p;
      kickLock = 0.48;
      if (offsideWatch && p.team !== offsideWatch.side) offsideWatch = null;

      if (intendShoot || (inAttBox && !inDefBox && !intendPass)) {
        const aimZ = (hasIntent && Math.abs(intentDirZ) > 0.1)
          ? clamp(intentDirZ * 3.1, -3.2, 3.2)
          : (rng() * 2 - 1) * 2.5;
        const dx = gx - ball.pos.x, dz = aimZ - ball.pos.z;
        const flat = Math.hypot(dx, dz) || 1;
        const speed = clamp(15 + rng() * 5, 14, 21);
        const t = flat / speed;
        const vy = (1.2 - ball.pos.y) / t + 4.905 * t * 0.72;
        TMP.set((dx / flat) * speed, vy, (dz / flat) * speed);
        ball.kick(TMP.clone());
        emit('kick', { kind: 'header', power: 0.78 });
        state.stats[p.team].shots++;
        const hOnTgt = Math.abs(aimZ) < GOAL.width / 2;
        if (hOnTgt) state.stats[p.team].onTarget++;
        const hpf = getPerf(p);
        if (hpf) { hpf.shots++; if (hOnTgt) hpf.shotsOnTarget++; else if (d2(p.pos.x, p.pos.z, gx, 0) < 14) hpf.bigChancesMissed++; }
        if (assistCandidate && assistCandidate.receiver === p && assistCandidate.side === p.team && (state.clockSec - assistCandidate.t) < 18) {
          const apf = getPerf(assistCandidate.passer);
          if (apf && assistCandidate.passer !== p) apf.keyPasses++;
        }
        const gk = squads[other(p.team)].gk;
        shot = { shooter: p, side: p.team, aimZ, aimY: 1.2, gk, reacted: false, reactT: 0.14, dived: false };
        sinceShot = 0;
        state.excitement = Math.max(state.excitement, 0.62);
        return;
      }

      if (inDefBox && !intendPass) {
        // Defensive header clearance upfield
        const clearZ = p.pos.z >= 0 ? 1 : -1;
        TMP.set(dir * (14 + rng() * 5), 6.2 + rng() * 2, clearZ * (4 + rng() * 5));
        ball.kick(TMP.clone());
        emit('kick', { kind: 'header', power: 0.68 });
        return;
      }

      // Headed pass to teammate or aimed direction
      const pwr = queued ? queued.power : 0.52;
      const bp = isUser ? userBestPass(p, pwr, intentKind === 'lofted') : bestPass(p);
      const ax = bp.target ? bp.ax : (p.pos.x + (Math.hypot(intentDirX, intentDirZ) > 0.15 ? intentDirX : dir) * 10);
      const az = bp.target ? bp.az : (p.pos.z + (Math.hypot(intentDirX, intentDirZ) > 0.15 ? intentDirZ * 10 : 0));
      const dx = ax - ball.pos.x, dz = az - ball.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const speed = clamp(dist * 0.7 + 6.5, 10.5, 16.5);
      TMP.set((dx / dist) * speed, intentKind === 'lofted' ? 4.4 : 3.0, (dz / dist) * speed);
      ball.kick(TMP.clone());
      emit('kick', { kind: 'header', power: 0.55 });
      recordPassAttempt(p, bp.target, dir);
      passTarget = bp.target || null;
      passT = 0;
      if (isUser && !playerLock.enabled && bp.target && bp.target.team === 'home' && bp.target.role !== 'GK' && isActive(bp.target)) {
        match.controlledPlayer = bp.target;
        manualPick = null;
        manualT = 0;
      }
      return;
    }

    // 2. Chest-height ball (1.05..1.62m) -> Volley Strike, First-Time Volley Pass, or Chest Trap
    if (intendShoot || (inAttBox && sp > 6.5 && !intendPass)) {
      spendStamina(p, 0.042);
      p.playAction('volley');
      lastKicker = p;
      lastTouchSide = p.team;
      lockPlayer = p;
      kickLock = 0.5;
      const aimZ = (hasIntent && Math.abs(intentDirZ) > 0.1)
        ? clamp(intentDirZ * 3.1, -3.25, 3.25)
        : (rng() * 2 - 1) * 2.6;
      const dx = gx - ball.pos.x, dz = aimZ - ball.pos.z;
      const flat = Math.hypot(dx, dz) || 1;
      const speed = clamp(24 + rng() * 6, 23, 31);
      const t = flat / speed;
      const vy = (1.15 - ball.pos.y) / t + 4.905 * t * 0.76;
      TMP.set((dx / flat) * speed, vy, (dz / flat) * speed);
      ball.kick(TMP.clone());
      emit('kick', { kind: 'volley', power: 0.92 });
      state.stats[p.team].shots++;
      const vOnTgt = Math.abs(aimZ) < GOAL.width / 2;
      if (vOnTgt) state.stats[p.team].onTarget++;
      const vpf = getPerf(p);
      if (vpf) { vpf.shots++; if (vOnTgt) vpf.shotsOnTarget++; else if (d2(p.pos.x, p.pos.z, gx, 0) < 14) vpf.bigChancesMissed++; }
      if (assistCandidate && assistCandidate.receiver === p && assistCandidate.side === p.team && (state.clockSec - assistCandidate.t) < 18) {
        const apf = getPerf(assistCandidate.passer);
        if (apf && assistCandidate.passer !== p) apf.keyPasses++;
      }
      const gk = squads[other(p.team)].gk;
      shot = { shooter: p, side: p.team, aimZ, aimY: 1.15, gk, reacted: false, reactT: 0.13, dived: false };
      sinceShot = 0;
      state.excitement = Math.max(state.excitement, 0.7);
      return;
    }

    if (intendPass) {
      spendStamina(p, 0.028);
      p.playAction('volley');
      lastKicker = p;
      lastTouchSide = p.team;
      lockPlayer = p;
      kickLock = 0.45;
      const pwr = queued ? queued.power : 0.58;
      const bp = userBestPass(p, pwr, intentKind === 'lofted');
      const ax = bp.target ? bp.ax : (p.pos.x + (Math.hypot(intentDirX, intentDirZ) > 0.15 ? intentDirX : dir) * 12);
      const az = bp.target ? bp.az : (p.pos.z + (Math.hypot(intentDirX, intentDirZ) > 0.15 ? intentDirZ * 12 : 0));
      const dx = ax - ball.pos.x, dz = az - ball.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const speed = clamp(dist * 0.62 + 8.5, 11.5, 18.5);
      const vy = intentKind === 'lofted' ? 5.2 : (intentKind === 'through' ? 2.4 : 1.6);
      TMP.set((dx / dist) * speed, vy, (dz / dist) * speed);
      ball.kick(TMP.clone());
      emit('kick', { kind: 'pass', power: pwr });
      recordPassAttempt(p, bp.target, dir);
      passTarget = bp.target || null;
      passT = 0;
      if (!playerLock.enabled && bp.target && bp.target.team === 'home' && bp.target.role !== 'GK' && isActive(bp.target)) {
        match.controlledPlayer = bp.target;
        manualPick = null;
        manualT = 0;
      }
      return;
    }

    // Cushioned chest trap (heavy bounce if arriving rocket-fast or closely marked)
    const oppNear = nearestOpp(p).d;
    const isUserJock = isUser && userInput && userInput.modifier;
    if (!isUserJock && (sp > 14.5 || (sp > 10.5 && oppNear < 2.2 && rng() < 0.45))) {
      const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
      const bvx = sp > 0.5 ? ball.vel.x / sp : fx;
      const bvz = sp > 0.5 ? ball.vel.z / sp : fz;
      const kx = fx * 0.72 + bvx * 0.28 + (rng() - 0.5) * 0.32;
      const kz = fz * 0.72 + bvz * 0.28 + (rng() - 0.5) * 0.32;
      const kl = Math.hypot(kx, kz) || 1;
      const kSp = clamp(3.6 + (sp - 10) * 0.28, 3.6, 6.4);
      p.playAction('heavy_touch');
      TMP.set((kx / kl) * kSp, 1.4 + rng() * 0.9, (kz / kl) * kSp);
      ball.kick(TMP);
      lastKicker = p;
      lastTouchSide = p.team;
      lockPlayer = p;
      kickLock = 0.28;
      passTarget = null;
      emit('kick', { kind: 'pass', power: 0.28 });
      return;
    }
    p.playAction('chest_trap');
    gainControl(p);
    settleT = 0.28;
  }

  function deflectShotOffBody(p, sp) {
    const bvx = sp > 0.2 ? ball.vel.x / sp : Math.cos(p.facing);
    const bvz = sp > 0.2 ? ball.vel.z / sp : Math.sin(p.facing);
    const rx = ball.pos.x - p.pos.x;
    const rz = ball.pos.z - p.pos.z;
    const rd = Math.hypot(rx, rz);
    const nx = rd > 0.08 ? rx / rd : -Math.cos(p.facing);
    const nz = rd > 0.08 ? rz / rd : -Math.sin(p.facing);

    // Push ball outside body cylinder so it never sticks or snaps at feet
    if (rd < 0.56) {
      ball.pos.x = clamp(p.pos.x + nx * 0.58, -HALF_X + 0.4, HALF_X - 0.4);
      ball.pos.z = clamp(p.pos.z + nz * 0.58, -HALF_Z + 0.4, HALF_Z - 0.4);
    }

    // Reflect velocity off torso/back surface with glancing lateral scatter into playable space
    const vn = bvx * nx + bvz * nz;
    let outX = vn < 0 ? (bvx - 2 * vn * nx) : bvx;
    let outZ = vn < 0 ? (bvz - 2 * vn * nz) : bvz;
    outX = lerp(outX, nx, 0.42);
    outZ = lerp(outZ, nz, 0.42);
    const scat = (rng() - 0.5) * 0.46;
    const cs = Math.cos(scat), sn = Math.sin(scat);
    let dx = outX * cs - outZ * sn;
    let dz = outX * sn + outZ * cs;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;

    const outSp = clamp(sp * lerp(0.32, 0.48, rng()), 3.8, 12.5);
    const outVy = clamp(1.35 + sp * 0.055 + (ball.pos.y > 1.15 ? 0.65 : 0) + rng() * 0.95, 1.35, 3.8);

    controller = null;
    ball.controlledBy = null;
    TMP.set(dx * outSp, outVy, dz * outSp);
    ball.kick(TMP, TMP2.set(0, (rng() - 0.5) * 5, 0));

    lastKicker = p;
    lastTouchSide = p.team;
    lockPlayer = p;
    kickLock = 0.28;
    shot = null;
    passTarget = null;
    if (offsideWatch && p.team !== offsideWatch.side) offsideWatch = null;
    p.pushVel(bvx * 1.35, bvz * 1.35);
    if (!p.actionBusy()) p.playAction('heavy_touch');
    emit('kick', {
      kind: 'header',
      power: clamp(sp / 32, 0.28, 0.72),
      pos: { x: ball.pos.x, z: ball.pos.z },
      vel: { x: TMP.x, z: TMP.z },
    });
  }

  function checkShotBodyCollisions(dt) {
    if (controller) return false;
    const sp = ballSpeed();
    if (sp < 8.5 || ball.pos.y < 0.05 || ball.pos.y > 1.88) return false;
    if (!shot && (passTarget || sp <= 15.5)) return false;

    const bvx = ball.vel.x / sp, bvz = ball.vel.z / sp;
    // Swept ground segment from previous tick pos -> current pos avoids 30 m/s tunneling at 60Hz
    const prevX = ball.pos.x - ball.vel.x * dt;
    const prevZ = ball.pos.z - ball.vel.z * dt;
    const segDx = ball.pos.x - prevX, segDz = ball.pos.z - prevZ;
    const segLen2 = segDx * segDx + segDz * segDz;

    let hit = null, bestD = 1e9;
    for (const side of ['home', 'away']) {
      for (const p of squads[side].out) {
        if (!isActive(p)) continue;
        if (p === lockPlayer && kickLock > 0) continue;
        if (activeKick && activeKick.player === p) continue;
        if (deceivedMap.has(p)) continue;
        // A user-controlled sprinter running forward onto a non-shot ball takes a forward stride/heavy touch instead of a wall ricochet
        if (!shot && p === match.controlledPlayer && Math.hypot(p.vel.x, p.vel.z) > 3.5) continue;

        let tProj = 1;
        if (segLen2 > 1e-6) {
          tProj = clamp(((p.pos.x - prevX) * segDx + (p.pos.z - prevZ) * segDz) / segLen2, 0, 1);
        }
        const cx = prevX + segDx * tProj;
        const cz = prevZ + segDz * tProj;
        const sweptD = d2(p.pos.x, p.pos.z, cx, cz);
        if (sweptD > 0.62) continue;

        const bfx = Math.cos(p.facing), bfz = Math.sin(p.facing);
        const headOn = -(bvx * bfx + bvz * bfz); // < 0 means ball strikes player's back
        const frontOff = (cx - p.pos.x) * bfx + (cz - p.pos.z) * bfz;
        const hitBack = headOn < -0.12 && frontOff < 0.38;
        const fastBodyBlock = !!shot && sp > 24.0 && sweptD < 0.54;
        if (!hitBack && !fastBodyBlock) continue;

        if (sweptD < bestD) { bestD = sweptD; hit = p; }
      }
    }
    if (!hit) return false;
    deflectShotOffBody(hit, sp);
    return true;
  }

  function claims() {
    if (controller) return;
    const sp = ballSpeed();
    if (ball.pos.y > 2.32) return;
    const isAerial = ball.pos.y > 1.05;
    const baseReach = isAerial ? 1.42 : 1.08;
    const userJockActive = !!(userT > 0 && userInput && userInput.modifier && match.controlledPlayer && !isAerial);
    const isDrivenShot = sp > 6.5 && (shot || (!passTarget && sp > 15.5));
    const bvxN = sp > 0.2 ? ball.vel.x / sp : 0;
    const bvzN = sp > 0.2 ? ball.vel.z / sp : 0;

    let best = null, bd = 1e9;
    for (const side of ['home', 'away']) {
      for (const p of squads[side].all) {
        if (!isActive(p)) continue;
        if (p === lockPlayer && kickLock > 0) continue;
        if (activeKick && activeKick.player === p) continue;
        if (deceivedMap.has(p)) continue;
        if (p.role === 'GK' && ballDist(p) > 14) continue;
        const d = ballDist(p);
        const effReach = (userJockActive && p === match.controlledPlayer) ? 1.34 : baseReach;
        if (d > effReach) continue;
        const chaseNonShot = !shot && p === match.controlledPlayer && Math.hypot(p.vel.x, p.vel.z) > 3.5;
        if (isDrivenShot && !chaseNonShot && p.role !== 'GK' && d > 0.64) {
          const headOn = -(bvxN * Math.cos(p.facing) + bvzN * Math.sin(p.facing));
          if (headOn < -0.12) continue;
        }
        // Slight preference for user-controlled jumper in close aerial battles or jockeying interceptor
        const adj = (isAerial && p === match.controlledPlayer) ? d - 0.18
          : (userJockActive && p === match.controlledPlayer ? d - 0.14 : d);
        if (adj < bd) { bd = adj; best = p; }
      }
    }
    if (!best) return;

    // Offside check at moment an offside-flagged player touches or challenges the ball
    if (offsideWatch && best.team === offsideWatch.side && offsideWatch.flagged.has(best)) {
      callOffside(best);
      return;
    }

    if (isAerial && best.role === 'GK') {
      const dir = dirFor(best.team);
      const inOwnBox = best.pos.x * (-dir) > HALF_X - PITCH.penAreaDepth &&
        Math.abs(best.pos.z) < PITCH.penAreaWidth / 2;
      if (inOwnBox) {
        if (!best.actionBusy()) best.playAction('gk_catch');
        gainControl(best);
        best.holdingBall = true;
        gkHoldTimer = 0;
        gkDist = null;
        settleT = 1.9 + rng() * 0.65;
        ball.pos.set(best.pos.x + Math.cos(best.facing) * 0.35, 1.14, best.pos.z + Math.sin(best.facing) * 0.35);
        const gkPf = getPerf(best);
        if (gkPf) gkPf.saves++;
        emit('save', { gk: { number: best.number, name: best.name }, catch: true });
      } else {
        const clearZ = best.pos.z >= 0 ? 1 : -1;
        TMP.set(dir * (16 + rng() * 4), 5.0 + rng() * 2, clearZ * (7 + rng() * 4));
        kickBall(best, TMP, null, 'pass', 0.06);
      }
      return;
    }

    // Driven shot hitting a player's back (ground or upper-torso height) ricochets loosely instead of controlling/trapping
    const bestChaseNonShot = !shot && best === match.controlledPlayer && Math.hypot(best.vel.x, best.vel.z) > 3.5;
    if (isDrivenShot && !bestChaseNonShot && best.role !== 'GK' && ball.pos.y <= 1.88) {
      const bfx = Math.cos(best.facing), bfz = Math.sin(best.facing);
      const headOn = -(bvxN * bfx + bvzN * bfz);
      if (headOn < -0.12) {
        deflectShotOffBody(best, sp);
        return;
      }
    }

    if (isAerial && best.role !== 'GK') {
      resolveAerialPlay(best);
      return;
    }

    if (best.role === 'GK') {
      gainControl(best);
      const dir = dirFor(best.team);
      const inOwnBox = best.pos.x * (-dir) > HALF_X - PITCH.penAreaDepth &&
        Math.abs(best.pos.z) < PITCH.penAreaWidth / 2;
      if (inOwnBox) {
        best.holdingBall = true;
        gkHoldTimer = 0;
        gkDist = null;
        if (!best.actionBusy()) best.playAction('gk_catch');
        ball.pos.set(best.pos.x + Math.cos(best.facing) * 0.35, 1.14, best.pos.z + Math.sin(best.facing) * 0.35);
      }
      return;
    }

    if (sp > 24.0) return;

    // Queued one-touch pass / through / lob / volley-on-grass executes right at foot arrival!
    const queuedOneTouch = (best === match.controlledPlayer && userT > 0) ? resolveQueuedOneTouch(best) : null;
    if (queuedOneTouch) {
      executeOneTouchGroundKick(best, queuedOneTouch);
      return;
    }

    // Realistic First-Touch Control Evaluation
    let touchErr = 0;
    if (sp > 7.5) {
      const speedFactor = clamp((sp - 7.5) / 14.5, 0, 1.15) * 0.72;
      const bvx = ball.vel.x / sp, bvz = ball.vel.z / sp;
      const bfx = Math.cos(best.facing), bfz = Math.sin(best.facing);
      const headOn = -(bvx * bfx + bvz * bfz); // +1 facing incoming ball, -1 hitting back/chasing
      const forwardStride = bvx * bfx + bvz * bfz; // +1 running in ball's travel direction onto a through pass
      const cleanApproach = headOn > 0.10 || (!shot && forwardStride > 0.35);
      const angleFactor = !cleanApproach ? clamp((0.25 - headOn) * 0.26, 0, 0.30) : 0;
      const pSp = Math.hypot(best.vel.x, best.vel.z);
      const isUser = best === match.controlledPlayer && userT > 0;
      const isUserSpr = isUser && userInput && userInput.sprint;
      const isUserJock = isUser && userInput && userInput.modifier;
      const sprintFactor = (isUserSpr || pSp > best.maxSpeed * 0.80) ? 0.22 : 0;
      const oppNear = nearestOpp(best).d;
      const pressFactor = oppNear < 2.4 ? clamp((2.4 - oppNear) / 2.4, 0, 1) * 0.20 : 0;
      const tiredFactor = best.stamina < 0.42 ? clamp((0.42 - best.stamina) / 0.42, 0, 1) * 0.16 : 0;
      const magnetBonus = (isUser && cleanApproach && (best === passTarget || lastTouchSide === best.team || magnetState.player === best))
        ? (best === passTarget ? -0.30 : -0.22)
        : 0;
      const cushionBonus = (isUserJock ? -0.26 : (pSp < 2.0 ? -0.08 : 0)) + magnetBonus;
      const dribSkillBonus = -stat01(best, 'dribble') * 0.16;
      const jitter = (rng() - 0.5) * 0.14;
      touchErr = clamp(speedFactor + angleFactor + sprintFactor + pressFactor + tiredFactor + cushionBonus + dribSkillBonus + jitter, 0, 1.4);
    }

    if (touchErr >= 0.42) {
      // Heavy / messy first touch: ball pops 1.2-3.4 m away & remains chaseable/stealable!
      const bvx = sp > 0.4 ? ball.vel.x / sp : Math.cos(best.facing);
      const bvz = sp > 0.4 ? ball.vel.z / sp : Math.sin(best.facing);
      const bfx = Math.cos(best.facing), bfz = Math.sin(best.facing);
      const scatter = (rng() - 0.5) * 0.48;
      let kx = bfx * 0.62 + bvx * 0.38 - bfz * scatter;
      let kz = bfz * 0.62 + bvz * 0.38 + bfx * scatter;
      const kl = Math.hypot(kx, kz) || 1;
      kx /= kl; kz /= kl;
      const pSp = Math.hypot(best.vel.x, best.vel.z);
      const kSp = clamp(Math.max(4.8, pSp * 1.12 + 3.2) + (touchErr - 0.42) * 4.5, 4.8, 11.2);
      const kVy = 0.55 + clamp((touchErr - 0.42) * 2.2, 0.2, 2.2);
      best.playAction('heavy_touch');
      best.pushVel(kx * Math.min(pSp, 4.4), kz * Math.min(pSp, 4.4));
      TMP.set(kx * kSp, kVy, kz * kSp);
      ball.kick(TMP);
      lastKicker = best;
      lastTouchSide = best.team;
      lockPlayer = best;
      kickLock = clamp(0.28 + touchErr * 0.22, 0.28, 0.48);
      passTarget = null;
      shot = null;
      emit('kick', { kind: 'pass', power: 0.24 });
      return;
    }

    gainControl(best);
    if (touchErr >= 0.22) {
      settleT = Math.max(settleT, clamp(0.16 + touchErr * 0.56, 0.18, 0.40));
    }
  }

  // ---- bounds / goals / set-pieces -----------------------------------------
  function setupSetPiece(kind, side, x, z, isThrowIn, hasCard = false) {
    if (refSys && refSys.clearAdvantage) refSys.clearAdvantage();
    const ballZ = kind === 'throw_in' ? (z >= 0 ? 1 : -1) * (HALF_Z - 0.12) : z;
    ball.place(x, ballZ);
    if (ball.stopDead) ball.stopDead();
    shot = null; passTarget = null; offsideWatch = null;
    passGrace.timer = 0; passGrace.target = null; pursuitOverridden = false;
    activeKick = null; gkDist = null; activeWall = null;
    pending.length = 0;
    releaseBall();
    state.phase = 'out';
    state.setPieceType = kind;
    state.possession = side;

    let taker = null;
    if (kind === 'goal_kick') {
      taker = squads[side].gk;
    } else if (kind === 'penalty') {
      taker = squads[side].out.filter(isActive).sort((a, b) => statVal(b, 'shoot') - statVal(a, 'shoot'))[0] || squads[side].out[squads[side].out.length - 1];
    } else {
      let bd = 1e9;
      for (const p of squads[side].out) {
        if (!isActive(p)) continue;
        const d = d2(p.pos.x, p.pos.z, x, ballZ);
        if (d < bd) { bd = d; taker = p; }
      }
      if (!taker) taker = squads[side].gk;
    }

    const dirR = dirFor(side);
    const opp = other(side);
    if (kind === 'penalty') {
      const gk = squads[opp].gk;
      gk.pos.set(dirR * (HALF_X - 0.35), 0, 0);
      gk.vel.set(0, 0, 0);
      gk.stop();
      gk.face(ball.pos);
    }

    let aimX = clamp(x + dirR * 12, -HALF_X + 2, HALF_X - 2);
    let aimZ = clamp(ballZ * 0.5, -HALF_Z + 2, HALF_Z - 2);
    if (kind === 'penalty') {
      aimX = dirR * HALF_X;
      aimZ = 0;
    } else if (kind === 'corner') {
      aimX = Math.sign(x) * (HALF_X - 9.0);
      aimZ = 0;
    } else if (kind === 'free_kick') {
      if (d2(x, ballZ, dirR * HALF_X, 0) < 35) {
        aimX = dirR * HALF_X;
        aimZ = 0;
      } else {
        aimX = clamp(x + dirR * 16, -HALF_X + 3, HALF_X - 3);
      }
    } else if (kind === 'throw_in') {
      aimX = clamp(x + dirR * 9, -HALF_X + 3, HALF_X - 3);
      aimZ = clamp(ballZ - Math.sign(ballZ || 1) * 10, -HALF_Z + 3, HALF_Z - 3);
    } else if (kind === 'goal_kick') {
      aimX = clamp(x + dirR * 22, -HALF_X + 5, HALF_X - 5);
      aimZ = clamp(ballZ * 1.4, -HALF_Z + 5, HALF_Z - 5);
    }

    let freezeT = 0.85;
    if (kind === 'free_kick') freezeT = hasCard ? 2.45 : 1.55;
    else if (kind === 'penalty') freezeT = hasCard ? 2.65 : 1.85;
    else if (kind === 'corner') freezeT = 1.15;

    restart = {
      kind,
      side,
      taker,
      x,
      z: ballZ,
      aimX,
      aimZ,
      power: 0.62,
      gkDiveChoice: 0,
      wallPlayers: [],
      freezeT,
      t: (kind === 'free_kick' || kind === 'corner' || kind === 'penalty') ? 3.2 : 2.6,
      ready: false,
      aiWaitT: 0.85 + rng() * 0.4,
      autoT: (kind === 'free_kick' || kind === 'corner' || kind === 'penalty') ? 5.4 : 4.2,
      throwIn: !!isThrowIn,
    };

    if (side === 'home' && taker && (taker.role !== 'GK' || kind === 'goal_kick')) {
      match.controlledPlayer = taker;
    } else if (side === 'away' && kind === 'penalty') {
      match.controlledPlayer = squads.home.gk;
    }
  }

  function executeSetPieceKick(r, userFired, kindChoice, powerOverride) {
    const taker = r.taker;
    const side = r.side;
    const dir = dirFor(side);
    const gx = dir * HALF_X;
    const pwr = clamp(powerOverride != null ? powerOverride : r.power, 0.25, 1.0);

    if (r.kind === 'penalty') {
      const aimZ = userFired
        ? clamp(r.aimZ, -3.25, 3.25)
        : (rng() < 0.5 ? -1 : 1) * (2.2 + rng() * 0.85);
      const dx = gx - ball.pos.x, dz = aimZ - ball.pos.z;
      const flat = Math.hypot(dx, dz) || 1;
      const speed = userFired ? lerp(23.5, 34.5, pwr) : (29 + rng() * 4);
      const aimY = userFired ? lerp(0.50, 2.20, pwr) : (1.1 + rng() * 0.6);
      const t = flat / speed;
      const vy = (aimY - ball.pos.y) / t + 4.905 * t * 0.85;
      TMP.set((dx / flat) * speed, vy, (dz / flat) * speed);
      const gk = squads[other(side)].gk;
      const userDive = side === 'away' && userT > 0;
      const gkChoice = userDive ? r.gkDiveChoice : 0;
      state.stats[side].shots++;
      state.stats[side].onTarget++;
      restart = null;
      state.setPieceType = null;
      state.phase = 'play';
      kickBall(taker, TMP, null, 'shoot', 0.14, () => {
        shot = {
          shooter: taker,
          side,
          aimZ,
          aimY,
          gk,
          reacted: true,
          reactT: 0,
          dived: true,
          isPenalty: true,
          userDiveUsed: userDive,
        };
        sinceShot = 0;
        if (userDive) {
          if (gkChoice !== 0) {
            const diveAct = gkChoice * Math.sign(gx) > 0 ? 'gk_dive_left' : 'gk_dive_right';
            gk.playAction(diveAct);
            gk.pushVel(0, gkChoice * 5.6);
          }
        } else {
          const diveAct = (aimZ - gk.pos.z) * Math.sign(gx) > 0 ? 'gk_dive_left' : 'gk_dive_right';
          gk.playAction(diveAct);
          gk.pushVel(0, Math.sign(aimZ - gk.pos.z) * 5.2);
        }
      }, true);
      return;
    }

    if (r.kind === 'corner') {
      let targetMate = null, ax, az;
      if (userFired && kindChoice === 'pass') {
        const bp = userBestPass(taker, pwr, false);
        targetMate = bp.target;
        ax = bp.ax;
        az = bp.az;
      } else {
        const refX = userFired ? r.aimX : Math.sign(r.x) * (HALF_X - 8.5);
        const refZ = userFired ? r.aimZ : (rng() - 0.5) * 8;
        let bestD = 1e9;
        for (const m of squads[side].out) {
          if (!isActive(m) || m === taker) continue;
          const d = d2(m.pos.x, m.pos.z, refX, refZ);
          if (d < bestD) { bestD = d; targetMate = m; }
        }
        ax = userFired ? refX : (targetMate ? targetMate.pos.x : refX);
        az = userFired ? refZ : (targetMate ? targetMate.pos.z : refZ);
      }
      const dx = ax - ball.pos.x, dz = az - ball.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const isShort = kindChoice === 'pass' && dist < 18;
      const speed = isShort
        ? clamp(dist * 0.62 + 6.5, 10, 17)
        : clamp(dist * 0.48 + lerp(6.5, 11.5, pwr), 14, 24);
      const t = dist / speed;
      const vy = isShort ? 0.35 : clamp(4.905 * t * lerp(0.80, 1.12, pwr), 4.6, 10.2);
      TMP.set((dx / dist) * speed, vy, (dz / dist) * speed);
      const spinY = isShort ? 0 : Math.sign(r.z) * (kindChoice === 'shoot' ? 13 : -11);
      restart = null;
      state.setPieceType = null;
      state.phase = 'play';
      offsideWatch = null;
      kickBall(taker, TMP, spinY !== 0 ? TMP2.set(0, spinY, 0) : null, 'pass', 0.14, () => {
        offsideWatch = null;
        passTarget = targetMate;
        passT = 0;
        if (side === 'home' && targetMate && isActive(targetMate)) {
          match.controlledPlayer = targetMate;
        }
      }, true);
      return;
    }

    if (r.kind === 'free_kick') {
      const distG = d2(ball.pos.x, ball.pos.z, gx, 0);
      if (distG < 35 && (kindChoice === 'shoot' || (!userFired && rng() < 0.65))) {
        const aimZ = userFired
          ? clamp(r.aimZ, -3.15, 3.15)
          : (rng() < 0.5 ? -1 : 1) * (2.3 + rng() * 0.6);
        const dx = gx - ball.pos.x, dz = aimZ - ball.pos.z;
        const flat = Math.hypot(dx, dz) || 1;
        const speed = userFired ? clamp(lerp(22.5, 31.5, pwr), 22, 32) : clamp(24 + flat * 0.18, 24, 31);
        const aimY = userFired ? lerp(1.15, 2.28, pwr) : 1.65;
        const t = flat / speed;
        const vy = (aimY - ball.pos.y) / t + 4.905 * t * 0.94;
        TMP.set((dx / flat) * speed, vy, (dz / flat) * speed);
        const gk = squads[other(side)].gk;
        const wallList = (r.wallPlayers || []).slice();
        for (const wp of wallList) {
          if (isActive(wp) && !wp.actionBusy()) wp.playAction('wall_jump');
        }
        activeWall = wallList.length ? { players: wallList, t: 0 } : null;
        state.stats[side].shots++;
        state.stats[side].onTarget++;
        restart = null;
        state.setPieceType = null;
        state.phase = 'play';
        kickBall(taker, TMP, TMP2.set(0, aimZ >= ball.pos.z ? -17 : 17, 0), 'finesse_shoot', 0.14, () => {
          shot = { shooter: taker, side, aimZ, aimY, gk, reacted: false, reactT: 0.14, dived: false };
          sinceShot = 0;
        }, true);
        return;
      }

      // Free kick pass / lofted delivery
      let targetMate = null, ax, az;
      if (userFired) {
        ax = r.aimX;
        az = r.aimZ;
        let bd = 12;
        for (const m of squads[side].out) {
          if (!isActive(m) || m === taker) continue;
          const d = d2(m.pos.x, m.pos.z, ax, az);
          if (d < bd) { bd = d; targetMate = m; }
        }
      } else {
        const bp = bestPass(taker);
        targetMate = bp.target;
        ax = bp.target ? bp.ax : (ball.pos.x + dir * 14);
        az = bp.target ? bp.az : ball.pos.z;
      }
      const dx = ax - ball.pos.x, dz = az - ball.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const isLoft = kindChoice === 'lofted' || kindChoice === 'through' || dist > 18;
      const speed = clamp(dist * 0.56 + lerp(7, 11, pwr), 12, 23);
      const t = dist / speed;
      const vy = isLoft ? clamp(4.905 * t * 0.72, 2.8, 9.2) : 0.25;
      TMP.set((dx / dist) * speed, vy, (dz / dist) * speed);
      restart = null;
      state.setPieceType = null;
      state.phase = 'play';
      kickBall(taker, TMP, null, 'pass', 0.12, () => {
        passTarget = targetMate || null;
        passT = 0;
        if (side === 'home' && targetMate && targetMate.role !== 'GK' && isActive(targetMate)) {
          match.controlledPlayer = targetMate;
        }
      }, true);
      return;
    }

    if (r.kind === 'throw_in') {
      let targetMate = null, ax, az;
      if (userFired) {
        ax = r.aimX;
        az = r.aimZ;
        let bd = 10;
        for (const m of squads[side].out) {
          if (!isActive(m) || m === taker) continue;
          const d = d2(m.pos.x, m.pos.z, ax, az);
          if (d < bd) { bd = d; targetMate = m; }
        }
      } else {
        const bp = bestPass(taker);
        targetMate = bp.target;
        if (!targetMate) {
          let bd = 1e9;
          for (const m of squads[side].out) {
            if (!isActive(m) || m === taker) continue;
            const d = pdist(m, taker);
            if (d < bd) { bd = d; targetMate = m; }
          }
        }
        ax = targetMate ? clamp(targetMate.pos.x + dir * 1.5, -HALF_X + 2, HALF_X - 2) : clamp(r.x + dir * 8, -HALF_X + 2, HALF_X - 2);
        az = targetMate ? targetMate.pos.z : clamp(r.z - Math.sign(r.z || 1) * 9, -HALF_Z + 2, HALF_Z - 2);
      }
      taker.playAction('throw_in');
      taker.face(Math.atan2(az - taker.pos.z, ax - taker.pos.x));
      const bx0 = clamp(taker.pos.x + Math.cos(taker.facing) * 0.22, -HALF_X + 0.4, HALF_X - 0.4);
      const bz0 = clamp(taker.pos.z + Math.sin(taker.facing) * 0.22, -HALF_Z + 0.18, HALF_Z - 0.18);
      ball.pos.set(bx0, 1.92, bz0);
      ball.vel.set(0, 0, 0);
      const dx = ax - bx0, dz = az - bz0;
      const dist = Math.hypot(dx, dz) || 1;
      const speed = clamp(dist * 0.62 + lerp(4.8, 8.2, pwr), 9.0, 16.8);
      const t = dist / speed;
      const vy = clamp(4.905 * t * 0.48 + (0.4 - 1.92) / t, 1.2, 5.2);
      r.launching = true;
      r.launchT = 0.34;
      r.launchVel = TMP.set((dx / dist) * speed, vy, (dz / dist) * speed).clone();
      r.launchTarget = targetMate || null;
      r.launchAimX = ax;
      r.launchAimZ = az;
      return;
    }

    // Goal kick
    let targetMate = null, ax, az;
    if (userFired && kindChoice === 'pass') {
      const bp = userBestPass(taker, pwr, false);
      targetMate = bp.target;
      ax = bp.ax;
      az = bp.az;
    } else if (userFired) {
      ax = r.aimX;
      az = r.aimZ;
      let bd = 14;
      for (const m of squads[side].out) {
        if (!isActive(m)) continue;
        const d = d2(m.pos.x, m.pos.z, ax, az);
        if (d < bd) { bd = d; targetMate = m; }
      }
    } else {
      let bs = -1e9;
      for (const m of squads[side].out) {
        if (!isActive(m)) continue;
        const candX = clamp(m.pos.x + dir * 4, -HALF_X + 4, HALF_X - 4);
        const candZ = m.pos.z;
        const d = d2(r.x, r.z, candX, candZ);
        if (d < 10 || d > 52) continue;
        const s = (candX - r.x) * dir * 0.04 - laneBlockers(r.x, r.z, candX, candZ, other(side), false) * 0.8 + (m.role === 'DF' ? 0.6 : 0);
        if (s > bs) { bs = s; targetMate = m; ax = candX; az = candZ; }
      }
      if (!targetMate) { ax = r.aimX; az = r.aimZ; }
    }
    const dx = ax - ball.pos.x, dz = az - ball.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const isShort = kindChoice === 'pass' && dist < 24;
    const speed = isShort
      ? clamp(dist * 0.62 + 6.5, 11, 17.5)
      : clamp(dist * 0.45 + lerp(8.5, 13.0, pwr), 16.5, 28.5);
    const t = dist / speed;
    const vy = isShort ? 0.35 : clamp(4.905 * t * 0.88, 4.8, 11.4);
    TMP.set((dx / dist) * speed, vy, (dz / dist) * speed);
    restart = null;
    state.setPieceType = null;
    state.phase = 'play';
    offsideWatch = null;
    kickBall(taker, TMP, null, 'pass', 0.14, () => {
      offsideWatch = null;
      lockPlayer = taker;
      kickLock = 0.68;
      passTarget = targetMate || null;
      passT = 0;
      if (side === 'home' && targetMate && isActive(targetMate)) {
        match.controlledPlayer = targetMate;
      }
    }, true);
  }

  function arrangeSetPieceParticipants(r, dt) {
    const dir = dirFor(r.side);
    const opp = other(r.side);
    if (r.kind === 'corner') {
      const goalX = Math.sign(r.x) * HALF_X;
      let attSlot = 0;
      for (const m of squads[r.side].out) {
        if (!isActive(m) || m === r.taker) continue;
        if (attSlot < 4) {
          const tx = goalX - Math.sign(r.x) * (7.5 + (attSlot % 2) * 4.5);
          const tz = (attSlot - 1.5) * 3.8;
          const t = tgtOf(m).set(tx, 0, tz);
          if (d2(m.pos.x, m.pos.z, tx, tz) > 0.8) m.moveTo(t, 0.85);
          else m.stop();
          m.face(ball.pos);
          attSlot++;
        } else {
          m.moveTo(spotFor(r.side, squads[r.side].out.indexOf(m), tgtOf(m)), 0.7);
        }
      }
      let defSlot = 0;
      for (const o of squads[opp].out) {
        if (!isActive(o)) continue;
        if (defSlot < 5) {
          const tx = goalX - Math.sign(r.x) * (5.5 + (defSlot % 2) * 4.0);
          const tz = (defSlot - 2) * 3.2;
          const t = tgtOf(o).set(tx, 0, tz);
          if (d2(o.pos.x, o.pos.z, tx, tz) > 0.8) o.moveTo(t, 0.88);
          else o.stop();
          o.face(ball.pos);
          defSlot++;
        } else {
          o.moveTo(spotFor(opp, squads[opp].out.indexOf(o), tgtOf(o)), 0.7);
        }
      }
      gkTick(squads[r.side], dt, false);
      gkTick(squads[opp], dt, false);
      return true;
    }

    if (r.kind === 'free_kick') {
      const gx = dir * HALF_X;
      const distG = d2(r.x, r.z, gx, 0);
      const wallOn = distG < 35;
      const dx = gx - r.x, dz = -r.z;
      const dl = Math.hypot(dx, dz) || 1;
      const wx = r.x + (dx / dl) * 9.15, wz = r.z + (dz / dl) * 9.15;
      const px = -dz / dl, pz = dx / dl;
      r.wallPlayers.length = 0;
      let wallIdx = 0;
      for (const o of squads[opp].out) {
        if (!isActive(o)) continue;
        if (wallOn && wallIdx < 3) {
          r.wallPlayers.push(o);
          const off = (wallIdx - 1) * 0.78;
          const tx = clamp(wx + px * off, -HALF_X + 2, HALF_X - 2);
          const tz = clamp(wz + pz * off, -HALF_Z + 2, HALF_Z - 2);
          const t = tgtOf(o).set(tx, 0, tz);
          if (d2(o.pos.x, o.pos.z, tx, tz) > 0.6) o.moveTo(t, 0.85);
          else o.stop();
          o.face(ball.pos);
          wallIdx++;
        } else {
          o.moveTo(spotFor(opp, squads[opp].out.indexOf(o), tgtOf(o)), 0.7);
        }
      }
      for (let i = 0; i < squads[r.side].out.length; i++) {
        const m = squads[r.side].out[i];
        if (!isActive(m) || m === r.taker) continue;
        m.moveTo(spotFor(r.side, i, tgtOf(m)), 0.72);
        m.face(ball.pos);
      }
      gkTick(squads[r.side], dt, false);
      gkTick(squads[opp], dt, false);
      return true;
    }

    if (r.kind === 'penalty') {
      const edgeX = dir * (HALF_X - 18.2);
      for (const s of ['home', 'away']) {
        squads[s].out.forEach((p, i) => {
          if (!isActive(p) || p === r.taker) return;
          const tz = (i - 4.5) * 3.4;
          const tx = clamp(edgeX - dir * (s === r.side ? 1.5 : 0.4), -HALF_X + 4, HALF_X - 4);
          const t = tgtOf(p).set(tx, 0, tz);
          if (d2(p.pos.x, p.pos.z, tx, tz) > 0.8) p.moveTo(t, 0.85);
          else p.stop();
          p.face(ball.pos);
        });
      }
      const gk = squads[opp].gk;
      const gkt = tgtOf(gk).set(dir * (HALF_X - 0.35), 0, 0);
      if (d2(gk.pos.x, gk.pos.z, gkt.x, gkt.z) > 0.3) gk.moveTo(gkt, 0.8);
      else gk.stop();
      gk.face(ball.pos);
      gkTick(squads[r.side], dt, false);
      return true;
    }

    if (r.kind === 'throw_in') {
      const sideSign = r.z >= 0 ? 1 : -1;
      let opts = 0;
      for (const m of squads[r.side].out) {
        if (!isActive(m) || m === r.taker) continue;
        if (opts < 2) {
          const tx = clamp(r.x + dir * (opts === 0 ? 5.5 : 12.0), -HALF_X + 3, HALF_X - 3);
          const tz = clamp(r.z - sideSign * (opts === 0 ? 5.5 : 10.5), -HALF_Z + 2, HALF_Z - 2);
          const t = tgtOf(m).set(tx, 0, tz);
          if (d2(m.pos.x, m.pos.z, tx, tz) > 0.8) m.moveTo(t, 0.82);
          else m.stop();
          m.face(ball.pos);
          opts++;
        } else {
          m.moveTo(spotFor(r.side, squads[r.side].out.indexOf(m), tgtOf(m)), 0.65);
        }
      }
      for (let i = 0; i < squads[opp].out.length; i++) {
        const o = squads[opp].out[i];
        if (!isActive(o)) continue;
        const t = spotFor(opp, i, tgtOf(o));
        if (d2(t.x, t.z, r.x, r.z) < 2.6) t.z -= sideSign * 2.6;
        o.moveTo(t, 0.72);
        o.face(ball.pos);
      }
      gkTick(squads[r.side], dt, false);
      gkTick(squads[opp], dt, false);
      return true;
    }

    if (r.kind === 'goal_kick') {
      const boxEdgeX = -dir * (HALF_X - PITCH.penAreaDepth - 1.4);
      const boxHalfW = PITCH.penAreaWidth / 2 + 1.4;
      for (let i = 0; i < squads[r.side].out.length; i++) {
        const m = squads[r.side].out[i];
        if (!isActive(m)) continue;
        let t;
        if (i === 0 || i === 3) {
          t = tgtOf(m).set(-dir * (HALF_X - 15), 0, (i === 0 ? -1 : 1) * 19);
        } else if (i === 1 || i === 2) {
          t = tgtOf(m).set(-dir * (HALF_X - 13.5), 0, (i === 1 ? -1 : 1) * 8.5);
        } else {
          t = spotFor(r.side, i, tgtOf(m));
        }
        if (d2(m.pos.x, m.pos.z, t.x, t.z) > 0.9) m.moveTo(t, 0.78);
        else m.stop();
        m.face(ball.pos);
      }
      for (let i = 0; i < squads[opp].out.length; i++) {
        const o = squads[opp].out[i];
        if (!isActive(o)) continue;
        const t = spotFor(opp, i, tgtOf(o));
        if (t.x * (-dir) > HALF_X - PITCH.penAreaDepth - 1.4 && Math.abs(t.z) < boxHalfW) {
          t.x = boxEdgeX;
        }
        if (o.pos.x * (-dir) > HALF_X - PITCH.penAreaDepth - 1.0 && Math.abs(o.pos.z) < boxHalfW) {
          o.pos.x = boxEdgeX;
        }
        if (d2(o.pos.x, o.pos.z, t.x, t.z) > 0.9) o.moveTo(t, 0.8);
        else o.stop();
        o.face(ball.pos);
      }
      gkTick(squads[opp], dt, false);
      return true;
    }

    return false;
  }

  function updateRestart(dt) {
    if (!restart) { state.phase = 'play'; state.setPieceType = null; return; }
    const r = restart;
    const { taker } = r;
    if (r.launching) {
      arrangeSetPieceParticipants(r, dt);
      taker.stop();
      taker.face(Math.atan2(r.launchAimZ - taker.pos.z, r.launchAimX - taker.pos.x));
      const bx0 = clamp(taker.pos.x + Math.cos(taker.facing) * 0.22, -HALF_X + 0.4, HALF_X - 0.4);
      const bz0 = clamp(taker.pos.z + Math.sin(taker.facing) * 0.22, -HALF_Z + 0.18, HALF_Z - 0.18);
      ball.pos.set(bx0, 1.92, bz0);
      ball.vel.set(0, 0, 0);
      r.launchT -= dt;
      if (r.launchT > 0) return;
      const vel = r.launchVel;
      const targetMate = r.launchTarget;
      const side = r.side;
      restart = null;
      state.setPieceType = null;
      state.phase = 'play';
      offsideWatch = null;
      ball.kick(vel);
      emit('kick', { kind: 'throw_in', power: clamp(vel.length() / 18, 0.3, 1.0) });
      lastKicker = taker;
      lastTouchSide = side;
      lockPlayer = taker;
      kickLock = 0.68;
      passTarget = targetMate || null;
      passT = 0;
      if (side === 'home' && targetMate && isActive(targetMate)) {
        match.controlledPlayer = targetMate;
      }
      return;
    }
    r.t -= dt;
    r.freezeT = Math.max(0, r.freezeT - dt);

    const customArranged = arrangeSetPieceParticipants(r, dt);
    const dir = dirFor(r.side);
    let destX = r.x;
    let destZ = r.z;
    if (r.kind === 'penalty') { destX = r.x - dir * 1.35; }
    else if (r.kind === 'free_kick' || r.kind === 'corner') { destX = r.x - dir * 0.9; }
    else if (r.kind === 'goal_kick') { destX = r.x - dir * 1.1; }
    else if (r.kind === 'throw_in') { destZ = (r.z >= 0 ? 1 : -1) * (HALF_Z + 0.15); }

    const t = tgtOf(taker).set(destX, 0, destZ);
    const d = d2(taker.pos.x, taker.pos.z, destX, destZ);
    if (d > 1.25 && r.t > 0) {
      taker.moveTo(t, 0.92);
      taker.face(ball.pos);
      if (!customArranged) { offBall(dt); pickControlled(dt); }
      return;
    }

    taker.stop();
    taker.face(Math.atan2(r.aimZ - taker.pos.z, r.aimX - taker.pos.x));

    // Mandatory dead-ball whistle / card / wall-setup pause before anyone can kick!
    if (r.freezeT > 0) return;
    r.ready = true;

    // Allow user GK dive choice on defending away penalty
    if (r.kind === 'penalty' && r.side === 'away' && userT > 0 && userInput) {
      const m = userInput.moveVec || { x: 0, z: 0 };
      if (m.z > 0.22) r.gkDiveChoice = 1;
      else if (m.z < -0.22) r.gkDiveChoice = -1;
      else if (Math.abs(m.x) > 0.25) r.gkDiveChoice = 0;
    }

    // Interactive aiming + power charge window for user-controlled set pieces
    const proPlayer = playerLock.enabled ? findProPlayer() : null;
    if (r.side === 'home' && userT > 0 && (!playerLock.enabled || r.taker === proPlayer)) {
      const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
      const mLen = Math.hypot(m.x, m.z);
      if (mLen > 0.15) {
        if (r.kind === 'penalty') {
          r.aimZ = clamp(r.aimZ + (m.z / mLen) * 5.2 * dt, -3.25, 3.25);
        } else if (r.kind === 'free_kick' && d2(r.x, r.z, dir * HALF_X, 0) < 35) {
          r.aimZ = clamp(r.aimZ + (m.z / mLen) * 5.2 * dt, -3.3, 3.3);
          r.aimX = clamp(r.aimX + (m.x / mLen) * 8.0 * dt, Math.min(dir * HALF_X, r.x), Math.max(dir * HALF_X, r.x));
        } else {
          r.aimX = clamp(r.aimX + (m.x / mLen) * 16 * dt, -HALF_X + 2, HALF_X - 2);
          r.aimZ = clamp(r.aimZ + (m.z / mLen) * 16 * dt, -HALF_Z + 2, HALF_Z - 2);
        }
      }

      const kc = state.kickCharge;
      const heldChoice = userInput && (userInput.holdShoot ? 'shoot'
        : userInput.holdLob ? 'lofted'
          : userInput.holdThrough ? 'through'
            : userInput.holdPass ? 'pass' : null);
      const tapChoice = userInput && (userInput.shootPressed ? 'shoot'
        : userInput.loftedPressed ? 'lofted'
          : userInput.throughPressed ? 'through'
            : userInput.passPressed ? 'pass' : null);

      if (!kc.active) {
        r.autoT -= dt;
        if (heldChoice) {
          kc.active = true;
          kc.kind = r.kind;
          kc.subChoice = heldChoice;
          kc.value = 0.10;
          chargeHoldTime = 0;
        } else if (tapChoice) {
          kc.displayKind = r.kind;
          kc.displayValue = 0.55;
          kc.fadeT = 0.35;
          executeSetPieceKick(r, true, tapChoice, 0.55);
          return;
        }
        if (r.autoT > 0) return;
      } else {
        if (heldChoice === kc.subChoice) {
          chargeHoldTime += dt;
          kc.value = clamp(chargeHoldTime / 0.62, 0.10, 1.0);
          r.power = kc.value;
          if (chargeHoldTime >= 0.85) {
            const sub = kc.subChoice;
            kc.active = false;
            kc.displayKind = r.kind;
            kc.displayValue = 1.0;
            kc.fadeT = 0.38;
            chargeHoldTime = 0;
            executeSetPieceKick(r, true, sub, 1.0);
          }
          return;
        } else {
          const sub = kc.subChoice || 'pass';
          const pwr = clamp(0.28 + kc.value * 0.72, 0.28, 1.0);
          kc.active = false;
          kc.displayKind = r.kind;
          kc.displayValue = pwr;
          kc.fadeT = 0.38;
          chargeHoldTime = 0;
          executeSetPieceKick(r, true, sub, pwr);
          return;
        }
      }
    }

    // AI (or capture / idle fallback) takes a calm beat before delivering set piece
    r.aiWaitT -= dt;
    if (r.aiWaitT > 0) return;

    executeSetPieceKick(r, false, r.kind === 'penalty' ? 'shoot' : 'pass', 0.65);
  }

  function checkBounds() {
    const r = ball.radius || 0.11;
    const bx = ball.pos.x, bz = ball.pos.z, by = ball.pos.y;
    if (Math.abs(bx) > HALF_X + r * 0.6) {
      const inFrame = Math.abs(bz) < GOAL.width / 2 - 0.03 && by < GOAL.height - 0.03;
      if (inFrame && Math.abs(bx) < HALF_X + GOAL.depth + 1) {
        onGoal(bx > 0);
      } else {
        if (sinceShot < 2.6 && Math.abs(bz) < 5.6 && by < 3.6) {
          emit('near_miss', { side: bx > 0 ? 'E' : 'W', pos: { x: bx, y: by, z: bz } });
        }
        onOut(bx, bz, true);
      }
      return true;
    }
    if (Math.abs(bz) > HALF_Z + r * 0.6) { onOut(bx, bz, false); return true; }
    return false;
  }

  function onGoal(plusX) {
    if (refSys && refSys.clearAdvantage) refSys.clearAdvantage();
    const side = plusX === (state.attackDirHome > 0) ? 'home' : 'away';
    state.score[side]++;
    state.phase = 'goal';
    state.setPieceType = null;
    goalT = 4.3;
    state.excitement = 1;
    shot = null; passTarget = null; offsideWatch = null; activeWall = null;
    pending.length = 0;
    releaseBall();
    ball.vel.multiplyScalar(0.22);
    kickoffNext = other(side);
    const ownGoal = !!(lastKicker && lastKicker.team !== side);
    const scorer = ownGoal
      ? lastKicker
      : (lastKicker && lastKicker.team === side
        ? lastKicker
        : (squads[side].out.filter(isActive).sort((a, b) => statVal(b, 'shoot') - statVal(a, 'shoot'))[0] || squads[side].out[squads[side].out.length - 1]));
    const celebrator = ownGoal
      ? (squads[side].out.filter(isActive).sort((a, b) => ballDist(a) - ballDist(b))[0] || squads[side].out[0])
      : scorer;
    let assister = null;
    if (!ownGoal && assistCandidate && assistCandidate.side === side && assistCandidate.passer !== scorer && (state.clockSec - assistCandidate.t) < 24) {
      assister = assistCandidate.passer;
    }
    const scPf = getPerf(scorer);
    if (scPf) {
      if (ownGoal) scPf.ownGoals++;
      else scPf.goals++;
    }
    if (assister) {
      const asPf = getPerf(assister);
      if (asPf) asPf.assists++;
    }
    const defSide = other(side);
    const gkDefPf = getPerf(squads[defSide].gk);
    if (gkDefPf) gkDefPf.goalsConceded++;
    for (const dp of squads[defSide].out) {
      if (dp.role === 'DF' && isActive(dp)) {
        const dpf = getPerf(dp);
        if (dpf) dpf.goalsConceded++;
      }
    }
    matchEvents.push({
      min: Math.max(1, Math.min(90, Math.ceil(state.clockSec / 60))),
      type: ownGoal ? 'own_goal' : 'goal',
      team: side,
      playerId: scorer ? scorer.id : null,
      playerName: scorer ? (scorer.fullName || scorer.name) : '',
      assistName: assister ? (assister.fullName || assister.name) : null,
    });
    assistCandidate = null;
    lastPassMeta = null;
    emit('goal', {
      team: side,
      ownGoal,
      scorer: scorer ? { number: scorer.number, name: ownGoal ? `${scorer.name} (OG)` : scorer.name } : null,
      assist: assister ? { number: assister.number, name: assister.name } : null,
      score: { home: state.score.home, away: state.score.away },
    });
    if (celebrator && isActive(celebrator)) celebrator.playAction('celebrate');
    const mates = squads[side].out
      .filter((p) => p !== celebrator && isActive(p))
      .sort((a, b) => pdist(a, celebrator) - pdist(b, celebrator))
      .slice(0, 2);
    mates.forEach((m, i) =>
      pending.push({ t: 0.25 + i * 0.2, fn: () => { if (!m.actionBusy()) m.playAction('celebrate'); } }));
  }

  function onOut(bx, bz, goalLine) {
    if (refSys && refSys.clearAdvantage) refSys.clearAdvantage();
    if (goalLine) {
      // Determine which team is defending this goal line (+X or -X)
      const defSide = Math.sign(bx) === dirFor('home') ? 'away' : 'home';
      const restartSide = lastTouchSide === defSide ? other(defSide) : defSide;
      if (lastTouchSide === defSide) {
        // Corner kick!
        const cx = Math.sign(bx) * (HALF_X - 0.55);
        const cz = (bz >= 0 ? 1 : -1) * (HALF_Z - 0.55);
        state.stats[restartSide].corners++;
        emit('corner', { team: restartSide });
        emit('whistle', { reason: 'corner' });
        setupSetPiece('corner', restartSide, cx, cz, false);
      } else {
        // Goal kick!
        const dirR = dirFor(restartSide);
        const gx = -dirR * (HALF_X - PITCH.sixBoxDepth);
        const gz = clamp(bz, -5.5, 5.5);
        emit('out', { team: restartSide, x: gx, z: gz, throwIn: false, goalKick: true });
        emit('whistle', { reason: 'out' });
        setupSetPiece('goal_kick', restartSide, gx, gz, false);
      }
      return;
    }

    // Touchline throw-in
    const restartSide = other(lastTouchSide || 'home');
    const x = clamp(bx, -HALF_X + 1.2, HALF_X - 1.2);
    const z = (bz >= 0 ? 1 : -1) * (HALF_Z - 0.12);
    emit('out', { team: restartSide, x, z, throwIn: true });
    emit('whistle', { reason: 'out' });
    setupSetPiece('throw_in', restartSide, x, z, true);
  }

  // ---- kickoff -------------------------------------------------------------
  function placeKickoff(side) {
    if (refSys && refSys.clearAdvantage) refSys.clearAdvantage();
    state.phase = 'kickoff';
    state.setPieceType = null;
    kickoffSide = side;
    kickoffT = 0.8;
    releaseBall();
    passTarget = null; shot = null; restart = null; offsideWatch = null; activeWall = null; gkDist = null;
    oneTwoMap.clear();
    deceivedMap.clear();
    attackingRuns.clear();
    autoRunScanCd = 0;
    proPassCooldown = 0;
    defLineCache.home = -33;
    defLineCache.away = -33;
    fakeShotConsumeT = 0;
    pending.length = 0;
    ball.place(0, 0);
    if (ball.stopDead) ball.stopDead();
    for (const s of ['home', 'away']) {
      const sq = squads[s];
      const dir = dirFor(s);
      const kicking = s === side;
      sq.gk.pos.set(dir * -50.5, 0, 0);
      sq.gk.vel.set(0, 0, 0);
      sq.gk.stop();
      sq.gk.face(ball.pos);
      const form = teamFormations[s] || FORMATIONS_3D['4-3-3'];
      let takerIdx = form.findIndex((sl) => sl.line === 'FW' && Math.abs(sl.z) < 10);
      if (takerIdx < 0) takerIdx = form.length - 1;
      let partnerIdx = form.findIndex((sl, idx) => idx !== takerIdx && (sl.line === 'FW' || sl.line === 'MF') && sl.z <= 0);
      if (partnerIdx < 0) partnerIdx = Math.max(0, takerIdx - 1);
      sq.out.forEach((p, i) => {
        if (!isActive(p)) {
          p.stop();
          p.pos.set(clamp(p.pos.x, -40, 40), 0, -HALF_Z - 3.5);
          p.vel.set(0, 0, 0);
          return;
        }
        const base = form[Math.min(i, form.length - 1)];
        let x = base.x * 0.82, z = base.z * 0.85;
        x = Math.min(x, -3.2);
        if (!kicking && Math.hypot(x, z) < 10.2)
          x = -Math.sqrt(Math.max(1, 104 - z * z)) - 0.6;
        if (kicking && i === takerIdx) { x = -1.1; z = 0.25; }
        if (kicking && i === partnerIdx) { x = -1.9; z = -2.8; }
        p.pos.set(dir * x, 0, z);
        p.vel.set(0, 0, 0);
        p.stop();
        p.face(ball.pos);
      });
    }
    if (referee) {
      referee.pos.set(-2.5, 0, -7);
      referee.vel.set(0, 0, 0);
      referee.stop();
      referee.face(ball.pos);
    }
    emit('whistle', { reason: 'kickoff', half: state.half });
  }

  function updateKickoff(dt) {
    kickoffT -= dt;
    if (kickoffT > 0) return;
    const sq = squads[kickoffSide];
    const form = teamFormations[kickoffSide] || FORMATIONS_3D['4-3-3'];
    let takerIdx = form.findIndex((sl) => sl.line === 'FW' && Math.abs(sl.z) < 10);
    if (takerIdx < 0) takerIdx = form.length - 1;
    let cdmIdx = form.findIndex((sl) => sl.line === 'MF' && Math.abs(sl.z) < 10);
    if (cdmIdx < 0) cdmIdx = form.findIndex((sl, idx) => idx !== takerIdx && sl.line === 'MF');
    if (cdmIdx < 0) cdmIdx = Math.max(0, takerIdx - 1);
    let taker = sq.out[Math.min(takerIdx, sq.out.length - 1)];
    if (!isActive(taker)) taker = sq.out.find(isActive) || sq.gk;
    let cdm = sq.out[Math.min(cdmIdx, sq.out.length - 1)];
    if (!isActive(cdm) || cdm === taker) cdm = sq.out.find((p) => isActive(p) && p !== taker) || sq.gk;
    state.phase = 'play';
    state.possession = kickoffSide;
    sinceShot = 0;
    state.excitement = Math.max(state.excitement, 0.3);
    const ax = cdm.pos.x, az = cdm.pos.z;
    const dx = ax - ball.pos.x, dz = az - ball.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const speed = clamp(dist * 0.62 + 7, 11, 16);
    TMP.set((dx / dist) * speed, 0.2, (dz / dist) * speed);
    lockPlayer = taker; kickLock = 0.4;
    kickBall(taker, TMP, null, 'pass', 0.12, () => { passTarget = cdm; passT = 0; });
    passTarget = cdm; passT = 0;
    emit('kickoff', { team: kickoffSide, half: state.half });
  }

  // ---- public --------------------------------------------------------------
  function setUserInput(input) {
    userInput = input || null;
    if (!input) return;

    if (input.tacticalSet && TACTICAL_PRESETS.includes(input.tacticalSet)) {
      setTacticalPreset(input.tacticalSet);
    } else if (input.mentalitySet && input.mentalitySet !== state.mentality) {
      state.mentality = input.mentalitySet;
      state.tacticalPreset = input.mentalitySet === 'att' ? 'press' : input.mentalitySet === 'def' ? 'bus' : 'bal';
      emit('mentality', { mentality: state.mentality, preset: state.tacticalPreset });
    } else if (input.mentalityCycle) {
      const idx = (TACTICAL_PRESETS.indexOf(state.tacticalPreset) + 1) % TACTICAL_PRESETS.length;
      setTacticalPreset(TACTICAL_PRESETS[idx]);
    }
    if (input.offsideTrapPressed) {
      triggerOffsideTrap();
    }

    const m = input.moveVec || { x: 0, z: 0 };
    const mLen = Math.hypot(m.x, m.z);
    if (passGrace.timer > 0) {
      if (mLen <= 0.15) {
        passGrace.timer = 0;
        passGrace.hadAim = false;
      } else if (passGrace.hadAim) {
        const dotGrace = (m.x / mLen) * passGrace.aimX + (m.z / mLen) * passGrace.aimZ;
        if (dotGrace < 0.72) {
          passGrace.timer = 0;
          passGrace.hadAim = false;
        }
      }
    }
    if (mLen > 0.05 || input.passPressed || input.shootPressed ||
        input.throughPressed || input.loftedPressed || input.switchPressed ||
        input.standTacklePressed || input.slideTacklePressed ||
        input.holdPass || input.holdShoot || input.holdThrough || input.holdLob ||
        input.modifier || input.chipMod || input.gkRush || input.pressAssist ||
        input.skillStepoverPressed || input.skillRoulettePressed || input.skillBallRollPressed ||
        input.skillElasticoPressed)
      userT = 3;

    // 780ms action input buffer + 880ms wide pre-arrival one-touch tap/hold queue
    if (state.phase === 'play') {
      const cp = match.controlledPlayer;
      const preQueueEligible = !controller && cp &&
        (isReceivingMode(cp) || cp === lockPlayer || magnetState.player === cp || ballDist(cp) < 20.0);

      let pressedKind = null;
      if (input.passPressed) {
        inputBuf.passT = 0.78; inputBuf.mod = !!input.modifier; inputBuf.aimX = m.x; inputBuf.aimZ = m.z;
        pressedKind = 'pass';
      }
      if (input.throughPressed) {
        inputBuf.throughT = 0.78; inputBuf.mod = !!input.modifier; inputBuf.aimX = m.x; inputBuf.aimZ = m.z;
        pressedKind = 'through';
      }
      if (input.loftedPressed) {
        inputBuf.loftedT = 0.78; inputBuf.mod = !!input.modifier; inputBuf.aimX = m.x; inputBuf.aimZ = m.z;
        pressedKind = 'lofted';
      }
      if (input.shootPressed) {
        inputBuf.shootT = 0.78; inputBuf.mod = !!input.modifier; inputBuf.chip = !!input.chipMod; inputBuf.aimX = m.x; inputBuf.aimZ = m.z;
        pressedKind = 'shoot';
      }

      if (preQueueEligible) {
        const heldK = input.holdShoot ? 'shoot'
          : input.holdLob ? 'lofted'
            : input.holdThrough ? 'through'
              : input.holdPass ? 'pass' : null;
        if (heldK) {
          if (preQueue.holdKind !== heldK) {
            preQueue.holdKind = heldK;
            preQueue.holdTime = 0;
          }
          preQueue.kind = heldK;
          preQueue.power = clamp(0.38 + preQueue.holdTime * 1.15, 0.38, 0.94);
          preQueue.mod = !!input.modifier;
          preQueue.chip = !!input.chipMod;
          preQueue.aimX = m.x;
          preQueue.aimZ = m.z;
          preQueue.t = 0.88;
        } else {
          preQueue.holdKind = null;
          preQueue.holdTime = 0;
          if (pressedKind) {
            preQueue.kind = pressedKind;
            preQueue.power = pressedKind === 'shoot' ? 0.62 : 0.56;
            preQueue.mod = !!input.modifier;
            preQueue.chip = !!input.chipMod;
            preQueue.aimX = m.x;
            preQueue.aimZ = m.z;
            preQueue.t = 0.88;
          }
        }
      } else if (controller) {
        preQueue.holdKind = null;
        preQueue.holdTime = 0;
      }
    }

    // Buffer aerial intent when ball is in the air near user's controlled player
    if (!controller && ball.pos.y > 0.85 && match.controlledPlayer && ballDist(match.controlledPlayer) < 7.5) {
      if (input.shootPressed) aerialIntent = { kind: 'shoot', dirX: m.x, dirZ: m.z, t: 0.55 };
      else if (input.loftedPressed) aerialIntent = { kind: 'lofted', dirX: m.x, dirZ: m.z, t: 0.55 };
      else if (input.throughPressed) aerialIntent = { kind: 'through', dirX: m.x, dirZ: m.z, t: 0.55 };
      else if (input.passPressed) aerialIntent = { kind: 'pass', dirX: m.x, dirZ: m.z, t: 0.55 };
    }

    // Player-Lock Call-for-Pass when an AI teammate holds the ball on user's team
    if (playerLock.enabled && state.phase === 'play' && controller && controller.team === 'home' && controller !== match.controlledPlayer) {
      if (input.passPressed || input.throughPressed || input.loftedPressed) {
        callForPassReq.active = true;
        callForPassReq.kind = input.loftedPressed ? 'lofted' : input.throughPressed ? 'through' : 'pass';
        callForPassReq.t = 1.25;
        clearInputBuffers();
        const pro = findProPlayer();
        emit('call_pass', { kind: callForPassReq.kind, from: pro ? pro.id : null });
        return;
      }
    }

    // Manual Forward Run Trigger (KeyQ / KeyT / Gamepad L1 / BTN.L) during possession
    if (state.phase === 'play' && state.possession === 'home') {
      const runTriggered = !!input.triggerRunPressed ||
        (!!input.switchPressed && (!controller || controller.team === 'home'));
      if (runTriggered) {
        const source = (playerLock.enabled ? findProPlayer() : controller) || match.controlledPlayer;
        if (source) {
          triggerForwardRun(source, m.x, m.z);
        }
      }
    }

    // Q switches players only when user team doesn't hold the ball (on-ball Q is Chip modifier)
    if (input.switchPressed && !playerLock.enabled && (!controller || controller.team !== 'home')) {
      switchControlled();
    }
  }

  // ---- Playable 3D Training Drill Engine ----------------------------------
  const drillZoneMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(2.4, 1.85, 0.38),
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const drillZoneMesh = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 40), drillZoneMat);
  drillZoneMesh.rotation.x = -Math.PI / 2;
  drillZoneMesh.position.y = 0.04;
  drillZoneMesh.renderOrder = 4;
  drillZoneMesh.visible = false;
  ctx.scene.add(drillZoneMesh);

  const drillRuntime = {
    active: false,
    id: 'finishing',
    pro: null,
    mates: [],
    opps: [],
    gk: null,
    repTimer: 0,
    pauseT: 0,
    gateIdx: 0,
    gates: [],
    prevTackles: 0,
    skillBonusCd: 0,
    emittedFinish: false,
  };

  function parkDrillUnused() {
    for (const s of ['home', 'away']) {
      for (const p of squads[s].all) {
        p.drillOff = true;
        p.stop();
        p.holdingBall = false;
        p.pos.set(0, 0, -HALF_Z - 5.5);
        p.vel.set(0, 0, 0);
      }
    }
    if (referee) {
      referee.stop();
      referee.pos.set(0, 0, -HALF_Z - 7);
      referee.vel.set(0, 0, 0);
    }
  }

  function computeDrillGrade(id, score) {
    const cfg = DRILL_THRESHOLDS[id] || DRILL_THRESHOLDS.finishing;
    if (score >= cfg.elite) return 'Elite';
    if (score >= cfg.gold) return 'Gold';
    if (score >= cfg.silver) return 'Silver';
    return 'Bronze';
  }

  function setupDrillRep() {
    if (!drillRuntime.active) return;
    const id = drillRuntime.id;
    const pro = drillRuntime.pro;
    const rep = state.drill.reps;
    state.drill.reps++;
    drillRuntime.repTimer = 0;
    drillRuntime.pauseT = 0;
    drillRuntime.skillBonusCd = 0;
    releaseBall();
    shot = null;
    passTarget = null;
    offsideWatch = null;
    activeKick = null;
    pending.length = 0;
    deceivedMap.clear();
    oneTwoMap.clear();
    attackingRuns.clear();
    autoRunScanCd = 0;
    proPassCooldown = 0;
    if (ball.stopDead) ball.stopDead();

    parkDrillUnused();

    if (id === 'finishing') {
      const zOff = ((rep % 3) - 1) * 6.5;
      const xStart = 25 + (rep % 2) * 4;
      pro.drillOff = false;
      pro.pos.set(xStart, 0, zOff);
      pro.vel.set(0, 0, 0);
      pro.face(0);
      pro.stamina = 1;

      const gk = squads.away.gk;
      gk.drillOff = false;
      gk.pos.set(50.8, 0, 0);
      gk.vel.set(0, 0, 0);
      gk.face(Math.PI);
      drillRuntime.gk = gk;

      const def = squads.away.out[1] || squads.away.out[0];
      def.drillOff = false;
      def.pos.set(37.5, 0, -zOff * 0.35);
      def.vel.set(0, 0, 0);
      def.face(Math.PI);
      drillRuntime.opps = [def];
      drillRuntime.mates = [];

      ball.place(xStart + 0.55, zOff);
      gainControl(pro);
      settleT = 0;
      drillZoneMesh.visible = true;
      drillZoneMesh.position.set(49.5, 0.04, zOff > 0 ? -2.2 : 2.2);
      drillZoneMat.color.setRGB(2.4, 1.85, 0.38);
    } else if (id === 'passing') {
      const sideSign = rep % 2 === 0 ? 1 : -1;
      pro.drillOff = false;
      pro.pos.set(6, 0, sideSign * 4);
      pro.vel.set(0, 0, 0);
      pro.face(0);
      pro.stamina = 1;

      const m1 = squads.home.out[8] || squads.home.out[squads.home.out.length - 1];
      const m2 = squads.home.out.find((p) => p !== pro && p !== m1) || squads.home.out[7];
      m1.drillOff = false;
      m1.pos.set(21, 0, -sideSign * 8);
      m1.vel.set(0, 0, 0);
      m1.face(0);

      m2.drillOff = false;
      m2.pos.set(19, 0, sideSign * 11);
      m2.vel.set(0, 0, 0);
      m2.face(0);
      drillRuntime.mates = [m1, m2];

      const d1 = squads.away.out[1] || squads.away.out[0];
      const d2p = squads.away.out[2] || squads.away.out[1];
      d1.drillOff = false;
      d1.pos.set(17, 0, -sideSign * 3.2);
      d1.vel.set(0, 0, 0);
      d1.face(Math.PI);

      d2p.drillOff = false;
      d2p.pos.set(25, 0, sideSign * 5.2);
      d2p.vel.set(0, 0, 0);
      d2p.face(Math.PI);
      drillRuntime.opps = [d1, d2p];

      const gk = squads.away.gk;
      gk.drillOff = false;
      gk.pos.set(50.8, 0, 0);
      gk.face(Math.PI);
      drillRuntime.gk = gk;

      ball.place(6.55, sideSign * 4);
      gainControl(pro);
      settleT = 0;
      drillZoneMesh.visible = true;
      drillZoneMesh.position.set(31, 0.04, -sideSign * 6.5);
      drillZoneMat.color.setRGB(0.38, 2.15, 2.4);
    } else if (id === 'dribbling') {
      const flip = rep % 2 === 0 ? 1 : -1;
      pro.drillOff = false;
      pro.pos.set(12, 0, -10 * flip);
      pro.vel.set(0, 0, 0);
      pro.face(0);
      pro.stamina = 1;

      const d1 = squads.away.out[1] || squads.away.out[0];
      const d2p = squads.away.out[2] || squads.away.out[1];
      d1.drillOff = false;
      d1.pos.set(22, 0, 1.5 * flip);
      d1.vel.set(0, 0, 0);
      d1.face(Math.PI);
      d2p.drillOff = false;
      d2p.pos.set(34, 0, -2.5 * flip);
      d2p.vel.set(0, 0, 0);
      d2p.face(Math.PI);
      drillRuntime.opps = [d1, d2p];
      drillRuntime.mates = [];

      const gk = squads.away.gk;
      gk.drillOff = false;
      gk.pos.set(50.8, 0, 0);
      gk.face(Math.PI);
      drillRuntime.gk = gk;

      drillRuntime.gates = [
        { x: 21, z: 5.5 * flip },
        { x: 31, z: -5.5 * flip },
        { x: 41, z: 3.0 * flip },
      ];
      drillRuntime.gateIdx = 0;

      ball.place(12.55, -10 * flip);
      gainControl(pro);
      settleT = 0;
      drillZoneMesh.visible = true;
      drillZoneMesh.position.set(drillRuntime.gates[0].x, 0.04, drillRuntime.gates[0].z);
      drillZoneMat.color.setRGB(0.45, 2.35, 1.15);
    } else if (id === 'defending') {
      const sideSign = rep % 2 === 0 ? 1 : -1;
      pro.drillOff = false;
      pro.pos.set(-14, 0, sideSign * 2.5);
      pro.vel.set(0, 0, 0);
      pro.face(0);
      pro.stamina = 1;

      const gk = squads.home.gk;
      gk.drillOff = false;
      gk.pos.set(-50.5, 0, 0);
      gk.vel.set(0, 0, 0);
      gk.face(0);
      drillRuntime.gk = gk;

      const a1 = squads.away.out[8] || squads.away.out[squads.away.out.length - 1];
      const a2 = squads.away.out[9] || squads.away.out[7];
      a1.drillOff = false;
      a1.pos.set(2, 0, sideSign * 6.0);
      a1.vel.set(0, 0, 0);
      a1.face(Math.PI);

      a2.drillOff = false;
      a2.pos.set(0, 0, -sideSign * 7.5);
      a2.vel.set(0, 0, 0);
      a2.face(Math.PI);
      drillRuntime.opps = [a1, a2];
      drillRuntime.mates = [];

      ball.place(1.4, sideSign * 6.0);
      gainControl(a1);
      settleT = 0.25;
      drillZoneMesh.visible = true;
      drillZoneMesh.position.set(a1.pos.x, 0.04, a1.pos.z);
      drillZoneMat.color.setRGB(2.4, 0.55, 0.45);
    }

    match.controlledPlayer = pro;
    userT = 3.0;
    const pf = getPerf(pro);
    drillRuntime.prevTackles = pf ? pf.tacklesWon : 0;
  }

  function awardDrillPoints(pts, label) {
    state.drill.hits++;
    state.drill.streak++;
    if (state.drill.streak > state.drill.bestStreak) state.drill.bestStreak = state.drill.streak;
    const streakBonus = (state.drill.streak - 1) * 20;
    const total = pts + streakBonus;
    state.drill.score += total;
    state.drill.grade = computeDrillGrade(drillRuntime.id, state.drill.score);
    emit('drill_hit', { label, points: total, streak: state.drill.streak });
  }

  function failDrillRep() {
    state.drill.streak = 0;
    drillRuntime.pauseT = 0.65;
  }

  function startDrill(cfg = {}) {
    syncSquads();
    resetPerf();
    const id = DRILL_THRESHOLDS[cfg.drillId] ? cfg.drillId : 'finishing';
    const metaDef = DRILL_THRESHOLDS[id];
    const pro = findProPlayer() || squads.home.out[8] || squads.home.out[squads.home.out.length - 1];

    drillRuntime.active = true;
    drillRuntime.id = id;
    drillRuntime.pro = pro;
    drillRuntime.emittedFinish = false;

    state.phase = 'play';
    state.attackDirHome = 1;
    state.score.home = 0;
    state.score.away = 0;
    state.clockSec = 0;
    state.excitement = 0.55;
    state.ctxHint = '';
    playerLock.enabled = true;
    playerLock.playerId = pro ? pro.id : null;
    state.playerLock = true;

    state.drill.active = true;
    state.drill.id = id;
    state.drill.title = metaDef.title;
    state.drill.subtitle = cfg.subtitle || 'TRAINING PITCH';
    state.drill.duration = cfg.duration || 45;
    state.drill.timeLeft = state.drill.duration;
    state.drill.score = 0;
    state.drill.reps = 0;
    state.drill.hits = 0;
    state.drill.streak = 0;
    state.drill.bestStreak = 0;
    state.drill.grade = 'Bronze';
    state.drill.finished = false;
    state.drill.prompt = metaDef.prompt;

    setupDrillRep();
    syncTelemetry();
  }

  function exitDrill() {
    drillRuntime.active = false;
    state.drill.active = false;
    state.drill.finished = false;
    drillZoneMesh.visible = false;
    for (const s of ['home', 'away']) {
      for (const p of squads[s].all) p.drillOff = false;
    }
  }

  function getDrillReport() {
    return {
      drillId: state.drill.id,
      title: state.drill.title,
      score: state.drill.score,
      reps: state.drill.reps,
      hits: state.drill.hits,
      bestStreak: state.drill.bestStreak,
      grade: computeDrillGrade(state.drill.id, state.drill.score),
    };
  }

  function updateDrill(dt) {
    const pro = drillRuntime.pro;
    if (!pro) return;

    if (state.drill.finished) {
      for (const s of ['home', 'away']) {
        for (const p of squads[s].all) p.stop();
      }
      if (!drillRuntime.emittedFinish) {
        drillRuntime.emittedFinish = true;
        drillZoneMesh.visible = false;
        releaseBall();
        emit('drill_complete', getDrillReport());
      }
      updateIndicator(dt);
      syncTelemetry();
      return;
    }

    state.drill.timeLeft = Math.max(0, state.drill.timeLeft - dt);
    if (state.drill.timeLeft <= 0) {
      state.drill.finished = true;
      state.drill.grade = computeDrillGrade(drillRuntime.id, state.drill.score);
      syncTelemetry();
      return;
    }

    if (drillRuntime.pauseT > 0) {
      drillRuntime.pauseT -= dt;
      if (drillRuntime.pauseT <= 0) setupDrillRep();
      updateIndicator(dt);
      syncTelemetry();
      return;
    }

    drillRuntime.repTimer += dt;
    drillRuntime.skillBonusCd = Math.max(0, drillRuntime.skillBonusCd - dt);
    userT = 1.5;

    const id = drillRuntime.id;
    // Animate pulsing zone mesh
    const pulseS = 1.0 + 0.08 * Math.sin(drillRuntime.repTimer * 6.0);
    drillZoneMesh.scale.setScalar(pulseS);

    // Pro AI vs user handling + drill-specific participant movement
    if (controller) {
      if (controller === pro) {
        dribbleBall(pro, dt);
        userCarrier(pro, dt);
      } else if (controller.team === 'away') {
        dribbleBall(controller, dt);
        // Away attacker in defending drill dribbles toward home goal (-X)
        const tx = clamp(controller.pos.x - 6.0, -HALF_X + 6, HALF_X - 4);
        const tz = clamp(controller.pos.z * 0.72, -10, 10);
        controller.moveTo(tgtOf(controller).set(tx, 0, tz), 0.78);
        controller.face(tgtOf(controller));
        if (controller.pos.x < -31 && rng() < 0.08) {
          doShoot(controller, 0.65, 'normal', null);
        }
      } else {
        dribbleBall(controller, dt);
        controller.stop();
      }
    } else {
      claims();
    }

    // Move drill user when off-ball
    if (controller !== pro) {
      userMove(pro, dt);
      userDefend(pro, dt);
    }

    // Drill-specific teammates & defenders
    for (const m of drillRuntime.mates) {
      if (!isActive(m) || m === controller || m === passTarget) continue;
      const runX = clamp(m.pos.x + 7.5 * dt + 2.5, 16, 44);
      m.moveTo(tgtOf(m).set(runX, 0, m.pos.z), 0.72);
      m.face(ball.pos);
    }
    if (passTarget && passTarget !== pro && isActive(passTarget)) {
      computePassMeetPoint(passTarget, _meetTmp);
      passTarget.moveTo(tgtOf(passTarget).set(_meetTmp.x, 0, _meetTmp.z), 0.96);
      passTarget.face(ball.pos);
    }

    for (const o of drillRuntime.opps) {
      if (!isActive(o) || o === controller) continue;
      if (id === 'defending') {
        const suppX = clamp(ball.pos.x - 3.5, -36, 12);
        const suppZ = -Math.sign(ball.pos.z || 1) * 7.5;
        o.moveTo(tgtOf(o).set(suppX, 0, suppZ), 0.74);
        o.face(ball.pos);
      } else {
        const tX = controller ? controller.pos.x : ball.pos.x;
        const tZ = controller ? controller.pos.z : ball.pos.z;
        const distO = d2(o.pos.x, o.pos.z, tX, tZ);
        const speedFrac = id === 'finishing' ? 0.68 : 0.75;
        if (distO < 0.98 && controller === pro && !deceivedMap.has(o)) {
          // Defender steals ball in finishing/dribbling drill
          gainControl(o);
          failDrillRep();
          break;
        }
        o.moveTo(tgtOf(o).set(tX, 0, tZ), speedFrac);
        o.face(ball.pos);
      }
    }

    // Goalkeeper positioning during finishing/passing/dribbling or defending drill
    const gk = drillRuntime.gk;
    if (gk && isActive(gk)) {
      const gkGoalX = id === 'defending' ? -50.6 : 50.6;
      const aimZ = clamp(ball.pos.z * 0.42, -3.1, 3.1);
      gk.moveTo(tgtOf(gk).set(gkGoalX, 0, aimZ), 0.85);
      gk.face(ball.pos);
      if (ballDist(gk) < 1.15 && controller !== gk) {
        failDrillRep();
      }
    }

    // Drill-specific win/fail evaluation
    const bx = ball.pos.x, bz = ball.pos.z, by = ball.pos.y;
    const outBounds = Math.abs(bx) > HALF_X + 0.2 || Math.abs(bz) > HALF_Z + 0.2;

    if (id === 'finishing') {
      const inGoal = bx > HALF_X + 0.08 && Math.abs(bz) < GOAL.width / 2 - 0.04 && by < GOAL.height - 0.04;
      if (inGoal) {
        const cornerBonus = (Math.abs(bz) > 1.65 || by > 1.05) ? 40 : 0;
        awardDrillPoints(100 + cornerBonus, cornerBonus ? 'TOP CORNER FINISH!' : 'CLINICAL FINISH!');
        drillRuntime.pauseT = 0.65;
      } else if (outBounds || drillRuntime.repTimer > 8.5 || (controller && controller.team === 'away')) {
        failDrillRep();
      }
    } else if (id === 'passing') {
      if (controller && controller.team === 'home' && controller !== pro && controller.role !== 'GK') {
        const inZone = d2(controller.pos.x, controller.pos.z, drillZoneMesh.position.x, drillZoneMesh.position.z) < 9.5;
        awardDrillPoints(85 + (inZone ? 35 : 0), inZone ? 'PRECISION THROUGH BALL!' : 'CLEAN PASS!');
        drillRuntime.pauseT = 0.6;
      } else if (outBounds || drillRuntime.repTimer > 8.5 || (controller && controller.team === 'away')) {
        failDrillRep();
      }
    } else if (id === 'dribbling') {
      if (skill && skill.player === pro && drillRuntime.skillBonusCd <= 0) {
        const nearOpp = drillRuntime.opps.some((o) => d2(o.pos.x, o.pos.z, pro.pos.x, pro.pos.z) < 4.5);
        if (nearOpp) {
          drillRuntime.skillBonusCd = 1.6;
          awardDrillPoints(35, 'SKILL BEAT MAN!');
        }
      }
      const gate = drillRuntime.gates[drillRuntime.gateIdx];
      if (gate && controller === pro && d2(pro.pos.x, pro.pos.z, gate.x, gate.z) < 2.4) {
        drillRuntime.gateIdx++;
        if (drillRuntime.gateIdx >= drillRuntime.gates.length) {
          awardDrillPoints(115, 'SLALOM CLEARED!');
          drillRuntime.pauseT = 0.55;
        } else {
          awardDrillPoints(60, `GATE ${drillRuntime.gateIdx}/3!`);
          const ng = drillRuntime.gates[drillRuntime.gateIdx];
          drillZoneMesh.position.set(ng.x, 0.04, ng.z);
        }
      } else if (outBounds || drillRuntime.repTimer > 11.5 || (controller && controller.team === 'away')) {
        failDrillRep();
      }
    } else if (id === 'defending') {
      const a0 = drillRuntime.opps[0];
      if (a0) drillZoneMesh.position.set(a0.pos.x, 0.04, a0.pos.z);
      const pf = getPerf(pro);
      const tackled = pf && pf.tacklesWon > drillRuntime.prevTackles;
      if (controller === pro || tackled) {
        awardDrillPoints(110, tackled ? 'CRUNCHING TACKLE!' : 'INTERCEPTED!');
        drillRuntime.pauseT = 0.6;
      } else if ((bx < -HALF_X && Math.abs(bz) < GOAL.width / 2) || outBounds || drillRuntime.repTimer > 9.5) {
        failDrillRep();
      }
    }

    updateIndicator(dt);
    syncTelemetry();
  }

  function restartMatch() {
    exitDrill();
    syncSquads();
    resetPerf();
    state.score.home = 0;
    state.score.away = 0;
    state.clockSec = 0;
    state.half = 1;
    state.attackDirHome = 1;
    state.mentality = 'bal';
    state.tacticalPreset = 'bal';
    state.offsideTrapT = 0;
    state.offsideTrapCd = 0;
    state.defLineHomeX = -33;
    state.shieldingActive = false;
    state.possession = null;
    state.excitement = 0.15;
    state.lastFoulImpulse = 0;
    state.gkHolding = false;
    state.ctxHint = '';
    state.kickCharge.active = false;
    state.kickCharge.fadeT = 0;
    state.kickCharge.timed = null;
    state.stats.home = emptyStats();
    state.stats.away = emptyStats();
    endWhistled = false;
    userT = 0;
    manualPick = null;
    manualT = 0;
    skill = null;
    skillCd = 0;
    evadePlayer = null;
    evadeT = 0;
    fakeShotConsumeT = 0;
    aerialIntent = null;
    clearInputBuffers();
    magnetState.player = null;
    magnetState.strength = 0;
    magnetState.mode = 'none';
    magnetState.queued = false;
    passGrace.timer = 0;
    passGrace.target = null;
    passGrace.hadAim = false;
    pursuitOverridden = false;
    prevMoveVec.x = 0;
    prevMoveVec.z = 0;
    callForPassReq.active = false;
    callForPassReq.t = 0;
    activeKick = null;
    gkDist = null;
    gkHoldTimer = 0;
    activeWall = null;
    counterBurstT = 0;
    sideCounterBurst.home = 0;
    sideCounterBurst.away = 0;
    lastPossTeam = null;
    gkRecoverMap.clear();
    deceivedMap.clear();
    switchSkip.clear();
    attackingRuns.clear();
    autoRunScanCd = 0;
    proPassCooldown = 0;
    defLineCache.home = -33;
    defLineCache.away = -33;
    for (const s of ['home', 'away']) {
      for (const p of squads[s].all) {
        p.stamina = 1.0;
        p.staminaCap = 1.0;
        p.yellowCards = 0;
        p.sentOff = false;
        p.holdingBall = false;
      }
    }
    refSys.reset();
    placeKickoff('home');
    pickControlled(1);
    syncTelemetry();
  }

  function update(dt) {
    kickLock = Math.max(0, kickLock - dt);
    userT = Math.max(0, userT - dt);
    passGrace.timer = Math.max(0, passGrace.timer - dt);
    skillCd = Math.max(0, skillCd - dt);
    evadeT = Math.max(0, evadeT - dt);
    fakeShotConsumeT = Math.max(0, fakeShotConsumeT - dt);
    inputBuf.passT = Math.max(0, inputBuf.passT - dt);
    inputBuf.throughT = Math.max(0, inputBuf.throughT - dt);
    inputBuf.loftedT = Math.max(0, inputBuf.loftedT - dt);
    inputBuf.shootT = Math.max(0, inputBuf.shootT - dt);
    proPassCooldown = Math.max(0, proPassCooldown - dt);
    autoRunScanCd = Math.max(0, autoRunScanCd - dt);
    if (callForPassReq.active) {
      callForPassReq.t -= dt;
      if (callForPassReq.t <= 0) callForPassReq.active = false;
    }
    if (preQueue.holdKind) preQueue.holdTime += dt;
    if (preQueue.t > 0) {
      preQueue.t = Math.max(0, preQueue.t - dt);
      if (preQueue.t <= 0) preQueue.kind = null;
    }
    magnetState.queued = !controller && !!(preQueue.t > 0 ||
      inputBuf.passT > 0 || inputBuf.throughT > 0 || inputBuf.loftedT > 0 || inputBuf.shootT > 0);
    state.offsideTrapT = Math.max(0, state.offsideTrapT - dt);
    state.offsideTrapCd = Math.max(0, state.offsideTrapCd - dt);
    counterBurstT = Math.max(0, counterBurstT - dt);
    sideCounterBurst.home = Math.max(0, sideCounterBurst.home - dt);
    sideCounterBurst.away = Math.max(0, sideCounterBurst.away - dt);
    state.kickCharge.fadeT = Math.max(0, state.kickCharge.fadeT - dt);
    if (!controller || controller !== match.controlledPlayer) state.shieldingActive = false;
    if (controller || state.phase !== 'play') {
      magnetState.player = null;
      magnetState.strength = 0;
      magnetState.mode = 'none';
    }
    if (state.possession && state.possession !== lastPossTeam) {
      if (state.possession === 'home' && state.tacticalPreset === 'counter') counterBurstT = 2.6;
      sideCounterBurst[state.possession] = 2.8;
      lastPossTeam = state.possession;
    }
    if (aerialIntent) {
      aerialIntent.t -= dt;
      if (aerialIntent.t <= 0) aerialIntent = null;
    }
    for (const [pl, rem] of oneTwoMap) {
      if (rem - dt <= 0) oneTwoMap.delete(pl);
      else oneTwoMap.set(pl, rem - dt);
    }
    for (const [pl, run] of attackingRuns) {
      run.t += dt;
      if (run.t >= run.maxT || state.possession !== pl.team || !isActive(pl)) {
        attackingRuns.delete(pl);
      }
    }
    for (const [dp, rec] of deceivedMap) {
      rec.t += dt;
      if (rec.t >= rec.dur || !isActive(dp)) deceivedMap.delete(dp);
    }
    for (const [sp, rem] of switchSkip) {
      if (rem - dt <= 0) switchSkip.delete(sp);
      else switchSkip.set(sp, rem - dt);
    }
    if (evadeT <= 0) evadePlayer = null;
    for (const m of meta.values()) m.tackleCd = Math.max(0, m.tackleCd - dt);
    updateActiveKick(dt);
    for (let i = pending.length - 1; i >= 0; i--) {
      pending[i].t -= dt;
      if (pending[i].t <= 0) { const f = pending[i].fn; pending.splice(i, 1); f(); }
    }

    if (drillRuntime.active) {
      updateDrill(dt);
      return;
    }

    state.excitement = clamp(state.excitement - 0.3 * dt, 0.12, 1);
    if (state.phase === 'goal') state.excitement = Math.max(state.excitement, 0.95);

    if (state.phase === 'play' || state.phase === 'out') {
      const clockRate = 2700 / (clamp(state.halfMinutes || 6, 1, 45) * 60);
      state.clockSec = Math.min(state.clockSec + clockRate * dt, 5400);
      if (state.half === 1 && state.clockSec >= 2700) {
        state.phase = 'halftime';
        state.setPieceType = null;
        halftimeT = 3.8;
        releaseBall();
        emit('whistle', { reason: 'halftime' });
        emit('halftime', { score: { ...state.score }, stats: state.stats });
        syncTelemetry();
        return;
      }
      if (state.clockSec >= 5400 && !endWhistled) {
        endWhistled = true;
        state.phase = 'fulltime';
        state.setPieceType = null;
        releaseBall();
        emit('whistle', { reason: 'fulltime' });
        emit('fulltime', { score: { ...state.score }, stats: state.stats });
        syncTelemetry();
        return;
      }
    }
    if (state.phase === 'play') sinceShot += dt;

    updateStamina(dt);

    switch (state.phase) {
      case 'kickoff':
        updateKickoff(dt);
        break;
      case 'halftime':
        halftimeT -= dt;
        for (const s of ['home', 'away']) {
          for (const p of squads[s].all) p.stop();
        }
        if (halftimeT <= 0) {
          state.half = 2;
          state.clockSec = 2700;
          state.attackDirHome *= -1;
          for (const s of ['home', 'away']) {
            for (const p of squads[s].all) {
              if (!isActive(p)) continue;
              p.staminaCap = clamp(p.staminaCap + 0.16, 0.82, 1.0);
              p.stamina = p.staminaCap;
            }
          }
          placeKickoff('away');
        }
        break;
      case 'fulltime':
        for (const s of ['home', 'away']) {
          for (const p of squads[s].all) p.stop();
        }
        break;
      case 'goal':
        goalT -= dt;
        for (const s of ['home', 'away']) {
          squads[s].out.forEach((p, i) => {
            if (!isActive(p) || p.actionBusy()) return;
            p.moveTo(spotFor(s, i, tgtOf(p)), 0.3);
          });
        }
        if (goalT <= 0) placeKickoff(kickoffNext);
        break;
      case 'out':
        updateRestart(dt);
        refSys.update(dt);
        break;
      case 'play': {
        if (checkBounds()) break;
        if (activeWall) {
          activeWall.t += dt;
          if (activeWall.t > 0.9 || !shot) {
            activeWall = null;
          } else if (!controller && ball.pos.y < 2.28) {
            for (const wp of activeWall.players) {
              if (!isActive(wp) || wp === lastKicker) continue;
              if (ballDist(wp) < 0.56) {
                ball.vel.x *= -0.42;
                ball.vel.z += (rng() - 0.5) * 4.5;
                ball.vel.y = clamp(Math.abs(ball.vel.y) + 2.8, 2.5, 6.2);
                shot = null; passTarget = null;
                lastKicker = wp; lastTouchSide = wp.team;
                emit('kick', { kind: 'pass', power: 0.48 });
                activeWall = null;
                break;
              }
            }
          }
        }
        refSys.update(dt);
        if (state.phase !== 'play') break;
        updateDefLines(dt);
        monitorShot(dt);

        // Automatic penetrating forward runs for attacking lines
        if (autoRunScanCd <= 0 && controller && state.possession === controller.team) {
          const sSide = controller.team;
          const sDir = dirFor(sSide);
          const sOppSide = other(sSide);
          const cFwd = controller.pos.x * sDir;
          if (cFwd > -18 && cFwd < HALF_X - 12) {
            let hasActiveRun = false;
            for (const [pl] of attackingRuns) {
              if (pl.team === sSide) { hasActiveRun = true; break; }
            }
            if (!hasActiveRun) {
              let oppLine2nd = sDir * HALF_X;
              let deep1 = -1e9, deep2 = -1e9;
              for (const o of squads[sOppSide].all) {
                if (!isActive(o)) continue;
                const ox = o.pos.x * sDir;
                if (ox > deep1) { deep2 = deep1; deep1 = ox; }
                else if (ox > deep2) { deep2 = ox; }
              }
              if (deep2 > -1e8) oppLine2nd = deep2;

              for (const fwd of squads[sSide].out) {
                if (!isActive(fwd) || fwd === controller || fwd.role !== 'FW') continue;
                if (playerLock.enabled && fwd.id === playerLock.playerId) continue;
                const fwdX = fwd.pos.x * sDir;
                if (fwdX > cFwd - 2.5 && fwdX < oppLine2nd + 0.35) {
                  const ahead = spaceAhead(fwd);
                  if (ahead > 3.0) {
                    const runDist = clamp(12.0 + (fwd.pace || 75) * 0.05, 10.0, 16.0);
                    const targetX = clamp(fwd.pos.x + sDir * runDist, -HALF_X + 2.5, HALF_X - 2.5);
                    let targetZ = fwd.pos.z;
                    if (Math.abs(fwd.pos.z) < 8.0) {
                      const cut = (Math.abs(fwd.pos.z) < 2.5) ? (rng() < 0.5 ? 4.0 : -4.0) : Math.sign(fwd.pos.z) * 3.5;
                      targetZ = clamp(fwd.pos.z + cut, -15, 15);
                    } else {
                      targetZ = clamp(fwd.pos.z * 0.82, -26, 26);
                    }
                    attackingRuns.set(fwd, {
                      targetX,
                      targetZ,
                      t: 0,
                      maxT: 2.7,
                      kind: 'auto',
                    });
                    autoRunScanCd = 2.2;
                    break;
                  }
                }
              }
            }
          }
        }

        if (controller) {
          carrierTick(controller, dt);
        } else {
          passT += dt;
          if (passTarget) {
            const toX = passTarget.pos.x - ball.pos.x;
            const toZ = passTarget.pos.z - ball.pos.z;
            const tLen = Math.hypot(toX, toZ);
            const bSp = ballSpeed();
            const movingAway = tLen > 6.5 && bSp > 2.2 && (ball.vel.x * toX + ball.vel.z * toZ) < -0.55 * tLen * bSp;
            if (movingAway || (bSp < 0.8 && ballDist(passTarget) > 10) || passT > 4.2) {
              passTarget = null;
              offsideWatch = null;
            }
          }
          if (!checkShotBodyCollisions(dt)) {
            claims();
          }
        }
        offBall(dt);
        resolveShoulderJostles(dt);
        pickControlled(dt);
        break;
      }
    }

    updateIndicator(dt);
    syncTelemetry();
  }

  // ---- "you are this player" marker, aim chevron & set-piece reticle/arc ---
  const indicator = new THREE.Group();
  indicator.visible = false;
  {
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.2, 0.35, 0.45),
      transparent: true, opacity: 0.9, toneMapped: false,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.58, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.renderOrder = 3;
    indicator.add(ring);

    const aimTri = new THREE.Shape();
    aimTri.moveTo(0.84, 0); aimTri.lineTo(0.64, 0.14); aimTri.lineTo(0.64, -0.14);
    const aimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.35, 1.9, 2.3),
      transparent: true, opacity: 0.85, toneMapped: false,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const aimMesh = new THREE.Mesh(new THREE.ShapeGeometry(aimTri), aimMat);
    aimMesh.rotation.x = -Math.PI / 2;
    aimMesh.position.y = 0.032;
    aimMesh.renderOrder = 3;
    const aimPivot = new THREE.Group();
    aimPivot.add(aimMesh);
    indicator.add(aimPivot);

    const tri = new THREE.Shape();
    tri.moveTo(-0.17, 0.25); tri.lineTo(0.17, 0.25); tri.lineTo(0, 0);
    const chevMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(2.6, 2.5, 2.2),
      transparent: true, opacity: 0.95, toneMapped: false,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const chev = new THREE.Mesh(new THREE.ShapeGeometry(tri), chevMat);
    chev.position.y = 2.12;
    chev.renderOrder = 3;
    indicator.add(chev);

    const pwrGroup = new THREE.Group();
    pwrGroup.position.y = 2.52;
    pwrGroup.visible = false;
    const pwrBgMat = new THREE.MeshBasicMaterial({
      color: 0x090d16, transparent: true, opacity: 0.85, toneMapped: false,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const pwrBg = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.12), pwrBgMat);
    pwrBg.renderOrder = 4;
    pwrGroup.add(pwrBg);

    const pwrFillGeo = new THREE.PlaneGeometry(0.82, 0.075);
    pwrFillGeo.translate(0.41, 0, 0.002);
    const pwrFillMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e, transparent: true, opacity: 0.96, toneMapped: false,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const pwrFill = new THREE.Mesh(pwrFillGeo, pwrFillMat);
    pwrFill.position.x = -0.41;
    pwrFill.renderOrder = 5;
    pwrGroup.add(pwrFill);
    indicator.add(pwrGroup);

    indicator.userData = { ring, chev, aimPivot, aimMat, ringMat, chevMat, pwrGroup, pwrFill, pwrFillMat, pwrBgMat, t: 0 };
  }
  ctx.scene.add(indicator);

  // Highlight ring under intended pass receiver
  const targetRingMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(0.4, 2.1, 2.4),
    transparent: true, opacity: 0.72, toneMapped: false,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), targetRingMat);
  targetRing.rotation.x = -Math.PI / 2;
  targetRing.position.y = 0.032;
  targetRing.renderOrder = 3;
  targetRing.visible = false;
  ctx.scene.add(targetRing);

  // Subtle tactical guide ring for Player-Lock off-ball positioning
  const proPosRingMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(0.45, 1.9, 1.4),
    transparent: true, opacity: 0.45, toneMapped: false,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const proPosRing = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.58, 28), proPosRingMat);
  proPosRing.rotation.x = -Math.PI / 2;
  proPosRing.position.y = 0.029;
  proPosRing.renderOrder = 3;
  proPosRing.visible = false;
  ctx.scene.add(proPosRing);
  const _tacticalSpot = v3();

  // Set-piece aiming reticle + ballistic trajectory preview arc (zero per-frame alloc)
  const reticleGroup = new THREE.Group();
  reticleGroup.visible = false;
  const retOuterMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(2.4, 1.85, 0.35),
    transparent: true, opacity: 0.9, toneMapped: false,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const retOuter = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.76, 36), retOuterMat);
  retOuter.rotation.x = -Math.PI / 2;
  retOuter.position.y = 0.04;
  retOuter.renderOrder = 4;
  reticleGroup.add(retOuter);
  const retDot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20), retOuterMat);
  retDot.rotation.x = -Math.PI / 2;
  retDot.position.y = 0.042;
  retDot.renderOrder = 4;
  reticleGroup.add(retDot);
  ctx.scene.add(reticleGroup);

  const ARC_SEGS = 28;
  const arcCoords = new Float32Array(ARC_SEGS * 3);
  const arcGeo = new THREE.BufferGeometry();
  const arcAttr = new THREE.BufferAttribute(arcCoords, 3);
  arcGeo.setAttribute('position', arcAttr);
  const arcMat = new THREE.LineBasicMaterial({
    color: new THREE.Color().setRGB(2.4, 1.9, 0.45),
    transparent: true, opacity: 0.72, toneMapped: false, depthWrite: false,
  });
  const arcLine = new THREE.Line(arcGeo, arcMat);
  arcLine.frustumCulled = false;
  arcLine.renderOrder = 4;
  arcLine.visible = false;
  ctx.scene.add(arcLine);

  function updateIndicator(dt) {
    const p = match.controlledPlayer;
    if (!p || !isActive(p)) {
      indicator.visible = false;
      targetRing.visible = false;
      proPosRing.visible = false;
      reticleGroup.visible = false;
      arcLine.visible = false;
      return;
    }
    indicator.visible = true;
    const u = indicator.userData;
    u.t += dt;
    indicator.position.set(p.pos.x, 0, p.pos.z);
    const active = userT > 0;
    const magnetOn = active && state.phase === 'play' && !controller && magnetState.player === p &&
      magnetState.mode !== 'carrier' && magnetState.strength > 0.14;
    const queueOn = active && state.phase === 'play' && !controller && magnetState.queued && isReceivingMode(p);
    const pulse = 0.82 + 0.18 * Math.sin(u.t * (active ? 6 : 2.4));
    u.chev.position.y = 2.12 + Math.sin(u.t * 3) * 0.05;
    if (queueOn) {
      u.ringMat.color.setRGB(2.35, 1.85, 0.42);
      u.ringMat.opacity = 0.96;
      u.ring.scale.setScalar(1.04 + 0.08 * Math.sin(u.t * 14));
    } else if (magnetOn) {
      const mMix = clamp(magnetState.strength * 1.65, 0.42, 0.90);
      u.ringMat.color.setRGB(lerp(2.2, 0.45, mMix), lerp(0.35, 2.05, mMix), lerp(0.45, 2.35, mMix));
      u.ringMat.opacity = clamp(0.88 + 0.12 * Math.sin(u.t * 11), 0.78, 1.0);
      u.ring.scale.setScalar(1.01 + 0.065 * Math.sin(u.t * 11));
    } else {
      u.ringMat.color.setRGB(2.2, 0.35, 0.45);
      u.ringMat.opacity = (active ? 0.95 : 0.45) * pulse;
      u.ring.scale.setScalar(active ? 1 : 0.9);
    }
    u.chevMat.opacity = (active ? 1.0 : 0.5) * pulse;
    if (ctx.camera) u.chev.quaternion.copy(ctx.camera.quaternion);

    // Directional aim chevron on ground ring when user is controlling
    if (active && state.phase === 'play') {
      const m = (userInput && userInput.moveVec) || { x: 0, z: 0 };
      const aimAng = Math.hypot(m.x, m.z) > 0.15 ? Math.atan2(m.z, m.x) : p.facing;
      u.aimPivot.visible = true;
      u.aimPivot.rotation.y = -aimAng;
      u.aimMat.opacity = 0.78 * pulse;
    } else {
      u.aimPivot.visible = false;
    }

    // Player-Lock off-ball positioning indicator ring
    if (playerLock.enabled && state.phase === 'play' && controller !== p) {
      const slotIdx = squads.home.out.indexOf(p);
      if (slotIdx >= 0) {
        spotFor('home', slotIdx, _tacticalSpot);
        if (d2(p.pos.x, p.pos.z, _tacticalSpot.x, _tacticalSpot.z) > 3.8) {
          proPosRing.visible = true;
          proPosRing.position.set(_tacticalSpot.x, 0.029, _tacticalSpot.z);
          proPosRingMat.opacity = 0.35 + 0.18 * Math.sin(u.t * 4);
        } else {
          proPosRing.visible = false;
        }
      } else {
        proPosRing.visible = false;
      }
    } else {
      proPosRing.visible = false;
    }

    // Receiver highlight ring while user holds ball (or pass is in flight to another teammate)
    previewTarget = null;
    if (active && state.phase === 'play' && controller === p) {
      const bp = userBestPass(p, state.kickCharge.active ? state.kickCharge.value : 0.55, false);
      if (bp && bp.target && isActive(bp.target)) previewTarget = bp.target;
    } else if (active && state.phase === 'play' && !controller && passTarget && passTarget.team === 'home' && passTarget !== p && isActive(passTarget)) {
      previewTarget = passTarget;
    }
    if (previewTarget) {
      targetRing.visible = true;
      targetRing.position.set(previewTarget.pos.x, 0.032, previewTarget.pos.z);
      targetRingMat.opacity = 0.55 + 0.25 * Math.sin(u.t * 5);
    } else {
      targetRing.visible = false;
    }

    // Set-piece aiming reticle & ballistic arc preview
    if (active && state.phase === 'out' && restart && restart.ready) {
      if (restart.side === 'away' && restart.kind === 'penalty') {
        const gk = squads.home.gk;
        reticleGroup.visible = true;
        reticleGroup.position.set(gk.pos.x, 0.04, clamp(restart.gkDiveChoice * 2.4, -3.0, 3.0));
        retOuter.scale.setScalar(0.85 + 0.12 * Math.sin(u.t * 5));
        arcLine.visible = false;
      } else if (restart.side === 'home') {
        reticleGroup.visible = true;
        reticleGroup.position.set(restart.aimX, 0.04, restart.aimZ);
        retOuter.scale.setScalar(0.9 + 0.12 * Math.sin(u.t * 5));
        arcLine.visible = true;
        const sx = ball.pos.x, sy = Math.max(0.18, ball.pos.y), sz = ball.pos.z;
        const ex = restart.aimX, ey = restart.kind === 'penalty' || restart.kind === 'free_kick' ? 1.4 : 0.2, ez = restart.aimZ;
        const dx = ex - sx, dz = ez - sz;
        const dist = Math.hypot(dx, dz) || 1;
        const pwr = state.kickCharge.active ? state.kickCharge.value : restart.power;
        const arcPeak = restart.kind === 'penalty' ? 0.65
          : restart.kind === 'corner' || restart.kind === 'goal_kick' ? clamp(dist * 0.16, 1.4, 5.2)
            : restart.kind === 'throw_in' ? clamp(dist * 0.12, 0.9, 2.6)
              : clamp(lerp(0.8, 2.2, pwr), 0.7, 3.0);
        const curlSign = restart.kind === 'free_kick' ? (ez >= sz ? -1 : 1) : (restart.kind === 'corner' ? -Math.sign(restart.z || 1) : 0);
        const perpX = -dz / dist, perpZ = dx / dist;
        for (let i = 0; i < ARC_SEGS; i++) {
          const f = i / (ARC_SEGS - 1);
          const bend = curlSign * Math.sin(Math.PI * f) * (restart.kind === 'free_kick' || restart.kind === 'corner' ? 1.35 : 0);
          arcCoords[i * 3] = lerp(sx, ex, f) + perpX * bend;
          arcCoords[i * 3 + 1] = lerp(sy, ey, f) + 4 * arcPeak * f * (1 - f);
          arcCoords[i * 3 + 2] = lerp(sz, ez, f) + perpZ * bend;
        }
        arcAttr.needsUpdate = true;
      } else {
        reticleGroup.visible = false;
        arcLine.visible = false;
      }
    } else {
      reticleGroup.visible = false;
      arcLine.visible = false;
    }

    const kc = state.kickCharge;
    if (kc.active || kc.fadeT > 0) {
      const val = clamp(kc.active ? kc.value : kc.displayValue, 0.02, 1);
      const opa = kc.active ? 1 : clamp(kc.fadeT / 0.25, 0, 1);
      u.pwrGroup.visible = true;
      u.pwrGroup.position.y = 2.52 + Math.sin(u.t * 3) * 0.05;
      u.pwrFill.scale.x = val;
      if (val < 0.55) u.pwrFillMat.color.setRGB(lerp(0.13, 0.92, val / 0.55), lerp(0.77, 0.70, val / 0.55), lerp(0.37, 0.03, val / 0.55));
      else u.pwrFillMat.color.setRGB(lerp(0.92, 0.94, (val - 0.55) / 0.45), lerp(0.70, 0.27, (val - 0.55) / 0.45), lerp(0.03, 0.27, (val - 0.55) / 0.45));
      u.pwrBgMat.opacity = 0.85 * opa;
      u.pwrFillMat.opacity = 0.96 * opa;
      if (ctx.camera) u.pwrGroup.quaternion.copy(ctx.camera.quaternion);
    } else {
      u.pwrGroup.visible = false;
    }
  }

  function getMatchReport() {
    const h = state.score.home;
    const a = state.score.away;
    const playersReport = [];
    let bestP = null;
    let bestR = -1;
    for (const s of ['home', 'away']) {
      const myS = s === 'home' ? h : a;
      const oppS = s === 'home' ? a : h;
      for (const p of squads[s].all) {
        const pf = getPerf(p) || emptyPlayerPerf();
        const rating = computeLivePlayerRating(p, pf, myS, oppS);
        const entry = {
          id: p.id,
          team: s,
          name: p.fullName || p.name,
          shortName: p.name,
          number: p.number,
          role: p.posRole || p.role,
          ovr: p.ovr || 76,
          isPro: !!p.isPro,
          rating,
          motm: false,
          ...pf,
        };
        if (rating > bestR) {
          bestR = rating;
          bestP = entry;
        }
        playersReport.push(entry);
      }
    }
    if (bestP) bestP.motm = true;
    return {
      score: { home: h, away: a },
      stats: { home: { ...state.stats.home }, away: { ...state.stats.away } },
      events: matchEvents.slice(),
      motm: bestP,
      players: playersReport,
      pro: playersReport.find((r) => r.isPro) || null,
    };
  }

  const match = {
    state,
    update,
    onEvent(cb) { listeners.push(cb); },
    setUserInput,
    restartMatch,
    syncSquads,
    startDrill,
    exitDrill,
    getDrillReport,
    setTeamTactics,
    setFormation,
    setPlayerLock(enabled, playerId = null) {
      playerLock.enabled = !!enabled;
      playerLock.playerId = playerId || null;
      state.playerLock = playerLock.enabled;
      callForPassReq.active = false;
      if (playerLock.enabled) {
        const pro = findProPlayer();
        if (pro && isActive(pro)) match.controlledPlayer = pro;
      }
    },
    getMatchReport,
    setDifficulty(d) {
      if (DIFFICULTY_PROFILES[d]) {
        state.difficulty = d;
        emit('difficulty', { difficulty: d });
      }
    },
    setHalfMinutes(m) {
      const mins = clamp(Math.round(Number(m) || 6), 1, 45);
      state.halfMinutes = mins;
    },
    setTacticalPreset,
    triggerOffsideTrap,
    controlledPlayer: null,
  };

  placeKickoff('home');
  pickControlled(1);
  syncTelemetry();

  return match;
}
