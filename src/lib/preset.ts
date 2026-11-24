import type { AngleLimit, Joint, RigDocument } from '../types';

let counter = 0;
/** 生成唯一 id（非密码学场景，足够用） */
export function newId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function lim(enabled: boolean, min: number, max: number): AngleLimit {
  return { enabled, min, max };
}

/** 三轴均可活动、范围适中的默认约束 */
function freeish(range = 90): Joint['limits'] {
  return {
    x: lim(true, -range, range),
    y: lim(true, -range, range),
    z: lim(true, -range, range),
  };
}

/** 铰链关节：主要允许一个轴向弯曲（骨架沿 ±X 伸展，铰链轴取 Z） */
function hinge(fwd = 130): Joint['limits'] {
  return {
    x: lim(false, 0, 0),
    y: lim(true, -5, 5),
    z: lim(true, 0, fwd),
  };
}

interface Spec {
  id: string;
  name: string;
  parent: string | null;
  offset: [number, number, number];
  radius: number;
  limits: Joint['limits'];
}

/**
 * 预设人形木偶骨架（Y 轴向上，单位约为“米”）。
 * 覆盖需求中的 颈/肩/肘/腕/髋/膝/踝，并补充骨盆与脊柱作为层级根。
 */
const PRESET_SPECS: Spec[] = [
  { id: 'pelvis', name: '骨盆', parent: null, offset: [0, 1.0, 0], radius: 0.16, limits: freeish(45) },
  { id: 'spine', name: '脊柱', parent: 'pelvis', offset: [0, 0.28, 0], radius: 0.11, limits: freeish(30) },
  { id: 'neck', name: '颈', parent: 'spine', offset: [0, 0.26, 0], radius: 0.09, limits: freeish(60) },
  { id: 'head', name: '头', parent: 'neck', offset: [0, 0.2, 0], radius: 0.14, limits: freeish(40) },

  { id: 'shoulder_l', name: '左肩', parent: 'spine', offset: [0.22, 0.18, 0], radius: 0.1, limits: freeish(120) },
  { id: 'elbow_l', name: '左肘', parent: 'shoulder_l', offset: [0.26, -0.04, 0], radius: 0.08, limits: hinge(140) },
  { id: 'wrist_l', name: '左腕', parent: 'elbow_l', offset: [0.24, -0.02, 0], radius: 0.065, limits: freeish(70) },

  { id: 'shoulder_r', name: '右肩', parent: 'spine', offset: [-0.22, 0.18, 0], radius: 0.1, limits: freeish(120) },
  { id: 'elbow_r', name: '右肘', parent: 'shoulder_r', offset: [-0.26, -0.04, 0], radius: 0.08, limits: hinge(140) },
  { id: 'wrist_r', name: '右腕', parent: 'elbow_r', offset: [-0.24, -0.02, 0], radius: 0.065, limits: freeish(70) },

  { id: 'hip_l', name: '左髋', parent: 'pelvis', offset: [0.12, -0.06, 0], radius: 0.11, limits: freeish(90) },
  { id: 'knee_l', name: '左膝', parent: 'hip_l', offset: [0.06, -0.42, 0], radius: 0.085, limits: hinge(140) },
  { id: 'ankle_l', name: '左踝', parent: 'knee_l', offset: [0.02, -0.42, 0], radius: 0.07, limits: freeish(50) },

  { id: 'hip_r', name: '右髋', parent: 'pelvis', offset: [-0.12, -0.06, 0], radius: 0.11, limits: freeish(90) },
  { id: 'knee_r', name: '右膝', parent: 'hip_r', offset: [-0.06, -0.42, 0], radius: 0.085, limits: hinge(140) },
  { id: 'ankle_r', name: '右踝', parent: 'knee_r', offset: [-0.02, -0.42, 0], radius: 0.07, limits: freeish(50) },
];

export function createPresetJoints(): Joint[] {
  return PRESET_SPECS.map((s) => ({
    id: s.id,
    name: s.name,
    parentId: s.parent,
    localOffset: s.offset,
    radius: s.radius,
    limits: s.limits,
  }));
}

export function createDefaultDocument(): RigDocument {
  return {
    version: 1,
    name: '未命名木偶',
    joints: createPresetJoints(),
    keyframes: [],
    duration: 6,
    rod: {
      value: 0,
      min: -2,
      max: 2,
      bindings: [
        { jointId: 'elbow_l', ratio: [0, 0, 20] },
        { jointId: 'elbow_r', ratio: [0, 0, 20] },
      ],
    },
  };
}
