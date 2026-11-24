import { writable, derived, get } from 'svelte/store';
import type { AppMode, Joint, JointPose, Keyframe, RigDocument, RodBinding } from '../types';
import { createDefaultDocument, newId } from '../lib/preset';
import { History } from '../lib/history';
import { addJoint, removeJoint, renameJoint, pruneKeyframes } from '../lib/hierarchy';
import { recomputeKeyframesForConstraints, samplePose, solveDocument } from '../lib/animation';
import { clampAngles, solveFK, solveIK, worldToParentLocal, type SolvedSkeleton } from '../lib/math';
import * as THREE from 'three';

// ---------------------------------------------------------------- 基础状态

const history = new History(createDefaultDocument());

/** 文档 store：Svelte 组件通过 $doc 订阅 */
const docStore = writable<RigDocument>(history.value);
history.subscribe(() => docStore.set(history.value));

export const mode = writable<AppMode>('edit');
export const selectedJointId = writable<string | null>(null);
/** 当前实时姿态（角度，度）。编辑模式下为手动姿态；动画模式下由 IK/牵引杆/回放共同驱动 */
export const livePose = writable<JointPose>({});
/** 当前触界（被约束钳制）的关节 id，视口据此高亮 */
export const clampedIds = writable<Set<string>>(new Set());
export const hoveredJointId = writable<string | null>(null);

export const isPlaying = writable(false);
export const isRecording = writable(false);
export const currentTime = writable(0);

// ---------------------------------------------------------------- 派生数据

export const solved: { subscribe: (fn: (v: SolvedSkeleton) => void) => () => void } = derived(
  [docStore, livePose],
  ([$doc, $pose]) => solveFK($doc.joints, $pose),
);

/** 当前选中关节对象 */
export const selectedJoint = derived([docStore, selectedJointId], ([$doc, $id]): Joint | null =>
  $id ? $doc.joints.find((j) => j.id === $id) ?? null : null,
);

// ---------------------------------------------------------------- 内部工具

function refreshClamp(pose: JointPose): void {
  const { clampedIds: ids } = solveDocument(history.value, pose);
  clampedIds.set(ids);
}

/** 同时更新 Svelte 姿态 store 与 History 内部姿态（撤销/重做需要） */
function setLivePose(pose: JointPose): void {
  livePose.set(pose);
  history.setPose(pose);
}

/** 任何关节/约束变更后：重算已有关键帧（保留关键帧，角度按新约束钳制） */
function withRecomputedKeyframes(doc: RigDocument): RigDocument {
  return { ...doc, keyframes: recomputeKeyframesForConstraints(doc.joints, doc.keyframes) };
}

// ---------------------------------------------------------------- 撤销重做

export function undo(): void {
  const step = history.undo();
  if (!step) return;
  livePose.set(step.pose);
  refreshClamp(step.pose);
}

export function redo(): void {
  const step = history.redo();
  if (!step) return;
  livePose.set(step.pose);
  refreshClamp(step.pose);
}

export const canUndo = writable(false);
export const canRedo = writable(false);
history.subscribe(() => {
  canUndo.set(history.canUndo);
  canRedo.set(history.canRedo);
});

// ---------------------------------------------------------------- 骨架编辑（编辑模式）

/** 拖动球体开始：开启事务，整个拖动只产生一条历史 */
export function beginJointDrag(): void {
  history.begin('拖动关节', get(livePose));
}

/** 拖动中：更新关节本地偏移，骨骼长度随之改变 */
export function dragJoint(jointId: string, worldPos: THREE.Vector3): void {
  const current = history.value;
  const solvedNow = solveFK(current.joints, get(livePose));
  const localOffset = worldToParentLocal(current.joints, jointId, worldPos, solvedNow);
  history.transact((doc) => ({
    ...doc,
    joints: doc.joints.map((j) => (j.id === jointId ? { ...j, localOffset } : j)),
  }));
}

export function endJointDrag(): void {
  history.commit();
}

/** 修改某个关节的约束角度上下限；已录动作自动按新约束重算 */
export function updateJointLimits(
  jointId: string,
  axis: 'x' | 'y' | 'z',
  patch: Partial<Joint['limits']['x']>,
): void {
  history.update('修改关节约束', (doc) => {
    const joints = doc.joints.map((j) =>
      j.id === jointId ? { ...j, limits: { ...j.limits, [axis]: { ...j.limits[axis], ...patch } } } : j,
    );
    return withRecomputedKeyframes({ ...doc, joints });
  });
  // 实时姿态也立即按新约束钳制
  const doc = history.value;
  const joint = doc.joints.find((j) => j.id === jointId);
  const pose = get(livePose);
  if (joint && pose[jointId]) {
    const next = { ...pose, [jointId]: clampAngles(joint, pose[jointId]!).angles };
    setLivePose(next);
    refreshClamp(next);
  } else {
    refreshClamp(pose);
  }
}

