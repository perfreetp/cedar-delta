import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('dist');
const PORT = 5610;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function serve() {
  return http
    .createServer((req, res) => {
      const url = (req.url || '/').split('?')[0];
      const rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
      const file = path.join(ROOT, rel);
      try {
        const data = fs.readFileSync(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    })
    .listen(PORT);
}

export async function launch(opts = {}) {
  const browser = await chromium.launch({
    args: ['--force-device-scale-factor=1', '--disable-lcd-text'],
  });
  const page = await browser.newPage({
    viewport: { width: opts.width ?? 1600, height: opts.height ?? 950 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('.map-view__canvas canvas', { timeout: 30000 });
  // 等首帧与标注落位
  await page.waitForTimeout(1200);
  return { browser, page, errors };
}

export const OUT = path.resolve('verify/screens');
export function shotPath(name) {
  fs.mkdirSync(OUT, { recursive: true });
  return path.join(OUT, `${name}.png`);
}
