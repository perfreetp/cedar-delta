export type FlowerType = 'rose' | 'hydrangea' | 'eucalyptus';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export type ViewMode = 'top' | 'side' | 'free';

export interface Vec3Array extends Array<number> {
  0: number;
  1: number;
  2: number;
}

export interface FlowerInstance {
  id: string;
  type: FlowerType;
  name: string;
  /** XZ 为桌面坐标，Y 为桌面以上的额外垂直偏移。 */
  position: [number, number, number];
  /** Euler XYZ，弧度。 */
  rotation: [number, number, number];
  scale: [number, number, number];
  /** 花器高度造成的整体抬高。 */
  vaseHeight: number;
  groupId: string | null;
  colorSeed?: number;
}

export interface GroupData {
  id: string;
  name: string;
  memberIds: string[];
  createdAt?: number;
}

export interface DesignDocument {
  app: 'banquet-floral-editor';
  version: 1;
  tableRadius: number;
  instances: FlowerInstance[];
  groups: GroupData[];
}

export interface HistorySnapshot {
  label: string;
  snapshot: DesignDocument;
  time: number;
}

export interface SelectionInfo {
  count: number;
  groupId: string | null;
  groupName: string | null;
  center: [number, number, number];
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  typeCounts: Record<FlowerType, number>;
  vaseHeight: number | null;
  scale: [number, number, number] | null;
}

export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  text: string;
  subtext?: string;
  warning?: boolean;
}

export const FLOWER_ORDER: FlowerType[] = ['rose', 'hydrangea', 'eucalyptus'];

export const FLOWER_META: Record<
  FlowerType,
  { label: string; latin: string; color: string; soft: string; radius: number; defaultScale: number }
> = {
  rose: {
    label: '玫瑰',
    latin: 'Rosa',
    color: '#e85d75',
    soft: 'rgba(232,93,117,.14)',
    radius: 0.17,
    defaultScale: 1,
  },
  hydrangea: {
    label: '绣球',
    latin: 'Hydrangea',
    color: '#8b7cf6',
    soft: 'rgba(139,124,246,.15)',
    radius: 0.25,
    defaultScale: 0.95,
  },
  eucalyptus: {
    label: '尤加利叶',
    latin: 'Eucalyptus',
    color: '#58a88c',
    soft: 'rgba(88,168,140,.15)',
    radius: 0.18,
    defaultScale: 1.05,
  },
};

export const MAX_INSTANCES = 3000;
export const TABLE_SURFACE_Y = 0;
export const DEFAULT_TABLE_RADIUS = 4.5;
export const HISTORY_LIMIT = 50;
export const STORAGE_KEY = 'banquet-floral-editor:document:v1';
