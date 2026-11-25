import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
const reqs = []
page.on('request', r => { if (r.url().includes('glyph')) reqs.push(r.url().replace('http://127.0.0.1:5180','')) })
page.on('response', r => { if (r.url().includes('glyph')) reqs.push('  -> ' + r.status()) })
await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('Object.keys(window.__maps.main.getStyle().sources).length === 6', null, { timeout: 30000 })
await page.waitForTimeout(3000)
console.log('glyph requests:')
;[...new Set(reqs)].slice(0, 12).forEach(x => console.log(x))
await browser.close()
