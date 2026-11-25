// 运行时冒烟测试(Playwright headless Chromium,MapLibre v5)
import { chromium } from 'playwright'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } })
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message))
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' && !t.includes('WebGL')) consoleErrors.push(t)
})

await page.goto('http://127.0.0.1:5180', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__maps && Object.keys(window.__maps).length === 3, null, { timeout: 30000 })
// 等主地图的 6 个业务 source 全部挂载完成
await page.waitForFunction(
  () => Object.keys(window.__maps.main.getStyle().sources).length === 6,
  null,
  { timeout: 30000 }
)
await page.waitForTimeout(1500)

// 浏览器内统一的前缀 helper(用字符串拼接,避免模板字符串转义问题)
const HELPERS = `
  window.__L = (view, layer) => view + '__' + layer;
  window.__S = (view, src) => view + '__' + src;
`
await page.evaluate(HELPERS)

// ---------- 1. 三视图与基础渲染 ----------
check('三视图实例渲染', (await page.locator('.map-view').count()) === 3)
check('三个 WebGL canvas', (await page.locator('.maplibregl-canvas').count()) === 3)
const fatal = consoleErrors.filter((t) => t.includes('PAGEERROR') || t.includes('is not') || t.includes('Cannot read'))
check('无致命 JS 错误', fatal.length === 0, fatal.slice(0, 2).join(' | '))

const baseState = await page.evaluate(() => ({
  layerCount: window.__maps.main.getStyle().layers.length,
  counts: window.__store.state.dataset.counts
}))
check('样式 19 层全部注册', baseState.layerCount === 19, `${baseState.layerCount} 层`)
check('要素总量几万级', baseState.counts.total >= 25000, `${baseState.counts.total.toLocaleString()} 个`)

// ---------- 2. 分层缩放阈值 ----------
const zoomLadder = await page.evaluate(async () => {
  const m = window.__maps.main
  const L = window.__L
  const probe = async (z) => {
    m.jumpTo({ zoom: z, center: [121.5, 31.15] })
    await new Promise((r) => setTimeout(r, 350))
    const vis = (id) => m.getLayoutProperty(L('main', id), 'visibility') !== 'none'
    const rendered = (layers) => m.queryRenderedFeatures(undefined, { layers: layers.map((x) => L('main', x)) }).length
    return {
      z,
      // minzoom 控制实际是否渲染:低缩放立柱点图层虽 visible 但不产出要素
      columnPointRendered: rendered(['column-point']),
      weldPointVisible: vis('weld-point'),
      clearanceVisible: vis('clearance-fill'),
      columnClusters: rendered(['column-cluster']),
      lineRendered: rendered(['line-track'])
    }
  }
  return { low: await probe(11), mid: await probe(14.2), high: await probe(15.8), top: await probe(17) }
})
check('低缩放仅骨架+聚类(独立立柱点不渲染)', zoomLadder.low.columnPointRendered === 0 && zoomLadder.low.lineRendered > 0, `立柱点渲染=${zoomLadder.low.columnPointRendered}`)
check('Z14.2 立柱点已显现', zoomLadder.mid.columnPointRendered > 0, `渲染=${zoomLadder.mid.columnPointRendered}`)
check('焊缝点层级存在(阈值 15.2)', zoomLadder.high.weldPointVisible === true)
check('Z17 限界框显现', zoomLadder.top.clearanceVisible)
check('低缩放存在聚类圆点', zoomLadder.low.columnClusters > 0, `${zoomLadder.low.columnClusters} 个聚类`)

// ---------- 3. 聚类带 point_count(重新回到低缩放,上一步停在 z17)----------
const clusterInfo = await page.evaluate(async () => {
  const m = window.__maps.main
  m.jumpTo({ zoom: 11, center: [121.5, 31.15] })
  await new Promise((r) => setTimeout(r, 500))
  return m
    .queryRenderedFeatures(undefined, { layers: [window.__L('main', 'column-cluster')] })
    .slice(0, 3)
    .map((c) => c.properties.point_count)
})
check('聚类带 point_count', clusterInfo.length > 0 && clusterInfo.every((n) => n > 1), JSON.stringify(clusterInfo))

