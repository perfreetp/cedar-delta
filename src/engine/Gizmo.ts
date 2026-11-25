/**
 * 自研三轴变换手柄：
 *  - 三根彩色箭头轴（X 红 / Y 绿 / Z 蓝）做轴向平移，中心菱形做视图平面自由平移；
 *  - 三个彩色圆环做绕轴旋转；
 *  - 命中检测用解析射线-圆柱/圆环求交，不依赖引擎拾取通道；
 *  - 旋转环用"射线与环平面交点的极角变化"计算增量角；
 *  - 吸附后姿态跟随牙面法向，手柄整体随套管朝向旋转。
 */
import * as pc from 'playcanvas';
import { v3, type QuatTuple, type Ray, type Vec3Tuple } from '../core/math';
import { ray as rayMath } from '../core/math';
import { torus } from '../core/geometry';
import { createPcMesh } from './shaders';

export type GizmoAxis = 'x' | 'y' | 'z' | 'center';
export type GizmoMode = 'translate' | 'rotate';
export type GizmoHandle = { mode: GizmoMode; axis: GizmoAxis };

const AXIS_COLOR: Record<GizmoAxis, pc.Color> = {
  x: new pc.Color(0.92, 0.32, 0.28),
  y: new pc.Color(0.45, 0.85, 0.4),
  z: new pc.Color(0.35, 0.55, 0.98),
  center: new pc.Color(0.95, 0.95, 0.95),
};

