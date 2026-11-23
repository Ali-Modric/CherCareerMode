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
      for (let i = 0; i < 45; i++) {
        ball.controlledBy = null;
        if (ball.stopDead) ball.stopDead();
        step(neutralInput());
      }
    };

    const events = [];
    match.onEvent((type, data) => events.push({ type, data }));

    // 1. Pass to teammate with IDLE keys after kick -> receiver auto-sprints to meet pass
    resetCleanPlay(0);
    const passer1 = teams.home.find((p) => p.role === 'MF');
    const recv1 = teams.home.find((p) => p.role === 'FW');
    passer1.pos.set(-5, 0, 0);
    passer1.facing = 0;
    recv1.pos.set(6, 0, 4.5);
    recv1.facing = 0;
    ball.place(-4.58, 0);
    for (let i = 0; i < 15; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
      if (ball.controlledBy === passer1 && match.controlledPlayer === passer1) break;
    }
    recv1.pos.set(6, 0, 4.5);
    recv1.vel.set(0, 0, 0);
    step(neutralInput({ moveVec: { x: 0.9, z: 0.44 }, magnitude: 1, active: true, passPressed: true }));
    let idlePassClaimed = false;
    let recv1MaxSp = 0;
    for (let i = 0; i < 110; i++) {
      // Keep userT active with neutral/idle movement (magnitude 0, no keys pressed)
      step(neutralInput({ moveVec: { x: 0, z: 0 }, magnitude: 0, active: false }));
      const sp = Math.hypot(recv1.vel.x, recv1.vel.z);
      if (match.controlledPlayer === recv1 && sp > recv1MaxSp) recv1MaxSp = sp;
      if (ball.controlledBy === recv1) { idlePassClaimed = true; break; }
    }

    // 2. Pass while STILL holding pass-aim direction (+X) after kick -> grace keeps receiver meeting the pass
    resetCleanPlay(0);
    const passer2 = teams.home.find((p) => p.role === 'MF');
    const recv2 = teams.home.find((p) => p.role === 'FW');
    passer2.pos.set(-6, 0, 0);
    passer2.facing = 0;
    recv2.pos.set(4, 0, 3.2);
    recv2.facing = 0;
    ball.place(-5.58, 0);
    for (let i = 0; i < 15; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
      if (ball.controlledBy === passer2 && match.controlledPlayer === passer2) break;
    }
    recv2.pos.set(4, 0, 3.2);
    recv2.vel.set(0, 0, 0);
    step(neutralInput({ moveVec: { x: 0.95, z: 0.31 }, magnitude: 1, active: true, passPressed: true }));
    let heldAimPassClaimed = false;
    for (let i = 0; i < 110; i++) {
      // Keep holding the exact pass-aim direction for ~25 frames after launch, then release
      const holding = i < 28;
      step(neutralInput(holding ? { moveVec: { x: 0.95, z: 0.31 }, magnitude: 1, active: true } : {}));
      if (ball.controlledBy === recv2) { heldAimPassClaimed = true; break; }
    }

    // 3. Pass with deliberate opposite-direction manual override after release -> receiver breaks off
    resetCleanPlay(0);
    const passer3 = teams.home.find((p) => p.role === 'MF');
    const recv3 = teams.home.find((p) => p.role === 'FW');
    passer3.pos.set(-10, 0, 0);
    passer3.facing = 0;
    recv3.pos.set(8, 0, 0);
    recv3.facing = 0;
    ball.place(-9.58, 0);
    for (let i = 0; i < 15; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true }));
      if (ball.controlledBy === passer3 && match.controlledPlayer === passer3) break;
    }
    recv3.pos.set(8, 0, 0);
    recv3.vel.set(0, 0, 0);
    step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, passPressed: true }));
    for (let i = 0; i < 11; i++) step(neutralInput()); // release right after kick launch
    // Now deliberately steer in the opposite direction (+X away from the ball approaching from -X)
    const startX3 = recv3.pos.x;
    const ctrlAtStart3 = match.controlledPlayer ? match.controlledPlayer.id : null;
    for (let i = 0; i < 42; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, sprint: true }));
    }
    const recv3EndX = recv3.pos.x;
    const passOverrideMovedAway = recv3EndX > startX3 + 1.5 && ball.controlledBy !== recv3;

    // 4. Loose ball with IDLE keys -> controlledPlayer auto-sprints and claims it
    resetCleanPlay(0);
    const chaser4 = teams.home.find((p) => p.role === 'FW');
    chaser4.pos.set(-5.5, 0, 1.8);
    chaser4.vel.set(0, 0, 0);
    ball.place(0, 0);
    if (ball.stopDead) ball.stopDead();
    for (let i = 0; i < 20 && match.controlledPlayer !== chaser4; i++) {
      step(neutralInput({ moveVec: { x: 0, z: 0 }, magnitude: 0, active: false }));
    }
    chaser4.pos.set(-5.5, 0, 1.8);
    chaser4.vel.set(0, 0, 0);
    ball.place(0, 0);
    if (ball.stopDead) ball.stopDead();
    let idleLooseClaimed = false;
    let idleLooseMaxSp = 0;
    for (let i = 0; i < 95; i++) {
      step(neutralInput({ moveVec: { x: 0, z: 0 }, magnitude: 0, active: false }));
      const sp = Math.hypot(chaser4.vel.x, chaser4.vel.z);
      if (sp > idleLooseMaxSp) idleLooseMaxSp = sp;
      if (ball.controlledBy === chaser4) { idleLooseClaimed = true; break; }
    }

    // 5. Sharp-turn override on loose ball -> controlledPlayer runs away, next-closest teammate chases!
    resetCleanPlay(0);
    const ctrl5 = teams.home.find((p) => p.role === 'FW');
    const mate5 = teams.home.find((p) => p.role === 'MF');
    ctrl5.pos.set(-3.0, 0, 0);
    mate5.pos.set(-5.0, 0, 2.0);
    ball.place(1.0, 0);
    if (ball.stopDead) ball.stopDead();
    for (let i = 0; i < 20 && match.controlledPlayer !== ctrl5; i++) {
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1 }));
    }
    ctrl5.pos.set(-3.0, 0, 0);
    ctrl5.vel.set(0, 0, 0);
    mate5.pos.set(-5.0, 0, 2.0);
    mate5.vel.set(0, 0, 0);
    ball.place(1.0, 0);
    let mateFallbackClaimed = false;
    let mateMovedTowardBall = false;
    for (let i = 0; i < 95; i++) {
      // Hold -X override while ctrl5 is still the controlled player; verify mate5 closes in automatically
      const inp = match.controlledPlayer === ctrl5
        ? neutralInput({ moveVec: { x: -1, z: 0 }, magnitude: 1, active: true, sprint: true })
        : neutralInput({ moveVec: { x: 0, z: 0 }, magnitude: 0, active: false });
      step(inp);
      if (mate5.pos.x > -3.5) mateMovedTowardBall = true;
      if (ball.controlledBy === mate5) { mateFallbackClaimed = true; break; }
    }
    const ctrlOverrodeAway = ctrl5.pos.x < -4.4;

    // 6. Carrier closing assist when holding Pass (pressAssist) without air-tackle at >3m
    resetCleanPlay(0);
    events.length = 0;
    const def6 = teams.home.find((p) => p.role === 'DF');
    const opp6 = teams.away.find((p) => p.role === 'FW');
    opp6.pos.set(0.5, 0, 1.4);
    ball.place(0.85, 1.4);
    for (let i = 0; i < 6; i++) step(neutralInput());
    def6.pos.set(-6.0, 0, 0);
    def6.vel.set(0, 0, 0);
    for (let i = 0; i < 35 && match.controlledPlayer !== def6; i++) {
      step(neutralInput({ switchPressed: i % 10 === 0, moveVec: { x: 1, z: 0 }, magnitude: 1 }));
      if (match.controlledPlayer === def6) break;
    }
    def6.pos.set(-6.0, 0, 0);
    def6.vel.set(0, 0, 0);
    opp6.pos.set(0.5, 0, 1.4);
    opp6.vel.set(0, 0, 0);
    events.length = 0;
    let minDefOpp6 = 99;
    let farAirTackles = 0;
    for (let i = 0; i < 85; i++) {
      step(neutralInput({
        moveVec: { x: 0, z: 0 },
        magnitude: 0,
        pressAssist: true,
        holdPass: true,
        passPressed: i === 0,
      }));
      const d = Math.hypot(def6.pos.x - opp6.pos.x, def6.pos.z - opp6.pos.z);
      if (d < minDefOpp6) minDefOpp6 = d;
      for (const ev of events) {
        if (ev.type === 'tackle' && d > 3.0) farAirTackles++;
      }
      events.length = 0;
    }

    return {
      idlePassClaimed,
      recv1MaxSp: +recv1MaxSp.toFixed(2),
      heldAimPassClaimed,
      passOverrideMovedAway,
      startX3: +startX3.toFixed(2),
      ctrlAtStart3,
      recv3Id: recv3.id,
      phase3: match.state.phase,
      recv3EndX: +recv3EndX.toFixed(2),
      idleLooseClaimed,
      idleLooseMaxSp: +idleLooseMaxSp.toFixed(2),
      ctrlOverrodeAway,
      mateMovedTowardBall,
      mateFallbackClaimed,
      minDefOpp6: +minDefOpp6.toFixed(2),
      farAirTackles,
    };
  });

  console.log('AUTO-PURSUIT REPORT:', JSON.stringify(results, null, 2));
  assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join('; ')}`);
  assert.ok(results.idlePassClaimed && results.recv1MaxSp > 4.5, `Expected idle receiver to auto-sprint onto pass (${JSON.stringify(results)})`);
  assert.ok(results.heldAimPassClaimed, 'Expected receiver to meet pass despite brief lingering pass-aim key');
  assert.ok(results.passOverrideMovedAway, 'Expected opposite-direction steering post-pass to override cleanly');
  assert.ok(results.idleLooseClaimed && results.idleLooseMaxSp > 4.5, 'Expected idle player to auto-sprint onto loose ball');
  assert.ok(results.ctrlOverrodeAway && results.mateFallbackClaimed, 'Expected sharp-turn override and teammate fallback chase on loose ball');
  assert.ok(results.minDefOpp6 < 1.35 && results.farAirTackles === 0, `Expected Pass-hold closing assist without far air-tackle (${JSON.stringify(results)})`);
  console.log('ALL AUTO-PURSUIT CHECKS PASSED!');
} finally {
  await browser.close();
  server.close();
}
