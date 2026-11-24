/** 二维点（戏台世界坐标，单位：像素） */
export interface Vec2 {
  x: number;
  y: number;
}

/** 编辑工具模式，对应四个功能模块 */
export type ToolMode = 'stage' | 'path' | 'keyframe' | 'playback';

/**
 * 经过点（路径控制点）。
 * 首点为偶的起点；centripetal Catmull-Rom 穿过全部经过点。
 */
export interface Waypoint {
  id: string;
  pos: Vec2;
}

/**
 * 关键帧：绑定在某个经过点上，标注偶在该点的停留时刻与朝向。
 * - timeSec：到达该点的时刻（秒），由时间轴调度
 * - dwellSec：到达后停留时长（秒），停留期间偶保持 position/heading
 * - headingDeg：偶的朝向（度，0=朝右，逆时针为正）；null 表示跟随切线
 * - headingOverride：true 表示用户显式指定了朝向
 */
export interface Keyframe {
  id: string;
  waypointId: string;
  timeSec: number;
  dwellSec: number;
  headingDeg: number | null;
  headingOverride: boolean;
}

/** 偶（木偶）：一条轨迹归属于一个偶 */
export interface Puppet {
  id: string;
  name: string;
  color: number;
  waypoints: Waypoint[];
  keyframes: Keyframe[];
  visible: boolean;
}

/** 戏台（背景图）配置 */
export interface StageConfig {
  /** 背景图 dataURL；为空时绘制网格默认戏台 */
  imageUrl: string | null;
  worldWidth: number;
  worldHeight: number;
}

/** 导出的走位文件根结构 */
export interface ChoreographyFile {
  format: 'puppet-choreography';
  version: 1;
  exportedAt: string;
  durationSec: number;
  stage: StageConfig;
  puppets: Puppet[];
}

/** 空间哈希桶条目 */
export interface HashEntry<T> {
  x: number;
  y: number;
  ref: T;
}
