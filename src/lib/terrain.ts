// 高度场地形:构建河床、四种笔刷雕刻、采样与配色
import * as THREE from 'three';
import {
  BANK_HEIGHT,
  BANK_TRANSITION,
  CELL_X,
  CELL_Z,
  GRID_SEGMENTS,
  TERRAIN_LENGTH,
  TERRAIN_WIDTH,
  THALWEG_DEPTH,
  TOTAL_VERTS,
  VERTS_PER_SIDE,
} from './constants';
import type { Centerline } from './centerline';
import type { BrushSettings } from './types';
import { designElevation } from './profile';
import { fbm } from './noise';

export function idx(ix: number, iz: number): number {
  return iz * VERTS_PER_SIDE + ix;
}

export function gridX(ix: number): number {
  return -TERRAIN_WIDTH / 2 + ix * CELL_X;
}

export function gridZ(iz: number): number {
  return -TERRAIN_LENGTH / 2 + iz * CELL_Z;
}

/** 根据中心线 + 台阶剖面构建整张高度场 */
export function buildHeights(center: Centerline, steps: Parameters<typeof designElevation>[1]): Float32Array {
  const heights = new Float32Array(TOTAL_VERTS);
  for (let iz = 0; iz <= GRID_SEGMENTS; iz++) {
    const z = gridZ(iz);
    for (let ix = 0; ix <= GRID_SEGMENTS; ix++) {
      const x = gridX(ix);
      const info = center.nearestFast(x, z);
      const smp = info.sample;
      const design = designElevation(smp.s, steps);
      let h: number;
      if (info.distance <= smp.halfWidth) {
        // 河床:深泓线切深 + 微起伏
        const across = THREE.MathUtils.clamp(info.offset / smp.halfWidth, -1, 1);
        const thalweg = THALWEG_DEPTH * (1 - across * across);
        const rough = fbm(x * 0.09 + 3.1, z * 0.09 - 1.7) * 0.32;
        h = design - thalweg + rough;
      } else {
        // 河岸:向外平滑抬升
        const u = THREE.MathUtils.clamp((info.distance - smp.halfWidth) / BANK_TRANSITION, 0, 1);
        const bank = BANK_HEIGHT * u * u * (3 - 2 * u);
        const rough = fbm(x * 0.06, z * 0.06) * 0.7;
        h = design + bank + rough;
      }
      heights[idx(ix, iz)] = h;
    }
  }
  return heights;
}

/** 世界坐标 -> 高度双线性采样 */
export function heightAt(heights: Float32Array, x: number, z: number): number {
  const gx = THREE.MathUtils.clamp((x + TERRAIN_WIDTH / 2) / CELL_X, 0, GRID_SEGMENTS - 1e-6);
  const gz = THREE.MathUtils.clamp((z + TERRAIN_LENGTH / 2) / CELL_Z, 0, GRID_SEGMENTS - 1e-6);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const h00 = heights[idx(ix, iz)];
  const h10 = heights[idx(ix + 1, iz)];
  const h01 = heights[idx(ix, iz + 1)];
  const h11 = heights[idx(ix + 1, iz + 1)];
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fz;
}

export interface StrokePoint {
  x: number;
  z: number;
}

function falloff(d: number, radius: number): number {
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return t * t * (3 - 2 * t);
}

function neighborAverage(heights: Float32Array, ix: number, iz: number): number {
  let sum = 0;
  let cnt = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const jx = THREE.MathUtils.clamp(ix + dx, 0, GRID_SEGMENTS);
      const jz = THREE.MathUtils.clamp(iz + dz, 0, GRID_SEGMENTS);
      sum += heights[idx(jx, jz)];
      cnt++;
    }
  }
  return sum / cnt;
}

const RAISE_SCALE = 1.1; // 单次抬升/下压位移量级 m

