import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1680,1050'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1050 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  await page.goto(process.env.URL ?? 'http://127.0.0.1:4174/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => Boolean(window.__eyeLab));
  await new Promise((r) => setTimeout(r, 1500));

  const snap = await page.evaluate(() => {
    const lab = window.__eyeLab;
    lab.select('lens');
    lab.model.lens.position.set(0, 0, 10.75);
    lab.applyLensCorneaSnap();
    lab.syncLensFromMesh();
    return { position: lab.model.lens.position.asArray(), snapped: lab.state.lens.snappedToCornea };
  });
  console.log('lens snap', JSON.stringify(snap));
  if (!snap.snapped || Math.abs(snap.position[2] - 11.91) > 0.08) throw new Error('lens snap position incorrect');

  const rect = await page.evaluate(() => {
    const r = window.__eyeLab.canvas.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });

  await page.evaluate(() => window.__eyeLab.setTool('clip'));
  await new Promise((r) => setTimeout(r, 200));
  const handle = await page.evaluate(() => {
    const p = window.__eyeLab.project(window.__eyeLab.clipOffsetHandle.position.asArray());
    return p;
  });
  console.log('offset handle projected', handle);
  await page.mouse.move(rect.left + handle.x, rect.top + handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(rect.left + handle.x - i * 12, rect.top + handle.y + i * 2, { steps: 2 });
    await new Promise((r) => setTimeout(r, 20));
  }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 200));
  const clipDrag = await page.evaluate(() => ({ offset: window.__eyeLab.state.clip.offset, canUndo: window.__eyeLab.history.canUndo }));
  console.log('clip drag', JSON.stringify(clipDrag));
  if (!clipDrag.canUndo || Math.abs(clipDrag.offset) < 0.2) throw new Error('clip drag did not commit');

  const undoClip = await page.evaluate(() => {
    window.__eyeLab.undo();
    return window.__eyeLab.state.clip.offset;
  });
  console.log('undo clip offset', undoClip);
  if (Math.abs(undoClip) > 0.001) throw new Error('clip undo did not restore offset');

  console.log(errors.length ? `ERRORS\n${errors.join('\n')}` : 'interaction checks passed');
  if (errors.some((e) => e.includes('PAGEERROR') || e.includes('Uncaught'))) process.exitCode = 1;
} finally {
  await browser.close();
}