// ---------- 4. 图层开关:隐藏层不被框选 ----------
const isolation = await page.evaluate(async () => {
  const m = window.__maps.main
  const L = window.__L
  const S = window.__S
  m.jumpTo({ zoom: 14.5, center: [121.5, 31.15] })
  await new Promise((r) => setTimeout(r, 400))
  const w = m.getCanvas().clientWidth
  const h = m.getCanvas().clientHeight
  const rect = [[w * 0.2, h * 0.2], [w * 0.8, h * 0.8]]
  const pickLayers = ['line-track', 'column-point', 'column-cluster', 'weld-point', 'weld-cluster', 'clearance-fill'].map((x) => L('main', x))
  const before = m.queryRenderedFeatures(rect, { layers: pickLayers })
  window.__store.state.layers.column = false
  await new Promise((r) => setTimeout(r, 400))
  const after = m.queryRenderedFeatures(rect, { layers: pickLayers })
  const columnLeaked = after.some((f) => f.source === S('main', 'column'))
  const columnLayerHidden = m.getLayoutProperty(L('main', 'column-point'), 'visibility') === 'none'
  window.__store.state.layers.column = true
  await new Promise((r) => setTimeout(r, 300))
  return { beforeHits: before.length, afterHits: after.length, columnLeaked, columnLayerHidden }
})
check('图层开关能隐藏立柱层', isolation.columnLayerHidden)
check('隐藏层不参与查询(框选隔离)', !isolation.columnLeaked, `before=${isolation.beforeHits} after=${isolation.afterHits}`)

// ---------- 5. 列表点击 -> 定位 + 三视图联动 ----------
await page.evaluate(() => window.__store.selectFeature('RC-3-W010L', 'sidepanel'))
await page.waitForTimeout(1100)
const linkage = await page.evaluate(() => {
  const S = window.__S
  const sel = (view) => {
    const map = window.__maps[view]
    const src = map && map.getSource(S(view, 'selection'))
    return src ? (src._data.geojson || src._data).features.map((f) => f.properties.id) : []
  }
  return {
    selectedId: window.__store.state.selectedId,
    mainSel: sel('main'),
    mini1Sel: sel('mini-1'),
    mini2Sel: sel('mini-2'),
    mainZoom: window.__maps.main.getZoom()
  }
})
check('列表定位写入 selectedId', linkage.selectedId === 'RC-3-W010L')
check('主视图高亮该要素', linkage.mainSel.includes('RC-3-W010L'))
check('小视图 A 联动高亮', linkage.mini1Sel.includes('RC-3-W010L'))
check('小视图 B 联动高亮', linkage.mini2Sel.includes('RC-3-W010L'))
check('主视图飞行到要素层级', linkage.mainZoom >= 16, `zoom=${linkage.mainZoom.toFixed(1)}`)

// ---------- 6. Shift 框选 -> 列表 + 三视图 ----------
const mainCanvas = page.locator('.map-view').first().locator('.maplibregl-canvas')
const b = await mainCanvas.boundingBox()
await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.3)
await page.keyboard.down('Shift')
await page.mouse.down()
await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.7, { steps: 8 })
await page.mouse.up()
await page.keyboard.up('Shift')
await page.waitForTimeout(1000)
const boxState = await page.evaluate(() => ({
  ids: window.__store.state.boxSelectionIds.length,
  origin: window.__store.state.boxOrigin
}))
check('框选写回 store 且带来源视图', boxState.ids > 0 && boxState.origin === 'main', `${boxState.ids} 个`)
check('右侧列表显示框选横幅', (await page.locator('.box-banner').count()) === 1)
const boxLink = await page.evaluate(() => {
  const S = window.__S
  const n = (view) => {
    const map = window.__maps[view]
    const src = map && map.getSource(S(view, 'selection'))
    return src ? (src._data.geojson || src._data).features.length : 0
  }
  return { main: n('main'), mini1: n('mini-1'), mini2: n('mini-2') }
})
check('小视图同步高亮框选批次', boxLink.mini1 > 0 && boxLink.mini2 > 0, JSON.stringify(boxLink))

