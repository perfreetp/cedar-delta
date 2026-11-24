import type { HashEntry, Vec2 } from '../types';

export type { HashEntry } from '../types';

/**
 * 均匀网格空间哈希。
 *
 * 经过点数量到数千时，直接遍历全部点做命中检测会让指针交互卡顿；
 * 网格把每次拾取降到均摊 O(1)。每次数据变更后整体重建（数千点仍是亚毫秒级）。
 */
export class SpatialHash<T> {
  private readonly gridSize: number;
  private readonly cells = new Map<number, HashEntry<T>[]>();

  constructor(gridSize = 48) {
    this.gridSize = gridSize;
  }

  private key(cx: number, cy: number): number {
    // 限定坐标范围后配对成单值 key，避免字符串拼接开销
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  rebuild(entries: HashEntry<T>[]): void {
    this.cells.clear();
    for (const e of entries) {
      const cx = Math.floor(e.x / this.gridSize);
      const cy = Math.floor(e.y / this.gridSize);
      const k = this.key(cx, cy);
      const bucket = this.cells.get(k);
      if (bucket) bucket.push(e);
      else this.cells.set(k, [e]);
    }
  }

  /** 查询半径内的全部候选条目（已覆盖半径跨越的所有相邻格子） */
  queryRadius(p: Vec2, radius: number): HashEntry<T>[] {
    const minCx = Math.floor((p.x - radius) / this.gridSize);
    const maxCx = Math.floor((p.x + radius) / this.gridSize);
    const minCy = Math.floor((p.y - radius) / this.gridSize);
    const maxCy = Math.floor((p.y + radius) / this.gridSize);
    const out: HashEntry<T>[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }

  get cellCount(): number {
    return this.cells.size;
  }
}

/** 选中优先级解析：距离最近；同距时优先当前已选偶，再取较小 id 次序，保证结果确定 */
export interface PickCandidate<T> {
  ref: T;
  dist: number;
  tieOrder: number;
}

export function resolvePick<T>(
  candidates: PickCandidate<T>[],
  isPreferred: (ref: T) => boolean,
): T | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    if (
      c.dist < best.dist - 1e-6 ||
      (Math.abs(c.dist - best.dist) <= 1e-6 && isPreferred(c.ref) && !isPreferred(best.ref)) ||
      (Math.abs(c.dist - best.dist) <= 1e-6 &&
        isPreferred(c.ref) === isPreferred(best.ref) &&
        c.tieOrder < best.tieOrder)
    ) {
      best = c;
    }
  }
  return best.ref;
}