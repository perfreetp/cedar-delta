import type { BrushKind, Level } from './types';

export const DIAMETER_BY_LEVEL: Record<Level, number> = {
  1: 0.34,
  2: 0.68,
  3: 1.08,
};

export const STRENGTH_BY_LEVEL: Record<Level, number> = {
  1: 0.42,
  2: 0.72,
  3: 1,
};

export const BRUSH_META: Record<
  BrushKind,
  { name: string; english: string; hint: string; shortcut: string }
> = {
  grab: {
    name: '抓取',
    english: 'Grab',
    hint: '拖动顶点，适合调整脸型与五官位置',
    shortcut: 'G',
  },
  raise: {
    name: '隆起',
    english: 'Clay / Raise',
    hint: '沿顶点法线堆积，适合垫高颧骨、鼻梁',
    shortcut: 'R',
  },
  flatten: {
    name: '压平',
    english: 'Flatten',
    hint: '把笔刷内顶点投影到取样平面',
    shortcut: 'F',
  },
  smooth: {
    name: '平滑',
    english: 'Smooth',
    hint: '按一邻接边权重松弛，减少局部塌陷',
    shortcut: 'S',
  },
};

export function smoothFalloff(t: number): number {
  const x = Math.max(0, 1 - Math.min(1, t));
  return x * x * (3 - 2 * x);
}
