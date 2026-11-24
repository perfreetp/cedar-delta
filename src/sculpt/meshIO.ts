import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TARGET_IMPORTED_SIZE = 3.2;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Convert every imported mesh to one welded, indexed, normalized geometry. */
export function normalizeImportedRoot(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const positionGeometries: THREE.BufferGeometry[] = [];

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    let geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    if (geometry.index) geometry = geometry.toNonIndexed();

    const position = geometry.getAttribute('position');
    if (!position) return;

    // Copy through accessors: GLTF may use interleaved attributes whose raw
    // `.array` is not a tightly packed XYZ buffer.
    const packedPositions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      packedPositions[i * 3] = position.getX(i);
      packedPositions[i * 3 + 1] = position.getY(i);
      packedPositions[i * 3 + 2] = position.getZ(i);
    }

    // Position-only input makes merging OBJ/GLTF attribute sets reliable.
    const positionOnly = new THREE.BufferGeometry();
    positionOnly.setAttribute('position', new THREE.BufferAttribute(packedPositions, 3));
    positionGeometries.push(positionOnly);
  });

  if (positionGeometries.length === 0) {
    throw new Error('文件中没有找到可雕刻的网格');
  }

  let merged: THREE.BufferGeometry;
  if (positionGeometries.length === 1) {
    merged = positionGeometries[0];
  } else {
    const combined = mergeGeometries(positionGeometries, false);
    if (!combined) throw new Error('无法合并文件中的网格');
    merged = combined;
  }

  merged.center();
  merged.computeBoundingBox();
  const size = new THREE.Vector3();
  merged.boundingBox?.getSize(size);
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const scale = TARGET_IMPORTED_SIZE / maxDimension;
  merged.scale(scale, scale, scale);

  // Weld duplicated face vertices so adjacency and brush deformation are shared.
  const welded = mergeVertices(merged, 1e-4);
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

function parseGltf(data: string | ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(
      data,
      '',
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error('GLTF 解析失败')),
    );
  });
}

export async function importGeometryFromFile(file: File): Promise<THREE.BufferGeometry> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (extension === 'obj') {
    const text = await file.text();
    const root = new OBJLoader().parse(text);
    return normalizeImportedRoot(root);
  }

  if (extension === 'glb') {
    const buffer = await file.arrayBuffer();
    const root = await parseGltf(buffer);
    return normalizeImportedRoot(root);
  }

  if (extension === 'gltf') {
    const text = await file.text();
    const root = await parseGltf(text);
    return normalizeImportedRoot(root);
  }

  throw new Error('暂不支持该格式，请选择 .obj、.glb 或 .gltf 文件');
}

export function exportMeshAsOBJ(mesh: THREE.Mesh): string {
  mesh.updateMatrixWorld(true);
  const data = new OBJExporter().parse(mesh);
  downloadBlob(new Blob([data], { type: 'text/plain;charset=utf-8' }), `doll-head-${timestamp()}.obj`);
  return data;
}

export async function exportMeshAsGLB(mesh: THREE.Mesh): Promise<void> {
  mesh.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const result = await new Promise<ArrayBuffer | object>((resolve, reject) => {
    exporter.parse(
      mesh,
      (output) => resolve(output),
      (error) => reject(error instanceof Error ? error : new Error('GLB 导出失败')),
      { binary: true, onlyVisible: true },
    );
  });

  if (!(result instanceof ArrayBuffer)) {
    throw new Error('GLB 导出结果异常');
  }
  downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), `doll-head-${timestamp()}.glb`);
}
