import { describe, expect, it } from 'vitest';
import { Spline } from './spline';
import { TimelineSampler, computeDefaultKeyframeTime } from './timeline';
import type { Keyframe, Vec2 } from '../types';
import { angleDelta, radToDeg } from './vec';

const path: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
];

const makeKf = (over: Partial<Keyframe> & { waypointId: string }): Keyframe => ({
  id: over.id ?? `k-${over.waypointId}`,
  waypointId: over.waypointId,
  timeSec: over.timeSec ?? 0,
  dwellSec: over.dwellSec ?? 0,
  headingDeg: over.headingDeg ?? null,
  headingOverride: over.headingOverride ?? false,
});

describe('TimelineSampler', () => {
  const spline = new Spline(path);
  const ids = ['w0', 'w1', 'w2', 'w3', 'w4'];
  const resolver = (id: string): number => ids.indexOf(id);
  const sAt = (i: number): number => spline.waypointArcLength(i);

  it('行进段沿弧长匀速、位置单调', () => {
    const kfs = [
      makeKf({ waypointId: 'w0', timeSec: 0 }),
      makeKf({ waypointId: 'w4', timeSec: 4 }),
    ];
    const sampler = new TimelineSampler(spline, kfs, resolver);
    let prevS = -1;
    for (let t = 0; t <= 4; t += 0.2) {
      const pose = sampler.sampleAt(t);
      const near = spline.nearestPoint({ x: pose.x, y: pose.y })!;
      expect(near.s).toBeGreaterThanOrEqual(prevS - 0.01);
      prevS = near.s;
    }
    expect(sampler.durationSec).toBe(4);
  });

  it('停留期位置与朝向保持不变', () => {
    const kfs = [
      makeKf({ waypointId: 'w0', timeSec: 0, dwellSec: 1 }),
      makeKf({ waypointId: 'w2', timeSec: 3 }),
    ];
    const sampler = new TimelineSampler(spline, kfs, resolver);
    const a = sampler.sampleAt(0.2);
    const b = sampler.sampleAt(0.9);
    expect(a.inDwell).toBe(true);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    expect(a.angleRad).toBeCloseTo(b.angleRad);

    const moving = sampler.sampleAt(2);
    expect(moving.inDwell).toBe(false);
  });

  it('拐弯处跟随切线：转角随轨迹平滑变化', () => {
    const kfs = [makeKf({ waypointId: 'w0', timeSec: 0 }), makeKf({ waypointId: 'w4', timeSec: 4 })];
    const sampler = new TimelineSampler(spline, kfs, resolver);
    let prev = sampler.sampleAt(0).angleRad;
    let maxJump = 0;
    for (let t = 0.1; t <= 4; t += 0.1) {
      const pose = sampler.sampleAt(t);
      maxJump = Math.max(maxJump, Math.abs(angleDelta(prev, pose.angleRad)));
      prev = pose.angleRad;
    }
    // 每 0.1s 朝向变化无突变：90° 急弯被平滑分摊（< 30°/步，折角突变会接近 90°）
    expect(radToDeg(maxJump)).toBeLessThan(30);
  });

  it('显式朝向在区间两端与切线平滑混合，无跳变', () => {
    const straight: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
      { x: 400, y: 0 },
    ];
    const straightSpline = new Spline(straight);
    const kfs = [
      makeKf({ waypointId: 'w0', timeSec: 0, headingDeg: 90, headingOverride: true }),
      makeKf({ waypointId: 'w4', timeSec: 4 }),
    ];
    const sampler = new TimelineSampler(straightSpline, kfs, resolver);
    const start = sampler.sampleAt(0);
    expect(radToDeg(start.angleRad)).toBeCloseTo(90, 1);
    const end = sampler.sampleAt(4);
    // 直线终点切线为水平向右，显式朝向已平滑交还切线
    expect(radToDeg(end.angleRad)).toBeCloseTo(0, 1);

    let prev = start.angleRad;
    let maxJump = 0;
    for (let t = 0.05; t <= 4; t += 0.05) {
      const a = sampler.sampleAt(t).angleRad;
      maxJump = Math.max(maxJump, Math.abs(angleDelta(prev, a)));
      prev = a;
    }
    expect(radToDeg(maxJump)).toBeLessThan(10);
  });

  it('首帧之前在起点等待，末帧之后保持末姿态', () => {
    const kfs = [
      makeKf({ waypointId: 'w0', timeSec: 2, dwellSec: 0.5 }),
      makeKf({ waypointId: 'w4', timeSec: 6 }),
    ];
    const sampler = new TimelineSampler(spline, kfs, resolver);
    const before = sampler.sampleAt(0.5);
    expect(before.x).toBeCloseTo(0);
    expect(before.y).toBeCloseTo(0);
    expect(before.inDwell).toBe(true);
    const after = sampler.sampleAt(99);
    expect(after.x).toBeCloseTo(path[4].x, 0);
    expect(after.y).toBeCloseTo(path[4].y, 0);
  });

  it('默认时刻按弧长/默认速度推算并保持递增', () => {
    const existing: Keyframe[] = [makeKf({ waypointId: 'w0', timeSec: 0 })];
    const t1 = computeDefaultKeyframeTime(spline, existing, 1);
    expect(t1).toBeCloseTo(sAt(1) / 220, 1);
    existing.push(makeKf({ waypointId: 'w1', timeSec: 10 }));
    const t2 = computeDefaultKeyframeTime(spline, existing, 2);
    expect(t2).toBeGreaterThan(10);
  });
});
