import type { Block, LayoutParams } from '../state/store';

export interface Placement {
  id: string;
  x: number;
  z: number;
  /** 绕 Y 轴旋转，使字块法线跟随路径切线（弧面法线随曲率重算） */
  rotY: number;
  width: number;
}

export interface OverlapInfo {
  aId: string;
  bId: string;
  /** 重叠量（弦距不足的部分），>0 表示重叠 */
  overlap: number;
  ax: number; az: number;
  bx: number; bz: number;
}

export interface LayoutResult {
  placements: Placement[];
  overlaps: OverlapInfo[];
  /** 消除全部重叠所需的最小字间距（吸附对齐目标） */
  snapSpacing: number;
  /** 路径采样点（用于视口绘制路径引导线） */
  pathPoints: [number, number][];
  totalLength: number;
}

/**
 * 沿直线/圆弧路径依次摆字块。
 * 圆弧模式：弧长 = 排版总宽，R = 弧长 / 弧度；每块按弧上位置求切向角，
 * 重叠判定用弦距（弧面排布时弦距 < 弧距，直排不重叠的弧排可能重叠）。
 */
export function layoutBlocks(
  blocks: Block[],
  widths: Map<string, number>,
  layout: LayoutParams,
): LayoutResult {
  const n = blocks.length;
  if (n === 0) {
    return { placements: [], overlaps: [], snapSpacing: layout.spacing, pathPoints: [], totalLength: 0 };
  }
  const w = blocks.map((b) => widths.get(b.id) ?? 1);
  const total = w.reduce((a, b) => a + b, 0) + layout.spacing * (n - 1);

  // 每块中心沿路径的弧长坐标（从 0 起，整体居中）
  const centers: number[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    centers.push(cursor + w[i] / 2);
    cursor += w[i] + layout.spacing;
  }
  const offset = total / 2;

  const placements: Placement[] = [];
  const pathPoints: [number, number][] = [];

  if (layout.mode === 'line' || layout.arcAngle <= 0.01) {
    for (let i = 0; i < n; i++) {
      placements.push({
        id: blocks[i].id,
        x: centers[i] - offset,
        z: 0,
        rotY: 0,
        width: w[i],
      });
    }
    pathPoints.push([-offset, 0], [offset, 0]);
  } else {
    const theta = (layout.arcAngle * Math.PI) / 180;
    const R = total / theta;
    const bulge = layout.arcBulge;
    for (let i = 0; i < n; i++) {
      const s = centers[i] - offset; // 弧上居中坐标
      const phi = s / R; // 圆心角
      placements.push({
        id: blocks[i].id,
        x: R * Math.sin(phi),
        z: bulge * R * (1 - Math.cos(phi)),
        // 法线沿径向朝外 = 切线垂直方向，随曲率逐块重算
        rotY: -phi * bulge,
        width: w[i],
      });
    }
    // 路径引导线采样
    const samples = Math.max(16, Math.min(128, n * 4));
    for (let i = 0; i <= samples; i++) {
      const phi = -theta / 2 + (theta * i) / samples;
      pathPoints.push([R * Math.sin(phi), bulge * R * (1 - Math.cos(phi))]);
    }
  }

  // ---- 重叠检测：相邻块弦距 vs 所需间距 ----
  const overlaps: OverlapInfo[] = [];
  let snapSpacing = layout.spacing;
  for (let i = 0; i < n - 1; i++) {
    const a = placements[i];
    const b = placements[i + 1];
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    const need = (a.width + b.width) / 2;
    if (chord < need - 1e-6) {
      const overlap = need - chord;
      overlaps.push({ aId: a.id, bId: b.id, overlap, ax: a.x, az: a.z, bx: b.x, bz: b.z });
      // 反推消除此重叠所需的弧长增量 → 换算成字间距增量
      if (layout.mode === 'arc' && layout.arcAngle > 0.01) {
        const theta = (layout.arcAngle * Math.PI) / 180;
        const R = total / theta;
        const ratio = Math.min(1, need / (2 * R));
        const needArc = 2 * R * Math.asin(ratio);
        const curArc = chord > 1e-9 ? 2 * R * Math.asin(Math.min(1, chord / (2 * R))) : 0;
        snapSpacing = Math.max(snapSpacing, layout.spacing + (needArc - curArc));
      } else {
        snapSpacing = Math.max(snapSpacing, layout.spacing + overlap);
      }
    }
  }

  return { placements, overlaps, snapSpacing, pathPoints, totalLength: total };
}