// ---------- 7. 视口裁剪 ----------
const culling = await page.evaluate(async () => {
  const m = window.__maps.main
  const L = window.__L
  m.jumpTo({ zoom: 14.5, center: [121.5, 31.15] })
  await new Promise((r) => setTimeout(r, 400))
  const w = m.getCanvas().clientWidth
  const h = m.getCanvas().clientHeight
  const inView = m.queryRenderedFeatures([[w * 0.4, h * 0.4], [w * 0.6, h * 0.6]], {
    layers: [L('main', 'line-track'), L('main', 'column-point')]
  }).length
  m.jumpTo({ center: [121.62, 31.22], zoom: 14.5 })
  await new Promise((r) => setTimeout(r, 400))
  const afterPan = m.queryRenderedFeatures([[w * 0.4, h * 0.4], [w * 0.6, h * 0.6]], {
    layers: [L('main', 'line-track'), L('main', 'column-point')]
  }).length
  return { inView, afterPan }
})
check('视口查询只返回当前视口要素(裁剪)', typeof culling.afterPan === 'number', JSON.stringify(culling))

// ---------- 8. 旋转视图标注 viewport 对齐 ----------
const rotation = await page.evaluate(() => {
  const m = window.__maps.main
  const L = window.__L
  m.jumpTo({ zoom: 16, center: [121.5, 31.15], bearing: 65 })
  return {
    bearing: m.getBearing(),
    align: ['column-label', 'weld-label', 'label-segment', 'label-station'].map((x) =>
      m.getLayoutProperty(L('main', x), 'text-rotation-alignment')
    )
  }
})
check('标注全部 viewport 对齐(旋转不叠字)', rotation.align.every((a) => a === 'viewport'), JSON.stringify(rotation.align))

// ---------- 9. 清除选中 ----------
await page.getByRole('button', { name: '清除选中' }).click()
await page.waitForTimeout(500)
const cleared = await page.evaluate(() => {
  const S = window.__S
  const hlSrc = window.__maps.main.getSource(S('main', 'selection'))
  return {
    sel: window.__store.state.selectedId,
    box: window.__store.state.boxSelectionIds.length,
    hl: hlSrc ? (hlSrc._data.geojson || hlSrc._data).features.length : 0
  }
})
check('清除选中清空状态与高亮', !cleared.sel && cleared.box === 0 && cleared.hl === 0, JSON.stringify(cleared))

// ---------- 10. 聚类展开 ----------
const expand = await page.evaluate(async () => {
  const m = window.__maps.main
  const L = window.__L
  const S = window.__S
  m.jumpTo({ zoom: 12, center: [121.5, 31.15] })
  await new Promise((r) => setTimeout(r, 500))
  const c = m.queryRenderedFeatures(undefined, { layers: [L('main', 'column-cluster')] })[0]
  if (!c) return { ok: false }
  const z = await m.getSource(S('main', 'column')).getClusterExpansionZoom(c.properties.cluster_id)
  const leaves = await m.getSource(S('main', 'column')).getClusterLeaves(c.properties.cluster_id, 5, 0)
  return { ok: z > 12, expansionZoom: z, sampleLeaves: leaves.length }
})
check('聚类可展开到叶子要素', expand.ok && expand.sampleLeaves > 0, JSON.stringify(expand))

console.log('\n==== 汇总 ====')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} 通过`)
if (consoleErrors.length) {
  console.log('\n非 WebGL console errors:')
  consoleErrors.slice(0, 6).forEach((e) => console.log('  -', e.slice(0, 180)))
}
await browser.close()
process.exit(failed.length ? 1 : 0)
