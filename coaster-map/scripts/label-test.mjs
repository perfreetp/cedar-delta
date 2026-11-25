// 验证中文标注实际渲染(截图 + 符号要素计数)
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
const warns = []
page.on('console', m => { if(m.type()==='warning'&&m.text().includes('glyph')) warns.push(m.text().slice(0,70)) })
await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('Object.keys(window.__maps.main.getStyle().sources).length === 6', null, { timeout: 30000 })
await page.waitForTimeout(2000)
const r = await page.evaluate(async () => {
  const m = window.__maps.main
  m.jumpTo({ zoom: 13, center: [121.5, 31.15] })
  await new Promise(r=>setTimeout(r,1500))
  return {
    stationLabels: m.queryRenderedFeatures(undefined,{layers:['main__label-station']}).length,
    segmentLabels: m.queryRenderedFeatures(undefined,{layers:['main__label-segment']}).length,
    sampleStation: (m.queryRenderedFeatures(undefined,{layers:['main__label-station']})[0]||{}).properties?.text
  }
})
console.log(JSON.stringify(r, null, 2))
console.log('glyph warnings:', warns.length, [...new Set(warns)].slice(0,2))
await page.screenshot({ path: 'scripts/label-shot.png' })
await browser.close()
