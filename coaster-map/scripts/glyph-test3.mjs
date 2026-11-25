import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('Object.keys(window.__maps.main.getStyle().sources).length === 6', null, { timeout: 30000 })
await page.waitForTimeout(2000)
const r = await page.evaluate(() => {
  const m = window.__maps.main
  const style = m.getStyle()
  return {
    glyphs: style.glyphs,
    stationLayer: m.getLayer('main__label-station')?.layout,
    stationMinzoom: m.getLayer('main__label-station')?.minzoom
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
