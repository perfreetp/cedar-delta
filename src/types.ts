export type Vec3Tuple = [number, number, number];

export type ObstacleKind = 'rock' | 'buoy' | 'artificial';
export type TransformMode = 'translate' | 'rotate';
export type ModuleKey = 'library' | 'transform' | 'collision' | 'export';

export type ColliderSpec =
  | { kind: 'box'; size: Vec3Tuple }
  | { kind: 'cylinder'; radius: number; height: number; segments?: number }
  | {
      kind: 'compound';
      parts: Array<{
        collider: Exclude<ColliderSpec, { kind: 'compound' }>;
        position?: Vec3Tuple;
        rotation?: Vec3Tuple;
      }>;
    };

export interface LibraryItem {
  id: string;
  name: string;
  category: '岩石' | '浮标' | '人工障碍';
  kind: ObstacleKind;
  description: string;
  icon: string;
  baseSize: Vec3Tuple;
  defaultScale: Vec3Tuple;
  defaultExposure: number;
  defaultSuspension?: number;
  color: string;
  collider: ColliderSpec;
}

export interface Obstacle {
  id: string;
  libraryId: string;
  name: string;
  category: LibraryItem['category'];
  kind: ObstacleKind;
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  exposure: number;
  suspension: number;
  groupId: string | null;
  color: string;
  collider: ColliderSpec;
}

export interface BatchConfig {
  spacing: number;
  startS: number;
  lateral: number;
  memberIds: string[];
}

export interface ObGroup {
  id: string;
  name: string;
  color: string;
  batch?: BatchConfig;
}

export interface RiverConfig {
  length: number;
  width: number;
  centerWidth: number;
  curveAmplitude: number;
  segmentLength: number;
  waterLevel: number;
  channelBottom: number;
  channelTop: number;
}

export interface DetectionSettings {
  laneThreshold: number;
  pairThreshold: number;
  reefThreshold: number;
  showColliders: boolean;
  showChannel: boolean;
  showLabels: boolean;
}

export interface ProjectDocument {
  format: 'rapid-river-obstacle-layout';
  formatVersion: 1;
  name: string;
  river: RiverConfig;
  detection: DetectionSettings;
  obstacles: Obstacle[];
  groups: ObGroup[];
}

export interface PairCollision {
  aId: string;
  bId: string;
  volume: number;
}

export interface CollisionReport {
  ready: boolean;
  computing: boolean;
  laneVolumes: Record<string, number>;
  pairs: PairCollision[];
  durationMs: number;
  obstacleCount: number;
  solidCount: number;
  error?: string;
}

export interface SelectionGestureUpdate {
  id: string;
  position: Vec3Tuple;
  rotation: Vec3Tuple;
}

export const MODULE_META: Array<{ key: ModuleKey; index: string; title: string; subtitle: string; icon: string }> = [
  { key: 'library', index: '01', title: '障碍库', subtitle: '拖入岩石、浮标与人工障碍', icon: '▰' },
  { key: 'transform', index: '02', title: '摆放变换', subtitle: '手柄、轴向缩放、分组与批量列', icon: '✥' },
  { key: 'collision', index: '03', title: '碰撞检测', subtitle: 'Manifold 布尔求交与占道阈值', icon: '◈' },
  { key: 'export', index: '04', title: '方案导出', subtitle: '生成可分享的布置方案文件', icon: '↥' },
];
