import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const CHROME = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';
const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--mute-audio',
    '--window-size=1280,720',
  ],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); console.error('PAGEERROR:', e); });
  page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push(m.text()); console.error('CONSOLE_ERR:', m.text()); } });

  await page.goto(`${baseUrl}/index.html?cam=broadcast&t=1.5&seed=7&quality=low`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__SHOT_READY === true', { timeout: 60000 });

  // 1. Camera & Error Check
  const camCheck = await page.evaluate(() => {
    const { rig, teams, ball, match } = window.__APP;
    return {
      camPos: { x: rig.camera.position.x, y: rig.camera.position.y, z: rig.camera.position.z },
      camFov: rig.camera.fov,
      homeCount: teams.home.length,
      awayCount: teams.away.length,
      ballPos: { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z },
      phase: match.state.phase,
    };
  });
  assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join('; ')}`);
  assert.ok(camCheck.camPos.y > 12.0 && camCheck.camPos.z < -25.0, `Unexpected camera pos: ${JSON.stringify(camCheck.camPos)}`);
  assert.equal(camCheck.phase, 'play', 'Expected active play phase at t=1.5');
  console.log('1. Camera & Startup Check PASSED:', JSON.stringify(camCheck));

  // 2. High-Line Sync & Defending Sim Check (150s sim)
  const simReport = await page.evaluate(() => {
    const { match, ball, teams } = window.__APP;
    const DT = 1 / 60;
    const lineSpreads = [];
    const wingSpreads = [];
    const events = [];
    match.onEvent((type) => events.push(type));

    for (let i = 0; i < 150 * 60; i++) {
      match.update(DT);
      teams.update(DT);
      ball.update(DT);

      if (match.state.phase === 'play' && i % 45 === 0 && match.state.possession) {
        const defSide = match.state.possession === 'home' ? 'away' : 'home';
        const defs = teams[defSide].filter((p) => p.role === 'DF' && !p.sentOff);
        const nonPressing = defs.filter((d) => Math.hypot(d.pos.x - ball.pos.x, d.pos.z - ball.pos.z) > 4.5);
        if (nonPressing.length >= 3) {
          const xs = nonPressing.map((d) => d.pos.x);
          lineSpreads.push(Math.max(...xs) - Math.min(...xs));
        }
        const attSide = match.state.possession;
        const attOut = teams[attSide].filter((p) => p.role !== 'GK' && !p.sentOff);
        const zs = attOut.map((p) => p.pos.z);
        wingSpreads.push(Math.max(...zs) - Math.min(...zs));
      }
    }
    const avgLineSpread = lineSpreads.reduce((a, b) => a + b, 0) / Math.max(1, lineSpreads.length);
    const avgWingSpread = wingSpreads.reduce((a, b) => a + b, 0) / Math.max(1, wingSpreads.length);
    const counts = {};
    for (const e of events) counts[e] = (counts[e] || 0) + 1;
    return {
      clock: Math.round(match.state.clockSec),
      score: match.state.score,
      stats: match.state.stats,
      avgLineSpread: Math.round(avgLineSpread * 100) / 100,
      avgWingSpread: Math.round(avgWingSpread * 100) / 100,
      samples: lineSpreads.length,
      counts,
    };
  });
  assert.ok(simReport.samples > 10, 'Too few defensive line samples');
  assert.ok(simReport.avgLineSpread < 4.5, `Defensive line too staggered! avg spread=${simReport.avgLineSpread}m`);
  assert.ok(simReport.avgWingSpread > 26.0, `Attacking wing spread too narrow! avg=${simReport.avgWingSpread}m`);
  console.log('2. Synced Defensive Line & Spread Check PASSED:', JSON.stringify(simReport));

  // 3. Heavy / Messy First-Touch Physics Check
  const touchCheck = await page.evaluate(() => {
    const { match, ball, teams, THREE } = window.__APP;
    const DT = 1 / 60;
    const clearNearby = (keepA, keepB) => {
      for (const s of ['home', 'away']) {
        for (const p of teams[s]) {
          if (p === keepA || p === keepB) continue;
          p.pos.set(-45, 0, s === 'home' ? -30 : 30);
          p.vel.set(0, 0, 0);
          p.stop();
        }
      }
    };
    const mkInput = (overrides = {}) => ({
      moveVec: { x: 0, z: 0 }, magnitude: 0, sprint: false, modifier: false, chipMod: false,
      gkRush: false, pressAssist: false,
      passPressed: false, shootPressed: false, throughPressed: false, loftedPressed: false,
      switchPressed: false, standTacklePressed: false, slideTacklePressed: false,
      holdPass: false, holdShoot: false, holdThrough: false, holdLob: false,
      skillStepoverPressed: false, skillRoulettePressed: false, skillBallRollPressed: false,
      skillElasticoPressed: false, skillRollSide: 0,
      ...overrides,
    });

    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }

    const recv = teams.home.find((p) => p.role === 'FW');
    clearNearby(recv, teams.away[0]);
    recv.pos.set(0, 0, 0);
    recv.vel.set(0, 0, 0);
    recv.stop();
    recv.facing = Math.PI;
    match.controlledPlayer = recv;
    ball.place(-1.2, 0);
    ball.stopDead();
    ball.kick(new THREE.Vector3(7.0, 0.15, 0));

    let cleanTrapped = false;
    for (let i = 0; i < 20; i++) {
      match.setUserInput(mkInput());
      match.update(DT); teams.update(DT); ball.update(DT);
      if (ball.controlledBy === recv) { cleanTrapped = true; break; }
    }

    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    const recv2 = teams.home.find((p) => p.role === 'FW');
    clearNearby(recv2, teams.away[0]);
    recv2.pos.set(0, 0, 0);
    recv2.vel.set(5.8, 0, 1.5);
    recv2.facing = Math.atan2(1.5, 5.8);
    match.controlledPlayer = recv2;
    ball.place(-1.6, 0);
    ball.stopDead();
    ball.kick(new THREE.Vector3(20.5, 0.25, 0));

    let knockedLoose = false;
    let maxSepAfterContact = 0;
    let hadContact = false;
    for (let i = 0; i < 35; i++) {
      match.setUserInput(mkInput({ moveVec: { x: 1, z: 0.2 }, magnitude: 1, sprint: true }));
      match.update(DT); teams.update(DT); ball.update(DT);
      if (ball.pos.x > 0.1) hadContact = true;
      if (hadContact && !ball.controlledBy) {
        knockedLoose = true;
        maxSepAfterContact = Math.max(maxSepAfterContact, Math.hypot(ball.pos.x - recv2.pos.x, ball.pos.z - recv2.pos.z));
      }
    }

    return { cleanTrapped, knockedLoose, maxSepAfterContact: Math.round(maxSepAfterContact * 100) / 100 };
  });
  assert.equal(touchCheck.cleanTrapped, true, 'Slow pass should trap cleanly');
  assert.equal(touchCheck.knockedLoose, true, 'Fast 20.5 m/s ball into sprinter should cause heavy loose touch');
  assert.ok(touchCheck.maxSepAfterContact >= 0.9, `Heavy touch separation too small: ${touchCheck.maxSepAfterContact}m`);
  console.log('3. Heavy First-Touch Physics Check PASSED:', JSON.stringify(touchCheck));

  // 4. Skill Move Deception Checks (Elastico, Roulette, Fake Shot)
  const skillCheck = await page.evaluate(() => {
    const { match, ball, teams } = window.__APP;
    const DT = 1 / 60;
    const mkInput = (overrides = {}) => ({
      moveVec: { x: 1, z: 0 }, magnitude: 1, sprint: false, modifier: false, chipMod: false,
      gkRush: false, pressAssist: false,
      passPressed: false, shootPressed: false, throughPressed: false, loftedPressed: false,
      switchPressed: false, standTacklePressed: false, slideTacklePressed: false,
      holdPass: false, holdShoot: false, holdThrough: false, holdLob: false,
      skillStepoverPressed: false, skillRoulettePressed: false, skillBallRollPressed: false,
      skillElasticoPressed: false, skillRollSide: 0,
      ...overrides,
    });
    const clearField = (carrier, opp) => {
      for (const s of ['home', 'away']) {
        for (const p of teams[s]) {
          if (p === carrier || p === opp) continue;
          p.pos.set(-45, 0, s === 'home' ? -30 : 30);
          p.vel.set(0, 0, 0);
          p.stop();
        }
      }
    };
    const giveBallTo = (carrier, opp, oppX, oppZ) => {
      match.restartMatch();
      for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
      clearField(carrier, opp);
      carrier.pos.set(0, 0, 0);
      carrier.vel.set(3.5, 0, 0);
      carrier.facing = 0;
      opp.pos.set(oppX, 0, oppZ);
      opp.vel.set(0, 0, 0);
      opp.facing = Math.PI;
      ball.place(0.3, 0);
      ball.stopDead();
      match.controlledPlayer = carrier;
      for (let i = 0; i < 6; i++) {
        match.setUserInput(mkInput());
        match.update(DT); teams.update(DT); ball.update(DT);
        if (ball.controlledBy === carrier) break;
      }
    };

    const carrier = teams.home.find((p) => p.role === 'FW');
    const opp = teams.away.find((p) => p.role === 'DF');

    // A) Elastico
    giveBallTo(carrier, opp, 2.3, 0.25);
    match.setUserInput(mkInput({ skillElasticoPressed: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    const oppVelRightAfterElastico = { x: opp.vel.x, z: opp.vel.z };
    const carrierPosStartZ = carrier.pos.z;
    for (let i = 0; i < 25; i++) {
      match.setUserInput(mkInput());
      match.update(DT); teams.update(DT); ball.update(DT);
    }
    const elasticoResult = {
      oppVelZ: Math.round(oppVelRightAfterElastico.z * 100) / 100,
      oppEndZ: Math.round(opp.pos.z * 100) / 100,
      carrierEndX: Math.round(carrier.pos.x * 100) / 100,
      carrierDeltaZ: Math.round((carrier.pos.z - carrierPosStartZ) * 100) / 100,
      stillHasBall: ball.controlledBy === carrier,
    };

    // B) Roulette
    giveBallTo(carrier, opp, 1.5, 0.1);
    match.setUserInput(mkInput({ skillRoulettePressed: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    for (let i = 0; i < 32; i++) {
      match.setUserInput(mkInput());
      match.update(DT); teams.update(DT); ball.update(DT);
    }
    const rouletteResult = {
      carrierPassedOpp: carrier.pos.x > opp.pos.x + 0.3,
      carrierX: Math.round(carrier.pos.x * 100) / 100,
      oppX: Math.round(opp.pos.x * 100) / 100,
      stillHasBall: ball.controlledBy === carrier,
    };

    // C) Hold Shoot -> Pass Fake Shot
    giveBallTo(carrier, opp, 2.6, 0.0);
    const shotsBefore = match.state.stats.home.shots;
    let tackleEvents = 0;
    match.onEvent((t) => { if (t === 'tackle') tackleEvents++; });

    match.setUserInput(mkInput({ shootPressed: true, holdShoot: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    match.setUserInput(mkInput({ passPressed: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    const oppVelAfterFake = { x: opp.vel.x, z: opp.vel.z, sp: Math.hypot(opp.vel.x, opp.vel.z) };
    let maxAbsZ = Math.abs(carrier.pos.z);
    for (let i = 0; i < 25; i++) {
      match.setUserInput(mkInput());
      match.update(DT); teams.update(DT); ball.update(DT);
      maxAbsZ = Math.max(maxAbsZ, Math.abs(carrier.pos.z));
    }
    const fakeShotResult = {
      shotsDelta: match.state.stats.home.shots - shotsBefore,
      tackleEvents,
      oppSlideSpeed: Math.round(oppVelAfterFake.sp * 100) / 100,
      stillHasBall: ball.controlledBy === carrier,
      carrierX: Math.round(carrier.pos.x * 100) / 100,
      carrierZ: Math.round(carrier.pos.z * 100) / 100,
      maxAbsZ: Math.round(maxAbsZ * 100) / 100,
      oppX: Math.round(opp.pos.x * 100) / 100,
      oppZ: Math.round(opp.pos.z * 100) / 100,
      carrierCutLateral: maxAbsZ > 0.6,
    };

    // D) Tap Shoot -> Tap Pass Fake Shot (cancels activeKick windup before foot impact)
    giveBallTo(carrier, opp, 2.5, 0.0);
    const shotsBeforeTap = match.state.stats.home.shots;
    let tapTackles = 0;
    match.onEvent((t) => { if (t === 'tackle') tapTackles++; });
    match.setUserInput(mkInput({ shootPressed: true, holdShoot: false }));
    match.update(DT); teams.update(DT); ball.update(DT);
    match.setUserInput(mkInput({ passPressed: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    for (let i = 0; i < 25; i++) {
      match.setUserInput(mkInput());
      match.update(DT); teams.update(DT); ball.update(DT);
    }
    const fakeShotTapResult = {
      shotsDelta: match.state.stats.home.shots - shotsBeforeTap,
      tapTackles,
      stillHasBall: ball.controlledBy === carrier,
    };

    return { elasticoResult, rouletteResult, fakeShotResult, fakeShotTapResult };
  });

  assert.ok(Math.abs(skillCheck.elasticoResult.oppVelZ) > 1.5, 'Elastico should send defender stumbling sideways');
  assert.ok(skillCheck.elasticoResult.oppVelZ * skillCheck.elasticoResult.carrierDeltaZ < 0,
    `Elastico defender (${skillCheck.elasticoResult.oppVelZ}) and carrier (${skillCheck.elasticoResult.carrierDeltaZ}) should go opposite lateral ways!`);
  assert.equal(skillCheck.elasticoResult.stillHasBall, true, 'Carrier should keep ball after Elastico');

  assert.equal(skillCheck.rouletteResult.carrierPassedOpp, true, `Roulette should wrap past defender: ${JSON.stringify(skillCheck.rouletteResult)}`);
  assert.equal(skillCheck.rouletteResult.stillHasBall, true, 'Carrier should keep ball after Roulette');

  assert.equal(skillCheck.fakeShotResult.shotsDelta, 0, 'Fake Shot must cancel shot (shotsDelta === 0)');
  assert.ok(skillCheck.fakeShotResult.tackleEvents >= 1, 'Fake Shot must bait frontal defender into slide tackle');
  assert.ok(skillCheck.fakeShotResult.oppSlideSpeed > 4.5, `Defender should slide fast at phantom shot (${skillCheck.fakeShotResult.oppSlideSpeed} m/s)`);
  assert.equal(skillCheck.fakeShotResult.stillHasBall, true, 'Carrier should keep ball after Fake Shot cut');
  assert.equal(skillCheck.fakeShotResult.carrierCutLateral, true, `Carrier should cut diagonally clear on Fake Shot: ${JSON.stringify(skillCheck.fakeShotResult)}`);

  assert.equal(skillCheck.fakeShotTapResult.shotsDelta, 0, 'Tap Fake Shot must cancel activeKick windup');
  assert.ok(skillCheck.fakeShotTapResult.tapTackles >= 1, 'Tap Fake Shot must bait defender slide');
  assert.equal(skillCheck.fakeShotTapResult.stillHasBall, true, 'Carrier should keep ball after tap Fake Shot');

  console.log('4. Skill Move Deception Checks PASSED:', JSON.stringify(skillCheck));
} finally {
  await browser.close();
  server.close();
}
