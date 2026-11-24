// 纯逻辑冒烟测试:不涉及 WebGL,验证中心线/剖面/台阶/闸门/笔刷/历史
import { Centerline } from '../src/lib/centerline';
import { buildHeights, sculptStroke, heightAt, computeColors } from '../src/lib/terrain';
import { computeProfile, designElevation, downstreamGrade, validateSteps } from '../src/lib/profile';
import { buildGate, regroundGates } from '../src/lib/gates';
import { HistoryStack, makeSnapshot } from '../src/lib/history';
import { DEFAULT_CONTROL_POINTS, GRID_SEGMENTS, TOTAL_VERTS } from '../src/lib/constants';
import type { BrushSettings, ControlPoint, Step } from '../src/lib/types';
import { uid } from '../src/lib/id';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name} ${detail}`);
  }
}

const cps: ControlPoint[] = DEFAULT_CONTROL_POINTS.map((p) => ({ id: uid('cp'), ...p }));
const center = new Centerline(cps);

// 1. 中心线长度与采样
check('centerline length positive', center.length > 150, `len=${center.length}`);
check('samples count', center.samples.length > 200);
check('arc length monotonic', center.samples.every((s, i, a) => i === 0 || s.s >= a[i - 1].s));

// 2. 曲率存在且半宽随曲率收窄
const maxK = Math.max(...center.samples.map((s) => Math.abs(s.curvature)));
check('curvature detected', maxK > 0.001, `maxK=${maxK}`);
const widths = center.samples.map((s) => s.halfWidth);
check('half width within bounds', Math.min(...widths) >= 7 && Math.max(...widths) <= 16.001);
check('narrowing at curve', Math.min(...widths) < 16);

// 3. nearest 投影
const near = center.nearest(cps[2].x + 3, cps[2].z);
check('nearest distance', near.distance < 5, `d=${near.distance}`);
check('nearest offset signed', Math.abs(near.offset - near.distance) < 1 || Math.abs(near.offset + near.distance) < 1);

// 4. 高度场构建
const noSteps: Step[] = [];
const heights = buildHeights(center, noSteps);
check('heights length', heights.length === TOTAL_VERTS);
check('heights finite', heights.every((h) => Number.isFinite(h)));
const colors = computeColors(center, heights);
check('colors length', colors.length === TOTAL_VERTS * 3);

// 河床内低于河岸
const bedSmp = center.sampleAt(center.length * 0.5);
const bedH = heightAt(heights, bedSmp.x, bedSmp.z);
const bankX = bedSmp.x + bedSmp.nx * (bedSmp.halfWidth + 18);
const bankZ = bedSmp.z + bedSmp.nz * (bedSmp.halfWidth + 18);
const bankH = heightAt(heights, bankX, bankZ);
check('bank higher than bed', bankH > bedH, `bank=${bankH} bed=${bedH}`);

// 5. 坡度剖面
const profile = computeProfile(center, noSteps);
check('profile points', profile.length === center.samples.length);
const grade0 = profile[10].grade;
check('base grade ~2.2%', Math.abs(grade0 - 2.2) < 0.2, `grade=${grade0}`);

// 6. 台阶:角度过渡与落差
const step: Step = { id: 'st1', s: center.length * 0.4, drop: 2, angle: 30 };
const validation = validateSteps([step]);
check('valid step', validation.ok);
const before = designElevation(step.s - 10, [step]);
const at = designElevation(step.s, [step]);
const after = designElevation(step.s + 10, [step]);
check('step lowers elevation', before > at && at > after);
// 比较台阶自身产生的高程偏移,剔除基础纵坡在 20m 内的落差
const offsetBefore = before - designElevation(step.s - 10, []);
const offsetAfter = after - designElevation(step.s + 10, []);
check(
  'full drop applied downstream',
  Math.abs(offsetBefore - offsetAfter - 2) < 0.05,
  `delta=${offsetBefore - offsetAfter}`,
);
const L = 2 / Math.tan((30 * Math.PI) / 180);
const mid = designElevation(step.s, [step]);
const midNoStep = designElevation(step.s, []);
check('midpoint about half drop', Math.abs(midNoStep - mid - 1) < 0.05, `delta=${midNoStep - mid}`);
void L;
const dg = downstreamGrade(step.s - 20, [step], center.length);
check('downstream grade finite', Number.isFinite(dg) && dg > 0);

// 台阶重叠校验
const overlap = validateSteps([
  { id: 'a', s: 50, drop: 3, angle: 20 },
  { id: 'b', s: 52, drop: 3, angle: 20 },
]);
check('overlap rejected', !overlap.ok);

// 台阶影响高度场
const stepped = buildHeights(center, [step]);
check('stepped terrain differs', stepped.some((h, i) => Math.abs(h - heights[i]) > 0.01));

// 7. 四种笔刷
const brushBase = (): BrushSettings => ({ type: 'raise', radius: 10, strength: 0.6, symmetric: false });
const target = heights;
const px = bedSmp.x;
const pz = bedSmp.z;
const beforeRaise = heightAt(target, px, pz);
const r1 = sculptStroke(target, center, brushBase(), [{ x: px, z: pz }], beforeRaise);
check('raise changes verts', r1.length > 0);
check('raise lifts height', heightAt(target, px, pz) > beforeRaise);

const lower = brushBase();
lower.type = 'lower';
const beforeLower = heightAt(target, px, pz);
sculptStroke(target, center, lower, [{ x: px, z: pz }], beforeLower);
check('lower drops height', heightAt(target, px, pz) < beforeLower);

const smooth = brushBase();
smooth.type = 'smooth';
const hBeforeSmooth = heightAt(target, px, pz);
sculptStroke(target, center, smooth, [{ x: px, z: pz }], hBeforeSmooth);
check('smooth executes', Number.isFinite(heightAt(target, px, pz)));

const flat = brushBase();
flat.type = 'flatten';
const flatTarget = hBeforeSmooth + 1.5;
sculptStroke(target, center, flat, [{ x: px, z: pz }], flatTarget);
check('flatten converges to target', Math.abs(heightAt(target, px, pz) - flatTarget) < 1.2);

// 对称笔刷:两岸都改变
const symHeights = new Float32Array(heights);
const sideInfo = center.nearest(px, pz);
const mx = px - 2 * sideInfo.offset * sideInfo.sample.nx;
const mz = pz - 2 * sideInfo.offset * sideInfo.sample.nz;
const beforeMirror = heightAt(symHeights, mx, mz);
const beforeMain = heightAt(symHeights, px, pz);
const symBrush = brushBase();
symBrush.symmetric = true;
sculptStroke(symHeights, center, symBrush, [{ x: px, z: pz }], beforeMain);
check('symmetric main side changed', heightAt(symHeights, px, pz) !== beforeMain);
check('symmetric mirror side changed', Math.abs(heightAt(symHeights, mx, mz) - beforeMirror) > 1e-4);

// 8. 闸门:等高线切线吸附 + 立柱落地 + 入水高度
const gate = buildGate(center, heights, noSteps, {
  s: center.length * 0.3,
  offset: 2,
  color: 'red',
  width: 4.2,
});
check('gate id generated', gate.id.startsWith('gate_'));
check('poles on ground', Math.abs(gate.pA[1] - heightAt(heights, gate.pA[0], gate.pA[2])) < 1e-3);
const barLen = Math.hypot(gate.pA[0] - gate.pB[0], gate.pA[2] - gate.pB[2]);
check('gate width matches', Math.abs(barLen - 4.2) < 0.05, `len=${barLen}`);
check('entry height recorded', Number.isFinite(gate.entryHeight) && gate.entryHeight !== 0);
check('downstream grade recorded', gate.downstreamGrade > 0);

// 等高线切线:门杆方向与局部梯度垂直
const e = 1.2;
const gx = (heightAt(heights, gate.pA[0] + e, gate.pA[2]) - heightAt(heights, gate.pA[0] - e, gate.pA[2])) / (2 * e);
const gz = (heightAt(heights, gate.pA[0], gate.pA[2] + e) - heightAt(heights, gate.pA[0], gate.pA[2] - e)) / (2 * e);
const dx = gate.pB[0] - gate.pA[0];
const dz = gate.pB[2] - gate.pA[2];
const dot = gx * dx + gz * dz;
const norm = Math.hypot(gx, gz) * Math.hypot(dx, dz);
check('bar perpendicular to gradient', norm < 1e-6 || Math.abs(dot / norm) < 0.2, `dot=${norm ? dot / norm : 0}`);

// 地形变化后闸门重新落地
const moved = regroundGates(center, symHeights, noSteps, [gate]);
check('reground keeps id', moved[0].id === gate.id);
check('reground updates pole height', moved[0].pA[1] !== gate.pA[1] || Math.abs(moved[0].pA[1] - heightAt(symHeights, gate.pA[0], gate.pA[2])) < 1e-3);

// 9. 历史撤销重做
const hist = new HistoryStack();
const snap0 = makeSnapshot(heights, cps, noSteps, [gate]);
hist.push(snap0);
const modified = new Float32Array(heights);
modified[100] += 5;
const snap1 = makeSnapshot(modified, cps, noSteps, [gate]);
const undone = hist.undo(snap1);
check('undo returns previous', undone !== null && undone.base[100] === heights[100]);
const redone = hist.redo(snap0);
check('redo returns next', redone !== null && redone.base[100] === modified[100]);
check('redo clears on new push', (() => {
  const h2 = new HistoryStack();
  h2.push(makeSnapshot(heights, cps, [], []));
  h2.undo(makeSnapshot(modified, cps, [], []));
  h2.push(makeSnapshot(modified, cps, [], []));
  return !h2.canRedo() && h2.canUndo();
})());

// 10. 网格边界
check('grid segments constant', GRID_SEGMENTS === 128);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
