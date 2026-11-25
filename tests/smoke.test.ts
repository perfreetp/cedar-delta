/**
 * 核心领域逻辑冒烟测试（无浏览器/引擎依赖，tsx 直接运行）。
 * 覆盖：吸附阈值与弹回、对齐等距、碰撞避让、撤销快照含剖切与吸附关系。
 */
import assert from 'node:assert/strict';
import { DentalArch } from '../src/core/arch';
import { alignSleeves } from '../src/core/align';
import { resolveCollisions } from '../src/core/collision';
import { CommandStack, takeSnapshot } from '../src/core/commands';
import { v3 } from '../src/core/math';
import { SnapEngine, DEFAULT_SNAP } from '../src/core/snap';
import { SLEEVE_HEIGHT, type ClipState, type SleeveState } from '../src/core/types';

let passed = 0;
const test = (name: string, fn: () => void): void => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const arch = new DentalArch();
const snap = new SnapEngine(arch);

function makeSleeve(id: number, u: number): SleeveState {
  const r = snap.evaluate(arch.surface(u, 0));
  return {
    id,
    position: r.position,
    quaternion: r.quaternion,
    snapped: true,
    snapU: r.frame.u,
    snapV: r.frame.v,
  };
}

console.log('吸附引擎:');
test('曲面点自身距离为 0 且处于吸附区', () => {
  const target = arch.surface(0.3, 1);
  const r = snap.evaluate(target);
  assert.ok(r.surfaceDistance < 0.5, `distance=${r.surfaceDistance}`);
  assert.equal(snap.inSnapZone(r), true);
  // 套管中心应在曲面点沿法向上方半个高度
  const expected = v3.add(r.frame.point, v3.scale(r.frame.normal, SLEEVE_HEIGHT / 2));
  assert.ok(v3.dist(r.position, expected) < 1e-4);
});

test('远处目标超出弹回半径', () => {
  const far: [number, number, number] = [0, 80, 0];
  const r = snap.evaluate(far);
  assert.equal(snap.inBounceZone(r), false);
  assert.ok(r.surfaceDistance > DEFAULT_SNAP.bounceRadius);
});

test('最近点查询在 u 边界内闭合', () => {
  const f = arch.closestPoint([arch.params.halfWidth, 0, 0]);
  assert.ok(f.u >= -1 && f.u <= 1);
  assert.ok(Math.abs(f.normal[1]) > 0.5, '嵴面法向应大体朝上');
});

console.log('对齐与等距:');
test('三颗套管对齐后弧长间距一致、方向统一', () => {
  const ordered = [makeSleeve(1, -0.6), makeSleeve(2, 0.1), makeSleeve(3, 0.55)];
  const out = alignSleeves(arch, ordered);
  assert.equal(out.length, 3);
  // 姿态统一（四元数分量逐位接近）
  for (const s of out.slice(1)) {
    for (let k = 0; k < 4; k++) {
      assert.ok(Math.abs(s.quaternion[k] - out[0].quaternion[k]) < 1e-9);
    }
  }
  // 等弧距：相邻套管沿牙弓中线的弧长增量相等（u 与弧长非线性，不能直接比 u）
  const arcLength = (s: SleeveState): number => {
    const f = arch.closestPoint(s.position);
    const N = 200;
    let len = 0;
    let prev = arch.center(-1);
    for (let i = 1; i <= N; i++) {
      const u = -1 + (2 * i) / N;
      const p = arch.center(u);
      const seg = v3.dist(prev, p);
      if (u <= f.u) len += seg;
      prev = p;
    }
    return len;
  };
  const arcs = out.map(arcLength).sort((a, b) => a - b);
  const g1 = arcs[1] - arcs[0];
  const g2 = arcs[2] - arcs[1];
  assert.ok(Math.abs(g1 - g2) < 0.5, `弧长间距 ${g1} vs ${g2}`);
  assert.ok(out.every((s) => s.snapped === true));
});

console.log('碰撞避让:');
test('重叠套管被推开到碰撞半径之外且落回牙面', () => {
  const a = makeSleeve(10, 0);
  const b = makeSleeve(11, 0.02); // 几乎重合
  const before = v3.dist(a.position, b.position);
  const result = resolveCollisions(arch, new Set([11]), [a, b]);
  const na = result.sleeves.find((s) => s.id === 10)!;
  const nb = result.sleeves.find((s) => s.id === 11)!;
  const horiz = v3.len([na.position[0] - nb.position[0], 0, na.position[2] - nb.position[2]]);
  assert.ok(before < 5, '前置条件：初始确实重叠');
  assert.ok(horiz >= 2.6 * 2 - 0.01, `水平间距=${horiz}`);
  assert.ok(result.pushedIds.includes(11));
  // 静止件 a 不应被移动
  assert.ok(v3.dist(na.position, a.position) < 1e-9);
});

console.log('撤销栈:');
test('一次撤销同时还原吸附关系与剖切位置', () => {
  const clip: ClipState = { enabled: false, normal: [1, 0, 0], distance: 0 };
  let sleeves = [makeSleeve(20, 0.2)];
  const stack = new CommandStack();
  const before = takeSnapshot(sleeves, clip);

  // 执行：开启剖切 + 移动并解除吸附
  clip.enabled = true;
  clip.distance = 12;
  sleeves = sleeves.map((s) => ({ ...s, snapped: false, snapU: null, snapV: null, position: [0, 50, 0] }));
  const after = takeSnapshot(sleeves, clip);
  stack.push('移动+剖切', before, after);
  assert.equal(stack.canUndo, true);

  const restored = stack.undo()!;
  assert.equal(restored.clip.enabled, false);
  assert.equal(restored.clip.distance, 0);
  assert.equal(restored.sleeves[0].snapped, true);
  assert.notEqual(restored.sleeves[0].snapU, null);
});

test('重做返回操作后状态', () => {
  const clip: ClipState = { enabled: false, normal: [0, 1, 0], distance: 3 };
  const sleeves: SleeveState[] = [];
  const stack = new CommandStack();
  stack.push('x', takeSnapshot(sleeves, clip), takeSnapshot(sleeves, { ...clip, distance: 9 }));
  stack.undo();
  const redone = stack.redo()!;
  assert.equal(redone.clip.distance, 9);
});

console.log(`\n全部 ${passed} 项核心测试通过 ✔`);
