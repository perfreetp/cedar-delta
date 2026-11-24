import { smoothFalloff } from './brushConfig';
import type { Topology } from './topology';
import type { PlaneLike, SymmetrySettings, Vec3Like } from './types';

export interface StampRequest {
  kind: 'grab' | 'raise' | 'flatten' | 'smooth';
  center: Vec3Like;
  radius: number;
  strength: number;
  dt?: number;
  grabDelta?: Vec3Like;
  plane?: PlaneLike | null;
  fallbackNormal?: Vec3Like;
  symmetry: SymmetrySettings;
}

export interface StampResult {
  indices: number[];
  pointerCount: number;
  mirrorCount: number;
  axisCount: number;
}

interface Candidate {
  index: number;
  weight: number;
  side: -1 | 0 | 1;
  mirrored: boolean;
}

const ZERO: Vec3Like = { x: 0, y: 0, z: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mirrorVector(v: Vec3Like): Vec3Like {
  return { x: -v.x, y: v.y, z: v.z };
}

function planeForCandidate(plane: PlaneLike, mirrored: boolean): PlaneLike {
  if (!mirrored) return plane;
  return {
    point: { x: -plane.point.x, y: plane.point.y, z: plane.point.z },
    normal: { x: -plane.normal.x, y: plane.normal.y, z: plane.normal.z },
  };
}

/**
 * Framework-independent vertex deformation kernel.
 *
 * One stamp computes every displacement before writing any position, so the
 * smooth brush never sees partially updated one-ring positions.
 */
export class SculptKernel {
  positions: Float32Array;
  normals: Float32Array | null;
  topology: Topology;
  axisEpsilon: number;
  private scratchDelta: Float32Array;

  constructor(
    positions: Float32Array,
    normals: Float32Array | null,
    topology: Topology,
    axisEpsilon: number,
  ) {
    this.positions = positions;
    this.normals = normals;
    this.topology = topology;
    this.axisEpsilon = axisEpsilon;
    this.scratchDelta = new Float32Array(positions.length);
  }

  private sideAt(index: number): -1 | 0 | 1 {
    const x = this.positions[index * 3];
    if (x > this.axisEpsilon) return 1;
    if (x < -this.axisEpsilon) return -1;
    return 0;
  }

  private collectCandidates(req: StampRequest): Candidate[] {
    const candidates: Candidate[] = [];
    const { positions } = this;
    const radiusSq = req.radius * req.radius;
    const mirrorCenter: Vec3Like = {
      x: -req.center.x,
      y: req.center.y,
      z: req.center.z,
    };
    const sym = req.symmetry.enabled;

    if (sym && !req.symmetry.affectPositive && !req.symmetry.affectNegative) {
      return candidates;
    }

    for (let i = 0; i < positions.length / 3; i += 1) {
      const ix = i * 3;
      const x = positions[ix];
      const y = positions[ix + 1];
      const z = positions[ix + 2];
      const side = this.sideAt(i);

      let center = req.center;
      let mirrored = false;

      if (sym) {
        if (side === 1) {
          if (!req.symmetry.affectPositive) continue;
          mirrored = req.center.x < 0;
          center = mirrored ? mirrorCenter : req.center;
        } else if (side === -1) {
          if (!req.symmetry.affectNegative) continue;
          mirrored = req.center.x >= 0;
          center = mirrored ? mirrorCenter : req.center;
        } else {
          // Axis vertices are deliberately collected once.
          center = req.center;
          mirrored = false;
        }
      }

      const dx = x - center.x;
      const dy = y - center.y;
      const dz = z - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > radiusSq) continue;

      const distance = Math.sqrt(distSq);
      candidates.push({
        index: i,
        weight: smoothFalloff(distance / req.radius),
        side,
        mirrored,
      });
    }

    return candidates;
  }

  private smoothTarget(index: number, radius: number, out: Vec3Like): number {
    const { positions, topology } = this;
    const edges = topology.edges[index];
    const ix = index * 3;
    const px = positions[ix];
    const py = positions[ix + 1];
    const pz = positions[ix + 2];

    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;

    if (edges && edges.length > 0) {
      for (const edge of edges) {
        const jx = edge.neighbor * 3;
        const qx = positions[jx];
        const qy = positions[jx + 1];
        const qz = positions[jx + 2];
        const edgeLength = Math.max(1e-8, Math.hypot(qx - px, qy - py, qz - pz));

        let weight = 0;
        for (const opposite of edge.opposites) {
          const kx = opposite * 3;
          const ax = px - positions[kx];
          const ay = py - positions[kx + 1];
          const az = pz - positions[kx + 2];
          const bx = qx - positions[kx];
          const by = qy - positions[kx + 1];
          const bz = qz - positions[kx + 2];
          const dot = ax * bx + ay * by + az * bz;
          const cx = ay * bz - az * by;
          const cy = az * bx - ax * bz;
          const cz = ax * by - ay * bx;
          const crossLength = Math.max(1e-10, Math.hypot(cx, cy, cz));
          // Clamp negative cotangents from obtuse triangles for a stable,
          // convex weighted average.
          weight += clamp(dot / crossLength, 0, 12);
        }

        if (weight < 1e-7) {
          weight = 1 / (edgeLength + radius * 0.04);
        }

        totalWeight += weight;
        sumX += qx * weight;
        sumY += qy * weight;
        sumZ += qz * weight;
      }
    }

    if (totalWeight <= 1e-8) {
      out.x = px;
      out.y = py;
      out.z = pz;
      return 0;
    }

    out.x = sumX / totalWeight;
    out.y = sumY / totalWeight;
    out.z = sumZ / totalWeight;
    return totalWeight;
  }

  applyStamp(req: StampRequest): StampResult {
    const candidates = this.collectCandidates(req);
    const result: StampResult = {
      indices: candidates.map((candidate) => candidate.index),
      pointerCount: 0,
      mirrorCount: 0,
      axisCount: 0,
    };

    if (candidates.length === 0) return result;

    const frameScale = clamp((req.dt ?? 1 / 60) * 60, 0.25, 3);
    const grab = req.grabDelta ?? ZERO;
    const target: Vec3Like = { x: 0, y: 0, z: 0 };

    for (const candidate of candidates) {
      const i = candidate.index;
      const offset = i * 3;
      const w = candidate.weight;
      const scratchOffset = offset;

      if (req.symmetry.enabled) {
        if (candidate.side === 0) result.axisCount += 1;
        else if (candidate.mirrored) result.mirrorCount += 1;
        else result.pointerCount += 1;
      } else {
        result.pointerCount += 1;
      }

      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (req.kind === 'grab') {
        const gx = candidate.mirrored ? -grab.x : grab.x;
        const gy = grab.y;
        const gz = grab.z;
        const influence = req.strength * w;
        dx = gx * influence;
        dy = gy * influence;
        dz = gz * influence;
      } else if (req.kind === 'raise') {
        let nx = this.normals ? this.normals[offset] : 0;
        let ny = this.normals ? this.normals[offset + 1] : 0;
        let nz = this.normals ? this.normals[offset + 2] : 1;
        const normalLength = Math.hypot(nx, ny, nz);
        if (normalLength < 1e-6 && req.fallbackNormal) {
          nx = req.fallbackNormal.x;
          ny = req.fallbackNormal.y;
          nz = req.fallbackNormal.z;
        } else if (normalLength > 1e-6) {
          nx /= normalLength;
          ny /= normalLength;
          nz /= normalLength;
        }
        const amount = 0.014 * req.strength * w * frameScale;
        dx = nx * amount;
        dy = ny * amount;
        dz = nz * amount;
      } else if (req.kind === 'flatten' && req.plane) {
        const plane = planeForCandidate(req.plane, candidate.mirrored);
        let nx = plane.normal.x;
        let ny = plane.normal.y;
        let nz = plane.normal.z;
        const nLength = Math.max(1e-8, Math.hypot(nx, ny, nz));
        nx /= nLength;
        ny /= nLength;
        nz /= nLength;
        const signedDistance =
          (this.positions[offset] - plane.point.x) * nx +
          (this.positions[offset + 1] - plane.point.y) * ny +
          (this.positions[offset + 2] - plane.point.z) * nz;
        const blend = Math.min(1, (0.2 + 0.55 * req.strength) * w * frameScale);
        dx = -nx * signedDistance * blend;
        dy = -ny * signedDistance * blend;
        dz = -nz * signedDistance * blend;
      } else if (req.kind === 'smooth') {
        this.smoothTarget(i, req.radius, target);
        const blend = Math.min(1, (0.12 + 0.3 * req.strength) * w * frameScale);
        dx = (target.x - this.positions[offset]) * blend;
        dy = (target.y - this.positions[offset + 1]) * blend;
        dz = (target.z - this.positions[offset + 2]) * blend;
      }

      this.scratchDelta[scratchOffset] = dx;
      this.scratchDelta[scratchOffset + 1] = dy;
      this.scratchDelta[scratchOffset + 2] = dz;
    }

    // Commit only after all target positions/weights have been evaluated.
    for (const candidate of candidates) {
      const i = candidate.index;
      const offset = i * 3;
      this.positions[offset] += this.scratchDelta[offset];
      this.positions[offset + 1] += this.scratchDelta[offset + 1];
      this.positions[offset + 2] += this.scratchDelta[offset + 2];

      if (
        req.symmetry.enabled &&
        req.symmetry.lockAxis &&
        candidate.side === 0
      ) {
        this.positions[offset] = 0;
      }
    }

    return result;
  }
}

