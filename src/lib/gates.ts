// 闸门:沿地形表面放置,门杆吸附等高线切线,立柱落地并记录入水高度
import { DEFAULT_GATE_WIDTH, POLE_HEIGHT } from './constants';
import type { Centerline } from './centerline';
import type { Gate, GateColor, Step } from './types';
import { heightAt } from './terrain';
import { downstreamGrade } from './profile';
import { uid } from './id';

/** 数值梯度 */
function gradient(
  heights: Float32Array,
  x: number,
  z: number,
): { gx: number; gz: number } {
  const e = 1.2;
  const gx = (heightAt(heights, x + e, z) - heightAt(heights, x - e, z)) / (2 * e);
  const gz = (heightAt(heights, x, z + e) - heightAt(heights, x, z - e)) / (2 * e);
  return { gx, gz };
}

export interface GatePlacement {
  s: number;
  offset: number;
  color: GateColor;
  width?: number;
  id?: string;
}

/** 依据中心线站位 + 地形计算完整闸门几何 */
export function buildGate(
  center: Centerline,
  heights: Float32Array,
  steps: Step[],
  placement: GatePlacement,
): Gate {
  const width = placement.width ?? DEFAULT_GATE_WIDTH;
  const smp = center.sampleAt(placement.s);
  const cx = smp.x + smp.nx * placement.offset;
  const cz = smp.z + smp.nz * placement.offset;

  // 等高线切线:与梯度垂直
  const { gx, gz } = gradient(heights, cx, cz);
  let tx: number;
  let tz: number;
  const gl = Math.hypot(gx, gz);
  if (gl < 1e-5) {
    // 局部近乎平坦时退回中心线切向
    tx = smp.tx;
    tz = smp.tz;
  } else {
    tx = -gz / gl;
    tz = gx / gl;
  }
  const yaw = Math.atan2(tx, tz);

  const half = width / 2;
  const ax = cx + tx * half;
  const az = cz + tz * half;
  const bx = cx - tx * half;
  const bz = cz - tz * half;
  const hA = heightAt(heights, ax, az);
  const hB = heightAt(heights, bx, bz);

  return {
    id: placement.id ?? uid('gate'),
    color: placement.color,
    s: placement.s,
    offset: placement.offset,
    width,
    pA: [ax, hA, az],
    pB: [bx, hB, bz],
    yaw,
    entryHeight: (hA + hB) / 2,
    downstreamGrade: downstreamGrade(placement.s, steps, center.totalLength),
  };
}

/** 地形或剖面变化后,按既有站位重新落地全部闸门(保持 id 与站位一致) */
export function regroundGates(
  center: Centerline,
  heights: Float32Array,
  steps: Step[],
  gates: Gate[],
): Gate[] {
  return gates.map((g) =>
    buildGate(center, heights, steps, {
      id: g.id,
      s: g.s,
      offset: g.offset,
      color: g.color,
      width: g.width,
    }),
  );
}

/** 仅重算下游坡度(拖动闸门 s 变化时联动) */
export function refreshDownstreamGrade(
  gate: Gate,
  steps: Step[],
  totalLength: number,
): Gate {
  return { ...gate, downstreamGrade: downstreamGrade(gate.s, steps, totalLength) };
}

export function poleTopY(g: Gate, end: 'A' | 'B'): number {
  const ground = end === 'A' ? g.pA[1] : g.pB[1];
  return ground + POLE_HEIGHT;
}
