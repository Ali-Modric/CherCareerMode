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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e)); console.error('PAGEERROR:', e); });
  page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push(m.text()); console.error('CONSOLE_ERR:', m.text()); } });

  await page.goto(`${baseUrl}/index.html?cam=broadcast&t=3&seed=7&live=1&quality=low`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction('window.__SHOT_READY === true', { timeout: 60000 });
  await sleep(150);

  // 1. Open pause drawer via pause button click
  await page.click('.fh-pause-btn');
  await page.waitForFunction('window.__APP.settings.isPaused() === true');
  await sleep(80);

  // Verify drawer fits cleanly in 1280x720 viewport and RESUME MATCH is visible
  const layoutCheck = await page.evaluate(() => {
    const drawer = document.querySelector('.fh-drawer');
    const resume = document.querySelector('.fh-btn-primary');
    const dRect = drawer.getBoundingClientRect();
    const rRect = resume.getBoundingClientRect();
    const keyBtns = document.querySelectorAll('.fh-kcap-btn').length;
    return {
      drawerVisible: getComputedStyle(document.querySelector('.fh-drawer-wrap')).display !== 'none',
      drawerInView: dRect.top >= 0 && dRect.bottom <= window.innerHeight + 1 && dRect.left >= 0 && dRect.right <= window.innerWidth + 1,
      resumeInView: rRect.top >= 0 && rRect.bottom <= window.innerHeight + 1,
      keyBtns,
    };
  });
  assert.equal(layoutCheck.drawerVisible, true, 'Drawer should be visible');
  assert.equal(layoutCheck.drawerInView, true, `Drawer clipped out of viewport: ${JSON.stringify(layoutCheck)}`);
  assert.equal(layoutCheck.resumeInView, true, `Resume button clipped out of viewport: ${JSON.stringify(layoutCheck)}`);
  assert.ok(layoutCheck.keyBtns >= 22, `Expected >=22 keybind buttons, got ${layoutCheck.keyBtns}`);
  console.log('1. Drawer & layout fit PASSED:', JSON.stringify(layoutCheck));

  // 2. Test Escape cancels listening without closing the pause drawer
  await page.click('button.fh-kcap-btn[data-action="pass"][data-slot="0"]');
  await sleep(40);
  const listeningText = await page.$eval('.fh-ctrl-status', (el) => el.textContent);
  assert.match(listeningText, /PRESS A KEY/i);
  await page.keyboard.press('Escape');
  await sleep(80);
  const stillPausedAfterEsc = await page.evaluate(() => window.__APP.settings.isPaused());
  const passStillX = await page.evaluate(() => window.__APP.input.getKeybinds().pass[0]);
  assert.equal(stillPausedAfterEsc, true, 'Escape during key capture must cancel capture without closing pause drawer');
  assert.equal(passStillX, 'KeyX', 'Cancelled capture must preserve KeyX');
  console.log('2. Escape cancel capture PASSED');

  // 3. Rebind Pass slot 0 (KeyX -> KeyU) and check HUD hint + status bar update
  await page.click('button.fh-kcap-btn[data-action="pass"][data-slot="0"]');
  await sleep(30);
  await page.keyboard.press('KeyU');
  await sleep(80);
  const afterPassBind = await page.evaluate(() => ({
    pass: window.__APP.input.getKeybinds().pass,
    status: document.querySelector('.fh-ctrl-status')?.textContent,
    ctrlHintKeys: Array.from(document.querySelectorAll('.fh-ctrl-wrap .fh-key')).map((e) => e.textContent),
  }));
  assert.deepEqual(afterPassBind.pass, ['KeyU', 'KeyN', 'KeyJ']);
  assert.match(afterPassBind.status, /BOUND PASS.*→ U/);
  assert.ok(afterPassBind.ctrlHintKeys.includes('U/N/J'), `HUD hint strip did not update: ${JSON.stringify(afterPassBind.ctrlHintKeys)}`);
  console.log('3. Rebind Pass KeyX -> KeyU PASSED:', JSON.stringify(afterPassBind));

  // 4. Test conflict swap: Shield/Finesse (KeyZ, sole key) -> KeyT (Offside Trap, sole key)
  await page.click('button.fh-kcap-btn[data-action="modifier"][data-slot="0"]');
  await sleep(30);
  await page.keyboard.press('KeyT');
  await sleep(80);
  const swapCheck = await page.evaluate(() => ({
    modifier: window.__APP.input.getKeybinds().modifier,
    offsideTrap: window.__APP.input.getKeybinds().offsideTrap,
    status: document.querySelector('.fh-ctrl-status')?.textContent,
  }));
  assert.deepEqual(swapCheck.modifier, ['KeyT']);
  assert.deepEqual(swapCheck.offsideTrap, ['KeyZ']);
  assert.match(swapCheck.status, /SWAPPED WITH OFFSIDE TRAP/);
  console.log('4. Conflict swap PASSED:', JSON.stringify(swapCheck));

  // 5. Test adding & removing an alternate key on Skill: Stepover (KeyE -> add KeyY, then remove KeyY)
  await page.click('button.fh-kcap-add[data-action="skillStepover"]');
  await sleep(30);
  await page.keyboard.press('KeyY');
  await sleep(80);
  const addedAlt = await page.evaluate(() => window.__APP.input.getKeybinds().skillStepover);
  assert.deepEqual(addedAlt, ['KeyE', 'KeyY']);

  await page.click('button.fh-kcap-btn[data-action="skillStepover"][data-slot="1"]');
  await sleep(30);
  await page.click('.fh-ctrl-rm-btn');
  await sleep(50);
  const removedAlt = await page.evaluate(() => window.__APP.input.getKeybinds().skillStepover);
  assert.deepEqual(removedAlt, ['KeyE']);
  console.log('5. Add & remove alternate key PASSED');

  // 6. Test binding KeyP to Skill: Ball Roll while paused (must NOT close pause drawer!)
  await page.click('button.fh-kcap-btn[data-action="skillBallRoll"][data-slot="0"]');
  await sleep(30);
  await page.keyboard.press('KeyP');
  await sleep(180);
  const pauseCheck = await page.evaluate(() => ({
    paused: window.__APP.settings.isPaused(),
    skillBallRoll: window.__APP.input.getKeybinds().skillBallRoll,
    pause: window.__APP.input.getKeybinds().pause,
  }));
  assert.equal(pauseCheck.paused, true, 'Pressing KeyP to rebind must not unpause');
  assert.deepEqual(pauseCheck.skillBallRoll, ['KeyP']);
  assert.deepEqual(pauseCheck.pause, ['KeyF'], 'Pause should have swapped to KeyF');
  console.log('6. Rebind KeyP without closing pause drawer PASSED:', JSON.stringify(pauseCheck));

  // 7. Reload page and verify localStorage persistence
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__SHOT_READY === true', { timeout: 60000 });
  await sleep(150);

  const persisted = await page.evaluate(() => ({
    binds: window.__APP.input.getKeybinds(),
    ctrlHintKeys: Array.from(document.querySelectorAll('.fh-ctrl-wrap .fh-key')).map((e) => e.textContent),
  }));
  assert.deepEqual(persisted.binds.pass, ['KeyU', 'KeyN', 'KeyJ']);
  assert.deepEqual(persisted.binds.modifier, ['KeyT']);
  assert.deepEqual(persisted.binds.offsideTrap, ['KeyZ']);
  assert.deepEqual(persisted.binds.skillBallRoll, ['KeyP']);
  assert.ok(persisted.ctrlHintKeys.includes('U/N/J'));
  console.log('7. localStorage persistence across reload PASSED');

  // 8. Live gameplay input verification: verify rebound KeyU triggers passPressed, old KeyX does NOT
  await page.focus('body');
  const kickEvents = await page.evaluate(async () => {
    const out = { oldKeyPass: false, newKeyPass: false };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    out.oldKeyPass = window.__APP.input.sample().passPressed;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyX', bubbles: true }));

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyU', bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    out.newKeyPass = window.__APP.input.sample().passPressed;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyU', bubbles: true }));
    return out;
  });
  assert.equal(kickEvents.oldKeyPass, false, 'Unbound KeyX must no longer trigger passPressed');
  assert.equal(kickEvents.newKeyPass, true, 'Rebound KeyU must trigger passPressed');
  console.log('8. Live input dispatch verification PASSED:', JSON.stringify(kickEvents));

  // 9. Reset defaults button inside Pause drawer
  await page.click('.fh-pause-btn');
  await page.waitForFunction('window.__APP.settings.isPaused() === true');
  await sleep(60);
  await page.click('.fh-reset-keys-btn');
  await sleep(80);
  const afterReset = await page.evaluate(() => ({
    binds: window.__APP.input.getKeybinds(),
    ctrlHintKeys: Array.from(document.querySelectorAll('.fh-ctrl-wrap .fh-key')).map((e) => e.textContent),
  }));
  assert.deepEqual(afterReset.binds.pass, ['KeyX', 'KeyN', 'KeyJ']);
  assert.deepEqual(afterReset.binds.modifier, ['KeyZ']);
  assert.deepEqual(afterReset.binds.offsideTrap, ['KeyT']);
  assert.deepEqual(afterReset.binds.pause, ['KeyP']);
  assert.ok(afterReset.ctrlHintKeys.includes('X/N/J'));
  console.log('9. Reset defaults PASSED');

  assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join('; ')}`);
  assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join('; ')}`);
  console.log('ALL KEYBIND TESTS PASSED');
} finally {
  await browser.close();
  server.close();
}
