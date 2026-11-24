import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import initManifoldModule from 'manifold-3d'
import type { Manifold, ManifoldToplevel } from 'manifold-3d'
// Vite emits and hashes the WASM asset; the package's default loader cannot
// reliably resolve it from source in dev/build without this explicit URL.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url'
import { createSkeletonGeometries } from './skeletonParts'
import type { BooleanStatus, Vec3Tuple } from '../types'

let manifoldPromise: Promise<ManifoldToplevel> | null = null

export function initManifold(): Promise<ManifoldToplevel> {
  if (!manifoldPromise) {
    manifoldPromise = initManifoldModule({
      locateFile: () => manifoldWasmUrl
    }).then((runtime) => {
      // The JS class wrappers (notably Mesh) are attached during setup().
      runtime.setup()
      return runtime
    }).catch((error) => {
      manifoldPromise = null
      throw error
    })
  }
  return manifoldPromise
}

function geometryToManifold(runtime: ManifoldToplevel, source: THREE.BufferGeometry): Manifold {
  // Three's primitives duplicate seam/cap vertices for normals and UVs. Manifold
  // only receives positions here, so weld coincident vertices first.
  const positionOnly = new THREE.BufferGeometry()
  const sourcePosition = source.getAttribute('position') as THREE.BufferAttribute
  positionOnly.setAttribute('position', sourcePosition.clone())
  if (source.index) positionOnly.setIndex(source.index.clone())

  const geometry = mergeVertices(positionOnly, 1e-5)
  positionOnly.dispose()

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const vertexCount = position.count
  const vertProperties = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i += 1) {
    vertProperties[i * 3] = position.getX(i)
    vertProperties[i * 3 + 1] = position.getY(i)
    vertProperties[i * 3 + 2] = position.getZ(i)
  }

  let triVerts: Uint32Array
  if (geometry.index) {
    const index = geometry.index
    triVerts = new Uint32Array(index.count)
    for (let i = 0; i < index.count; i += 1) triVerts[i] = index.getX(i)
  } else {
    triVerts = new Uint32Array(vertexCount)
    for (let i = 0; i < vertexCount; i += 1) triVerts[i] = i
  }

  const manifold = new runtime.Manifold(
    new runtime.Mesh({
      numProp: 3,
      vertProperties,
      triVerts
    })
  )
  geometry.dispose()
  return manifold
}

export interface BooleanResult {
  geometry: THREE.BufferGeometry
  volume: number
  triangles: number
  elapsedMs: number
  status: BooleanStatus['state']
  statusText: string
}

/**
 * Builds the main arc, two vertical columns and two weighted bases, then asks
 * manifold-3d for one watertight boolean union.
 */
export async function buildMergedSkeleton(points: Vec3Tuple[]): Promise<BooleanResult> {
  const started = performance.now()
  const runtime = await initManifold()

  const sourceGeometries = createSkeletonGeometries(points)
  const manifolds: Manifold[] = []
  let merged: Manifold | null = null

  try {
    for (const geometry of sourceGeometries) {
      manifolds.push(geometryToManifold(runtime, geometry))
    }

    merged = runtime.Manifold.union(manifolds)
    const statusText = merged.status()
    const manifoldMesh = merged.getMesh()
    const sourceProperties = manifoldMesh.vertProperties
    const stride = manifoldMesh.numProp || 3
    const vertexCount = Math.floor(sourceProperties.length / stride)
    const positions = new Float32Array(vertexCount * 3)

    for (let i = 0; i < vertexCount; i += 1) {
      positions[i * 3] = sourceProperties[i * stride]
      positions[i * 3 + 1] = sourceProperties[i * stride + 1]
      positions[i * 3 + 2] = sourceProperties[i * stride + 2]
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(manifoldMesh.triVerts), 1))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const elapsedMs = performance.now() - started
    return {
      geometry,
      volume: merged.volume(),
      triangles: manifoldMesh.triVerts.length / 3,
      elapsedMs,
      status: statusText === 'NoError' ? 'ready' : 'error',
      statusText
    }
  } finally {
    for (const item of manifolds) item.delete()
    merged?.delete()
    for (const geometry of sourceGeometries) geometry.dispose()
  }
}
