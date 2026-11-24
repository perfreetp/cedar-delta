/**
 * 生成演示场景并截图：透视 + 俯视
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wvp-shot-'))}`,
  `--remote-debugging-port=${PORT}`, '--window-size=1600,900',
  'http://127.0.0.1:5174/',
], { stdio: 'pipe' });

const getJson = (p) => new Promise((res, rej) => {
  http.get(`http://127.0.0.1:${PORT}${p}`, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

let target;
for (let i = 0; i < 40; i++) {
  try { target = (await getJson('/json')).find((t) => t.type === 'page'); if (target) break; } catch { /* retry */ }
  await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await once(ws, 'open');
let mid = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => {
  const id = ++mid;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => pending.set(id, r));
};
await send('Runtime.enable');
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  }
  return r.result?.result?.value;
};
await sleep(1500);

// 搭一个真实婚礼布置：宴会厅 + 圆桌阵列 + 舞台 + 花柱 + 红毯
await ev(`
  (() => {
    const w = window.__wvp;
    w.addRectRegion({ x: 0, z: 0 }, 36, 24);
    // 8 张圆桌 2x4
    for (let ix = 0; ix < 4; ix++) {
      for (let iz = 0; iz < 2; iz++) {
        w.createObject('round-table', -12 + ix * 8, -6 + iz * 9, 0);
      }
    }
    // 舞台 + 背景板 + 拱门
    w.createObject('stage', 0, 9, 0);
    w.createObject('backdrop', 0, 10.8, 0);
    w.createObject('arch', 0, 6.5, 0);
    // 红毯通道
    w.createObject('carpet', 0, -1, 0);
    // 花柱成对
    for (const z of [-8, -4, 0, 4]) {
      w.createObject('flower-column', -1.6, z, 0);
      w.createObject('flower-column', 1.6, z, 0);
    }
    // 两侧音响与自助餐台
    w.createObject('speaker', -16.5, 9, 0);
    w.createObject('speaker', 16.5, 9, 0);
    w.createObject('buffet-table', -15, -9, Math.PI / 2);
    w.createObject('buffet-table', 15, -9, Math.PI / 2);
    return w.objects.length;
  })()
`);
await sleep(800);

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const out = join(process.cwd(), name);
  writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  console.log('saved', out);
}

await shot('docs-demo-perspective.png');
await ev(`window.dispatchEvent(new CustomEvent('wvp:view', { detail: 'top' }))`);
await sleep(800);
await shot('docs-demo-top.png');
await ev(`window.dispatchEvent(new CustomEvent('wvp:view', { detail: 'perspective' }))`);
await sleep(600);

ws.close();
chrome.kill();
