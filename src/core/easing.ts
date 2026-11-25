/**
 * 缓动 / 插值引擎
 *
 * 三种插值：linear（线性）、ease（缓动，平滑 S 曲线）、step（阶跃）。
 * 正向函数用于「局部时间 -> 全局时间」以及关键帧数值混合；
 * 逆向函数用于拖拽关键帧时把全局位置反解回局部时间，
 * 保证「拖预览」与「播放回放」走的是同一条数学曲线。
 */
import type { EasingType } from './model';

export const EASING_LABELS: Record<EasingType, string> = {
  linear: '线性',
  ease: '缓动',
  step: '阶跃',
};

/** 正向缓动：输入输出均在 [0,1] */
export function easingForward(type: EasingType, x: number): number {
  const cx = clamp01(x);
  switch (type) {
    case 'linear':
      return cx;
    case 'ease':
      return smoothstep(cx);
    case 'step':
      // 阶跃：过半即跳变
      return cx < 0.5 ? 0 : 1;
  }
}

/**
 * 逆向缓动：给定 y 求 x。
 * linear / ease 用解析反函数；step 为离散函数，按半区间返回中点。
 */
export function easingInverse(type: EasingType, y: number): number {
  const cy = clamp01(y);
  switch (type) {
    case 'linear':
      return cy;
    case 'ease':
      return inverseSmoothstep(cy);
    case 'step':
      return cy < 0.5 ? 0.25 : 0.75;
  }
}

/** 3x² − 2x³，平滑 S 曲线，端点导数为 0 */
export function smoothstep(x: number): number {
  const cx = clamp01(x);
  return cx * cx * (3 - 2 * cx);
}

/**
 * smoothstep 的反函数。
 * smoothstep 在 [0,1] 上严格单调连续，这里用 40 次二分求逆，
 * 误差 < 2^-40，避免解析公式的推导风险，且与 smoothstep 严格互逆。
 */
export function inverseSmoothstep(y: number): number {
  const cy = clamp01(y);
  if (cy <= 0) return 0;
  if (cy >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (smoothstep(mid) < cy) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 两个关键帧之间按插值类型混合数值。
 * - linear：直接线性
 * - ease：段内用 smoothstep 缓动
 * - step：未到下一关键帧前保持当前关键帧的值
 */
export function blendValues(a: number, b: number, t: number, type: EasingType): number {
  switch (type) {
    case 'linear':
      return lerp(a, b, t);
    case 'ease':
      return lerp(a, b, smoothstep(t));
    case 'step':
      return t >= 1 ? b : a;
  }
}

/** 角度插值（弧度），走最短弧，保证相机方位角旋转方向正确 */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** 三维向量线性插值 */
export function lerpVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * 在按 time 升序排列的关键帧序列中定位采样区间。
 * 返回 [前一帧下标, 后一帧下标, 段内进度 t(0..1)]；
 * 落在首帧之前/末帧之后时做端点钳制。
 */
export function locateSegment(
  frames: ReadonlyArray<{ time: number }>,
  localTime: number,
): { prev: number; next: number; t: number } {
  if (frames.length === 0) {
    return { prev: -1, next: -1, t: 0 };
  }
  if (frames.length === 1 || localTime <= frames[0].time) {
    return { prev: 0, next: 0, t: 0 };
  }
  const last = frames.length - 1;
  if (localTime >= frames[last].time) {
    return { prev: last, next: last, t: 0 };
  }
  // 有序序列，二分查找
  let lo = 0;
  let hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time <= localTime) lo = mid;
    else hi = mid;
  }
  const span = frames[hi].time - frames[lo].time;
  const t = span <= 1e-9 ? 0 : (localTime - frames[lo].time) / span;
  return { prev: lo, next: hi, t };
}

/** 排序关键帧（原地），并把 time 钳制到 [0,1] */
export function sortKeyframes<T extends { time: number; id: string }>(frames: T[]): T[];
export function sortKeyframes(frames: Array<{ time: number; id: string }>): Array<{ time: number; id: string }> {
  for (const f of frames) f.time = clamp01(f.time);
  frames.sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
  return frames;
}
