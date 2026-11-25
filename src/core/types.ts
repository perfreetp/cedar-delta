/**
 * 领域模型：套管布置状态。纯数据，可直接序列化进撤销快照。
 */
import type { QuatTuple, Vec3Tuple } from './math';

export interface SleeveState {
  /** 全局唯一稳定 ID（拾取、撤销、选中都以它为准，剖切前后不变） */
  id: number;
  position: Vec3Tuple;
  quaternion: QuatTuple;
  /** 是否处于吸附态 */
  snapped: boolean;
  /** 吸附到牙弓曲面的参数（吸附关系随撤销一起还原） */
  snapU: number | null;
  snapV: number | null;
}

export interface Transform {
  position: Vec3Tuple;
  quaternion: QuatTuple;
}

export interface ClipState {
  enabled: boolean;
  /** 平面单位法向（保留侧为点积较小的一侧） */
  normal: Vec3Tuple;
  /** 平面位置：dot(normal, p) = distance */
  distance: number;
}

export const SLEEVE_HEIGHT = 10;
export const SLEEVE_OUTER_R = 2.4;
export const SLEEVE_INNER_R = 1.3;
export const SLEEVE_COLLISION_R = 2.6;

export function cloneSleeve(s: SleeveState): SleeveState {
  return {
    id: s.id,
    position: [s.position[0], s.position[1], s.position[2]],
    quaternion: [s.quaternion[0], s.quaternion[1], s.quaternion[2], s.quaternion[3]],
    snapped: s.snapped,
    snapU: s.snapU,
    snapV: s.snapV,
  };
}
