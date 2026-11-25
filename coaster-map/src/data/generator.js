/**
 * 过山车轨道要素合成数据生成器(离线内置,无外部数据依赖)。
 *
 * 要素类型:
 *   line       轨道中心线分段(每 200m 一段)
 *   column     立柱点(沿中心线每 ~24m 一根)
 *   weld       焊缝标记(每条钢轨每 ~36m 一道,双轨 -> 左右偏移)
 *   clearance  限界框(每 4 个中心线分段一组,含 footprint 多边形 + 高度属性)
 *   label      分段标注 / 车站标注(symbol 层)
 *
 * 坐标:线路在局部米制坐标系中生成,再以公园中心(上海经纬度)为原点
 * 用等距圆柱投影近似转回 lng/lat,小范围(数公里)内误差可忽略。
 */

const ORIGIN_LNG = 121.5
const ORIGIN_LAT = 31.15
const M_PER_DEG_LAT = 111320
const M_PER_DEG_LNG = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180)

export function localToLngLat(x, y) {
  return [ORIGIN_LNG + x / M_PER_DEG_LNG, ORIGIN_LAT + y / M_PER_DEG_LAT]
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEGMENT_LEN = 100 // 中心线分段长度 m
const COLUMN_SPACING = 5 // 立柱间距 m
const WELD_SPACING = 6 // 焊缝间距 m(单条钢轨)
const RAIL_OFFSET = 0.75 // 双轨相对中心线横向偏移 m
const CLEARANCE_GROUP = 4 // 每 4 个分段一个限界框
const CLEARANCE_HALF_WIDTH = 2.2 // 限界半宽 m
const CLEARANCE_TOP_BASE = 7.5 // 限界框高度基准 m

const ROUTE_GRID = [
  { x: -2100, y: -1700, rot: 0.15 },
  { x: 0, y: -1750, rot: 1.05 },
  { x: 2100, y: -1650, rot: -0.7 },
  { x: -2050, y: 1500, rot: 2.1 },
  { x: 100, y: 1600, rot: -2.35 },
  { x: 2150, y: 1450, rot: 0.6 },
  { x: -1050, y: -200, rot: 1.7 },
  { x: 1100, y: 150, rot: -0.25 }
]

/** 生成一条由直线 + 圆弧首尾相切组成的平面路径,并按 4m 步长采样。 */
function buildRouteSamples(rng, origin, rot) {
  const pieces = []
  let x = origin.x
  let y = origin.y
  let heading = rot
  const pieceCount = 13 + Math.floor(rng() * 4) // 13~16 个线元
  for (let i = 0; i < pieceCount; i++) {
    const turn = (rng() - 0.5) * 2.1 // 本线元起始转角
    heading += turn
    if (i % 2 === 0) {
      // 直线
      const len = 340 + rng() * 360
      pieces.push({ type: 'line', x0: x, y0: y, h0: heading, len })
      x += Math.cos(heading) * len
      y += Math.sin(heading) * len
    } else {
      // 圆弧(左转/右转)
      const radius = 80 + rng() * 200
      const sweep = (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 1.3)
      const len = Math.abs(radius * sweep) + 120
      pieces.push({ type: 'arc', x0: x, y0: y, h0: heading, radius, sweep, len })
      const nx =
        x + radius * (Math.sin(heading + sweep) - Math.sin(heading)) * Math.sign(sweep || 1)
      const ny =
        y + radius * (Math.cos(heading) - Math.cos(heading + sweep)) * Math.sign(sweep || 1)
      x = nx
      y = ny
      heading += sweep
    }
  }

  // 沿线元累计弧长采样
  const samples = []
  let cum = 0
  const STEP = 4
  for (const p of pieces) {
    const n = Math.max(1, Math.round(p.len / STEP))
    for (let k = 0; k < n; k++) {
      const d = k * STEP
      const t = d / p.radius
      let sx, sy, sh
      if (p.type === 'line') {
        sx = p.x0 + Math.cos(p.h0) * d
        sy = p.y0 + Math.sin(p.h0) * d
        sh = p.h0
      } else {
        const sgn = Math.sign(p.sweep)
        sx = p.x0 + p.radius * (Math.sin(p.h0 + t * sgn) - Math.sin(p.h0)) * sgn
        sy = p.y0 + p.radius * (Math.cos(p.h0) - Math.cos(p.h0 + t * sgn)) * sgn
        sh = p.h0 + t * sgn
      }
      samples.push({ s: cum + d, x: sx, y: sy, h: sh })
    }
    cum += p.len
  }
  // 末端点
  const last = pieces[pieces.length - 1]
  if (last.type === 'line') {
    samples.push({ s: cum, x: last.x0 + Math.cos(last.h0) * last.len, y: last.y0 + Math.sin(last.h0) * last.len, h: last.h0 })
  } else {
    const sgn = Math.sign(last.sweep)
    samples.push({
      s: cum,
      x: last.x0 + last.radius * (Math.sin(last.h0 + last.sweep) - Math.sin(last.h0)) * sgn,
      y: last.y0 + last.radius * (Math.cos(last.h0) - Math.cos(last.h0 + last.sweep)) * sgn,
      h: last.h0 + last.sweep
    })
  }
  return { samples, totalLen: cum }
}

/** 高程关键帧(占总长比例 -> 相对站台面高度 m),分段间 smoothstep 插值。 */
function elevationAt(s, totalLen, rng) {
  const keys = [
    { t: 0.0, z: 2 },
    { t: 0.12, z: 28 + rng() * 14 },
    { t: 0.26, z: 6 },
    { t: 0.4, z: 34 + rng() * 16 },
    { t: 0.55, z: 4 },
    { t: 0.7, z: 24 + rng() * 12 },
    { t: 0.86, z: 3 },
    { t: 1.0, z: 2 }
  ]
  const t = s / totalLen
  let a = keys[0]
  let b = keys[keys.length - 1]
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      a = keys[i]
      b = keys[i + 1]
      break
    }
  }
  const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)))
  const e = u * u * (3 - 2 * u)
  return a.z + (b.z - a.z) * e
}

