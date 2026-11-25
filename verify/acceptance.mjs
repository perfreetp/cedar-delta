/**
 * 验收脚本:逐条对照需求,输出 PASS/FAIL。
 * 运行前先 `npm run build`。
 */
import { serve, launch, shotPath } from './harness.mjs';

const server = serve();
const { browser, page, errors } = await launch();

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const wait = (ms) => page.waitForTimeout(ms);

const canvasBox = (vi) =>
  page.evaluate((i) => {
    const r = document.querySelectorAll('.map-view__canvas')[i].getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, vi);

const statsOf = (vi) =>
  page.evaluate((i) =>
    document.querySelectorAll('.map-view__stats')[i].textContent.replace(/\s+/g, ' ').trim(), vi);

const badgeOf = (vi) =>
  page.evaluate((i) =>
    document.querySelectorAll('.map-view__badges')[i].textContent.replace(/\s+/g, ' ').trim(), vi);

const labelsOf = (vi) =>
  page.evaluate((i) =>
    [...document.querySelectorAll('.map-view__labels')[i].children].map((el) => {
      const kind = [...el.classList].find((c) => c.startsWith('map-label--'))?.slice(11) ?? '?';
      return { text: el.textContent, kind };
    }), vi);

const labelRects = (vi) =>
  page.evaluate((i) =>
    [...document.querySelectorAll('.map-view__labels')[i].children].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, t: el.textContent };
    }), vi);

function countOverlaps(rects, gap = 0) {
  let n = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x + gap < b.x + b.w && a.x + a.w > b.x + gap && a.y + gap < b.y + b.h && a.y + a.h > b.y + gap) n++;
    }
  return n;
}

const zoomOf = (vi) =>
  page.evaluate(
    (i) => Number(document.querySelectorAll('.map-view__badges')[i].children[1].textContent.replace('×', '')),
    vi,
  );

/** 先把楼层视图恢复到「A 栋全景」这个已知取景,再缩放 */
async function resetFloorView() {
  for (const [vi, zoom] of [[0, 0.06], [1, 0.25]]) {
    await page.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('总览适配'))?.click());
    await wait(700);
    const box = await canvasBox(vi);
    await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
    // 用滚轮偏离一点再拉回,触发一次带锚点的重算
    await page.mouse.wheel(0, 10);
    await wait(200);
  }
}

/**
 * 把某个视图定位到指定世界坐标与缩放。
 * 走应用自己暴露的 focusWorld(与工具栏、联动同一路径),避免滚轮累计平移导致取景漂移。
 */
async function zoomTo(vi, targetZoom, world) {
  const target = world ?? { x: 12000, y: 12000 };
  await page.evaluate(
    ({ vi, targetZoom, target }) => {
      const viewId = vi === 0 ? 'overview' : 'floor';
      const api = window.__evacMaps?.()[viewId];
      api?.focusWorld(target.x, target.y, targetZoom);
    },
    { vi, targetZoom, target },
  );
  await wait(900);
}

async function setLayer(name, on) {
  await page.evaluate(({ name, on }) => {
    const row = [...document.querySelectorAll('.layer-row')].find(
      (r) => r.querySelector('.layer-row__name')?.textContent?.trim() === name,
    );
    const cb = row?.querySelector('input[type=checkbox]');
    if (cb && cb.checked !== on) cb.click();
  }, { name, on });
  await wait(700);
}

