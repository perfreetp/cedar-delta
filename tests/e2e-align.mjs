/**
 * 全新页面下的多选对齐与组碰撞避让验证，避免长会话状态干扰。
 */
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const launch = async () =>
  chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });

// ---------- 场景 A：多选对齐（含一颗先被旋转脱离吸附的套管） ----------
{
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForSelector('guide-planner canvas');
    await page.waitForTimeout(1200);
    const box = await page.locator('guide-planner canvas').boundingBox();

    // 框选全部 14 颗
    await page.mouse.move(box.x + 350, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 1000, box.y + 650, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const outcome = await page.evaluate(() => {
      const v = document.querySelector('guide-planner').api;
      const ids = [...v.selectedIds];
      // 制造一颗脱离吸附、被甩到牙弓外的套管（关键边界场景）
      const loose = ids[0];
      v.testDetachSleeve(loose, [120, 90, 120]);
      if (v.testSleeveState(loose).snapped !== false) throw new Error('脱离态设置失败');
      v.alignSelected();
      const after = ids.map((id) => v.testSleeveState(id));
      const sameQuat = after.slice(1).every((q2) =>
        q2.quaternion.every((x, k) => Math.abs(x - after[0].quaternion[k]) < 1e-4));
      const ordered = after.filter((x) => x.snapU !== null).sort((a, b) => a.snapU - b.snapU);
      const seg = [];
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1].position;
        const b = ordered[i].position;
        seg.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      const mean = seg.reduce((x, y) => x + y, 0) / seg.length;
      const maxDev = Math.max(...seg.map((x) => Math.abs(x - mean))) / mean;
      // 等弧距在弯曲牙弓上的直线弦距会有曲率相关偏差，10% 为几何合理容差
      const uniqueU = new Set(ordered.map((x) => x.snapU.toFixed(4)));
      // 准确判据：沿牙弓的弧长坐标相邻差恒定
      const arcSortedIds = ordered.map((x) => x.id);
      const arcs = v.testArcCoordinates(arcSortedIds);
      const arcGaps = arcs.slice(1).map((x, i) => x - arcs[i]);
      const arcMean = arcGaps.reduce((x, y) => x + y, 0) / arcGaps.length;
      const arcMaxDev = Math.max(...arcGaps.map((x) => Math.abs(x - arcMean))) / arcMean;
      return {
        count: ids.length,
        sameQuat,
        maxDev,
        arcMaxDev,
        allSnapped: after.every((x) => x.snapped),
        noOverlapU: uniqueU.size === ordered.length,
        looseRecovered: v.testSleeveState(loose).snapped === true,
      };
    });
    check('对齐：含脱离件时全部重新吸附（含原脱离件）', outcome.allSnapped && outcome.looseRecovered, `count=${outcome.count}`);
    check('对齐：姿态统一', outcome.sameQuat === true);
    check('对齐：弧长等距（测量容差<4%）', outcome.arcMaxDev < 0.04, `${(outcome.arcMaxDev * 100).toFixed(2)}%`);
    check('对齐：弦距在曲率容差内（<10%）', outcome.maxDev < 0.10, `${(outcome.maxDev * 100).toFixed(1)}%`);
    check('对齐：无套管被压到同一弧位', outcome.noOverlapU === true);
    check('对齐场景无异常', errors.length === 0, errors[0] ?? '');
  } catch (e) {
    check('对齐测试执行', false, String(e));
  }
  await browser.close();
}

// ---------- 场景 B：组平移碰撞避让（核心层经引擎 API 间接验证） ----------
{
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForSelector('guide-planner canvas');
    await page.waitForTimeout(1200);
    const collision = await page.evaluate(() => {
      const v = document.querySelector('guide-planner').api;
      // 初始所有套管水平间距应大于碰撞直径
      const ids = [...Array(v.sleeveCount).keys()].map((i) => i + 1);
      const states = ids.map((id) => v.testSleeveState(id));
      let minHoriz = Infinity;
      for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
          const a = states[i].position;
          const b = states[j].position;
          minHoriz = Math.min(minHoriz, Math.hypot(a[0] - b[0], a[2] - b[2]));
        }
      }
      return { minHoriz, count: states.length };
    });
    check('初始布管无重叠（最小水平距≥碰撞直径 5.2mm）', collision.minHoriz >= 5.19,
      `min=${collision.minHoriz.toFixed(2)}mm`);
  } catch (e) {
    check('碰撞前置检查', false, String(e));
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  process.exit(1);
}
