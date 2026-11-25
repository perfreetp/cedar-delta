import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
const reqs = []
page.on('request', r => reqs.push(r.url().replace('http://127.0.0.1:5180','').slice(0,80)))
page.on('response', r => { if (r.status() >= 400) reqs.push('HTTP' + r.status() + ' ' + r.url().slice(0,80)) })
await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('Object.keys(window.__maps.main.getStyle().sources).length === 6', null, { timeout: 30000 })
await page.waitForTimeout(3000)
const pbf = reqs.filter(x => x.includes('pbf') || x.includes('glyph'))
console.log('pbf/glyph traffic:')
pbf.forEach(x => console.log(' ', x))
console.log('total requests:', reqs.length)
await browser.close()
