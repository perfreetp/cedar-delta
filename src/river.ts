import * as THREE from 'three';
import type { RiverConfig, Vec3Tuple } from './types';

export const DEFAULT_RIVER: RiverConfig = {
  length: 82,
  width: 16,
  centerWidth: 10.5,
  curveAmplitude: 2.25,
  segmentLength: 1.6,
  waterLevel: 0,
  channelBottom: -2.05,
  channelTop: 2.15,
};

export class RiverPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;

  constructor(public config: RiverConfig) {
    const points: THREE.Vector3[] = [];
    const half = config.length / 2;
    const steps = 56;
    for (let i = 0; i <= steps; i++) {
      const z = -half + (config.length * i) / steps;
      const x =
        config.curveAmplitude * Math.sin(z * 0.105) +
        config.curveAmplitude * 0.32 * Math.sin(z * 0.037 + 1.4);
      points.push(new THREE.Vector3(x, config.waterLevel, z));
    }
    this.curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.35);
    this.curve.arcLengthDivisions = 500;
    this.length = this.curve.getLength();
  }

  atDistance(s: number, lateral = 0, y = this.config.waterLevel): {
    position: THREE.Vector3;
    tangent: THREE.Vector3;
    angleY: number;
  } {
    const clamped = THREE.MathUtils.clamp(s, 0, this.length);
    const u = clamped / this.length;
    const p = this.curve.getPointAt(u);
    const tangent = this.curve.getTangentAt(u).normalize();
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    p.addScaledVector(normal, lateral);
    p.y = y;
    return {
      position: p,
      tangent,
      angleY: Math.atan2(tangent.x, tangent.z),
    };
  }

  nearest(x: number, z: number): { s: number; lateral: number; angleY: number; point: THREE.Vector3 } {
    let bestU = 0;
    let bestDistance = Infinity;
    const samples = 360;
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const p = this.curve.getPointAt(u);
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        bestU = u;
      }
    }
    // Local refinement around the best coarse sample.
    const span = 1 / samples;
    for (let i = -8; i <= 8; i++) {
      const u = THREE.MathUtils.clamp(bestU + (i * span) / 16, 0, 1);
      const p = this.curve.getPointAt(u);
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        bestU = u;
      }
    }
    const point = this.curve.getPointAt(bestU);
    const tangent = this.curve.getTangentAt(bestU).normalize();
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    const delta = new THREE.Vector3(x - point.x, 0, z - point.z);
    const lateral = delta.dot(normal);
    return {
      s: bestU * this.length,
      lateral,
      angleY: Math.atan2(tangent.x, tangent.z),
      point,
    };
  }

  zToDistance(z: number): number {
    return this.nearest(0, z).s;
  }

  makeRibbon(width: number, y: number, segments = 180): THREE.BufferGeometry {
    return this.makeOffsetRibbon(0, width, y, segments);
  }

  makeOffsetRibbon(centerOffset: number, width: number, y: number, segments = 180): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const p = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const center = p.clone().addScaledVector(normal, centerOffset);
      const left = center.clone().addScaledVector(normal, -width / 2);
      const right = center.clone().addScaledVector(normal, width / 2);
      left.y = y;
      right.y = y;
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, u * 12, 1, u * 12);
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  channelSegments(): Array<{ position: Vec3Tuple; angleY: number; length: number }> {
    const result: Array<{ position: Vec3Tuple; angleY: number; length: number }> = [];
    const count = Math.ceil(this.length / this.config.segmentLength);
    const step = this.length / count;
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) * step;
      const frame = this.atDistance(s, 0, (this.config.channelBottom + this.config.channelTop) / 2);
      result.push({
        position: [frame.position.x, frame.position.y, frame.position.z],
        angleY: frame.angleY,
        length: step + 0.45,
      });
    }
    return result;
  }
}
