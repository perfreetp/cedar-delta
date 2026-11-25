/**
 * 时间轴评测引擎
 *
 * 所有场景状态都通过 evaluateTimeline(doc, globalTime) 这一纯函数得到，
 * 拖动播放头（scrub）与正式播放（playback）调用的是同一个函数，
 * 因此两者的回放结果天然一致。
 *
 * 嵌套时间映射（链 T0 根 … Tn 叶）：
 *   每个轨道在父坐标系中占用 [start, start+duration]；
 *   分组轨 G 的缓动 f_G 作用于「内部局部比例 -> 输出给父级的比例」：
 *     叶子局部比例 u 向上映射：
 *       父坐标秒 s = start_i + dur_i * u_i
 *       父分组内部比例 r = (s - start_G) / dur_G
 *       分组输出比例 u_G = f_G(r)  —— 作为祖父看到的 G 的局部比例
 *     全局时间向下反解：逐级 f_G^{-1}，再按子轨 span 换算。
 *   修改分组缓动后，子关键帧的全局位置（globalTimeOfLocal）自动按新曲线重排，
 *   而局部关键帧数据不变。
 */
import {
  type AnyKeyframe,
  type CameraKeyframe,
  type CameraTrack,
  type CraterKeyframe,
  type CraterTrack,
  type EasingType,
  type EjectaKeyframe,
  type EjectaTrack,
  type GroupTrack,
  type LeafTrack,
  type TimelineDocument,
  type Track,
  type Vec3Tuple,
  isGroup,
} from './model';
import {
  blendValues,
  clamp,
  clamp01,
  easingForward,
  easingInverse,
  lerp,
  lerpAngle,
  lerpVec3,
  locateSegment,
  smoothstep,
} from './easing';

const EPS = 1e-9;

/** 相机在某一时刻的世界状态（位置由球面坐标换算而来） */
export interface CameraState {
  position: Vec3Tuple;
  target: Vec3Tuple;
  radius: number;
  azimuth: number;
  elevation: number;
}

export interface CraterState {
  radius: number;
  depth: number;
  rimHeight: number;
  /** 生长进度 0..1（由首末关键帧半径归一化得出，供着色等使用） */
  growth: number;
}

export interface EjectaState {
  spread: number;
  emissionRate: number;
  life: number;
  progress: number;
}

export interface LeafSample {
  trackId: string;
  kind: LeafTrack['kind'];
  name: string;
  muted: boolean;
  /** 该轨在当前全局时间是否处于激活区间 */
  active: boolean;
  /** 当前全局时间对应的轨道局部时间 [0,1]（已含各级父分组缓动重映射） */
  localTime: number;
  camera?: CameraState;
  crater?: CraterState;
  ejecta?: EjectaState;
}

export interface TimelineEvaluation {
  globalTime: number;
  duration: number;
  samples: LeafSample[];
  /** 当前时间点激活（未静音且在区间内）的叶子轨 id，供界面高亮 */
  activeTrackIds: string[];
  /** 当前时间点静音的叶子轨 id */
  mutedTrackIds: string[];
}

/** 球面坐标 -> 笛卡尔坐标（相机沿弧线运动的几何基础） */
export function sphericalToCartesian(
  radius: number,
  azimuth: number,
  elevation: number,
): Vec3Tuple {
  const cosEl = Math.cos(elevation);
  return [
    radius * cosEl * Math.cos(azimuth),
    radius * Math.sin(elevation),
    radius * cosEl * Math.sin(azimuth),
  ];
}

