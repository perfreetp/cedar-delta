// 赛道中心线:Catmull-Rom 样条 + 弧长参数化 + 曲率 + 自适应河宽
import * as THREE from 'three';
import {
  BASE_HALF_WIDTH,
  CURVATURE_NARROW,
  MIN_HALF_WIDTH,
  MIN_WIDTH_RATIO,
  PROFILE_SAMPLES,
} from './constants';
import type { ControlPoint } from './types';

export interface CenterSample {
  /** 弧长位置 m */
  s: number;
  /** 中心线位置(XZ) */
  x: number;
  z: number;
  /** 单位切向 */
  tx: number;
  tz: number;
  /** 单位法向(指向河流左侧) */
  nx: number;
  nz: number;
  /** 曲率(带符号,1/m) */
  curvature: number;
  /** 该位置自适应河床半宽 m */
  halfWidth: number;
}

export class Centerline {
  readonly points: ControlPoint[];
  readonly curve: THREE.CatmullRomCurve3;
  readonly samples: CenterSample[] = [];
  readonly totalLength: number;
  private readonly sTable: number[] = [];

  constructor(points: ControlPoint[]) {
    this.points = points;
    const vecs = points.map((p) => new THREE.Vector3(p.x, 0, p.z));
    // centripetal 抑制过冲与自交
    this.curve = new THREE.CatmullRomCurve3(vecs, false, 'centripetal', 0.5);

    const n = PROFILE_SAMPLES;
    const raw: Array<{ x: number; z: number; tx: number; tz: number; s: number }> = [];
    let total = 0;
    let prev = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = this.curve.getPoint(t);
      const tan = this.curve.getTangent(t);
      if (i > 0) total += p.distanceTo(prev);
      raw.push({ x: p.x, z: p.z, tx: tan.x, tz: tan.z, s: total });
      prev = p;
    }
    this.totalLength = total;

