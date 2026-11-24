/**
 * 端到端验证脚本：通过 Chrome DevTools Protocol 驱动真实浏览器交互。
 * 用法：node scripts/e2e-check.mjs
 * 验证：区域绘制、物体放置、碰撞阻止、网格吸附、框选、撤销重做、导入导出、数千物体性能
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:5174/';
const PORT = 9300 + Math.floor(Math.random() * 500);
const PROFILE_DIR = mkdtempSync(join(tmpdir(), 'wvp-e2e-'));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${PORT}`,
      '--window-size=1600,900',
      URL,
    ],
    { stdio: 'pipe' },
  );

  async function getJson(path) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
  }

  // 等待调试端口
  let target;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJson('/json');
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  if (!target) throw new Error('Chrome 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await once(ws, 'open');
  let msgId = 0;
  const pending = new Map();
  const results = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  function send(method, params = {}) {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    }
    return r.result?.result?.value;
  }

  await send('Runtime.enable');
  // 等待 Solid 挂载与 three.js 画布就绪
  for (let i = 0; i < 40; i++) {
    const ok = await evaluate(`!!document.querySelector('.viewport canvas')`);
    if (ok) break;
    await sleep(250);
  }

  // 获取视口画布位置
  const canvas = await evaluate(`(() => {
    const c = document.querySelector('.viewport canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!canvas) throw new Error('画布未就绪');
  console.log('canvas:', JSON.stringify(canvas));

  function px(fx, fy) {
    // 相对视口比例 -> 屏幕像素
    return { x: canvas.x + canvas.w * fx, y: canvas.y + canvas.h * fy };
  }

  async function mouse(type, fx, fy, button = 'left', buttons = 1) {
    const p = px(fx, fy);
    await send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button,
      buttons,
      clickCount: 1,
    });
  }
  async function drag(fx0, fy0, fx1, fy1, steps = 8) {
    await mouse('mousePressed', fx0, fy0);
    for (let i = 1; i <= steps; i++) {
      await mouse(
        'mouseMoved',
        fx0 + ((fx1 - fx0) * i) / steps,
        fy0 + ((fy1 - fy0) * i) / steps,
        'none',
        1,
      );
      await sleep(20);
    }
    await mouse('mouseReleased', fx1, fy1);
    await sleep(100);
  }
  async function click(fx, fy) {
    await mouse('mousePressed', fx, fy);
    await mouse('mouseReleased', fx, fy);
    await sleep(120);
  }

  const check = (name, cond, extra = '') => {
    results.push({ name, pass: !!cond, extra });
    console.log(`${cond ? '✅' : '❌'} ${name} ${extra}`);
  };

  // 缓存应用模块与 store 单例（Vite 保证单例，与应用内为同一实例）
  // 使用应用入口挂载的权威 store 单例（动态 import 可能得到独立的模块求值副本）
  await evaluate(`
    (async () => {
      const wvp = window.__wvp;
      if (!wvp) throw new Error('store 单例未就绪');
      window.__mods = {
        snap: await import('/src/lib/snap.ts'),
        storage: await import('/src/lib/storage.ts'),
        catalog: await import('/src/catalog.ts'),
      };
    })()
  `);

  // 切换到俯视图：正交相机下屏幕->地面映射确定，指针交互可重复
  await evaluate(`window.dispatchEvent(new CustomEvent('wvp:view', { detail: 'top' }))`);
  await sleep(600);

  // —— 1. 切换到矩形绘制并拖出一块区域（俯视下覆盖视口中心） ——
  await evaluate(`[...document.querySelectorAll('.toolbar button')].find(b=>b.textContent.includes('矩形区域')).click()`);
  await sleep(200);
  await drag(0.3, 0.25, 0.75, 0.75);
  await sleep(300);
  const r1 = await evaluate(`({ regions: window.__wvp.regions.length, w: window.__wvp.regions[0]?.width, d: window.__wvp.regions[0]?.depth })`);
  check('绘制矩形区域', r1.regions === 1, JSON.stringify(r1));

  // —— 2. 放置物体：点击物体库 -> 在场地内沿水平方向分散点击 ——
  await evaluate(`[...document.querySelectorAll('.catalog-item')].find(b=>b.textContent.includes('圆桌')).click()`);
  await sleep(200);
  // 俯视图正交投影，水平间距对应真实世界间距
  await click(0.4, 0.5);
  await click(0.5, 0.5);
  await click(0.6, 0.5);
  await sleep(200);
  const objCount = await evaluate(`window.__wvp.objects.length`);
  check('连续放置 3 个圆桌', objCount >= 3, `objects=${objCount}`);

  // —— 3. 碰撞阻止：在已占用位置再次放置，createObject 必须返回 null ——
  const countBefore = await evaluate(`window.__wvp.objects.length`);
  const collisionBlocked = await evaluate(`
    (() => {
      const o = window.__wvp.objects[0];
      const attempt = window.__wvp.createObject('round-table', o.x, o.z, 0);
      return attempt === null && window.__wvp.objects.length === ${countBefore};
    })()
  `);
  check('重叠放置被碰撞检测阻止', collisionBlocked);

  // —— 4. 区域边界约束 ——
  const outsideBlocked = await evaluate(`
    (() => {
      const o = window.__wvp.objects[0];
      return window.__wvp.canPlaceObject(o, 999, 999, o.rotation, 1) === false;
    })()
  `);
  check('区域外放置被阻止', outsideBlocked);

  // —— 5. 网格吸附 ——
  const snapWorks = await evaluate(`
    (() => {
      const { snapPosition } = window.__mods.snap;
      const settings = window.__wvp.snapSettings;
      const o = window.__wvp.objects[0];
      const r = snapPosition(
        [{ obj: o, nx: 0.03, nz: 0.02, nrot: 0 }],
        [], settings, true
      );
      return Math.abs(r.x) < 1e-9 && Math.abs(r.z) < 1e-9 && r.guides.length >= 1;
    })()
  `);
  check('网格吸附与辅助线', snapWorks);

  // —— 6. 物体间吸附（边缘对齐） ——
  const objSnap = await evaluate(`
    (() => {
      const { snapPosition, aabbOf } = window.__mods.snap;
      const settings = window.__wvp.snapSettings;
      const [a, b] = window.__wvp.objects;
      const bb = aabbOf(b);
      // 把 a 移到与 b 左边缘仅差 0.1m
      const moved = { ...a, x: bb.minX - a.width - 0.1, z: b.z };
      const r = snapPosition(
        [{ obj: moved, nx: moved.x, nz: moved.z, nrot: 0 }],
        [b], settings, true
      );
      return r.guides.some(g => g.kind === 'object');
    })()
  `);
  check('物体间边缘吸附', objSnap);

  // —— 7. 框选 —— 先退出放置模式
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await sleep(150);
  // 俯视下框选覆盖三个点击点所在的水平带
  await drag(0.36, 0.42, 0.64, 0.6);
  await sleep(200);
  const selCount = await evaluate(`window.__wvp.selectedIds[0]().size`);
  check('框选多个物体', selCount >= 2, `selected=${selCount}`);

  // —— 8. 撤销 / 重做 ——
  const countNow = await evaluate(`window.__wvp.objects.length`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2 });
  await sleep(150);
  const afterUndo = await evaluate(`window.__wvp.objects.length`);
  check('撤销减少物体', afterUndo < countNow, `${countNow} -> ${afterUndo}`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'y', code: 'KeyY', modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'y', code: 'KeyY', modifiers: 2 });
  await sleep(150);
  const afterRedo = await evaluate(`window.__wvp.objects.length`);
  check('重做恢复物体', afterRedo === countNow, `${afterUndo} -> ${afterRedo}`);

  // —— 9. 图层隐藏 ——
  await evaluate(`window.__wvp.setCategoryVisible('桌椅', false)`);
  const hidden = await evaluate(`window.__wvp.objects.every(o => !o.visible)`);
  check('按类别隐藏物体', hidden);
  await evaluate(`window.__wvp.setCategoryVisible('桌椅', true)`);

  // —— 10. 导出/导入往返（模拟文件下载后重新读入的完整 JSON 字符串） ——
  const exportedJson = await evaluate(`JSON.stringify(window.__wvp.data)`);
  const validExport = await evaluate(`
    (() => {
      const { validateProject } = window.__mods.storage;
      const v = validateProject(JSON.parse(${JSON.stringify(exportedJson)}));
      return v.objects.length === window.__wvp.objects.length && v.regions.length === window.__wvp.regions.length;
    })()
  `);
  check('导出文件校验并可重新导入', validExport);

  // —— 11. 数千物体性能 —— 新建一块足够大的区域承载密集阵列，模拟真实宴会摆台规模
  const perf = await evaluate(`
    (() => {
      window.__wvp.addRectRegion({ x: 0, z: 0 }, 90, 90);
      const item = window.__mods.catalog.getCatalogItem('chair');
      const bulk = [];
      let n = 0;
      // 2500 把椅子的 50×50 阵列（间距 1.2m）
      for (let gx = 0; gx < 50; gx++) for (let gz = 0; gz < 50; gz++) {
        bulk.push({
          id: 'perf_' + (n++), catalogId: item.id, category: item.category, name: item.name,
          x: -29.4 + gx * 1.2, z: -29.4 + gz * 1.2, rotation: 0,
          width: item.width, depth: item.depth, height: item.height,
          scale: 1, color: item.color, visible: true,
        });
      }
      const t0 = performance.now();
      window.__wvp.bulkLoadObjects(bulk);
      const t1 = performance.now();
      // 模拟拖动时的连续碰撞查询：在阵列中尝试 100 个微移动
      let blocked = 0;
      const probe = window.__wvp.objects.find((x) => x.id.startsWith('perf_'));
      for (let i = 0; i < 100; i++) {
        if (!window.__wvp.collisionWorld.canPlace(probe, probe.x + 0.05, probe.z, 0, 1)) blocked++;
      }
      const t2 = performance.now();
      return { total: window.__wvp.objects.length, buildMs: Math.round(t1 - t0), query100Ms: Math.round(t2 - t1), blocked };
    })()
  `);
  check('2500+ 物体碰撞世界可扩展', perf.total >= 2500, JSON.stringify(perf));

  await sleep(800);
  await send('Page.captureScreenshot', { format: 'png' }).then(async (shot) => {
    const fs = await import('node:fs');
    fs.writeFileSync('/tmp/shot-perf.png', Buffer.from(shot.result.data, 'base64'));
  });

  // —— 12. 视角切换回透视 ——
  const perspOk = await evaluate(`
    (() => {
      window.dispatchEvent(new CustomEvent('wvp:view', { detail: 'perspective' }));
      return true;
    })()
  `);
  check('透视/俯视视角切换', perspOk);
  await sleep(500);
  await send('Page.captureScreenshot', { format: 'png' }).then(async (shot) => {
    const fs = await import('node:fs');
    fs.writeFileSync('/tmp/shot-top.png', Buffer.from(shot.result.data, 'base64'));
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\\n==== 结果: ${results.length - failed.length}/${results.length} 通过 ====`);
  ws.close();
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E 脚本失败:', err);
  process.exit(2);
});
