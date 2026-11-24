import puppeteer from 'puppeteer-core';

const url = process.env.SMOKE_URL || 'http://127.0.0.1:4174/';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1600,1000',
  ],
});

const page = await browser.newPage();
const messages = [];
page.on('console', (msg) => {
  const line = `[console.${msg.type()}] ${msg.text()}`;
  messages.push(line);
  if (msg.type() === 'error') console.error(line);
});
page.on('pageerror', (error) => {
  const line = `[pageerror] ${error.stack || error.message}`;
  messages.push(line);
  console.error(line);
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.three-canvas', { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const initialCount = await page.$eval('.left-panel .panel-heading .badge', (el) => el.textContent.trim());
  console.log('initial count:', initialCount);

  await page.click('.flower-card');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterAdd = await page.$eval('.left-panel .panel-heading .badge', (el) => el.textContent.trim());
  const selectedAfterAdd = await page.$eval('.selection-summary .badge', (el) => el.textContent.trim());
  console.log('after add:', afterAdd, selectedAfterAdd);
  if (!afterAdd.startsWith('17/')) throw new Error(`Add failed, badge=${afterAdd}`);
  if (!selectedAfterAdd.includes('1')) throw new Error(`New instance not selected: ${selectedAfterAdd}`);
  await page.screenshot({ path: 'screenshots/smoke-added.png' });

  await page.keyboard.press('Escape');
  await new Promise((resolve) => setTimeout(resolve, 200));

  const viewport = await page.$eval('.viewport', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const cx = viewport.x + viewport.width / 2;
  const cy = viewport.y + viewport.height * 0.48;
  await page.mouse.move(cx - 180, cy - 130);
  await page.mouse.down({ button: 'left' });
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx - 180 + (360 * i) / 12, cy - 130 + (260 * i) / 12, { steps: 2 });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await page.mouse.up({ button: 'left' });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const marqueeSelection = await page.$eval('.selection-summary .badge', (el) => el.textContent.trim());
  console.log('marquee selection:', marqueeSelection);
  await page.screenshot({ path: 'screenshots/smoke-marquee.png' });
  const selectedMatch = marqueeSelection.match(/(\d+)\s*选中/);
  const selectedCount = selectedMatch ? Number(selectedMatch[1]) : 0;
  if (selectedCount < 3) throw new Error(`Marquee selected too few: ${marqueeSelection}`);

  const groupButtons = await page.$$('button');
  for (const button of groupButtons) {
    const text = await button.evaluate((el) => el.textContent.trim());
    if (text === '成组') {
      await button.click();
      break;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const groupNameVisible = await page.$('.group-name-input');
  console.log('group input visible:', Boolean(groupNameVisible));
  if (!groupNameVisible) throw new Error('Group operation did not show group name input');

  const countBeforeArray = Number((await page.$eval('.left-panel .panel-heading .badge', (el) => el.textContent)).split('/')[0]);
  await page.click('button.array-button');
  await new Promise((resolve) => setTimeout(resolve, 900));
  const countAfterArray = Number((await page.$eval('.left-panel .panel-heading .badge', (el) => el.textContent)).split('/')[0]);
  console.log('array counts:', countBeforeArray, countAfterArray);
  if (countAfterArray !== countBeforeArray + selectedCount * 7) {
    throw new Error(`Unexpected array count: ${countAfterArray}, expected ${countBeforeArray + selectedCount * 7}`);
  }
  await page.screenshot({ path: 'screenshots/smoke-array.png' });

  await page.click('button[title^="撤销"]');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterUndo = Number((await page.$eval('.left-panel .panel-heading .badge', (el) => el.textContent)).split('/')[0]);
  console.log('after undo:', afterUndo);
  if (afterUndo !== countBeforeArray) throw new Error(`Undo failed: ${afterUndo} != ${countBeforeArray}`);

  await page.click('button[title^="重做"]');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterRedo = Number((await page.$eval('.left-panel .panel-heading .badge', (el) => el.textContent)).split('/')[0]);
  console.log('after redo:', afterRedo);
  if (afterRedo !== countAfterArray) throw new Error(`Redo failed: ${afterRedo} != ${countAfterArray}`);
  await page.click('button[title^="撤销"]');
  await new Promise((resolve) => setTimeout(resolve, 400));

  for (const label of ['俯视', '侧视', '自由视角']) {
    await page.evaluate((wanted) => {
      const button = [...document.querySelectorAll('.view-button')].find((el) => el.textContent.trim() === wanted);
      button?.click();
    }, label);
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  await page.screenshot({ path: 'screenshots/smoke-free-view.png' });

  const storage = await page.evaluate(() => localStorage.getItem('banquet-floral-editor:document:v1'));
  if (!storage || !storage.includes('instances')) throw new Error('Document was not persisted to localStorage');
  console.log('localStorage bytes:', storage.length);

  const dragResult = await page.evaluate(() => {
    const editor = window.__FLORAL_EDITOR__;
    editor.resetSample();
    const id = editor.doc.instances[0].id;
    editor.select([id]);
    editor.setTransformMode('translate');
    const scene = editor.scene;
    scene.beginInteraction();
    scene.pivot.position.x = 3.2;
    scene.pivot.position.z = 0.4;
    scene.handleObjectChange();
    const position = [...editor.getInstance(id).position];
    const tooltipDisplay = scene.tooltipElement.style.display;
    const tooltipText = scene.tooltipElement.textContent;
    const blocked = tooltipText.includes('花球');
    scene.endInteraction();
    return {
      position,
      tooltipDisplay,
      tooltipText,
      blocked,
      historyLabel: editor.past.at(-1)?.label,
      rotationSnap: scene.transformControls.rotationSnap,
    };
  });
  console.log('drag result:', JSON.stringify(dragResult));
  if (dragResult.tooltipDisplay !== 'block') throw new Error('Drag tooltip was not shown');
  if (dragResult.historyLabel !== '移动') throw new Error(`Unexpected drag history: ${dragResult.historyLabel}`);
  if (Math.abs(dragResult.rotationSnap - Math.PI / 12) > 0.0001) throw new Error('Rotation snap is not 15 degrees');
  if (Math.hypot(dragResult.position[0], dragResult.position[2]) < 0.5) throw new Error('Drag transform was not baked');

  const downloadName = await page.evaluate(() => {
    let captured = null;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedClick() {
      captured = this.download;
    };
    window.__FLORAL_EDITOR__.exportJson();
    HTMLAnchorElement.prototype.click = originalClick;
    return captured;
  });
  console.log('export file:', downloadName);
  if (!downloadName || !downloadName.endsWith('.json')) throw new Error('Export did not produce a JSON download filename');

  const errors = messages.filter((line) => line.startsWith('[pageerror]') || line.includes('[console.error]'));
  const serious = errors.filter((line) => !line.includes('THREE.WebGLRenderer: Context Lost') && !line.includes('GPU stall'));
  if (serious.length) throw new Error(`Browser errors:\n${serious.join('\n')}`);

  console.log('SMOKE_OK');
} finally {
  await browser.close();
}
