import * as THREE from 'three'
import type { Vec3Tuple } from '../types'

export function pointsToVectors(points: Vec3Tuple[]): THREE.Vector3[] {
  return points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
}

export function createArchCurve(points: Vec3Tuple[]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(pointsToVectors(points), false, 'centripetal', 0.5)
}

/**
 * Find the normalized arc-length coordinate nearest to a dragged control point.
 */
export function nearestArcU(curve: THREE.CatmullRomCurve3, point: Vec3Tuple): number {
  const target = new THREE.Vector3(...point)
  const samples = 220
  let bestU = 0
  let bestDistance = Number.POSITIVE_INFINITY
  const sample = new THREE.Vector3()

  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples
    curve.getPointAt(u, sample)
    const distance = sample.distanceToSquared(target)
    if (distance < bestDistance) {
      bestDistance = distance
      bestU = u
    }
  }
  return bestU
}

/**
 * Curvature |dT/ds| estimated from arc-length parametrized tangents.
 * Units are 1 / meter because the project uses meter-like world units.
 */
export function curvatureAtArcU(curve: THREE.CatmullRomCurve3, u: number): number {
  const epsilon = 0.004
  const u0 = THREE.MathUtils.clamp(u - epsilon, 0, 1)
  const u1 = THREE.MathUtils.clamp(u + epsilon, 0, 1)
  const t0 = curve.getTangentAt(u0).normalize()
  const t1 = curve.getTangentAt(u1).normalize()
  const arcDistance = Math.max((u1 - u0) * curve.getLength(), 1e-5)
  return t0.angleTo(t1) / arcDistance
}

export function clampControlPoint(point: Vec3Tuple): Vec3Tuple {
  return [
    THREE.MathUtils.clamp(point[0], -4.2, 4.2),
    THREE.MathUtils.clamp(point[1], 0.28, 6.2),
    0
  ]
}
