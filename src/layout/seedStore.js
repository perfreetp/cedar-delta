// 种子快照：同一个种子始终恢复该次生成的完整参数、物件和手动调整状态。

const STORAGE_KEY = 'emergency-drill-layout-seed-snapshots-v1'
const memoryStore = new Map()

function readStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeStorage(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 隐私模式或容量受限时使用内存快照，当前会话内仍可复现。
  }
}

export function saveSeedSnapshot(seed, snapshot) {
  const key = String(seed)
  const record = {
    ...snapshot,
    seed: Number(seed),
    savedAt: new Date().toISOString()
  }
  memoryStore.set(key, record)
  const all = readStorage()
  all[key] = record
  writeStorage(all)
  return record
}

export function loadSeedSnapshot(seed) {
  const key = String(seed)
  if (memoryStore.has(key)) return memoryStore.get(key)
  const all = readStorage()
  const record = all[key] || null
  if (record) memoryStore.set(key, record)
  return record
}

export function hasSeedSnapshot(seed) {
  return !!loadSeedSnapshot(seed)
}

export function createUniqueSeed(preferred) {
  let seed = Number.isFinite(Number(preferred)) ? Math.abs(Math.floor(Number(preferred))) : randomSixDigit()
  if (!seed) seed = randomSixDigit()
  let guard = 0
  while (hasSeedSnapshot(seed) && guard < 10000) {
    seed = randomSixDigit()
    guard++
  }
  return seed
}

function randomSixDigit() {
  return Math.floor(100000 + Math.random() * 900000)
}
