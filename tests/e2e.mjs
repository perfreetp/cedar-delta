/**
 * 端到端运行时验证：用系统 Chrome（SwiftShader WebGL）驱动真实页面，
 * 捕获 GLSL 编译错误、渲染异常，并对拾取/剖切/框选/撤销做行为断言。
 *
 * 运行：node tests/e2e.mjs
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5199/';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('guide-planner canvas', { timeout: 10000 });
  await page.waitForTimeout(1500);

  // 1. 场景初始化
  const init = await page.evaluate(() => {
    const el = document.querySelector('guide-planner');
    const v = el.api;
    const canvas = el.shadowRoot.querySelector('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return {
      hasViewer: !!v,
      sleeveCount: v?.sleeveCount ?? 0,
      canvasW: canvas?.width ?? 0,
      glOk: !!gl,
    };
  });
  check('Viewer 初始化且 14 颗套管就位', init.hasViewer && init.sleeveCount === 14, `count=${init.sleeveCount}`);
  check('WebGL 上下文已建立', init.glOk, `canvas=${init.canvasW}px`);

  // 2. 点选第一颗套管（颜色拾取，含稳定 ID）
  const pos1 = await page.evaluate(() => document.querySelector('guide-planner').api.sleeveScreenPosition(1));
  check('套管可投影到屏幕', !!pos1 && pos1.x > 0 && pos1.y > 0, JSON.stringify(pos1));

  const canvasBox = await page.locator('guide-planner canvas').boundingBox();
  await page.mouse.click(canvasBox.x + pos1.x, canvasBox.y + pos1.y);
  await page.waitForTimeout(400);
  const sel1 = await page.evaluate(() => [...document.querySelector('guide-planner').api.selectedIds]);
  check('点选命中套管（拾取通道返回稳定 ID）', sel1.includes(1), `selected=${JSON.stringify(sel1)}`);

  // 3. 框选多颗
  await page.mouse.move(canvasBox.x + 60, canvasBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 1340, canvasBox.y + 750, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const sel2 = await page.evaluate(() => [...document.querySelector('guide-planner').api.selectedIds]);
  check('框选一次选中多颗套管', sel2.length >= 3, `count=${sel2.length}`);

  // 4. 开启剖切后，被切掉的套管在拾取通道中消失（不错层验证）
  await page.evaluate(() => {
    const btn = document.querySelector('guide-planner').shadowRoot.querySelector('[data-act="clip-toggle"]');
    btn.click();
  });
  await page.waitForTimeout(300);
  // 矢状面（法向 X）置于 distance=0，必然切掉 x>0 的约一半套管
  await page.evaluate(() => {
    const v = document.querySelector('guide-planner').api;
    v.setClipPreset('sagittal');
    v.setClipDistance(0);
  });
  await page.waitForTimeout(400);
  const clipStats = await page.evaluate(async () => {
    const el = document.querySelector('guide-planner');
    const v = el.api;
    // 直接调用内部拾取器对全屏查询，统计剖切后仍可拾取的数量
    const ids = await v['picker'].query(v['cameraEntity'].camera, { x: 0, y: 0, w: 1400, h: 900 });
    return { pickable: ids.length, total: v.sleeveCount, clipEnabled: v['clip'].enabled, distance: v['clip'].distance };
  });
  check('剖切生效且拾取通道同步裁剪（不错层）',
    clipStats.clipEnabled && clipStats.pickable > 0 && clipStats.pickable < clipStats.total,
    `pickable=${clipStats.pickable}/${clipStats.total} @d=${clipStats.distance}`);

  // 5. 撤销：先制造一次带历史的微调，再撤销还原
  await page.evaluate(() => document.querySelector('guide-planner').api.nudgeClip(2));
  const beforeUndo = await page.evaluate(() => document.querySelector('guide-planner').api['clip'].distance);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const afterUndo = await page.evaluate(() => {
    const c = document.querySelector('guide-planner').api['clip'];
    return { distance: c.distance, enabled: c.enabled };
  });
  check('撤销还原剖切位置', Math.abs(afterUndo.distance - (beforeUndo - 2)) < 0.01,
    `${beforeUndo} -> ${afterUndo.distance}`);

  // 6. 控制台无 GL/运行时错误
  check('无未捕获页面异常', pageErrors.length === 0, pageErrors[0] ?? '');
  const glErrors = consoleErrors.filter((e) =>
    /shader|GL_|WebGL|ERROR|undefined is not|cannot read/i.test(e));
  check('控制台无着色器/WebGL 错误', glErrors.length === 0, glErrors.slice(0, 2).join(' | '));

  await page.screenshot({ path: 'tests/e2e-screenshot.png' });
} catch (err) {
  check('测试执行异常', false, String(err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log('\n失败项：');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  process.exit(1);
}
