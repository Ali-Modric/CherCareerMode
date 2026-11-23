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

  const results = await page.evaluate(() => {
    const { match, ball, teams } = window.__APP;
    const DT = 1 / 60;
    const step = (inp) => {
      match.setUserInput(inp);
      match.update(DT);
      teams.update(DT);
      ball.update(DT);
    };
    const neutralInput = (overrides = {}) => ({
      moveVec: { x: 0, z: 0 },
      magnitude: 0,
      active: false,
      sprint: false,
      passPressed: false,
      shootPressed: false,
      throughPressed: false,
      loftedPressed: false,
      holdPass: false,
      holdShoot: false,
      holdThrough: false,
      holdLob: false,
      modifier: false,
      chipMod: false,
      gkRush: false,
      pressAssist: false,
      tacticalSet: null,
      mentalitySet: null,
      mentalityCycle: false,
      offsideTrapPressed: false,
      pausePressed: false,
      standTacklePressed: false,
      slideTacklePressed: false,
      switchPressed: false,
      skillStepoverPressed: false,
      skillRoulettePressed: false,
      skillBallRollPressed: false,
      skillElasticoPressed: false,
      skillRollSide: 0,
      ...overrides,
    });

    const resetCleanPlay = (anchorX = 0) => {
      match.restartMatch();
      // Advance past kickoff into open play and release ball cleanly
      for (let i = 0; i < 70; i++) step(neutralInput());
      for (const s of ['home', 'away']) {
        for (let i = 0; i < teams[s].length; i++) {
          const p = teams[s][i];
          if (p.role === 'GK') {
            p.pos.set(s === 'home' ? -51 : 51, 0, 0);
          } else {
            p.pos.set(anchorX + (s === 'home' ? -36 : 36), 0, (i - 5) * 4.5);
          }
          p.vel.set(0, 0, 0);
          p.stop();
        }
      }
      ball.controlledBy = null;
      if (ball.stopDead) ball.stopDead();
      // Wait enough ticks for any prior kickLock to clear
      for (let i = 0; i < 45; i++) {
        ball.controlledBy = null;
        if (ball.stopDead) ball.stopDead();
        step(neutralInput());
      }
    };

    const events = [];
    match.onEvent((type, data) => events.push({ type, data }));

    // TEST 1: WASD cone assist on slow/stopped loose ball ~1.25m off straight +X ray
    resetCleanPlay(0);
    const chaser = teams.home.find((p) => p.role === 'FW');
    const mate = teams.home.find((p) => p.role === 'MF');
    chaser.pos.set(-7.5, 0, 0);
    mate.pos.set(8.0, 0, 2.0);
    ball.place(0, 1.25);
    ball.vel.set(0.15, 0, 0);
    // Step 25 frames waiting or switch so chaser is controlledPlayer cleanly before sprint
    for (let i = 0; i < 20 && match.controlledPlayer !== chaser; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
    }
    chaser.pos.set(-7.5, 0, 0);
    chaser.vel.set(0, 0, 0);
    chaser.face(0);
    ball.place(0, 1.25);
    ball.vel.set(0.15, 0, 0);
    let looseClaimed = false;
    let minLooseDist = 99;
    let chaserEndZ = 0;
    for (let i = 0; i < 110; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, sprint: true }));
      const d = Math.hypot(chaser.pos.x - ball.pos.x, chaser.pos.z - ball.pos.z);
      if (d < minLooseDist) minLooseDist = d;
      chaserEndZ = chaser.pos.z;
      if (ball.controlledBy === chaser) { looseClaimed = true; break; }
    }

    // TEST 2: Instant manual override when steering away (moveVec = -X while ball is +X)
    resetCleanPlay(0);
    const overP = match.controlledPlayer;
    overP.pos.set(-3.0, 0, 0);
    overP.vel.set(0, 0, 0);
    ball.place(1.0, 0.8);
    if (ball.stopDead) ball.stopDead();
    step(neutralInput({ moveVec: { x: -1, z: 0 }, magnitude: 1, active: true }));
    overP.pos.set(-3.0, 0, 0);
    overP.vel.set(0, 0, 0);
    for (let i = 0; i < 36; i++) {
      step(neutralInput({ moveVec: { x: -1, z: 0 }, magnitude: 1, active: true, sprint: true }));
    }
    const overrideMovedAway = overP.pos.x < -4.2 && ball.controlledBy !== overP;
    const overrideEndX = overP.pos.x;

    // TEST 3: Opponent ball carrier cone pull (~1.15m off straight +X WASD ray)
    resetCleanPlay(0);
    const def = teams.home.find((p) => p.role === 'DF');
    const opp = teams.away.find((p) => p.role === 'FW');
    opp.pos.set(0.5, 0, 1.15);
    ball.place(0.85, 1.15);
    for (let i = 0; i < 6; i++) step(neutralInput());
    const oppHadBall = ball.controlledBy === opp;
    def.pos.set(-7.0, 0, 0);
    def.vel.set(0, 0, 0);
    def.face(0);
    for (let i = 0; i < 35 && match.controlledPlayer !== def; i++) {
      step(neutralInput({ switchPressed: i % 10 === 0, moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
      if (match.controlledPlayer === def) break;
    }
    // Re-position cleanly right at start of chase once def is controlled
    def.pos.set(-7.0, 0, 0);
    def.vel.set(0, 0, 0);
    def.face(0);
    opp.pos.set(0.5, 0, 1.15);
    opp.vel.set(0, 0, 0);
    let minDefToOpp = 99;
    for (let i = 0; i < 105; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, sprint: true }));
      const d = Math.hypot(def.pos.x - opp.pos.x, def.pos.z - opp.pos.z);
      if (d < minDefToOpp) minDefToOpp = d;
    }

    // TEST 4: Wide-window pre-arrival one-touch Pass (~0.65s early while contested near opponent, NO empty tackle!)
    resetCleanPlay(0);
    events.length = 0;
    const runner = teams.home.find((p) => p.role === 'FW');
    const wing = teams.home.find((p) => p.role === 'MF');
    const oppContester = teams.away.find((p) => p.role === 'DF');
    runner.pos.set(-4.8, 0, 0);
    runner.vel.set(0, 0, 0);
    runner.face(0);
    wing.pos.set(4.5, 0, 7.0);
    oppContester.pos.set(0.8, 0, -1.5);
    ball.place(0, 0.5);
    if (ball.stopDead) ball.stopDead();
    // Ensure pickControlled locks onto runner
    for (let i = 0; i < 25 && match.controlledPlayer !== runner; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
    }
    runner.pos.set(-4.8, 0, 0);
    runner.vel.set(0, 0, 0);
    oppContester.pos.set(0.8, 0, -1.5);
    ball.place(0, 0.5);
    events.length = 0;
    // Tap Pass ~0.65s before arrival!
    step(neutralInput({ moveVec: { x: 1, z: 0.45 }, magnitude: 1, active: true, sprint: true, passPressed: true }));
    let queuedPassFired = false;
    let tacklesDuringQueue = 0;
    for (let i = 0; i < 95; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0.45 }, magnitude: 1, active: true, sprint: true }));
      for (const ev of events) {
        if (ev.type === 'tackle') tacklesDuringQueue++;
        if (ev.type === 'kick' && ev.data && ev.data.kind === 'pass') queuedPassFired = true;
      }
      events.length = 0;
      if (queuedPassFired) break;
    }

    // TEST 5: Shot hitting defender's BACK deflects loosely (NO clean snap to feet!)
    resetCleanPlay(20);
    events.length = 0;
    const shooter = teams.home.find((p) => p.role === 'FW');
    const backDef = teams.away.find((p) => p.role === 'DF');
    shooter.pos.set(20.0, 0, 0);
    shooter.vel.set(0, 0, 0);
    shooter.face(0);
    ball.place(20.42, 0.0);
    if (ball.stopDead) ball.stopDead();
    for (let i = 0; i < 15; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
      if (ball.controlledBy === shooter && match.controlledPlayer === shooter) break;
    }
    // Position backDef strictly ahead along +X facing AWAY (+X = 0 rad) right before shot!
    backDef.pos.set(25.2, 0, 0.04);
    backDef.vel.set(0, 0, 0);
    backDef.facing = 0;
    events.length = 0;
    step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, holdShoot: true, shootPressed: true }));
    // Hold 4 frames for solid shot power (~0.5), then release!
    for (let i = 0; i < 4; i++) step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, holdShoot: true }));
    step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));

    let deflected = false;
    let snappedToBackDef = false;
    let postDeflectSpeed = 0;
    let shotLaunched = false;
    let minBallToDef = 99;
    let atClosest = null;
    for (let i = 0; i < 65; i++) {
      // Pin backDef right on the shot line facing away (+X) before/during flight so we test pure back-hit physics
      if (!deflected) {
        backDef.pos.set(25.2, 0, 0.0);
        backDef.vel.set(0, 0, 0);
        backDef.facing = 0;
      }
      step(neutralInput());
      const bd = Math.hypot(ball.pos.x - backDef.pos.x, ball.pos.z - backDef.pos.z);
      if (bd < minBallToDef) {
        minBallToDef = bd;
        atClosest = {
          i,
          bx: +ball.pos.x.toFixed(2),
          by: +ball.pos.y.toFixed(2),
          bz: +ball.pos.z.toFixed(2),
          bvx: +ball.vel.x.toFixed(2),
          bvz: +ball.vel.z.toFixed(2),
          ctrl: ball.controlledBy ? ball.controlledBy.id : null,
        };
      }
      if (ball.controlledBy === backDef) snappedToBackDef = true;
      for (const ev of events) {
        if (ev.type === 'kick' && ev.data && ev.data.kind === 'shoot') shotLaunched = true;
        if (ev.type === 'kick' && ev.data && ev.data.kind === 'header' && ball.pos.x > 23.5) {
          deflected = true;
          postDeflectSpeed = Math.hypot(ball.vel.x, ball.vel.z);
        }
      }
      events.length = 0;
    }

    // TEST 6: Forward teammate through-ball pass (NOT a shot) still traps cleanly!
    resetCleanPlay(10);
    events.length = 0;
    const passer = teams.home.find((p) => p.role === 'MF');
    const thruRunner = teams.home.find((p) => p.role === 'FW');
    passer.pos.set(10.0, 0, 0);
    passer.face(0);
    ball.place(10.42, 0);
    for (let i = 0; i < 15; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
      if (ball.controlledBy === passer && match.controlledPlayer === passer) break;
    }
    thruRunner.pos.set(17.5, 0, 0);
    thruRunner.vel.set(2.5, 0, 0);
    thruRunner.face(0);
    step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, throughPressed: true }));
    let thruTrappedByMate = false;
    for (let i = 0; i < 120; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, sprint: true }));
      if (ball.controlledBy === thruRunner) { thruTrappedByMate = true; break; }
    }

    // TEST 7: 45-second open-play stability sim
    match.restartMatch();
    for (let i = 0; i < 45 * 60; i++) {
      match.setUserInput(null);
      match.update(DT);
      teams.update(DT);
      ball.update(DT);
    }

    return {
      looseClaimed,
      minLooseDist: +minLooseDist.toFixed(3),
      chaserEndZ: +chaserEndZ.toFixed(3),
      overrideMovedAway,
      overrideEndX: +overrideEndX.toFixed(3),
      oppHadBall,
      minDefToOpp: +minDefToOpp.toFixed(3),
      queuedPassFired,
      tacklesDuringQueue,
      shotLaunched,
      deflected,
      snappedToBackDef,
      postDeflectSpeed: +postDeflectSpeed.toFixed(2),
      minBallToDef: +minBallToDef.toFixed(3),
      atClosest,
      thruTrappedByMate,
      simPhaseAfter45s: match.state.phase,
    };
  });

  console.log('VERIFICATION REPORT:', JSON.stringify(results, null, 2));
  assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join('; ')}`);
  assert.ok(results.looseClaimed, `Expected WASD cone assist to claim offset loose ball (minDist=${results.minLooseDist}, endZ=${results.chaserEndZ})`);
  assert.ok(results.overrideMovedAway, `Expected manual steering away to cleanly override cone assist (endX=${results.overrideEndX})`);
  assert.ok(results.oppHadBall && results.minDefToOpp < 1.15, `Expected WASD cone assist to close onto offset opp carrier (oppHad=${results.oppHadBall}, minDef=${results.minDefToOpp})`);
  assert.ok(results.queuedPassFired && results.tacklesDuringQueue === 0, `Expected queued one-touch pass without tackle misfire (fired=${results.queuedPassFired}, tackles=${results.tacklesDuringQueue})`);
  assert.ok(results.shotLaunched && results.deflected && !results.snappedToBackDef && results.postDeflectSpeed >= 3.2 && results.postDeflectSpeed <= 13.5, `Expected loose shot-to-back deflection without snapping (launched=${results.shotLaunched}, deflected=${results.deflected}, snapped=${results.snappedToBackDef}, speed=${results.postDeflectSpeed}, minBallToDef=${results.minBallToDef})`);
  assert.ok(results.thruTrappedByMate, 'Expected forward through-ball pass to still trap cleanly by running teammate');
  console.log('ALL MECHANICS CHECKS PASSED!');
} finally {
  await browser.close();
  server.close();
}
