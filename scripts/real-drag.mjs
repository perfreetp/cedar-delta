import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  defaultViewport: { width: 1600, height: 1000 },
  args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.three-canvas');
  await new Promise((r) => setTimeout(r, 1800));

  const center = await page.evaluate(() => {
    const ed = window.__FLORAL_EDITOR__;
    ed.select([ed.doc.instances[1].id]);
    ed.setTransformMode('translate');
    const scene = ed.scene;
    const rect = scene.renderer.domElement.getBoundingClientRect();
    const projected = scene.pivot.position.clone().project(scene.camera);
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
      id: ed.doc.instances[1].id,
      before: ed.doc.instances[1].position.slice(),
    };
  });
  console.log('pivot screen', center);

  let handle = null;
  for (let radius = 28; radius <= 95 && !handle; radius += 9) {
    for (let angle = -0.9; angle <= 0.9; angle += 0.18) {
      const x = center.x + Math.cos(angle) * radius;
      const y = center.y + Math.sin(angle) * radius * 0.55 + radius * 0.18;
      await page.mouse.move(x, y);
      await new Promise((r) => setTimeout(r, 25));
      const axis = await page.evaluate(() => window.__FLORAL_EDITOR__.scene.transformControls.axis);
      if (axis === 'X') {
        handle = { x, y, axis };
        break;
      }
    }
  }
  console.log('handle', handle);
  if (!handle) throw new Error('Could not find X transform handle');

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 80));
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(handle.x + i * 12, handle.y + i * 2, { steps: 2 });
    await new Promise((r) => setTimeout(r, 20));
  }
  const during = await page.evaluate(() => ({
    tooltip: window.__FLORAL_EDITOR__.scene.tooltipElement.style.display,
    text: window.__FLORAL_EDITOR__.scene.tooltipElement.textContent,
    pos: window.__FLORAL_EDITOR__.doc.instances[1].position.slice(),
  }));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => ({
    pos: window.__FLORAL_EDITOR__.doc.instances[1].position.slice(),
    label: window.__FLORAL_EDITOR__.past.at(-1)?.label,
    count: window.__FLORAL_EDITOR__.past.length,
  }));
  console.log('during', during);
  console.log('after', after);
  if (during.tooltip !== 'block') throw new Error('Real gizmo drag did not show tooltip');
  if (Math.abs(after.pos[0] - center.before[0]) < 0.25) throw new Error('Real gizmo drag did not move instance');
  if (after.label !== '移动') throw new Error(`Wrong history label ${after.label}`);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('REAL_DRAG_OK');
} finally {
  await browser.close();
}
