import { writable, derived, get } from 'svelte/store'
import { computeScene } from './generate.js'

const LS_CURRENT = 'street-scape:current'
const LS_SCHEMES = 'street-scape:schemes'

const DEFAULT_PARAMS = { seed: 1, length: 120, floorHeight: 3.2, density: 0.7 }
const EMPTY_OVERRIDES = () => ({ buildings: {}, lamps: {} })

export const params = writable({ ...DEFAULT_PARAMS })
export const overrides = writable(EMPTY_OVERRIDES())
export const selectedId = writable(null)

// 街景 = 参数 + 手改覆盖 的纯函数
export const sceneData = derived([params, overrides], ([$p, $o]) => computeScene($p, $o))

// ---------- 手改操作 ----------
export function setBuildingOverride(id, patch) {
  overrides.update((o) => {
    const prev = o.buildings[id] || {}
    const next = { ...prev, ...patch }
    if (patch.windows) next.windows = { ...(prev.windows || {}), ...patch.windows }
    return { ...o, buildings: { ...o.buildings, [id]: next } }
  })
}

export function clearBuildingOverride(id) {
  overrides.update((o) => {
    const buildings = { ...o.buildings }
    delete buildings[id]
    return { ...o, buildings }
  })
}

export function setLampOverride(id, x) {
  overrides.update((o) => ({ ...o, lamps: { ...o.lamps, [id]: { x } } }))
}

export function resetOverrides() {
  overrides.set(EMPTY_OVERRIDES())
}

// ---------- 本地持久化:刷新后还原当前街景 ----------
function persistCurrent() {
  try {
    localStorage.setItem(LS_CURRENT, JSON.stringify({ params: get(params), overrides: get(overrides) }))
  } catch {}
}

let restoring = true
try {
  const raw = localStorage.getItem(LS_CURRENT)
  if (raw) {
    const saved = JSON.parse(raw)
    if (saved?.params) params.set({ ...DEFAULT_PARAMS, ...saved.params })
    if (saved?.overrides) overrides.set({ ...EMPTY_OVERRIDES(), ...saved.overrides })
  }
} catch {}
restoring = false

params.subscribe(() => { if (!restoring) persistCurrent() })
overrides.subscribe(() => { if (!restoring) persistCurrent() })

// ---------- 方案管理(命名保存 / 载入 / 删除) ----------
export const schemeNames = writable([])

function readSchemes() {
  try {
    return JSON.parse(localStorage.getItem(LS_SCHEMES) || '{}')
  } catch {
    return {}
  }
}

export function refreshSchemes() {
  schemeNames.set(Object.keys(readSchemes()))
}

export function saveScheme(name) {
  const all = readSchemes()
  all[name] = {
    params: JSON.parse(JSON.stringify(get(params))),
    overrides: JSON.parse(JSON.stringify(get(overrides))),
    savedAt: new Date().toISOString()
  }
  localStorage.setItem(LS_SCHEMES, JSON.stringify(all))
  refreshSchemes()
}

export function loadScheme(name) {
  const s = readSchemes()[name]
  if (!s) return false
  params.set({ ...DEFAULT_PARAMS, ...s.params })
  overrides.set({ ...EMPTY_OVERRIDES(), ...s.overrides })
  selectedId.set(null)
  return true
}

export function deleteScheme(name) {
  const all = readSchemes()
  delete all[name]
  localStorage.setItem(LS_SCHEMES, JSON.stringify(all))
  refreshSchemes()
}
