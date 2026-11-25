/**
 * 时间轴状态仓库
 *
 * 集中管理文档数据与播放状态，所有变更走显式操作方法并发出事件，
 * 界面组件与播放控制器订阅事件刷新，不直接改数据。
 */
import {
  type AnyKeyframe,
  type EasingType,
  type GroupTrack,
  type LeafTrack,
  type TimelineDocument,
  type Track,
  type TrackKind,
  MAX_DEPTH,
  findParent,
  isGroup,
  isLeaf,
  makeId,
  trackDepth,
  walkTracks,
} from './model';
import { clamp01, sortKeyframes } from './easing';
import { globalTimeOfLocal, localTimeAt, trackChain } from './evaluator';

export type StoreEvent = 'doc-change' | 'time-change' | 'selection-change';
type Listener = (event: StoreEvent) => void;

const EASINGS: ReadonlySet<EasingType> = new Set(['linear', 'ease', 'step']);
const LEAF_KINDS: ReadonlySet<TrackKind> = new Set(['camera', 'crater', 'ejecta']);

export class TimelineStore {
  doc: TimelineDocument;
  /** 当前播放头位置（全局秒） */
  currentTime = 0;
  playing = false;
  /** 独奏轨道 id（仅该叶子轨参与回放）；null 表示关闭独奏 */
  soloTrackId: string | null = null;
  /** 当前选中的轨道 id */
  selectedTrackId: string | null = null;
  /** 多选轨道 id（Ctrl/⌘+点击），用于多轨编组；与 selectedTrackId 同步维护 */
  selectedTrackIds: string[] = [];

  private listeners = new Set<Listener>();

  constructor(doc?: TimelineDocument) {
    this.doc = doc ?? createDefaultDocument();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: StoreEvent) {
    for (const fn of this.listeners) fn(event);
  }

  // ---------- 播放状态 ----------

  setTime(time: number) {
    this.currentTime = Math.min(this.doc.duration, Math.max(0, time));
    this.emit('time-change');
  }

  setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.emit('time-change');
  }

  setSolo(trackId: string | null) {
    this.soloTrackId = trackId;
    this.emit('doc-change');
  }

  select(trackId: string | null, additive = false) {
    if (additive && trackId) {
      const idx = this.selectedTrackIds.indexOf(trackId);
      if (idx >= 0) this.selectedTrackIds.splice(idx, 1);
      else this.selectedTrackIds.push(trackId);
      this.selectedTrackId = this.selectedTrackIds[this.selectedTrackIds.length - 1] ?? trackId;
    } else {
      this.selectedTrackId = trackId;
      this.selectedTrackIds = trackId ? [trackId] : [];
    }
    this.emit('selection-change');
  }

  /** 编组等操作实际使用的选中集合 */
  effectiveSelection(): string[] {
    return this.selectedTrackIds.length > 0 ? [...this.selectedTrackIds] : [];
  }

  setDuration(duration: number) {
    const d = Math.max(0.1, Number(duration) || 0);
    this.doc.duration = d;
    // 钳制超出新长度的根轨与播放头
    for (const t of this.doc.tracks) {
      t.start = Math.min(t.start, d);
      t.duration = Math.max(0.05, Math.min(t.duration, d - t.start));
    }
    this.currentTime = Math.min(this.currentTime, d);
    this.emit('doc-change');
    this.emit('time-change');
  }

  // ---------- 轨道增删改 ----------

  /**
   * 新增轨道。parentId 为空时加到根层；否则加到该分组内。
   * 深度超过 MAX_DEPTH 时抛错。
   */
  addTrack(kind: TrackKind, parentId: string | null = null): Track {
    const track = this.createTrack(kind);
    const container = parentId ? this.findGroupOrThrow(parentId) : null;
    const targetDepth = container ? trackDepth(this.doc, container.id) + 1 : 1;
    if (targetDepth > MAX_DEPTH) {
      throw new Error(`嵌套最多 ${MAX_DEPTH} 层，无法在该分组内继续添加轨道`);
    }
    if (container) {
      // 子轨默认占满父分组时长
      track.start = 0;
      track.duration = container.duration;
      container.children.push(track);
    } else {
      track.start = 0;
      track.duration = this.doc.duration;
      this.doc.tracks.push(track);
    }
    this.selectedTrackId = track.id;
    this.emit('doc-change');
    this.emit('selection-change');
    return track;
  }

  private createTrack(kind: TrackKind): Track {
    const base = {
      id: makeId(kind),
      name: this.autoName(kind),
      start: 0,
      duration: this.doc.duration,
      easing: 'linear' as EasingType,
      muted: false,
    };
    if (kind === 'group') return { ...base, kind: 'group', children: [] };
    if (kind === 'camera') {
      return {
        ...base,
        kind: 'camera',
        keyframes: [
          {
            id: makeId('kf'),
            time: 0,
            radius: 34,
            azimuth: Math.PI * 0.15,
            elevation: Math.PI / 5,
            target: [0, 1, 0],
          },
          {
            id: makeId('kf'),
            time: 0.5,
            radius: 26,
            azimuth: Math.PI * 0.6,
            elevation: Math.PI / 4.2,
            target: [0, 0, 0],
          },
          {
            id: makeId('kf'),
            time: 1,
            radius: 34,
            azimuth: Math.PI * 1.05,
            elevation: Math.PI / 6,
            target: [0, 1, 0],
          },
        ],
      };
    }
    if (kind === 'crater') {
      return {
        ...base,
        kind: 'crater',
        easing: 'ease',
        keyframes: [
          { id: makeId('kf'), time: 0, radius: 0.6, depth: 0.2, rimHeight: 0.1 },
          { id: makeId('kf'), time: 0.45, radius: 8, depth: 3, rimHeight: 1.5 },
          { id: makeId('kf'), time: 1, radius: 10, depth: 3.6, rimHeight: 1.2 },
        ],
      };
    }
    return {
      ...base,
      kind: 'ejecta',
      easing: 'ease',
      keyframes: [
        { id: makeId('kf'), time: 0, spread: 0.5, emissionRate: 300, life: 2, progress: 0 },
        { id: makeId('kf'), time: 0.35, spread: 13, emissionRate: 700, life: 2.6, progress: 0.75 },
        { id: makeId('kf'), time: 1, spread: 18, emissionRate: 0, life: 2, progress: 1 },
      ],
    };
  }

  private autoName(kind: TrackKind): string {
    const counts: Record<string, number> = { camera: 0, crater: 0, ejecta: 0, group: 0 };
    walkTracks(this.doc.tracks, (t) => {
      counts[t.kind] += 1;
    });
    const label: Record<TrackKind, string> = {
      camera: '相机路径',
      crater: '陨石坑生长',
      ejecta: '喷出物扩散',
      group: '分组',
    };
    return `${label[kind]} ${counts[kind] + 1}`;
  }

  /** 把若干同级轨道编组为新的父分组轨 */
  groupTracks(trackIds: string[]): GroupTrack {
    if (trackIds.length === 0) throw new Error('请先选择要编组的轨道');
    const first = this.findTrackOrThrow(trackIds[0]);
    const parent = findParent(this.doc, first.id);
    const siblings = parent ? parent.children : this.doc.tracks;
    if (!trackIds.every((id) => siblings.some((t) => t.id === id))) {
      throw new Error('只能对同一层级的轨道编组');
    }
    const depth = trackDepth(this.doc, first.id);
    if (depth >= MAX_DEPTH) {
      throw new Error(`嵌套最多 ${MAX_DEPTH} 层，无法再编组`);
    }
    const members = trackIds.map((id) => siblings.find((t) => t.id === id)!);
    const minStart = Math.min(...members.map((m) => m.start));
    const maxEnd = Math.max(...members.map((m) => m.start + m.duration));
    const group = this.createTrack('group') as GroupTrack;
    group.start = minStart;
    group.duration = Math.max(0.05, maxEnd - minStart);
    group.easing = 'ease';
    // 子轨 start 换算进分组局部秒空间
    for (const m of members) {
      m.start = m.start - minStart;
      m.duration = Math.min(m.duration, group.duration - m.start);
    }
    const idx = siblings.indexOf(first);
    for (const m of members) {
      const at = siblings.indexOf(m);
      siblings.splice(at, 1);
    }
    group.children.push(...members);
    siblings.splice(Math.min(idx, siblings.length), 0, group);
    this.selectedTrackId = group.id;
    this.emit('doc-change');
    this.emit('selection-change');
    return group;
  }

  /** 解散分组：子轨提升到分组所在层级，时间换算回父秒空间 */
  ungroupTrack(groupId: string) {
    const group = this.findGroupOrThrow(groupId);
    const parent = findParent(this.doc, groupId);
    const siblings = parent ? parent.children : this.doc.tracks;
    const idx = siblings.indexOf(group);
    const promoted = group.children.map((child) => {
      // 分组局部秒 -> 上一层秒空间（线性展开，忽略分组缓动，保证区间不重叠语义清晰）
      child.start = group.start + child.start;
      child.duration = Math.min(child.duration, group.start + group.duration - child.start);
      return child;
    });
    siblings.splice(idx, 1, ...promoted);
    if (this.selectedTrackId === groupId) this.selectedTrackId = null;
    this.emit('doc-change');
    this.emit('selection-change');
  }

  updateTrack(trackId: string, patch: Partial<Pick<Track, 'name' | 'start' | 'duration' | 'easing' | 'muted'>>) {
    const track = this.findTrackOrThrow(trackId);
    if (patch.name !== undefined) track.name = patch.name;
    if (patch.easing !== undefined && EASINGS.has(patch.easing)) track.easing = patch.easing;
    if (patch.muted !== undefined) track.muted = patch.muted;
    if (patch.start !== undefined || patch.duration !== undefined) {
      const parent = findParent(this.doc, trackId);
      const limit = parent ? parent.duration : this.doc.duration;
      const start = Math.max(0, patch.start ?? track.start);
      const duration = Math.max(0.05, patch.duration ?? track.duration);
      track.start = Math.min(start, limit - 0.05);
      track.duration = Math.min(duration, limit - track.start);
    }
    this.emit('doc-change');
  }

  toggleMute(trackId: string) {
    const track = this.findTrackOrThrow(trackId);
    track.muted = !track.muted;
    this.emit('doc-change');
  }

  deleteTrack(trackId: string) {
    const parent = findParent(this.doc, trackId);
    const siblings = parent ? parent.children : this.doc.tracks;
    const idx = siblings.findIndex((t) => t.id === trackId);
    if (idx < 0) return;
    siblings.splice(idx, 1);
    if (this.selectedTrackId === trackId) this.selectedTrackId = null;
    if (this.soloTrackId === trackId) this.soloTrackId = null;
    this.emit('doc-change');
    this.emit('selection-change');
  }

  // ---------- 关键帧 ----------

  /** 在指定全局秒位置为叶子轨添加关键帧（自动换算为局部时间） */
  addKeyframe(trackId: string, globalTime: number): AnyKeyframe {
    const track = this.findLeafOrThrow(trackId);
    const chain = trackChain(this.doc, trackId)!;
    let local = localTimeAt(chain, globalTime);
    if (local === null) {
      // 不在激活区间：钳制到最近端点
      const root = chain[0];
      local = globalTime < root.start ? 0 : 1;
    }
    const kf = this.seedKeyframe(track, clamp01(local));
    this.pushKeyframe(track, kf);
    this.emit('doc-change');
    return kf;
  }

  /** 按 kind 收窄后写入并排序，规避联合数组的 push 类型问题 */
  private pushKeyframe(track: LeafTrack, kf: AnyKeyframe) {
    if (track.kind === 'camera') {
      track.keyframes.push(kf as import('./model').CameraKeyframe);
      sortKeyframes(track.keyframes);
    } else if (track.kind === 'crater') {
      track.keyframes.push(kf as import('./model').CraterKeyframe);
      sortKeyframes(track.keyframes);
    } else {
      track.keyframes.push(kf as import('./model').EjectaKeyframe);
      sortKeyframes(track.keyframes);
    }
  }

  private seedKeyframe(track: LeafTrack, time: number): AnyKeyframe {
    const id = makeId('kf');
    if (track.kind === 'camera') {
      return { id, time, radius: 30, azimuth: Math.PI / 3, elevation: Math.PI / 5, target: [0, 0, 0] };
    }
    if (track.kind === 'crater') {
      return { id, time, radius: 6, depth: 2, rimHeight: 1 };
    }
    return { id, time, spread: 8, emissionRate: 300, life: 2, progress: 0.5 };
  }
  /** 修改关键帧数值（字段由具体轨道类型决定） */
  updateKeyframe(trackId: string, keyframeId: string, patch: Record<string, unknown>) {
    const track = this.findLeafOrThrow(trackId);
    const kf = track.keyframes.find((k) => k.id === keyframeId);
    if (!kf) throw new Error('关键帧不存在');
    Object.assign(kf, patch);
    if (typeof (patch as { time?: unknown }).time === 'number') {
      kf.time = clamp01(Number((patch as { time: number }).time));
    }
    this.sortLeafKeyframes(track);
    this.emit('doc-change');
  }

  /** 拖拽关键帧到新的全局秒位置：经父级缓动逆映射换算回局部时间 */
  moveKeyframeToGlobalTime(trackId: string, keyframeId: string, globalTime: number) {
    const track = this.findLeafOrThrow(trackId);
    const kf = track.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    const chain = trackChain(this.doc, trackId)!;
    let local = localTimeAt(chain, globalTime);
    if (local === null) {
      const root = chain[0];
      local = globalTime < root.start ? 0 : 1;
    }
    kf.time = clamp01(local);
    this.sortLeafKeyframes(track);
    this.emit('doc-change');
  }

  private sortLeafKeyframes(track: LeafTrack) {
    if (track.kind === 'camera') sortKeyframes(track.keyframes);
    else if (track.kind === 'crater') sortKeyframes(track.keyframes);
    else sortKeyframes(track.keyframes);
  }

  /** 复制关键帧到指定全局时间点，生成新 id */
  copyKeyframeAt(trackId: string, keyframeId: string, globalTime: number): AnyKeyframe {
    const track = this.findLeafOrThrow(trackId);
    const src = track.keyframes.find((k) => k.id === keyframeId);
    if (!src) throw new Error('源关键帧不存在');
    const chain = trackChain(this.doc, trackId)!;
    let local = localTimeAt(chain, globalTime);
    if (local === null) {
      const root = chain[0];
      local = globalTime < root.start ? 0 : 1;
    }
    const copy: AnyKeyframe = { ...src, id: makeId('kf'), time: clamp01(local) };
    this.pushKeyframe(track, copy);
    this.emit('doc-change');
    return copy;
  }

  deleteKeyframe(trackId: string, keyframeId: string) {
    const track = this.findLeafOrThrow(trackId);
    const idx = track.keyframes.findIndex((k) => k.id === keyframeId);
    if (idx >= 0) track.keyframes.splice(idx, 1);
    this.emit('doc-change');
  }

  /** 把全局秒换算成某轨的局部比例（供 UI 面板显示） */
  globalToLocal(trackId: string, globalTime: number): number {
    const chain = trackChain(this.doc, trackId);
    if (!chain) return 0;
    return localTimeAt(chain, globalTime) ?? 0;
  }

  /** 把某轨局部比例换算成全局秒（供 UI 定位） */
  localToGlobal(trackId: string, local: number): number {
    const chain = trackChain(this.doc, trackId);
    if (!chain) return 0;
    return globalTimeOfLocal(chain, local);
  }

  // ---------- 查询辅助 ----------

  findTrackOrThrow(trackId: string): Track {
    let found: Track | undefined;
    walkTracks(this.doc.tracks, (t) => {
      if (t.id === trackId) found = t;
    });
    if (!found) throw new Error(`轨道不存在: ${trackId}`);
    return found;
  }

  private findGroupOrThrow(trackId: string): GroupTrack {
    const t = this.findTrackOrThrow(trackId);
    if (!isGroup(t)) throw new Error('目标轨道不是分组轨');
    return t;
  }

  private findLeafOrThrow(trackId: string): LeafTrack {
    const t = this.findTrackOrThrow(trackId);
    if (!isLeaf(t)) throw new Error('目标轨道不是叶子轨');
    return t;
  }

  /** 独奏状态下某叶子轨是否实际参与回放 */
  isEffectivelyMuted(trackId: string): boolean {
    const track = this.findTrackOrThrow(trackId);
    if (!isLeaf(track)) return false;
    if (this.soloTrackId !== null) return this.soloTrackId !== trackId;
    return track.muted;
  }

  // ---------- 导入导出 ----------

  exportJSON(): string {
    return JSON.stringify(this.doc, null, 2);
  }

  loadJSON(text: string) {
    const parsed = JSON.parse(text) as TimelineDocument;
    validateDocument(parsed);
    this.doc = parsed;
    this.currentTime = 0;
    this.playing = false;
    this.soloTrackId = null;
    this.selectedTrackId = null;
    this.selectedTrackIds = [];
    this.emit('doc-change');
    this.emit('time-change');
    this.emit('selection-change');
  }
}

