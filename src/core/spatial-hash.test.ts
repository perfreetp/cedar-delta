import { describe, expect, it } from 'vitest';
import { SpatialHash, resolvePick } from './spatial-hash';
import type { HashEntry } from '../types';

describe('SpatialHash', () => {
  const entries: HashEntry<string>[] = [];
  for (let i = 0; i < 2000; i++) {
    entries.push({ x: (i % 50) * 40 + 5, y: Math.floor(i / 50) * 40 + 5, ref: `p${i}` });
  }

  it('半径查询只返回邻域条目', () => {
    const hash = new SpatialHash<string>(48);
    hash.rebuild(entries);
    const got = hash.queryRadius({ x: 100, y: 100 }, 30);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((e) => Math.hypot(e.x - 100, e.y - 100) <= 30 + 48)).toBe(true);
  });

  it('同位置重叠点按确定性规则选中（偏好已选偶）', () => {
    const cands = [
      { ref: 'a', dist: 4, tieOrder: 0 },
      { ref: 'b', dist: 4, tieOrder: 1 },
      { ref: 'c', dist: 6, tieOrder: 2 },
    ];
    expect(resolvePick(cands, () => false)).toBe('a');
    expect(resolvePick(cands, (r) => r === 'b')).toBe('b');
    expect(resolvePick([], () => false)).toBeNull();
  });

  it('最近距离优先于偏好', () => {
    const cands = [
      { ref: 'a', dist: 2, tieOrder: 0 },
      { ref: 'b', dist: 9, tieOrder: 1 },
    ];
    expect(resolvePick(cands, (r) => r === 'b')).toBe('a');
  });
});
