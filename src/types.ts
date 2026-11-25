/** 要素大类 —— 与图层一一对应 */
export type LayerId =
  | 'hazard'      // 危险源
  | 'exit'        // 出口
  | 'stair'       // 楼梯
  | 'assembly'    // 集合点
  | 'path'        // 疏散路径线
  | 'point'       // 普通点位(房间/工位/人群)
  | 'area';       // 区域面

/** 点族子类型,决定绘制符号 */
export const PointKind = {
  GLYPH_SQUARE: 0,
  GLYPH_DOT: 1,
  GLYPH_RING: 2,
  GLYPH_TRIANGLE: 3,
  GLYPH_CHEVRON: 4,
  GLYPH_ZIGZAG: 5,
} as const;
export type PointKindValue = (typeof PointKind)[keyof typeof PointKind];

/** 单个要素的统一标识:图层 + 下标。两个数组拼成 features id 用 */
export interface FeatureRef {
  layer: LayerId;
  index: number;
}

export interface FeatureInfo {
  id: string;
  layer: LayerId;
  index: number;
  name: string;
  building?: string;
  floor?: string;
  x: number;
  y: number;
  meta?: Record<string, string | number>;
}

/** ---- 点族图层:SoA 存储 ---- */
export interface PointLayerData {
  count: number;
  x: Float32Array;
  y: Float32Array;
  /** 世界单位下的基础半径 */
  size: Float32Array;
  kind: Uint8Array;
  /** 所属楼层全局索引,-1 表示室外 */
  floor: Int32Array;
  ids: string[];
  names: string[];
  /** 地图上标注用的短名(空间紧张时不至于互相挤占) */
  short: string[];
}

/** ---- 路径线:并行数组 + offsets ---- */
export interface PathLayerData {
  count: number;
  /** 折线点世界坐标 [x0,y0,x1,y1,...] */
  coords: Float32Array;
  /** 每条折线在 coords 中的起始点序号 */
  offsets: Int32Array;
  /** 每条折线的权重(主干为 1,支路更小) */
  weight: Float32Array;
  floor: Int32Array;
  ids: string[];
  names: string[];
}

/** ---- 区域面 ---- */
export interface AreaLayerData {
  count: number;
  coords: Float32Array;
  offsets: Int32Array;
  /** 0=园区分区 1=楼栋轮廓 2=楼层轮廓 */
  rank: Uint8Array;
  /** 所属楼层,-1 室外 */
  floor: Int32Array;
  /** 包围盒,供 LOD 汇总与点查 */
  bbox: Float32Array;
  ids: string[];
  names: string[];
}

export interface FloorInfo {
  index: number;
  building: string;
  label: string;
  /** 楼层轮廓多边形,用于归属判定 */
  polygon: number[];
  centerX: number;
  centerY: number;
}

export interface Dataset {
  /** 实际要素占据的世界包围盒(用于自动取景) */
  content: { minX: number; minY: number; maxX: number; maxY: number };
  point: PointLayerData;
  exit: PointLayerData;
  stair: PointLayerData;
  assembly: PointLayerData;
  hazard: PointLayerData;
  path: PathLayerData;
  area: AreaLayerData;
  floors: FloorInfo[];
  /** 全局世界包围盒 */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** 全局档位使用的汇总点(楼栋级) */
  summary: { x: Float32Array; y: Float32Array; weight: Float32Array; count: number };
}

export type Camera = {
  /** 相机中心(世界坐标) */
  x: number;
  y: number;
  /** 每世界单位对应像素数 */
  zoom: number;
  /** 弧度,绕屏幕中心旋转 */
  rotation: number;
};

export interface LayerState {
  id: LayerId;
  visible: boolean;
  opacity: number;
}

export interface LodTier {
  id: number;
  name: string;
  /** zoom 下界(含) */
  minZoom: number;
  /** 面层细节 */
  areaMode: 'off' | 'outline' | 'fill';
  /** 路径层细节 */
  pathMode: 'off' | 'trunk' | 'full';
  /** 点族:summary 只画汇总点,individual 画每个 */
  pointMode: 'off' | 'summary' | 'individual';
  /** 该档位额外隐藏的图层(在图层开关之上再叠加) */
  enabled: Record<Exclude<LayerId, 'hazard'>, boolean>;
  /** 标注预算 */
  labelBudget: number;
  /** 允许出标注的最低优先级 */
  labelMinPriority: number;
}

export interface LodConfig {
  tiers: LodTier[];
}

export interface LabelConfig {
  budget: number;
  /** 低于此优先级在拥挤时允许收起 */
  collapseBelow: number;
}

export interface ViewState {
  version: 1;
  cameras: { overview: Camera; floor: Camera };
  layers: { id: LayerId; visible: boolean; opacity: number }[];
  tiers: LodTier[];
  label: LabelConfig;
  follow: boolean;
}