function pointAt(samples, s) {
  if (s <= 0) return samples[0]
  const last = samples[samples.length - 1]
  if (s >= last.s) return last
  // 二分查找所在采样区间
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].s < s) lo = mid + 1
    else hi = mid
  }
  const b = samples[lo]
  const a = samples[lo - 1] || b
  const u = (s - a.s) / (b.s - a.s || 1)
  return {
    s,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    h: a.h + (b.h - a.h) * u
  }
}

function perp(h) {
  return { px: -Math.sin(h), py: Math.cos(h) }
}

function zPad(n) {
  return String(n).padStart(3, '0')
}

/** 生成全部线路并汇总成 GeoJSON 要素集合 + 列表行数据。 */
export function buildDataset() {
  const fc = {
    line: { type: 'FeatureCollection', features: [] },
    column: { type: 'FeatureCollection', features: [] },
    weld: { type: 'FeatureCollection', features: [] },
    clearance: { type: 'FeatureCollection', features: [] },
    label: { type: 'FeatureCollection', features: [] }
  }
  const rows = []
  const index = new Map()
  let bounds = null
  const routeNames = []

  const pushRow = (row) => {
    rows.push(row)
    index.set(row.id, row)
  }

  ROUTE_GRID.forEach((g, rIdx) => {
    const rng = mulberry32(20260101 + rIdx * 7919)
    const routeId = `RC-${rIdx + 1}`
    const routeName = `${['雷霆', '云鹰', '飓风', '赤焰', '星河', '惊涛', '苍龙', '流火'][rIdx]}环线`
    routeNames.push(routeName)
    const { samples, totalLen } = buildRouteSamples(rng, g, g.rot)

    // ---- 中心线分段(每 SEGMENT_LEN 一段)----
    const segCount = Math.ceil(totalLen / SEGMENT_LEN)
    for (let si = 0; si < segCount; si++) {
      const s0 = si * SEGMENT_LEN
      const s1 = Math.min(totalLen, (si + 1) * SEGMENT_LEN)
      const coords = []
      const steps = Math.max(2, Math.ceil((s1 - s0) / 8))
      for (let k = 0; k <= steps; k++) {
        const p = pointAt(samples, s0 + ((s1 - s0) * k) / steps)
        coords.push(localToLngLat(p.x, p.y))
      }
      const id = `${routeId}-S${zPad(si + 1)}`
      const mid = pointAt(samples, (s0 + s1) / 2)
      const z = elevationAt(mid.s, totalLen, rng)
      const feat = {
        type: 'Feature',
        id,
        properties: {
          id,
          kind: 'line',
          routeId,
          routeName,
          segIndex: si + 1,
          length: Math.round(s1 - s0),
          elev: Math.round(z * 10) / 10,
          label: `${routeId} S${si + 1}`,
          cx: Math.round(mid.x),
          cy: Math.round(mid.y)
        },
        geometry: { type: 'LineString', coordinates: coords }
      }
      fc.line.features.push(feat)
      pushRow({
        id,
        kind: 'line',
        kindLabel: '中心线',
        routeId,
        routeName,
        name: `分段 S${si + 1}`,
        detail: `长度 ${Math.round(s1 - s0)}m · 高程 ${feat.properties.elev}m`,
        coord: localToLngLat(mid.x, mid.y),
        zoom: 15.2
      })

      // 分段中点标注(symbol,自动避让)
      fc.label.features.push({
        type: 'Feature',
        properties: {
          id: `${id}-L`,
          kind: 'segment-label',
          text: `S${si + 1}`,
          size: 12,
          cx: Math.round(mid.x),
          cy: Math.round(mid.y)
        },
        geometry: { type: 'Point', coordinates: localToLngLat(mid.x, mid.y) }
      })
    }

    // ---- 立柱点 ----
    const colCount = Math.floor(totalLen / COLUMN_SPACING)
    for (let ci = 1; ci <= colCount; ci++) {
      const p = pointAt(samples, ci * COLUMN_SPACING)
      const z = elevationAt(p.s, totalLen, rng)
      const coord = localToLngLat(p.x, p.y)
      const id = `${routeId}-C${zPad(ci)}`
      fc.column.features.push({
        type: 'Feature',
        properties: {
          id,
          kind: 'column',
          routeId,
          routeName,
          colIndex: ci,
          height: Math.round((z + 1.5) * 10) / 10,
          elev: Math.round(z * 10) / 10,
          label: `C${ci}`,
          cx: Math.round(p.x),
          cy: Math.round(p.y)
        },
        geometry: { type: 'Point', coordinates: coord }
      })
      pushRow({
        id,
        kind: 'column',
        kindLabel: '立柱',
        routeId,
        routeName,
        name: `立柱 C${ci}`,
        detail: `柱高 ${Math.round((z + 1.5) * 10) / 10}m · 轨面高 ${Math.round(z * 10) / 10}m`,
        coord,
        zoom: 16.4
      })
    }

    // ---- 焊缝标记(双轨,左右横向偏移)----
    const weldPerRail = Math.floor(totalLen / WELD_SPACING)
    for (let wi = 1; wi <= weldPerRail; wi++) {
      const p = pointAt(samples, wi * WELD_SPACING)
      const { px, py } = perp(p.h)
      const z = elevationAt(p.s, totalLen, rng)
      for (const side of ['L', 'R']) {
        const sign = side === 'L' ? 1 : -1
        const wx = p.x + px * RAIL_OFFSET * sign
        const wy = p.y + py * RAIL_OFFSET * sign
        const coord = localToLngLat(wx, wy)
        const id = `${routeId}-W${zPad(wi)}${side}`
        fc.weld.features.push({
          type: 'Feature',
          properties: {
            id,
            kind: 'weld',
            routeId,
            routeName,
            weldIndex: wi,
            rail: side === 'L' ? '左轨' : '右轨',
            elev: Math.round(z * 10) / 10,
            label: `W${wi}${side}`,
            cx: Math.round(wx),
            cy: Math.round(wy)
          },
          geometry: { type: 'Point', coordinates: coord }
        })
        pushRow({
          id,
          kind: 'weld',
          kindLabel: '焊缝',
          routeId,
          routeName,
          name: `焊缝 W${wi}${side}`,
          detail: `${side === 'L' ? '左轨' : '右轨'} · 轨面高 ${Math.round(z * 10) / 10}m`,
          coord,
          zoom: 17.2
        })
      }
    }

    // ---- 限界框(每 CLEARANCE_GROUP 个分段一组)----
    for (let gi = 0; gi < Math.ceil(segCount / CLEARANCE_GROUP); gi++) {
      const s0 = gi * CLEARANCE_GROUP * SEGMENT_LEN
      const s1 = Math.min(totalLen, (gi + 1) * CLEARANCE_GROUP * SEGMENT_LEN)
      const ring = []
      const STEPS = 10
      const left = []
      const right = []
      for (let k = 0; k <= STEPS; k++) {
        const p = pointAt(samples, s0 + ((s1 - s0) * k) / STEPS)
        const { px, py } = perp(p.h)
        left.push(localToLngLat(p.x + px * CLEARANCE_HALF_WIDTH, p.y + py * CLEARANCE_HALF_WIDTH))
        right.push(localToLngLat(p.x - px * CLEARANCE_HALF_WIDTH, p.y - py * CLEARANCE_HALF_WIDTH))
      }
      ring.push(...left, ...right.reverse(), left[0])
      const mid = pointAt(samples, (s0 + s1) / 2)
      const zMid = elevationAt(mid.s, totalLen, rng)
      const id = `${routeId}-G${zPad(gi + 1)}`
      const coord = localToLngLat(mid.x, mid.y)
      fc.clearance.features.push({
        type: 'Feature',
        properties: {
          id,
          kind: 'clearance',
          routeId,
          routeName,
          groupIndex: gi + 1,
          base: 0,
          top: Math.round((zMid + CLEARANCE_TOP_BASE) * 10) / 10,
          elev: Math.round(zMid * 10) / 10,
          label: `限界 G${gi + 1}`,
          cx: Math.round(mid.x),
          cy: Math.round(mid.y)
        },
        geometry: { type: 'Polygon', coordinates: [ring] }
      })
      pushRow({
        id,
        kind: 'clearance',
        kindLabel: '限界框',
        routeId,
        routeName,
        name: `限界框 G${gi + 1}`,
        detail: `顶部高 ${Math.round((zMid + CLEARANCE_TOP_BASE) * 10) / 10}m · 半宽 ${CLEARANCE_HALF_WIDTH}m`,
        coord,
        zoom: 16.8
      })
    }

    // ---- 车站标注(线路起点,大字号)----
    const start = samples[0]
    fc.label.features.push({
      type: 'Feature',
      properties: {
        id: `${routeId}-STA`,
        kind: 'station-label',
        text: `${routeName} 站台`,
        size: 15,
        cx: Math.round(start.x),
        cy: Math.round(start.y)
      },
      geometry: { type: 'Point', coordinates: localToLngLat(start.x, start.y) }
    })

    // 全局范围
    for (const p of samples) {
      const c = localToLngLat(p.x, p.y)
      if (!bounds) bounds = [c[0], c[1], c[0], c[1]]
      else {
        bounds[0] = Math.min(bounds[0], c[0])
        bounds[1] = Math.min(bounds[1], c[1])
        bounds[2] = Math.max(bounds[2], c[0])
        bounds[3] = Math.max(bounds[3], c[1])
      }
    }
  })

  const counts = Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, v.features.length]))
  counts.total = rows.length
  const featureById = new Map()
  for (const coll of Object.values(fc)) {
    for (const f of coll.features) featureById.set(f.properties.id, f)
  }
  return { featureCollections: fc, rows, index, featureById, bounds, counts, routeNames }
}
