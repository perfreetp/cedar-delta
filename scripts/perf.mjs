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
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.three-canvas');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const result = await page.evaluate(async () => {
    const editor = window.__FLORAL_EDITOR__;
    const template = JSON.parse(JSON.stringify(editor.doc.instances[0]));
    let n = 0;
    while (editor.doc.instances.length < 3000) {
      const copy = JSON.parse(JSON.stringify(template));
      n += 1;
      copy.id = `perf_${n}`;
      copy.groupId = null;
      const ring = 0.35 + Math.sqrt(n / 3000) * 3.9;
      const angle = n * 2.399963;
      copy.position = [Math.cos(angle) * ring, 0, Math.sin(angle) * ring];
      editor.doc.instances.push(copy);
    }

    const rebuildStart = performance.now();
    editor.scene.rebuild();
    editor.emit();
    const rebuildMs = performance.now() - rebuildStart;

    await new Promise((resolve) => setTimeout(resolve, 500));
    const frames = await new Promise((resolve) => {
      let count = 0;
      const start = performance.now();
      function tick() {
        count += 1;
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
        else resolve(count / 2);
      }
      requestAnimationFrame(tick);
    });

    editor.select(editor.doc.instances.map((item) => item.id));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const selectedFrames = await new Promise((resolve) => {
      let count = 0;
      const start = performance.now();
      function tick() {
        count += 1;
        if (performance.now() - start < 1500) requestAnimationFrame(tick);
        else resolve(count / 1.5);
      }
      requestAnimationFrame(tick);
    });

    return {
      count: editor.doc.instances.length,
      rebuildMs: Math.round(rebuildMs),
      idleFps: Math.round(frames),
      selectedFps: Math.round(selectedFrames),
      drawCalls: editor.scene.renderer.info.render.calls,
      triangles: editor.scene.renderer.info.render.triangles,
      selection: editor.selection.size,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('PERF_OK');
  }
} finally {
  await browser.close();
}
