import type { Vec2 } from '../types';
import { angleDelta, lerp, lerpAngle } from './vec';

/**
 * 向心参数化 Catmull-Rom 样条（alpha=0.5）。
 *
 * 性质：
 * - 严格穿过全部控制点（经过点）；
 * - C1 连续：删除/插入控制点后重建，接头处切线一致，不会出现折角突变；
 * - 向心参数化可抑制尖点与自相交过冲。
 *
 * 内部维护按弧长均匀采样的查找表，播放与拾取均为 O(log n)。
 */

const ALPHA = 0.5;
const KNOT_EPS = 1e-4;
/** 采样目标间距（世界像素），越小越精细 */
const TARGET_SPACING = 10;
const MIN_STEPS = 2;
const MAX_STEPS = 24;

interface Knots {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}

const knotOf = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Knots => {
  const d01 = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), KNOT_EPS);
  const d12 = Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), KNOT_EPS);
  const d23 = Math.max(Math.hypot(p3.x - p2.x, p3.y - p2.y), KNOT_EPS);
  const t0 = 0;
  const t1 = Math.pow(d01, ALPHA);
  const t2 = t1 + Math.pow(d12, ALPHA);
  const t3 = t2 + Math.pow(d23, ALPHA);
  return { t0, t1, t2, t3 };
};

/**
 * 求段 P1->P2 在局部参数 u∈[0,1] 的位置与一阶导（切线，未归一化）。
 * 内部向心 knot 定义在 [0, t1, t2, t3]，这里把 u 映射到 [t1, t2]。
 */
const evaluateSegment = (
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  u: number,
): { x: number; y: number; dx: number; dy: number } => {
  const k = knotOf(p0, p1, p2, p3);
  const { t0, t1, t2, t3 } = k;
  const t = t1 + u * (t2 - t1);

  // 一级插值（位置与对 t 的导数）
  const A1x = p0.x + ((p1.x - p0.x) * (t - t0)) / (t1 - t0);
  const A1y = p0.y + ((p1.y - p0.y) * (t - t0)) / (t1 - t0);
  const A2x = p1.x + ((p2.x - p1.x) * (t - t1)) / (t2 - t1);
  const A2y = p1.y + ((p2.y - p1.y) * (t - t1)) / (t2 - t1);
  const A3x = p2.x + ((p3.x - p2.x) * (t - t2)) / (t3 - t2);
  const A3y = p2.y + ((p3.y - p2.y) * (t - t2)) / (t3 - t2);

  const A1dx = (p1.x - p0.x) / (t1 - t0);
  const A1dy = (p1.y - p0.y) / (t1 - t0);
  const A2dx = (p2.x - p1.x) / (t2 - t1);
  const A2dy = (p2.y - p1.y) / (t2 - t1);
  const A3dx = (p3.x - p2.x) / (t3 - t2);
  const A3dy = (p3.y - p2.y) / (t3 - t2);

  // 二级插值
  const b10 = (t2 - t) / (t2 - t0);
  const b11 = (t - t0) / (t2 - t0);
  const B1x = b10 * A1x + b11 * A2x;
  const B1y = b10 * A1y + b11 * A2y;
  const b10d = -1 / (t2 - t0);
  const b11d = 1 / (t2 - t0);
  const B1dx = b10d * A1x + b10 * A1dx + b11d * A2x + b11 * A2dx;
  const B1dy = b10d * A1y + b10 * A1dy + b11d * A2y + b11 * A2dy;

  const b20 = (t3 - t) / (t3 - t1);
  const b21 = (t - t1) / (t3 - t1);
  const B2x = b20 * A2x + b21 * A3x;
  const B2y = b20 * A2y + b21 * A3y;
  const b20d = -1 / (t3 - t1);
  const b21d = 1 / (t3 - t1);
  const B2dx = b20d * A2x + b20 * A2dx + b21d * A3x + b21 * A3dx;
  const B2dy = b20d * A2y + b20 * A2dy + b21d * A3y + b21 * A3dy;

  // 三级插值
  const v1 = (t2 - t) / (t2 - t1);
  const v2 = (t - t1) / (t2 - t1);
  const x = v1 * B1x + v2 * B2x;
  const y = v1 * B1y + v2 * B2y;
  const v1d = -1 / (t2 - t1);
  const v2d = 1 / (t2 - t1);
  const dx = v1d * B1x + v1 * B1dx + v2d * B2x + v2 * B2dx;
  const dy = v1d * B1y + v1 * B1dy + v2d * B2y + v2 * B2dy;

  return { x, y, dx, dy };
};