export function updateJointRadius(jointId: string, radius: number): void {
  history.update('修改关节大小', (doc) => ({
    ...doc,
    joints: doc.joints.map((j) => (j.id === jointId ? { ...j, radius } : j)),
  }));
}

export function renameJointById(jointId: string, name: string): void {
  history.update('重命名关节', (doc) => ({ ...doc, joints: renameJoint(doc.joints, jointId, name) }));
}

/** 新增子关节 */
export function addChildJoint(parentId: string | null): void {
  history.update('新增关节', (doc) => ({ ...doc, joints: addJoint(doc.joints, parentId, `关节 ${doc.joints.length + 1}`) }));
  const created = history.value.joints[history.value.joints.length - 1];
  if (created) selectedJointId.set(created.id);
}

/** 删除关节：子关节重新挂接到其祖父；关键帧中该关节通道移除，关键帧本身保留 */
export function deleteJoint(jointId: string): void {
  const target = history.value.joints.find((j) => j.id === jointId);
  if (!target || target.parentId === null) return; // 根关节不允许删除
  history.update('删除关节', (doc) => {
    const res = removeJoint(doc.joints, doc.keyframes, jointId);
    // 清理指向被删关节的牵引杆绑定
    const rod = { ...doc.rod, bindings: doc.rod.bindings.filter((b) => b.jointId !== jointId) };
    return withRecomputedKeyframes({ ...doc, joints: res.joints, keyframes: res.keyframes, rod });
  });
  const pose = { ...get(livePose) };
  delete pose[jointId];
  setLivePose(pose);
  if (get(selectedJointId) === jointId) selectedJointId.set(null);
  refreshClamp(pose);
}

// ---------------------------------------------------------------- 姿态 / IK（动画模式）

/** 拖末端手柄开始 */
export function beginPoseDrag(): void {
  history.begin('拖动手柄', get(livePose));
}

/**
 * 拖动末端肢体：逆运动学求解，逐关节欧拉角钳制。
 * 超出范围的关节停在边界并进入 clamped 集合（视口高亮）。
 */
export function dragEndEffector(endId: string, target: THREE.Vector3, branchRootId?: string): void {
  const doc = history.value;
  const start = get(livePose);
  const result = solveIK(doc.joints, endId, target, start, branchRootId, { iterations: 16 });
  setLivePose(result.pose);
  // IK 求解过程的触界 + 最终 FK 钳制合并，驱动视口红色高亮
  const { clampedIds: fkClamped } = solveDocument(doc, result.pose);
  const merged = new Set<string>(result.clamped);
  fkClamped.forEach((id) => merged.add(id));
  clampedIds.set(merged);
}

export function endPoseDrag(): void {
  history.commit();
}

/** 直接设置某关节角度（面板数值输入用），自动钳制 */
export function setJointAngle(jointId: string, axis: 0 | 1 | 2, valueDeg: number): void {
  const doc = history.value;
  const joint = doc.joints.find((j) => j.id === jointId);
  if (!joint) return;
  const pose = get(livePose);
  const cur = pose[jointId] ?? ([0, 0, 0] as [number, number, number]);
  const candidate: [number, number, number] = [...cur] as [number, number, number];
  candidate[axis] = valueDeg;
  const { angles } = clampAngles(joint, candidate);
  const next = { ...pose, [jointId]: angles };
  setLivePose(next);
  refreshClamp(next);
}

// ---------------------------------------------------------------- 牵引杆

/** 牵引杆驱动姿态：value * ratio 得到每个绑定关节的目标角，再经约束钳制 */
export function rodPose(doc: RigDocument, value: number, base: JointPose): JointPose {
  const byId = new Map(doc.joints.map((j) => [j.id, j]));
  const pose: JointPose = { ...base };
  for (const b of doc.rod.bindings) {
    const joint = byId.get(b.jointId);
    if (!joint) continue;
    const raw: [number, number, number] = [value * b.ratio[0], value * b.ratio[1], value * b.ratio[2]];
    pose[b.jointId] = clampAngles(joint, raw).angles;
  }
  return pose;
}

export function beginRodDrag(): void {
  history.begin('牵引杆', get(livePose));
}

export function setRodValue(value: number): void {
  const v = THREE.MathUtils.clamp(value, history.value.rod.min, history.value.rod.max);
  history.transact((doc) => ({ ...doc, rod: { ...doc.rod, value: v } }));
  const base = get(livePose);
  const next = rodPose(history.value, v, base);
  setLivePose(next);
  refreshClamp(next);
}

export function endRodDrag(): void {
  history.commit();
}

/** 牵引杆配置（比例、绑定关节、行程范围）——面板编辑，立即入栈 */
export function updateRodConfig(patch: Partial<Pick<RigDocument['rod'], 'min' | 'max'>>): void {
  history.update('牵引杆设置', (doc) => ({ ...doc, rod: { ...doc.rod, ...patch } }));
}

