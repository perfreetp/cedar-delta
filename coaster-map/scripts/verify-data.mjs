// 数据生成器冒烟测试:几何合法性 + 要素规模 + 经纬度范围
import { buildDataset, localToLngLat } from '../src/data/generator.js'

const ds = buildDataset()
console.log('counts:', ds.counts)
console.log('bounds:', ds.bounds.map((v) => v.toFixed(4)).join(', '))
console.log('rows:', ds.rows.length, 'featureById:', ds.featureById.size)

let bad = 0
const checkCoord = (c, where) => {
  if (!Array.isArray(c) || c.length < 2 || !isFinite(c[0]) || !isFinite(c[1])) {
    console.error('BAD COORD', where, c)
    bad++
  }
  if (c[0] < 120 || c[0] > 123 || c[1] < 30 || c[1] > 32) {
    console.error('OUT OF RANGE', where, c)
    bad++
  }
}

for (const [kind, fc] of Object.entries(ds.featureCollections)) {
  for (const f of fc.features) {
    if (!f.properties?.id) {
      console.error('MISSING ID', kind)
      bad++
    }
    if (f.geometry.type === 'Point') checkCoord(f.geometry.coordinates, f.properties.id)
    if (f.geometry.type === 'LineString') {
      if (f.geometry.coordinates.length < 2) {
        console.error('SHORT LINE', f.properties.id)
        bad++
      }
      f.geometry.coordinates.forEach((c) => checkCoord(c, f.properties.id))
    }
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0]
      if (ring.length < 4) {
        console.error('BAD RING', f.properties.id)
        bad++
      }
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        console.error('UNCLOSED RING', f.properties.id)
        bad++
      }
      ring.forEach((c) => checkCoord(c, f.properties.id))
    }
  }
}

// 抽样:每条线路各类要素都应存在
const kinds = new Set(ds.rows.map((r) => r.kind))
console.log('kinds present:', [...kinds].join(','))
console.log('sample row:', ds.rows[0])
console.log('localToLngLat(0,0):', localToLngLat(0, 0))
console.log(bad === 0 ? 'PASS ✅' : `FAIL ❌ (${bad} issues)`)
process.exit(bad === 0 ? 0 : 1)
