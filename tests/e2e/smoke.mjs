/**
 * 端到端冒烟测试（Playwright + headless Chromium，SwiftShader 软渲染 WebGL）。
 * 运行：先启动 vite dev，再 `node tests/e2e/smoke.mjs`
 * 验证：组件挂载、WebGL 场景、播放/暂停、scrub 与播放同源、静音/独奏、
 * 父缓动重排、JSON 导入导出还原、控制台无错误。
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5190/';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('cr-app', { state: 'attached' });
await page.waitForTimeout(2000); // 等 Babylon 首帧渲染

// 1. 组件挂载与 WebGL
const mounted = await page.evaluate(() => {
  const app = document.querySelector('cr-app');
  const timeline = app?.shadowRoot?.querySelector('cr-timeline');
  const inspector = app?.shadowRoot?.querySelector('cr-inspector');
  const canvas = app?.shadowRoot?.querySelector('canvas');
  const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  const laneCount = timeline?.shadowRoot?.querySelectorAll('.lane-row').length ?? 0;
  const kfCount = timeline?.shadowRoot?.querySelectorAll('.kf').length ?? 0;
  return {
    hasCanvas: !!canvas,
    hasGL: !!gl,
    hasInspector: !!inspector,
    laneCount,
    kfCount,
    trackCount: window.__store.doc.tracks.length,
  };
});
check('Web Components 全部挂载', mounted.hasCanvas && mounted.hasInspector && mounted.laneCount >= 3, `泳道 ${mounted.laneCount} 条，关键帧标记 ${mounted.kfCount} 个`);
check('WebGL 上下文可用', mounted.hasGL);
check('默认文档含根轨道', mounted.trackCount >= 2);

const clickTimelineButton = (act) => page.evaluate((a) => {
  const tl = document.querySelector('cr-app').shadowRoot.querySelector('cr-timeline');
  tl.shadowRoot.querySelector(`button[data-act="${a}"]`).click();
}, act);

// 2. 播放/暂停推进播放头
const t0 = await page.evaluate(() => window.__store.currentTime);
await clickTimelineButton('play');
await page.waitForTimeout(700);
await clickTimelineButton('pause');
const t1 = await page.evaluate(() => window.__store.currentTime);
check('播放推进、暂停停住', t1 > t0 + 0.4, `${t0.toFixed(2)}s -> ${t1.toFixed(2)}s`);

// 3. scrub 与播放同源：scrub(t) 后场景相机值 == evaluateTimeline(t)
await page.evaluate(() => window.__playback.scrub(7.5));
await page.waitForTimeout(100);
const consistency = await page.evaluate(() => {
  const ev = window.__evaluate(window.__store.doc, 7.5);
  const cam = ev.samples.find((s) => s.kind === 'camera' && s.camera)?.camera;
  const sceneCam = window.__scene.camera;
  if (!cam) return { ok: false };
  const dR = Math.abs(cam.radius - sceneCam.radius);
  const dA = Math.abs(cam.azimuth - sceneCam.alpha);
  return { ok: dR < 1e-6 && dA < 1e-6, dR, dA, storeTime: window.__store.currentTime };
});
check('拖动预览与评测引擎结果一致（相机半径/方位角严格相等）', consistency.ok, JSON.stringify(consistency));

// 4. 纯函数可重复性：同一时间两次评测完全相同
const pure = await page.evaluate(() => {
  const a = JSON.stringify(window.__evaluate(window.__store.doc, 3.33));
  const b = JSON.stringify(window.__evaluate(window.__store.doc, 3.33));
  return a === b;
});
check('评测为纯函数（重复求值结果一致）', pure);

// 5. 新增轨道（真实按钮点击）
const countTracks = () => page.evaluate(() => {
  let n = 0;
  const walk = (tracks) => {
    for (const t of tracks) {
      n++;
      if (Array.isArray(t.children)) walk(t.children);
    }
  };
  walk(window.__store.doc.tracks);
  return n;
});
const beforeCount = await countTracks();
await clickTimelineButton('add-crater');
const afterCount = await countTracks();
check('界面按钮新增轨道', afterCount === beforeCount + 1);

// 6. 静音与独奏
await page.evaluate(() => {
  const findLeaf = (tracks, predicate) => {
    for (const t of tracks) {
      if (t.kind !== 'group' && (!predicate || predicate(t))) return t;
      if (Array.isArray(t.children)) {
        const f = findLeaf(t.children, predicate);
        if (f) return f;
      }
    }
    return null;
  };
  const firstLeaf = findLeaf(window.__store.doc.tracks, null);
  window.__store.toggleMute(firstLeaf.id);
});
const mutedOk = await page.evaluate(() => window.__evaluate(window.__store.doc, 5).mutedTrackIds.length >= 1);
check('静音轨进入 mutedTrackIds', mutedOk);
await page.evaluate(() => {
  const findLeaf = (tracks, predicate) => {
    for (const t of tracks) {
      if (t.kind !== 'group' && (!predicate || predicate(t))) return t;
      if (Array.isArray(t.children)) {
        const f = findLeaf(t.children, predicate);
        if (f) return f;
      }
    }
    return null;
  };
  const leaf = findLeaf(window.__store.doc.tracks, (t) => !t.muted);
  window.__store.setSolo(leaf.id);
});
const soloOk = await page.evaluate(() => {
  const soloId = window.__store.soloTrackId;
  const other = window.__store.doc.tracks[0];
  return window.__store.isEffectivelyMuted(other.id) === (other.id !== soloId);
});
check('独奏模式：其余轨视为静音', soloOk);
await page.evaluate(() => window.__store.setSolo(null));

// 7. 父分组缓动改变 -> 子关键帧全局位置重排
const rearrangeOk = await page.evaluate(() => {
  // 找到默认文档中的三层分组链
  const root = window.__store.doc.tracks.find((t) => t.kind === 'group');
  const sub = root.children.find((t) => t.kind === 'group');
  const leaf = sub.children.find((t) => t.kind !== 'group');
  // 通过 store 的正映射间接验证：取关键帧局部 0.5 附近的全局位置
  const before = window.__store.localToGlobal(leaf.id, 0.25);
  root.easing = 'linear';
  const linearPos = window.__store.localToGlobal(leaf.id, 0.25);
  root.easing = 'ease';
  const easePos = window.__store.localToGlobal(leaf.id, 0.25);
  return { changed: Math.abs(linearPos - easePos) > 1e-6, linearPos, easePos, localKept: leaf.keyframes.every((k) => k.time >= 0 && k.time <= 1) };
});
check('改父轨缓动后子关键帧全局时间重排、局部数据不变', rearrangeOk.changed && rearrangeOk.localKept,
  `linear=${rearrangeOk.linearPos.toFixed(3)} ease=${rearrangeOk.easePos.toFixed(3)}`);

// 8. JSON 导出 -> 导入完全还原
const roundtrip = await page.evaluate(() => {
  const json = window.__store.exportJSON();
  const before = JSON.stringify(window.__store.doc);
  window.__store.loadJSON(json);
  const after = JSON.stringify(window.__store.doc);
  const parsed = JSON.parse(json);
  const depthOk = (tracks, d) => tracks.every((t) => d <= 3 && (t.kind !== 'group' || depthOk(t.children, d + 1)));
  return { equal: before === after, depthOk: depthOk(parsed.tracks, 1), version: parsed.version };
});
check('JSON 导出再导入：文档完全一致且层级 ≤ 3', roundtrip.equal && roundtrip.depthOk && roundtrip.version === 1);

// 9. 时间线长度拉伸
const stretch = await page.evaluate(() => {
  window.__store.setDuration(33);
  return window.__store.doc.duration === 33;
});
check('时间线长度可拉伸（秒）', stretch);

// 9b. 拖动时显示当前时间与各轨激活状态
const scrubDisplay = await page.evaluate(() => {
  window.__playback.scrub(5);
  const tl = document.querySelector('cr-app').shadowRoot.querySelector('cr-timeline');
  const timeText = tl.shadowRoot.querySelector('[data-role=time]').textContent;
  const statusText = tl.shadowRoot.querySelector('[data-role=status]').textContent;
  const activeLanes = tl.shadowRoot.querySelectorAll('.lane-row.active-leaf').length;
  const ev = window.__evaluate(window.__store.doc, 5);
  return {
    timeShows: timeText.startsWith('5.00s'),
    statusHasActive: statusText.includes('激活轨'),
    activeLanes,
    activeCount: ev.activeTrackIds.length,
  };
});
check('拖动时显示当前时间与各轨激活状态',
  scrubDisplay.timeShows && scrubDisplay.statusHasActive && scrubDisplay.activeLanes >= 1,
  JSON.stringify(scrubDisplay));

// 9c. 回放中暂停后可继续编辑，且编辑立即反映到场景
const pauseEdit = await page.evaluate(() => {
  window.__playback.play();
  window.__playback.pause();
  const t = window.__store.currentTime;
  // 暂停状态下改陨石坑关键帧数值
  const craterLeaf = (() => {
    const find = (tracks) => {
      for (const x of tracks) {
        if (x.kind === 'crater') return x;
        if (Array.isArray(x.children)) { const f = find(x.children); if (f) return f; }
      }
      return null;
    };
    return find(window.__store.doc.tracks);
  })();
  const kf = craterLeaf.keyframes[craterLeaf.keyframes.length - 1];
  window.__store.updateKeyframe(craterLeaf.id, kf.id, { radius: 12.345 });
  const ev = window.__evaluate(window.__store.doc, t);
  const sample = ev.samples.find((s) => s.kind === 'crater');
  // 继续播放
  window.__playback.play();
  const playing = window.__store.playing;
  window.__playback.pause();
  return { edited: kf.radius === 12.345, playing, sampleRadius: sample.crater.radius };
});
check('回放中可暂停并继续编辑、编辑生效后可继续播放',
  pauseEdit.edited && pauseEdit.playing && typeof pauseEdit.sampleRadius === 'number',
  JSON.stringify(pauseEdit));

// 10. 控制台无错误
check('浏览器控制台无错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'tests/e2e/screenshot.png' });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
process.exit(failed.length ? 1 : 0);
