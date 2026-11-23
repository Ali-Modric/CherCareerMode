import * as THREE from 'three';
import { makeRng, clamp } from './util.js';
import { createInput } from './input.js';
import { createLighting } from './lighting.js';
import { createPitch } from './pitch.js';
import { createStadium } from './stadium.js';
import { createCrowd } from './crowd.js';
import { createBall } from './ball.js';
import { createTeams } from './players.js';
import { createMatch } from './match.js';
import { createCameraRig } from './cameraRig.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createParticles } from './particles.js';
import { createCareerUi } from './careerUi.js';
import { CLUBS, getTeamById, resolveMatchKits } from './careerDb.js';
import { resolveLineupsForMatch, applyUserMatchResult, getTeamLineupWithPro } from './careerEngine.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '7', 10);
const SHOT_T = params.get('t') ? parseFloat(params.get('t')) : null;
const CAM_MODE = params.get('cam') || 'broadcast';
// Coarse pointer + small viewport => phone/tablet. Drop to the low-cost path
// (smaller crowd, smaller textures, fewer shadow casters) unless overridden.
const IS_MOBILE = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches &&
      Math.min(window.innerWidth, window.innerHeight) < 900;
  } catch (e) { return false; }
})();
const QUALITY = params.get('quality') || (IS_MOBILE ? 'low' : 'high');
const LIVE = params.get('live') === '1'; // keep animating even in shot mode

const SIM_DT = 1 / 60;

// --- Renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = false;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const rng = makeRng(SEED);
const ctx = { scene, renderer, rng, quality: QUALITY };

// --- Build world ------------------------------------------------------------
const lighting = createLighting(ctx);
const pitch = createPitch(ctx);
const stadium = createStadium(ctx);
const crowd = createCrowd(ctx);
const ball = createBall(ctx);
const teams = createTeams(ctx);
const particles = createParticles(ctx);
const match = createMatch(ctx, { ball, teams, pitch });
const rig = createCameraRig(ctx, { ball, teams, match });
// Published so world-space UI (the controlled-player marker) can billboard.
ctx.camera = rig.camera;

const input = createInput();
const audio = createAudio({ match, rng: makeRng(SEED ^ 0x51ab) });

const origRestartMatch = match.restartMatch;
match.restartMatch = () => {
  particles.reset();
  origRestartMatch();
};

let paused = false;
let loopRunning = false;
let activeSession = null; // { mode: 'quick'|'career'|'drill', career?, fixture?, swapped3dSides?, drillId? }
let lastDrillCfg = null;

function setPaused(v) {
  const next = !!v;
  if (paused === next) return;
  paused = next;
  if (input.clear) input.clear();
}

let careerUi = null;

const settings = {
  isPaused: () => paused,
  setPaused,
  togglePaused: () => setPaused(!paused),
  getCameraMode: () => (rig.getMode ? rig.getMode() : CAM_MODE),
  setCameraMode: (m) => { if (rig.setMode) rig.setMode(m); },
  getDifficulty: () => (match.state && match.state.difficulty) || 'pro',
  setDifficulty: (d) => { if (match.setDifficulty) match.setDifficulty(d); },
  getHalfMinutes: () => (match.state && match.state.halfMinutes) || 6,
  setHalfMinutes: (m) => { if (match.setHalfMinutes) match.setHalfMinutes(m); },
  getTacticalPreset: () => (match.state && match.state.tacticalPreset) || 'bal',
  setTacticalPreset: (p) => { if (match.setTacticalPreset) match.setTacticalPreset(p); },
  getVolume: () => (audio.getVolume ? audio.getVolume() : 1),
  setVolume: (v) => { if (audio.setVolume) audio.setVolume(v); },
  restartMatch: () => {
    match.restartMatch();
    setPaused(false);
  },
  canExit: () => SHOT_T === null && !!careerUi,
  getExitLabel: () => (
    activeSession && activeSession.mode === 'drill'
      ? 'ABORT DRILL'
      : activeSession && activeSession.mode === 'career'
        ? 'EXIT TO HUB'
        : 'MAIN MENU'
  ),
  canRestartMatch: () => !activeSession || activeSession.mode === 'quick',
  hasFulltimeContinue: () => SHOT_T === null && !!activeSession && !!careerUi,
  getFulltimeLabel: () => (activeSession && activeSession.mode === 'career' ? 'POST-MATCH REPORT' : 'MAIN MENU'),
  onExitToMenu: () => {
    stopLoop();
    setPaused(false);
    hud.setVisible(false);
    if (match.exitDrill) match.exitDrill();
    if (careerUi) {
      if (activeSession && activeSession.mode === 'drill') careerUi.openCareerHub('training');
      else if (activeSession && activeSession.mode === 'career') careerUi.openCareerHub('home');
      else careerUi.openStartMenu();
    }
  },
  onDrillComplete: (report) => {
    stopLoop();
    setPaused(false);
    hud.setVisible(false);
    if (match.exitDrill) match.exitDrill();
    if (careerUi && typeof careerUi.finishDrill3d === 'function') {
      careerUi.finishDrill3d(report);
    } else if (careerUi) {
      careerUi.openCareerHub('training');
    }
  },
  onDrillRetry: () => {
    if (lastDrillCfg) launchDrillFromUi(lastDrillCfg);
  },
  onFulltimeContinue: () => {
    stopLoop();
    setPaused(false);
    hud.setVisible(false);
    if (!careerUi) return;
    if (activeSession && activeSession.mode === 'career' && activeSession.career && activeSession.fixture) {
      const report = match.getMatchReport();
      const summary = applyUserMatchResult(
        activeSession.career,
        activeSession.fixture,
        report,
        !!activeSession.swapped3dSides,
      );
      careerUi.showPostMatch(summary);
    } else {
      careerUi.openStartMenu();
    }
  },
};

