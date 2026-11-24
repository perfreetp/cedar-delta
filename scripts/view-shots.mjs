import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  defaultViewport: { width: 1400, height: 1000 },
  args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.three-canvas');
await new Promise((r) => setTimeout(r, 1800));
for (const view of ['俯视', '侧视']) {
  await page.evaluate((label) => [...document.querySelectorAll('.view-button')].find((b) => b.textContent.trim() === label)?.click(), view);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `screenshots/view-${view}.png` });
}
await browser.close();
console.log('VIEW_SHOTS_OK');