/** 导入校验：结构、层级深度、时间区间、枚举值全部检查，不合法即抛错 */
export function validateDocument(doc: unknown): asserts doc is TimelineDocument {
  if (typeof doc !== 'object' || doc === null) throw new Error('文档必须是对象');
  const d = doc as Partial<TimelineDocument>;
  if (d.version !== 1) throw new Error('不支持的文档版本');
  if (typeof d.duration !== 'number' || !(d.duration > 0) || !Number.isFinite(d.duration)) {
    throw new Error('时间线长度必须是正数');
  }
  if (!Array.isArray(d.tracks)) throw new Error('tracks 必须是数组');
  const ids = new Set<string>();
  const validateTrack = (t: unknown, depth: number, parentSpan: number) => {
    if (typeof t !== 'object' || t === null) throw new Error('轨道必须是对象');
    const tr = t as Track;
    if (typeof tr.id !== 'string' || !tr.id) throw new Error('轨道 id 非法');
    if (ids.has(tr.id)) throw new Error(`轨道 id 重复: ${tr.id}`);
    ids.add(tr.id);
    if (typeof tr.name !== 'string') throw new Error('轨道名称非法');
    if (!['linear', 'ease', 'step'].includes(tr.easing)) throw new Error('插值类型非法');
    if (typeof tr.muted !== 'boolean') throw new Error('muted 必须是布尔值');
    if (![tr.start, tr.duration].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new Error('轨道时间必须是数字');
    }
    if (tr.start < -1e-9 || tr.duration <= 0) throw new Error('轨道起始/时长非法');
    if (tr.start + tr.duration > parentSpan + 1e-6) {
      throw new Error(`轨道「${tr.name}」超出父级时间区间`);
    }
    if (depth > MAX_DEPTH) throw new Error(`嵌套超过 ${MAX_DEPTH} 层`);
    if (tr.kind === 'group') {
      if (depth >= MAX_DEPTH) throw new Error('最深层不能再包含分组');
      if (!Array.isArray(tr.children)) throw new Error('分组轨必须有 children 数组');
      tr.children.forEach((c) => validateTrack(c, depth + 1, tr.duration));
    } else if (!LEAF_KINDS.has(tr.kind)) {
      throw new Error(`未知轨道类型: ${String(tr.kind)}`);
    } else {
      const leaf = tr as LeafTrack;
      if (!Array.isArray(leaf.keyframes)) throw new Error('叶子轨必须有关键帧数组');
      const kfIds = new Set<string>();
      for (const kf of leaf.keyframes) {
        if (typeof kf.id !== 'string' || kfIds.has(kf.id)) throw new Error('关键帧 id 非法或重复');
        kfIds.add(kf.id);
        if (typeof kf.time !== 'number' || kf.time < 0 || kf.time > 1) {
          throw new Error('关键帧时间必须在 [0,1]');
        }
        if (kf.easing !== undefined && !EASINGS.has(kf.easing)) throw new Error('关键帧插值类型非法');
      }
    }
  };
  d.tracks.forEach((t) => validateTrack(t, 1, d.duration as number));
}

