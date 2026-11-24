import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9333;
const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:4175/';
const profileDir = path.join(tmpdir(), 'rros-smoke-chrome-profile');
await mkdir('.smoke', { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1600,1000',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

chrome.stderr.on('data', (chunk) => process.stderr.write(`[chrome] ${chunk}`));

function fail(message) {
  console.error(message);
  chrome.kill();
  process.exit(1);
}

async function getJson(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json();
}

let version;
for (let i = 0; i < 50; i++) {
  try {
    version = await getJson('/json/version');
    break;
  } catch {
    await sleep(200);
  }
}
if (!version) fail('Chrome DevTools did not start');

const pages = await getJson('/json/list');
const page = pages.find((target) => target.type === 'page');
if (!page?.webSocketDebuggerUrl) fail('No CDP page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(`console.error: ${message.params.args.map((a) => a.description ?? a.value ?? '').join(' ')}`);
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    errors.push(`log: ${message.params.entry.text}`);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function shot(name) {
  const data = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`.smoke/${name}.png`, Buffer.from(data.data, 'base64'));
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });

let engineText = '';
for (let i = 0; i < 80; i++) {
  await sleep(250);
  engineText = await evaluate(`document.querySelector('.engine-pill')?.textContent?.trim() ?? ''`);
  if (engineText.includes('Manifold 就绪') || engineText.includes('异常')) break;
}

const appPresent = await evaluate(`Boolean(document.querySelector('.app-shell'))`);
const canvasInfo = await evaluate(`(() => { const c=document.querySelector('canvas'); return c ? {w:c.width,h:c.height,cls:c.className} : null; })()`);
const initialStatus = await evaluate(`document.querySelector('.statusbar')?.textContent?.replaceAll(/\\s+/g,' ').trim()`);
await shot('01-initial');

await evaluate(`document.querySelector('.library-card')?.click()`);
await sleep(500);
const afterAddStatus = await evaluate(`document.querySelector('.statusbar')?.textContent?.replaceAll(/\\s+/g,' ').trim()`);

const dragDropResult = await evaluate(`(() => {
  const viewport = document.querySelector('.viewport');
  const rect = document.querySelector('canvas').getBoundingClientRect();
  const dt = new DataTransfer();
  dt.setData('application/x-river-library', 'buoy-yellow');
  const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.left + rect.width * 0.52, clientY: rect.top + rect.height * 0.48 };
  viewport.dispatchEvent(new DragEvent('dragover', init));
  viewport.dispatchEvent(new DragEvent('drop', init));
  return document.querySelector('.statusbar')?.textContent?.match(/障碍\\s*(\\d+)/)?.[1] ?? null;
})()`);
await sleep(500);
const afterDropStatus = await evaluate(`document.querySelector('.statusbar')?.textContent?.replaceAll(/\\s+/g,' ').trim()`);
await shot('02-after-add');

await evaluate(`[...document.querySelectorAll('.rail-button')].find(b => b.textContent.includes('碰撞检测'))?.click()`);
await sleep(1200);
const collisionStats = await evaluate(`[...document.querySelectorAll('.stat-value')].slice(0,4).map(e=>e.textContent.trim())`);
await shot('03-collision');

await evaluate(`[...document.querySelectorAll('.rail-button')].find(b => b.textContent.includes('摆放变换'))?.click()`);
await sleep(300);
const beforeBatch = await evaluate(`document.querySelector('.statusbar')?.textContent?.replaceAll(/\\s+/g,' ').trim()`);
await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('从选中浮标生成'))?.click()`);
await sleep(900);
const afterBatch = await evaluate(`document.querySelector('.statusbar')?.textContent?.replaceAll(/\\s+/g,' ').trim()`);
await shot('04-batch');
await evaluate(`[...document.querySelectorAll('.top-actions button')].find(b => b.textContent.includes('撤销'))?.click()`);
await sleep(500);
const afterUndoBatch = await evaluate(`document.querySelector('.statusbar')?.textContent?.replaceAll(/\\s+/g,' ').trim()`);

await evaluate(`[...document.querySelectorAll('.rail-button')].find(b => b.textContent.includes('方案导出'))?.click()`);
await sleep(300);
const exportLength = await evaluate(`document.querySelector('.export-code')?.value?.length ?? 0`);
await shot('05-export');

console.log(JSON.stringify({ appPresent, canvasInfo, engineText, initialStatus, afterAddStatus, dragDropResult, afterDropStatus, collisionStats, beforeBatch, afterBatch, afterUndoBatch, exportLength, errors }, null, 2));

ws.close();
chrome.kill();
if (errors.some((error) => !error.includes('favicon') && !error.includes('WebGL'))) process.exit(2);
