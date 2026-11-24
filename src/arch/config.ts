import type {
  DensityConfig,
  DensityId,
  FlowerTypeConfig,
  FlowerTypeId,
  PresetId,
  ProjectState,
  Vec3Tuple
} from '../types'

export const CONTROL_POINT_COUNT = 6
export const STORAGE_KEY = 'arch-atelier-project-v1'

export const PRESET_OPTIONS: Array<{
  id: PresetId
  label: string
  english: string
  description: string
}> = [
  {
    id: 'semicircle',
    label: '半圆拱',
    english: 'Semicircle',
    description: '经典正圆弧，柔和对称'
  },
  {
    id: 'pointed',
    label: '尖拱',
    english: 'Pointed',
    description: '收紧拱顶，高挑仪式感'
  },
  {
    id: 'free',
    label: '自由曲线',
    english: 'Free curve',
    description: '不对称有机弧线，可自由塑形'
  }
]

const SEMICIRCLE: Vec3Tuple[] = [
  [-2.15, 2.25, 0],
  [-1.74, 3.51, 0],
  [-0.66, 4.30, 0],
  [0.66, 4.30, 0],
  [1.74, 3.51, 0],
  [2.15, 2.25, 0]
]

const POINTED: Vec3Tuple[] = [
  [-2.15, 2.22, 0],
  [-1.58, 3.38, 0],
  [-0.20, 4.60, 0],
  [0.20, 4.60, 0],
  [1.58, 3.38, 0],
  [2.15, 2.22, 0]
]

const FREE: Vec3Tuple[] = [
  [-2.22, 2.08, 0],
  [-1.86, 3.28, 0],
  [-0.82, 3.82, 0],
  [0.18, 4.42, 0],
  [1.34, 3.92, 0],
  [2.28, 2.42, 0]
]

export function getPresetPoints(id: PresetId): Vec3Tuple[] {
  const source = id === 'semicircle' ? SEMICIRCLE : id === 'pointed' ? POINTED : FREE
  return source.map(([x, y, z]) => [x, y, z])
}

export const DENSITY_OPTIONS: DensityConfig[] = [
  {
    id: 'airy',
    label: '轻盈',
    caption: '低密度 · 留白透气',
    spacing: 0.46,
    perNode: 2,
    minDistance: 0.17
  },
  {
    id: 'balanced',
    label: '标准',
    caption: '中密度 · 均衡饱满',
    spacing: 0.30,
    perNode: 4,
    minDistance: 0.135
  },
  {
    id: 'lush',
    label: '繁密',
    caption: '高密度 · 花团锦簇',
    spacing: 0.20,
    perNode: 7,
    minDistance: 0.105
  }
]

export const FLOWER_OPTIONS: FlowerTypeConfig[] = [
  {
    id: 'rose',
    label: '玫瑰',
    english: 'Rose',
    color: '#d62855',
    clusterRadius: 0.17,
    minDistance: 0.115
  },
  {
    id: 'peony',
    label: '芍药',
    english: 'Peony',
    color: '#f49ab5',
    clusterRadius: 0.21,
    minDistance: 0.145
  },
  {
    id: 'eucalyptus',
    label: '尤加利叶',
    english: 'Eucalyptus',
    color: '#6f9f73',
    clusterRadius: 0.24,
    minDistance: 0.12
  },
  {
    id: 'wildflower',
    label: '小野花',
    english: 'Wildflower',
    color: '#efb84a',
    clusterRadius: 0.19,
    minDistance: 0.095
  }
]

export function getDensity(id: DensityId): DensityConfig {
  return DENSITY_OPTIONS.find((item) => item.id === id) ?? DENSITY_OPTIONS[1]
}

export function getFlowerType(id: FlowerTypeId): FlowerTypeConfig {
  return FLOWER_OPTIONS.find((item) => item.id === id) ?? FLOWER_OPTIONS[0]
}

export function createDefaultState(): ProjectState {
  return {
    version: 1,
    preset: 'semicircle',
    controlPoints: getPresetPoints('semicircle'),
    density: 'balanced',
    flowerType: 'rose',
    flowerScale: 1,
    mode: 'uniform',
    jitterRange: 0.18,
    seed: 20261125
  }
}