const hud = createHud({ match, settings, input });

match.onEvent((type, data) => {
  if ((type === 'net' || type === 'net_ripple') && data && pitch.triggerNetRipple) {
    pitch.triggerNetRipple(data.side, data.pos, data.vel);
  } else if (type === 'bounce' && data && data.pos) {
    particles.burstChalk(
      data.pos.x, data.pos.z,
      data.vel ? data.vel.x : 0, data.vel ? data.vel.z : 0,
      clamp((data.speed || 4) / 5, 0.5, 1.4),
    );
  } else if (type === 'tackle' && data && data.pos) {
    particles.burstTurf(
      data.pos.x, data.pos.z,
      data.vel ? data.vel.x : 0, data.vel ? data.vel.z : 0,
      data.isSlide ? 14 : 6, !!data.isSlide,
    );
    if (data.isSlide && data.angle != null) {
      particles.stampSkid(data.pos.x, data.pos.z, data.angle);
    }
  } else if (type === 'kick' && data && data.power > 0.65 && data.pos) {
    particles.burstTurf(
      data.pos.x, data.pos.z,
      data.vel ? data.vel.x : 0, data.vel ? data.vel.z : 0,
      5, false,
    );
  }
});

rig.setMode(CAM_MODE);

// --- Loop -------------------------------------------------------------------
function simTick(dt, preSampled) {
  const inp = preSampled || input.sample();
  match.setUserInput(inp);
  match.update(dt);
  teams.update(dt);
  ball.update(dt);
  particles.update(dt);
}

function frameUpdate(dt) {
  const simDt = paused ? 0 : dt;
  const ex = match.state ? match.state.excitement || 0 : 0;
  crowd.update(simDt, ex);
  lighting.update(simDt);
  if (stadium.update) stadium.update(simDt);
  if (pitch.update) pitch.update(simDt, match.state);
  rig.update(dt);
  hud.update(simDt);
  audio.update(simDt, ex);
}

function render() {
  renderer.render(scene, rig.camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h);
  rig.camera.aspect = w / h;
  rig.camera.updateProjectionMatrix();
  if (!loopRunning) render();
}
window.addEventListener('resize', resize);
// iOS fires orientationchange before the viewport metrics settle.
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

function stopLoop() {
  if (!loopRunning) return;
  loopRunning = false;
  renderer.setAnimationLoop(null);
}

function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  let last = performance.now();
  let acc = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    let frameDt = (now - last) / 1000;
    last = now;
    frameDt = Math.min(frameDt, 0.25);

    if (paused) {
      acc = 0;
      const inp = input.sample();
      if (inp.pausePressed) setPaused(false);
    } else {
      acc += frameDt;
      while (acc >= SIM_DT) {
        const inp = input.sample();
        if (inp.pausePressed) {
          setPaused(true);
          acc = 0;
          break;
        }
        simTick(SIM_DT, inp);
        acc -= SIM_DT;
      }
    }

    frameUpdate(frameDt);
    render();
  });
}

