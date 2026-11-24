import type { Joint, JointPose, Keyframe } from '../types';
import { newId } from './preset';

export interface HierarchyResult {
  joints: Joint[];
  keyframes: Keyframe[];
}

/** 在 parentId 下新增关节；若给出 worldLocalOffset 则直接使用，否则放在父关节前方一小段 */
export function addJoint(
  joints: Joint[],
  parentId: string | null,
  name: string,
  localOffset: [number, number, number] = [0, 0.2, 0],
): Joint[] {
  const joint: Joint = {
    id: newId('joint'),
    name,
    parentId,
    localOffset,
    radius: 0.08,
    limits: {
      x: { enabled: true, min: -90, max: 90 },
      y: { enabled: true, min: -90, max: 90 },
      z: { enabled: true, min: -90, max: 90 },
    },
  };
  return [...joints, joint];
}

/**
 * 删除关节：
 * - 其子关节重新挂接到被删关节的父节点（本地偏移换算到新父空间，尽量保持世界位置）
 * - 根关节不允许删除（返回原数组）
 * - 关键帧中该关节的姿态通道一并移除，其余关键帧保留
 */
export function removeJoint(joints: Joint[], keyframes: Keyframe[], jointId: string): HierarchyResult {
  const target = joints.find((j) => j.id === jointId);
  if (!target || target.parentId === null) return { joints, keyframes };

  // 计算被删关节在其父空间下的变换，用于把孙节点的本地偏移平移过去
  const grandParentId = target.parentId;
  const children = joints.filter((j) => j.parentId === jointId);

  const next = joints
    .filter((j) => j.id !== jointId)
    .map((j) => {
      if (j.parentId === jointId) {
        // 原世界偏移 ≈ target.localOffset（祖父空间） + j.localOffset（target 空间）。
        // 不考虑旋转修正（绑定姿态下父子局部轴一致），仅做平移继承，保持视觉连续。
        const merged: [number, number, number] = [
          target.localOffset[0] + j.localOffset[0],
          target.localOffset[1] + j.localOffset[1],
          target.localOffset[2] + j.localOffset[2],
        ];
        return { ...j, parentId: grandParentId, localOffset: merged };
      }
      return j;
    });

  const nextKfs = pruneKeyframes(keyframes, new Set([jointId]));
  return { joints: next, keyframes: nextKfs };
}

/** 重挂接：把 jointId 挂到 newParentId 下（防止挂到自己的子孙上） */
export function reparentJoint(joints: Joint[], jointId: string, newParentId: string | null): Joint[] {
  if (jointId === newParentId) return joints;
  if (newParentId && isDescendant(joints, newParentId, jointId)) return joints;
  return joints.map((j) => (j.id === jointId ? { ...j, parentId: newParentId } : j));
}

function isDescendant(joints: Joint[], maybeChild: string, ancestorId: string): boolean {
  const byId = new Map(joints.map((j) => [j.id, j]));
  let cur = byId.get(maybeChild);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}

/** 从关键帧中移除指定关节的通道，关键帧本身保留 */
export function pruneKeyframes(keyframes: Keyframe[], removedIds: Set<string>): Keyframe[] {
  return keyframes.map((kf) => {
    const pose: JointPose = {};
    let changed = false;
    for (const [id, angles] of Object.entries(kf.pose)) {
      if (removedIds.has(id)) {
        changed = true;
        continue;
      }
      pose[id] = angles;
    }
    return changed ? { ...kf, pose } : kf;
  });
}

/** 重命名关节 */
export function renameJoint(joints: Joint[], jointId: string, name: string): Joint[] {
  return joints.map((j) => (j.id === jointId ? { ...j, name } : j));
}
