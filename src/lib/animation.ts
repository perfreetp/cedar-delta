import type { Joint, JointPose, Keyframe, RigDocument } from '../types';
import { clampAngles, solveFK } from './math';

/** 对关键帧按时间排序（返回新数组） */
export function sortedKeyframes(doc: RigDocument): Keyframe[] {
  return [...doc.keyframes].sort((a, b) => a.time - b.time);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPose(a: JointPose, b: JointPose, t: number, allIds: string[]): JointPose {
  const out: JointPose = {};
  for (const id of allIds) {
    const pa = a[id] ?? ([0, 0, 0] as [number, number, number]);
    const pb = b[id] ?? ([0, 0, 0] as [number, number, number]);
    out[id] = [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t), lerp(pa[2], pb[2], t)];
  }
  return out;
}

/**
 * 时间轴采样：线性插值关键帧姿态。
 * 采样结果再经过当前关节约束钳制 —— 因此修改骨架/约束后，
 * 回放会自动按新约束计算，而关键帧本身保留不动。
 */
export function samplePose(doc: RigDocument, time: number): { pose: JointPose; clampedIds: Set<string> } {
  const kfs = sortedKeyframes(doc);
  const allIds = doc.joints.map((j) => j.id);
  let pose: JointPose = {};
  if (kfs.length === 0) {
    return { pose, clampedIds: new Set() };
  }
  if (time <= kfs[0].time) {
    pose = { ...kfs[0].pose };
  } else if (time >= kfs[kfs.length - 1].time) {
    pose = { ...kfs[kfs.length - 1].pose };
  } else {
    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].time < time) i++;
    const a = kfs[i];
    const b = kfs[i + 1];
    const span = b.time - a.time;
    const t = span > 1e-6 ? (time - a.time) / span : 0;
    pose = lerpPose(a.pose, b.pose, t, allIds);
  }

  // 用当前约束重新钳制，并收集触界关节
  const byId = new Map(doc.joints.map((j) => [j.id, j]));
  const clampedIds = new Set<string>();
  for (const id of Object.keys(pose)) {
    const joint = byId.get(id);
    if (!joint) continue;
    const { angles, clamped } = clampAngles(joint, pose[id]!);
    pose[id] = angles;
    if (clamped) clampedIds.add(id);
  }
  return { pose, clampedIds };
}

/**
 * 约束/骨架变更后的关键帧重算：
 * 关键帧数据保留（含已删除关节以外的全部关节角度），
 * 仅把每个关键帧中现存关节的角度按新约束钳制一遍。
 * 返回新的关键帧数组。
 */
export function recomputeKeyframesForConstraints(joints: Joint[], keyframes: Keyframe[]): Keyframe[] {
  const byId = new Map(joints.map((j) => [j.id, j]));
  return keyframes.map((kf) => {
    const pose: JointPose = {};
    for (const [id, angles] of Object.entries(kf.pose)) {
      const joint = byId.get(id);
      if (!joint) continue; // 关节已删除：丢弃该通道，但其余关键帧保留
      pose[id] = clampAngles(joint, angles).angles;
    }
    return { ...kf, pose };
  });
}

/** 求解当前姿态，供视口与高亮使用 */
export function solveDocument(doc: RigDocument, pose: JointPose) {
  const solved = solveFK(doc.joints, pose);
  const clampedIds = new Set<string>();
  solved.joints.forEach((v, id) => {
    if (v.clamped) clampedIds.add(id);
  });
  return { solved, clampedIds };
}
