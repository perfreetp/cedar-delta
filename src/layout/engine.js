// 应急演练布点的纯逻辑引擎：参数、约束校验、自动排布、弹回搜索。

export const TYPE_ORDER = ['tent', 'assembly', 'supply', 'stake']
export const SOLVE_ORDER = ['tent', 'supply', 'assembly', 'stake']

export const TYPE_CONFIG = {
  tent: {
    label: '帐篷',
    plural: '帐篷',
    zone: '帐篷区',
    unit: '顶',
    color: '#f97316',
    soft: '#ffedd5',
    size: { w: 3.6, d: 2.4 },
    gap: 2.0,
    tiers: [4, 6, 9, 12, 16]
  },
  assembly: {
    label: '集结点',
    plural: '集结点',
    zone: '集结区',
    unit: '处',
    color: '#16a34a',
    soft: '#dcfce7',
    size: { w: 4.6, d: 4.6 },
    gap: 3.0,
    tiers: [1, 2, 2, 3, 4]
  },
  supply: {
    label: '物资堆放区',
    plural: '物资区',
    zone: '物资堆放区',
    unit: '区',
    color: '#2563eb',
    soft: '#dbeafe',
    size: { w: 3.8, d: 2.7 },
    gap: 2.0,
    tiers: [2, 3, 4, 6, 8]
  },
  stake: {
    label: '警戒桩',
    plural: '警戒桩',
    zone: '警戒区',
    unit: '根',
    color: '#dc2626',
    soft: '#fee2e2',
    size: { w: 0.55, d: 0.55 },
    gap: 2.0,
    tiers: [8, 12, 18, 26, 36]
  }
}

export const TIER_LABELS = ['1档 · 少量', '2档 · 较少', '3档 · 标准', '4档 · 较多', '5档 · 密集']

export function defaultParams() {
  return {
    length: 72,
    width: 45,
    orientation: 'length', // length = 沿场地长轴；width = 沿短轴
    passageWidth: 4,
    tiers: { tent: 3, assembly: 3, supply: 3, stake: 3 }
  }
}

export function normalizeParams(input = {}) {
  const base = defaultParams()
  const tiers = { ...base.tiers, ...(input.tiers || {}) }
  return {
    length: clampNumber(input.length ?? base.length, 30, 220),
    width: clampNumber(input.width ?? base.width, 20, 160),
    orientation: input.orientation === 'width' ? 'width' : 'length',
    passageWidth: clampNumber(input.passageWidth ?? base.passageWidth, 3, 10),
    tiers: {
      tent: clampTier(tiers.tent),
      assembly: clampTier(tiers.assembly),
      supply: clampTier(tiers.supply),
      stake: clampTier(tiers.stake)
    }
  }
}