/** 取得从根到叶的轨道链；找不到返回 null */
export function trackChain(doc: TimelineDocument, trackId: string): Track[] | null {
  const walk = (tracks: Track[], chain: Track[]): Track[] | null => {
    for (const t of tracks) {
      const next = [...chain, t];
      if (t.id === trackId) return next;
      if (isGroup(t)) {
        const found = walk(t.children, next);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(doc.tracks, []);
}

/**
 * 正向映射：叶子轨局部比例 -> 全局秒。
 * 与 localTimeAt 互为严格逆运算（step 缓动除外，其逆函数取区间中点）。
 */
export function globalTimeOfLocal(chain: Track[], local: number): number {
  let u = clamp01(local); // 当前轨道的内部局部比例
  for (let i = chain.length - 1; i >= 0; i--) {
    const track = chain[i];
    // 当前轨道在父坐标系中的秒位置
    const secs = track.start + track.duration * u;
    if (i === 0) return secs; // 根轨的父坐标即全局时间线
    const parent = chain[i - 1] as GroupTrack;
    const parentRatio = clamp01((secs - parent.start) / parent.duration);
    // 父分组缓动：内部比例 -> 输出给祖父的比例
    u = easingForward(parent.easing, parentRatio);
  }
  return 0;
}

/**
 * 逆向映射：全局秒 -> 叶子轨局部比例。
 * 任一级 span 不覆盖该时间则返回 null（即该轨当前未激活）。
 */
export function localTimeAt(chain: Track[], globalTime: number): number | null {
  const root = chain[0];
  if (globalTime < root.start - EPS || globalTime > root.start + root.duration + EPS) {
    return null;
  }
  let u = clamp01((globalTime - root.start) / root.duration);
  for (let i = 1; i < chain.length; i++) {
    const parent = chain[i - 1] as GroupTrack;
    const child = chain[i];
    // 反解父分组内部比例
    const parentInternal = easingInverse(parent.easing, u);
    const parentSecs = parent.start + parent.duration * parentInternal;
    if (parentSecs < child.start - EPS || parentSecs > child.start + child.duration + EPS) {
      return null;
    }
    u = clamp01((parentSecs - child.start) / child.duration);
  }
  return u;
}

function frameEasing(frame: AnyKeyframe, track: LeafTrack) {
  return frame.easing ?? track.easing;
}

/** 段内统一的缓动因子：linear 原样、ease 走 smoothstep、step 未到段末保持前值 */
function segmentFactor(t: number, type: EasingType): number {
  if (type === 'ease') return smoothstep(t);
  if (type === 'step') return t >= 1 ? 1 : 0;
  return t;
}

/** 不修改原数据的有序副本（评测是纯函数，不能动 store 里的数组） */
function sortedCopy<T extends { time: number; id: string }>(frames: T[]): T[] {
  return [...frames].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
}

function evalCamera(track: CameraTrack, local: number): CameraState {
  const frames = sortedCopy(track.keyframes);
  if (frames.length === 0) {
    const target: Vec3Tuple = [0, 0, 0];
    return {
      position: sphericalToCartesian(30, Math.PI / 4, Math.PI / 6),
      target,
      radius: 30,
      azimuth: Math.PI / 4,
      elevation: Math.PI / 6,
    };
  }
  const { prev, next, t } = locateSegment(frames, local);
  const a = frames[prev] as CameraKeyframe;
  const b = frames[next] as CameraKeyframe;
  const type = frameEasing(a, track);
  const f = segmentFactor(t, type);
  const radius = lerp(a.radius, b.radius, f);
  const azimuth = lerpAngle(a.azimuth, b.azimuth, f);
  const elevation = lerp(a.elevation, b.elevation, f);
  const target = lerpVec3(a.target, b.target, f);
  return {
    position: sphericalToCartesian(radius, azimuth, elevation),
    target,
    radius,
    azimuth,
    elevation,
  };
}

function evalCrater(track: CraterTrack, local: number): CraterState {
  const frames = sortedCopy(track.keyframes);
  if (frames.length === 0) {
    return { radius: 6, depth: 2, rimHeight: 1, growth: 0 };
  }
  const { prev, next, t } = locateSegment(frames, local);
  const a = frames[prev] as CraterKeyframe;
  const b = frames[next] as CraterKeyframe;
  const type = frameEasing(a, track);
  const radius = blendValues(a.radius, b.radius, t, type);
  const depth = blendValues(a.depth, b.depth, t, type);
  const rimHeight = blendValues(a.rimHeight, b.rimHeight, t, type);
  const first = frames[0] as CraterKeyframe;
  const last = frames[frames.length - 1] as CraterKeyframe;
  const span = last.radius - first.radius;
  const growth = span <= EPS ? 0 : clamp01((radius - first.radius) / span);
  return { radius, depth, rimHeight, growth };
}

function evalEjecta(track: EjectaTrack, local: number): EjectaState {
  const frames = sortedCopy(track.keyframes);
  if (frames.length === 0) {
    return { spread: 0, emissionRate: 0, life: 2, progress: 0 };
  }
  const { prev, next, t } = locateSegment(frames, local);
  const a = frames[prev] as EjectaKeyframe;
  const b = frames[next] as EjectaKeyframe;
  const type = frameEasing(a, track);
  return {
    spread: blendValues(a.spread, b.spread, t, type),
    emissionRate: blendValues(a.emissionRate, b.emissionRate, t, type),
    life: blendValues(a.life, b.life, t, type),
    progress: blendValues(a.progress, b.progress, t, type),
  };
}

/**
 * 评测整条时间线。纯函数：相同输入永远得到相同输出。
 * 播放与拖动都只调用本函数。
 */
export function evaluateTimeline(doc: TimelineDocument, globalTime: number): TimelineEvaluation {
  const time = clamp(globalTime, 0, doc.duration);
  const samples: LeafSample[] = [];
  const activeTrackIds: string[] = [];
  const mutedTrackIds: string[] = [];

  const visit = (track: Track) => {
    if (isGroup(track)) {
      track.children.forEach(visit);
      return;
    }
    const chain = trackChain(doc, track.id)!;
    const local = localTimeAt(chain, time);
    const sample: LeafSample = {
      trackId: track.id,
      kind: track.kind,
      name: track.name,
      muted: track.muted,
      active: local !== null,
      localTime: local ?? 0,
    };
    if (local !== null) {
      if (track.kind === 'camera') sample.camera = evalCamera(track, local);
      if (track.kind === 'crater') sample.crater = evalCrater(track, local);
      if (track.kind === 'ejecta') sample.ejecta = evalEjecta(track, local);
    }
    if (track.muted) mutedTrackIds.push(track.id);
    if (local !== null && !track.muted) activeTrackIds.push(track.id);
    samples.push(sample);
  };

  doc.tracks.forEach(visit);

  return {
    globalTime: time,
    duration: doc.duration,
    samples,
    activeTrackIds,
    mutedTrackIds,
  };
}

/**
 * 某叶子轨关键帧在全局时间线上的秒位置（时间轴 UI 渲染用）。
 * 父分组改缓动后，返回值自动按新曲线变化 —— 即「关键帧按新曲线重排」。
 */
export function keyframeGlobalTimes(
  chain: Track[],
): { id: string; globalTime: number; localTime: number }[] {
  const leaf = chain[chain.length - 1] as LeafTrack;
  return leaf.keyframes.map((kf) => ({
    id: kf.id,
    localTime: kf.time,
    globalTime: globalTimeOfLocal(chain, kf.time),
  }));
}
