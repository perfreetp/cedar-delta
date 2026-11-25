/**
 * 参数化下颌牙弓与牙槽嵴曲面。
 *
 * 牙弓中线用抛物线（马蹄形）：
 *   center(u) = (A*u, Y0 + crown(u), B*u^2 - C), u ∈ [-1, 1]
 * 牙槽嵴曲面在中线两侧沿侧向展开，并带圆钝的嵴顶剖面：
 *   surface(u, v) = center(u) + lateral(u) * v + up * (-K * v^2)
 *
 * 所有几何均为毫米单位。
 */
import { v3, type Vec3Tuple } from './math';

export interface ArchParams {
  /** 牙弓半宽（左右尖牙间距的一半量级） */
  halfWidth: number;
  /** 抛物线前后向系数（越大越狭长） */
  depth: number;
  /** 前端 z 偏移（把牙弓挪到场景前方） */
  frontOffset: number;
  /** 基础骨面高度 */
  baseY: number;
  /** 嵴顶相对基础高度的隆起 */
  crownHeight: number;
  /** 嵴顶剖面二次系数（横向圆钝度） */
  ridgeCurvature: number;
  /** 嵴面侧向半宽（可吸附带宽） */
  ridgeHalfWidth: number;
}

export const DEFAULT_ARCH: ArchParams = {
  halfWidth: 28,
  depth: 34,
  frontOffset: 26,
  baseY: 0,
  crownHeight: 8,
  ridgeCurvature: 0.045,
  ridgeHalfWidth: 7,
};

export interface RidgeFrame {
  u: number;
  v: number;
  point: Vec3Tuple;
  /** 曲面外法向（朝上） */
  normal: Vec3Tuple;
  /** 沿牙弓走向的切线 */
  tangent: Vec3Tuple;
  /** 侧向切线（垂直牙弓走向、近似水平） */
  lateral: Vec3Tuple;
}

export class DentalArch {
  constructor(readonly params: ArchParams = DEFAULT_ARCH) {}

  /** 牙弓中线位置（嵴顶，v=0） */
  center(u: number): Vec3Tuple {
    const p = this.params;
    return [
      p.halfWidth * u,
      p.baseY + p.crownHeight * (1 - 0.35 * u * u),
      p.depth * u * u - p.frontOffset,
    ];
  }

  /** 中线处沿 u 的切向量（未归一化） */
  private dCenter(u: number): Vec3Tuple {
    const p = this.params;
    return [p.halfWidth, p.crownHeight * (-0.7 * u), 2 * p.depth * u];
  }

  /** 侧向单位向量（XZ 平面内垂直于中线水平投影） */
  lateral(u: number): Vec3Tuple {
    const t = this.dCenter(u);
    const horiz: Vec3Tuple = [t[0], 0, t[2]];
    const n = v3.normalize(horiz);
    // lateral = 水平切线绕 Y 旋转 90°
    return v3.normalize([-n[2], 0, n[0]]);
  }

  /** 牙槽嵴曲面点 */
  surface(u: number, v: number): Vec3Tuple {
    const c = this.center(u);
    const lat = this.lateral(u);
    return v3.add(c, v3.add(v3.scale(lat, v), [0, -this.params.ridgeCurvature * v * v, 0]));
  }

  /** 曲面标架（法向由两个偏导向量叉乘得到，保证朝上） */
  frame(u: number, v: number): RidgeFrame {
    const eps = 1e-4;
    const du = v3.normalize(
      v3.sub(this.surface(Math.min(1, u + eps), v), this.surface(Math.max(-1, u - eps), v)),
    );
    const dv = v3.normalize(
      v3.sub(this.surface(u, v + eps), this.surface(u, Math.max(-this.params.ridgeHalfWidth, v - eps))),
    );
    let normal = v3.normalize(v3.cross(du, dv));
    if (normal[1] < 0) normal = v3.scale(normal, -1);
    return {
      u,
      v,
      point: this.surface(u, v),
      normal,
      tangent: du,
      lateral: dv,
    };
  }

