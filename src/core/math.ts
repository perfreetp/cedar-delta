import type { AnchorRef, LabState, MeasurePoint, Vec3 } from './types';

export const vec = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function cloneState<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export interface RayLike {
  origin: Vec3;
  direction: Vec3;
}

/** Intersect a ray with a plane given by point and unit normal. */
export function rayPlane(ray: RayLike, planePoint: Vec3, planeNormal: Vec3): Vec3 | null {
  const denom = dot(ray.direction, planeNormal);
  if (Math.abs(denom) < 1e-8) return null;
  const t = dot(sub(planePoint, ray.origin), planeNormal) / denom;
  if (!Number.isFinite(t)) return null;
  return add(ray.origin, scale(ray.direction, t));
}

/**
 * Closest parameter t on line A0 + t*N to a ray.
 * N is expected to be unit length.
 */
export function rayAxisParameter(ray: RayLike, a0: Vec3, n: Vec3): number {
  const w0 = sub(ray.origin, a0);
  const b = dot(ray.direction, n);
  const d = dot(ray.direction, w0);
  const e = dot(n, w0);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return e;
  return (e - b * d) / denom;
}

export interface Circle3 {
  center: Vec3;
  radius: number;
  normal: Vec3;
  valid: boolean;
  residual: number;
}

/** Circumcircle through three arbitrary 3D points. */
export function circumcircle3(p1: Vec3, p2: Vec3, p3: Vec3): Circle3 {
  const a = sub(p2, p1);
  const b = sub(p3, p1);
  const normal = normalize(cross(a, b));
  const a2 = dot(a, a);
  const b2 = dot(b, b);
  const ab = dot(a, b);
  const det = a2 * b2 - ab * ab;
  if (Math.abs(det) < 1e-8 || length(normal) < 1e-8) {
    return { center: p1, radius: NaN, normal: [0, 1, 0], valid: false, residual: Infinity };
  }
  const d = 2 * det;
  const alpha = (b2 * (a2 - ab)) / d;
  const beta = (a2 * (b2 - ab)) / d;
  const rel = add(scale(a, alpha), scale(b, beta));
  const center = add(p1, rel);
  const radius = distance(center, p1);
  const residual = Math.max(
    Math.abs(distance(center, p2) - radius),
    Math.abs(distance(center, p3) - radius),
  );
  return { center, radius, normal, valid: Number.isFinite(radius) && radius > 0.01, residual };
}

export interface EllipsoidSpec {
  center: Vec3;
  /** Radii in local axes before rotation. */
  radii: Vec3;
  /** Rotation around X/Y/Z in radians, applied Babylon-style Y*X*Z? We only need an orthonormal basis supplied separately. */
  basis?: [Vec3, Vec3, Vec3];
}

/** Support distance of an ellipsoid in world direction n. */
export function ellipsoidSupportRadius(spec: EllipsoidSpec, n: Vec3): number {
  const basis = spec.basis ?? [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const localN: Vec3 = [dot(n, basis[0]), dot(n, basis[1]), dot(n, basis[2])];
  return Math.sqrt(
    (spec.radii[0] * localN[0]) ** 2 +
      (spec.radii[1] * localN[1]) ** 2 +
      (spec.radii[2] * localN[2]) ** 2,
  );
}

/**
 * Exact intersection polygon of a plane n·x = planeD with a transformed unit sphere
 * x = center + basis * (radii .* q). Returns world-space boundary points.
 */
export function ellipsoidPlanePolygon(
  spec: Required<Pick<EllipsoidSpec, 'center' | 'radii'>> & { basis: [Vec3, Vec3, Vec3] },
  planeNormal: Vec3,
  planeD: number,
  segments = 96,
): { center: Vec3; points: Vec3[] } | null {
  const { center, radii, basis } = spec;
  // M = basis * diag(radii). M^T n components:
  const m: Vec3 = [
    radii[0] * dot(planeNormal, basis[0]),
    radii[1] * dot(planeNormal, basis[1]),
    radii[2] * dot(planeNormal, basis[2]),
  ];
  const mLen2 = dot(m, m);
  if (mLen2 < 1e-10) return null;
  const h = planeD - dot(planeNormal, center);
  const hOverM2 = h / mLen2;
  const q0 = scale(m, hOverM2);
  const circleR2 = 1 - (h * h) / mLen2;
  if (circleR2 <= 1e-6) return null;
  const circleR = Math.sqrt(circleR2);

  const reference = Math.abs(m[1]) < 0.9 ? ([0, 1, 0] as Vec3) : ([1, 0, 0] as Vec3);
  const u = normalize(cross(m, reference));
  const v = normalize(cross(m, u));

  const worldFromQ = (q: Vec3): Vec3 => [
    center[0] +
      radii[0] * q[0] * basis[0][0] +
      radii[1] * q[1] * basis[1][0] +
      radii[2] * q[2] * basis[2][0],
    center[1] +
      radii[0] * q[0] * basis[0][1] +
      radii[1] * q[1] * basis[1][1] +
      radii[2] * q[2] * basis[2][1],
    center[2] +
      radii[0] * q[0] * basis[0][2] +
      radii[1] * q[1] * basis[1][2] +
      radii[2] * q[2] * basis[2][2],
  ];

  const sectionCenter = worldFromQ(q0);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const q: Vec3 = [
      q0[0] + circleR * (Math.cos(a) * u[0] + Math.sin(a) * v[0]),
      q0[1] + circleR * (Math.cos(a) * u[1] + Math.sin(a) * v[1]),
      q0[2] + circleR * (Math.cos(a) * u[2] + Math.sin(a) * v[2]),
    ];
    points.push(worldFromQ(q));
  }
  return { center: sectionCenter, points };
}

