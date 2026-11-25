import type { Camera, Dataset, LayerId } from '../types';
import { camMatrix, screenToWorld, type Viewport } from '../core/camera';
import type { GridIndex } from '../data/grid-index';

export interface PickResult {
  layer: LayerId;
  index: number;
  /** 到光标的像素距离 */
  dist: number;
}

/** 点族图层索引表 */
export type PointIndices = Partial<Record<Exclude<LayerId, 'path' | 'area'> , GridIndex>>;

function withinRect(index: GridIndex, minX: number, minY: number, maxX: number, maxY: number) {
  return index.queryRect(minX, minY, maxX, maxY, []);
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 线段与轴对齐矩形是否相交(世界坐标) */
function segIntersectsRect(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number,
) {
  if (Math.max(x1, x2) < minX || Math.min(x1, x2) > maxX) return false;
  if (Math.max(y1, y2) < minY || Math.min(y1, y2) > maxY) return false;
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: [number, number, number, number][] = [
    [minX, minY, maxX, minY], [maxX, minY, maxX, maxY],
    [maxX, maxY, minX, maxY], [minX, maxY, minX, minY],
  ];
  for (const [ex1, ey1, ex2, ey2] of edges) {
    const d1 = cross(dx, dy, ex1 - x1, ey1 - y1);
    const d2 = cross(dx, dy, ex2 - x1, ey2 - y1);
    const d3 = cross(ex2 - ex1, ey2 - ey1, x1 - ex1, y1 - ey1);
    const d4 = cross(ex2 - ex1, ey2 - ey1, x2 - ex1, y2 - ey1);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  }
  return false;
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

export function pointInPolygon(px: number, py: number, coords: Float32Array, start: number, end: number) {
  let inside = false;
  for (let i = start, j = end - 1; i < end; j = i++) {
    const xi = coords[i * 2], yi = coords[i * 2 + 1];
    const xj = coords[j * 2], yj = coords[j * 2 + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 屏幕点选。
 * 优先级:点族按图层 z 序从上到下;线/面只在没有点命中时参与,避免误选。
 */
export function pickAt(
  ds: Dataset,
  cam: Camera,
  vp: Viewport,
  sx: number,
  sy: number,
  pointIndices: PointIndices,
  layerOrder: LayerId[],
  areaIndex: GridIndex,
  pathIndex: GridIndex,
  tolerancePx = 9,
): PickResult | null {
  const m = camMatrix(cam, vp);
  const world = screenToWorld(m, sx, sy);
  const worldTol = tolerancePx / m.zoom;

  let best: PickResult | null = null;
  // 倒序遍历图层顺序(上层优先)
  for (let li = layerOrder.length - 1; li >= 0; li--) {
    const layer = layerOrder[li];
    if (layer === 'path' || layer === 'area') continue;
    const idx = pointIndices[layer];
    if (!idx) continue;
    const data = ds[layer as Exclude<LayerId, 'path' | 'area'>];
    const cand = withinRect(idx, world[0] - worldTol, world[1] - worldTol, world[0] + worldTol, world[1] + worldTol);
    for (const i of cand) {
      const d = Math.hypot(data.x[i] - world[0], data.y[i] - world[1]) * m.zoom;
      const hitR = Math.max(tolerancePx, ((data.size[i] * m.zoom) / 2) + 3);
      if (d <= hitR && (!best || d < best.dist)) best = { layer, index: i, dist: d };
    }
    if (best) return best;
  }

  // 路径线
  if (layerOrder.includes('path')) {
    const cand = withinRect(pathIndex, world[0] - worldTol * 2, world[1] - worldTol * 2, world[0] + worldTol * 2, world[1] + worldTol * 2);
    for (const i of cand) {
      const s = ds.path.offsets[i];
      const e = i + 1 < ds.path.count ? ds.path.offsets[i + 1] : ds.path.coords.length / 2;
      for (let p = s; p < e - 1; p++) {
        const d = segDist(
          world[0], world[1],
          ds.path.coords[p * 2], ds.path.coords[p * 2 + 1],
          ds.path.coords[(p + 1) * 2], ds.path.coords[(p + 1) * 2 + 1],
        ) * m.zoom;
        if (d <= tolerancePx && (!best || d < best.dist)) best = { layer: 'path', index: i, dist: d };
      }
    }
    if (best) return best;
  }

  // 区域面
  if (layerOrder.includes('area')) {
    const cand = withinRect(areaIndex, world[0], world[1], world[0], world[1]);
    for (const i of cand) {
      const s = ds.area.offsets[i];
      const e = i + 1 < ds.area.count ? ds.area.offsets[i + 1] : ds.area.coords.length / 2;
      if (pointInPolygon(world[0], world[1], ds.area.coords, s, e)) {
        return { layer: 'area', index: i, dist: 0 };
      }
    }
  }
  return best;
}

/** 框选:屏幕矩形 → 世界包围盒 → 候选 → 屏幕内精确判定 */
export function pickInRect(
  ds: Dataset,
  cam: Camera,
  vp: Viewport,
  rect: { x0: number; y0: number; x1: number; y1: number },
  pointIndices: PointIndices,
  pathIndex: GridIndex,
  areaIndex: GridIndex,
  layerOn: Record<LayerId, boolean>,
  maxPerLayer = 4000,
): { layer: LayerId; index: number }[] {
  const m = camMatrix(cam, vp);
  const minSx = Math.min(rect.x0, rect.x1);
  const maxSx = Math.max(rect.x0, rect.x1);
  const minSy = Math.min(rect.y0, rect.y1);
  const maxSy = Math.max(rect.y0, rect.y1);

  // 反转四角求世界包围盒
  const corners = [
    screenToWorld(m, minSx, minSy),
    screenToWorld(m, maxSx, minSy),
    screenToWorld(m, maxSx, maxSy),
    screenToWorld(m, minSx, maxSy),
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  const out: { layer: LayerId; index: number }[] = [];
  const insideScreen = (wx: number, wy: number) => {
    const dx = (wx - m.wx) * m.zoom;
    const dy = (wy - m.wy) * m.zoom;
    const sx = m.cx + dx * m.cos - dy * m.sin;
    const sy = m.cy + dx * m.sin + dy * m.cos;
    return sx >= minSx && sx <= maxSx && sy >= minSy && sy <= maxSy;
  };

  for (const layer of ['hazard', 'exit', 'stair', 'assembly', 'point'] as const) {
    if (!layerOn[layer]) continue;
    const idx = pointIndices[layer];
    if (!idx) continue;
    const data = ds[layer];
    const cand = idx.queryRect(minX, minY, maxX, maxY, []);
    let n = 0;
    for (const i of cand) {
      if (insideScreen(data.x[i], data.y[i])) {
        out.push({ layer, index: i });
        if (++n >= maxPerLayer) break;
      }
    }
  }

  /** 折线/多边形:要求任意一个顶点落在框内,或与框有实际相交 */
  const polyTouches = (coords: Float32Array, start: number, end: number) => {
    for (let k = start; k < end - 1; k++) {
      if (insideScreen(coords[k * 2], coords[k * 2 + 1])) return true;
      if (segIntersectsRect(
        coords[k * 2], coords[k * 2 + 1],
        coords[(k + 1) * 2], coords[(k + 1) * 2 + 1],
        minX, minY, maxX, maxY,
      )) return true;
    }
    return false;
  };

  if (layerOn.path) {
    const cand = pathIndex.queryRect(minX, minY, maxX, maxY, []);
    let n = 0;
    for (const i of cand) {
      const s = ds.path.offsets[i];
      const e = i + 1 < ds.path.count ? ds.path.offsets[i + 1] : ds.path.coords.length / 2;
      if (s < e && polyTouches(ds.path.coords, s, e)) {
        out.push({ layer: 'path', index: i });
        if (++n >= maxPerLayer) break;
      }
    }
  }

  if (layerOn.area) {
    const cand = areaIndex.queryRect(minX, minY, maxX, maxY, []);
    for (const i of cand) {
      const s = ds.area.offsets[i];
      const e = i + 1 < ds.area.count ? ds.area.offsets[i + 1] : ds.area.coords.length / 2;
      if (s < e && polyTouches(ds.area.coords, s, e)) {
        out.push({ layer: 'area', index: i });
      }
    }
  }

  return out;
}