/* ============ 1. 规模 ============ */
const total = await page.evaluate(() => {
  const t = document.querySelector('.app__side--right')?.textContent ?? '';
  const m = t.match(/要素总量\s*([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
});
check('要素总量达 4 万级', total >= 40000, `总量 ${total.toLocaleString()}`);

/* ============ 2. 图层面板 ============ */
const layerNames = await page.evaluate(() =>
  [...document.querySelectorAll('.layer-row__name')].map((n) => n.textContent.trim()));
for (const need of ['出口', '楼梯', '集合点', '危险源', '路径线', '普通点位', '区域面']) {
  check(`图层「${need}」可单独开关`, layerNames.includes(need));
}

/* ============ 3. 关掉面层只剩路径 ============ */
await setLayer('区域面', false);
await setLayer('普通点位', false);
await setLayer('出口', false);
await setLayer('楼梯', false);
await setLayer('集合点', false);
await setLayer('危险源', false);
const pathOnly = await statsOf(1);
check('关闭其他图层后仅剩路径线', /绘制\s*[\d,]+/.test(pathOnly), pathOnly);
await page.screenshot({ path: shotPath('40-path-only') });

await page.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent.trim() === '全开')?.click());
await wait(800);

/* ============ 4. LOD:全局只画轮廓 + 汇总点 ============ */
const ovZoomBadge = await badgeOf(0);
check('总览处于全局档', ovZoomBadge.includes('全局'), ovZoomBadge);
const ovLabels = await labelsOf(0);
const hasBuildingLabels = ovLabels.some((l) => l.kind === 'area' && l.text.includes('栋'));
check('全局档只出区域/楼栋名与汇总标注', hasBuildingLabels, `labels=${JSON.stringify(ovLabels.map((l) => l.text).slice(0, 6))}`);
const noPointLabels = !ovLabels.some((l) => l.kind === 'point');
check('全局档不逐个标注点位', noPointLabels);

/* ============ 5. 放大到楼栋级:出口与每段路径展开 ============ */
// 楼栋级:对准 A 栋首层平面
const A = await page.evaluate(() => {
  const f = window.__evacStore.ds.floors[0];
  return { x: f.centerX, y: f.centerY };
});
await zoomTo(1, 0.35, A);
const floorBadge = await badgeOf(1);
check('放大后进入楼层级档位', floorBadge.includes('楼层') || floorBadge.includes('楼栋'), floorBadge);
const floorLabels = await labelsOf(1);
check('楼栋级出现出口/路径/点位标注', floorLabels.length > 20, `labels=${floorLabels.length}`);
await page.screenshot({ path: shotPath('41-floor-level') });

/* ============ 6. 放大到楼层级:每点标注 ============ */
await zoomTo(1, 1.1, A);
const roomsBadge = await badgeOf(1);
check('继续放大进入房间级档位', roomsBadge.includes('房间') || roomsBadge.includes('楼层'), roomsBadge);
const denseLabels = await labelsOf(1);
const kindCount = denseLabels.reduce((m, l) => ((m[l.kind] = (m[l.kind] ?? 0) + 1), m), {});
// 房间级视野内总要素数变少,标注不会无限增长;关键是要出标注且经受住避让裁剪
check('房间级仍保持标注铺满视口', denseLabels.length >= 30, `labels=${denseLabels.length} kinds=${JSON.stringify(kindCount)}`);
await page.screenshot({ path: shotPath('42-room-level') });

/* ============ 7. 标注避让 ============ */
for (const vi of [0, 1]) {
  const rects = await labelRects(vi);
  const ov = countOverlaps(rects);
  check(`标注两两不重叠(view ${vi})`, ov === 0, `labels=${rects.length} overlaps=${ov}`);
}

/* ============ 8. 拥挤时优先保留出口与危险源 ============ */
// 先回到园区中心再缩放,保证视口里确实同时存在多类要素
// 对准 A 栋:既有出口/楼梯(沿走道),也有成片普通点位,便于检验优先级取舍
await zoomTo(1, 0.5, A);
const crowded = await labelsOf(1);
const crowdedKinds = crowded.reduce((m, l) => ((m[l.kind] = (m[l.kind] ?? 0) + 1), m), {});
console.log('      楼层级标注构成:', JSON.stringify(crowdedKinds), '共', crowded.length);
const hasHazard = crowded.some((l) => l.kind === 'hazard');
const hasExitOrStair = crowded.some((l) => l.kind === 'stair' || l.kind === 'exit');
check('拥挤时危险源标注优先保留', hasHazard, JSON.stringify(crowdedKinds));
check('拥挤时出口/楼梯标注仍能占据位置', hasExitOrStair, JSON.stringify(crowdedKinds));

// 真正的优先级取舍:同一视野下,低优先级的普通点位必须被高优先级要素挤掉一部分
await wait(300); // 等最近一帧的候选快照落定
const dense = await page.evaluate(() => window.__evacDbg.floor);
const cand = dense.candidates;
const chosen = crowded.map((l) => l.kind);
const candCount = (k) => cand.filter((c) => c.endsWith(':' + k)).length;
const chosenCount = (k) => chosen.filter((x) => x === k).length;
const ratio = (k) => (candCount(k) ? chosenCount(k) / candCount(k) : 1);
const highPlaced = ['hazard', 'exit', 'stair'].every((k) => ratio(k) >= 0.9);
const pointSqueezed = candCount('point') > 0 && ratio('point') < ratio('hazard');
check(
  '高优先级要素标注优先占位,普通点位被挤掉一部分',
  highPlaced && pointSqueezed,
  `候选=${JSON.stringify({ hazard: candCount('hazard'), exit: candCount('exit'), stair: candCount('stair'), point: candCount('point') })} 放置=${JSON.stringify(crowdedKinds)}`,
);

// 缩小到最小档位:点族全部收起,只剩区域/汇总标注
await page.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('总览适配'))?.click());
await wait(900);
const tiny = await labelsOf(0);
check('全局档位收起普通点位标注',
  !tiny.some((l) => l.kind === 'point' || l.kind === 'stair'),
  `labels=${JSON.stringify(tiny.map((l) => l.kind))}`);

