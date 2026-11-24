import * as THREE from 'three'
import { getDensity, getFlowerType } from './config'
import { createArchCurve } from './curve'
import type { FlowerInstance, FlowerPlan, ProjectState, Vec3Tuple } from '../types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function random() {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(...parts: Array<number | string>): number {
  let hash = 2166136261
  for (const part of parts) {
    const text = String(part)
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    hash ^= parts.length
  }
  return hash >>> 0
}

interface PlacedPoint {
  position: THREE.Vector3
}

class DistanceGrid {
  private cell: number
  private buckets = new Map<string, PlacedPoint[]>()

  constructor(cellSize: number) {
    this.cell = Math.max(cellSize, 0.001)
  }

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`
  }

  canPlace(position: THREE.Vector3, minimumDistance: number): boolean {
    const cx = Math.floor(position.x / this.cell)
    const cy = Math.floor(position.y / this.cell)
    const cz = Math.floor(position.z / this.cell)
    const radius = Math.ceil(minimumDistance / this.cell) + 1
    const minSq = minimumDistance * minimumDistance

    for (let ix = cx - radius; ix <= cx + radius; ix += 1) {
      for (let iy = cy - radius; iy <= cy + radius; iy += 1) {
        for (let iz = cz - radius; iz <= cz + radius; iz += 1) {
          const bucket = this.buckets.get(`${ix},${iy},${iz}`)
          if (!bucket) continue
          for (const point of bucket) {
            if (point.position.distanceToSquared(position) < minSq) return false
          }
        }
      }
    }
    return true
  }

  add(position: THREE.Vector3): void {
    const key = this.key(position.x, position.y, position.z)
    const bucket = this.buckets.get(key)
    if (bucket) bucket.push({ position })
    else this.buckets.set(key, [{ position }])
  }
}

function buildNodeDistances(length: number, spacing: number): number[] {
  const distances: number[] = []
  const count = Math.max(2, Math.floor(length / spacing) + 1)
  for (let i = 0; i < count; i += 1) {
    distances.push(Math.min(length, i * spacing))
  }
  const last = distances[distances.length - 1]
  if (length - last > spacing * 0.45) distances.push(length)
  return distances
}

export function distributeFlowers(state: ProjectState): FlowerPlan {
  const curve = createArchCurve(state.controlPoints)
  const length = curve.getLength()
  const density = getDensity(state.density)
  const flowerConfig = getFlowerType(state.flowerType)
  const random = mulberry32(hashSeed(state.seed, state.flowerType, state.mode, Math.round(state.jitterRange * 1000)))

  let nodeDistances = buildNodeDistances(length, density.spacing)
  if (state.mode === 'jitter' && state.jitterRange > 0) {
    nodeDistances = nodeDistances
      .map((distance) =>
        THREE.MathUtils.clamp(distance + (random() * 2 - 1) * state.jitterRange, 0, length)
      )
      .sort((a, b) => a - b)
  }

  const globalScale = state.flowerScale
  const minimumDistance =
    Math.max(density.minDistance, flowerConfig.minDistance * 0.82) * globalScale
  const clusterRadius = flowerConfig.clusterRadius * globalScale
  const grid = new DistanceGrid(minimumDistance)
  const placedFlowers: Array<{ position: THREE.Vector3; tangent: THREE.Vector3 }> = []
  let avoidedCount = 0

  const tangent = new THREE.Vector3()
  const anchor = new THREE.Vector3()
  const side = new THREE.Vector3()
  const candidate = new THREE.Vector3()

  function tryCandidate(position: THREE.Vector3, pathTangent: THREE.Vector3): boolean {
    if (grid.canPlace(position, minimumDistance)) {
      grid.add(position.clone())
      placedFlowers.push({ position: position.clone(), tangent: pathTangent.clone() })
      return true
    }
    avoidedCount += 1
    return false
  }

  for (let nodeIndex = 0; nodeIndex < nodeDistances.length; nodeIndex += 1) {
    const distance = nodeDistances[nodeIndex]
    const u = distance / length
    curve.getPointAt(u, anchor)
    curve.getTangentAt(u, tangent).normalize()
    side.set(-tangent.y, tangent.x, 0)
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
    side.normalize()

    for (let item = 0; item < density.perNode; item += 1) {
      let placed = false

      // Random attempts produce a natural cluster while respecting neighbours.
      for (let attempt = 0; attempt < 28 && !placed; attempt += 1) {
        const angle = random() * Math.PI * 2
        const spread = clusterRadius * (0.25 + Math.sqrt(random()) * 0.95)
        const along = (random() - 0.5) * clusterRadius * 1.25
        const depth = (random() - 0.5) * 0.22
        candidate
          .copy(anchor)
          .addScaledVector(side, Math.cos(angle) * spread)
          .addScaledVector(new THREE.Vector3(0, 0, 1), Math.sin(angle) * spread * 0.72 + depth)
          .addScaledVector(tangent, along)
        placed = tryCandidate(candidate, tangent)
      }

      // Deterministic expanding fallback guarantees the requested node count.
      if (!placed) {
        for (let ring = 1; ring <= 24 && !placed; ring += 1) {
          const radius = clusterRadius * (0.7 + ring * 0.22)
          for (let blade = 0; blade < 10; blade += 1) {
            const angle = blade * Math.PI * (3 - Math.sqrt(5)) + ring * 0.71
            candidate
              .copy(anchor)
              .addScaledVector(side, Math.cos(angle) * radius)
              .addScaledVector(
                new THREE.Vector3(0, 0, 1),
                Math.sin(angle) * radius * 0.7
              )
              .addScaledVector(tangent, ((blade / 10) - 0.5) * radius)
            if (tryCandidate(candidate, tangent)) {
              placed = true
              break
            }
          }
        }
      }

      if (!placed) {
        // Extremely dense fallback: retain the point rather than changing count.
        candidate.copy(anchor).add(new THREE.Vector3(item * 0.03, item * 0.02, item * 0.04))
        grid.add(candidate.clone())
        placedFlowers.push({ position: candidate.clone(), tangent: tangent.clone() })
      }
    }
  }

  const up = new THREE.Vector3(0, 1, 0)
  const baseQuaternion = new THREE.Quaternion()
  const spinQuaternion = new THREE.Quaternion()
  const tiltQuaternion = new THREE.Quaternion()
  const euler = new THREE.Euler()

  const instances: FlowerInstance[] = placedFlowers.map(({ position, tangent: pathTangent }, index) => {
    tangent.copy(pathTangent).normalize()
    baseQuaternion.setFromUnitVectors(up, tangent)
    spinQuaternion.setFromAxisAngle(tangent, (random() - 0.5) * 1.35)
    euler.set((random() - 0.5) * 0.28, (random() - 0.5) * 0.32, (random() - 0.5) * 0.28)
    tiltQuaternion.setFromEuler(euler)
    const quaternion = spinQuaternion.multiply(baseQuaternion).multiply(tiltQuaternion)

    const scale = 0.82 + random() * 0.34
    const tint = tintForType(state.flowerType, random, index)
    return {
      position: [position.x, position.y, position.z] as Vec3Tuple,
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      scale,
      tint
    }
  })

  return {
    instances,
    nodeCount: nodeDistances.length,
    totalLength: length,
    spacing: density.spacing,
    avoidedCount
  }
}

function tintForType(type: ProjectState['flowerType'], random: () => number, index: number): string {
  const palettes: Record<ProjectState['flowerType'], string[]> = {
    rose: ['#ffffff', '#ffe3ea', '#ffc2d1', '#fff0f3'],
    peony: ['#ffffff', '#fff0f5', '#ffd9e6', '#ffe8ef'],
    eucalyptus: ['#f4fff1', '#e1f0dc', '#d4e8cf', '#eef7e8'],
    wildflower: ['#ffffff', '#fff6cf', '#ffe9a8', '#f7f3df']
  }
  const palette = palettes[type]
  return palette[(index + Math.floor(random() * palette.length)) % palette.length]
}
