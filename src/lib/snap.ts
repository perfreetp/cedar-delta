/**
 * 吸附引擎
 * - 网格吸附：位置吸附到网格线
 * - 物体间吸附：AABB 边缘与中心线对齐（桌排、通道对齐场景）
 * - 角度吸附：旋转时吸附 15° 网格角与相邻物体朝向
 * 输出吸附辅助线，由视口层绘制。
 */
import type { PlacedObject, SnapSettings } from '../types';
import { angleDelta, obbCorners } from './math2d';

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SnapGuide {
  /** 辅助线方向：v = 平行 z 轴（常量 x），h = 平行 x 轴（常量 z） */
  axis: 'v' | 'h';
  value: number;
  /** 该辅助线跨越的范围 */
  from: number;
  to: number;
  kind: 'grid' | 'object';
}

export interface SnapResult {
  x: number;
  z: number;
  guides: SnapGuide[];
  snappedX: boolean;
  snappedZ: boolean;
}

/** 物体（任意旋转）的世界轴 AABB */
export function aabbOf(o: PlacedObject): AABB {
  const s = o.scale;
  const corners = obbCorners({
    x: o.x,
    z: o.z,
    hw: (o.width * s) / 2,
    hd: (o.depth * s) / 2,
    rotation: o.rotation,
  });
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function aabbOfHypothetical(
  o: PlacedObject,
  nx: number,
  nz: number,
  nrot: number,
): AABB {
  return aabbOf({ ...o, x: nx, z: nz, rotation: nrot });
}

interface LineCandidate {
  value: number;
  from: number;
  to: number;
}

/** 收集一个 AABB 的可吸附线（两条边缘 + 中心线） */
function edgeLines(b: AABB): { v: LineCandidate[]; h: LineCandidate[] } {
  return {
    v: [
      { value: b.minX, from: b.minZ, to: b.maxZ },
      { value: (b.minX + b.maxX) / 2, from: b.minZ, to: b.maxZ },
      { value: b.maxX, from: b.minZ, to: b.maxZ },
    ],
    h: [
      { value: b.minZ, from: b.minX, to: b.maxX },
      { value: (b.minZ + b.maxZ) / 2, from: b.minX, to: b.maxX },
      { value: b.maxZ, from: b.minX, to: b.maxX },
    ],
  };
}

const GRID_ANGLE = Math.PI / 12; // 15°

/**
 * 位置吸附。
 * @param moves 正在拖动的物体及其假设新姿态（单个或框选整组）
 * @param others 静止物体
 */
export function snapPosition(
  moves: { obj: PlacedObject; nx: number; nz: number; nrot: number }[],
  others: PlacedObject[],
  settings: SnapSettings,
  enabled: boolean,
): SnapResult {
  const guides: SnapGuide[] = [];
  if (!enabled || moves.length === 0) {
    const m = moves[0];
    return { x: m?.nx ?? 0, z: m?.nz ?? 0, guides, snappedX: false, snappedZ: false };
  }

  // 整组的 AABB
  let gMinX = Infinity;
  let gMaxX = -Infinity;
  let gMinZ = Infinity;
  let gMaxZ = -Infinity;
  for (const m of moves) {
    const b = aabbOfHypothetical(m.obj, m.nx, m.nz, m.nrot);
    gMinX = Math.min(gMinX, b.minX);
    gMaxX = Math.max(gMaxX, b.maxX);
    gMinZ = Math.min(gMinZ, b.minZ);
    gMaxZ = Math.max(gMaxZ, b.maxZ);
  }
  const groupBox: AABB = { minX: gMinX, maxX: gMaxX, minZ: gMinZ, maxZ: gMaxZ };
  const groupLines = edgeLines(groupBox);

  // 当前基准点（组中心）与需要的修正量
  const baseX = (gMinX + gMaxX) / 2;
  const baseZ = (gMinZ + gMaxZ) / 2;
  let bestDx: { d: number; guide: SnapGuide } | null = null;
  let bestDz: { d: number; guide: SnapGuide } | null = null;

  const consider = (
    movingVal: number,
    targetVal: number,
    axis: 'v' | 'h',
    from: number,
    to: number,
    kind: 'grid' | 'object',
    current: { d: number; guide: SnapGuide } | null,
  ) => {
    const d = targetVal - movingVal;
    if (Math.abs(d) <= settings.threshold && (!current || Math.abs(d) < Math.abs(current.d))) {
      return { d, guide: { axis, value: targetVal, from, to, kind } };
    }
    return current;
  };

  // —— 物体间吸附 ——
  if (settings.objectEnabled) {
    for (const o of others) {
      if (!o.visible) continue;
      const nb = aabbOf(o);
      const nl = edgeLines(nb);
      for (const mv of groupLines.v) {
        for (const tv of nl.v) {
          bestDx = consider(mv.value, tv.value, 'v', Math.min(mv.from, tv.from), Math.max(mv.to, tv.to), 'object', bestDx);
        }
      }
      for (const mh of groupLines.h) {
        for (const th of nl.h) {
          bestDz = consider(mh.value, th.value, 'h', Math.min(mh.from, th.from), Math.max(mh.to, th.to), 'object', bestDz);
        }
      }
    }
  }

  // —— 网格吸附 ——
  if (settings.gridEnabled) {
    const g = settings.gridSize;
    const nearestGridX = Math.round(baseX / g) * g;
    const nearestGridZ = Math.round(baseZ / g) * g;
    // 对组的每条特征线找最近网格线
    for (const mv of groupLines.v) {
      const gv = Math.round(mv.value / g) * g;
      bestDx = consider(mv.value, gv, 'v', groupBox.minZ, groupBox.maxZ, 'grid', bestDx);
    }
    for (const mh of groupLines.h) {
      const gv = Math.round(mh.value / g) * g;
      bestDz = consider(mh.value, gv, 'h', groupBox.minX, groupBox.maxX, 'grid', bestDz);
    }
    // 中心线网格吸附兜底（阈值内即可）
    if (!bestDx && Math.abs(nearestGridX - baseX) <= settings.threshold) {
      bestDx = {
        d: nearestGridX - baseX,
        guide: { axis: 'v', value: nearestGridX, from: groupBox.minZ, to: groupBox.maxZ, kind: 'grid' },
      };
    }
    if (!bestDz && Math.abs(nearestGridZ - baseZ) <= settings.threshold) {
      bestDz = {
        d: nearestGridZ - baseZ,
        guide: { axis: 'h', value: nearestGridZ, from: groupBox.minX, to: groupBox.maxX, kind: 'grid' },
      };
    }
  }

  const dx = bestDx?.d ?? 0;
  const dz = bestDz?.d ?? 0;
  if (bestDx) guides.push(bestDx.guide);
  if (bestDz) guides.push(bestDz.guide);

  return {
    x: baseX + dx,
    z: baseZ + dz,
    guides,
    snappedX: bestDx !== null,
    snappedZ: bestDz !== null,
  };
}

/**
 * 角度吸附：15° 网格角 + 相邻物体朝向。
 * 返回吸附后的角度与是否发生吸附。
 */
export function snapAngle(
  angle: number,
  others: PlacedObject[],
  settings: SnapSettings,
  enabled: boolean,
): { angle: number; snapped: boolean } {
  if (!enabled) return { angle, snapped: false };
  let best: { delta: number; target: number } | null = null;

  if (settings.gridEnabled) {
    const target = Math.round(angle / GRID_ANGLE) * GRID_ANGLE;
    const d = angleDelta(target, angle);
    if (Math.abs(d) <= settings.threshold * 1.5) best = { delta: d, target };
  }
  if (settings.objectEnabled) {
    for (const o of others) {
      if (!o.visible) continue;
      for (let k = 0; k < 4; k++) {
        const target = o.rotation + (k * Math.PI) / 2;
        const d = angleDelta(target, angle);
        if (Math.abs(d) <= settings.threshold * 1.5 && (!best || Math.abs(d) < Math.abs(best.delta))) {
          best = { delta: d, target };
        }
      }
    }
  }
  return best ? { angle: angle + best.delta, snapped: true } : { angle, snapped: false };
}
