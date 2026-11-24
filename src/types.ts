// 骨架 / 约束 / 动作 的核心数据结构

/** 关节欧拉角活动范围（单位：度）。enabled=false 表示该轴不受约束 */
export interface AngleLimit {
  enabled: boolean;
  min: number; // 下限（度）
  max: number; // 上限（度）
}

/** 关节定义：绑定姿态以父节点坐标系下的 localOffset 给出 */
export interface Joint {
  id: string;
  name: string;
  parentId: string | null;
  /** 相对父关节的绑定位置（根关节相对世界原点） */
  localOffset: [number, number, number];
  /** 球体半径（用于显示与射线拾取） */
  radius: number;
  /** 三个欧拉轴（XYZ 顺序）的活动范围 */
  limits: { x: AngleLimit; y: AngleLimit; z: AngleLimit };
}

/** 单帧中某关节的本地欧拉姿态（单位：度，相对绑定姿态） */
export type JointPose = Record<string, [number, number, number]>;

/** 关键帧 */
export interface Keyframe {
  id: string;
  time: number; // 秒
  pose: JointPose;
}

/** 牵引杆：拖动数值按 ratio 驱动所绑定关节 */
export interface RodBinding {
  jointId: string;
  /** 每个轴的驱动比例（角度/单位杆行程） */
  ratio: [number, number, number];
}

export interface Rod {
  value: number; // 当前杆位置（单位）
  min: number;
  max: number;
  bindings: RodBinding[];
}

/** 完整文档：导出/导入、撤销重做都围绕它 */
export interface RigDocument {
  version: 1;
  name: string;
  joints: Joint[];
  keyframes: Keyframe[];
  duration: number; // 时间轴总时长（秒）
  rod: Rod;
}

export type AppMode = 'edit' | 'animate';

/** 每个关节每帧的世界空间结果 */
export interface WorldJoint {
  id: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** 本帧该关节是否被约束钳制（用于高亮） */
  clamped: boolean;
}

// 显式引入 three 类型（仅类型用途）
import type * as THREE from 'three';
