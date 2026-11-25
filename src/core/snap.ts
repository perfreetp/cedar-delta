/**
 * 牙槽嵴吸附引擎。
 *
 * 规则：
 *  - 拖动中目标点距曲面 <= snapDistance：锁定到曲面标架（吸附态），手柄随牙面朝向；
 *  - 超出阈值：自由跟随指针（解除吸附）；
 *  - 松手时若未吸附但在 bounceRadius 内（"偏一点"）：弹回最近吸附位；
 *  - 否则回退到拖动前姿态。
 */
import type { DentalArch, RidgeFrame } from './arch';
import { v3, type QuatTuple, type Vec3Tuple } from './math';
import { q } from './math';
import { SLEEVE_HEIGHT, type SleeveState } from './types';

export interface SnapConfig {
  /** 进入吸附的距离阈值（mm） */
  snapDistance: number;
  /** 松手弹回的距离阈值（mm） */
  bounceRadius: number;
}

export const DEFAULT_SNAP: SnapConfig = {
  snapDistance: 4.5,
  bounceRadius: 9,
};

export interface SnapResult {
  frame: RidgeFrame;
  /** 套管中心（底面贴合牙面） */
  position: Vec3Tuple;
  quaternion: QuatTuple;
  /** 目标到曲面点的距离 */
  surfaceDistance: number;
}

export class SnapEngine {
  constructor(
    private readonly arch: DentalArch,
    readonly config: SnapConfig = DEFAULT_SNAP,
  ) {}

  /** 求目标位置对应的吸附位（套管底面贴合牙槽嵴，轴向对齐牙面法向） */
  evaluate(target: Vec3Tuple): SnapResult {
    const frame = this.arch.closestPoint(target);
    const position = v3.add(frame.point, v3.scale(frame.normal, SLEEVE_HEIGHT / 2));
    const quaternion = q.fromFrame(frame.normal, frame.tangent);
    return {
      frame,
      position,
      quaternion,
      surfaceDistance: v3.dist(target, frame.point),
    };
  }

  inSnapZone(result: SnapResult): boolean {
    return result.surfaceDistance <= this.config.snapDistance;
  }

  inBounceZone(result: SnapResult): boolean {
    return result.surfaceDistance <= this.config.bounceRadius;
  }

  /** 把吸附结果写入套管状态 */
  apply(sleeve: SleeveState, snap: SnapResult): SleeveState {
    return {
      ...sleeve,
      position: snap.position,
      quaternion: snap.quaternion,
      snapped: true,
      snapU: snap.frame.u,
      snapV: snap.frame.v,
    };
  }
}
