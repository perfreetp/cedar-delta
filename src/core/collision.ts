/**
 * 软碰撞避让（迭代位置解算）。
 *
 * 框选组整体平移后，对"移动组 vs 场景内全部套管"做 Gauss-Seidel 迭代：
 *  - 水平距离小于两碰撞半径之和时沿连心线推开；
 *  - 两个移动件对推各让一半，移动件遇静止件由移动件全让；
 *  - 被推动的套管重新贴回牙槽嵴曲面（保持姿态，仅重算落位）。
 * 不做硬重叠阻断，保证拖动始终跟手。
 */
import type { DentalArch } from './arch';
import { v3, type Vec3Tuple } from './math';
import { SLEEVE_COLLISION_R, SLEEVE_HEIGHT, type SleeveState } from './types';

export interface CollisionResult {
  sleeves: SleeveState[];
  /** 实际发生避让的套管 id（用于高亮提示） */
  pushedIds: number[];
  iterations: number;
}

export function resolveCollisions(
  arch: DentalArch,
  movingIds: ReadonlySet<number>,
  sleeves: SleeveState[],
  maxIterations = 8,
): CollisionResult {
  const byId = new Map(sleeves.map((s) => [s.id, s]));
  const work = sleeves.map((s) => ({ ...s, position: [...s.position] as Vec3Tuple }));
  const pushed = new Set<number>();

  const horiz = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] - b[0], 0, a[2] - b[2]];

  let iterations = 0;
  for (iterations = 0; iterations < maxIterations; iterations++) {
    let movedAny = false;
    for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i];
        const b = work[j];
        const aMoving = movingIds.has(a.id);
        const bMoving = movingIds.has(b.id);
        if (!aMoving && !bMoving) continue;

        const diff = horiz(a.position, b.position);
        const dist = v3.len(diff);
        const minDist = SLEEVE_COLLISION_R * 2;
        if (dist >= minDist) continue;

        const dir: Vec3Tuple =
          dist > 1e-6 ? v3.scale(diff, 1 / dist) : arbitrarySeparation(a.id, b.id);
        const overlap = minDist - (dist > 1e-6 ? dist : 0);

        if (aMoving && bMoving) {
          applyPush(a, v3.scale(dir, overlap / 2));
          applyPush(b, v3.scale(dir, -overlap / 2));
          pushed.add(a.id);
          pushed.add(b.id);
        } else if (aMoving) {
          applyPush(a, v3.scale(dir, overlap));
          pushed.add(a.id);
        } else {
          applyPush(b, v3.scale(dir, -overlap));
          pushed.add(b.id);
        }
        movedAny = true;
      }
    }
    if (!movedAny) break;
  }

  // 被推过的套管重新落位到牙面（姿态保持）
  for (const item of work) {
    if (pushed.has(item.id) && item.snapped) {
      const frame = arch.closestPoint(item.position);
      item.position = v3.add(frame.point, v3.scale(frame.normal, SLEEVE_HEIGHT / 2));
      item.snapU = frame.u;
      item.snapV = frame.v;
    }
    byId.set(item.id, item);
  }

  return {
    sleeves: work,
    pushedIds: [...pushed],
    iterations,
  };
}

function applyPush(s: SleeveState, delta: Vec3Tuple): void {
  s.position = v3.add(s.position, delta);
}

function arbitrarySeparation(idA: number, idB: number): Vec3Tuple {
  // 完全重合时用 id 决定一个稳定的分离方向
  const angle = ((idA * 37 + idB * 13) % 360) * (Math.PI / 180);
  return [Math.cos(angle), 0, Math.sin(angle)];
}
