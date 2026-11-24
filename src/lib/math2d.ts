/**
 * 2D 平面数学：OBB（有向包围盒）、圆形、SAT 碰撞、多边形包含与区域几何
 * 所有计算在 x-z 平面进行，y 轴为高度方向（忽略）。
 */
import type { PlacedObject, PolygonRegion, RectRegion, Vec2 } from '../types';

export interface OBB {
  x: number;
  z: number;
  /** 半宽/半深 */
  hw: number;
  hd: number;
  /** 绕 y 轴弧度 */
  rotation: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export type Footprint = { kind: 'obb'; shape: OBB } | { kind: 'circle'; shape: Circle };

let idCounter = 0;
/** 生成唯一 id（时间戳 + 计数器，避免 Math.random 不可用场景之外的冲突） */
export function uid(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function vec2(x: number, z: number): Vec2 {
  return { x, z };
}

/** 物体实际占地尺寸（含缩放） */
export function objectFootprint(o: PlacedObject): Footprint {
  const s = o.scale;
  if (footprintIsCircle(o.catalogId)) {
    return { kind: 'circle', shape: { x: o.x, z: o.z, r: (o.width * s) / 2 } };
  }
  return {
    kind: 'obb',
    shape: { x: o.x, z: o.z, hw: (o.width * s) / 2, hd: (o.depth * s) / 2, rotation: o.rotation },
  };
}

/** 圆形占地的 catalog 集合（与 catalog.ts 保持同步） */
const CIRCLE_CATALOGS = new Set(['round-table']);
export function footprintIsCircle(catalogId: string): boolean {
  return CIRCLE_CATALOGS.has(catalogId);
}

/** OBB 的 4 个角点（世界坐标） */
export function obbCorners(b: OBB): [Vec2, Vec2, Vec2, Vec2] {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  const pts: Vec2[] = [];
  for (const [lx, lz] of [
    [-b.hw, -b.hd],
    [b.hw, -b.hd],
    [b.hw, b.hd],
    [-b.hw, b.hd],
  ]) {
    pts.push({ x: b.x + lx * c - lz * s, z: b.z + lx * s + lz * c });
  }
  return pts as [Vec2, Vec2, Vec2, Vec2];
}

/** OBB 的两条投影轴（归一化） */
function obbAxes(b: OBB): [Vec2, Vec2] {
  return [
    { x: Math.cos(b.rotation), z: Math.sin(b.rotation) },
    { x: -Math.sin(b.rotation), z: Math.cos(b.rotation) },
  ];
}

function projectPts(points: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = p.x * axis.x + p.z * axis.z;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

function intervalsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** OBB vs OBB，SAT 分离轴检测 */
export function obbVsObb(a: OBB, b: OBB): boolean {
  const axes = [...obbAxes(a), ...obbAxes(b)];
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  for (const axis of axes) {
    if (!intervalsOverlap(projectPts(ca, axis), projectPts(cb, axis))) return false;
  }
  return true;
}

/** 圆 vs 圆 */
export function circleVsCircle(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const r = a.r + b.r;
  return dx * dx + dz * dz <= r * r;
}

/** OBB vs 圆：找 OBB 上离圆心最近的点，比较距离 */
export function obbVsCircle(b: OBB, c: Circle): boolean {
  // 将圆心变换到 OBB 本地坐标系
  const dx = c.x - b.x;
  const dz = c.z - b.z;
  const cos = Math.cos(-b.rotation);
  const sin = Math.sin(-b.rotation);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const nx = Math.max(-b.hw, Math.min(b.hw, lx));
  const nz = Math.max(-b.hd, Math.min(b.hd, lz));
  const ddx = lx - nx;
  const ddz = lz - nz;
  return ddx * ddx + ddz * ddz <= c.r * c.r;
}

/** 两个占地是否重叠 */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  if (a.kind === 'obb' && b.kind === 'obb') return obbVsObb(a.shape, b.shape);
  if (a.kind === 'circle' && b.kind === 'circle') return circleVsCircle(a.shape, b.shape);
  const box = a.kind === 'obb' ? a.shape : (b as { kind: 'obb'; shape: OBB }).shape;
  const cir = a.kind === 'circle' ? a.shape : (b as { kind: 'circle'; shape: Circle }).shape;
  return obbVsCircle(box, cir);
}

/** 点是否在 OBB 内（含边界） */
export function pointInOBB(p: Vec2, b: OBB): boolean {
  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const cos = Math.cos(-b.rotation);
  const sin = Math.sin(-b.rotation);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd;
}

export function pointInCircle(p: Vec2, c: Circle): boolean {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  return dx * dx + dz * dz <= c.r * c.r;
}

export function pointInFootprint(p: Vec2, f: Footprint): boolean {
  return f.kind === 'obb' ? pointInOBB(p, f.shape) : pointInCircle(p, f.shape);
}

/** 射线法：点是否在多边形内 */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 点是否在任意区域内（物体必须位于场地内） */
export function pointInAnyRegion(p: Vec2, regions: { rect: RectRegion[]; polygon: PolygonRegion[] }): boolean {
  for (const r of regions.rect) {
    if (
      pointInOBB(p, {
        x: r.x,
        z: r.z,
        hw: r.width / 2,
        hd: r.depth / 2,
        rotation: r.rotation,
      })
    )
      return true;
  }
  for (const r of regions.polygon) {
    if (pointInPolygon(p, r.points)) return true;
  }
  return false;
}

/** 矩形区域 -> 世界坐标角点 */
export function rectRegionCorners(r: RectRegion): Vec2[] {
  return obbCorners({ x: r.x, z: r.z, hw: r.width / 2, hd: r.depth / 2, rotation: r.rotation });
}

/** 区域轮廓点（用于地面 Shape 与 BVH 构建） */
export function regionOutline(r: RectRegion | PolygonRegion): Vec2[] {
  return r.type === 'rect' ? rectRegionCorners(r) : r.points;
}

/** 角度归一化到 [0, 2π) */
export function normalizeAngle(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/** 角度差，归一化到 [-π, π] */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
