import * as THREE from 'three';
import type { Joint, JointPose, RigDocument } from '../types';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
const EULER_ORDER: THREE.EulerOrder = 'XYZ';

/** 深拷贝文档（结构化数据，无函数/循环引用） */
export function cloneDoc(doc: RigDocument): RigDocument {
  return structuredClone(doc);
}

/** 按父子关系排序：父关节一定在子关节之前 */
export function orderJoints(joints: Joint[]): Joint[] {
  const byId = new Map(joints.map((j) => [j.id, j]));
  const visited = new Set<string>();
  const out: Joint[] = [];
  const visit = (j: Joint) => {
    if (visited.has(j.id)) return;
    if (j.parentId) {
      const p = byId.get(j.parentId);
      if (p) visit(p);
    }
    visited.add(j.id);
    out.push(j);
  };
  joints.forEach(visit);
  return out;
}

/** 把角度钳制在关节允许范围内；返回钳制后的角度与是否发生了钳制 */
export function clampAngles(joint: Joint, anglesDeg: [number, number, number]): {
  angles: [number, number, number];
  clamped: boolean;
} {
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  let clamped = false;
  const out = [0, 0, 0] as [number, number, number];
  for (let i = 0; i < 3; i++) {
    const l = joint.limits[axes[i]];
    let v = anglesDeg[i];
    if (l.enabled) {
      const lo = Math.min(l.min, l.max);
      const hi = Math.max(l.min, l.max);
      if (v < lo) {
        v = lo;
        clamped = true;
      } else if (v > hi) {
        v = hi;
        clamped = true;
      }
    }
    out[i] = v;
  }
  return { angles: out, clamped };
}

export interface SolvedJoint {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  localEulerDeg: [number, number, number];
  clamped: boolean;
}

export interface SolvedSkeleton {
  order: string[];
  joints: Map<string, SolvedJoint>;
}

const _euler = new THREE.Euler(0, 0, 0, EULER_ORDER);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * 前向运动学：依据本地欧拉姿态（度）求解每个关节的世界位置/朝向。
 * 绑定位置来自 joint.localOffset（父节点局部坐标）。
 */
export function solveFK(joints: Joint[], pose: JointPose = {}): SolvedSkeleton {
  const ordered = orderJoints(joints);
  const result = new Map<string, SolvedJoint>();

  for (const joint of ordered) {
    const requested = pose[joint.id] ?? ([0, 0, 0] as [number, number, number]);
    const { angles, clamped } = clampAngles(joint, requested);
    _euler.set(angles[0] * DEG, angles[1] * DEG, angles[2] * DEG);
    _q.setFromEuler(_euler);

    const parent = joint.parentId ? result.get(joint.parentId) : undefined;
    const position = new THREE.Vector3(...joint.localOffset);
    const quaternion = new THREE.Quaternion();
    if (parent) {
      position.applyQuaternion(parent.quaternion).add(parent.position);
      quaternion.copy(parent.quaternion).multiply(_q);
    } else {
      quaternion.copy(_q);
    }
    result.set(joint.id, {
      position,
      quaternion,
      localEulerDeg: angles,
      clamped,
    });
  }
  return { order: ordered.map((j) => j.id), joints: result };
}

