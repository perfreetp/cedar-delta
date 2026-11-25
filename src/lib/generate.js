import { makeRng } from './rng.js'

export const ROOF_STYLES = ['flat', 'gable', 'pyramid', 'spire', 'terrace']
export const ROOF_LABELS = {
  flat: '平顶',
  gable: '人字坡',
  pyramid: '四坡顶',
  spire: '尖塔',
  terrace: '露台'
}

// 街景常量(米)
export const ROAD_HALF = 4 // 道路半宽
export const WALK_Z = 5.5 // 人行道中心
export const FRONT_Z = 7 // 建筑临街面
export const LAMP_Z = 5.2 // 路灯距中线
export const TREE_Z = 6.3 // 行道树距中线

/**
 * 纯函数:由参数 + 手改覆盖计算出整张街景。
 * 同一 (params, overrides) 输入永远得到同一输出。
 *
 * overrides = {
 *   buildings: { [id]: { height?, roof?, windows?: {cols, rows} } },
 *   lamps:     { [id]: { x } }
 * }
 */
export function computeScene(params, overrides) {
  const { seed, length, floorHeight, density } = params
  const half = length / 2
  const buildings = []
  const lamps = []
  const trees = []

  // ---- 楼栋:沿街两侧按槽位排布,槽位索引即楼 id,长度变化时前面的楼 id 稳定 ----
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'L' : 'R'
    let x = -half
    let idx = 0
    while (x < half - 6) {
      const rng = makeRng(`${seed}:b:${sideName}:${idx}`)
      const width = 8 + rng() * 6
      const gap = (6 - density * 4.5) + rng() * 2 // 密度越高间距越小
      if (x + width > half) break
      const id = `${sideName}${idx}`
      const filled = rng() < 0.35 + density * 0.65 // 密度决定槽位是否建楼
      if (filled) {
        const genHeight = 9 + rng() * 27
        const genRoof = ROOF_STYLES[Math.floor(rng() * ROOF_STYLES.length)]
        const genCols = 3 + Math.floor(rng() * 4)
        const depth = 8 + rng() * 4
        const hue = rng()
        const ov = (overrides.buildings && overrides.buildings[id]) || {}
        // 字段级覆盖:手改过的字段保持,其余按种子重新生成
        const height = ov.height ?? genHeight
        const roof = ov.roof ?? genRoof
        // 窗户行数依赖层高;只有手动改过窗户排布才不被覆盖
        const cols = ov.windows?.cols ?? genCols
        const rows = ov.windows?.rows ?? Math.max(1, Math.round(height / floorHeight))
        buildings.push({
          id, side,
          x: x + width / 2,
          z: side * (FRONT_Z + depth / 2),
          width, depth, height, roof, cols, rows, hue,
          manual: Object.keys(ov).length > 0,
          manualFields: Object.keys(ov)
        })
      } else {
        // 空地:按种子放几棵树
        const n = 1 + Math.floor(rng() * 2)
        for (let t = 0; t < n; t++) {
          trees.push({
            id: `${id}-lot${t}`,
            x: x + 2 + rng() * (width - 4),
            z: side * (FRONT_Z + 2 + rng() * 4),
            s: 0.8 + rng() * 0.6
          })
        }
      }
      x += width + gap
      idx++
    }
  }

  // ---- 路灯:两侧对齐摆放,间距由密度决定;手拖过的灯保留 x ----
  const lampSpacing = 22 - density * 14
  let li = 0
  for (let x = -half + lampSpacing / 2; x < half; x += lampSpacing) {
    for (const side of [-1, 1]) {
      const id = `${side < 0 ? 'L' : 'R'}${li}`
      const ov = overrides.lamps && overrides.lamps[id]
      lamps.push({ id, side, x: ov?.x ?? x, z: side * LAMP_Z, manual: !!ov })
    }
    li++
  }

  // ---- 行道树:密度越高越密 ----
  const treeSpacing = 14 - density * 8
  let ti = 0
  for (let x = -half + treeSpacing / 2; x < half; x += treeSpacing) {
    const rng = makeRng(`${seed}:t:${ti}`)
    for (const side of [-1, 1]) {
      if (rng() < 0.4 + density * 0.5) {
        trees.push({
          id: `T${side < 0 ? 'L' : 'R'}${ti}`,
          x: x + (rng() - 0.5) * 3,
          z: side * TREE_Z,
          s: 0.7 + rng() * 0.7
        })
      }
    }
    ti++
  }

  return { seed, length, floorHeight, density, buildings, lamps, trees }
}