export interface NearestResult {
  s: number;
  point: Vec2;
  /** 命中点所在的“经过点段”索引 i（位于 waypoint i 与 i+1 之间） */
  segmentIndex: number;
  dist: number;
}

export class Spline {
  readonly points: Vec2[];
  /** 每个采样点的累计弧长 */
  readonly sArr: Float32Array;
  readonly xArr: Float32Array;
  readonly yArr: Float32Array;
  /** 每个采样点的切线角（弧度，坐标系与世界一致，可直接用于 Pixi rotation） */
  readonly angleArr: Float32Array;
  /** 每个采样点所属的经过点段索引 */
  readonly segArr: Int32Array;
  /** 每个经过点对应的弧长 */
  readonly waypointS: number[];
  readonly totalLength: number;
  readonly sampleCount: number;

  constructor(points: Vec2[]) {
    this.points = points;
    const n = points.length;

    if (n === 0) {
      this.sArr = new Float32Array(0);
      this.xArr = new Float32Array(0);
      this.yArr = new Float32Array(0);
      this.angleArr = new Float32Array(0);
      this.segArr = new Int32Array(0);
      this.waypointS = [];
      this.totalLength = 0;
      this.sampleCount = 0;
      return;
    }

    // 先估算采样规模
    let capacity = 1;
    const stepsPerSeg: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const chord = Math.max(Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y), KNOT_EPS);
      const steps = Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.ceil(chord / TARGET_SPACING)));
      stepsPerSeg.push(steps);
      capacity += steps;
    }

    const sList = new Float32Array(capacity);
    const xList = new Float32Array(capacity);
    const yList = new Float32Array(capacity);
    const aList = new Float32Array(capacity);
    const segList = new Int32Array(capacity);
    const wpS: number[] = new Array(n).fill(0);

    let count = 0;
    let acc = 0;
    let prevX = points[0].x;
    let prevY = points[0].y;

    const push = (x: number, y: number, angle: number, seg: number) => {
      if (count > 0) {
        acc += Math.hypot(x - prevX, y - prevY);
      }
      sList[count] = acc;
      xList[count] = x;
      yList[count] = y;
      aList[count] = angle;
      segList[count] = seg;
      prevX = x;
      prevY = y;
      count++;
    };

    push(points[0].x, points[0].y, 0, 0);

    if (n === 1) {
      wpS[0] = 0;
    }

    for (let i = 0; i < n - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const p0 = i === 0 ? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y } : points[i - 1];
      const p3 = i + 2 >= n ? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y } : points[i + 2];
      const steps = stepsPerSeg[i];

      for (let j = 1; j <= steps; j++) {
        const t = j / steps;
        const r = evaluateSegment(p0, p1, p2, p3, t);
        const angle = Math.atan2(r.dy, r.dx);
        push(r.x, r.y, angle, i);
      }
      wpS[i + 1] = acc;
    }

    // 首点切线角：取第二个采样点的方向，保证起点朝向与轨迹一致
    if (count > 1) {
      aList[0] = Math.atan2(yList[1] - yList[0], xList[1] - xList[0]);
    }

    this.sArr = sList.subarray(0, count);
    this.xArr = xList.subarray(0, count);
    this.yArr = yList.subarray(0, count);
    this.angleArr = aList.subarray(0, count);
    this.segArr = segList.subarray(0, count);
    this.waypointS = wpS;
    this.totalLength = acc;
    this.sampleCount = count;
  }

  /** 在弧长表中二分查找：返回最大的满足 sArr[idx] <= s 的 idx */
  private lowerBound(s: number): number {
    let lo = 0;
    let hi = this.sampleCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.sArr[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 按弧长取位置（自动夹取到 [0, totalLength]） */
  pointAtS(s: number): Vec2 {
    if (this.sampleCount === 1) return { x: this.xArr[0], y: this.yArr[0] };
    const clamped = Math.max(0, Math.min(this.totalLength, s));
    const i = this.lowerBound(clamped);
    if (i >= this.sampleCount - 1) return { x: this.xArr[i], y: this.yArr[i] };
    const s0 = this.sArr[i];
    const s1 = this.sArr[i + 1];
    const u = s1 - s0 < 1e-9 ? 0 : (clamped - s0) / (s1 - s0);
    return lerp({ x: this.xArr[i], y: this.yArr[i] }, { x: this.xArr[i + 1], y: this.yArr[i + 1] }, u);
  }

  /** 按弧长取切线角（弧度，最短角插值，跨 ±PI 无跳变） */
  tangentAngleAtS(s: number): number {
    if (this.sampleCount === 1) return this.angleArr[0];
    const clamped = Math.max(0, Math.min(this.totalLength, s));
    const i = this.lowerBound(clamped);
    if (i >= this.sampleCount - 1) return this.angleArr[i];
    const s0 = this.sArr[i];
    const s1 = this.sArr[i + 1];
    const u = s1 - s0 < 1e-9 ? 0 : (clamped - s0) / (s1 - s0);
    return lerpAngle(this.angleArr[i], this.angleArr[i + 1], u);
  }

  /** 经过点索引 -> 弧长 */
  waypointArcLength(waypointIndex: number): number {
    return this.waypointS[waypointIndex] ?? 0;
  }

  /** 最近点拾取：线性扫描采样段（双击插入/命中检测用，调用频率低） */
  nearestPoint(p: Vec2): NearestResult | null {
    if (this.sampleCount === 0) return null;
    if (this.sampleCount === 1) {
      return {
        s: 0,
        point: { x: this.xArr[0], y: this.yArr[0] },
        segmentIndex: 0,
        dist: Math.hypot(p.x - this.xArr[0], p.y - this.yArr[0]),
      };
    }

    let bestDist = Infinity;
    let bestS = 0;
    let bestX = 0;
    let bestY = 0;
    let bestSeg = 0;

    for (let i = 0; i < this.sampleCount - 1; i++) {
      const ax = this.xArr[i];
      const ay = this.yArr[i];
      const bx = this.xArr[i + 1];
      const by = this.yArr[i + 1];
      const abx = bx - ax;
      const aby = by - ay;
      const lenSq = abx * abx + aby * aby;
      let t = lenSq < 1e-9 ? 0 : ((p.x - ax) * abx + (p.y - ay) * aby) / lenSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + abx * t;
      const cy = ay + aby * t;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bestDist) {
        bestDist = d;
        bestS = this.sArr[i] + (this.sArr[i + 1] - this.sArr[i]) * t;
        bestX = cx;
        bestY = cy;
        bestSeg = this.segArr[i];
      }
    }

    return { s: bestS, point: { x: bestX, y: bestY }, segmentIndex: bestSeg, dist: bestDist };
  }

  /** 校验：相邻采样点弧长单调不减（弧长表有效性） */
  isArcLengthMonotonic(): boolean {
    for (let i = 1; i < this.sampleCount; i++) {
      if (this.sArr[i] < this.sArr[i - 1] - 1e-9) return false;
    }
    return true;
  }

  /** 校验：样条穿过每个控制点（误差在采样容差内） */
  passesThroughPoints(tolerance = TARGET_SPACING): boolean {
    return this.points.every((p) => {
      const near = this.nearestPoint(p);
      return near !== null && near.dist <= tolerance;
    });
  }

  /** 校验：经过点接头处两侧切线角连续（C1，无折角突变） */
  hasTangentContinuity(toleranceRad = 0.05): boolean {
    if (this.sampleCount < 3) return true;
    for (let wp = 1; wp < this.points.length - 1; wp++) {
      const targetS = this.waypointS[wp];
      const before = this.tangentAngleAtS(Math.max(0, targetS - 1e-3));
      const after = this.tangentAngleAtS(Math.min(this.totalLength, targetS + 1e-3));
      if (Math.abs(angleDelta(before, after)) > toleranceRad) return false;
    }
    return true;
  }
}
