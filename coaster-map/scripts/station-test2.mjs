import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('Object.keys(window.__maps.main.getStyle().sources).length === 6', null, { timeout: 30000 })
await page.waitForTimeout(2000)
const r = await page.evaluate(async () => {
  const m = window.__maps.main
  // fit 到全公园(车站在各线路起点,低缩放应可见)
  const b = window.__store.state.dataset.bounds
  m.jumpTo({ zoom: 11, center: [(b[0]+b[2])/2, (b[1]+b[3])/2] })
  await new Promise(r=>setTimeout(r,1500))
  const stations = m.queryRenderedFeatures(undefined,{layers:['main__label-station']})
  const segments = m.queryRenderedFeatures(undefined,{layers:['main__label-segment']})
  // 检查车站层可见性
  const vis = m.getLayoutProperty('main__label-station','visibility')
  return { stationCount: stations.length, segmentCount: segments.length, visibility: vis, sample: stations[0]?.properties?.text }
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
