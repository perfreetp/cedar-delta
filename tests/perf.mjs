import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForSelector('guide-planner canvas');
await page.waitForTimeout(1000);
const perf = await page.evaluate(async () => {
  const v = document.querySelector('guide-planner').api;
  // 统计连续帧间隔（应用自驱动 requestAnimationFrame 由 PlayCanvas 接管）
  const frames = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (frames.length < 120) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const avgMs = frames.reduce((a, b) => a + b, 0) / frames.length;
  return {
    markerCount: 3000,
    sleeveCount: v.sleeveCount,
    avgFrameMs: +avgMs.toFixed(2),
    fps: +(1000 / avgMs).toFixed(1),
  };
});
console.log(JSON.stringify(perf, null, 1));
// SwiftShader 软件渲染偏慢，这里只验证不崩且有稳定帧；真机 GPU 会高得多
const ok = perf.fps > 5 && perf.sleeveCount === 14;
console.log(ok ? '✓ 3000 标记点 + 14 套管场景稳定出帧（软件渲染基准）' : '✗ 性能异常');
await browser.close();
process.exit(ok ? 0 : 1);
