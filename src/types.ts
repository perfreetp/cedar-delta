export type Vec3Tuple = [number, number, number]

export type PresetId = 'semicircle' | 'pointed' | 'free'
export type DensityId = 'airy' | 'balanced' | 'lush'
export type FlowerTypeId = 'rose' | 'peony' | 'eucalyptus' | 'wildflower'
export type DistributionMode = 'uniform' | 'jitter'

export interface ProjectState {
  version: 1
  preset: PresetId
  controlPoints: Vec3Tuple[]
  density: DensityId
  flowerType: FlowerTypeId
  flowerScale: number
  mode: DistributionMode
  jitterRange: number
  seed: number
}

export interface DensityConfig {
  id: DensityId
  label: string
  caption: string
  spacing: number
  perNode: number
  minDistance: number
}

export interface FlowerTypeConfig {
  id: FlowerTypeId
  label: string
  english: string
  color: string
  clusterRadius: number
  minDistance: number
}

export interface FlowerInstance {
  position: Vec3Tuple
  quaternion: [number, number, number, number]
  scale: number
  tint: string
}

export interface FlowerPlan {
  instances: FlowerInstance[]
  nodeCount: number
  totalLength: number
  spacing: number
  avoidedCount: number
}

export interface BooleanStatus {
  state: 'idle' | 'loading' | 'working' | 'ready' | 'error'
  message: string
  volume?: number
  triangles?: number
  elapsedMs?: number
}

export interface DragMetrics {
  index: number
  x: number
  y: number
  arcLength: number
  positionOnArc: number
  curvature: number
  radius: number
}