export function clampNumber(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function clampTier(v) {
  const n = Math.round(Number(v) || 3)
  return Math.min(5, Math.max(1, n))
}

export function countFor(type, tier) {
  const t = clampTier(tier)
  return TYPE_CONFIG[type].tiers[t - 1]
}

export function randomSeed() {
  return Math.floor(100000 + Math.random() * 900000)
}

export function mulberry32(seed) {
  let a = Number(seed) >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeObject(type, index, patch = {}) {
  const cfg = TYPE_CONFIG[type]
  return {
    id: patch.id || `${type}-${index}`,
    type,
    index,
    label: patch.label || `${cfg.label} ${String(index).padStart(2, '0')}`,
    x: 0,
    z: 0,
    rotation: 0,
    scale: 1,
    auto: { x: 0, z: 0, rotation: 0, scale: 1 },
    positionManual: false,
    rotationManual: false,
    scaleManual: false,
    ...patch
  }
}

export function cloneObjects(objects) {
  return JSON.parse(JSON.stringify(objects || []))
}

export function isManual(o) {
  return !!(o && (o.positionManual || o.rotationManual || o.scaleManual))
}

export function manualFields(o) {
  const fields = []
  if (o.positionManual) fields.push('位置')
  if (o.rotationManual) fields.push('旋转')
  if (o.scaleManual) fields.push('尺寸')
  return fields
}

export function normalizeObject(o) {
  const cfg = TYPE_CONFIG[o.type] || TYPE_CONFIG.tent
  const index = Number(o.index) || Number(String(o.id || '').split('-')[1]) || 1
  return makeObject(o.type in TYPE_CONFIG ? o.type : 'tent', index, {
    ...o,
    label: o.label || `${cfg.label} ${String(index).padStart(2, '0')}`,
    auto: { x: 0, z: 0, rotation: 0, scale: 1, ...(o.auto || {}) }
  })
}

// ---------- 几何与约束 ----------

export function objectAABB(o) {
  const cfg = TYPE_CONFIG[o.type] || TYPE_CONFIG.tent
  const scale = Number(o.scale) || 1
  const w = cfg.size.w * scale
  const d = cfg.size.d * scale
  const r = Math.abs(Math.cos(((Number(o.rotation) || 0) * Math.PI) / 180))
  const s = Math.abs(Math.sin(((Number(o.rotation) || 0) * Math.PI) / 180))
  const aw = w * r + d * s
  const ad = w * s + d * r
  const x = Number(o.x) || 0
  const z = Number(o.z) || 0
  return { minX: x - aw / 2, maxX: x + aw / 2, minZ: z - ad / 2, maxZ: z + ad / 2 }
}

export function siteAABB(p) {
  return { minX: -p.length / 2, maxX: p.length / 2, minZ: -p.width / 2, maxZ: p.width / 2 }
}

export function passageAABB(p) {
  const pw = p.passageWidth
  if (p.orientation === 'width') {
    return { minX: -pw / 2, maxX: pw / 2, minZ: -p.width / 2, maxZ: p.width / 2 }
  }
  return { minX: -p.length / 2, maxX: p.length / 2, minZ: -pw / 2, maxZ: pw / 2 }
}

// 正值：两个包围盒之间的净距；负值：在至少一个轴上的穿透量。
export function aabbGap(a, b) {
  const sx = Math.max(a.minX - b.maxX, b.minX - a.maxX)
  const sz = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ)
  if (sx >= 0 && sz >= 0) return Math.hypot(sx, sz)
  return Math.max(sx, sz)
}

export function validatePlacement(candidate, objects, params, options = {}) {
  const crossClearance = options.crossClearance ?? 0.2
  const passageClearance = options.passageClearance ?? 0.05
  const boundaryTolerance = options.boundaryTolerance ?? 0.05
  const spacingTolerance = options.spacingTolerance ?? 0.12
  const sameGap = options.sameGap
  const reasons = []
  const box = objectAABB(candidate)
  const site = siteAABB(params)

  if (
    box.minX < site.minX - boundaryTolerance ||
    box.maxX > site.maxX + boundaryTolerance ||
    box.minZ < site.minZ - boundaryTolerance ||
    box.maxZ > site.maxZ + boundaryTolerance
  ) {
    reasons.push('超出场地边界')
  }

  const passageGap = aabbGap(box, passageAABB(params))
  if (passageGap < passageClearance) {
    reasons.push('压到主通道')
  }

  for (const other of objects || []) {
    if (!other || other.id === candidate.id) continue
    const otherBox = objectAABB(other)
    const gap = aabbGap(box, otherBox)
    if (other.type === candidate.type) {
      const required = Number.isFinite(sameGap) ? sameGap : TYPE_CONFIG[candidate.type].gap
      if (gap < required - spacingTolerance) {
        reasons.push(`${TYPE_CONFIG[candidate.type].label}间距需≥${required.toFixed(1)}m`)
      }
    } else if (gap < crossClearance) {
      reasons.push('与其他物件重叠')
    }
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] }
}

