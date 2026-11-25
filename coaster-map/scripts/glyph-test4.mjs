import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
const reqs = []
page.on('request', r => { if (r.url().includes('.pbf')) reqs.push(r.url().replace('http://127.0.0.1:5180','')) })
page.on('response', r => { if (r.url().includes('.pbf')) reqs.push('  ->' + r.status() + ' ct=' + r.headers()['content-type']) })
await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('Object.keys(window.__maps.main.getStyle().sources).length === 6', null, { timeout: 30000 })
await page.waitForTimeout(4000)
console.log('PBF requests:')
reqs.forEach(x => console.log(' ', x))
// 直接 fetch 测试
const direct = await page.evaluate(async () => {
  const res = await fetch('/glyphs/Klokantech%20Noto%20Sans%20CJK%20Regular/0-255.pbf')
  const buf = await res.arrayBuffer()
  return { status: res.status, bytes: buf.byteLength, contentType: res.headers.get('content-type') }
})
console.log('direct fetch:', JSON.stringify(direct))
await browser.close()