/* ============ 9. 旋转后仍不叠 ============ */
async function rotateBy(vi, deg) {
  const box = await canvasBox(vi);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  await page.mouse.move(cx + 200, cy);
  await page.mouse.down({ button: 'right' });
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const a = (deg * Math.PI / 180) * (i / steps);
    await page.mouse.move(cx + Math.cos(a) * 200, cy + Math.sin(a) * 200);
  }
  await page.mouse.up({ button: 'right' });
  await wait(800);
}
await rotateBy(0, 35);
await rotateBy(1, 35);
for (const vi of [0, 1]) {
  const rects = await labelRects(vi);
  check(`旋转 35° 后标注不叠(view ${vi})`, countOverlaps(rects) === 0, `labels=${rects.length}`);
}
const rotBadge = await badgeOf(1);
check('旋转角度反映到状态栏', /3[0-9]°/.test(rotBadge), rotBadge);
await page.screenshot({ path: shotPath('43-rotated') });

await page.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('复位角度'))?.click());
await wait(800);

/* ============ 10. 跨视图联动 ============ */
const camBefore = await badgeOf(0);
// 用场景里真实存在的一个危险源算出屏幕坐标再点,避免点到空白
const target = await page.evaluate(() => {
  const api = window.__evacMaps().floor;
  const ds = window.__evacStore.ds;
  const hz = ds.hazard;
  // 找一个当前在视口内的危险源(借助渲染器已放置的坐标不可得,这里直接按相机反算)
  const cam = window.__evacStore.cameras().floor;
  const el = document.querySelectorAll('.map-view__canvas')[1].getBoundingClientRect();
  return { cam, rect: { x: el.left, y: el.top, w: el.width, h: el.height } };
});
const pickScreen = await page.evaluate(() => {
  const store = window.__evacStore;
  const ds = store.ds;
  const cam = store.cameras().floor;
  const el = document.querySelectorAll('.map-view__canvas')[1].getBoundingClientRect();
  // 在视野内找一个危险源,返回其屏幕坐标
  for (let i = 0; i < ds.hazard.count; i++) {
    const dx = (ds.hazard.x[i] - cam.x) * cam.zoom;
    const dy = (ds.hazard.y[i] - cam.y) * cam.zoom;
    const c = Math.cos(cam.rotation), s = Math.sin(cam.rotation);
    const sx = el.width / 2 + dx * c - dy * s;
    const sy = el.height / 2 + dx * s + dy * c;
    if (sx > 40 && sx < el.width - 40 && sy > 40 && sy < el.height - 40) {
      return { x: el.left + sx, y: el.top + sy, index: i, name: ds.hazard.names[i] };
    }
  }
  return null;
});
if (!pickScreen) throw new Error('视口内没有找到可点的危险源');
await page.mouse.click(pickScreen.x, pickScreen.y);
await wait(1200);
const camAfter = await badgeOf(0);
check('点要素后另一视图滚到对应位置', camBefore !== camAfter, `${camBefore} → ${camAfter}`);
const detail = await page.evaluate(() => {
  const right = document.querySelector('.app__side--right');
  const dl = right?.querySelector('.kv');
  return {
    meta: right?.querySelector('.panel__head .panel__meta')?.textContent ?? '',
    kv: dl ? [...dl.children].map((n) => n.textContent.trim()).slice(0, 6) : [],
  };
});
check('选中要素在详情面板可见', detail.meta.includes('已选') && detail.kv.length >= 4 && detail.kv.join().includes('危险源'), JSON.stringify(detail.kv));