/** Resolve an anchor to its current world position. */
export function resolveAnchor(anchor: AnchorRef, state: LabState): Vec3 {
  if (anchor.type === 'corneaPole') {
    // Corneal curvature sphere used by the procedural model.
    const center: Vec3 = [0, 0, 6.62];
    const radius = anchor.surface === 'anterior' ? 7.82 : 7.34;
    return [center[0], center[1], center[2] + radius];
  }
  const q: Vec3 = anchor.end === 'anterior' ? [0, 0, 1] : [0, 0, -1];
  return localLensToWorld(q, state);
}

export function lensWorldRadii(state: LabState): Vec3 {
  return [4.6 * state.lens.scaling[0], 4.6 * state.lens.scaling[1], 2.05 * state.lens.scaling[2]];
}

export function lensBasis(state: LabState): [Vec3, Vec3, Vec3] {
  if (state.lensBasis) return state.lensBasis;
  // Babylon default rotation order YXZ? For modest inspection rotations this basis
  // is built with the same combined matrix in EyeLab; math helper fallback uses XYZ.
  const [rx, ry, rz] = state.lens.rotation;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // Rz * Rx? We will instead update exact basis from Babylon matrix at runtime.
  // This fallback is only used before the engine reports its matrix.
  const r00 = cy * cz - sy * sx * sz;
  const r01 = -cx * sz;
  const r02 = sy * cz + cy * sx * sz;
  const r10 = cy * sz + sy * sx * cz;
  const r11 = cx * cz;
  const r12 = sy * sz - cy * sx * cz;
  const r20 = -sy * cx;
  const r21 = sx;
  const r22 = cy * cx;
  return [
    [r00, r10, r20],
    [r01, r11, r21],
    [r02, r12, r22],
  ];
}

export function localLensToWorld(q: Vec3, state: LabState): Vec3 {
  const basis = lensBasis(state);
  const radii = lensWorldRadii(state);
  const mx =
    radii[0] * q[0] * basis[0][0] +
    radii[1] * q[1] * basis[1][0] +
    radii[2] * q[2] * basis[2][0];
  const my =
    radii[0] * q[0] * basis[0][1] +
    radii[1] * q[1] * basis[1][1] +
    radii[2] * q[2] * basis[2][1];
  const mz =
    radii[0] * q[0] * basis[0][2] +
    radii[1] * q[1] * basis[1][2] +
    radii[2] * q[2] * basis[2][2];
  return [state.lens.position[0] + mx, state.lens.position[1] + my, state.lens.position[2] + mz];
}

export function resolvePoint(point: MeasurePoint, state: LabState): Vec3 {
  return point.anchor ? resolveAnchor(point.anchor, state) : point.p;
}

export function measurementValue(measurement: { kind: string; points: MeasurePoint[] }, state: LabState): number | undefined {
  const pts = measurement.points.map((p) => resolvePoint(p, state));
  if (measurement.kind === 'curvature' && pts.length === 3) {
    const c = circumcircle3(pts[0], pts[1], pts[2]);
    return c.valid ? c.radius : undefined;
  }
  if (pts.length >= 2) return distance(pts[0], pts[1]);
  return undefined;
}

export function formatMm(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)} mm`;
}
