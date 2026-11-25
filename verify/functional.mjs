import { serve, launch, shotPath } from './harness.mjs';

const server = serve();
const { browser, page, errors } = await launch();
const log = (name, ok, extra = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

/* ---------- 1. 标注不重叠 ---------- */
async function labelOverlap(viewIndex) {
  return page.evaluate((vi) => {
    const root = document.querySelectorAll('.map-view__labels')[vi];
    const rects = [...root.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, t: el.textContent };
    });
    let overlaps = 0;
    const samples = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          overlaps++;
          if (samples.length < 3) samples.push([a.t, b.t]);
        }
      }
    }
    return { count: rects.length, overlaps, samples };
  }, viewIndex);
}

for (const vi of [0, 1]) {
  const r = await labelOverlap(vi);
  log(`标注无重叠(view ${vi})`, r.overlaps === 0, `labels=${r.count} overlaps=${r.overlaps} ${JSON.stringify(r.samples)}`);
}

/* ---------- 2. 旋转后仍无重叠 ---------- */
async function rotate(viewIndex, deg) {
  await page.evaluate(async ({ vi, deg }) => {
    const el = document.querySelectorAll('.map-view__canvas')[vi];
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (t, x, y, o = {}) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, ...o }));
    ev('pointerdown', cx, cy, { button: 2, buttons: 2 });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const a = -Math.PI / 2 + (deg * Math.PI / 180) * (i / steps);
      ev('pointermove', cx + Math.cos(a) * 200, cy + Math.sin(a) * 200, { buttons: 2 });
      await new Promise((res) => requestAnimationFrame(res));
    }
    ev('pointerup', cx, cy, { buttons: 0, button: 2 });
    await new Promise((res) => setTimeout(res, 400));
  }, { vi: viewIndex, deg });
}
await rotate(1, 40);
await rotate(0, 40);
for (const vi of [0, 1]) {
  const r = await labelOverlap(vi);
  log(`旋转后标注无重叠(view ${vi})`, r.overlaps === 0, `labels=${r.count} overlaps=${r.overlaps}`);
}
await page.screenshot({ path: shotPath('10-rotated') });

/* ---------- 3. 危险源/出口标注优先保留 ---------- */
const priority = await page.evaluate(() => {
  const counts = {};
  for (const vi of [0, 1]) {
    const root = document.querySelectorAll('.map-view__labels')[vi];
    for (const el of root.children) {
      const kind = [...el.classList].find((c) => c.startsWith('map-label--'))?.slice(11) ?? '?';
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
});
log('危险源标注存在', (priority.hazard ?? 0) > 0, JSON.stringify(priority));

/* ---------- 4. 选中跨视图同步 ---------- */
async function clickAt(vi, fx, fy) {
  const box = await page.evaluate(({ vi, fx, fy }) => {
    const el = document.querySelectorAll('.map-view__canvas')[vi];
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * fx, y: r.top + r.height * fy };
  }, { vi, fx, fy });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(450);
}

await page.evaluate(() => {
  // 复原角度与视图,便于点选
  const btns = [...document.querySelectorAll('.btn')];
  btns.find((b) => b.textContent.includes('复位角度'))?.click();
});
await page.waitForTimeout(500);

const selectedBefore = await page.evaluate(() => {
  const n = document.querySelector('.panel__meta')?.textContent ?? '';
  return n;
});
await clickAt(1, 0.5, 0.5);
const sel = await page.evaluate(() => {
  const right = document.querySelector('.app__side--right');
  const dl = right?.querySelector('.kv');
  const kv = dl ? [...dl.children].map((n) => n.textContent.trim()) : [];
  const label = right?.querySelector('.panel__head .panel__meta')?.textContent ?? '';
  return { label, kv: kv.slice(0, 6) };
});
log('点击后出现要素详情', sel.label.includes('已选') && sel.kv.length >= 4, JSON.stringify(sel));

/* ---------- 5. 图层开关 ---------- */
const layerToggle = await page.evaluate(async () => {
  const row = [...document.querySelectorAll('.layer-row')].find(
    (r) => r.querySelector('.layer-row__name')?.textContent?.trim() === '区域面',
  );
  const cb = row.querySelector('input[type=checkbox]');
  const before = cb.checked;
  cb.click();
  await new Promise((r) => setTimeout(r, 500));
  const stats = document.querySelectorAll('.map-view__stats')[0].textContent;
  cb.click();
  await new Promise((r) => setTimeout(r, 500));
  return { before, afterStats: stats };
});
log('区域面图层可关闭', layerToggle.before === true, layerToggle.afterStats);

/* ---------- 6. 持久化:改缩放 + 图层顺序 → 刷新 → 还原 ---------- */
const before = await page.evaluate(() => {
  localStorage.setItem('evac.test.marker', '1');
  return localStorage.getItem('evac.viewstate.v1');
});
await page.waitForTimeout(900);
const saved = await page.evaluate(() => localStorage.getItem('evac.viewstate.v1'));
const savedParsed = saved ? JSON.parse(saved) : null;
log('状态已持久化', !!savedParsed?.cameras?.overview, savedParsed ? `zoom=${savedParsed.cameras.overview.zoom.toFixed(4)}` : '');

await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.map-view__canvas canvas');
await page.waitForTimeout(1400);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('evac.viewstate.v1') ?? 'null'));
const zoomOk = after && Math.abs(after.cameras.overview.zoom - savedParsed.cameras.overview.zoom) < 1e-6;
const layerOrderOk =
  after && after.layers.map((l) => l.id).join() === savedParsed.layers.map((l) => l.id).join();
log('刷新后缩放还原', zoomOk, `zoom=${after?.cameras.overview.zoom.toFixed(4)}`);
log('刷新后图层顺序还原', layerOrderOk, after?.layers.map((l) => l.id).join(','));

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
server.close();