export function computeBrushPlane(
  positions: Float32Array,
  normals: Float32Array | null,
  center: Vec3Like,
  radius: number,
  fallbackNormal: Vec3Like,
): PlaneLike {
  const radiusSq = radius * radius;
  let weightSum = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;

  for (let i = 0; i < positions.length / 3; i += 1) {
    const offset = i * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const dx = x - center.x;
    const dy = y - center.y;
    const dz = z - center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > radiusSq) continue;

    const w = smoothFalloff(Math.sqrt(distSq) / radius);
    weightSum += w;
    px += x * w;
    py += y * w;
    pz += z * w;
    if (normals) {
      nx += normals[offset] * w;
      ny += normals[offset + 1] * w;
      nz += normals[offset + 2] * w;
    }
  }

  if (weightSum <= 1e-8) {
    return { point: { ...center }, normal: { ...fallbackNormal } };
  }

  nx /= weightSum;
  ny /= weightSum;
  nz /= weightSum;
  if (Math.hypot(nx, ny, nz) < 1e-5) {
    nx = fallbackNormal.x;
    ny = fallbackNormal.y;
    nz = fallbackNormal.z;
  }

  return {
    point: { x: px / weightSum, y: py / weightSum, z: pz / weightSum },
    normal: { x: nx, y: ny, z: nz },
  };
}
