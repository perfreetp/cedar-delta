import type { Camera } from '../types';

export interface Viewport {
  width: number;
  height: number;
}

/** 世界→屏幕的仿射参数(预先算好 cos/sin,每帧复用) */
export interface CamMatrix {
  cos: number;
  sin: number;
  zoom: number;
  /** 屏幕中心 */
  cx: number;
  cy: number;
  /** 相机中心(世界) */
  wx: number;
  wy: number;
}

export function camMatrix(cam: Camera, vp: Viewport): CamMatrix {
  return {
    cos: Math.cos(cam.rotation),
    sin: Math.sin(cam.rotation),
    zoom: cam.zoom,
    cx: vp.width / 2,
    cy: vp.height / 2,
    wx: cam.x,
    wy: cam.y,
  };
}

export function worldToScreen(m: CamMatrix, wx: number, wy: number, out: [number, number] = [0, 0]): [number, number] {
  const dx = (wx - m.wx) * m.zoom;
  const dy = (wy - m.wy) * m.zoom;
  out[0] = m.cx + dx * m.cos - dy * m.sin;
  out[1] = m.cy + dx * m.sin + dy * m.cos;
  return out;
}

export function screenToWorld(m: CamMatrix, sx: number, sy: number, out: [number, number] = [0, 0]): [number, number] {
  const dx = (sx - m.cx) / m.zoom;
  const dy = (sy - m.cy) / m.zoom;
  out[0] = m.wx + dx * m.cos + dy * m.sin;
  out[1] = m.wy - dx * m.sin + dy * m.cos;
  return out;
}

/** 视野在世界坐标下的包围盒(按旋转取外接矩形,保证旋转时不漏画) */
export function viewBounds(m: CamMatrix, vp: Viewport, padPx = 0) {
  const hw = vp.width / 2 + padPx;
  const hh = vp.height / 2 + padPx;
  // 屏幕四角 → 世界
  const corners: [number, number][] = [
    screenToWorld(m, m.cx - hw, m.cy - hh),
    screenToWorld(m, m.cx + hw, m.cy - hh),
    screenToWorld(m, m.cx + hw, m.cy + hh),
    screenToWorld(m, m.cx - hw, m.cy + hh),
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** 以屏幕锚点缩放:缩放后锚点下的世界坐标保持不变 */
export function zoomAt(cam: Camera, vp: Viewport, anchorSx: number, anchorSy: number, nextZoom: number): Camera {
  const m = camMatrix(cam, vp);
  const before = screenToWorld(m, anchorSx, anchorSy);
  const next: Camera = { ...cam, zoom: nextZoom };
  const m2 = camMatrix(next, vp);
  const after = screenToWorld(m2, anchorSx, anchorSy);
  return { ...next, x: next.x + (before[0] - after[0]), y: next.y + (before[1] - after[1]) };
}

/** 相机缓动到目标状态 */
export class CameraTween {
  private raf = 0;
  private to: Camera | null = null;
  private duration = 420;
  private t0 = 0;
  private from: Camera | null = null;

  constructor(private readonly onFrame: (c: Camera) => void) {}

  get active() {
    return this.raf !== 0;
  }

  /** 从当前相机缓动到目标 */
  easeTo(from: Camera, target: Camera, duration = 420) {
    this.stop();
    this.from = { ...from };
    this.to = target;
    this.duration = duration;
    this.t0 = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    const now = performance.now();
    const p = Math.min(1, (now - this.t0) / this.duration);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const from = this.from!;
    const to = this.to!;
    // 旋转取最短弧
    let dr = to.rotation - from.rotation;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    // 缩放走对数插值,视觉更均匀
    const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
    this.onFrame({
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      zoom,
      rotation: from.rotation + dr * e,
    });
    if (p < 1) this.raf = requestAnimationFrame(this.tick);
    else this.raf = 0;
  };

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/** 让世界矩形适配到视口所需的相机(可指定目标像素占比) */
export function fitRect(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  vp: Viewport,
  rotation = 0,
  fill = 0.86,
): Camera {
  const w = Math.max(1, rect.maxX - rect.minX);
  const h = Math.max(1, rect.maxY - rect.minY);
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const rw = w * cos + h * sin;
  const rh = w * sin + h * cos;
  const zoom = Math.min((vp.width * fill) / rw, (vp.height * fill) / rh);
  return {
    x: (rect.minX + rect.maxX) / 2,
    y: (rect.minY + rect.maxY) / 2,
    zoom,
    rotation,
  };
}
