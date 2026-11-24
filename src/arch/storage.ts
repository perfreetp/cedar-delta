import { CONTROL_POINT_COUNT, createDefaultState, getPresetPoints, STORAGE_KEY } from './config'
import type { ProjectState, Vec3Tuple } from '../types'

function isTuple(value: unknown): value is Vec3Tuple {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

export function normalizeState(raw: unknown): ProjectState {
  const fallback = createDefaultState()
  if (!raw || typeof raw !== 'object') return fallback

  const candidate = raw as Partial<ProjectState>
  const preset =
    candidate.preset === 'semicircle' || candidate.preset === 'pointed' || candidate.preset === 'free'
      ? candidate.preset
      : fallback.preset

  let controlPoints = Array.isArray(candidate.controlPoints)
    ? candidate.controlPoints.filter(isTuple).map(([x, y, z]) => [x, y, z] as Vec3Tuple)
    : []

  if (controlPoints.length !== CONTROL_POINT_COUNT) {
    controlPoints = getPresetPoints(preset)
  }

  const density =
    candidate.density === 'airy' || candidate.density === 'balanced' || candidate.density === 'lush'
      ? candidate.density
      : fallback.density

  const flowerType =
    candidate.flowerType === 'rose' ||
    candidate.flowerType === 'peony' ||
    candidate.flowerType === 'eucalyptus' ||
    candidate.flowerType === 'wildflower'
      ? candidate.flowerType
      : fallback.flowerType

  const mode = candidate.mode === 'jitter' ? 'jitter' : 'uniform'
  const flowerScale =
    typeof candidate.flowerScale === 'number' &&
    Number.isFinite(candidate.flowerScale) &&
    candidate.flowerScale >= 0.4 &&
    candidate.flowerScale <= 2.4
      ? candidate.flowerScale
      : fallback.flowerScale
  const jitterRange =
    typeof candidate.jitterRange === 'number' &&
    Number.isFinite(candidate.jitterRange) &&
    candidate.jitterRange >= 0 &&
    candidate.jitterRange <= 1
      ? candidate.jitterRange
      : fallback.jitterRange
  const seed =
    typeof candidate.seed === 'number' && Number.isFinite(candidate.seed)
      ? Math.floor(candidate.seed)
      : fallback.seed

  return {
    version: 1,
    preset,
    controlPoints,
    density,
    flowerType,
    flowerScale,
    mode,
    jitterRange,
    seed
  }
}

export function loadState(): ProjectState {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    if (!text) return createDefaultState()
    return normalizeState(JSON.parse(text))
  } catch (error) {
    console.warn('无法读取本地项目，已使用默认花门。', error)
    return createDefaultState()
  }
}

let saveTimer: number | undefined

export function saveState(state: ProjectState): Promise<void> {
  window.clearTimeout(saveTimer)
  return new Promise((resolve) => {
    saveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch (error) {
        console.warn('项目自动保存失败。', error)
      } finally {
        resolve()
      }
    }, 180)
  })
}

export function saveStateNow(state: ProjectState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('项目保存失败。', error)
  }
}
