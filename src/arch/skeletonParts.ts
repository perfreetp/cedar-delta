import * as THREE from 'three'
import { createArchCurve } from './curve'
import { createCappedTubeGeometry } from './tubeGeometry'
import type { Vec3Tuple } from '../types'

function verticalCylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  centerY: number,
  x: number,
  segments: number
): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, false)
  geometry.translate(x, centerY, 0)
  return geometry
}

/**
 * Visual / boolean source geometries for arc + columns + bases.
 * Every geometry is positioned in world coordinates.
 */
export function createSkeletonGeometries(points: Vec3Tuple[]): THREE.BufferGeometry[] {
  const curve = createArchCurve(points)
  const geometries: THREE.BufferGeometry[] = [createCappedTubeGeometry(curve, 96, 18, 0.064)]

  for (const endpoint of [points[0], points[points.length - 1]]) {
    const x = endpoint[0]
    const height = Math.max(0.2, endpoint[1])
    geometries.push(verticalCylinder(0.061, 0.074, height, height / 2, x, 18))
    geometries.push(verticalCylinder(0.31, 0.37, 0.16, 0.08, x, 32))
    geometries.push(verticalCylinder(0.105, 0.13, 0.18, 0.13, x, 20))
  }

  return geometries
}
