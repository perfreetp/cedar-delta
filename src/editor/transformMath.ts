import * as THREE from 'three';
import { FLOWER_META, FlowerInstance, TABLE_SURFACE_Y } from './types';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'XYZ');

export function composeInstanceMatrix(instance: FlowerInstance, target = new THREE.Matrix4()): THREE.Matrix4 {
  _pos.set(
    instance.position[0],
    TABLE_SURFACE_Y + instance.position[1] + instance.vaseHeight,
    instance.position[2],
  );
  _euler.set(instance.rotation[0], instance.rotation[1], instance.rotation[2], 'XYZ');
  _quat.setFromEuler(_euler);
  _scale.set(instance.scale[0], instance.scale[1], instance.scale[2]);
  return target.compose(_pos, _quat, _scale);
}

/** 把整体变换后的世界矩阵写回实例；花器高度仍作为独立字段保留。 */
export function decomposeInstanceMatrix(instance: FlowerInstance, matrix: THREE.Matrix4): void {
  matrix.decompose(_pos, _quat, _scale);
  _euler.setFromQuaternion(_quat, 'XYZ');
  instance.position[0] = _pos.x;
  instance.position[1] = _pos.y - TABLE_SURFACE_Y - instance.vaseHeight;
  instance.position[2] = _pos.z;
  instance.rotation[0] = _euler.x;
  instance.rotation[1] = _euler.y;
  instance.rotation[2] = _euler.z;
  instance.scale[0] = _scale.x;
  instance.scale[1] = _scale.y;
  instance.scale[2] = _scale.z;
}

export function collisionRadius(instance: FlowerInstance): number {
  const base = FLOWER_META[instance.type].radius;
  const horizontalScale = Math.max(Math.abs(instance.scale[0]), Math.abs(instance.scale[2]), 0.2);
  return base * horizontalScale;
}

export function horizontalCenter(instance: FlowerInstance, target = new THREE.Vector2()): THREE.Vector2 {
  return target.set(instance.position[0], instance.position[2]);
}

export function rotateXZ(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // 与 THREE.Matrix4 绕 Y 轴旋转保持一致
  return [x * c + z * s, -x * s + z * c];
}
