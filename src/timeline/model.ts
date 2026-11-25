import type {
  GroupNode,
  Keyframe,
  Pose,
  TimelineDoc,
  TimelineNode,
  TrackNode,
  TrackTarget,
  Vec3,
} from './types';
import { LINEAR, uid } from './types';
import { cubicBezierY } from './easing';

// ---------- 树遍历 ----------

export function isGroup(n: TimelineNode): n is GroupNode {
  return n.kind === 'group';
}

export function allTracks(nodes: TimelineNode[]): TrackNode[] {
  const out: TrackNode[] = [];
  const walk = (ns: TimelineNode[]) => {
    for (const n of ns) {
      if (isGroup(n)) walk(n.children);
      else out.push(n);
    }
  };
  walk(nodes);
  return out;
}

export function findNode(nodes: TimelineNode[], id: string): TimelineNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (isGroup(n)) {
      const r = findNode(n.children, id);
      if (r) return r;
    }
  }
  return null;
}

export function findParent(nodes: TimelineNode[], id: string): GroupNode | 'root' | null {
  for (const n of nodes) {
    if (n.id === id) return 'root';
    if (isGroup(n)) {
      if (n.children.some((c) => c.id === id)) return n;
      const r = findParent(n.children, id);
      if (r) return r;
    }
  }
  return null;
}

function childrenOf(doc: TimelineDoc, parent: GroupNode | 'root'): TimelineNode[] {
  return parent === 'root' ? doc.nodes : parent.children;
}

/** 节点自身的本地时长(未乘 scale) */
export function localDuration(node: TimelineNode): number {
  if (isGroup(node)) {
    let end = 0;
    for (const c of node.children) {
      end = Math.max(end, c.start + c.scale * localDuration(c));
    }
    return end;
  }
  return node.keys.length ? node.keys[node.keys.length - 1].time : 0;
}

/** 节点在父级时间轴上的结束时间 */
export function nodeEnd(node: TimelineNode): number {
  return node.start + node.scale * localDuration(node);
}

// ---------- 采样 ----------

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 欧拉角按最短路径插值(避免 2π 跳变) */
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function lerpRot(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerpAngle(a[0], b[0], t), lerpAngle(a[1], b[1], t), lerpAngle(a[2], b[2], t)];
}

/** 在轨道本地时间采样姿态 */
export function sampleTrackLocal(track: TrackNode, localTime: number): Pose | null {
  const keys = track.keys;
  if (!keys.length) return null;
  if (localTime <= keys[0].time) return { position: [...keys[0].position], rotation: [...keys[0].rotation] };
  const last = keys[keys.length - 1];
  if (localTime >= last.time) return { position: [...last.position], rotation: [...last.rotation] };
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].time <= localTime) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.time - a.time;
  const raw = span <= 1e-9 ? 1 : (localTime - a.time) / span;
  const t = cubicBezierY(a.easing, raw);
  return { position: lerpVec(a.position, b.position, t), rotation: lerpRot(a.rotation, b.rotation, t) };
}

/** 全局时间 -> 某条轨道的本地时间(沿祖先链逐层反映射) */
export function globalToLocal(doc: TimelineDoc, trackId: string, globalTime: number): number {
  const chain: TimelineNode[] = [];
  const walk = (ns: TimelineNode[]): boolean => {
    for (const n of ns) {
      if (n.id === trackId) {
        chain.push(n);
        return true;
      }
      if (isGroup(n) && walk(n.children)) {
        chain.push(n);
        return true;
      }
    }
    return false;
  };
  walk(doc.nodes);
  // chain 从叶到根;时间从全局逐层映射回本地
  let t = globalTime;
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    t = n.scale !== 0 ? (t - n.start) / n.scale : 0;
  }
  return t;
}

