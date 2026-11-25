import type { Vec3 } from './types';

type Quat = [number, number, number, number]; // x y z w

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** 把单位向量 from 旋到 to 的四元数 */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to);
  if (d < -0.999999) {
    // 反向:取任意正交轴转 180°
    let axis = cross([1, 0, 0], from);
    if (Math.hypot(...axis) < 1e-6) axis = cross([0, 1, 0], from);
    axis = norm3(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(from, to);
  const w = 1 + d;
  const l = Math.hypot(c[0], c[1], c[2], w);
  return [c[0] / l, c[1] / l, c[2] / l, w / l];
}

/** 四元数 -> 欧拉角,Babylon 的 YXZ 约定(与 mesh.rotation / toEulerAngles 一致) */
export function quatToEulerYXZ(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const sqw = w * w;
  const sqz = z * z;
  const sqx = x * x;
  const sqy = y * y;
  const zAxisY = y * z - x * w;
  const limit = 0.4999999;
  if (zAxisY < -limit) return [Math.PI / 2, 2 * Math.atan2(y, w), 0];
  if (zAxisY > limit) return [-Math.PI / 2, 2 * Math.atan2(y, w), 0];
  return [
    Math.asin(-2 * zAxisY),
    Math.atan2(2 * (z * x + y * w), sqz - sqx - sqy + sqw),
    Math.atan2(2 * (x * y + z * w), -sqz - sqx + sqy + sqw),
  ];
}

/** 让物体的 +Y 轴(圆柱长轴)朝向 dir 的欧拉角 */
export function eulerAlignYTo(dir: Vec3): Vec3 {
  return quatToEulerYXZ(quatFromUnitVectors([0, 1, 0], norm3(dir)));
}
