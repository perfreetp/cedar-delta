// 时间轴数据模型:轨道 / 关键帧 / 编组(可嵌套)
export type Vec3 = [number, number, number];

export type EasingPreset = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** 段缓动:贝塞尔控制点(x1,y1,x2,y2),等价 CSS cubic-bezier */
export interface Easing {
  preset: EasingPreset | 'custom';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const LINEAR: Easing = { preset: 'linear', x1: 0, y1: 0, x2: 1, y2: 1 };

export interface Keyframe {
  id: string;
  /** 轨道本地时间(秒) */
  time: number;
  position: Vec3;
  /** 欧拉角(弧度,XYZ) */
  rotation: Vec3;
  /** 指向下一关键帧这一段使用的缓动 */
  easing: Easing;
}

export type TrackTarget = 'instrument' | 'guidewire' | 'camera';

export interface TrackNode {
  kind: 'track';
  id: string;
  name: string;
  target: TrackTarget;
  keys: Keyframe[];
  /** 在父级(组或根)里的时间映射:parentTime = start + scale * localTime */
  start: number;
  scale: number;
}

export interface GroupNode {
  kind: 'group';
  id: string;
  name: string;
  children: TimelineNode[];
  /** 组整体时间映射:parentTime = start + scale * localTime,组内相对节奏不变 */
  start: number;
  scale: number;
}

export type TimelineNode = TrackNode | GroupNode;

export interface TimelineDoc {
  version: 1;
  duration: number;
  nodes: TimelineNode[];
}

export interface Pose {
  position: Vec3;
  rotation: Vec3;
}

let seq = 0;
export function uid(prefix = 'n'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}
