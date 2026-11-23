import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';
const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  let fp = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?cam=broadcast&t=1.5&seed=7&quality=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__SHOT_READY === true');
  const log = await page.evaluate(() => {
    const { match, ball, teams } = window.__APP;
    const DT = 1 / 60;
    const mkInput = (o = {}) => ({
      moveVec: { x: 1, z: 0 }, magnitude: 1, sprint: false, modifier: false, chipMod: false,
      gkRush: false, pressAssist: false, passPressed: false, shootPressed: false, throughPressed: false, loftedPressed: false,
      switchPressed: false, standTacklePressed: false, slideTacklePressed: false, holdPass: false, holdShoot: false,
      holdThrough: false, holdLob: false, skillStepoverPressed: false, skillRoulettePressed: false,
      skillBallRollPressed: false, skillElasticoPressed: false, skillRollSide: 0, ...o,
    });
    const carrier = teams.home.find((p) => p.role === 'FW');
    const opp = teams.away.find((p) => p.role === 'DF');
    match.restartMatch();
    for (let i = 0; i < 95; i++) { match.update(DT); teams.update(DT); ball.update(DT); }
    for (const s of ['home', 'away']) for (const p of teams[s]) if (p !== carrier && p !== opp) { p.pos.set(-45, 0, s === 'home' ? -30 : 30); p.vel.set(0, 0, 0); p.stop(); }
    carrier.pos.set(0, 0, 0); carrier.vel.set(3.5, 0, 0); carrier.facing = 0;
    opp.pos.set(2.6, 0, 0); opp.vel.set(0, 0, 0); opp.facing = Math.PI;
    ball.place(0.3, 0); ball.stopDead(); match.controlledPlayer = carrier;
    for (let i = 0; i < 6; i++) { match.setUserInput(mkInput()); match.update(DT); teams.update(DT); ball.update(DT); if (ball.controlledBy === carrier) break; }
    const out = [];
    const snap = (tag) => out.push({
      tag,
      cx: +carrier.pos.x.toFixed(2), cz: +carrier.pos.z.toFixed(2),
      cvx: +carrier.vel.x.toFixed(2), cvz: +carrier.vel.z.toFixed(2),
      ox: +opp.pos.x.toFixed(2), oz: +opp.pos.z.toFixed(2),
      ctrl: ball.controlledBy === carrier,
      kc: match.state.kickCharge.active ? match.state.kickCharge.kind : null,
    });
    snap('pre');
    match.setUserInput(mkInput({ shootPressed: true, holdShoot: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    snap('f1_shoot');
    match.setUserInput(mkInput({ passPressed: true }));
    match.update(DT); teams.update(DT); ball.update(DT);
    snap('f2_pass');
    for (let i = 3; i <= 27; i++) {
      match.setUserInput(mkInput());
      match.update(DT); teams.update(DT); ball.update(DT);
      if (i % 3 === 0) snap(`f${i}`);
    }
    return out;
  });
  console.log(JSON.stringify(log, null, 2));
} finally {
  await browser.close();
  server.close();
}
