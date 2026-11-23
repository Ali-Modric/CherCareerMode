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
  if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text());
});
page.on('pageerror', (err) => {
  errors.push('PAGE ERROR: ' + err.message);
});

try {
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));

  await page.click('[data-testid="btn-new-career"]');
  await new Promise((r) => setTimeout(r, 400));

  console.log('Testing Name input...');
  const nameEl = await page.$('[data-testid="input-pro-name"]');
  await nameEl.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Marcus Rashford');

  const typedName = await page.$eval('[data-testid="input-pro-name"]', (el) => el.value);
  console.log('Typed Name:', typedName);

  console.log('Testing Number input...');
  const numEl = await page.$('[data-testid="input-pro-number"]');
  await numEl.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('10');

  const typedNum = await page.$eval('[data-testid="input-pro-number"]', (el) => el.value);
  console.log('Typed Number:', typedNum);

  // Now click a position or tier to see what happens to the values!
  console.log('Clicking position LW...');
  await page.click('[data-testid="pos-LW"]');
  await new Promise((r) => setTimeout(r, 200));

  const afterPosName = await page.$eval('[data-testid="input-pro-name"]', (el) => el.value);
  const afterPosNum = await page.$eval('[data-testid="input-pro-number"]', (el) => el.value);
  console.log('After position change - Name:', afterPosName, 'Number:', afterPosNum);

  // Now click Start Career
  console.log('Clicking Start Player Career...');
  await page.click('[data-testid="btn-confirm-create"]');
  await new Promise((r) => setTimeout(r, 600));

  const proNameInHub = await page.$eval('.fc-pro-pill, .fc-title, h3', (el) => el.textContent).catch(() => 'not found');
  console.log('In Hub text:', proNameInHub);

  // Check career in localStorage
  const storedCareer = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('fifacher_career_v1') || '{}');
  });
  console.log('Stored Career Pro:', storedCareer.pro?.name, 'Number:', storedCareer.pro?.number);

  console.log('Errors:', errors);
} catch (e) {
  console.error('Test failed:', e);
} finally {
  await browser.close();
}
