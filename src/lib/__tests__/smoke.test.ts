// 纯逻辑冒烟测试：npm test
import * as THREE from 'three';
import { createPresetJoints } from '../preset';
import { clampAngles, solveFK, solveIK, getChain, DEG } from '../math';
import { samplePose, recomputeKeyframesForConstraints } from '../animation';
import { removeJoint, addJoint } from '../hierarchy';
import type { Keyframe, RigDocument } from '../../types';

let passed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) {
    console.error(`✗ ${name} ${detail}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`✓ ${name}`);
  }
}

const joints = createPresetJoints();

// 1. FK：绑定姿态下世界位置 = 各级 localOffset 累加
{
  const solved = solveFK(joints, {});
  const wrist = solved.joints.get('wrist_l')!;
  // spine(0,0.28,0) 相对 pelvis(0,1,0)；shoulder(0.22,0.18)；elbow(0.26,-0.04)；wrist(0.24,-0.02)
  const expect = new THREE.Vector3(0.22 + 0.26 + 0.24, 1 + 0.28 + 0.18 - 0.04 - 0.02, 0);
  check('FK 绑定姿态世界位置', wrist.position.distanceTo(expect) < 1e-6, `got ${wrist.position.toArray()}`);
}

// 2. 约束钳制
{
  const elbow = joints.find((j) => j.id === 'elbow_l')!;
  // 铰链：z 轴范围 [0,140]，x 轴不受限
  const { angles, clamped } = clampAngles(elbow, [999, 0, 999]);
  check('约束上限钳制', clamped && angles[2] === elbow.limits.z.max && angles[0] === 999, `angles=${angles}`);
  const r2 = clampAngles(elbow, [0, 0, -50]);
  check('约束下限钳制', r2.clamped && r2.angles[2] === 0);
  const free = joints.find((j) => j.id === 'shoulder_l')!;
  const r3 = clampAngles(free, [0, 200, 0]);
  check('多轴独立钳制', r3.clamped && r3.angles[1] === 120 && r3.angles[0] === 0);
}

// 3. IK：可达目标应让末端逼近目标
{
  const solved0 = solveFK(joints, {});
  const wristPos = solved0.joints.get('wrist_l')!.position.clone();
  // 在链长（约 0.504）之内的目标
  const target = wristPos.clone().add(new THREE.Vector3(-0.1, -0.1, 0));
  const result = solveIK(joints, 'wrist_l', target, {}, 'shoulder_l', { iterations: 30 });
  const solved1 = solveFK(joints, result.pose);
  const dist = solved1.joints.get('wrist_l')!.position.distanceTo(target);
  check('IK 可达目标收敛', dist < 0.01, `dist=${dist.toFixed(4)}`);
}

// 4. IK：需要超出关节极限才能到达的目标 → 关节停在边界并报告 clamped
{
  // 收紧肩部 z 轴到 ±30°，而指向正下方目标需要约 -83°，必然触界
  const tight = joints.map((j) =>
    j.id === 'shoulder_l' ? { ...j, limits: { ...j.limits, z: { enabled: true, min: -30, max: 30 } } } : j,
  );
  const below = new THREE.Vector3(0.22, -2, 0);
  const result = solveIK(tight, 'wrist_l', below, {}, 'shoulder_l', { iterations: 30 });
  const chainIds = getChain(tight, 'wrist_l', 'shoulder_l').map((j) => j.id);
  const anyAtLimit = chainIds.some((id) => result.clamped.has(id));
  check('超出极限的目标使关节停在边界', anyAtLimit, `clamped=[${[...result.clamped]}]`);
  // 所有关节角度必须仍在各自约束内
  let allInside = true;
  for (const j of tight) {
    const a = result.pose[j.id];
    if (!a) continue;
    const r = clampAngles(j, a);
    if (r.clamped) allInside = false;
  }
  check('IK 结果始终满足全部约束', allInside);
}

// 5. 层级：删除中间关节，子关节重新挂接且世界位置尽量保持
{
  const before = solveFK(joints, {}).joints.get('wrist_l')!.position.clone();
  const res = removeJoint(joints, [] as Keyframe[], 'elbow_l');
  check('删除关节后数量减一', res.joints.length === joints.length - 1);
  const reparented = res.joints.find((j) => j.id === 'wrist_l')!;
  check('子关节挂到祖父', reparented.parentId === 'shoulder_l');
  const after = solveFK(res.joints, {}).joints.get('wrist_l')!.position;
  check('重挂接后世界位置保持', after.distanceTo(before) < 1e-6, `before=${before.toArray()} after=${after.toArray()}`);
  // 根关节不可删
  const rootRes = removeJoint(res.joints, [] as Keyframe[], 'pelvis');
  check('根关节禁止删除', rootRes.joints.length === res.joints.length);
}

// 6. 新增关节
{
  const next = addJoint(joints, 'neck', '测试关节');
  const created = next[next.length - 1];
  check('新增关节挂接正确', created.parentId === 'neck' && next.length === joints.length + 1);
}

// 7. 关键帧采样 + 约束变更后自动重算
{
  const doc: RigDocument = {
    version: 1,
    name: 't',
    joints,
    duration: 4,
    keyframes: [
      { id: 'k1', time: 0, pose: { elbow_l: [0, 0, 0] } },
      { id: 'k2', time: 2, pose: { elbow_l: [0, 0, 200] } }, // z 轴超出铰链默认上限 140
    ],
    rod: { value: 0, min: -2, max: 2, bindings: [] },
  };
  const mid = samplePose(doc, 1);
  check('关键帧线性插值', Math.abs(mid.pose.elbow_l![2] - 100) < 1e-6);
  check('采样结果被约束钳制', mid.clampedIds.size === 0); // 100 在范围内
  const atEnd = samplePose(doc, 2);
  check('末端关键帧超范围被钳制并标记', atEnd.pose.elbow_l![2] === 140 && atEnd.clampedIds.has('elbow_l'));

  // 收紧约束到 90，重算关键帧（关键帧保留，角度按新约束钳制）
  const tighter = joints.map((j) =>
    j.id === 'elbow_l' ? { ...j, limits: { ...j.limits, z: { ...j.limits.z, max: 90 } } } : j,
  );
  const recomputed = recomputeKeyframesForConstraints(tighter, doc.keyframes);
  check('约束变更后关键帧保留', recomputed.length === 2 && recomputed[1].id === 'k2');
  check('约束变更后角度按新约束重算', recomputed[1].pose.elbow_l![2] === 90);
}

// 8. 录制姿态经过 FK 后角度单位一致（度→弧度）
{
  const pose = { shoulder_l: [0, 0, 45] as [number, number, number] };
  const solved = solveFK(joints, pose);
  const e = solved.joints.get('shoulder_l')!;
  check('本地欧拉角记录为度', Math.abs(e.localEulerDeg[2] - 45) < 1e-6);
  void DEG;
}

console.log(`\n${passed} 项通过`);