/** 默认演示文档：三层嵌套示例 + 相机弧线路径 */
export function createDefaultDocument(): TimelineDocument {
  return buildDefaultDocument();
}

// 避免构造函数递归：独立的默认文档构建函数
function buildDefaultDocument(): TimelineDocument {
  const doc: TimelineDocument = { version: 1, duration: 20, tracks: [] };

  const camera: LeafTrack = {
    id: makeId('camera'),
    name: '相机路径 1',
    kind: 'camera',
    start: 0,
    duration: 20,
    easing: 'linear',
    muted: false,
    keyframes: [
      {
        id: makeId('kf'),
        time: 0,
        radius: 36,
        azimuth: Math.PI * 0.1,
        elevation: Math.PI / 5,
        target: [0, 1, 0],
      },
      {
        id: makeId('kf'),
        time: 0.5,
        radius: 26,
        azimuth: Math.PI * 0.65,
        elevation: Math.PI / 4,
        target: [0, 0, 0],
      },
      {
        id: makeId('kf'),
        time: 1,
        radius: 34,
        azimuth: Math.PI * 1.15,
        elevation: Math.PI / 6.5,
        target: [0, 1, 0],
      },
    ],
  };

  const crater: LeafTrack = {
    id: makeId('crater'),
    name: '陨石坑生长 1',
    kind: 'crater',
    start: 0,
    duration: 12,
    easing: 'ease',
    muted: false,
    keyframes: [
      { id: makeId('kf'), time: 0, radius: 0.6, depth: 0.2, rimHeight: 0.1 },
      { id: makeId('kf'), time: 0.45, radius: 8, depth: 3, rimHeight: 1.5 },
      { id: makeId('kf'), time: 1, radius: 10, depth: 3.6, rimHeight: 1.2 },
    ],
  };

  const ejecta: LeafTrack = {
    id: makeId('ejecta'),
    name: '喷出物扩散 1',
    kind: 'ejecta',
    start: 0,
    duration: 14,
    easing: 'ease',
    muted: false,
    keyframes: [
      { id: makeId('kf'), time: 0, spread: 0.5, emissionRate: 300, life: 2, progress: 0 },
      { id: makeId('kf'), time: 0.35, spread: 13, emissionRate: 700, life: 2.6, progress: 0.75 },
      { id: makeId('kf'), time: 1, spread: 18, emissionRate: 0, life: 2, progress: 1 },
    ],
  };

  // 第三层：喷发阶段分组（depth-3 演示）
  const ejectPhase: GroupTrack = {
    id: makeId('group'),
    name: '喷发阶段',
    kind: 'group',
    start: 2,
    duration: 14,
    easing: 'ease',
    muted: false,
    children: [ejecta],
  };
  // ejecta 在分组局部空间内占满
  ejecta.start = 0;
  ejecta.duration = 14;

  const impactGroup: GroupTrack = {
    id: makeId('group'),
    name: '撞击序列',
    kind: 'group',
    start: 0,
    duration: 20,
    easing: 'ease',
    muted: false,
    children: [crater, ejectPhase],
  };
  crater.start = 0;
  crater.duration = 12;
  ejectPhase.start = 2;
  ejectPhase.duration = 14;

  doc.tracks.push(camera, impactGroup);
  return doc;
}
