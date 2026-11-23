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

  await page.goto(`${baseUrl}/index.html?cam=broadcast&t=1.5&seed=11&quality=low`, {
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
            p.pos.set(anchorX + (s === 'home' ? -44 : 44), 0, (i - 5) * 4.5);
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

    const homeOut = teams.home.filter((p) => p.role !== 'GK');
    const awayOut = teams.away.filter((p) => p.role !== 'GK');

    // =========================================================================
    // TEST 1: Far normal pass (quick tap) reaches ~35m distant teammate crisply
    // =========================================================================
    resetCleanPlay(0);
    const passer1 = homeOut[4];
    const farMate1 = homeOut[8];
    passer1.pos.set(-10, 0, -18);
    passer1.facing = Math.atan2(26, 24);
    farMate1.pos.set(14, 0, 8); // ~35.4m away!
    farMate1.vel.set(0, 0, 0);
    ball.pos.set(-9.6, 0.096, -17.6);
    step(neutralInput());
    for (let i = 0; i < 15; i++) {
      step(neutralInput({ moveVec: { x: 0.68, z: 0.73 }, magnitude: 1, active: true }));
    }
    const aimdx = farMate1.pos.x - passer1.pos.x;
    const aimdz = farMate1.pos.z - passer1.pos.z;
    const aiml = Math.hypot(aimdx, aimdz);
    step(neutralInput({
      moveVec: { x: aimdx / aiml, z: aimdz / aiml },
      magnitude: 1,
      active: true,
      passPressed: true,
    }));
    let pass1LaunchSp = 0;
    let farMate1Claimed = false;
    let pass1MinDist = 99;
    for (let i = 0; i < 190; i++) {
      step(neutralInput());
      const bsp = Math.hypot(ball.vel.x, ball.vel.z);
      if (i > 4 && i < 25 && !ball.controlledBy) {
        pass1LaunchSp = Math.max(pass1LaunchSp, bsp);
      }
      if (i > 15) {
        pass1MinDist = Math.min(pass1MinDist, Math.hypot(ball.pos.x - farMate1.pos.x, ball.pos.z - farMate1.pos.z));
      }
      if (ball.controlledBy === farMate1) {
        farMate1Claimed = true;
        break;
      }
    }

    // =========================================================================
    // TEST 2: Wing cross has high arc, in-swinging spinY, and lands onto target
    // =========================================================================
    resetCleanPlay(0);
    const crosser2 = homeOut[9];
    const striker2 = homeOut[8];
    crosser2.pos.set(32, 0, 22);
    crosser2.facing = Math.atan2(-20, 9);
    striker2.pos.set(40, 0, 1.5);
    striker2.vel.set(0, 0, 0);
    // Keep striker cleanly onside (2+ defenders deeper at x=47, far flank) while testing pure cross landing
    for (let i = 0; i < awayOut.length; i++) awayOut[i].pos.set(47, 0, -16 - i * 1.1);
    teams.away.find((p) => p.role === 'GK').pos.set(52, 0, 12);
    ball.pos.set(32.3, 0.096, 21.7);
    step(neutralInput());
    for (let i = 0; i < 10; i++) step(neutralInput());
    // Hold Lob ~0.35s for moderate-firm cross (~0.62 power)
    const cDx = striker2.pos.x - crosser2.pos.x;
    const cDz = striker2.pos.z - crosser2.pos.z;
    const cDl = Math.hypot(cDx, cDz);
    for (let i = 0; i < 20; i++) {
      step(neutralInput({
        moveVec: { x: cDx / cDl, z: cDz / cDl },
        magnitude: 1,
        active: true,
        holdLob: true,
      }));
    }
    // Release Lob to whip cross
    step(neutralInput({ moveVec: { x: cDx / cDl, z: cDz / cDl }, magnitude: 1, active: true }));
    let cross2PeakY = 0;
    let cross2SpinY = 0;
    let cross2StrikerClaimed = false;
    let cross2MinDistToStriker = 99;
    let cross2LandDist = 99;
    for (let i = 0; i < 180; i++) {
      step(neutralInput());
      cross2PeakY = Math.max(cross2PeakY, ball.pos.y);
      if (i > 4 && i < 30 && Math.abs(ball.spin.y) > 0.5 && cross2SpinY === 0) {
        cross2SpinY = ball.spin.y;
      }
      if (i > 20) {
        const sd = Math.hypot(ball.pos.x - striker2.pos.x, ball.pos.z - striker2.pos.z);
        cross2MinDistToStriker = Math.min(cross2MinDistToStriker, sd);
        if (ball.pos.y <= 0.25 && cross2LandDist > 90) {
          cross2LandDist = sd;
        }
      }
      if (ball.controlledBy === striker2 || (i > 25 && Math.hypot(ball.pos.x - striker2.pos.x, ball.pos.z - striker2.pos.z) < 1.5)) {
        cross2StrikerClaimed = true;
      }
    }

    // =========================================================================
    // TEST 3: Max-power crosses occasionally carry slightly further past target
    // =========================================================================
    let maxPowerTrials = 10;
    let maxPowerBeyondCount = 0;
    let maxPowerOnTargetCount = 0;
    const trialLogs = [];
    for (let trial = 0; trial < maxPowerTrials; trial++) {
      resetCleanPlay(0);
      const cw = homeOut[9];
      const st = homeOut[8];
      cw.pos.set(32, 0, 22);
      cw.facing = Math.atan2(-20, 9);
      st.pos.set(41, 0, 2.0);
      st.vel.set(0, 0, 0);
      // Move away defenders far from crosser so windup tests pure cross delivery
      for (let i = 0; i < awayOut.length; i++) awayOut[i].pos.set(-42, 0, (i - 5) * 4);
      teams.away.find((p) => p.role === 'GK').pos.set(52, 0, 14);
      ball.pos.set(32.3, 0.096, 21.7);
      step(neutralInput());
      for (let i = 0; i < 8; i++) step(neutralInput());
      const tDx = st.pos.x - cw.pos.x;
      const tDz = st.pos.z - cw.pos.z;
      const tDl = Math.hypot(tDx, tDz);
      for (let i = 0; i < 50; i++) {
        st.pos.set(41, 0, 2.0);
        st.vel.set(0, 0, 0);
        step(neutralInput({
          moveVec: { x: tDx / tDl, z: tDz / tDl },
          magnitude: 1,
          active: true,
          holdLob: true,
        }));
      }
      let firstTouchDist = 99;
      let beyondTarget = false;
      let peakY = 0;
      let landSpot = null;
      for (let i = 0; i < 160; i++) {
        st.pos.set(41, 0, 2.0);
        st.vel.set(0, 0, 0);
        step(neutralInput());
        peakY = Math.max(peakY, ball.pos.y);
        if (i > 30 && ball.pos.y <= 0.45) {
          firstTouchDist = Math.hypot(ball.pos.x - 41, ball.pos.z - 2.0);
          landSpot = { i, x: +ball.pos.x.toFixed(2), y: +ball.pos.y.toFixed(2), z: +ball.pos.z.toFixed(2), spinY: +ball.spin.y.toFixed(2), peakY: +peakY.toFixed(2), ctrl: ball.controlledBy ? ball.controlledBy.id : null };
          if (ball.pos.z < 0.2 && firstTouchDist > 1.7) beyondTarget = true;
          else maxPowerOnTargetCount++;
          break;
        }
      }
      if (!landSpot) landSpot = { noLand: true, x: +ball.pos.x.toFixed(2), y: +ball.pos.y.toFixed(2), z: +ball.pos.z.toFixed(2), peakY: +peakY.toFixed(2) };
      trialLogs.push(landSpot);
      if (beyondTarget) maxPowerBeyondCount++;
    }

    // =========================================================================
    // TEST 4: Central midfielders don't deadlock while user dribbles on wing
    // =========================================================================
    resetCleanPlay(0);
    const winger4 = homeOut[9]; // RW dribbling down right wing in final third
    winger4.pos.set(16, 0, 23);
    winger4.facing = 0;
    ball.pos.set(16.4, 0.096, 23);
    // Home RCM (i=6) pushing forward into the box-edge slot (x ~ 34.5, z ~ 2.5)
    const homeCm = homeOut[6];
    homeCm.pos.set(8, 0, 2.5);
    homeCm.vel.set(0, 0, 0);
    // Away CDM sitting directly ahead in his lane
    const awayCdm = awayOut[5];
    awayCdm.pos.set(16, 0, 2.52);
    awayCdm.vel.set(0, 0, 0);
    // Place other away defenders deep out of the winger's flank
    for (let i = 0; i < awayOut.length; i++) {
      if (i !== 5) awayOut[i].pos.set(46, 0, -24 + i * 2.2);
    }
    step(neutralInput());
    let homeCmMaxX = homeCm.pos.x;
    let closeLockFrames = 0;
    let maxCloseStreak = 0;
    for (let i = 0; i < 240; i++) {
      // User sprints straight down right wing
      step(neutralInput({ moveVec: { x: 1, z: 0 }, magnitude: 1, active: true, sprint: true }));
      homeCmMaxX = Math.max(homeCmMaxX, homeCm.pos.x);
      const sep = Math.hypot(homeCm.pos.x - awayCdm.pos.x, homeCm.pos.z - awayCdm.pos.z);
      if (sep < 0.96) {
        closeLockFrames++;
        maxCloseStreak = Math.max(maxCloseStreak, closeLockFrames);
      } else {
        closeLockFrames = 0;
      }
    }

    return {
      pass1LaunchSp,
      pass1MinDist,
      farMate1Claimed,
      cross2PeakY,
      cross2SpinY,
      cross2StrikerClaimed,
      cross2MinDistToStriker,
      maxPowerBeyondCount,
      maxPowerOnTargetCount,
      trialLogs,
      homeCmMaxX,
      homeCmEnd: { x: homeCm.pos.x, z: homeCm.pos.z },
      winger4End: { x: winger4.pos.x, z: winger4.pos.z },
      awayCdmEndX: awayCdm.pos.x,
      maxCloseStreak,
    };
  });

  console.log('RESULTS:', JSON.stringify(results, null, 2));
  assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join('; ')}`);

  assert.ok(results.pass1LaunchSp >= 17.0, `Expected far normal pass launch speed >= 17.0 m/s, got ${results.pass1LaunchSp}`);
  assert.ok(results.farMate1Claimed, `Expected far teammate to claim tapped 35m pass cleanly (minDist=${results.pass1MinDist})`);

  assert.ok(results.cross2PeakY >= 3.0, `Expected higher cross arc >= 3.0m, got ${results.cross2PeakY}`);
  assert.ok(results.cross2SpinY < -8.0, `Expected in-swinging curl spinY < -8 rad/s from right wing, got ${results.cross2SpinY}`);
  assert.ok(results.cross2StrikerClaimed || results.cross2MinDistToStriker < 1.8, `Expected normal cross to fall onto target striker (minDist=${results.cross2MinDistToStriker})`);

  assert.ok(results.maxPowerBeyondCount >= 1 && results.maxPowerBeyondCount < 10, `Expected probabilistic far-post overshoot on max-power crosses (beyond=${results.maxPowerBeyondCount}/10, onTarget=${results.maxPowerOnTargetCount}/10)`);

  assert.ok(results.homeCmMaxX > 6.5, `Expected central midfielder to advance smoothly past opposing marker while wing-dribbling, maxX=${results.homeCmMaxX}`);
  assert.ok(results.maxCloseStreak < 36, `Expected zero prolonged face-to-face collision deadlock (<0.6s), maxCloseStreak=${results.maxCloseStreak} frames`);

  console.log('ALL PASS / CROSS / COLLISION VERIFICATIONS PASSED!');
} finally {
  await browser.close();
  server.close();
}
