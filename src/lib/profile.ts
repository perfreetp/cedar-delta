// 坡度剖面:基础纵坡 + 落差台阶(跌水段)前后坡面按角度自动过渡
import * as THREE from 'three';
import { CHANNEL_GRADE, DOWNSTREAM_WINDOW, HEAD_ELEVATION } from './constants';
import type { Centerline } from './centerline';
import type { Step } from './types';

/** 无台阶时的渠底设计高程(沿弧长线性降坡) */
export function baseElevation(s: number): number {
  return HEAD_ELEVATION - CHANNEL_GRADE * s;
}

function smooth01(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 单个台阶在位置 s 处产生的高程偏移(负值)。
 * 过渡段总长 L = drop / tan(angle),以台阶位置为中心前后各 L/2,
 * 平均坡度即设定角度对应的坡度,两端 smoothstep 缓入缓出。
 */
function stepOffset(s: number, step: Step): number {
  const angleRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(step.angle, 1, 80));
  const L = Math.max(0.5, step.drop / Math.tan(angleRad));
  const start = step.s - L / 2;
  const u = (s - start) / L;
  if (u <= 0) return 0;
  if (u >= 1) return -step.drop;
  return -step.drop * smooth01(u);
}

/** 含全部台阶的设计渠底高程 */
export function designElevation(s: number, steps: Step[]): number {
  let h = baseElevation(s);
  for (const st of steps) h += stepOffset(s, st);
  return h;
}

export interface ProfilePoint {
  s: number;
  x: number;
  z: number;
  elevation: number;
  /** 纵向坡度(%,正数表示下坡) */
  grade: number;
}

/** 沿中心线生成完整坡度剖面 */
export function computeProfile(center: Centerline, steps: Step[]): ProfilePoint[] {
  const n = center.samples.length;
  const out: ProfilePoint[] = [];
  const ds = Math.max(1e-6, center.totalLength / (n - 1));
  for (let i = 0; i < n; i++) {
    const smp = center.samples[i];
    const e = designElevation(smp.s, steps);
    const eNext = designElevation(Math.min(center.totalLength, smp.s + ds), steps);
    const grade = ((e - eNext) / ds) * 100;
    out.push({ s: smp.s, x: smp.x, z: smp.z, elevation: e, grade });
  }
  return out;
}

/** 闸门处下游窗口内的平均下坡百分比(拖动闸门时联动重算) */
export function downstreamGrade(s: number, steps: Step[], totalLength: number): number {
  const end = Math.min(totalLength, s + DOWNSTREAM_WINDOW);
  const span = end - s;
  if (span < 1e-6) return CHANNEL_GRADE * 100;
  return ((designElevation(s, steps) - designElevation(end, steps)) / span) * 100;
}

export interface StepValidation {
  ok: boolean;
  message?: string;
}

/** 校验台阶过渡段互不重叠 */
export function validateSteps(steps: Step[]): StepValidation {
  const sorted = [...steps].sort((a, b) => a.s - b.s);
  for (let i = 0; i < sorted.length; i++) {
    const st = sorted[i];
    const angleRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(st.angle, 1, 80));
    const L = Math.max(0.5, st.drop / Math.tan(angleRad));
    if (st.drop <= 0) return { ok: false, message: '台阶落差必须大于 0' };
    if (i > 0) {
      const prev = sorted[i - 1];
      const pa = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(prev.angle, 1, 80));
      const pL = Math.max(0.5, prev.drop / Math.tan(pa));
      if (st.s - L / 2 < prev.s + pL / 2) {
        return { ok: false, message: '相邻台阶的过渡坡面重叠,请拉开距离或减小落差/角度' };
      }
    }
  }
  return { ok: true };
}