/** 用全局时间采样整条时间轴上所有轨道的姿态 */
export function sampleAll(doc: TimelineDoc, globalTime: number): Map<string, Pose> {
  const out = new Map<string, Pose>();
  for (const tr of allTracks(doc.nodes)) {
    const pose = sampleTrackLocal(tr, globalToLocal(doc, tr.id, globalTime));
    if (pose) out.set(tr.target, pose);
  }
  return out;
}

// ---------- 关键帧操作 ----------

export function sortKeys(track: TrackNode) {
  track.keys.sort((a, b) => a.time - b.time);
}

export function upsertKey(track: TrackNode, time: number, pose: Pose): Keyframe {
  const EPS = 1e-3;
  const existing = track.keys.find((k) => Math.abs(k.time - time) < EPS);
  if (existing) {
    existing.position = [...pose.position];
    existing.rotation = [...pose.rotation];
    return existing;
  }
  const key: Keyframe = {
    id: uid('k'),
    time,
    position: [...pose.position],
    rotation: [...pose.rotation],
    easing: { ...LINEAR },
  };
  track.keys.push(key);
  sortKeys(track);
  return key;
}

/**
 * 移动关键帧;ripple 为 true 时,该轨上其后的关键帧按相同位移整体平移,
 * 保持间距、不堆叠(时长变化后自动重排)。
 */
export function moveKey(track: TrackNode, keyId: string, newTime: number, ripple: boolean) {
  sortKeys(track);
  const idx = track.keys.findIndex((k) => k.id === keyId);
  if (idx < 0) return;
  const key = track.keys[idx];
  const clamped = Math.max(0, newTime);
  const delta = clamped - key.time;
  if (ripple) {
    for (let i = idx; i < track.keys.length; i++) {
      track.keys[i].time = Math.max(0, track.keys[i].time + delta);
    }
  } else {
    key.time = clamped;
    sortKeys(track);
  }
}

export function deleteKey(track: TrackNode, keyId: string) {
  track.keys = track.keys.filter((k) => k.id !== keyId);
}

// ---------- 编组 ----------

/** 把选中的节点收进一个新组;组的时间范围取选中节点的并集 */
export function groupNodes(doc: TimelineDoc, ids: string[]): GroupNode | null {
  if (ids.length < 2) return null;
  const parent = findParent(doc.nodes, ids[0]);
  if (!parent) return null;
  // 所有选中项必须在同一父级下
  for (const id of ids) {
    if (findParent(doc.nodes, id) !== parent) return null;
  }
  const list = childrenOf(doc, parent);
  const picked = list.filter((n) => ids.includes(n.id));
  if (picked.length < 2) return null;

  const start = Math.min(...picked.map((n) => n.start));
  const end = Math.max(...picked.map(nodeEnd));
  const group: GroupNode = {
    kind: 'group',
    id: uid('g'),
    name: '编组',
    children: [],
    start,
    scale: 1,
  };
  for (const n of picked) {
    n.start = n.start - start; // 转为组内本地时间
    group.children.push(n);
  }
  const remain = list.filter((n) => !ids.includes(n.id));
  // 组插入到原来第一个选中节点的位置
  const firstIdx = list.findIndex((n) => ids.includes(n.id));
  remain.splice(Math.min(firstIdx, remain.length), 0, group);
  if (parent === 'root') doc.nodes = remain;
  else parent.children = remain;
  return group;
}

export function ungroup(doc: TimelineDoc, groupId: string) {
  const g = findNode(doc.nodes, groupId);
  if (!g || !isGroup(g)) return;
  const parent = findParent(doc.nodes, groupId);
  if (!parent) return;
  const list = childrenOf(doc, parent);
  const idx = list.findIndex((n) => n.id === groupId);
  const released = g.children.map((c) => ({
    ...c,
    // 组内本地时间 -> 父级时间:parent = g.start + g.scale * (c.start + c.scale * local)
    start: g.start + g.scale * c.start,
    scale: g.scale * c.scale,
  }));
  list.splice(idx, 1, ...released);
}

