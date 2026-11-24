import { beforeEach, describe, expect, it } from 'vitest';
import { buildSpline, useEditorStore, waypointIndexResolver } from './store';
import { exportChoreography, validateFile } from './io/file-io';
import { TimelineSampler } from './core/timeline';

const resetStore = (): void => {
  useEditorStore.setState({
    tool: 'path',
    stage: { imageUrl: null, worldWidth: 2400, worldHeight: 1600 },
    puppets: [],
    selectedPuppetId: null,
    selectedWaypointId: null,
    selectedKeyframeId: null,
    playback: { isPlaying: false, currentTime: 0, speed: 1, loop: false },
  });
};

describe('store 编辑操作', () => {
  beforeEach(resetStore);

  it('放置偶时创建起点经过点与首帧关键帧', () => {
    const id = useEditorStore.getState().createPuppet({ x: 100, y: 200 });
    const p = useEditorStore.getState().puppets[0];
    expect(p.id).toBe(id);
    expect(p.waypoints).toHaveLength(1);
    expect(p.waypoints[0].pos).toEqual({ x: 100, y: 200 });
    expect(p.keyframes).toHaveLength(1);
    expect(p.keyframes[0].waypointId).toBe(p.waypoints[0].id);
    expect(p.keyframes[0].timeSec).toBe(0);
  });

  it('拖画式追加经过点并连成轨迹，双击插入落在正确段内', () => {
    const s = useEditorStore.getState();
    const id = s.createPuppet({ x: 0, y: 0 });
    s.addWaypoint(id, { x: 100, y: 0 });
    s.addWaypoint(id, { x: 200, y: 0 });
    s.addWaypoint(id, { x: 300, y: 0 });
    const puppet = useEditorStore.getState().puppets.find((p) => p.id === id)!;
    expect(puppet.waypoints).toHaveLength(4);

    // 在第 1 段（索引 1 的经过点之前）插入
    s.insertWaypointAt(id, 0, { x: 50, y: 10 });
    const next = useEditorStore.getState().puppets.find((p) => p.id === id)!;
    expect(next.waypoints).toHaveLength(5);
    expect(next.waypoints[1].pos).toEqual({ x: 50, y: 10 });
    // 插入后样条仍 C1 连续
    expect(buildSpline(next).hasTangentContinuity()).toBe(true);
  });

  it('删除经过点时关键帧级联删除，且剩余轨迹平滑衔接', () => {
    const s = useEditorStore.getState();
    const id = s.createPuppet({ x: 0, y: 0 });
    const w1 = s.addWaypoint(id, { x: 120, y: 120 });
    s.addKeyframe(id, w1);
    const w2 = s.addWaypoint(id, { x: 240, y: 0 });
    s.addKeyframe(id, w2);
    const w3 = s.addWaypoint(id, { x: 360, y: 120 });
    s.addKeyframe(id, w3);

    const before = useEditorStore.getState().puppets.find((p) => p.id === id)!;
    expect(before.keyframes.length).toBe(4);
    s.removeWaypoint(id, w2);

    const after = useEditorStore.getState().puppets.find((p) => p.id === id)!;
    expect(after.waypoints.map((w) => w.id)).not.toContain(w2);
    expect(after.keyframes.map((k) => k.waypointId)).not.toContain(w2);
    const spline = buildSpline(after);
    expect(spline.hasTangentContinuity()).toBe(true);
    expect(spline.passesThroughPoints()).toBe(true);
  });

  it('删除关键帧后前后段仍可连续播放，首帧受保护不可删', () => {
    const s = useEditorStore.getState();
    const id = s.createPuppet({ x: 0, y: 0 });
    s.addWaypoint(id, { x: 100, y: 0 });
    const w2 = s.addWaypoint(id, { x: 200, y: 0 });
    const k2 = s.addKeyframe(id, w2);

    s.removeKeyframe(id, k2);
    const puppet = useEditorStore.getState().puppets.find((p) => p.id === id)!;
    expect(puppet.keyframes.map((k) => k.id)).not.toContain(k2);

    // 时间轴仍可采样（首帧保留）
    const spline = buildSpline(puppet);
    const sampler = new TimelineSampler(spline, puppet.keyframes, waypointIndexResolver(puppet));
    const pose = sampler.sampleAt(0.1);
    expect(Number.isFinite(pose.x)).toBe(true);

    // 首帧删除被拒绝
    const firstKf = puppet.keyframes[0];
    s.removeKeyframe(id, firstKf.id);
    const again = useEditorStore.getState().puppets.find((p) => p.id === id)!;
    expect(again.keyframes.some((k) => k.id === firstKf.id)).toBe(true);
  });

  it('关键帧朝向与停留时长可更新并驱动采样器', () => {
    const s = useEditorStore.getState();
    const id = s.createPuppet({ x: 0, y: 0 });
    const w1 = s.addWaypoint(id, { x: 200, y: 0 });
    const k1 = s.addKeyframe(id, w1);
    s.updateKeyframe(id, k1, { headingDeg: 90, headingOverride: true, dwellSec: 1 });

    const puppet = useEditorStore.getState().puppets.find((p) => p.id === id)!;
    const kf = puppet.keyframes.find((k) => k.id === k1)!;
    expect(kf.headingDeg).toBe(90);
    expect(kf.dwellSec).toBe(1);

    const spline = buildSpline(puppet);
    const sampler = new TimelineSampler(spline, puppet.keyframes, waypointIndexResolver(puppet));
    const pose = sampler.sampleAt(kf.timeSec + 0.5);
    expect(pose.inDwell).toBe(true);
    expect((pose.angleRad * 180) / Math.PI).toBeCloseTo(90, 0);
  });

  it('导出文件通过校验且可重新载入', () => {
    const s = useEditorStore.getState();
    const id = s.createPuppet({ x: 0, y: 0 });
    s.addWaypoint(id, { x: 100, y: 100 });
    const file = exportChoreography();
    expect(file.format).toBe('puppet-choreography');
    expect(file.version).toBe(1);
    expect(validateFile(file).ok).toBe(true);

    s.reset();
    expect(useEditorStore.getState().puppets).toHaveLength(0);
    useEditorStore.getState().loadFile(file);
    expect(useEditorStore.getState().puppets).toHaveLength(1);
    expect(useEditorStore.getState().puppets[0].waypoints).toHaveLength(2);
  });

  it('非法文件被校验拒绝', () => {
    expect(validateFile({ format: 'other' }).ok).toBe(false);
    expect(validateFile(null).ok).toBe(false);
    expect(
      validateFile({
        format: 'puppet-choreography',
        version: 1,
        stage: { imageUrl: null, worldWidth: 100, worldHeight: 100 },
        puppets: [{ id: 'x', name: '坏偶', waypoints: [], keyframes: [] }],
      }).ok,
    ).toBe(false);
  });

  it('压测偶生成数千经过点后样条仍连续且弧长单调', () => {
    const s = useEditorStore.getState();
    s.addStressPuppet(3000);
    const puppet = useEditorStore.getState().puppets[0];
    expect(puppet.waypoints).toHaveLength(3000);
    const spline = buildSpline(puppet);
    expect(spline.isArcLengthMonotonic()).toBe(true);
    expect(spline.hasTangentContinuity(0.1)).toBe(true);
    expect(spline.sampleCount).toBeGreaterThan(3000);
  });
});
