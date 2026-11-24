// 高度场网格与赛道的全局常量

export const GRID_SEGMENTS = 128; // 129 x 129 = 16641 个顶点
export const VERTS_PER_SIDE = GRID_SEGMENTS + 1;
export const TOTAL_VERTS = VERTS_PER_SIDE * VERTS_PER_SIDE;

export const TERRAIN_WIDTH = 120; // X 方向 m
export const TERRAIN_LENGTH = 240; // Z 方向 m
export const CELL_X = TERRAIN_WIDTH / GRID_SEGMENTS;
export const CELL_Z = TERRAIN_LENGTH / GRID_SEGMENTS;

export const PROFILE_SAMPLES = 240; // 中心线/剖面采样数

export const HISTORY_LIMIT = 60;

// 河床几何参数
export const BASE_HALF_WIDTH = 16; // 基础河床半宽 m
export const MIN_HALF_WIDTH = 7; // 弯道收窄下限 m
export const CURVATURE_NARROW = 7; // 曲率收窄系数:halfWidth *= 1 - k*|κ|
export const MIN_WIDTH_RATIO = 0.45; // 最窄为基础宽度的 45%
export const THALWEG_DEPTH = 0.55; // 深泓线切深 m
export const BANK_HEIGHT = 9; // 岸坎最大抬升 m
export const BANK_TRANSITION = 22; // 河岸向外过渡宽度 m
export const HEAD_ELEVATION = 7.5; // 上游渠首高程 m
export const CHANNEL_GRADE = 0.022; // 基础纵坡 2.2%
export const POLE_HEIGHT = 5.5; // 闸门立柱高度 m

export const DOWNSTREAM_WINDOW = 24; // 闸门下游坡度统计窗口 m

export const DEFAULT_GATE_WIDTH = 4.2;

/** 默认中心线控制点:一条温和的 S 弯河道 */
export const DEFAULT_CONTROL_POINTS: Array<{ x: number; z: number }> = [
  { x: -18, z: -108 },
  { x: 12, z: -72 },
  { x: -14, z: -32 },
  { x: 16, z: 8 },
  { x: -8, z: 48 },
  { x: 14, z: 84 },
  { x: -4, z: 108 },
];