// 在落点附近搜索最近的合法网格空位；找不到时返回 null。
export function findNearestValidPosition(target, objects, params, options = {}) {
  const step = options.step || 0.5
  const strict = options.strict || {}
  const site = siteAABB(params)
  const probe = { ...target }
  const box0 = objectAABB({ ...probe, x: 0, z: 0 })
  const halfW = (box0.maxX - box0.minX) / 2
  const halfD = (box0.maxZ - box0.minZ) / 2
  const minX = site.minX + halfW + 0.05
  const maxX = site.maxX - halfW - 0.05
  const minZ = site.minZ + halfD + 0.05
  const maxZ = site.maxZ - halfD - 0.05

  let best = null
  const consider = (x, z) => {
    const candidate = { ...probe, x, z }
    const result = validatePlacement(candidate, objects, params, strict)
    if (!result.valid) return
    const distance = Math.hypot(x - (target.x || 0), z - (target.z || 0))
    if (!best || distance < best.distance - 1e-9) best = { x, z, rotation: candidate.rotation, distance }
  }

  if (target.auto && Number.isFinite(target.auto.x)) {
    consider(target.auto.x, target.auto.z)
  }
  consider(target.x || 0, target.z || 0)

  if (minX <= maxX && minZ <= maxZ) {
    const startX = Math.ceil(minX / step) * step
    const startZ = Math.ceil(minZ / step) * step
    for (let x = startX; x <= maxX + 1e-9; x += step) {
      for (let z = startZ; z <= maxZ + 1e-9; z += step) {
        consider(x, z)
      }
    }
  }
  return best
}

// ---------- 自动排布 ----------

function centeredValues(lo, hi, step) {
  if (hi < lo - 1e-9) return []
  const count = Math.max(1, Math.floor((hi - lo) / step + 1e-6) + 1)
  const span = (count - 1) * step
  const start = (lo + hi) / 2 - span / 2
  return Array.from({ length: count }, (_, i) => Number((start + i * step).toFixed(3)))
}

function anchorFor(type, p, variant) {
  const A = p.orientation === 'length' ? p.length : p.width
  const C = p.orientation === 'length' ? p.width : p.length
  const tentSide = variant < 2 ? 1 : -1
  const otherSide = -tentSide
  const supplyWest = variant % 2 === 0
  if (type === 'tent') return { a: 0, c: tentSide * C * 0.31 }
  if (type === 'supply') return { a: (supplyWest ? -0.23 : 0.23) * A, c: otherSide * C * 0.3 }
  if (type === 'assembly') return { a: (supplyWest ? 0.24 : -0.24) * A, c: otherSide * C * 0.28 }
  return { a: 0, c: 0 }
}

function mapAC(a, c, worldRotation, p) {
  if (p.orientation === 'width') return { x: c, z: a, rotation: worldRotation }
  return { x: a, z: c, rotation: worldRotation }
}

