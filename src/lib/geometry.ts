/**
 * 物体库条目 -> three.js 几何体（程序化建模，单位米，原点居中，底部在 y=0）
 * 每个条目返回合并后的 BufferGeometry，配合 InstancedMesh 实现数千物体的流畅渲染。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CatalogItem } from '../types';

type Mat = { color: string | number; metalness?: number; roughness?: number; emissive?: string };

function mat(color: string | number, opts: Partial<Mat> = {}): Mat {
  return { color, roughness: 0.75, metalness: 0.05, ...opts };
}

/** 平移一个几何（辅助） */
function move(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.translate(x, y, z);
  return g;
}

/** 收集部件并按材质分组合并，返回 { geometry, materialIndex } 列表 */
interface Part {
  geo: THREE.BufferGeometry;
  mi: number;
}

function builder(item: CatalogItem): Part[] {
  const w = item.width;
  const d = item.depth;
  const h = item.height;
  const wood = mat(item.color);
  const dark = mat('#5a4632', { roughness: 0.9 });
  const metal = mat('#8a8d92', { metalness: 0.6, roughness: 0.35 });
  const green = mat('#5f7d55');
  const flower = mat('#e58aa2');
  const white = mat('#f5f0e6');
  const parts: Part[] = [];
  const add = (geo: THREE.BufferGeometry, m: Mat) => {
    const mi = materials.indexOf(m);
    parts.push({ geo, mi: mi >= 0 ? mi : materials.push(m) - 1 });
  };
  const materials: Mat[] = [];

  const box = (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    m: Mat,
  ) => add(move(new THREE.BoxGeometry(sx, sy, sz), x, y + sy / 2, z), m);

  const cyl = (
    rt: number,
    rb: number,
    sh: number,
    x: number,
    y: number,
    z: number,
    m: Mat,
    seg = 16,
  ) => add(move(new THREE.CylinderGeometry(rt, rb, sh, seg), x, y + sh / 2, z), m);

  switch (item.geometry) {
    case 'roundTable': {
      cyl(w / 2, w / 2, 0.06, 0, h - 0.06, 0, wood, 24);
      cyl(0.08, 0.08, h - 0.06, 0, 0, 0, dark, 12);
      cyl(0.35, 0.35, 0.04, 0, 0, 0, dark, 20);
      break;
    }
    case 'longTable':
    case 'buffetTable':
    case 'giftTable': {
      box(w, 0.06, d, 0, h - 0.06, 0, wood);
      const lx = w / 2 - 0.08;
      const lz = d / 2 - 0.08;
      for (const [x, z] of [
        [-lx, -lz],
        [lx, -lz],
        [lx, lz],
        [-lx, lz],
      ])
        box(0.07, h - 0.06, 0.07, x, 0, z, dark);
      break;
    }
    case 'chair': {
      box(w, 0.05, d, 0, 0.45, 0, wood);
      box(w, h - 0.45, 0.05, 0, 0.45, -d / 2 + 0.025, wood);
      for (const [x, z] of [
        [-w / 2 + 0.04, -d / 2 + 0.04],
        [w / 2 - 0.04, -d / 2 + 0.04],
        [-w / 2 + 0.04, d / 2 - 0.04],
        [w / 2 - 0.04, d / 2 - 0.04],
      ])
        box(0.04, 0.45, 0.04, x, 0, z, dark);
      break;
    }
    case 'sofa': {
      box(w, 0.25, d, 0, 0.15, 0, mat(item.color, { roughness: 0.95 }));
      box(w, 0.55, 0.18, 0, 0.4, -d / 2 + 0.09, mat(item.color, { roughness: 0.95 }));
      box(0.18, 0.35, d, -w / 2 + 0.09, 0.3, 0, mat(item.color, { roughness: 0.95 }));
      box(0.18, 0.35, d, w / 2 - 0.09, 0.3, 0, mat(item.color, { roughness: 0.95 }));
      break;
    }
    case 'stage': {
      box(w, h, d, 0, 0, 0, wood);
      box(w + 0.1, 0.05, d + 0.1, 0, h, 0, mat('#8f6b4e'));
      break;
    }
    case 'arch': {
      const r = w / 2;
      const post = 0.12;
      box(post, h, post, -r + post / 2, 0, 0, white);
      box(post, h, post, r - post / 2, 0, 0, white);
      const torus = move(new THREE.TorusGeometry(r - post / 2, 0.07, 10, 28, Math.PI), 0, h, 0);
      torus.rotateY(Math.PI / 2);
      add(torus, white);
      for (let i = 0; i < 6; i++) {
        const t = (i / 5) * Math.PI;
        const fx = Math.cos(t) * (r - post / 2);
        const fy = h + Math.sin(t) * (r - post / 2);
        add(move(new THREE.SphereGeometry(0.11, 10, 8), fx, fy, 0), flower);
      }
      break;
    }
    case 'backdrop': {
      box(w, h, d, 0, 0, 0, mat(item.color, { roughness: 0.9 }));
      box(0.08, h + 0.3, 0.08, -w / 2 - 0.04, 0, 0, metal);
      box(0.08, h + 0.3, 0.08, w / 2 + 0.04, 0, 0, metal);
      break;
    }
    case 'flowerColumn': {
      cyl(0.16, 0.2, h - 0.3, 0, 0, 0, white, 14);
      cyl(0.3, 0.2, 0.3, 0, h - 0.3, 0, green, 14);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(
          move(
            new THREE.SphereGeometry(0.13, 10, 8),
            Math.cos(a) * 0.18,
            h - 0.12 + (i % 2) * 0.08,
            Math.sin(a) * 0.18,
          ),
          flower,
        );
      }
      break;
    }
    case 'flowerStand': {
      cyl(0.03, 0.05, h - 0.25, 0, 0, 0, metal, 10);
      cyl(0.18, 0.12, 0.25, 0, h - 0.25, 0, green, 12);
      add(move(new THREE.SphereGeometry(0.12, 10, 8), 0, h + 0.02, 0), flower);
      break;
    }
    case 'carpet': {
      box(w, h, d, 0, 0, 0, mat(item.color, { roughness: 1 }));
      break;
    }
    case 'candle': {
      cyl(0.07, 0.09, h, 0, 0, 0, mat('#f7f1e1', { roughness: 0.4 }), 12);
      const flame = move(new THREE.ConeGeometry(0.035, 0.1, 8), 0, h, 0);
      add(flame, mat('#ffb347', { emissive: '#ff8c1a', roughness: 0.4 }));
      break;
    }
    case 'speaker': {
      box(w, h, d, 0, 0, 0, mat(item.color, { roughness: 0.6 }));
      cyl(w * 0.32, w * 0.32, 0.03, 0, h * 0.62, d / 2 + 0.01, metal, 16);
      cyl(w * 0.18, w * 0.18, 0.03, 0, h * 0.25, d / 2 + 0.01, metal, 16);
      break;
    }
    case 'signBoard': {
      box(0.06, h - 0.2, 0.06, 0, 0, 0, metal);
      box(w, 0.6, d, 0, h - 0.55, 0, mat(item.color, { roughness: 0.85 }));
      break;
    }
    default: {
      box(w, h, d, 0, 0, 0, wood);
    }
  }
  return parts.map((p) => ({ ...p, materials }));
}

export interface BuiltGeometry {
  /** 按材质索引合并后的几何，每个材质一个 */
  geometries: THREE.BufferGeometry[];
  materials: THREE.MeshStandardMaterial[];
}

const cache = new Map<string, BuiltGeometry>();

export function buildGeometry(item: CatalogItem): BuiltGeometry {
  const hit = cache.get(item.id);
  if (hit) return hit;
  const parts = builder(item);
  const materialDefs = (parts[0] as unknown as { materials: Mat[] }).materials;
  const byMat: THREE.BufferGeometry[][] = materialDefs.map(() => []);
  for (const p of parts) byMat[p.mi].push(p.geo);
  const geometries = byMat
    .filter((list) => list.length > 0)
    .map((list) => mergeGeometries(list, false)!);
  const materials = materialDefs.map(
    (m) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(m.color as string),
        metalness: m.metalness ?? 0.05,
        roughness: m.roughness ?? 0.75,
        emissive: m.emissive ? new THREE.Color(m.emissive) : new THREE.Color(0x000000),
      }),
  );
  const built = { geometries, materials };
  cache.set(item.id, built);
  return built;
}