const AXIS_VECTOR: Record<'x' | 'y' | 'z', Vec3Tuple> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export class TransformGizmo {
  readonly root: pc.Entity;
  private translateGroup: pc.Entity;
  private rotateGroup: pc.Entity;
  private readonly arrowSpecs: Array<{ axis: 'x' | 'y' | 'z'; halfLen: number; radius: number }> = [];
  private readonly ringSpecs: Array<{ axis: 'x' | 'y' | 'z'; radius: number; tube: number }> = [];
  private centerHalf = 1.1;
  private mode: GizmoMode = 'translate';
  private activeHandle: GizmoHandle | null = null;
  private dragPlane: { point: Vec3Tuple; normal: Vec3Tuple } | null = null;
  private lastDragPoint: Vec3Tuple | null = null;
  private lastRingAngle = 0;
  private scale = 1;
  /** 手动加入图层的 MI 不随 Entity.enabled 自动隐藏，需自行维护 visible */
  private readonly tracked: Array<{ mi: pc.MeshInstance; group: pc.Entity }> = [];

  constructor(private readonly app: pc.Application, private readonly layer: pc.Layer) {
    this.root = new pc.Entity('gizmo-root');
    this.app.root.addChild(this.root);
    this.translateGroup = new pc.Entity('gizmo-translate');
    this.rotateGroup = new pc.Entity('gizmo-rotate');
    this.root.addChild(this.translateGroup);
    this.root.addChild(this.rotateGroup);
    this.buildArrows();
    this.buildRings();
    this.setMode('translate');
    this.applyVisibility();
  }

  /** 记录并把实体的 render MI 纳入显隐管理 */
  private attach(entity: pc.Entity): void {
    for (const mi of entity.render!.meshInstances) {
      this.layer.addMeshInstances([mi]);
      this.tracked.push({ mi, group: entity.parent as pc.Entity });
    }
  }

  /** 显隐 = 整体可见 且 所属分组处于当前模式 */
  private applyVisibility(): void {
    const active = this.mode === 'translate' ? this.translateGroup : this.rotateGroup;
    for (const { mi, group } of this.tracked) {
      mi.visible = this.root.enabled && group === active;
    }
  }

  private mat(color: pc.Color): pc.StandardMaterial {
    const m = new pc.StandardMaterial();
    m.diffuse = color;
    const emissive = color.clone();
    emissive.r *= 0.35;
    emissive.g *= 0.35;
    emissive.b *= 0.35;
    m.emissive = emissive;
    m.update();
    return m;
  }

  private buildArrows(): void {
    const len = 9;
    const shaftR = 0.22;
    for (const axis of ['x', 'y', 'z'] as const) {
      const shaft = new pc.Entity(`arrow-${axis}`);
      shaft.addComponent('render', { type: 'cylinder' });
      shaft.render!.material = this.mat(AXIS_COLOR[axis]);
      shaft.setLocalScale(shaftR, len / 2, shaftR);
      const offset = len / 4;
      shaft.setLocalPosition(
        axis === 'x' ? offset : 0,
        axis === 'y' ? offset : 0,
        axis === 'z' ? offset : 0,
      );
      this.orientAxis(shaft, axis);
      this.translateGroup.addChild(shaft);
      this.attach(shaft);

      const cone = new pc.Entity(`cone-${axis}`);
      cone.addComponent('render', { type: 'cone' });
      cone.render!.material = this.mat(AXIS_COLOR[axis]);
      cone.setLocalScale(0.85, 1.7, 0.85);
      cone.setLocalPosition(
        axis === 'x' ? len / 2 + 0.5 : 0,
        axis === 'y' ? len / 2 + 0.5 : 0,
        axis === 'z' ? len / 2 + 0.5 : 0,
      );
      this.orientAxis(cone, axis);
      this.translateGroup.addChild(cone);
      this.attach(cone);

      // 命中用隐形加粗圆柱（比可视轴宽，容易抓）
      const hitMesh = new pc.Mesh(this.app.graphicsDevice);
      const segs = 12;
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (2 * Math.PI * i) / segs;
        for (const y of [-len / 2, len / 2]) {
          pos.push(Math.cos(a) * 0.9, y, Math.sin(a) * 0.9);
        }
      }
      for (let i = 0; i < segs; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
      hitMesh.setPositions(Float32Array.from(pos));
      hitMesh.setIndices(Uint32Array.from(idx));
      hitMesh.setNormals(Float32Array.from(pos.flatMap((_, i) => (i % 3 === 1 ? [0, 1, 0] : [1, 0, 0]))));
      hitMesh.update();
      this.arrowSpecs.push({ axis, halfLen: len / 2, radius: 0.9 });
    }

    // 中心自由移动块（命中检测在 intersectCenterBox 中用解析 AABB 完成）
    const center = new pc.Entity('gizmo-center');
    center.addComponent('render', { type: 'box' });
    center.render!.material = this.mat(AXIS_COLOR.center);
    center.setLocalScale(1.4, 1.4, 1.4);
    this.translateGroup.addChild(center);
    this.attach(center);
  }

  private orientAxis(entity: pc.Entity, axis: 'x' | 'y' | 'z'): void {
    if (axis === 'x') entity.setLocalEulerAngles(0, 0, 90);
    else if (axis === 'z') entity.setLocalEulerAngles(90, 0, 0);
  }

  private buildRings(): void {
    const radius = 6.5;
    const tube = 0.28;
    const data = torus(radius, tube, 48, 10);
    for (const axis of ['x', 'y', 'z'] as const) {
      const ring = new pc.Entity(`ring-${axis}`);
      const mesh = createPcMesh(this.app.graphicsDevice, data);
      void mesh;
      ring.addComponent('render', {
        meshInstances: [new pc.MeshInstance(mesh, this.mat(AXIS_COLOR[axis]))],
      });
      if (axis === 'x') ring.setLocalEulerAngles(0, 90, 0);
      if (axis === 'z') ring.setLocalEulerAngles(90, 0, 0);
      this.rotateGroup.addChild(ring);
      this.attach(ring);
      this.ringSpecs.push({ axis, radius, tube });
    }
  }

  setMode(mode: GizmoMode): void {
    this.mode = mode;
    this.translateGroup.enabled = mode === 'translate';
    this.rotateGroup.enabled = mode === 'rotate';
    this.applyVisibility();
  }

  getMode(): GizmoMode {
    return this.mode;
  }

  show(position: Vec3Tuple, quaternion: QuatTuple, worldScale: number): void {
    this.root.enabled = true;
    this.scale = worldScale;
    this.root.setLocalScale(worldScale, worldScale, worldScale);
    this.root.setPosition(position[0], position[1], position[2]);
    this.root.setRotation(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this.applyVisibility();
  }

  hide(): void {
    this.root.enabled = false;
    this.activeHandle = null;
    this.applyVisibility();
  }

  get visible(): boolean {
    return this.root.enabled;
  }

  /** 屏幕射线命中测试，返回最近的手柄；未命中返回 null */
  hitTest(ray: Ray): GizmoHandle | null {
    if (!this.visible) return null;
    const candidates: Array<{ t: number; handle: GizmoHandle }> = [];
    const consider = (t: number | null, handle: GizmoHandle) => {
      if (t !== null && t >= 0) candidates.push({ t, handle });
    };

    if (this.mode === 'translate') {
      for (const a of this.arrowSpecs) {
        const { origin, dir } = this.toWorldAxis(a.axis, a.halfLen * this.scale);
        consider(rayMath.intersectCylinder(ray, origin, dir, a.radius * this.scale), {
          mode: 'translate',
          axis: a.axis,
        });
      }
      consider(this.intersectCenterBox(ray), { mode: 'translate', axis: 'center' });
    } else {
      for (const r of this.ringSpecs) {
        consider(this.intersectRing(ray, r.axis, r.radius * this.scale, r.tube * this.scale), {
          mode: 'rotate',
          axis: r.axis,
        });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((p, q2) => p.t - q2.t);
    return candidates[0].handle;
  }

  /** 开始拖拽，缓存投影平面；返回 false 表示手柄未命中 */
  beginDrag(handle: GizmoHandle, ray: Ray): boolean {
    this.activeHandle = handle;
    const origin = this.root.getPosition();
    if (handle.mode === 'translate') {
      if (handle.axis === 'center') {
        // 视图平面（法向朝相机）
        this.dragPlane = {
          point: [origin.x, origin.y, origin.z],
          normal: v3.normalize(v3.sub(ray.origin, [origin.x, origin.y, origin.z])),
        };
      } else {
        const axis = this.worldAxis(handle.axis);
        this.dragPlane = { point: [origin.x, origin.y, origin.z], normal: this.axisPlaneNormal(axis, ray.dir) };
      }
    } else {
      this.dragPlane = null;
      this.lastDragPoint = null;
      const angle = this.ringPolarAngle(ray, handle.axis as 'x' | 'y' | 'z');
      if (angle === null) return false;
      this.lastRingAngle = angle;
    }
    // 缓存首个交点，后续按帧做差得到增量位移
    if (this.dragPlane) {
      const first = this.rayPlanePoint(ray, this.dragPlane);
      this.lastDragPoint = first ? v3.add(this.dragPlane.point, first.delta) : null;
    }
    return true;
  }

  /**
   * 拖拽更新。
   * translate 返回世界空间位移 delta；rotate 返回绕世界轴的增量（弧度）。
   */
  updateDrag(ray: Ray): { delta?: Vec3Tuple; angleDelta?: number; axis?: Vec3Tuple } {
    if (!this.activeHandle) return {};
    if (this.activeHandle.mode === 'translate') {
      const hit = this.rayPlanePoint(ray, this.dragPlane!);
      if (!hit) return {};
      const point = v3.add(this.dragPlane!.point, hit.delta);
      const prev = this.lastDragPoint ?? this.dragPlane!.point;
      const frameDelta = v3.sub(point, prev);
      this.lastDragPoint = point;
      if (this.activeHandle.axis === 'center') {
        return { delta: frameDelta };
      }
      const axis = this.worldAxis(this.activeHandle.axis as 'x' | 'y' | 'z');
      const along = v3.dot(frameDelta, axis);
      return { delta: v3.scale(axis, along) };
    }
    const axisName = this.activeHandle.axis as 'x' | 'y' | 'z';
    const angle = this.ringPolarAngle(ray, axisName);
    if (angle === null) return {};
    let d = angle - this.lastRingAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.lastRingAngle = angle;
    return { angleDelta: d, axis: this.worldAxis(axisName) };
  }

  endDrag(): GizmoHandle | null {
    const h = this.activeHandle;
    this.activeHandle = null;
    this.dragPlane = null;
    return h;
  }

  isDragging(): boolean {
    return this.activeHandle !== null;
  }

  /** 当前可见的手柄网格数量（平移/旋转分组互斥） */
  visibleMeshCount(): number {
    this.applyVisibility();
    return this.tracked.filter((t) => t.mi.visible).length;
  }

  // ---------- 内部几何工具 ----------

  private worldAxis(axis: 'x' | 'y' | 'z'): Vec3Tuple {
    const local = AXIS_VECTOR[axis];
    const q = this.root.getRotation();
    const out = new pc.Vec3();
    q.transformVector(new pc.Vec3(local[0], local[1], local[2]), out);
    return v3.normalize([out.x, out.y, out.z]);
  }

  private toWorldAxis(axis: 'x' | 'y' | 'z', halfLen: number): { origin: Vec3Tuple; dir: Vec3Tuple } {
    const center = this.root.getPosition();
    const w = this.worldAxis(axis);
    return {
      origin: v3.add([center.x, center.y, center.z], v3.scale(w, -halfLen)),
      dir: v3.add([center.x, center.y, center.z], v3.scale(w, halfLen)),
    };
  }

  private axisPlaneNormal(axis: Vec3Tuple, rayDir: Vec3Tuple): Vec3Tuple {
    // 包含轴、且尽量朝向射线的平面法向
    const n = v3.cross(axis, rayDir);
    if (v3.len(n) < 1e-6) return v3.cross(axis, [0, 1, 0]);
    return v3.normalize(n);
  }

  private rayPlanePoint(
    r: Ray,
    plane: { point: Vec3Tuple; normal: Vec3Tuple },
  ): { delta: Vec3Tuple } | null {
    const denom = v3.dot(r.dir, plane.normal);
    if (Math.abs(denom) < 1e-6) return null;
    const t = v3.dot(v3.sub(plane.point, r.origin), plane.normal) / denom;
    if (t < 0) return null;
    const point = v3.add(r.origin, v3.scale(r.dir, t));
    return { delta: v3.sub(point, plane.point) };
  }

  private intersectCenterBox(r: Ray): number | null {
    // 用缩放后的 AABB（世界空间，近似——手柄无剪切缩放）
    const c = this.root.getPosition();
    const h = this.centerHalf * this.scale;
    let tmin = -Infinity;
    let tmax = Infinity;
    const o: Vec3Tuple = [r.origin[0] - c.x, r.origin[1] - c.y, r.origin[2] - c.z];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(r.dir[k]) < 1e-9) {
        if (o[k] < -h || o[k] > h) return null;
      } else {
        let t1 = (-h - o[k]) / r.dir[k];
        let t2 = (h - o[k]) / r.dir[k];
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmax >= 0 ? Math.max(0, tmin) : null;
  }

  private intersectRing(r: Ray, axis: 'x' | 'y' | 'z', radius: number, tube: number): number | null {
    const center = this.root.getPosition();
    const n = this.worldAxis(axis);
    // 射线与环平面求交，交点到环心距离在 [radius-tube, radius+tube] 即命中
    const denom = v3.dot(r.dir, n);
    if (Math.abs(denom) < 1e-6) return null;
    const t = v3.dot(v3.sub([center.x, center.y, center.z], r.origin), n) / denom;
    if (t < 0) return null;
    const p = v3.add(r.origin, v3.scale(r.dir, t));
    const d = v3.dist(p, [center.x, center.y, center.z]);
    return Math.abs(d - radius) <= tube * 1.8 ? t : null;
  }

  private ringPolarAngle(r: Ray, axis: 'x' | 'y' | 'z'): number | null {
    const center = this.root.getPosition();
    const n = this.worldAxis(axis);
    const denom = v3.dot(r.dir, n);
    if (Math.abs(denom) < 1e-6) return null;
    const t = v3.dot(v3.sub([center.x, center.y, center.z], r.origin), n) / denom;
    if (t < 0) return null;
    const p = v3.add(r.origin, v3.scale(r.dir, t));
    const rel = v3.sub(p, [center.x, center.y, center.z]);
    // 在垂直于轴的平面内取两个基向量
    const ref: Vec3Tuple = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = v3.normalize(v3.cross(n, ref));
    const e2 = v3.normalize(v3.cross(n, e1));
    return Math.atan2(v3.dot(rel, e2), v3.dot(rel, e1));
  }
}