function bestStructuredPosition(slot, p, obstacles, variant) {
  const cfg = TYPE_CONFIG[slot.type]
  const gap = cfg.gap
  const A = p.orientation === 'length' ? p.length : p.width
  const C = p.orientation === 'length' ? p.width : p.length
  const edgeMargin = 1.1
  const passageBuffer = 0.75

  const rotations = slot.rotationManual
    ? [normalizeRotation(Number(slot.rotation) || 0)]
    : p.orientation === 'width'
      ? [90, 0]
      : [0, 90]

  const anchorAC = anchorFor(slot.type, p, variant)
  let best = null

  for (const worldRotation of rotations) {
    const originBox = objectAABB({ ...slot, x: 0, z: 0, rotation: worldRotation })
    const sizeX = originBox.maxX - originBox.minX
    const sizeZ = originBox.maxZ - originBox.minZ
    const alongSpan = p.orientation === 'length' ? sizeX : sizeZ
    const crossSpan = p.orientation === 'length' ? sizeZ : sizeX
    const alongHalf = alongSpan / 2
    const crossHalf = crossSpan / 2

    const alongValues = centeredValues(-A / 2 + edgeMargin + alongHalf, A / 2 - edgeMargin - alongHalf, alongSpan + gap)
    const positiveCross = centeredValues(
      p.passageWidth / 2 + passageBuffer + crossHalf,
      C / 2 - edgeMargin - crossHalf,
      crossSpan + gap
    )
    const crossValues = [...positiveCross, ...positiveCross.map((v) => -v)]

    for (const a of alongValues) {
      for (const c of crossValues) {
        const mapped = mapAC(a, c, worldRotation, p)
        const candidate = { ...slot, ...mapped }
        const valid = validatePlacement(candidate, obstacles, p, {
          crossClearance: 0.65,
          passageClearance: 0.45,
          spacingTolerance: 0.08
        }).valid
        if (!valid) continue
        const anchorWorld = mapAC(anchorAC.a, anchorAC.c, worldRotation, p)
        const score =
          Math.hypot(candidate.x - anchorWorld.x, candidate.z - anchorWorld.z) +
          (worldRotation === (p.orientation === 'width' ? 0 : 90) ? 0.35 : 0)
        if (!best || score < best.score) best = { ...mapped, score }
      }
    }
  }

  if (best) return best

  // 规整网格放不下时，以功能区锚点为中心做最近空位搜索；
  // 极小场地/极限档位下逐级放宽净距，但通道和边界始终为硬约束。
  const fallbackRotations = slot.rotationManual ? [normalizeRotation(Number(slot.rotation) || 0)] : [0, 90]
  for (const rotation of fallbackRotations) {
    const anchor = mapAC(anchorAC.a, anchorAC.c, rotation, p)
    const strictSearch = findNearestValidPosition(
      { ...slot, ...anchor },
      obstacles,
      p,
      { strict: { crossClearance: 0.35, passageClearance: 0.2 } }
    )
    if (strictSearch) return { x: strictSearch.x, z: strictSearch.z, rotation: strictSearch.rotation }

    const compactSearch = findNearestValidPosition(
      { ...slot, ...anchor },
      obstacles,
      p,
      {
        strict: {
          crossClearance: 0,
          passageClearance: 0.05,
          sameGap: Math.max(0.7, cfg.gap * 0.45),
          spacingTolerance: 0.05
        }
      }
    )
    if (compactSearch) return { x: compactSearch.x, z: compactSearch.z, rotation: compactSearch.rotation }
  }
  return null
}

export function normalizeRotation(r) {
  let n = Number(r) % 360
  if (n < 0) n += 360
  return n
}

function perimeterStakePositions(p, count) {
  const inset = 1.0
  const A = p.orientation === 'length' ? p.length : p.width
  const C = p.orientation === 'length' ? p.width : p.length
  const aEdge = A / 2 - inset
  const cEdge = C / 2 - inset
  const mouth = p.passageWidth / 2 + 0.8

  // 沿通道两端的开口不布桩；四条长边完整。
  const segments = [
    { a1: -aEdge, c1: cEdge, a2: aEdge, c2: cEdge },
    { a1: aEdge, c1: cEdge, a2: aEdge, c2: mouth },
    { a1: aEdge, c1: -mouth, a2: aEdge, c2: -cEdge },
    { a1: aEdge, c1: -cEdge, a2: -aEdge, c2: -cEdge },
    { a1: -aEdge, c1: -cEdge, a2: -aEdge, c2: -mouth },
    { a1: -aEdge, c1: mouth, a2: -aEdge, c2: cEdge }
  ].map((s) => ({ ...s, length: Math.hypot(s.a2 - s.a1, s.c2 - s.c1) }))

  const total = segments.reduce((sum, s) => sum + s.length, 0)
  const result = []
  for (let i = 0; i < count; i++) {
    let distance = ((i + 0.5) / count) * total
    let seg = segments[0]
    for (const s of segments) {
      if (distance <= s.length) {
        seg = s
        break
      }
      distance -= s.length
    }
    const t = seg.length ? distance / seg.length : 0
    const a = seg.a1 + (seg.a2 - seg.a1) * t
    const c = seg.c1 + (seg.c2 - seg.c1) * t
    result.push(mapAC(a, c, 0, p))
  }
  return result
}

