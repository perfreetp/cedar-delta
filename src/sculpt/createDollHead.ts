import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function gaussian(value: number, center: number, width: number): number {
  const d = (value - center) / width;
  return Math.exp(-d * d);
}

function unitMask(value: number, start: number, end: number): number {
  const t = THREE.MathUtils.clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * A compact, exactly X-symmetric stylized doll/mannequin head with a neck.
 * Roughly five to six thousand welded vertices, intentionally in the range
 * where typed-array radius queries stay immediate.
 */
export function createDollHeadGeometry(): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(1, 80, 52);
  const position = head.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i);
    const ux = v.x;
    const uy = v.y;
    const uz = v.z;
    const absX = Math.abs(ux);
    const front = Math.pow(Math.max(0, uz), 1.35);

    let x = ux * 0.86;
    let y = uy * 1.28;
    let z = uz * 0.82;

    // Taper the lower face into a small doll chin.
    const jaw = unitMask(uy, -0.05, -0.95);
    x *= 1 - 0.36 * jaw;
    z *= 1 - 0.1 * jaw;
    z += 0.035 * jaw;

    // Slightly narrower forehead.
    const forehead = unitMask(uy, 0.25, 0.95);
    x *= 1 - 0.09 * forehead;

    // Soft cheek fullness.
    const cheek =
      gaussian(absX, 0.43, 0.18) *
      gaussian(y, -0.18, 0.2) *
      front;
    z += 0.075 * cheek;

    // Recessed eye sockets.
    const socket =
      gaussian(absX, 0.31, 0.15) *
      gaussian(y, 0.27, 0.105) *
      front;
    z -= 0.105 * socket;

    // Brow ridge just above the sockets.
    const brow =
      gaussian(absX, 0.31, 0.18) *
      gaussian(y, 0.43, 0.075) *
      front;
    z += 0.035 * brow;

    // Nose bridge and rounded tip.
    const bridge = gaussian(x, 0, 0.075) * gaussian(y, 0.24, 0.27) * front;
    const tip = gaussian(x, 0, 0.105) * gaussian(y, -0.03, 0.15) * front;
    z += 0.09 * bridge + 0.22 * tip;

    // Subtle mouth incision and lower lip.
    const mouth = gaussian(x, 0, 0.18) * gaussian(y, -0.43, 0.052) * front;
    const lowerLip = gaussian(x, 0, 0.16) * gaussian(y, -0.51, 0.07) * front;
    z -= 0.035 * mouth;
    z += 0.035 * lowerLip;

    // Ears at the sides.
    const ear =
      Math.pow(absX, 2.4) *
      gaussian(y, -0.08, 0.23) *
      gaussian(z, 0.02, 0.22);
    x += Math.sign(ux) * 0.13 * ear;

    position.setXYZ(i, x, y, z);
  }

  head.computeVertexNormals();

  const neck = new THREE.CylinderGeometry(0.31, 0.43, 0.78, 48, 8);
  neck.translate(0, -1.43, -0.03);
  neck.computeVertexNormals();

  const merged = mergeGeometries([head, neck], false) ?? head;
  merged.center();
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