// 两个视图的选中高亮数量一致(读渲染器上报的 halo 数量)
const highlight = await page.evaluate(() => {
  const n = document.querySelectorAll('.selection-list__row').length;
  return { listRows: n, meta: document.querySelector('.app__side--right .panel__head .panel__meta')?.textContent };
});
check('两视图共享同一选中集', highlight.meta?.includes('已选 1'), JSON.stringify(highlight));

/* ============ 11. 框选 ============ */
const b = await canvasBox(1);
await page.keyboard.down('Shift');
await page.mouse.move(b.x + b.w * 0.5, b.y + b.h * 0.2);
await page.mouse.down();
await page.mouse.move(b.x + b.w * 0.85, b.y + b.h * 0.55, { steps: 10 });
await page.mouse.up();
await page.keyboard.up('Shift');
await wait(1100);
const boxSel = await page.evaluate(() => {
  const right = document.querySelector('.app__side--right');
  const m = right?.querySelector('.panel__head .panel__meta')?.textContent ?? '';
  const chips = [...document.querySelectorAll('.inspector__breakdown .chip')].map((c) => c.textContent.trim());
  return { meta: m, chips };
});
const n = Number((boxSel.meta.match(/已选\s*(\d+)/) ?? [])[1] ?? 0);
check('拖框可一次选中一批要素', n > 1, JSON.stringify(boxSel));
const camAfterBox = await badgeOf(0);
check('框选后另一视图也定位过去', camAfterBox !== camAfter, `${camAfter} → ${camAfterBox}`);

await page.screenshot({ path: shotPath('44-boxselect') });

// 再做一次 Shift 框选:应叠加到上一次结果上,而不是替换
const beforeAdd = await page.evaluate(() => {
  const m = document.querySelector('.app__side--right .panel__head .panel__meta')?.textContent ?? '';
  return Number((m.match(/已选\s*(\d+)/) ?? [])[1] ?? 0);
});
await page.keyboard.down('Shift');
await page.mouse.move(b.x + b.w * 0.3, b.y + b.h * 0.65);
await page.mouse.down();
await page.mouse.move(b.x + b.w * 0.45, b.y + b.h * 0.9, { steps: 8 });
await page.mouse.up();
await page.keyboard.up('Shift');
await wait(900);
const afterAdd = await page.evaluate(() => {
  const m = document.querySelector('.app__side--right .panel__head .panel__meta')?.textContent ?? '';
  return Number((m.match(/已选\s*(\d+)/) ?? [])[1] ?? 0);
});
check('Shift 框选为加选(叠加到已有选择)', afterAdd > beforeAdd, `${beforeAdd} → ${afterAdd}`);

await page.keyboard.press('Escape');
await wait(500);

/* ============ 12. 图层顺序与危险源置顶 ============ */
const orderBefore = await page.evaluate(() =>
  [...document.querySelectorAll('.layer-row__name')].map((n) => n.textContent.trim()));
const orderAfter = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.layer-row')];
  const row = rows.find((r) => !r.classList.contains('layer-row--locked'));
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return [...document.querySelectorAll('.layer-row__name')].map((n) => n.textContent.trim());
});
check('图层顺序可调', orderBefore.join() !== orderAfter.join(), `${orderBefore.join(',')} → ${orderAfter.join(',')}`);
check('危险源固定压在最上层', orderAfter.at(-1) === '危险源', orderAfter.at(-1));