export function addRodBinding(jointId: string): void {
  history.update('添加牵引绑定', (doc) => {
    if (doc.rod.bindings.some((b) => b.jointId === jointId)) return doc;
    const binding: RodBinding = { jointId, ratio: [10, 0, 0] };
    return { ...doc, rod: { ...doc.rod, bindings: [...doc.rod.bindings, binding] } };
  });
}

export function updateRodRatio(jointId: string, axis: 0 | 1 | 2, ratio: number): void {
  history.update('调整牵引比例', (doc) => ({
    ...doc,
    rod: {
      ...doc.rod,
      bindings: doc.rod.bindings.map((b) =>
        b.jointId === jointId ? { ...b, ratio: Object.assign([...b.ratio], { [axis]: ratio }) as [number, number, number] } : b,
      ),
    },
  }));
}

export function removeRodBinding(jointId: string): void {
  history.update('移除牵引绑定', (doc) => ({
    ...doc,
    rod: { ...doc.rod, bindings: doc.rod.bindings.filter((b) => b.jointId !== jointId) },
  }));
}

// ---------------------------------------------------------------- 关键帧 / 录制 / 回放

/** 在当前时间打入/更新关键帧（姿态取当前 livePose 的钳制结果） */
export function addKeyframe(): void {
  history.update('添加关键帧', (doc) => {
    const pose: JointPose = {};
    const byId = new Map(doc.joints.map((j) => [j.id, j]));
    for (const [id, angles] of Object.entries(get(livePose))) {
      const joint = byId.get(id);
      pose[id] = joint ? clampAngles(joint, angles).angles : angles;
    }
    const t = get(currentTime);
    const existing = doc.keyframes.find((k) => Math.abs(k.time - t) < 1e-4);
    let keyframes: Keyframe[];
    if (existing) {
      keyframes = doc.keyframes.map((k) => (k.id === existing.id ? { ...k, pose } : k));
    } else {
      keyframes = [...doc.keyframes, { id: newId('kf'), time: t, pose }];
    }
    return { ...doc, keyframes };
  });
}

export function deleteKeyframe(id: string): void {
  history.update('删除关键帧', (doc) => ({ ...doc, keyframes: doc.keyframes.filter((k) => k.id !== id) }));
}

/** 录制中由定时器调用：每 100ms 采样一次当前姿态为关键帧 */
export function recordSample(time: number): void {
  const doc = history.value;
  const pose: JointPose = {};
  const byId = new Map(doc.joints.map((j) => [j.id, j]));
  for (const [id, angles] of Object.entries(get(livePose))) {
    const joint = byId.get(id);
    pose[id] = joint ? clampAngles(joint, angles).angles : angles;
  }
  // 录制属于同一段连续操作，使用事务避免每个采样都进撤销栈
  if (!history.inTransaction) history.begin('录制动作', get(livePose));
  history.transact((d) => {
    const existing = d.keyframes.find((k) => Math.abs(k.time - time) < 0.05);
    const keyframes = existing
      ? d.keyframes.map((k) => (k.id === existing.id ? { ...k, pose } : k))
      : [...d.keyframes, { id: newId('kf'), time, pose }];
    return { ...d, keyframes };
  });
}

export function endRecording(): void {
  if (history.inTransaction) history.commit();
}

/** 回放采样：时间轴驱动姿态，结果按当前约束钳制并给出触界集合 */
export function applyPlaybackTime(time: number): void {
  const doc = history.value;
  const { pose, clampedIds: ids } = samplePose(doc, time);
  setLivePose(pose);
  clampedIds.set(ids);
}

export function setDuration(duration: number): void {
  history.update('修改时长', (doc) => ({ ...doc, duration: Math.max(0.5, duration) }));
}

export function clearAllKeyframes(): void {
  history.update('清空动作', (doc) => ({ ...doc, keyframes: [] }));
}

// ---------------------------------------------------------------- 文件 / 模式

export function loadDocument(doc: RigDocument): void {
  history.replace(doc);
  setLivePose({});
  clampedIds.set(new Set());
  currentTime.set(0);
  isPlaying.set(false);
  isRecording.set(false);
  selectedJointId.set(null);
}

export function getDocument(): RigDocument {
  return history.value;
}

export function switchMode(next: AppMode): void {
  if (next === get(mode)) return;
  // 切换模式前收尾未提交的录制/拖动事务，避免遗留状态
  if (history.inTransaction) history.cancel();
  isPlaying.set(false);
  isRecording.set(false);
  if (next === 'edit') {
    // 回到编辑模式：牵引杆归零，姿态复位
    history.update(null, (doc) => ({ ...doc, rod: { ...doc.rod, value: 0 } }));
    setLivePose({});
    clampedIds.set(new Set());
  } else {
    setLivePose({});
    clampedIds.set(new Set());
    currentTime.set(0);
  }
  mode.set(next);
}

export { docStore, pruneKeyframes };
