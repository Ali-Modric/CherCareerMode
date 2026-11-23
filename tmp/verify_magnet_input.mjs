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

  await page.goto(`${baseUrl}/index.html?cam=broadcast&t=1.8&seed=7&quality=low&live=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__SHOT_READY === true', { timeout: 60000 });

  // 1. HUD key alias hint check
  const hudHints = await page.evaluate(() => {
    const el = document.querySelector('.fh-ctrl-wrap');
    return el ? el.textContent : '';
  });
  assert.ok(hudHints.includes('X/N') && hudHints.includes('C/M') && hudHints.includes('SPACE/ENT'),
    `Expected alt-key hints in desktop controls bar, got: ${hudHints}`);
  console.log('1. HUD Alt-Key Hints PASSED');

  // 2. Real Keyboard Shift + W + D + Pass/Through/Lob/Shoot (X/N, C/M, B, Enter) while sprinting diagonally
  await page.evaluate(() => {
    window.__comboEvents = [];
    window.__APP.match.onEvent((t, d) => { if (t === 'kick') window.__comboEvents.push(d); });
  });

  const testCombo = async (keyToPress, expectedKinds) => {
    await page.evaluate(() => {
      const { match, ball, teams } = window.__APP;
      const DT = 1 / 60;
      match.restartMatch();
      for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
      const carrier = teams.home.find((p) => p.role === 'MF');
      const mate = teams.home.find((p) => p.role === 'FW' && p !== carrier);
      for (const s of ['home', 'away']) {
        for (const p of teams[s]) {
          if (p === carrier || p === mate) continue;
          p.pos.set(-45, 0, s === 'home' ? -30 : 30);
          p.vel.set(0, 0, 0);
          p.stop();
        }
      }
      carrier.pos.set(0, 0, 0);
      carrier.vel.set(0, 0, 0);
      carrier.facing = 0;
      mate.pos.set(-10, 0, 10);
      mate.vel.set(0, 0, 0);
      ball.place(0.35, 0);
      ball.stopDead();
      match.controlledPlayer = carrier;
      for (let i = 0; i < 6; i++) {
        match.setUserInput({
          moveVec: { x: 1, z: 0 }, magnitude: 1, sprint: false, modifier: false, chipMod: false,
          gkRush: false, pressAssist: false,
          passPressed: false, shootPressed: false, throughPressed: false, loftedPressed: false,
          switchPressed: false, standTacklePressed: false, slideTacklePressed: false,
          holdPass: false, holdShoot: false, holdThrough: false, holdLob: false,
          skillStepoverPressed: false, skillRoulettePressed: false, skillBallRollPressed: false,
          skillElasticoPressed: false, skillRollSide: 0,
        });
        match.update(DT); teams.update(DT); ball.update(DT);
        if (ball.controlledBy === carrier) break;
      }
    });

    await page.focus('body');
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => { window.__comboEvents = []; });
    await page.keyboard.press(keyToPress);
    await new Promise((r) => setTimeout(r, 320));
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');

    return await page.evaluate((kinds) => {
      const { ball, teams } = window.__APP;
      const carrier = teams.home.find((p) => p.role === 'MF');
      const matched = window.__comboEvents.filter((k) => kinds.includes(k.kind));
      return {
        matched,
        allKicks: window.__comboEvents.map((k) => k.kind),
        ballSpeed: Math.round(ball.vel.length() * 100) / 100,
        released: ball.controlledBy !== carrier,
      };
    }, expectedKinds);
  };

  const comboSpecs = [
    ['KeyX', ['pass']],
    ['KeyN', ['pass']],
    ['KeyC', ['through', 'pass']],
    ['KeyM', ['through', 'pass']],
    ['KeyB', ['lofted', 'pass']],
    ['Enter', ['shoot']],
  ];
  for (const [k, kinds] of comboSpecs) {
    const res = await testCombo(k, kinds);
    assert.ok(res.matched.length >= 1, `Shift+W+D + ${k} failed to register kick: ${JSON.stringify(res)}`);
    console.log(`2. Real Keyboard Shift+W+D+${k} PASSED:`, JSON.stringify(res));
  }

  // 3. Deterministic Sim Checks: Magnet, Manual Override, Pre-Arrival One-Touch Queue,
  //    Smart Switch, Diagonal Sprint Dribble, Trailing Shielding, and Ring Visual Cue
  const simChecks = await page.evaluate(() => {
    const { match, ball, teams, scene, THREE } = window.__APP;
    const DT = 1 / 60;
    const indicatorGrp = scene.children.find((c) => c && c.userData && c.userData.ringMat && c.userData.ring);
    const ringMat = indicatorGrp ? indicatorGrp.userData.ringMat : null;

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
    const isolate = (keep) => {
      for (const s of ['home', 'away']) {
        for (const p of teams[s]) {
          if (keep.includes(p)) continue;
          p.pos.set(-46, 0, s === 'home' ? -30 : 30);
          p.vel.set(0, 0, 0);
          p.stop();
        }
      }
    };

    // A) Directional Magnet + Cyan Ring Pulse
    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    const passer = teams.home.find((p) => p.role === 'MF');
    const recv = teams.home.find((p) => p.role === 'FW' && p !== passer);
    isolate([passer, recv]);
    passer.pos.set(-8, 0, 0);
    passer.vel.set(0, 0, 0);
    passer.facing = 0;
    recv.pos.set(4, 0, -2.1); // slightly off ball line along -Z
    recv.vel.set(0, 0, 0);
    recv.facing = 0;
    ball.place(-7.6, 0);
    ball.stopDead();
    match.controlledPlayer = passer;
    for (let i = 0; i < 6; i++) {
      match.setUserInput(mkInput({ moveVec: { x: 1, z: -0.2 }, magnitude: 1 }));
      match.update(DT); teams.update(DT); ball.update(DT);
      if (ball.controlledBy === passer) break;
    }
    match.setUserInput(mkInput({ moveVec: { x: 1, z: -0.15 }, magnitude: 1, passPressed: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    for (let i = 0; i < 12; i++) {
      match.setUserInput(mkInput({ moveVec: { x: 1, z: 0 }, magnitude: 1 }));
      match.update(DT); teams.update(DT); ball.update(DT);
    }
    const zBeforeMagnet = recv.pos.z;
    let magnetTrapped = false;
    let magnetCyanPeakG = 0;
    for (let i = 0; i < 65; i++) {
      // User holds pure +X (not aiming toward ball's Z=0 line); balanced magnet should pull Z toward 0!
      match.setUserInput(mkInput({ moveVec: { x: 1, z: 0 }, magnitude: 1 }));
      match.update(DT); teams.update(DT); ball.update(DT);
      if (ringMat && !ball.controlledBy) magnetCyanPeakG = Math.max(magnetCyanPeakG, ringMat.color.g);
      if (ball.controlledBy === recv) { magnetTrapped = true; break; }
    }
    const zAfterMagnet = recv.pos.z;

    // B) Full-Manual Override (user steers sharply away from incoming ball -> magnet yields)
    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    const recvMan = teams.home.find((p) => p.role === 'FW');
    isolate([recvMan]);
    recvMan.pos.set(4, 0, -1.5);
    recvMan.vel.set(0, 0, 0);
    recvMan.facing = 0;
    match.controlledPlayer = recvMan;
    ball.place(-6, 0);
    ball.stopDead();
    ball.kick(new THREE.Vector3(11, 0.15, 0));
    for (let i = 0; i < 32; i++) {
      // Pull sharply away (-Z) perpendicular/away from meet point at Z=0
      match.setUserInput(mkInput({ moveVec: { x: 0, z: -1 }, magnitude: 1, sprint: true }));
      match.update(DT); teams.update(DT); ball.update(DT);
    }
    const manualOverrideDeltaZ = recvMan.pos.z - (-1.5);

    // C) Pre-Arrival Buffered One-Touch Through Ball + Amber Ring Pulse (NO air-tackle!)
    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    const recvOT = teams.home.find((p) => p.role === 'MF');
    const runnerOT = teams.home.find((p) => p.role === 'FW' && p !== recvOT);
    isolate([recvOT, runnerOT]);
    recvOT.pos.set(0, 0, 0);
    recvOT.vel.set(0, 0, 0);
    recvOT.facing = Math.PI;
    runnerOT.pos.set(16, 0, 3);
    runnerOT.vel.set(3, 0, 0);
    match.controlledPlayer = recvOT;
    ball.place(-2.6, 0);
    ball.stopDead();
    ball.kick(new THREE.Vector3(12.5, 0.12, 0));
    let otTackles = 0;
    let otThroughKicks = 0;
    match.onEvent((t, d) => {
      if (t === 'tackle') otTackles++;
      if (t === 'kick' && d && (d.kind === 'through' || d.kind === 'pass')) otThroughKicks++;
    });
    // Press Through 180ms before ball arrives at recvOT!
    match.setUserInput(mkInput({ moveVec: { x: 1, z: 0.2 }, magnitude: 1, sprint: true, throughPressed: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    const queueRingColor = ringMat
      ? { r: +ringMat.color.r.toFixed(2), g: +ringMat.color.g.toFixed(2), b: +ringMat.color.b.toFixed(2) }
      : null;
    for (let i = 0; i < 36; i++) {
      match.setUserInput(mkInput({ moveVec: { x: 1, z: 0.2 }, magnitude: 1, sprint: true }));
      match.update(DT); teams.update(DT); ball.update(DT);
    }

    // D) Pre-Arrival Queued Chest-Height Volley Shot
    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    const striker = teams.home.find((p) => p.role === 'FW');
    isolate([striker]);
    striker.pos.set(36, 0, 0);
    striker.vel.set(0, 0, 0);
    striker.facing = 0;
    match.controlledPlayer = striker;
    ball.place(34.8, -1.6);
    ball.pos.y = 1.35;
    ball.vel.set(1.5, 0.2, 8.5);
    let volleyFired = false;
    match.onEvent((t, d) => { if (t === 'kick' && d && d.kind === 'volley') volleyFired = true; });
    match.setUserInput(mkInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, shootPressed: true }));
    for (let i = 0; i < 20; i++) {
      match.update(DT); teams.update(DT); ball.update(DT);
      match.setUserInput(mkInput({ moveVec: { x: 1, z: 0 }, magnitude: 1 }));
    }

    // E) Smarter Player Switching onto Fast Downfield Loose Ball
    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    const backMid = teams.home.find((p) => p.role === 'DF');
    const winger = teams.home.find((p) => p.role === 'FW');
    isolate([backMid, winger]);
    backMid.pos.set(-5, 0, 0);
    backMid.vel.set(0, 0, 0);
    winger.pos.set(10, 0, 1.0);
    winger.vel.set(0, 0, 0);
    match.controlledPlayer = backMid;
    ball.place(0, 0);
    ball.stopDead();
    ball.kick(new THREE.Vector3(14, 0.1, 0));
    for (let i = 0; i < 22; i++) {
      match.update(DT); teams.update(DT); ball.update(DT);
    }
    const switchedToWinger = match.controlledPlayer === winger;

    // F) Tighter Diagonal Sprint Turn + Trailing Defender Shield Protection
    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    const drib = teams.home.find((p) => p.role === 'FW');
    const chaser = teams.away.find((p) => p.role === 'DF');
    isolate([drib, chaser]);
    drib.pos.set(0, 0, 0);
    drib.vel.set(6.5, 0, 0);
    drib.facing = 0;
    chaser.pos.set(-1.1, 0, 0); // directly behind dribbler
    chaser.vel.set(6.5, 0, 0);
    chaser.facing = 0;
    ball.place(0.45, 0);
    ball.stopDead();
    match.controlledPlayer = drib;
    for (let i = 0; i < 5; i++) {
      match.setUserInput(mkInput({ moveVec: { x: 0.707, z: 0.707 }, magnitude: 1, sprint: true }));
      match.update(DT); teams.update(DT); ball.update(DT);
    }
    let maxDribGap = 0;
    for (let i = 0; i < 28; i++) {
      // Rapid 90-deg diagonal sprint turn while trailed closely from behind
      match.setUserInput(mkInput({ moveVec: { x: 0.707, z: -0.707 }, magnitude: 1, sprint: true }));
      match.update(DT); teams.update(DT); ball.update(DT);
      maxDribGap = Math.max(maxDribGap, Math.hypot(ball.pos.x - drib.pos.x, ball.pos.z - drib.pos.z));
    }
    const keptBallUnderBehindPressure = ball.controlledBy === drib;

    return {
      zBeforeMagnet: +zBeforeMagnet.toFixed(2),
      zAfterMagnet: +zAfterMagnet.toFixed(2),
      magnetPulledCloserToLine: Math.abs(zAfterMagnet) < Math.abs(zBeforeMagnet) - 0.15,
      magnetTrapped,
      magnetCyanPeakG: +magnetCyanPeakG.toFixed(2),
      manualOverrideDeltaZ: +manualOverrideDeltaZ.toFixed(2),
      otTackles,
      otThroughKicks,
      queueRingColor,
      volleyFired,
      switchedToWinger,
      maxDribGap: +maxDribGap.toFixed(2),
      keptBallUnderBehindPressure,
    };
  });

  console.log('3. Simulation Checks:', JSON.stringify(simChecks));
  assert.equal(simChecks.magnetTrapped, true, 'Magnet receiver should claim pass cleanly');
  assert.equal(simChecks.magnetPulledCloserToLine, true, 'Balanced magnet should pull off-line runner closer to ball line');
  assert.ok(simChecks.magnetCyanPeakG > 1.0, `Expected cyan magnet ring pulse (g>1.0), got ${simChecks.magnetCyanPeakG}`);
  assert.ok(simChecks.manualOverrideDeltaZ < -1.0, `Manual override should pull cleanly away (-Z): ${simChecks.manualOverrideDeltaZ}`);
  assert.equal(simChecks.otTackles, 0, 'Pre-arrival Through press must NOT trigger an off-ball tackle');
  assert.ok(simChecks.otThroughKicks >= 1, 'Pre-arrival Through press should execute crisp one-touch kick on arrival');
  assert.ok(simChecks.queueRingColor && simChecks.queueRingColor.r > 2.0 && simChecks.queueRingColor.g > 1.5,
    `Expected amber-gold ring pulse on queued one-touch, got ${JSON.stringify(simChecks.queueRingColor)}`);
  assert.equal(simChecks.volleyFired, true, 'Pre-arrival Shoot press on chest-high ball should execute volley');
  assert.equal(simChecks.switchedToWinger, true, 'PickControlled should switch to downfield runner on loose ball trajectory');
  assert.ok(simChecks.maxDribGap < 0.75, `Diagonal sprint dribble gap should stay tight (<0.75m), got ${simChecks.maxDribGap}`);
  assert.equal(simChecks.keptBallUnderBehindPressure, true, 'Trailing defender behind carrier must not poke-steal during diagonal cut');

  assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join('; ')}`);
  console.log('ALL MAGNET, INPUT BUFFERING, AND CONTROL CHECKS PASSED!');
} finally {
  await browser.close();
  server.close();
}