  /**
   * 最近点查询：先在离散 u 网格上粗搜，再黄金分割细化；
   * v 在给定 u 下做一维二次距离最小化（闭式 + 一次牛顿修正）。
   */
  closestPoint(target: Vec3Tuple, gridSize = 192): RidgeFrame {
    let bestU = 0;
    let bestD = Infinity;
    for (let i = 0; i <= gridSize; i++) {
      const u = -1 + (2 * i) / gridSize;
      const d = v3.dist(this.surface(u, this.bestV(u, target)), target);
      if (d < bestD) {
        bestD = d;
        bestU = u;
      }
    }
    // 黄金分割细化 u
    const gr = (Math.sqrt(5) - 1) / 2;
    let lo = Math.max(-1, bestU - 2 / gridSize);
    let hi = Math.min(1, bestU + 2 / gridSize);
    let x1 = hi - gr * (hi - lo);
    let x2 = lo + gr * (hi - lo);
    for (let iter = 0; iter < 24; iter++) {
      const d1 = v3.dist(this.surface(x1, this.bestV(x1, target)), target);
      const d2 = v3.dist(this.surface(x2, this.bestV(x2, target)), target);
      if (d1 < d2) hi = x2;
      else lo = x1;
      x1 = hi - gr * (hi - lo);
      x2 = lo + gr * (hi - lo);
    }
    const u = (lo + hi) / 2;
    const vv = Math.max(
      -this.params.ridgeHalfWidth,
      Math.min(this.params.ridgeHalfWidth, this.bestV(u, target)),
    );
    return this.frame(u, vv);
  }

  /** 固定 u 时最优 v：点到 center(u) 向量在 lateral 上的投影，再用曲率项做一次修正 */
  private bestV(u: number, target: Vec3Tuple): number {
    const c = this.center(u);
    const lat = this.lateral(u);
    const v0 = v3.dot(v3.sub(target, c), lat);
    // 曲面 y 随 -K v² 下降，目标高度差给出 v 的小修正（牛顿一步）
    const dy = target[1] - c[1];
    const correction = dy === 0 ? 0 : dy / (2 * this.params.ridgeCurvature * Math.max(1e-3, Math.abs(v0)) + 1);
    return v0 - correction * 0.25;
  }

  /** 沿牙弓按弧长均匀取 n 个位点（用于初始套管布置与等间距对齐） */
  samplesByArc(n: number): { u: number; point: Vec3Tuple; frame: RidgeFrame }[] {
    const table = this.arcTable(400);
    const out: { u: number; point: Vec3Tuple; frame: RidgeFrame }[] = [];
    for (let i = 0; i < n; i++) {
      const s = table.total * ((i + 1) / (n + 1));
      const u = this.uAtArc(table, s);
      out.push({ u, point: this.surface(u, 0), frame: this.frame(u, 0) });
    }
    return out;
  }

  private arcTable(segments: number): { cum: number[]; total: number } {
    const cum = [0];
    let prev = this.center(-1);
    for (let i = 1; i <= segments; i++) {
      const u = -1 + (2 * i) / segments;
      const p = this.center(u);
      cum.push(cum[i - 1] + v3.dist(prev, p));
      prev = p;
    }
    return { cum, total: cum[segments] };
  }

  private uAtArc(table: { cum: number[] }, s: number): number {
    const { cum } = table;
    let i = 0;
    while (i < cum.length - 1 && cum[i + 1] < s) i++;
    const segLen = cum[i + 1] - cum[i] || 1;
    const t = (s - cum[i]) / segLen;
    const segments = cum.length - 1;
    return -1 + (2 * (i + t)) / segments;
  }

  /** 下颌骨体区域内的伪随机采样点（标记点云用），用确定性 LCG 保证可复现 */
  sampleBonePoints(count: number, seed = 42): Vec3Tuple[] {
    let state = seed >>> 0;
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const pts: Vec3Tuple[] = [];
    const p = this.params;
    let guard = 0;
    while (pts.length < count && guard++ < count * 20) {
      const u = -1 + 2 * rand();
      const v = (rand() * 2 - 1) * (p.ridgeHalfWidth + 9);
      const s = this.surface(u, v);
      // 骨体有厚度：在曲面下方散布，并加少量侧向散点
      const depth = rand() * 14;
      pts.push([s[0] + (rand() - 0.5) * 1.5, s[1] - depth, s[2] + (rand() - 0.5) * 1.5]);
    }
    return pts;
  }
}