/** 整组平移(改起止、组内相对节奏不变) */
export function moveGroup(doc: TimelineDoc, groupId: string, newStart: number) {
  const g = findNode(doc.nodes, groupId);
  if (!g || !isGroup(g)) return;
  g.start = Math.max(0, newStart);
}

/** 整组缩放时长(拉伸/压缩,组内相对比例不变) */
export function scaleGroup(doc: TimelineDoc, groupId: string, newScale: number) {
  const g = findNode(doc.nodes, groupId);
  if (!g || !isGroup(g)) return;
  g.scale = Math.max(0.05, newScale);
}

// ---------- 文档 ----------

import { ENTRY, TUNNEL_DIR, add, mul } from '../layout';
import { eulerAlignYTo } from './math3d';
import { presetEasing } from './easing';

export function createDefaultDoc(): TimelineDoc {
  const doc: TimelineDoc = { version: 1, duration: 10, nodes: [] };
  const dir = TUNNEL_DIR;
  const rot = eulerAlignYTo(dir);

  const key = (time: number, position: Vec3, rotation: Vec3, easing = presetEasing('linear')): Keyframe => ({
    id: uid('k'),
    time,
    position,
    rotation,
    easing,
  });
  const mk = (name: string, target: TrackTarget, keys: Keyframe[]): TrackNode => ({
    kind: 'track',
    id: uid('t'),
    name,
    target,
    keys,
    start: 0,
    scale: 1,
  });

  // 器械:悬停 -> 沿骨面滑到钉道口(减速,easeOut)-> 进入钉道(加速,easeIn)
  const instrument = mk('植入器械', 'instrument', [
    key(0, add(ENTRY, [1.6, 2.4, 1.2]), rot, presetEasing('easeOut')),
    key(4, add(ENTRY, mul(dir, -0.3)), rot, presetEasing('easeIn')),
    key(7, add(ENTRY, mul(dir, 2.4)), rot),
  ]);

  // 导针:先于器械到位,深入钉道(放在嵌套组里)
  const guidewire = mk('导针', 'guidewire', [
    key(0, add(add(ENTRY, mul(dir, -1.2)), [0, 0.4, 0]), rot, presetEasing('easeInOut')),
    key(2.5, ENTRY, rot, presetEasing('easeIn')),
    key(5, add(ENTRY, mul(dir, 3.2)), rot),
  ]);

  // 相机:绕钉道口一圈看进钉方向;rotation 字段存观察目标点
  const orbitR = 7;
  const camKey = (t: number, angleDeg: number, h: number, e = presetEasing('easeInOut')) => {
    const a = (angleDeg * Math.PI) / 180;
    return key(
      t,
      [ENTRY[0] + orbitR * Math.cos(a), ENTRY[1] + h, ENTRY[2] + orbitR * Math.sin(a)],
      [...ENTRY],
      e,
    );
  };
  const camera = mk('相机', 'camera', [
    camKey(0, 30, 2.5),
    camKey(3, 120, 1.5),
    camKey(6, 210, 3.0),
    camKey(9, 330, 2.0),
  ]);

  // 嵌套:导针组 嵌在 器械+相机 组里
  const wireGroup: GroupNode = {
    kind: 'group',
    id: uid('g'),
    name: '导针动作',
    children: [guidewire],
    start: 0,
    scale: 1,
  };
  const mainGroup: GroupNode = {
    kind: 'group',
    id: uid('g'),
    name: '器械 + 相机',
    children: [instrument, camera, wireGroup],
    start: 0,
    scale: 1,
  };
  doc.nodes = [mainGroup];
  return doc;
}

export function serialize(doc: TimelineDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function deserialize(json: string): TimelineDoc {
  const doc = JSON.parse(json) as TimelineDoc;
  if (doc.version !== 1 || !Array.isArray(doc.nodes)) throw new Error('时间轴文件格式不正确');
  return doc;
}
