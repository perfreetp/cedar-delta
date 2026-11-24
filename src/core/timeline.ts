import type { Keyframe } from '../types';
import { Spline } from './spline';
import { degToRad, lerp, lerpAngle } from './vec';

/** 无显式时刻信息时，偶沿轨迹行进的默认速度（像素/秒） */
export const DEFAULT_SPEED = 220;

export interface PuppetPose {
  x: number;
  y: number;
  /** 朝向（弧度，Pixi rotation 直接可用） */
  angleRad: number;
  /** 当前是否处于停留段 */
  inDwell: boolean;
  /** 当前时间在整条调度中的 0..1 进度 */
  progress: number;
}

interface PlacedKeyframe {
  timeSec: number;
  dwellSec: number;
  s: number;
  /** 解析后的朝向（弧度）；null 表示跟随切线 */
  angle: number | null;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * 时间轴采样器：把“关键帧时刻/停留/朝向”编译成可按时间查询的偶姿态。
 *
 * - 相邻关键帧之间沿弧长匀速移动；
 * - 停留期保持位置与朝向；
 * - 无显式朝向的关键帧取该点切线方向，拐弯处朝向沿切线平滑过渡；
 * - 显式朝向在区间两端用 smoothstep 与切线混合，避免朝向跳变。
 */
export class TimelineSampler {
  private readonly spline: Spline;
  private readonly kfs: PlacedKeyframe[];
  readonly durationSec: number;

  /**
   * @param resolveWaypointIndex waypointId -> 经过点索引（由 store 依据当前经过点数组提供）
   */
  constructor(spline: Spline, keyframes: Keyframe[], resolveWaypointIndex: (id: string) => number) {
    this.spline = spline;
    const sorted = [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
    this.kfs = sorted.map((kf) => {
      const maxIdx = Math.max(0, spline.waypointS.length - 1);
      const wpIndex = Math.max(0, Math.min(maxIdx, resolveWaypointIndex(kf.waypointId)));
      const s = spline.waypointArcLength(wpIndex);
      return {
        timeSec: kf.timeSec,
        dwellSec: Math.max(0, kf.dwellSec),
        s,
        angle: kf.headingOverride && kf.headingDeg !== null ? degToRad(kf.headingDeg) : null,
      };
    });
    const last = this.kfs[this.kfs.length - 1];
    this.durationSec = last ? last.timeSec + last.dwellSec : 0;
  }

  private headingAt(kf: PlacedKeyframe): number {
    return kf.angle !== null ? kf.angle : this.spline.tangentAngleAtS(kf.s);
  }

  sampleAt(timeSec: number): PuppetPose {
    const t = Math.max(0, timeSec);
    const kfs = this.kfs;

    if (kfs.length === 0) {
      const p = this.spline.pointAtS(0);
      return { x: p.x, y: p.y, angleRad: this.spline.tangentAngleAtS(0), inDwell: false, progress: 0 };
    }

    const first = kfs[0];
    const last = kfs[kfs.length - 1];

    // 首帧之前：在首帧位置等待
    if (t < first.timeSec) {
      const p = this.spline.pointAtS(first.s);
      return { x: p.x, y: p.y, angleRad: this.headingAt(first), inDwell: true, progress: 0 };
    }

    // 末帧之后：停留结束后保持末姿态
    if (t >= last.timeSec) {
      const p = this.spline.pointAtS(last.s);
      return {
        x: p.x,
        y: p.y,
        angleRad: this.headingAt(last),
        inDwell: t < last.timeSec + last.dwellSec,
        progress: 1,
      };
    }

    // 定位所处的关键帧区间
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (t >= b.timeSec) continue;

      // a 点停留
      if (t < a.timeSec + a.dwellSec) {
        const p = this.spline.pointAtS(a.s);
        return {
          x: p.x,
          y: p.y,
          angleRad: this.headingAt(a),
          inDwell: true,
          progress: (a.timeSec + a.dwellSec) / Math.max(1e-6, this.durationSec),
        };
      }

      // 行进段
      const travelStart = a.timeSec + a.dwellSec;
      const travelEnd = b.timeSec;
      const u = travelEnd - travelStart < 1e-6 ? 1 : (t - travelStart) / (travelEnd - travelStart);
      const s = lerp({ x: a.s, y: 0 }, { x: b.s, y: 0 }, u).x;
      const p = this.spline.pointAtS(s);
      const tangent = this.spline.tangentAngleAtS(s);

      let angle = tangent;
      const hA = this.headingAt(a);
      const hB = this.headingAt(b);
      if (a.angle !== null && b.angle !== null) {
        angle = lerpAngle(hA, hB, smoothstep(u));
      } else if (a.angle !== null) {
        // 起点显式朝向：前 30% 平滑交还给切线
        const w = smoothstep(Math.min(1, u / 0.3));
        angle = lerpAngle(hA, tangent, w);
      } else if (b.angle !== null) {
        // 终点显式朝向：后 30% 从切线平滑接管
        const w = smoothstep(Math.max(0, (u - 0.7) / 0.3));
        angle = lerpAngle(tangent, hB, w);
      }

      return {
        x: p.x,
        y: p.y,
        angleRad: angle,
        inDwell: false,
        progress: t / Math.max(1e-6, this.durationSec),
      };
    }

    const p = this.spline.pointAtS(last.s);
    return { x: p.x, y: p.y, angleRad: this.headingAt(last), inDwell: false, progress: 1 };
  }
}

/** 新建关键帧的默认时刻：沿弧长按默认速度推算，并保证时间严格递增 */
export function computeDefaultKeyframeTime(
  spline: Spline,
  keyframes: Keyframe[],
  waypointIndex: number,
): number {
  const s = spline.waypointArcLength(waypointIndex);
  const base = s / DEFAULT_SPEED;
  const times = keyframes.map((k) => k.timeSec);
  const minT = times.length ? Math.max(...times) + 0.1 : 0;
  return Math.max(base, minT);
}

/** 全剧时长：所有偶末帧时刻 + 停留 的最大值 */
export function projectDuration(durations: number[]): number {
  return durations.reduce((m, d) => Math.max(m, d), 0);
}
