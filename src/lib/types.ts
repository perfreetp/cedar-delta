// 共享类型定义

export type ToolMode = 'sculpt' | 'centerline' | 'gate';

// 四个功能模块(剖面/导出模块下鼠标仅用于视角控制)
export type ModuleId = 'sculpt' | 'profile' | 'gate' | 'export';

export type BrushType = 'raise' | 'lower' | 'smooth' | 'flatten';

export type GateColor = 'red' | 'green';

export interface BrushSettings {
  type: BrushType;
  /** 笔刷半径(世界单位 m) */
  radius: number;
  /** 强度 0..1 */
  strength: number;
  /** 对称笔刷:同时雕刻中心线两岸 */
  symmetric: boolean;
}

/** 赛道中心线控制点(XZ 平面) */
export interface ControlPoint {
  id: string;
  x: number;
  z: number;
}

/** 落差台阶(跌水段) */
export interface Step {
  id: string;
  /** 沿中心线的弧长位置 m */
  s: number;
  /** 落差高度 m */
  drop: number;
  /** 过渡坡面角度(度) */
  angle: number;
}

/** 闸门 */
export interface Gate {
  id: string;
  color: GateColor;
  /** 沿中心线弧长站位 m */
  s: number;
  /** 相对中心线的横向偏移 m */
  offset: number;
  /** 两立柱间距 / 门杆长度 m */
  width: number;
  /** 立柱 A 落地点(世界坐标) */
  pA: [number, number, number];
  /** 立柱 B 落地点 */
  pB: [number, number, number];
  /** 门杆朝向(绕 Y 轴弧度) */
  yaw: number;
  /** 记录的入水高度(两立柱地面均值) */
  entryHeight: number;
  /** 下游平均坡度(百分比,拖动时联动重算) */
  downstreamGrade: number;
}

/** 历史快照:覆盖雕刻、台阶、闸门、中心线四类编辑 */
export interface Snapshot {
  base: Float32Array;
  controlPoints: ControlPoint[];
  steps: Step[];
  gates: Gate[];
}

/** 导出的赛道文件结构 */
export interface TrackFile {
  format: 'whitewater-track';
  version: number;
  meta: {
    name: string;
    exportedAt: string;
  };
  grid: {
    segments: number;
    width: number;
    length: number;
  };
  controlPoints: ControlPoint[];
  steps: Step[];
  gates: Gate[];
  baseHeights: number[];
}
