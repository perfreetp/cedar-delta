// 场景布局常量:骨骼、钉道、入口点(时间轴演示关键帧与 3D 场景共用)
import type { Vec3 } from './timeline/types';

/** 钉道入口点(骨面开孔处) */
export const ENTRY: Vec3 = [2.0, 1.4, 0.9];
/** 钉道末端(骨内) */
export const TIP: Vec3 = [-1.6, -0.5, -0.4];
/** 骨骼:沿 X 轴的圆柱 */
export const BONE = { center: [0, 0, 0] as Vec3, length: 6, radius: 0.9 };

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function mul(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function norm(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** 钉道方向(入口 -> 末端,单位向量) */
export const TUNNEL_DIR: Vec3 = norm(sub(TIP, ENTRY));