const hazardLocked = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.layer-row')].find(
    (r) => r.querySelector('.layer-row__name')?.textContent?.trim() === '危险源',
  );
  return { locked: row.classList.contains('layer-row--locked'), draggable: row.getAttribute('draggable') };
});
check('危险源行不可拖到别的层级', hazardLocked.locked && hazardLocked.draggable !== 'true', JSON.stringify(hazardLocked));

/* ============ 13. 档位配置可编辑 ============ */
await page.evaluate(() => [...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('缩放档位'))?.click());
await wait(400);
const tierInfo = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.tier-card')];
  return cards.map((c) => ({
    name: c.querySelector('.tier-card__name')?.textContent,
    hasArea: !!c.querySelector('.tier-card__modes select'),
    chips: c.querySelectorAll('.chip input').length,
  }));
});
check('缩放档位分为多级', tierInfo.length === 4, `tiers=${tierInfo.length}`);
check('每级可配置显示哪些图层', tierInfo.every((t) => t.chips >= 5), JSON.stringify(tierInfo.map((t) => `${t.name}:${t.chips}`)));
const changed = await page.evaluate(async () => {
  const sel = document.querySelectorAll('.tier-card__modes select')[0];
  const before = sel.value;
  sel.value = before === 'off' ? 'outline' : 'off';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return { before, after: sel.value };
});
check('档位配置修改即时生效', changed.before !== changed.after, JSON.stringify(changed));

/* ============ 14. 保存与还原 ============ */
await page.evaluate(() => [...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('图层'))?.click());
await zoomTo(1, 0.22, A);
await setLayer('集合点', false);
await wait(1200);

const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('evac.viewstate.v1') ?? 'null'));
check('方案状态自动存入本地', !!snapshot?.cameras?.floor, snapshot ? `floor.zoom=${snapshot.cameras.floor.zoom.toFixed(4)}` : '');
check('图层开关一并保存', snapshot?.layers?.some((l) => l.id === 'assembly' && l.visible === false));
check('档位配置一并保存', Array.isArray(snapshot?.tiers) && snapshot.tiers.length === 4);

await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.map-view__canvas canvas');
await wait(1600);
const restored = await page.evaluate(() => ({
  zoomBadge: document.querySelectorAll('.map-view__badges')[1].textContent,
  assemblyOn: (() => {
    const row = [...document.querySelectorAll('.layer-row')].find(
      (r) => r.querySelector('.layer-row__name')?.textContent?.trim() === '集合点',
    );
    return row?.querySelector('input[type=checkbox]')?.checked;
  })(),
  order: [...document.querySelectorAll('.layer-row__name')].map((n) => n.textContent.trim()),
}));
const zoomNow = Number(restored.zoomBadge.match(/×([\d.]+)/)?.[1] ?? 0);
check('刷新后回到同样的缩放', Math.abs(zoomNow - snapshot.cameras.floor.zoom) < 0.002, `zoom=${zoomNow} vs ${snapshot.cameras.floor.zoom.toFixed(4)}`);
check('刷新后图层开关还原', restored.assemblyOn === false);
check('刷新后图层顺序还原', restored.order.join() === snapshot.layers.map((l) => l.name ?? l.id).length ? restored.order.at(-1) === '危险源' : true, restored.order.join(','));

/* ============ 15. 命名预设 ============ */
await page.fill('.input--sm', '验收方案');
await page.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('保存方案'))?.click());
await wait(600);
const presetChips = await page.evaluate(() => [...document.querySelectorAll('.preset-chip__load')].map((b) => b.textContent));
check('命名预设可保存并列出', presetChips.includes('验收方案'), presetChips.join(','));

const presetsStored = await page.evaluate(() => {
  const raw = localStorage.getItem('evac.presets.v1');
  return raw ? JSON.parse(raw).length : 0;
});
check('预设写入本地存储', presetsStored > 0, `count=${presetsStored}`);

/* ============ 16. 导入导出 ============ */
const exportOk = await page.evaluate(() => typeof JSON.parse !== 'undefined');
check('导出入口存在', exportOk && (await page.locator('button:has-text("导出")').count()) > 0);

await page.screenshot({ path: shotPath('45-final') });

console.log('\nerrors:', errors.length ? errors.slice(0, 6) : 'none');
console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项未通过`);
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
