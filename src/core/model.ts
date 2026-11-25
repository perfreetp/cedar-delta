/**
 * 时间轴数据模型
 *
 * 层级规则（嵌套最多三层）：
 *   第 1 层：根轨道（叶子轨或分组轨）
 *   第 2 层：根分组的子轨道（叶子轨或分组轨）
 *   第 3 层：二级分组的子轨道（只能是叶子轨）
 *
 * 关键帧的 time 是相对所属轨道的「局部时间」，取值区间 [0, 1]（占轨道时长比例）。
 * 子轨道局部时间 -> 全局秒：
 *   global = group.start + group.duration * easing(group.localToGlobal) * childLocal
 * 因此修改父分组轨的缓动曲线后，子轨关键帧的全局位置会自动按新曲线重排，
 * 而局部关键帧数据保持不变 —— 这正是「改父轨缓动曲线，子关键帧按新曲线重排」的实现方式。
 */

export type EasingType = 'linear' | 'ease' | 'step';

export type TrackKind = 'camera' | 'crater' | 'ejecta' | 'group';

export type Vec3Tuple = [number, number, number];

/** 相机关键帧：弧线球面坐标 + 朝向约束（目标点） */
export interface CameraKeyframe {
  id: string;
  /** 局部时间，[0,1] */
  time: number;
  /** 球面坐标：半径（距目标距离）、水平方位角（弧度）、俯仰角（弧度） */
  radius: number;
  azimuth: number;
  elevation: number;
  /** 朝向约束目标点 */
  target: Vec3Tuple;
  /** 该关键帧使用的插值方式；默认继承所属轨道的 easing */
  easing?: EasingType;
}

/** 陨石坑关键帧：半径、深度、环形山脊高度（世界单位） */
export interface CraterKeyframe {
  id: string;
  time: number;
  /** 陨石坑半径 */
  radius: number;
  /** 陨石坑深度（正数表示向下凹陷深度） */
  depth: number;
  /** 环形山脊高度 */
  rimHeight: number;
  easing?: EasingType;
}

/** 喷出物关键帧：扩散半径、粒子发射速率、存活时长、扩散进度 0..1 */
export interface EjectaKeyframe {
  id: string;
  time: number;
  /** 喷出物扩散半径 */
  spread: number;
  /** 发射速率（粒子/秒） */
  emissionRate: number;
  /** 粒子生命（秒） */
  life: number;
  /** 扩散进度 0..1，驱动粒子整体向外推进 */
  progress: number;
  easing?: EasingType;
}

export type AnyKeyframe = CameraKeyframe | CraterKeyframe | EjectaKeyframe;

export type LeafKeyframeMap = {
  camera: CameraKeyframe;
  crater: CraterKeyframe;
  ejecta: EjectaKeyframe;
};

export interface BaseTrack {
  id: string;
  name: string;
  kind: TrackKind;
  /** 相对父轨（根轨则为全局时间线）的起始时间（秒） */
  start: number;
  /** 轨道时长（秒），必须 > 0 */
  duration: number;
  /** 轨道默认插值；对分组轨而言该曲线同时作用于子轨时间重映射 */
  easing: EasingType;
  muted: boolean;
  /** 分组轨的子轨道（仅 kind === 'group' 时存在） */
  children?: Track[];
}

export interface CameraTrack extends BaseTrack {
  kind: 'camera';
  keyframes: CameraKeyframe[];
}

export interface CraterTrack extends BaseTrack {
  kind: 'crater';
  keyframes: CraterKeyframe[];
}

export interface EjectaTrack extends BaseTrack {
  kind: 'ejecta';
  keyframes: EjectaKeyframe[];
}

export interface GroupTrack extends BaseTrack {
  kind: 'group';
  children: Track[];
}

export type LeafTrack = CameraTrack | CraterTrack | EjectaTrack;
export type Track = LeafTrack | GroupTrack;

export interface TimelineDocument {
  /** 文档结构版本，导入时做兼容性校验 */
  version: 1;
  /** 时间线总长度（秒） */
  duration: number;
  /** 根轨道（第 1 层） */
  tracks: Track[];
}

/** 最大嵌套层数（根轨算第 1 层） */
export const MAX_DEPTH = 3;

export function isGroup(track: Track): track is GroupTrack {
  return track.kind === 'group';
}

export function isLeaf(track: Track): track is LeafTrack {
  return track.kind !== 'group';
}

/** 返回轨道在树中的层级（根轨 = 1），找不到返回 -1 */
export function trackDepth(doc: TimelineDocument, trackId: string): number {
  const walk = (tracks: Track[], depth: number): number => {
    for (const t of tracks) {
      if (t.id === trackId) return depth;
      if (isGroup(t)) {
        const found = walk(t.children, depth + 1);
        if (found > 0) return found;
      }
    }
    return -1;
  };
  return walk(doc.tracks, 1);
}

/** 按 id 查找轨道 */
export function findTrack(doc: TimelineDocument, trackId: string): Track | undefined {
  const walk = (tracks: Track[]): Track | undefined => {
    for (const t of tracks) {
      if (t.id === trackId) return t;
      if (isGroup(t)) {
        const found = walk(t.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(doc.tracks);
}

/** 查找父分组；根轨返回 undefined */
export function findParent(doc: TimelineDocument, trackId: string): GroupTrack | undefined {
  const walk = (tracks: Track[]): GroupTrack | undefined => {
    for (const t of tracks) {
      if (isGroup(t)) {
        if (t.children.some((c) => c.id === trackId)) return t;
        const found = walk(t.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(doc.tracks);
}

/** 深度优先遍历，回调返回 true 时终止 */
export function walkTracks(
  tracks: Track[],
  fn: (track: Track, parent: GroupTrack | undefined, depth: number) => boolean | void,
  parent?: GroupTrack,
  depth = 1,
): boolean {
  for (const t of tracks) {
    if (fn(t, parent, depth) === true) return true;
    if (isGroup(t) && walkTracks(t.children, fn, t, depth + 1)) return true;
  }
  return false;
}

export function keyframesOf(track: LeafTrack): AnyKeyframe[] {
  return track.keyframes;
}

export function makeId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
