import { serve, launch, shotPath } from './harness.mjs';
const server = serve();
const { browser, page, errors } = await launch({ width: 1920, height: 1080 });

const focus = async (vi, x, y, z) => {
  await page.evaluate(({ vi, x, y, z }) => {
    const id = vi === 0 ? 'overview' : 'floor';
    window.__evacMaps()[id].focusWorld(x, y, z);
  }, { vi, x, y, z });
  await page.waitForTimeout(900);
};
const A = await page.evaluate(() => {
  const f = window.__evacStore.ds.floors[0];
  return { x: f.centerX, y: f.centerY };
});

await page.screenshot({ path: shotPath('g1-overview') });
await focus(1, 12000, 12000, 0.075);
await page.screenshot({ path: shotPath('g2-campus') });
await focus(1, A.x, A.y, 0.5);
await page.screenshot({ path: shotPath('g3-floor') });
await focus(1, A.x, A.y, 1.4);
await page.screenshot({ path: shotPath('g4-rooms') });

// 关掉面层
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.layer-row')].find((r) => r.querySelector('.layer-row__name')?.textContent?.trim() === '区域面');
  row.querySelector('input[type=checkbox]').click();
});
await page.waitForTimeout(800);
await page.screenshot({ path: shotPath('g5-no-area') });
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.layer-row')].find((r) => r.querySelector('.layer-row__name')?.textContent?.trim() === '区域面');
  row.querySelector('input[type=checkbox]').click();
});
await page.waitForTimeout(800);

// 旋转
const box = await page.evaluate(() => {
  const r = document.querySelectorAll('.map-view__canvas')[1].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(box.x + 240, box.y);
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 16; i++) {
  const a = (38 * Math.PI / 180) * (i / 16);
  await page.mouse.move(box.x + Math.cos(a) * 240, box.y + Math.sin(a) * 240);
}
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(900);
await page.screenshot({ path: shotPath('g6-rotated') });

// 档位面板
await page.evaluate(() => [...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('缩放档位'))?.click());
await page.waitForTimeout(500);
await page.screenshot({ path: shotPath('g7-tiers'), clip: { x: 0, y: 0, width: 340, height: 1080 } });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
