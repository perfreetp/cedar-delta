import { serve, launch, shotPath } from './harness.mjs';

const server = serve();
const { browser, page, errors } = await launch();

/**
 * 测量真实渲染工作量:只统计 FeatureRenderer.render + zr.flush + 标注排布,
 * 不含浏览器 vsync 等待(否则测到的是 16.7ms 的刷新间隔,不是代码成本)。
 */
async function measure(kind, viewIndex, steps = 80) {
  return page.evaluate(
    async ({ kind, viewIndex, steps }) => {
      const el = document.querySelectorAll('.map-view__canvas')[viewIndex];
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const ev = (t, x, y, o = {}) =>
        el.dispatchEvent(new PointerEvent(t, {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
          pointerId: 1, button: 0, buttons: 1, ...o,
        }));

      if (kind === 'pan') {
        ev('pointerdown', cx, cy);
        for (let i = 1; i <= steps; i++) {
          ev('pointermove', cx + Math.sin(i / 8) * 150, cy + i * 1.3);
          await new Promise((res) => requestAnimationFrame(res));
        }
        ev('pointerup', cx, cy, { buttons: 0 });
      } else if (kind === 'rotate') {
        ev('pointerdown', cx, cy, { button: 2, buttons: 2 });
        for (let i = 1; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 0.9;
          ev('pointermove', cx + Math.cos(a) * 220, cy + Math.sin(a) * 220, { buttons: 2 });
          await new Promise((res) => requestAnimationFrame(res));
        }
        ev('pointerup', cx, cy, { buttons: 0, button: 2 });
      } else {
        for (let i = 0; i < steps; i++) {
          el.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, clientX: cx, clientY: cy,
            deltaY: i < steps / 2 ? -30 : 30,
          }));
          await new Promise((res) => requestAnimationFrame(res));
        }
      }
      await new Promise((res) => setTimeout(res, 350));
      await new Promise((res) => requestAnimationFrame(res));

      const rows = window.__evacPerf.filter((x) => x[0] + x[1] + x[2] > 0.05);
      const totals = rows.map((x) => x[0] + x[1] + x[2]).sort((a, b) => a - b);
      const pct = (p) => +(totals[Math.min(totals.length - 1, Math.floor(totals.length * p))] ?? 0).toFixed(2);
      return { frames: rows.length, p50: pct(0.5), p95: pct(0.95), max: +(totals.at(-1) ?? 0).toFixed(2) };
    },
    { kind, viewIndex, steps },
  );
}

const BUDGET = 16.7;
let failed = 0;
for (const [vi, name] of [[1, '楼层视图'], [0, '总览视图']]) {
  for (const kind of ['pan', 'zoom', 'rotate']) {
    const r = await measure(kind, vi);
    const ok = r.p95 <= BUDGET;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${kind.padEnd(6)} p50=${r.p50}ms p95=${r.p95}ms max=${r.max}ms (预算 ${BUDGET}ms)`);
  }
}

const stats = await page.evaluate(() =>
  [...document.querySelectorAll('.map-view__stats')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
console.log('当前绘制量:', stats);
await page.screenshot({ path: shotPath('30-perf') });
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
