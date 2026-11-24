import type { Vec2 } from '../types';

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const normalize = (a: Vec2): Vec2 => {
  const len = Math.hypot(a.x, a.y);
  return len < 1e-9 ? { x: 1, y: 0 } : { x: a.x / len, y: a.y / len };
};

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** 角度（弧度）差分，归一化到 (-PI, PI] */
export const angleDelta = (a: number, b: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/** 沿最短弧向 b 插值角度（弧度） */
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;

export const radToDeg = (r: number): number => (r * 180) / Math.PI;
export const degToRad = (d: number): number => (d * Math.PI) / 180;

/** 点到线段的最近距离与投影参数 t (0..1) */
export const distToSegment = (p: Vec2, a: Vec2, b: Vec2): { dist: number; t: number; closest: Vec2 } => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq < 1e-9 ? 0 : Math.min(1, Math.max(0, (apx * abx + apy * aby) / lenSq));
  const closest = { x: a.x + abx * t, y: a.y + aby * t };
  return { dist: distance(p, closest), t, closest };
};
