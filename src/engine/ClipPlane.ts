/**
 * 剖切面：可视化半透明平面 + 法向推拉手柄。
 *
 * 剖切判定参数写入全局 ClipUniforms（shaders.ts 中 uClipPlane/uClipEnabled），
 * forward 与 pick 两套 shader 共用，保证剖切与拾取完全同步。
 * distance 沿 normal 推拉；提供三个预设朝向（矢状/冠状/水平）。
 */
import * as pc from 'playcanvas';
import { v3, type Vec3Tuple } from '../core/math';
import type { ClipState } from '../core/types';
import type { ClipUniforms } from './shaders';

export type ClipPreset = 'sagittal' | 'coronal' | 'axial';

const PRESET_NORMAL: Record<ClipPreset, Vec3Tuple> = {
  sagittal: [1, 0, 0],
  coronal: [0, 0, 1],
  axial: [0, 1, 0],
};

export class ClipPlaneGizmo {
  readonly entity: pc.Entity;
  private handleEntity: pc.Entity;
  private quadEntity: pc.Entity;
  private readonly meshInstances: pc.MeshInstance[] = [];
  private preset: ClipPreset = 'sagittal';
  private halfSize = 42;

  constructor(
    private readonly app: pc.Application,
    private readonly gizmoLayer: pc.Layer,
    private readonly state: ClipState,
    private readonly onCommit: () => void,
  ) {
    this.entity = new pc.Entity('clip-plane');
    this.quadEntity = this.buildQuad();
    this.handleEntity = this.buildHandle();
    this.entity.addChild(this.quadEntity);
    this.entity.addChild(this.handleEntity);
    this.app.root.addChild(this.entity);
    this.syncTransform();
  }

  private buildQuad(): pc.Entity {
    const e = new pc.Entity('clip-quad');
    e.addComponent('render', { type: 'plane' });
    const mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(0.35, 0.75, 1.0);
    mat.emissive = new pc.Color(0.05, 0.22, 0.38);
    mat.opacity = 0.16;
    mat.blendType = pc.BLEND_NORMAL;
    mat.depthWrite = false;
    mat.update();
    e.render!.material = mat;
    e.setLocalScale(this.halfSize * 2, 1, this.halfSize * 2);
    const mi = e.render!.meshInstances[0];
    this.gizmoLayer.addMeshInstances([mi]);
    this.meshInstances.push(mi);
    return e;
  }

  private buildHandle(): pc.Entity {
    const e = new pc.Entity('clip-handle');
    e.addComponent('render', { type: 'cylinder' });
    e.setLocalScale(0.6, 6, 0.6);
    e.setLocalPosition(0, 3, 0);
    const mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(0.4, 0.9, 1.0);
    mat.emissive = new pc.Color(0.15, 0.55, 0.75);
    mat.update();
    e.render!.material = mat;
    const mi = e.render!.meshInstances[0];
    this.gizmoLayer.addMeshInstances([mi]);
    this.meshInstances.push(mi);
    return e;
  }

  /** 手柄的世界射线（沿平面法向），供输入系统判定抓取 */
  handleRay(): { origin: pc.Vec3; dir: pc.Vec3 } {
    const pos = this.handleEntity.getPosition();
    const n = new pc.Vec3(...this.state.normal);
    this.entity.getWorldTransform().transformVector(n, n);
    return { origin: pos, dir: n.normalize() };
  }

  setPreset(preset: ClipPreset): void {
    this.preset = preset;
    this.state.normal = [...PRESET_NORMAL[preset]];
    this.syncTransform();
  }

  getPreset(): ClipPreset {
    return this.preset;
  }

  setDistance(d: number): void {
    this.state.distance = d;
    this.syncTransform();
  }

  getDistance(): number {
    return this.state.distance;
  }

  setEnabled(on: boolean): void {
    this.state.enabled = on;
    this.entity.enabled = on;
    // MI 手动入层，显隐需自行维护（Entity.enabled 不会同步到脱离组件管理的 MI）
    for (const mi of this.meshInstances) mi.visible = on;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  commit(): void {
    this.onCommit();
  }

  /** 把 uniform 同步到 shader scope（每帧调用） */
  pushUniforms(sync: { push(clip: ClipUniforms): void }): void {
    sync.push({
      enabled: this.state.enabled,
      normal: this.state.normal,
      distance: this.state.distance,
    });
  }

  /** 距离沿法向的世界点（推拉时把指针投影到法向轴） */
  planePoint(): pc.Vec3 {
    return new pc.Vec3(...v3.scale(this.state.normal, this.state.distance));
  }

  private syncTransform(): void {
    // 平面姿态：local +Y 对齐法向（plane 几何默认在 XZ 面、法向 +Y）
    const from: Vec3Tuple = [0, 1, 0];
    const to = v3.normalize(this.state.normal);
    const qCore = qFromTo(from, to);
    this.entity.setPosition(...v3.scale(to, this.state.distance));
    this.entity.setRotation(qCore[0], qCore[1], qCore[2], qCore[3]);
  }
}

function qFromTo(from: Vec3Tuple, to: Vec3Tuple): [number, number, number, number] {
  // 复用 core 的四元数实现，避免引擎层反向依赖
  const dot = Math.min(1, Math.max(-1, v3.dot(v3.normalize(from), v3.normalize(to))));
  if (dot > 1 - 1e-9) return [0, 0, 0, 1];
  const axis = v3.normalize(v3.cross(from, to));
  const angle = Math.acos(dot);
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}
