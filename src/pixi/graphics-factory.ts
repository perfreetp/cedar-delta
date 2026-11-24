import { Container, Graphics } from 'pixi.js';

/** 交互命中半径（世界像素），缩放后按 1/scale 补偿 */
export const BASE_HIT_RADIUS = 14;
export const KEYFRAME_HIT_RADIUS = 18;
/** 轨迹双击插入的命中带宽（世界像素） */
export const PATH_HIT_BAND = 16;
/** 判定为“拖动”而非“点击”的位移阈值（屏幕像素） */
export const CLICK_THRESHOLD = 5;

export const COLORS = {
  gridMinor: 0xdde3ea,
  gridMajor: 0xb8c2cc,
  worldFrame: 0x7f8c8d,
  rubber: 0xffffff,
  selectRing: 0xffffff,
  keyframe: 0xf1c40f,
  keyframeSelected: 0xff7043,
  heading: 0xffffff,
  dwell: 0xffd54f,
};

export interface HitResult {
  puppetId: string;
  waypointId: string;
  dist: number;
  order: number;
}

export interface KeyframeHit {
  puppetId: string;
  keyframeId: string;
  waypointId: string;
  dist: number;
}

/** 圆点经过点（批量路径图层内绘制，不创建独立 DisplayObject） */
export function drawWaypointMarker(
  g: Graphics,
  x: number,
  y: number,
  color: number,
  radius: number,
  selected: boolean,
): void {
  g.circle(x, y, radius)
    .fill({ color: 0xffffff, alpha: 0.35 })
    .stroke({ width: 2, color });
  if (selected) {
    g.circle(x, y, radius + 4).stroke({ width: 2, color: COLORS.selectRing, alpha: 0.9 });
  }
}

/** 关键帧菱形标记 */
export function drawKeyframeDiamond(g: Graphics, x: number, y: number, size: number, selected: boolean): void {
  const pts = [x, y - size, x + size, y, x, y + size, x - size, y];
  g.poly(pts).fill({ color: selected ? COLORS.keyframeSelected : COLORS.keyframe }).stroke({ width: 1.5, color: 0x6d4c00 });
  if (selected) {
    g.poly(pts).stroke({ width: 2, color: COLORS.selectRing, alpha: 0.85 });
  }
}

/** 关键帧的朝向手柄（白色箭头线 + 端环） */
export function drawHeadingHandle(g: Graphics, x: number, y: number, angleRad: number, len: number): void {
  const ex = x + Math.cos(angleRad) * len;
  const ey = y + Math.sin(angleRad) * len;
  g.moveTo(x, y).lineTo(ex, ey).stroke({ width: 2.5, color: COLORS.heading, alpha: 0.95 });
  // 箭头头部
  const ah = 7;
  const a1 = angleRad + 2.5;
  const a2 = angleRad - 2.5;
  g.poly([
    ex,
    ey,
    ex + Math.cos(a1) * ah,
    ey + Math.sin(a1) * ah,
    ex + Math.cos(a2) * ah,
    ey + Math.sin(a2) * ah,
  ]).fill({ color: COLORS.heading });
  g.circle(ex, ey, 4).stroke({ width: 2, color: COLORS.heading });
}

/** 停留时长环：半径随 dwellSec 变化 */
export function dwellRadius(dwellSec: number): number {
  return 12 + Math.min(60, dwellSec * 18);
}

export function drawDwellRing(g: Graphics, x: number, y: number, dwellSec: number): void {
  if (dwellSec <= 0.001) return;
  g.circle(x, y, dwellRadius(dwellSec)).stroke({ width: 1.5, color: COLORS.dwell, alpha: 0.8 });
}

/** 偶的舞台图标：圆底 + 朝向三角 */
export function drawPuppetIcon(container: Container, color: number): { icon: Graphics; arrow: Graphics } {
  const icon = new Graphics();
  icon.circle(0, 0, 16).fill({ color, alpha: 0.92 }).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
  container.addChild(icon);

  const arrow = new Graphics();
  arrow
    .poly([18, 0, 6, -6, 6, 6])
    .fill({ color: 0xffffff })
    .stroke({ width: 1, color: 0x333333 });
  container.addChild(arrow);
  return { icon, arrow };
}