/** 取从根（或 branchRoot）到 endId 的关节链（含两端） */
export function getChain(joints: Joint[], endId: string, branchRootId?: string): Joint[] {
  const byId = new Map(joints.map((j) => [j.id, j]));
  const chain: Joint[] = [];
  let cur: Joint | undefined = byId.get(endId);
  while (cur) {
    chain.unshift(cur);
    if (cur.id === branchRootId) break;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

export interface IKOptions {
  /** CCD 迭代次数 */
  iterations?: number;
  /** 位置容差（世界单位），达到即提前结束 */
  tolerance?: number;
}

export interface IKResult {
  /** 钳制后的关节本地欧拉姿态（度） */
  pose: JointPose;
  /** 本次求解中被约束推到边界的关节 id（用于高亮） */
  clamped: Set<string>;
}

/**
 * 带欧拉角上下限的逆运动学（FABRIK 定位 + 角度空间 CCD 精修）。
 * - FABRIK 给出末端尽量逼近目标的关节世界位置；目标超出链长时，
 *   链被完全拉直伸向目标（边界姿态）
 * - 再把每个关节的朝向转成本地欧拉角并逐轴钳制，保证结果永远在约束内
 * - 最后用 CCD 在角度空间精修可达目标的精度
 * 无法到达的目标会让关节停在约束边界，并在结果的 clamped 集合中报告。
 *
 * @param branchRootId 链的起始关节（其位置固定），默认取末端的根祖先
 */
export function solveIK(
  joints: Joint[],
  endId: string,
  target: THREE.Vector3,
  pose: JointPose,
  branchRootId?: string,
  opts: IKOptions = {},
): IKResult {
  const iterations = opts.iterations ?? 40;
  const tolerance = opts.tolerance ?? 1e-3;
  const next: JointPose = { ...pose };
  const clampedSet = new Set<string>();
  const markClamp = (jointId: string): void => {
    clampedSet.add(jointId);
  };
  const chain = getChain(joints, endId, branchRootId);
  if (chain.length < 2) return { pose: next, clamped: clampedSet };
  const byId = new Map(joints.map((j) => [j.id, j]));

  // ---------- 1. FABRIK：在当前姿态的世界位置上求解目标位置 ----------
  const baseSolved = solveFK(joints, next);
  const rootPos = baseSolved.joints.get(chain[0].id)!.position.clone();
  const positions = chain.map((j) => baseSolved.joints.get(j.id)!.position.clone());
  const segLen: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    segLen.push(positions[i].distanceTo(positions[i - 1]));
  }
  const totalLen = segLen.reduce((a, b) => a + b, 0);

  fabrik(positions, segLen, rootPos, target, 12);

  // ---------- 2. 世界位置 → 本地欧拉角（逐轴钳制） ----------
  // 沿链由根向末端：关节本地旋转 = 把“绑定骨骼方向（本地）”对齐到
  // “实际骨骼方向（父世界空间）”，再转欧拉角并钳制，累积得到世界朝向。
  const worldQ = new Map<string, THREE.Quaternion>();
  const e = new THREE.Euler(0, 0, 0, EULER_ORDER);
  const q = new THREE.Quaternion();
  const bindDir = new THREE.Vector3();
  const actualWorld = new THREE.Vector3();
  const actualLocal = new THREE.Vector3();
  const localRot = new THREE.Quaternion();
  const invParent = new THREE.Quaternion();

  for (let k = 0; k < chain.length; k++) {
    const joint = chain[k];
    const parentJoint = joint.parentId ? byId.get(joint.parentId) : undefined;
    const parentWorldQ = parentJoint ? worldQ.get(parentJoint.id) ?? new THREE.Quaternion() : new THREE.Quaternion();

    if (k < chain.length - 1) {
      bindDir.set(...joint.localOffset).normalize();
      actualWorld.copy(positions[k + 1]).sub(positions[k]).normalize();
      actualLocal.copy(actualWorld).applyQuaternion(invParent.copy(parentWorldQ).invert());
      localRot.setFromUnitVectors(bindDir, actualLocal);
    } else {
      localRot.identity(); // 末端关节自身不再需要朝向
    }
    e.setFromQuaternion(localRot, EULER_ORDER);
    const candidate: [number, number, number] = [e.x * RAD, e.y * RAD, e.z * RAD];
    const { angles, clamped } = clampAngles(joint, candidate);
    if (clamped) markClamp(joint.id);
    next[joint.id] = angles;

    e.set(angles[0] * DEG, angles[1] * DEG, angles[2] * DEG);
    q.setFromEuler(e);
    worldQ.set(joint.id, new THREE.Quaternion().copy(parentWorldQ).multiply(q));
  }

  // ---------- 3. CCD 精修（可达目标的末端精度） ----------
  const desiredLocal = new THREE.Vector3();
  const curLocal = new THREE.Vector3();
  const localE = new THREE.Euler(0, 0, 0, EULER_ORDER);
  const localQ2 = new THREE.Quaternion();
  const invParentQ = new THREE.Quaternion();
  const deltaQ = new THREE.Quaternion();
  const worldToEff = new THREE.Vector3();
  const worldToTarget = new THREE.Vector3();
  const identityQ = new THREE.Quaternion();
  void totalLen;

  for (let iter = 0; iter < iterations; iter++) {
    const solved = solveFK(joints, next);
    const endPos = solved.joints.get(endId)!.position;
    if (endPos.distanceTo(target) < tolerance) break;
    let changedThisPass = false;

    for (let k = chain.length - 2; k >= 0; k--) {
      const joint = chain[k];
      const sj = solved.joints.get(joint.id)!;

      worldToEff.copy(endPos).sub(sj.position);
      worldToTarget.copy(target).sub(sj.position);
      if (worldToEff.lengthSq() < 1e-10 || worldToTarget.lengthSq() < 1e-10) continue;

      const parentJoint = joint.parentId ? byId.get(joint.parentId) : undefined;
      const parentWorldQ = parentJoint ? solved.joints.get(parentJoint.id)!.quaternion : identityQ;
      invParentQ.copy(parentWorldQ).invert();
      curLocal.copy(worldToEff).applyQuaternion(invParentQ).normalize();
      desiredLocal.copy(worldToTarget).applyQuaternion(invParentQ).normalize();

      const curAngles = next[joint.id] ?? ([0, 0, 0] as [number, number, number]);
      localE.set(curAngles[0] * DEG, curAngles[1] * DEG, curAngles[2] * DEG);
      localQ2.setFromEuler(localE);
      deltaQ.setFromUnitVectors(curLocal, desiredLocal);
      localQ2.premultiply(deltaQ);

      localE.setFromQuaternion(localQ2, EULER_ORDER);
      const candidate: [number, number, number] = [localE.x * RAD, localE.y * RAD, localE.z * RAD];
      const { angles, clamped } = clampAngles(joint, candidate);
      if (clamped) markClamp(joint.id);
      const prev = next[joint.id] ?? ([0, 0, 0] as [number, number, number]);
      const moved = Math.abs(prev[0] - angles[0]) + Math.abs(prev[1] - angles[1]) + Math.abs(prev[2] - angles[2]);
      if (moved > 1e-4) changedThisPass = true;
      next[joint.id] = angles;

      const refreshed = solveFK(joints, next);
      refreshed.joints.forEach((v, id) => {
        const dst = solved.joints.get(id);
        if (dst) {
          dst.position.copy(v.position);
          dst.quaternion.copy(v.quaternion);
          dst.localEulerDeg = v.localEulerDeg;
          dst.clamped = v.clamped;
        }
      });
    }
    if (!changedThisPass) break;
  }
  return { pose: next, clamped: clampedSet };
}

/**
 * FABRIK 迭代：保持各段长度不变，把链的末端尽量移到 target。
 * target 超出链长时，前向阶段会把链完全拉直伸向目标。
 */
function fabrik(
  positions: THREE.Vector3[],
  segLen: number[],
  rootPos: THREE.Vector3,
  target: THREE.Vector3,
  iterations: number,
): void {
  const n = positions.length;
  for (let iter = 0; iter < iterations; iter++) {
    // 前向：末端对齐目标，逐节向根反推
    positions[n - 1].copy(target);
    for (let i = n - 2; i >= 0; i--) {
      const dir = positions[i].clone().sub(positions[i + 1]).normalize();
      positions[i].copy(positions[i + 1]).addScaledVector(dir, segLen[i]);
    }
    // 后向：根对齐原位，逐节向末端推进
    positions[0].copy(rootPos);
    for (let i = 0; i < n - 1; i++) {
      const dir = positions[i + 1].clone().sub(positions[i]).normalize();
      positions[i + 1].copy(positions[i]).addScaledVector(dir, segLen[i]);
    }
    if (positions[n - 1].distanceTo(target) < 1e-4) break;
  }
}

/** 世界坐标 → 某关节父空间下的本地偏移（用于拖动球体后写回 localOffset） */
export function worldToParentLocal(
  joints: Joint[],
  jointId: string,
  worldPos: THREE.Vector3,
  solved: SolvedSkeleton,
): [number, number, number] {
  const joint = joints.find((j) => j.id === jointId);
  if (!joint || !joint.parentId) return [worldPos.x, worldPos.y, worldPos.z];
  const parent = solved.joints.get(joint.parentId);
  if (!parent) return [worldPos.x, worldPos.y, worldPos.z];
  const local = _v.copy(worldPos).sub(parent.position).applyQuaternion(_q.copy(parent.quaternion).invert());
  return [local.x, local.y, local.z];
}
