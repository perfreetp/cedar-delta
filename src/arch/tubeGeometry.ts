import * as THREE from 'three'

/**
 * Closed, capped tube. Unlike THREE.TubeGeometry this can be converted to a
 * Manifold and boolean-unioned with the bases.
 */
export function createCappedTubeGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments = 88,
  radialSegments = 16,
  radius = 0.062
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false)
  const positions: number[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()

  for (let i = 0; i <= tubularSegments; i += 1) {
    curve.getPointAt(i / tubularSegments, point)
    const frameNormal = frames.normals[i]
    const frameBinormal = frames.binormals[i]

    for (let j = 0; j < radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2
      const sin = Math.sin(angle)
      const cos = -Math.cos(angle)
      normal
        .set(0, 0, 0)
        .addScaledVector(frameNormal, cos)
        .addScaledVector(frameBinormal, sin)
        .normalize()
      positions.push(
        point.x + radius * normal.x,
        point.y + radius * normal.y,
        point.z + radius * normal.z
      )
    }
  }

  for (let i = 1; i <= tubularSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const previousRing = (i - 1) * radialSegments
      const currentRing = i * radialSegments
      const nextJ = (j + 1) % radialSegments

      const a = previousRing + j
      const b = currentRing + j
      const c = currentRing + nextJ
      const d = previousRing + nextJ

      indices.push(a, b, d)
      indices.push(b, c, d)
    }
  }

  const startCenter = positions.length / 3
  const startPoint = curve.getPointAt(0)
  positions.push(startPoint.x, startPoint.y, startPoint.z)
  for (let j = 0; j < radialSegments; j += 1) {
    indices.push(startCenter, j, (j + 1) % radialSegments)
  }

  const endCenter = positions.length / 3
  const endPoint = curve.getPointAt(1)
  positions.push(endPoint.x, endPoint.y, endPoint.z)
  const endRing = tubularSegments * radialSegments
  for (let j = 0; j < radialSegments; j += 1) {
    indices.push(endCenter, endRing + ((j + 1) % radialSegments), endRing + j)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