function launchMatchFromUi(cfg) {
  if (cfg.mode === 'career' && cfg.career && cfg.fixture) {
    const resolved = resolveLineupsForMatch(cfg.career, cfg.fixture, cfg.tacticalOverrides || {});
    activeSession = {
      mode: 'career',
      career: cfg.career,
      fixture: cfg.fixture,
      swapped3dSides: resolved.swapped3dSides,
    };
    teams.reconfigureMatch(resolved);
    match.setTeamTactics('home', resolved.homeTeam.manager.style, resolved.homeTeam.manager.tacticalRating);
    match.setTeamTactics('away', resolved.awayTeam.manager.style, resolved.awayTeam.manager.tacticalRating);
    if (match.setFormation) {
      match.setFormation('home', resolved.homeFormation || '4-3-3');
      match.setFormation('away', resolved.awayFormation || '4-3-3');
    }
    match.setPlayerLock(cfg.controlMode === 'pro', resolved.proPlayerId);
    match.setDifficulty(cfg.difficulty || 'pro');
    match.setHalfMinutes(cfg.halfMinutes || 4);
    rig.setMode(cfg.cameraMode || 'broadcast');
    hud.setMatchTeams({
      homeTeam: resolved.homeTeam,
      awayTeam: resolved.awayTeam,
      homeKit: resolved.homeKit,
      awayKit: resolved.awayKit,
      competition: cfg.competition,
      matchday: cfg.matchday,
      venue: resolved.venue,
      playerLock: cfg.controlMode === 'pro',
      proName: cfg.career.pro.name,
    });
  } else {
    activeSession = { mode: 'quick' };
    teams.reconfigureMatch({
      homeTeam: cfg.homeTeam,
      awayTeam: cfg.awayTeam,
      homeKit: cfg.homeKit,
      awayKit: cfg.awayKit,
      homeLineup: cfg.homeLineup,
      awayLineup: cfg.awayLineup,
    });
    const homeStyle = cfg.homeStyle || cfg.homeTeam.manager.style;
    const awayStyle = cfg.awayStyle || cfg.awayTeam.manager.style;
    match.setTeamTactics('home', homeStyle, cfg.homeTeam.manager.tacticalRating);
    match.setTeamTactics('away', awayStyle, cfg.awayTeam.manager.tacticalRating);
    if (match.setFormation) {
      match.setFormation('home', cfg.homeFormation || '4-3-3');
      match.setFormation('away', cfg.awayFormation || '4-3-3');
    }
    match.setPlayerLock(false, null);
    match.setDifficulty(cfg.difficulty || 'pro');
    match.setHalfMinutes(cfg.halfMinutes || 4);
    rig.setMode(cfg.cameraMode || 'broadcast');
    hud.setMatchTeams({
      homeTeam: cfg.homeTeam,
      awayTeam: cfg.awayTeam,
      homeKit: cfg.homeKit,
      awayKit: cfg.awayKit,
      competition: cfg.competition,
      matchday: cfg.matchday,
      venue: cfg.venue,
      playerLock: false,
    });
  }
  match.restartMatch();
  setPaused(false);
  hud.setVisible(true);
  startLoop();
}

function launchDrillFromUi(cfg) {
  lastDrillCfg = cfg;
  const career = cfg.career;
  const club = getTeamById(career.pro.clubId);
  const sparPool = CLUBS.find((c) => c.id !== club.id && c.leagueId === club.leagueId) || CLUBS[1];
  const oppTeam = sparPool.id === club.id ? CLUBS[0] : sparPool;
  const kits = resolveMatchKits(club, oppTeam, 'home', 'auto');
  const homeLineup = getTeamLineupWithPro(career, club.id, '4-3-3');
  const awayLineup = getTeamLineupWithPro(career, oppTeam.id, '4-3-3');
  activeSession = { mode: 'drill', career, drillId: cfg.drillId };
  teams.reconfigureMatch({
    homeTeam: { ...club, rating: career.clubsState?.[club.id]?.rating || club.rating },
    awayTeam: { ...oppTeam, rating: career.clubsState?.[oppTeam.id]?.rating || oppTeam.rating },
    homeKit: { ...kits.homeKit, gkColor: club.gkKit.primary },
    awayKit: { ...kits.awayKit, gkColor: oppTeam.gkKit.primary },
    homeLineup,
    awayLineup,
  });
  match.setDifficulty('pro');
  rig.setMode(cfg.cameraMode || 'broadcast');
  match.restartMatch();
  match.startDrill({
    drillId: cfg.drillId,
    duration: cfg.duration || 45,
    subtitle: club.name,
  });
  hud.setMatchTeams({
    homeTeam: club,
    awayTeam: oppTeam,
    homeKit: kits.homeKit,
    awayKit: kits.awayKit,
    competition: 'TRAINING GROUND',
    matchday: 'WEEKLY DRILL',
    venue: `${club.short || club.name} Training Pitch`,
    playerLock: true,
    proName: career.pro.name,
  });
  hud.setDrillMode({ title: match.state.drill.title });
  setPaused(false);
  hud.setVisible(true);
  startLoop();
}

if (SHOT_T !== null) {
  // Deterministic warm-up: fast-forward the sim, converge the camera, render once.
  const ticks = Math.round(SHOT_T / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    simTick(SIM_DT);
    if (i % 2 === 0) frameUpdate(SIM_DT * 2);
  }
  // Extra rig/crowd settle so smoothing has converged on the final state.
  for (let i = 0; i < 240; i++) frameUpdate(1 / 60);
  resize();
  render();
  window.__SHOT_READY = true;
  if (LIVE) startLoop();
} else {
  // Render crisp initial stadium backdrop frame, keep 3D loop idle while in menus.
  hud.setVisible(false);
  simTick(SIM_DT);
  frameUpdate(SIM_DT);
  resize();
  render();
  careerUi = createCareerUi({ onLaunchMatch: launchMatchFromUi, onLaunchDrill: launchDrillFromUi });
  careerUi.openStartMenu();
}

window.__APP = {
  scene, renderer, pitch, ball, teams, match, rig, audio, particles, settings, input, hud, THREE,
  isLoopRunning: () => loopRunning,
};
