/**
 * 多选对齐与等间距分布。
 *
 * 以选中序列中的第一个套管为基准：
 *  - 其余套管姿态统一为基准方向（q.fromFrame 与吸附标架兼容）；
 *  - 沿牙弓弧长重新分布，相邻套管弧长间距完全相等；
 *  - 基准套管位置保持不动。
 */
import type { DentalArch } from './arch';
import { v3, type Vec3Tuple } from './math';
import { q } from './math';
import { SLEEVE_HEIGHT, type SleeveState } from './types';

export function alignSleeves(
  arch: DentalArch,
  ordered: SleeveState[],
): SleeveState[] {
  if (ordered.length < 2) return ordered.map((s) => ({ ...s }));

  // 1. 每个套管在牙弓上的弧长坐标
  const arcTable = buildArcTable(arch);
  const located = ordered.map((s) => {
    const frame = arch.closestPoint(s.position);
    return { sleeve: s, u: frame.u, frame, s: arcAt(arcTable, frame.u) };
  });
  const byArc = [...located].sort((a, b) => a.s - b.s);
  const n = byArc.length;
  const total = arcTable.total;

  // 2. 基准件（选中序列第一个）锚定到它自己的有效吸附弧长，
  //    其余按牙弓顺序在其两侧以等弧距展开；间距取当前组的平均相邻弧长，
  //    退化（跨度为 0，例如被甩到牙弓外）时用一个合理默认间距。
  const anchorItem = located.find((e) => e.sleeve.id === ordered[0].id)!;
  const anchorArc = arcAt(arcTable, anchorItem.frame.u);
  const span = byArc[n - 1].s - byArc[0].s;
  const defaultGap = total / (n + 1);
  const gap = span > 1e-6 ? span / (n - 1) : defaultGap;

  // 基准在排序序列中的位置，由此向两侧编号
  const anchorRank = byArc.findIndex((e) => e.sleeve.id === anchorItem.sleeve.id);
  const targets = byArc.map((item, rank) => {
    const raw = anchorArc + (rank - anchorRank) * gap;
    // 越界则整体向界内收，保持等间距不重叠
    return { item, raw };
  });
  const minRaw = Math.min(...targets.map((t) => t.raw));
  const maxRaw = Math.max(...targets.map((t) => t.raw));
  let adjust = 0;
  if (minRaw < 0) adjust = -minRaw;
  else if (maxRaw > total) adjust = total - maxRaw;

  // 3. 基准姿态
  const anchorQuat = ordered[0].quaternion;

  return targets.map(({ item, raw }) => {
    const arc = Math.min(total, Math.max(0, raw + adjust));
    const u = uAtArc(arcTable, arc);
    const f = arch.frame(u, item.frame.v);
    const position: Vec3Tuple = v3.add(f.point, v3.scale(f.normal, SLEEVE_HEIGHT / 2));
    return {
      ...item.sleeve,
      position,
      quaternion: q.clone(anchorQuat),
      snapped: true,
      snapU: u,
      snapV: f.v,
    };
  });
}

interface ArcTable {
  us: number[];
  cum: number[];
  total: number;
}

function buildArcTable(arch: DentalArch, segments = 480): ArcTable {
  const us: number[] = [];
  const cum: number[] = [0];
  let prev = arch.center(-1);
  for (let i = 0; i <= segments; i++) {
    const u = -1 + (2 * i) / segments;
    us.push(u);
    const p = arch.center(u);
    if (i > 0) cum.push(cum[i - 1] + v3.dist(prev, p));
    prev = p;
  }
  return { us, cum, total: cum[segments] };
}

function arcAt(table: ArcTable, u: number): number {
  const x = ((u + 1) / 2) * (table.us.length - 1);
  const i = Math.min(table.us.length - 2, Math.max(0, Math.floor(x)));
  const t = x - i;
  return table.cum[i] + (table.cum[i + 1] - table.cum[i]) * t;
}

function uAtArc(table: ArcTable, s: number): number {
  const clamped = Math.min(table.total, Math.max(0, s));
  let i = 0;
  while (i < table.cum.length - 1 && table.cum[i + 1] < clamped) i++;
  const seg = table.cum[i + 1] - table.cum[i] || 1;
  const t = (clamped - table.cum[i]) / seg;
  const x = i + t;
  return -1 + (2 * x) / (table.us.length - 1);
}
