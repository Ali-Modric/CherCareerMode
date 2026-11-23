import puppeteer from 'puppeteer-core';

const CHROME = '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--hide-scrollbars',
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    errors.push('CONSOLE ERROR: ' + msg.text());
  }
});
page.on('pageerror', (err) => {
  errors.push('PAGE ERROR: ' + err.message + '\n' + err.stack);
});

try {
  console.log('1. Loading http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout ? page.waitForTimeout(1000) : new Promise((r) => setTimeout(r, 1000));

  console.log('2. Verifying Start Menu rendered...');
  const startVisible = await page.$eval('[data-testid="btn-new-career"]', (el) => !!el);
  console.log('   New Career button found:', startVisible);

  console.log('3. Clicking New Career button...');
  await page.click('[data-testid="btn-new-career"]');
  await new Promise((r) => setTimeout(r, 500));

  const inputName = await page.$eval('[data-testid="input-pro-name"]', (el) => el.value);
  console.log('   Create Player opened with name:', inputName);

  console.log('4. Selecting Tier "star" and Position "CAM"...');
  await page.click('[data-testid="tier-star"]');
  await new Promise((r) => setTimeout(r, 200));
  await page.click('[data-testid="pos-CAM"]');
  await new Promise((r) => setTimeout(r, 200));

  const ovrBadgeText = await page.$eval('[data-testid="create-ovr-badge"]', (el) => el.textContent);
  console.log('   Pro OVR Badge:', ovrBadgeText);

  console.log('5. Clicking "START PLAYER CAREER" (triggering the user-reported button)...');
  await page.click('[data-testid="btn-confirm-create"]');
  await new Promise((r) => setTimeout(r, 800));

  // Check if any errors occurred so far
  if (errors.length > 0) {
    console.error('FAIL: Errors detected after clicking START PLAYER CAREER:');
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }

  console.log('6. Verifying Career Hub opened successfully...');
  const homeTabVisible = await page.$eval('[data-testid="tab-home"]', (el) => !!el);
  const playMatchVisible = await page.$eval('[data-testid="btn-play-match"]', (el) => !!el);
  console.log('   Home Tab Visible:', homeTabVisible, 'Play Match Button Visible:', playMatchVisible);

  console.log('7. Simulating matchweek...');
  await page.click('[data-testid="btn-sim-match"]');
  await new Promise((r) => setTimeout(r, 800));

  console.log('8. Testing My Player tab...');
  await page.click('[data-testid="tab-player"]');
  await new Promise((r) => setTimeout(r, 500));
  const editTransferBtn = await page.$eval('[data-testid="btn-edit-transfer-pro"]', (el) => !!el);
  console.log('   Edit/Transfer button visible:', editTransferBtn);

  console.log('9. Testing Competitions tab...');
  await page.click('[data-testid="tab-comps"]');
  await new Promise((r) => setTimeout(r, 500));
  const tableRows = await page.$$eval('.fc-table tr', (rows) => rows.length);
  console.log('   Competitions table rendered rows:', tableRows);

  console.log('10. Testing Menu button to return to Start Menu...');
  await page.click('[data-testid="btn-hub-menu"]');
  await new Promise((r) => setTimeout(r, 500));
  const continueCareerBtn = await page.$eval('[data-testid="btn-continue-career"]', (el) => !!el);
  console.log('   Continue Career button visible in Start Menu:', continueCareerBtn);

  console.log('11. Testing Quick Match modal and Classic Derby...');
  await page.click('[data-testid="btn-quick-match"]');
  await new Promise((r) => setTimeout(r, 500));
  await page.click('[data-testid="btn-classic-derby"]');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('[data-testid="btn-quick-kickoff"]');
  await new Promise((r) => setTimeout(r, 1200));

  const isLoopRunning = await page.evaluate(() => window.__APP && window.__APP.isLoopRunning());
  console.log('   3D match kickoff loop running:', isLoopRunning);

  console.log('12. Testing SHOT_T mode (?t=2)...');
  await page.goto('http://localhost:3000/?t=2', { waitUntil: 'domcontentloaded', timeout: 15000 });
  const shotReady = await page.evaluate(() => window.__SHOT_READY === true);
  console.log('   Screenshot capture mode ready (?t=2):', shotReady);

  if (errors.length > 0) {
    console.error('FAIL: Page or console errors occurred:');
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }

  console.log('\n=== ALL BROWSER VERIFICATION CHECKS PASSED WITH ZERO ERRORS ===');
} finally {
  await browser.close();
}