export function generateLayout(input) {
  const params = normalizeParams(input.params || {})
  const seed = Math.abs(Math.floor(Number(input.seed) || 1))
  const previous = cloneObjects(input.previous || [])
  const counts = {}
  for (const type of TYPE_ORDER) counts[type] = countFor(type, params.tiers[type])

  const previousById = new Map(previous.map((o) => [o.id, normalizeObject(o)]))
  const slots = []
  const seen = new Set()

  for (const type of TYPE_ORDER) {
    for (let i = 1; i <= counts[type]; i++) {
      const id = `${type}-${i}`
      seen.add(id)
      const old = previousById.get(id)
      slots.push(old ? normalizeObject(old) : makeObject(type, i))
    }
  }

  // 所有手动调整过的旧物件都受保护；即使数量档位下调，也不删除用户成果。
  if (input.protectManual !== false) {
    for (const old of previous) {
      const obj = normalizeObject(old)
      if (!seen.has(obj.id) && isManual(obj)) {
        seen.add(obj.id)
        slots.push(obj)
      }
    }
  }

  const variant = seed % 4
  // 只有手动固定物件一开始就是障碍物；自动槽位求解后再加入，避免未求解的
  // (0,0) 默认坐标或上一轮旧坐标错误地占用候选位置。
  const obstacles = slots.filter((s) => s.positionManual)
  const unplaced = []

  for (const type of SOLVE_ORDER) {
    const typeSlots = slots.filter((s) => s.type === type).sort((a, b) => a.index - b.index)

    if (type === 'stake') {
      const ideal = perimeterStakePositions(params, typeSlots.length)
      typeSlots.forEach((slot, i) => {
        const target = ideal[i] || { x: 0, z: 0, rotation: 0 }
        let solved = null
        if (validatePlacement({ ...slot, ...target }, obstacles, params, {
          crossClearance: 0.35,
          passageClearance: 0.25
        }).valid) {
          solved = target
        } else {
          solved = findNearestValidPosition({ ...slot, ...target }, obstacles, params, {
            strict: { crossClearance: 0.35, passageClearance: 0.25 }
          })
        }
        applySolved(slot, solved, unplaced)
        if (!obstacles.includes(slot)) obstacles.push(slot)
      })
      continue
    }

    for (const slot of typeSlots) {
      const solved = bestStructuredPosition(slot, params, obstacles, variant)
      applySolved(slot, solved, unplaced)
      if (!obstacles.includes(slot)) obstacles.push(slot)
    }
  }

  const violations = slots
    .map((slot) => ({ id: slot.id, reasons: validatePlacement(slot, slots, params).reasons }))
    .filter((item) => item.reasons.length)

  return {
    params,
    seed,
    counts,
    objects: slots,
    unplaced,
    violations,
    protectedManual: slots.filter(isManual).length
  }
}

function applySolved(slot, solved, unplaced) {
  if (!solved) {
    unplaced.push(slot.id)
    slot.auto = { ...slot.auto, x: slot.x, z: slot.z, rotation: slot.rotation, scale: slot.scale }
    return
  }
  slot.auto = {
    x: solved.x,
    z: solved.z,
    rotation: solved.rotation ?? slot.auto.rotation ?? 0,
    scale: slot.auto.scale ?? 1
  }
  if (!slot.positionManual) {
    slot.x = solved.x
    slot.z = solved.z
  }
  if (!slot.rotationManual) slot.rotation = solved.rotation ?? slot.rotation
  if (!slot.scaleManual) slot.scale = slot.scale || 1
}

// 计算每类物件的包围区域，用于“场地划分”。
export function typeZone(objects, type, padding = 1.4) {
  const list = (objects || []).filter((o) => o.type === type)
  if (!list.length) return null
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const o of list) {
    const b = objectAABB(o)
    minX = Math.min(minX, b.minX)
    maxX = Math.max(maxX, b.maxX)
    minZ = Math.min(minZ, b.minZ)
    maxZ = Math.max(maxZ, b.maxZ)
  }
  return {
    type,
    minX: minX - padding,
    maxX: maxX + padding,
    minZ: minZ - padding,
    maxZ: maxZ + padding
  }
}

export function nearestSameTypePair(objects, type) {
  const list = (objects || []).filter((o) => o.type === type)
  let best = null
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const gap = aabbGap(objectAABB(list[i]), objectAABB(list[j]))
      const centerDistance = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z)
      if (!best || gap < best.gap) best = { a: list[i], b: list[j], gap, centerDistance }
    }
  }
  return best
}
