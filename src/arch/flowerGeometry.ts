import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { FlowerTypeId } from '../types'

const geometryCache = new Map<FlowerTypeId, THREE.BufferGeometry>()

function withColor(source: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  // Polyhedron geometries are non-indexed while sphere/cylinder primitives are
  // indexed. Normalize every flower part before mergeGeometries().
  const geometry = source.index ? source.toNonIndexed() : source
  if (geometry !== source) source.dispose()

  geometry.deleteAttribute('uv')
  geometry.deleteAttribute('uv1')
  const c = new THREE.Color(color)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function spherePart(
  color: string,
  scale: [number, number, number],
  position: [number, number, number],
  rotationZ = 0,
  detail = 1
): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail)
  geometry.scale(scale[0], scale[1], scale[2])
  geometry.translate(position[0], position[1], position[2])
  geometry.rotateZ(rotationZ)
  return withColor(geometry, color)
}

function petal(
  color: string,
  angle: number,
  radius: number,
  width: number,
  length: number,
  depth: number,
  z = 0
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 10, 7)
  geometry.scale(width, length, depth)
  geometry.translate(0, radius, z)
  geometry.rotateZ(angle - Math.PI / 2)
  return withColor(geometry, color)
}

function stem(height: number, color = '#477a45', radius = 0.014): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius * 0.72, radius * 1.25, height, 7, 1)
  geometry.translate(0, -height / 2, -0.012)
  return withColor(geometry, color)
}

function leaf(y: number, angle: number, size = 1, color = '#5f955c'): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 9, 6)
  geometry.scale(0.04 * size, 0.085 * size, 0.014 * size)
  geometry.translate(0, y, 0)
  geometry.rotateZ(angle)
  geometry.translate(Math.cos(angle + Math.PI / 2) * 0.035, Math.sin(angle + Math.PI / 2) * 0.035, -0.01)
  return withColor(geometry, color)
}

function finish(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('花材几何合并失败')
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}

function createRose(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [stem(0.34), leaf(-0.18, -0.9, 0.9), leaf(-0.12, 0.9, 0.75)]
  const outer = 9
  for (let i = 0; i < outer; i += 1) {
    parts.push(petal(i % 2 ? '#e84a6f' : '#c9184a', (i / outer) * Math.PI * 2, 0.052, 0.047, 0.078, 0.026))
  }
  const inner = 7
  for (let i = 0; i < inner; i += 1) {
    parts.push(petal(i % 2 ? '#ff758f' : '#e0245e', (i / inner) * Math.PI * 2 + 0.25, 0.028, 0.035, 0.055, 0.03, 0.012))
  }
  parts.push(spherePart('#7a1030', [0.035, 0.035, 0.026], [0, 0.006, 0.035], 0, 2))
  return finish(parts)
}

function createPeony(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [stem(0.31, '#557f4f', 0.015), leaf(-0.17, -1.05, 1.05), leaf(-0.1, 1.0, 0.9)]
  for (let layer = 0; layer < 3; layer += 1) {
    const count = 12 - layer * 3
    const radius = 0.075 - layer * 0.025
    for (let i = 0; i < count; i += 1) {
      const color = layer === 0 ? '#f284a5' : layer === 1 ? '#f8a9c0' : '#ffd3df'
      parts.push(
        petal(
          color,
          (i / count) * Math.PI * 2 + layer * 0.31,
          radius,
          0.055 - layer * 0.008,
          0.083 - layer * 0.012,
          0.026,
          layer * 0.012
        )
      )
    }
  }
  parts.push(spherePart('#e56b8f', [0.04, 0.04, 0.03], [0, 0, 0.045], 0, 2))
  return finish(parts)
}

function createEucalyptus(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [stem(0.48, '#52794f', 0.012)]
  const levels = [-0.39, -0.31, -0.23, -0.15, -0.07, 0.01]
  levels.forEach((y, index) => {
    const side = index % 2 === 0 ? 1 : -1
    parts.push(leaf(y, side * 1.05, 0.82 + (index % 3) * 0.12, index % 2 ? '#78a978' : '#5f9564'))
    parts.push(leaf(y + 0.018, -side * 0.9, 0.72, '#86b783'))
  })
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2
    parts.push(spherePart('#d9efd2', [0.022, 0.022, 0.022], [Math.cos(a) * 0.04, 0.08 + Math.sin(a) * 0.035, 0], 0, 1))
  }
  return finish(parts)
}

function createWildflower(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [stem(0.3, '#5e9b57', 0.01), leaf(-0.16, -0.8, 0.65), leaf(-0.11, 0.85, 0.55)]
  const petals = 6
  for (let i = 0; i < petals; i += 1) {
    parts.push(petal('#fff1a6', (i / petals) * Math.PI * 2, 0.043, 0.024, 0.052, 0.014))
  }
  for (let i = 0; i < 5; i += 1) {
    parts.push(petal('#ffd166', (i / 5) * Math.PI * 2 + 0.3, 0.024, 0.018, 0.035, 0.014, 0.01))
  }
  parts.push(spherePart('#c77d24', [0.026, 0.026, 0.02], [0, 0, 0.026], 0, 1))
  return finish(parts)
}

export function getFlowerGeometry(type: FlowerTypeId): THREE.BufferGeometry {
  const cached = geometryCache.get(type)
  if (cached) return cached
  const geometry =
    type === 'rose'
      ? createRose()
      : type === 'peony'
        ? createPeony()
        : type === 'eucalyptus'
          ? createEucalyptus()
          : createWildflower()
  geometryCache.set(type, geometry)
  return geometry
}
