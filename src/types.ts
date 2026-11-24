/**
 * 全局类型定义与项目文件格式
 */

/** 二维点（场地平面坐标，单位：米，y 轴向上，物体落在 y=0） */
export interface Vec2 {
  x: number;
  z: number;
}

/** 矩形区域 */
export interface RectRegion {
  id: string;
  type: 'rect';
  name: string;
  /** 中心位置 */
  x: number;
  z: number;
  /** 宽（沿本地 x）/ 深（沿本地 z），米 */
  width: number;
  depth: number;
  /** 绕 y 轴旋转，弧度 */
  rotation: number;
  color: string;
}

/** 多边形区域（顶点为相对世界原点的绝对坐标，逆时针/顺时针均可） */
export interface PolygonRegion {
  id: string;
  type: 'polygon';
  name: string;
  points: Vec2[];
  color: string;
}

export type Region = RectRegion | PolygonRegion;

/** 场景中摆放的物体实例 */
export interface PlacedObject {
  id: string;
  /** 对应物体库 catalog id */
  catalogId: string;
  /** 类别（冗余存储，便于隐藏/分组） */
  category: string;
  name: string;
  x: number;
  z: number;
  /** 绕 y 轴弧度 */
  rotation: number;
  /** 尺寸（米），从 catalog 复制，允许单独缩放修改 */
  width: number;
  depth: number;
  height: number;
  /** 统一缩放倍率（默认 1），实际占地 = width*scale */
  scale: number;
  color: string;
  visible: boolean;
}

/** 网格与吸附设置 */
export interface SnapSettings {
  /** 网格吸附开关 */
  gridEnabled: boolean;
  /** 物体间吸附开关 */
  objectEnabled: boolean;
  /** 网格间距（米） */
  gridSize: number;
  /** 吸附距离阈值（米） */
  threshold: number;
}

export type ViewMode = 'perspective' | 'top';

export interface ProjectData {
  version: 1;
  name: string;
  regions: Region[];
  objects: PlacedObject[];
  snap: SnapSettings;
  createdAt: number;
  updatedAt: number;
}

/** 物体库条目定义 */
export interface CatalogItem {
  id: string;
  category: string;
  name: string;
  /** 默认尺寸（米） */
  width: number;
  depth: number;
  height: number;
  color: string;
  /** 占地形状：矩形 / 圆形（圆形使用 width 作为直径） */
  footprint: 'box' | 'circle';
  /** 几何构建器 key */
  geometry: string;
}

/** 物体变换（移动/旋转撤销用） */
export interface TransformSnapshot {
  id: string;
  x: number;
  z: number;
  rotation: number;
  scale: number;
}
