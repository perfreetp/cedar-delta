import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('Object.keys(window.__maps.main.getStyle().sources).length === 6', null, { timeout: 30000 })
await page.waitForTimeout(2000)
const r = await page.evaluate(async () => {
  const m = window.__maps.main
  // 检查 label source 的数据构成
  const labelFeatures = m.querySourceFeatures('main__label')
  const kinds = {}
  labelFeatures.forEach(f => { kinds[f.properties.kind] = (kinds[f.properties.kind]||0)+1 })
  // 车站标注层定义
  const layer = m.getLayer('main__label-station')
  return {
    labelSourceCount: labelFeatures.length,
    kindBreakdown: kinds,
    stationFilter: JSON.stringify(layer?.filter),
    stationMinzoom: layer?.minzoom,
    sampleKinds: [...new Set(labelFeatures.map(f=>f.properties.kind))]
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
