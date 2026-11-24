import { describe, expect, it } from 'vitest';
import { Spline } from './spline';
import { angleDelta } from './vec';
import type { Vec2 } from '../types';

const pts = (coords: [number, number][]): Vec2[] => coords.map(([x, y]) => ({ x, y }));

describe('Spline 基础性质', () => {
  it('穿过全部控制点', () => {
    const spline = new Spline(pts([[0, 0], [100, 50], [200, 0], [300, 80], [400, 20]]));
    expect(spline.passesThroughPoints()).toBe(true);
  });

  it('弧长表单调递增', () => {
    const many: [number, number][] = [];
    for (let i = 0; i < 3000; i++) many.push([i * 12, Math.sin(i * 0.05) * 60]);
    const spline = new Spline(pts(many));
    expect(spline.isArcLengthMonotonic()).toBe(true);
    expect(spline.sampleCount).toBeGreaterThan(3000);
  });

  it('首尾弧长与位置正确', () => {
    const spline = new Spline(pts([[0, 0], [100, 0], [200, 0]]));
    expect(spline.totalLength).toBeCloseTo(200, 0);
    const p0 = spline.pointAtS(0);
    const p1 = spline.pointAtS(spline.totalLength);
    expect(p0.x).toBeCloseTo(0);
    expect(p1.x).toBeCloseTo(200, 0);
  });

  it('经过点弧长表与采样一致', () => {
    const spline = new Spline(pts([[0, 0], [100, 30], [200, -30]]));
    for (let i = 0; i < spline.waypointS.length; i++) {
      const p = spline.pointAtS(spline.waypointS[i]);
      expect(Math.hypot(p.x - spline.points[i].x, p.y - spline.points[i].y)).toBeLessThan(12);
    }
  });
});

describe('删除/插入点后平滑衔接（无折角突变）', () => {
  const zigzag: [number, number][] = [
    [0, 0],
    [120, 120],
    [240, 0],
    [360, 120],
    [480, 0],
    [600, 120],
  ];

  it('原始样条在所有经过点处 C1 连续', () => {
    const spline = new Spline(pts(zigzag));
    expect(spline.hasTangentContinuity()).toBe(true);
  });

  it('删除中间经过点后，接头处仍 C1 连续', () => {
    const reduced = zigzag.filter((_, i) => i !== 2);
    const spline = new Spline(pts(reduced));
    expect(spline.passesThroughPoints()).toBe(true);
    expect(spline.hasTangentContinuity()).toBe(true);
  });

  it('在段中插入经过点后，接头处仍 C1 连续且轨迹穿过插入点', () => {
    const base = new Spline(pts(zigzag));
    const insertAt = base.pointAtS(base.totalLength * 0.37);
    const withInsert: [number, number][] = [];
    withInsert.push(zigzag[0], zigzag[1], [insertAt.x, insertAt.y], zigzag[2], zigzag[3], zigzag[4], zigzag[5]);
    const spline = new Spline(pts(withInsert));
    expect(spline.passesThroughPoints()).toBe(true);
    expect(spline.hasTangentContinuity()).toBe(true);
  });

  it('拖动经过点仅改变坐标不改变点数，样条重建后仍连续', () => {
    const moved = pts(zigzag);
    moved[3] = { x: 360, y: -200 };
    const spline = new Spline(moved);
    expect(spline.hasTangentContinuity()).toBe(true);
  });
});

describe('拐弯处切线朝向', () => {
  it('直线段切线角恒定', () => {
    const spline = new Spline(pts([[0, 0], [100, 0], [200, 0]]));
    expect(spline.tangentAngleAtS(50)).toBeCloseTo(0, 3);
    expect(spline.tangentAngleAtS(150)).toBeCloseTo(0, 3);
  });

  it('90 度拐弯处切线角平滑过渡、无 ±PI 跳变', () => {
    const spline = new Spline(pts([[0, 0], [100, 0], [100, 100], [0, 100]]));
    let prev = spline.tangentAngleAtS(0);
    let maxJump = 0;
    for (let s = 5; s <= spline.totalLength; s += 5) {
      const a = spline.tangentAngleAtS(s);
      maxJump = Math.max(maxJump, Math.abs(angleDelta(prev, a)));
      prev = a;
    }
    // 采样间隔 5px 下每步变化 < 16°，即拐弯被平滑分摊而非折角
    expect(maxJump).toBeLessThan(0.28);
  });

  it('nearestPoint 返回正确段索引', () => {
    const spline = new Spline(pts([[0, 0], [100, 0], [200, 0], [300, 0]]));
    const near = spline.nearestPoint({ x: 250, y: 20 });
    expect(near).not.toBeNull();
    expect(near!.segmentIndex).toBe(2);
    expect(near!.dist).toBeLessThan(21);
  });
});

describe('数千点规模', () => {
  it('3000 经过点构建与查询保持亚毫秒~毫秒级', () => {
    const many: [number, number][] = [];
    for (let i = 0; i < 3000; i++) many.push([i * 10, (i % 7) * 9]);
    const t0 = performance.now();
    const spline = new Spline(pts(many));
    const buildMs = performance.now() - t0;
    expect(buildMs).toBeLessThan(200);

    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) {
      spline.pointAtS((i / 1000) * spline.totalLength);
      spline.tangentAngleAtS((i / 1000) * spline.totalLength);
    }
    const queryMs = performance.now() - t1;
    expect(queryMs).toBeLessThan(50);
  });
});
