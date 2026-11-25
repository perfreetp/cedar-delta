import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.env.URL ?? 'http://127.0.0.1:4173/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1680,1050',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1050, deviceScaleFactor: 1 });
const messages = [];
page.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => messages.push(`PAGEERROR: ${err.stack ?? err.message}`));

try {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.__eyeLab), { timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const canvasRect = await page.evaluate(() => {
    const canvas = window.__eyeLab.canvas;
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  console.log('canvas rect', canvasRect);

  async function clickWorld(point) {
    const screen = await page.evaluate((p) => window.__eyeLab.project(p), point);
    if (!screen.visible) throw new Error(`point not visible ${JSON.stringify(point)} -> ${JSON.stringify(screen)}`);
    await page.mouse.click(canvasRect.left + screen.x, canvasRect.top + screen.y);
    await new Promise((r) => setTimeout(r, 120));
  }

  // ACD: corneal posterior pole to lens anterior pole.
  await page.evaluate(() => window.__eyeLab.setTool('acd'));
  await clickWorld([0, 0, 13.96]);
  await clickWorld([0, 0, 10.1]);

  // Lens thickness.
  await page.evaluate(() => window.__eyeLab.setTool('lensThickness'));
  await clickWorld([0, 0, 10.1]);
  await clickWorld([0, 0, 6.0]);

  // Curvature: three points on the procedural corneal sphere's central section.
  await page.evaluate(() => window.__eyeLab.setTool('curvature'));
  await clickWorld([0, 0, 14.44]);
  await clickWorld([0, 4.0, 13.34]);
  await clickWorld([0, -4.0, 13.34]);
  await new Promise((r) => setTimeout(r, 500));

  const stateSummary = await page.evaluate(() => {
    const lab = window.__eyeLab;
    return {
      measurements: lab.state.measurements.map((m) => ({
        kind: m.kind,
        points: m.points.length,
        done: m.done,
        value: m.value,
        radius: m.radius,
        hasAnchor: m.points.some((p) => p.anchor),
      })),
      canUndo: lab.history.canUndo,
      micro: lab.state.microVisible,
      clip: { ...lab.state.clip },
      lens: { ...lab.state.lens },
    };
  });
  console.log('state summary', JSON.stringify(stateSummary, null, 2));
  await page.screenshot({ path: 'artifacts-check-measurements.png' });

  // Drag the first curvature point through the overlay pointer handle.
  const handle = await page.evaluateHandle(() => {
    const root = document.querySelector('eye-workbench').shadowRoot;
    return root.querySelector('.measurement--curvature .point-hit');
  });
  const box = await handle.asElement().boundingBox();
  if (!box) throw new Error('curvature drag handle has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 18, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));

  const afterDrag = await page.evaluate(() => {
    const m = window.__eyeLab.state.measurements.find((x) => x.kind === 'curvature');
    return { radius: m.radius, points: m.points.map((p) => p.p), canUndo: window.__eyeLab.history.canUndo };
  });
  console.log('after curvature drag', JSON.stringify(afterDrag, null, 2));

  // Undo/redo several times and ensure counts/clip stay coherent.
  const historyCheck = await page.evaluate(() => {
    const lab = window.__eyeLab;
    const count = lab.state.measurements.length;
    lab.undo();
    const afterUndoCount = lab.state.measurements.length;
    lab.redo();
    const afterRedoCount = lab.state.measurements.length;
    lab.setMicroVisible(false);
    const microMeshPickable = lab.model.micro.isPickable;
    const microEnabled = lab.model.micro.isEnabled();
    lab.setMicroVisible(true);
    return { count, afterUndoCount, afterRedoCount, microMeshPickable, microEnabled };
  });
  console.log('history check', JSON.stringify(historyCheck, null, 2));

  // Clip plane offset + yaw math/state update path.
  const clipCheck = await page.evaluate(() => {
    const lab = window.__eyeLab;
    lab.setTool('clip');
    const before = lab.state.clip.offset;
    lab.state.clip.offset = 4.6;
    lab.updateClipRig();
    lab.updateSection();
    const afterOffset = lab.state.clip.offset;
    lab.state.clip.yaw = Math.PI / 2 + (20 * Math.PI) / 180;
    // Emulate clamp used by drag handler formula.
    const max = (14 * Math.PI) / 180;
    lab.state.clip.yaw = Math.PI / 2 + Math.max(-max, Math.min(max, lab.state.clip.yaw - Math.PI / 2));
    lab.updateClipRig();
    lab.updateSection();
    return { before, afterOffset, yawDeg: (lab.state.clip.yaw - Math.PI / 2) * 180 / Math.PI };
  });
  console.log('clip check', JSON.stringify(clipCheck, null, 2));

  await page.evaluate(() => window.__eyeLab.select('cornea'));
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: 'artifacts-check-cornea.png' });

  const errors = messages.filter((m) => m.includes('PAGEERROR') || m.startsWith('error:'));
  console.log('console messages:', messages.slice(-20).join('\n'));
  if (errors.length) {
    console.error('ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
