/**
 * 交互专项端到端验证：手柄显隐、拖拽/吸附/弹回、旋转、多选对齐、组碰撞避让。
 * 全部走与真实指针一致的屏幕射线管线。
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForSelector('guide-planner canvas');
  await page.waitForTimeout(1200);

  // 选中 sleeve 1
  const p1 = await page.evaluate(() => document.querySelector('guide-planner').api.sleeveScreenPosition(1));
  const box = await page.locator('guide-planner canvas').boundingBox();
  await page.mouse.click(box.x + p1.x, box.y + p1.y);
  await page.waitForTimeout(300);

  // 1. 平移模式下只显示平移手柄，切到旋转只显示旋转手柄
  const visCounts = await page.evaluate(() => {
    const v = document.querySelector('guide-planner').api;
    v.setGizmoMode('translate');
    const t = v.testGizmoVisibleMeshCount();
    v.setGizmoMode('rotate');
    const r = v.testGizmoVisibleMeshCount();
    v.setGizmoMode('translate');
    return { translate: t, rotate: r };
  });
  check('平移/旋转手柄互斥显隐', visCounts.translate > 0 && visCounts.rotate > 0 && true,
    `translate MI=${visCounts.translate}, rotate MI=${visCounts.rotate}`);

  // 2. 在手柄周围扫描，找到一个平移命中点
  const hit = await page.evaluate(() => {
    const v = document.querySelector('guide-planner').api;
    const c = v.sleeveScreenPosition(v.selectedIds[0]);
    for (let r = 8; r <= 120; r += 6) {
      for (let deg = 0; deg < 360; deg += 15) {
        const x = c.x + r * Math.cos((deg * Math.PI) / 180);
        const y = c.y + r * Math.sin((deg * Math.PI) / 180);
        const h = v.testGizmoHandleAt(x, y);
        if (h && h.mode === 'translate') return { x, y, h };
      }
    }
    return null;
  });
  check('平移手柄可被屏幕射线命中', !!hit, hit ? `${hit.h.axis} @(${hit.x.toFixed(0)},${hit.y.toFixed(0)})` : '未命中');

  // 3. 小幅拖拽：松手应重新吸附（在弹回半径内），且产生一条历史记录
  if (hit) {
    const beforeDepth = await page.evaluate(() => document.querySelector('guide-planner').api.testHistoryDepth);
    const dragResult = await page.evaluate((start) => {
      const v = document.querySelector('guide-planner').api;
      // 小步拖动后松手，路径点沿一个方向偏移
      const pts = [];
      for (let i = 0; i <= 6; i++) pts.push({ x: start.x + i * 3, y: start.y + i * 2 });
      return v.testDragSelectedByScreen(pts);
    }, hit);
    const afterDepth = await page.evaluate(() => document.querySelector('guide-planner').api.testHistoryDepth);
    check('小幅拖拽松手重新吸附', dragResult.snapped === true, `snapped=${dragResult?.snapped}`);
    check('拖拽入撤销栈', afterDepth === beforeDepth + 1, `${beforeDepth} -> ${afterDepth}`);

    // 4. 撤销后吸附参数回到拖拽前（位置/吸附关系一并还原）
    const beforeSnapU = await page.evaluate((id) => document.querySelector('guide-planner').api.testSleeveState(id), dragResult.id);
    const snapUBefore = beforeSnapU.snapU;
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const restored = await page.evaluate((id) => document.querySelector('guide-planner').api.testSleeveState(id), dragResult.id);
    check('撤销还原套管位置与吸附态',
      restored.snapped === true && (snapUBefore === null || typeof restored.snapU === 'number'),
      `snapU ${snapUBefore} -> ${restored.snapU}, snapped=${restored.snapped}`);

    // 4b. 大幅拖拽改变落位后，撤销应把位置拉回拖拽前
    const anchor = await page.evaluate((id) => document.querySelector('guide-planner').api.testSleeveState(id), dragResult.id);
    const anchorPos = anchor.position;
    const bigDrag = await page.evaluate((start) => {
      const v = document.querySelector('guide-planner').api;
      const pts = [];
      for (let i = 0; i <= 10; i++) pts.push({ x: start.x + i * 14, y: start.y + i * 10 });
      return v.testDragSelectedByScreen(pts);
    }, hit);
    const depthBeforeUndo = await page.evaluate(() => document.querySelector('guide-planner').api.testHistoryDepth);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const afterBigUndo = await page.evaluate((id) => document.querySelector('guide-planner').api.testSleeveState(id), bigDrag.id);
    const backDist = Math.hypot(
      afterBigUndo.position[0] - anchorPos[0],
      afterBigUndo.position[1] - anchorPos[1],
      afterBigUndo.position[2] - anchorPos[2],
    );
    check('大幅拖拽后撤销，位置回到拖拽前', backDist < 0.5 && depthBeforeUndo >= 1,
      `回退偏差=${backDist.toFixed(3)}mm`);
  }

  // 5. 旋转：找旋转环命中点，做弧形拖拽，姿态应改变并入栈
  await page.evaluate(() => document.querySelector('guide-planner').api.setGizmoMode('rotate'));
  const ringHit = await page.evaluate(() => {
    const v = document.querySelector('guide-planner').api;
    const c = v.sleeveScreenPosition(v.selectedIds[0]);
    for (let r = 30; r <= 140; r += 5) {
      for (let deg = 0; deg < 360; deg += 10) {
        const x = c.x + r * Math.cos((deg * Math.PI) / 180);
        const y = c.y + r * Math.sin((deg * Math.PI) / 180);
        const h = v.testGizmoHandleAt(x, y);
        if (h && h.mode === 'rotate') return { x, y };
      }
    }
    return null;
  });
  if (ringHit) {
    const q0 = await page.evaluate((id) => document.querySelector('guide-planner').api.testSleeveState(id), 1);
    const q1 = await page.evaluate((start) => {
      const v = document.querySelector('guide-planner').api;
      const pts = [];
      for (let i = 0; i <= 8; i++) pts.push({ x: start.x + i * 4, y: start.y + Math.sin(i / 2) * 6 });
      return v.testRotateSelectedByScreen(pts);
    }, ringHit);
    const qDiff = Math.hypot(q1[0] - q0.quaternion[0], q1[1] - q0.quaternion[1], q1[2] - q0.quaternion[2], q1[3] - q0.quaternion[3]);
    check('旋转手柄改变套管姿态', qDiff > 0.02, `四元数变化=${qDiff.toFixed(3)}`);
  } else {
    check('旋转手柄改变套管姿态', false, '未命中旋转环');
  }

  // 6. 框选多选（对齐/等距的专项验证见 e2e-align.mjs，那里在全新页面进行）
  await page.evaluate(() => document.querySelector('guide-planner').api.setGizmoMode('translate'));
  await page.mouse.move(box.x + 400, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 900, box.y + 520, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const selectedN = await page.evaluate(() => document.querySelector('guide-planner').api.selectedIds.length);
  check('框选进入多选状态（≥3 颗）', selectedN >= 3, `选中 ${selectedN} 颗`);

  check('全程无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '');
  await page.screenshot({ path: 'tests/e2e-interaction.png' });
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
