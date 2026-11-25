import { serve, launch, shotPath } from './harness.mjs';
const server = serve();
const { browser, page, errors } = await launch();
const log = (n, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

const cam = (vi) => page.evaluate((i) => {
  const t = document.querySelectorAll('.map-view__badges')[i].textContent;
  return t;
}, vi);

// 在楼层视图里点一个危险源,看总览是否跟随
const beforeOverview = await cam(0);
const clickPoint = await page.evaluate(() => {
  const el = document.querySelectorAll('.map-view__canvas')[1];
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.36 };
});
await page.mouse.click(clickPoint.x, clickPoint.y);
await page.waitForTimeout(900);
const detail = await page.evaluate(() => {
  const right = document.querySelector('.app__side--right');
  const dl = right?.querySelector('.kv');
  const kv = dl ? [...dl.children].map((n) => n.textContent.trim()) : [];
  return { label: right?.querySelector('.panel__head .panel__meta')?.textContent ?? '', kv: kv.slice(0, 6) };
});
log('楼层点选产生详情', detail.kv.length >= 4, JSON.stringify(detail));

const afterOverview = await cam(0);
log('总览相机跟随变化', beforeOverview !== afterOverview, `${beforeOverview} -> ${afterOverview}`);
await page.screenshot({ path: shotPath('20-linkage') });

// 框选:按住 Shift 拖框
const box = await page.evaluate(() => {
  const el = document.querySelectorAll('.map-view__canvas')[1];
  const r = el.getBoundingClientRect();
  return { x1: r.left + r.width * 0.55, y1: r.top + r.height * 0.25, x2: r.left + r.width * 0.8, y2: r.top + r.height * 0.5 };
});
await page.keyboard.down('Shift');
await page.mouse.move(box.x1, box.y1);
await page.mouse.down();
await page.mouse.move((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2, { steps: 6 });
await page.mouse.move(box.x2, box.y2, { steps: 6 });
await page.mouse.up();
await page.keyboard.up('Shift');
await page.waitForTimeout(900);

const selInfo = await page.evaluate(() => {
  const right = document.querySelector('.app__side--right');
  const label = right?.querySelector('.panel__head .panel__meta')?.textContent ?? '';
  const foot = document.querySelector('.panel__foot')?.textContent ?? '';
  const chips = [...document.querySelectorAll('.inspector__breakdown .chip')].map((c) => c.textContent.trim());
  const hl = document.querySelectorAll('.selection-list__row').length;
  return { label, foot, chips, listRows: hl, bodyHasCount: /已选\s*\d+/.test(right?.textContent ?? '') };
});
const n = Number((selInfo.label.match(/已选\s*(\d+)/) ?? [])[1] ?? 0);
log('框选产生多选', n > 1, JSON.stringify(selInfo));
await page.screenshot({ path: shotPath('21-boxselect') });

// Esc 清空选择
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const cleared = await page.evaluate(() => {
  const right = document.querySelector('.app__side--right');
  return right?.textContent.includes('暂无选中要素') ?? false;
});
log('Esc 清空选择', cleared);

// 图层面板:拖拽把「危险源」以外的图层改序(键盘 Alt+↓)
const orderBefore = await page.evaluate(() =>
  [...document.querySelectorAll('.layer-row__name')].map((n) => n.textContent.trim()).join(','));
const moved = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.layer-row')];
  // 取第一个未锁定图层(危险源锁定在末位且不可拖动)
  const row = rows.find((r) => !r.classList.contains('layer-row--locked'));
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return [...document.querySelectorAll('.layer-row__name')].map((n) => n.textContent.trim()).join(',');
});
log('Alt+↓ 调整图层顺序', orderBefore !== moved, `${orderBefore} -> ${moved}`);
const hazardLast = moved.split(',').at(-1) === '危险源';
log('危险源始终压在最上', hazardLast);

// 缩放档位面板
await page.evaluate(() => [...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('缩放档位'))?.click());
await page.waitForTimeout(400);
const tiers = await page.evaluate(() => document.querySelectorAll('.tier-card').length);
log('档位面板有 4 档可配', tiers === 4, `cards=${tiers}`);

console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');
await browser.close();
server.close();