/**
 * 对高度场施加一笔(可含插值后的多个触点)。
 * symmetric 时自动在中心线另一侧镜像雕刻。
 * flattenTarget 仅 flatten 笔刷使用。
 * 返回受影响顶点索引。
 */
export function sculptStroke(
  heights: Float32Array,
  center: Centerline,
  brush: BrushSettings,
  points: StrokePoint[],
  flattenTarget: number,
): number[] {
  const changed = new Set<number>();
  const radiusCells = Math.ceil(brush.radius / Math.min(CELL_X, CELL_Z));

  const applyAt = (px: number, pz: number) => {
    const gx = (px + TERRAIN_WIDTH / 2) / CELL_X;
    const gz = (pz + TERRAIN_LENGTH / 2) / CELL_Z;
    const ix0 = Math.max(0, Math.floor(gx) - radiusCells);
    const ix1 = Math.min(GRID_SEGMENTS, Math.ceil(gx) + radiusCells);
    const iz0 = Math.max(0, Math.floor(gz) - radiusCells);
    const iz1 = Math.min(GRID_SEGMENTS, Math.ceil(gz) + radiusCells);

    for (let iz = iz0; iz <= iz1; iz++) {
      const z = gridZ(iz);
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = gridX(ix);
        const d = Math.hypot(x - px, z - pz);
        const w = falloff(d, brush.radius);
        if (w <= 0) continue;
        const vi = idx(ix, iz);
        const h = heights[vi];
        const k = brush.strength * w;
        let next = h;
        switch (brush.type) {
          case 'raise':
            next = h + RAISE_SCALE * k;
            break;
          case 'lower':
            next = h - RAISE_SCALE * k;
            break;
          case 'smooth': {
            const avg = neighborAverage(heights, ix, iz);
            next = h + (avg - h) * k;
            break;
          }
          case 'flatten':
            next = h + (flattenTarget - h) * k;
            break;
        }
        heights[vi] = next;
        changed.add(vi);
      }
    }
  };

  for (const p of points) {
    applyAt(p.x, p.z);
    if (brush.symmetric) {
      // 镜像点:沿中心线法向反射到对岸
      const info = center.nearest(p.x, p.z);
      const mx = p.x - 2 * info.offset * info.sample.nx;
      const mz = p.z - 2 * info.offset * info.sample.nz;
      applyAt(mx, mz);
    }
  }
  return [...changed];
}

// ---------------- 顶点配色 ----------------

const SAND = new THREE.Color('#c9b08a');
const SAND_WET = new THREE.Color('#8f7d5f');
const GRASS = new THREE.Color('#5f7d43');
const ROCK = new THREE.Color('#7d7a72');

export function computeColors(center: Centerline, heights: Float32Array): Float32Array {
  const colors = new Float32Array(TOTAL_VERTS * 3);
  const tmp = new THREE.Color();
  for (let iz = 0; iz <= GRID_SEGMENTS; iz++) {
    const z = gridZ(iz);
    for (let ix = 0; ix <= GRID_SEGMENTS; ix++) {
      const x = gridX(ix);
      const info = center.nearestFast(x, z);
      const vi = idx(ix, iz);
      const h = heights[vi];
      if (info.distance <= info.sample.halfWidth) {
        // 河床内:湿沙 -> 干沙,随高度微变
        tmp.copy(SAND_WET).lerp(SAND, THREE.MathUtils.clamp((h + 2) / 6, 0, 1));
      } else {
        const u = THREE.MathUtils.clamp(
          (info.distance - info.sample.halfWidth) / BANK_TRANSITION,
          0,
          1,
        );
        tmp.copy(GRASS).lerp(ROCK, THREE.MathUtils.clamp(u * 0.8 + Math.max(0, h - 8) * 0.05, 0, 1));
      }
      colors[vi * 3] = tmp.r;
      colors[vi * 3 + 1] = tmp.g;
      colors[vi * 3 + 2] = tmp.b;
    }
  }
  return colors;
}
