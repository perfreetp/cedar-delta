// three-mesh-bvh 接入:为 BufferGeometry / Mesh 挂载加速结构
import * as THREE from 'three';
import {
  MeshBVH,
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

let patched = false;

export function installBVH(): void {
  if (patched) return;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  patched = true;
}

export { MeshBVH };
