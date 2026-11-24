import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { FlowerType } from './types';

let bvhEnabled = false;

/** 为低多边形花材几何开启 three-mesh-bvh 加速射线检测。 */
export function enableAcceleratedRaycast(): void {
  if (bvhEnabled) return;
  THREE.Mesh.prototype.raycast = acceleratedRaycast as unknown as typeof THREE.Mesh.prototype.raycast;
  bvhEnabled = true;
}

function withColor(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function part(
  source: THREE.BufferGeometry,
  color: string,
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  if (source.index) source.dispose();
  geometry.deleteAttribute('uv');
  geometry.scale(scale[0], scale[1], scale[2]);
  geometry.rotateX(rotation[0]);
  geometry.rotateY(rotation[1]);
  geometry.rotateZ(rotation[2]);
  geometry.translate(position[0], position[1], position[2]);
  withColor(geometry, color);
  return geometry;
}

function finalize(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('花材几何体合并失败');
  for (const g of parts) g.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  // 核心几何排布使用 BVH，让 3000 实例的拾取仍走加速三角形遍历。
  (merged as unknown as { boundsTree: MeshBVH }).boundsTree = new MeshBVH(merged, { targetLeafSize: 8 });
  return merged;
}

function createRoseGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(new THREE.CylinderGeometry(0.018, 0.027, 0.58, 6), '#3f7d55', [0, 0.29, 0]));
  parts.push(part(new THREE.IcosahedronGeometry(0.09, 0), '#4f9868', [0.075, 0.31, 0], [0, 0, -0.55], [1.25, 0.22, 0.55]));
  parts.push(part(new THREE.IcosahedronGeometry(0.08, 0), '#43865c', [-0.07, 0.24, 0.02], [0.2, 0.4, 0.55], [1.15, 0.2, 0.5]));

  const palette = ['#c93f5a', '#e85d75', '#f07a8d', '#b93450'];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(
      part(
        new THREE.IcosahedronGeometry(0.105, 0),
        palette[i % palette.length],
        [Math.cos(a) * 0.095, 0.61 + (i % 2) * 0.018, Math.sin(a) * 0.095],
        [0.42, Math.PI / 2 - a, 0.18 * Math.sin(i)],
        [0.72, 0.48, 1.12],
      ),
    );
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.25;
    parts.push(
      part(
        new THREE.IcosahedronGeometry(0.082, 0),
        i % 2 ? '#f28a9b' : '#d94b66',
        [Math.cos(a) * 0.047, 0.665, Math.sin(a) * 0.047],
        [0.18, Math.PI / 2 - a, 0.12],
        [0.72, 0.55, 1.0],
      ),
    );
  }
  parts.push(part(new THREE.IcosahedronGeometry(0.06, 1), '#a92f49', [0, 0.69, 0], [0, 0, 0], [1, 0.85, 1]));
  return finalize(parts);
}

function createHydrangeaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(new THREE.CylinderGeometry(0.02, 0.032, 0.52, 6), '#3e7654', [0, 0.26, 0]));
  parts.push(part(new THREE.IcosahedronGeometry(0.11, 0), '#4d9366', [0.09, 0.25, 0.02], [0.1, 0.2, -0.55], [1.35, 0.2, 0.62]));
  parts.push(part(new THREE.IcosahedronGeometry(0.1, 0), '#42835b', [-0.08, 0.32, -0.02], [-0.1, 0.5, 0.52], [1.25, 0.2, 0.58]));

  const palette = ['#8b7cf6', '#a79bff', '#7161df', '#c0b8ff', '#7fb7e8'];
  const clusters = 17;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < clusters; i++) {
    const y = 1 - (i / (clusters - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const cx = Math.cos(theta) * radius * 0.17;
    const cy = 0.61 + y * 0.15;
    const cz = Math.sin(theta) * radius * 0.17;
    const color = palette[i % palette.length];
    for (let p = 0; p < 4; p++) {
      const a = (p / 4) * Math.PI * 2 + i * 0.7;
      parts.push(
        part(
          new THREE.IcosahedronGeometry(0.052, 0),
          p % 2 ? color : palette[(i + 2) % palette.length],
          [cx + Math.cos(a) * 0.038, cy + Math.sin(a * 2) * 0.012, cz + Math.sin(a) * 0.038],
          [0.25 * Math.sin(a), a, 0.25 * Math.cos(a)],
          [1.05, 0.48, 0.82],
        ),
      );
    }
  }
  return finalize(parts);
}

function createEucalyptusGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(new THREE.CylinderGeometry(0.012, 0.021, 0.82, 5), '#55755f', [0, 0.41, 0]));
  const greens = ['#6aa98e', '#5b987d', '#7db89d', '#477f69'];
  for (let i = 0; i < 9; i++) {
    const y = 0.16 + i * 0.073;
    const side = i % 2 === 0 ? 1 : -1;
    const zWobble = Math.sin(i * 1.7) * 0.035;
    for (const opposite of [1, -1]) {
      const s = side * opposite;
      parts.push(
        part(
          new THREE.IcosahedronGeometry(0.083, 0),
          greens[(i + (opposite === 1 ? 0 : 2)) % greens.length],
          [s * 0.095, y + (opposite === -1 ? 0.018 : 0), zWobble * opposite],
          [0.18 * opposite, i * 0.65, -s * 0.48],
          [1.18, 0.16, 1.02],
        ),
      );
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    parts.push(
      part(
        new THREE.IcosahedronGeometry(0.075, 0),
        greens[i % greens.length],
        [Math.cos(a) * 0.055, 0.82 + i * 0.018, Math.sin(a) * 0.055],
        [0.3, a, 0.2],
        [1.1, 0.15, 1],
      ),
    );
  }
  return finalize(parts);
}

const cache: Partial<Record<FlowerType, THREE.BufferGeometry>> = {};

export function getFlowerGeometry(type: FlowerType): THREE.BufferGeometry {
  if (!cache[type]) {
    cache.rose ??= createRoseGeometry();
    cache.hydrangea ??= createHydrangeaGeometry();
    cache.eucalyptus ??= createEucalyptusGeometry();
  }
  return cache[type]!;
}

export function createFlowerMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}
