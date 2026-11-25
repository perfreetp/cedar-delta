/** 多时间点截图，验证陨石坑生长/喷出物/相机随时间轴变化 */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto('http://127.0.0.1:5190/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const snapshots = [];
for (const t of [0, 3, 6, 10, 15]) {
  await page.evaluate((time) => window.__playback.scrub(time), t);
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => {
    const ev = window.__evaluate(window.__store.doc, window.__store.currentTime);
    const crater = ev.samples.find((x) => x.kind === 'crater' && x.active)?.crater;
    const ejecta = ev.samples.find((x) => x.kind === 'ejecta' && x.active)?.ejecta;
    const cam = window.__scene.camera;
    return {
      time: window.__store.currentTime,
      craterR: crater?.radius,
      craterD: crater?.depth,
      ejectaSpread: ejecta?.spread,
      ejectaProgress: ejecta?.progress,
      camR: cam.radius,
      camAlpha: cam.alpha,
    };
  });
  snapshots.push(s);
  await page.screenshot({ path: `tests/e2e/frame-t${t}.png` });
}
console.table(snapshots);
await browser.close();