    // 三点圆曲率(带符号),再做平滑
    const kappa = new Array<number>(raw.length).fill(0);
    for (let i = 1; i < raw.length - 1; i++) {
      const a = raw[i - 1];
      const b = raw[i];
      const c = raw[i + 1];
      const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      const ab = Math.hypot(b.x - a.x, b.z - a.z);
      const bc = Math.hypot(c.x - b.x, c.z - b.z);
      const ac = Math.hypot(c.x - a.x, c.z - a.z);
      const denom = ab * bc * ac;
      kappa[i] = denom > 1e-9 ? (2 * cross) / denom : 0;
    }
    const smoothK = kappa.map((_, i) => {
      const lo = Math.max(0, i - 2);
      const hi = Math.min(kappa.length - 1, i + 2);
      let sum = 0;
      let cnt = 0;
      for (let j = lo; j <= hi; j++) {
        sum += kappa[j];
        cnt++;
      }
      return sum / cnt;
    });

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const k = Math.max(-0.12, Math.min(0.12, smoothK[i]));
      // 河床宽度随曲率自适应收窄(取绝对值,左右弯均收窄)
      const factor = THREE.MathUtils.clamp(
        1 - CURVATURE_NARROW * Math.abs(k),
        MIN_WIDTH_RATIO,
        1,
      );
      const halfWidth = Math.max(MIN_HALF_WIDTH, BASE_HALF_WIDTH * factor);
      this.samples.push({
        s: r.s,
        x: r.x,
        z: r.z,
        tx: r.tx,
        tz: r.tz,
        nx: -r.tz,
        nz: r.tx,
        curvature: k,
        halfWidth,
      });
      this.sTable.push(r.s);
    }
    this.buildHash();
  }

  get length(): number {
    return this.totalLength;
  }

  /** 按弧长取采样(线性插值) */
  sampleAt(s: number): CenterSample {
    const clamped = THREE.MathUtils.clamp(s, 0, this.totalLength);
    // 二分查找区间
    let lo = 0;
    let hi = this.sTable.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.sTable[mid] <= clamped) lo = mid;
      else hi = mid;
    }
    const a = this.samples[lo];
    const b = this.samples[Math.min(lo + 1, this.samples.length - 1)];
    const span = b.s - a.s;
    const t = span > 1e-9 ? (clamped - a.s) / span : 0;
    return {
      s: clamped,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tx: a.tx + (b.tx - a.tx) * t,
      tz: a.tz + (b.tz - a.tz) * t,
      nx: a.nx + (b.nx - a.nx) * t,
      nz: a.nz + (b.nz - a.nz) * t,
      curvature: a.curvature + (b.curvature - a.curvature) * t,
      halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
    };
  }

  /** 世界点到中心线的最近投影:返回弧长、横向偏移(左正右负)、最近距离、采样点 */
  nearest(
    x: number,
    z: number,
  ): { s: number; offset: number; distance: number; sample: CenterSample } {
    let bestIdx = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const smp = this.samples[i];
      const dx = x - smp.x;
      const dz = z - smp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    // 在相邻段内做线性精化
    const refine = (i: number, j: number) => {
      const a = this.samples[i];
      const b = this.samples[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segLen2 = dx * dx + dz * dz;
      let t = segLen2 > 1e-12 ? ((x - a.x) * dx + (z - a.z) * dz) / segLen2 : 0;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      return {
        s: a.s + (b.s - a.s) * t,
        x: px,
        z: pz,
        d: Math.hypot(x - px, z - pz),
      };
    };
    const prevIdx = Math.max(0, bestIdx - 1);
    const nextIdx = Math.min(this.samples.length - 1, bestIdx + 1);
    const r1 = refine(prevIdx, bestIdx);
    const r2 = refine(bestIdx, nextIdx);
    const r = r1.d <= r2.d ? r1 : r2;
    const smp = this.sampleAt(r.s);
    const offset = (x - r.x) * smp.nx + (z - r.z) * smp.nz;
    return { s: r.s, offset, distance: r.d, sample: smp };
  }

  /** 中心线世界折线(供 three.js 线框使用) */
  toLinePoints(y = 0): THREE.Vector3[] {
    return this.samples.map((s) => new THREE.Vector3(s.x, y, s.z));
  }

  /** 空间哈希粗查最近采样索引(供高度场批量构建) */
  nearestFastIndex(x: number, z: number): number {
    const cell = 18;
    const cx = Math.floor((x + 1000) / cell);
    const cz = Math.floor((z + 1000) / cell);
    for (let ring = 0; ring < 12; ring++) {
      let best = -1;
      let bestD2 = Infinity;
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring && ring > 0) continue;
          const arr = this.hash.get(`${cx + dx},${cz + dz}`);
          if (!arr) continue;
          for (const i of arr) {
            const smp = this.samples[i];
            const ddx = x - smp.x;
            const ddz = z - smp.z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = i;
            }
          }
        }
      }
      if (best >= 0) return best;
    }
    // 兜底:线性扫描
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const smp = this.samples[i];
      const d2 = (x - smp.x) ** 2 + (z - smp.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  /** 批量构建用:基于空间哈希的最近投影 */
  nearestFast(
    x: number,
    z: number,
  ): { s: number; offset: number; distance: number; sample: CenterSample } {
    const bestIdx = this.nearestFastIndex(x, z);
    const prevIdx = Math.max(0, bestIdx - 1);
    const nextIdx = Math.min(this.samples.length - 1, bestIdx + 1);
    const r1 = this.refine(prevIdx, bestIdx, x, z);
    const r2 = this.refine(bestIdx, nextIdx, x, z);
    const r = r1.d <= r2.d ? r1 : r2;
    const smp = this.sampleAt(r.s);
    const offset = (x - r.x) * smp.nx + (z - r.z) * smp.nz;
    return { s: r.s, offset, distance: r.d, sample: smp };
  }

  private refine(
    i: number,
    j: number,
    x: number,
    z: number,
  ): { s: number; x: number; z: number; d: number } {
    const a = this.samples[i];
    const b = this.samples[j];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const segLen2 = dx * dx + dz * dz;
    let t = segLen2 > 1e-12 ? ((x - a.x) * dx + (z - a.z) * dz) / segLen2 : 0;
    t = THREE.MathUtils.clamp(t, 0, 1);
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    return {
      s: a.s + (b.s - a.s) * t,
      x: px,
      z: pz,
      d: Math.hypot(x - px, z - pz),
    };
  }

  private hash = new Map<string, number[]>();

  private buildHash(): void {
    const cell = 18;
    this.samples.forEach((smp, i) => {
      const key = `${Math.floor((smp.x + 1000) / cell)},${Math.floor((smp.z + 1000) / cell)}`;
      const arr = this.hash.get(key);
      if (arr) arr.push(i);
      else this.hash.set(key, [i]);
    });
  }
}
