/**
 * 最小自研 3D 数学库（纯 TS，无引擎依赖），便于单元测试与撤销快照序列化。
 * 坐标系约定：X = 左右，Y = 竖直向上，Z = 前后；下颌牙弓位于 XZ 平面附近。
 */

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number]; // x,y,z,w

export const v3 = {
  add: (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3Tuple, s: number): Vec3Tuple => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3Tuple, b: Vec3Tuple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3Tuple): number => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3Tuple, b: Vec3Tuple): number => v3.len(v3.sub(a, b)),
  normalize(a: Vec3Tuple): Vec3Tuple {
    const l = v3.len(a);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  lerp: (a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  clone: (a: Vec3Tuple): Vec3Tuple => [a[0], a[1], a[2]],
  equal: (a: Vec3Tuple, b: Vec3Tuple, eps = 1e-9): boolean => v3.dist(a, b) <= eps,
};

export const q = {
  identity: (): QuatTuple => [0, 0, 0, 1],
  /** 绕单位轴 axis 旋转 angle（弧度） */
  fromAxisAngle(axis: Vec3Tuple, angle: number): QuatTuple {
    const h = angle * 0.5;
    const s = Math.sin(h);
    const n = v3.normalize(axis);
    return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)];
  },
  mul: (a: QuatTuple, b: QuatTuple): QuatTuple => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conjugate: (a: QuatTuple): QuatTuple => [-a[0], -a[1], -a[2], a[3]],
  rotateVec(a: QuatTuple, v: Vec3Tuple): Vec3Tuple {
    // q * v * q* 的展开形式
    const [x, y, z, w] = a;
    const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [
      vx + w * tx + (y * tz - z * ty),
      vy + w * ty + (z * tx - x * tz),
      vz + w * tz + (x * ty - y * tx),
    ];
  },
  /** 由两个单位向量构造最短旋转四元数 */
  fromTo(from: Vec3Tuple, to: Vec3Tuple): QuatTuple {
    const f = v3.normalize(from);
    const t = v3.normalize(to);
    const d = Math.min(1, Math.max(-1, v3.dot(f, t)));
    if (d > 1 - 1e-9) return q.identity();
    if (d < -1 + 1e-9) {
      const axis = v3.normalize(v3.cross([0, 1, 0], f));
      const fallback: Vec3Tuple = v3.len(axis) < 1e-6 ? [1, 0, 0] : axis;
      return q.fromAxisAngle(fallback, Math.PI);
    }
    const c = v3.normalize(v3.cross(f, t));
    const ang = Math.acos(d);
    return q.fromAxisAngle(c, ang);
  },
  /** 构造使 localY 对齐 normal、localZ 对齐 tangentHint（Gram-Schmidt 正交化）的姿态 */
  fromFrame(normal: Vec3Tuple, tangentHint: Vec3Tuple): QuatTuple {
    const yAxis = v3.normalize(normal);
    let zAxis = v3.sub(tangentHint, v3.scale(yAxis, v3.dot(tangentHint, yAxis)));
    if (v3.len(zAxis) < 1e-9) zAxis = v3.sub([0, 0, 1], v3.scale(yAxis, yAxis[2]));
    zAxis = v3.normalize(zAxis);
    const xAxis = v3.normalize(v3.cross(yAxis, zAxis));
    // 旋转矩阵（列主序）→ 四元数
    return q.fromMat3Columns(xAxis, yAxis, zAxis);
  },
  fromMat3Columns(xAxis: Vec3Tuple, yAxis: Vec3Tuple, zAxis: Vec3Tuple): QuatTuple {
    const m00 = xAxis[0], m01 = yAxis[0], m02 = zAxis[0];
    const m10 = xAxis[1], m11 = yAxis[1], m12 = zAxis[1];
    const m20 = xAxis[2], m21 = yAxis[2], m22 = zAxis[2];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      return [
        (m21 - m12) / s,
        (m02 - m20) / s,
        (m10 - m01) / s,
        0.25 * s,
      ];
    }
    if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
    }
    if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
    }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  },
  slerp(a: QuatTuple, b: QuatTuple, t: number): QuatTuple {
    let [x, y, z, w] = b;
    let cos = a[0] * x + a[1] * y + a[2] * z + a[3] * w;
    if (cos < 0) {
      x = -x; y = -y; z = -z; w = -w;
      cos = -cos;
    }
    if (cos > 1 - 1e-6) {
      const raw: QuatTuple = [
        a[0] + t * (x - a[0]),
        a[1] + t * (y - a[1]),
        a[2] + t * (z - a[2]),
        a[3] + t * (w - a[3]),
      ];
      const l = Math.hypot(raw[0], raw[1], raw[2], raw[3]) || 1;
      return [raw[0] / l, raw[1] / l, raw[2] / l, raw[3] / l];
    }
    const theta = Math.acos(Math.min(1, cos));
    const sin = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sin;
    const wb = Math.sin(t * theta) / sin;
    return [
      a[0] * wa + x * wb,
      a[1] * wa + y * wb,
      a[2] * wa + z * wb,
      a[3] * wa + w * wb,
    ];
  },
  clone: (a: QuatTuple): QuatTuple => [a[0], a[1], a[2], a[3]],
};

export interface Ray {
  origin: Vec3Tuple;
  dir: Vec3Tuple; // 单位向量
}

export const ray = {
  /** 射线到点的最近距离参数 t 及最近点 */
  closestPoint(r: Ray, p: Vec3Tuple): { t: number; point: Vec3Tuple } {
    const t = v3.dot(v3.sub(p, r.origin), r.dir);
    return { t, point: v3.add(r.origin, v3.scale(r.dir, t)) };
  },
  /** 射线与有限圆柱（轴线 a→b，半径 r）求交，返回沿射线最近的 t；不相交返回 null */
  intersectCylinder(
    r: Ray,
    a: Vec3Tuple,
    b: Vec3Tuple,
    radius: number,
  ): number | null {
    const ax = v3.normalize(v3.sub(b, a));
    // 解 |(o + t d) - (a + s ax)|^2 = radius^2，对 s 消元
    const dp = v3.sub(r.origin, a);
    const dPerp = v3.sub(r.dir, v3.scale(ax, v3.dot(r.dir, ax)));
    const pPerp = v3.sub(dp, v3.scale(ax, v3.dot(dp, ax)));
    const A = v3.dot(dPerp, dPerp);
    const B = 2 * v3.dot(dPerp, pPerp);
    const C = v3.dot(pPerp, pPerp) - radius * radius;
    const height = v3.dist(a, b);
    let best: number | null = null;
    if (A < 1e-12) return null;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
      if (t < 0) continue;
      const hit = v3.add(r.origin, v3.scale(r.dir, t));
      const s = v3.dot(v3.sub(hit, a), ax);
      if (s >= 0 && s <= height && (best === null || t < best)) best = t;
    }
    return best;
  },
};

/** 角度归一化到 [-PI, PI] */
export const wrapAngle = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
