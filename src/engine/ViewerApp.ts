/**
 * 应用总装配：PlayCanvas 场景搭建 + 全部交互状态机 + 命令接线。
 *
 * 交互路由（pointerdown 优先级）：
 *   1. 变换手柄命中 → 拖动套管/组（含吸附、弹回、碰撞避让）
 *   2. 剖切手柄命中 → 推拉剖切面
 *   3. 空白处左键 → 框选；点击 → 颜色拾取点选
 *   4. 其余 → 轨道相机
 */
import * as pc from 'playcanvas';
import { DentalArch } from '../core/arch';
import { alignSleeves } from '../core/align';
import { resolveCollisions } from '../core/collision';
import { q, v3, type QuatTuple, type Ray, type Vec3Tuple } from '../core/math';
import { CommandStack, takeSnapshot, type SceneSnapshot } from '../core/commands';
import { SelectionModel } from '../core/selection';
import { SnapEngine } from '../core/snap';
import {
  SLEEVE_COLLISION_R,
  SLEEVE_HEIGHT,
  type ClipState,
  type SleeveState,
} from '../core/types';
import { jawRidge } from '../core/geometry';
import { ClipPlaneGizmo, type ClipPreset } from './ClipPlane';
import { ColorPicker } from './Picking';
import { TransformGizmo, type GizmoHandle } from './Gizmo';
import { MarkerField } from './MarkerField';
import { OrbitCamera } from './OrbitCamera';
import {
  ClipUniformSync,
  createPcMesh,
  GuideMaterial,
  writeForwardDrawUniforms,
} from './shaders';
import { SleeveRenderer } from './SleeveRenderer';

export interface ViewerEvents {
  onSelectionChange?: (ids: number[]) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean, labels: string[]) => void;
  onSnapChange?: (snappedCount: number) => void;
  onClipChange?: (clip: ClipState) => void;
  onMarquee?: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  onStatus?: (text: string) => void;
}

interface DragSession {
  kind: 'sleeve' | 'group' | 'clip';
  before: SceneSnapshot;
  startPointer: { x: number; y: number };
  movingIds: Set<number>;
  snapped: boolean;
}

export class ViewerApp {
  readonly app: pc.Application;
  private readonly arch = new DentalArch();
  private readonly snapEngine = new SnapEngine(this.arch);
  private readonly selection = new SelectionModel();
  private readonly history = new CommandStack(() => this.emitHistory());

  private sleeves: SleeveState[] = [];
  private clip: ClipState = { enabled: false, normal: [1, 0, 0], distance: 0 };

  private worldLayer!: pc.Layer;
  private pickLayer!: pc.Layer;
  private gizmoLayer!: pc.Layer;
  private cameraEntity!: pc.Entity;
  private orbit!: OrbitCamera;
  private sleeveRenderer!: SleeveRenderer;
  private gizmo!: TransformGizmo;
  private clipGizmo!: ClipPlaneGizmo;
  private picker!: ColorPicker;
  private clipSync!: ClipUniformSync;

  private drag: DragSession | null = null;
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private orbiting = false;
  private lastPointer = { x: 0, y: 0 };
  private nextId = 1;
  private destroyed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: ViewerEvents = {},
  ) {
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.setupLayers();
    this.setupScene();
    this.setupInput();
    this.app.on('update', () => this.frame());
    this.app.start();
  }

  // ---------------- 场景搭建 ----------------

  private setupLayers(): void {
    const composition = this.app.scene.layers;
    this.worldLayer = composition.getLayerByName('World')!;
    this.gizmoLayer = new pc.Layer({ name: 'GuideGizmo' });
    this.pickLayer = new pc.Layer({ name: 'GuidePick' });
    const worldIndex = composition.getOpaqueIndex(this.worldLayer);
    composition.insert(this.gizmoLayer, worldIndex + 1);
    composition.insert(this.pickLayer, worldIndex + 2);

    this.cameraEntity = new pc.Entity('camera');
    this.cameraEntity.addComponent('camera', {
      nearClip: 1,
      farClip: 2000,
      fov: 45,
      clearColor: new pc.Color(0.05, 0.06, 0.08),
    });
    this.cameraEntity.camera!.layers = [
      this.worldLayer.id,
      this.gizmoLayer.id,
      pc.LAYERID_UI,
    ];
    this.app.root.addChild(this.cameraEntity);
    this.orbit = new OrbitCamera(this.cameraEntity.camera!);
  }

  private setupScene(): void {
    const device = this.app.graphicsDevice;

    // 光照（方向光方向同时推给自定义 shader）
    const light = new pc.Entity('light');
    light.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.96, 0.9),
      intensity: 1.1,
    });
    light.setEulerAngles(-35, 40, 25);
    this.app.root.addChild(light);
    this.app.scene.ambientLight = new pc.Color(0.35, 0.37, 0.42);
    this.pushLightUniforms();

    // 下颌骨体
    const jawMesh = createPcMesh(device, jawRidge(this.arch));
    const jawMat = new GuideMaterial(device, new pc.Color(0.82, 0.76, 0.66));
    const jaw = new pc.Entity('jaw');
    const jawMI = new pc.MeshInstance(jawMesh, jawMat);
    jaw.addComponent('render', { meshInstances: [jawMI] });
    this.app.root.addChild(jaw);
    writeForwardDrawUniforms(jawMI, jawMat);
    for (const mi of jaw.render!.meshInstances) this.worldLayer.addMeshInstances([mi]);

    // 套管
    this.sleeveRenderer = new SleeveRenderer(this.app, this.worldLayer, this.pickLayer);
    this.seedSleeves();

    // 标记点云（3000 实例，单 draw call）
    const markers = new MarkerField(device, this.arch, {
      count: 3000,
      fadeNear: 70,
      fadeFar: 190,
    });
    this.app.root.addChild(markers.host);
    this.worldLayer.addMeshInstances([markers.meshInstance]);

    // 手柄与剖切
    this.gizmo = new TransformGizmo(this.app, this.gizmoLayer);
    this.clipGizmo = new ClipPlaneGizmo(this.app, this.gizmoLayer, this.clip, () =>
      this.commitClipOnly(),
    );
    this.clipGizmo.setEnabled(false);

    this.clipSync = new ClipUniformSync(device);
    this.picker = new ColorPicker(this.app, this.pickLayer);

    window.addEventListener('resize', this.onResize);
  }

  private seedSleeves(): void {
    const sites = this.arch.samplesByArc(14);
    for (const site of sites) {
      const snap = this.snapEngine.evaluate(site.point);
      const state: SleeveState = {
        id: this.nextId++,
        position: snap.position,
        quaternion: snap.quaternion,
        snapped: true,
        snapU: snap.frame.u,
        snapV: snap.frame.v,
      };
      this.sleeves.push(state);
      this.sleeveRenderer.add(state);
    }
  }

  private pushLightUniforms(): void {
    const d = this.app.graphicsDevice;
    d.scope.resolve('uLightDir').setValue([0.5, 0.8, 0.35]);
  }

  // ---------------- 输入路由 ----------------

  private setupInput(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private toRay(e: PointerEvent | WheelEvent): Ray {
    const rect = this.canvas.getBoundingClientRect();
    const x = ('clientX' in e ? e.clientX : 0) - rect.left;
    const y = ('clientY' in e ? e.clientY : 0) - rect.top;
    const r = this.orbit.screenRay(x, y);
    return { origin: r.origin, dir: r.dir };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.lastPointer = { x, y };
    const ray = this.toRay(e);

    // 轨道相机优先（右键 / 中键 / Alt）
    if (e.button === 1 || e.button === 2 || e.altKey) {
      this.orbiting = true;
      return;
    }

    // 1. 变换手柄
    if (this.gizmo.visible) {
      const handle = this.gizmo.hitTest(ray);
      if (handle && this.gizmo.beginDrag(handle, ray)) {
        this.beginSleeveDrag(handle, e.shiftKey);
        return;
      }
    }

    // 2. 剖切手柄
    if (this.clip.enabled && this.hitClipHandle(ray)) {
      this.drag = {
        kind: 'clip',
        before: takeSnapshot(this.sleeves, this.clip),
        startPointer: { x, y },
        movingIds: new Set(),
        snapped: false,
      };
      return;
    }

    // 3. 空白处启动框选（点选在 pointerup 按位移量区分）
    this.marquee = { x0: x, y0: y, x1: x, y1: y };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - this.lastPointer.x;
    const dy = y - this.lastPointer.y;
    this.lastPointer = { x, y };

    if (this.orbiting) {
      if (e.shiftKey) this.orbit.pan(dx, dy);
      else this.orbit.rotate(dx, dy);
      return;
    }

    const ray = this.toRay(e);

    if (this.drag?.kind === 'clip') {
      this.dragClip(ray);
      return;
    }
    if (this.drag?.kind === 'sleeve' || this.drag?.kind === 'group') {
      this.dragSleeve(ray);
      return;
    }
    if (this.marquee) {
      this.marquee.x1 = x;
      this.marquee.y1 = y;
      this.events.onMarquee?.(this.marqueeRect());
    }
  };

  private onPointerUp = async (e: PointerEvent): Promise<void> => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.orbiting) {
      this.orbiting = false;
      return;
    }

    if (this.drag?.kind === 'clip') {
      this.endClipDrag();
      return;
    }
    if (this.drag?.kind === 'sleeve' || this.drag?.kind === 'group') {
      this.endSleeveDrag();
      return;
    }

    if (this.marquee) {
      const r = this.marqueeRect();
      const moved = Math.hypot(r.w, r.h);
      this.events.onMarquee?.(null);
      this.marquee = null;
      if (moved < 6) {
        await this.pickClick(x, y, e.ctrlKey || e.metaKey || e.shiftKey);
      } else {
        await this.pickMarquee(r, e.ctrlKey || e.metaKey || e.shiftKey);
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.orbit.zoom(e.deltaY);
  };

  private onResize = (): void => {
    this.app.resizeCanvas();
  };

  // ---------------- 点选 / 框选 ----------------

  private async pickClick(x: number, y: number, additive: boolean): Promise<void> {
    const ids = (await this.picker.query(this.cameraEntity.camera!, { x: x - 3, y: y - 3, w: 7, h: 7 }))
      .filter((id) => this.getSleeve(id) !== undefined);
    if (ids.length === 0) {
      if (!additive) {
        this.selection.clear();
        this.refreshSelection();
      }
      return;
    }
    const id = ids[0];
    if (additive) this.selection.toggle(id);
    else this.selection.pick(id, false);
    this.refreshSelection();
  }

  private async pickMarquee(
    rect: { x: number; y: number; w: number; h: number },
    additive: boolean,
  ): Promise<void> {
    const ids = (await this.picker.query(this.cameraEntity.camera!, rect))
      .filter((id) => this.getSleeve(id) !== undefined);
    if (additive) {
      for (const id of ids) this.selection.select(id);
    } else {
      this.selection.replace(ids);
    }
    this.refreshSelection();
  }

  private refreshSelection(): void {
    const ids = [...this.selection.ids];
    this.sleeveRenderer.setSelected(new Set(ids));
    this.events.onSelectionChange?.(ids);
    if (ids.length === 0) {
      this.gizmo.hide();
    } else if (ids.length === 1) {
      const s = this.getSleeve(ids[0])!;
      this.gizmo.show(s.position, s.quaternion, 1);
    } else {
      const center = this.selectionCenter();
      this.gizmo.show(center, q.identity(), 1);
    }
    this.emitSnapStatus();
  }

  // ---------------- 套管拖动 ----------------

  private beginSleeveDrag(handle: GizmoHandle, additive: boolean): void {
    void additive;
    const ids = [...this.selection.ids];
    const movingIds = new Set(ids);
    this.drag = {
      kind: movingIds.size > 1 ? 'group' : 'sleeve',
      before: takeSnapshot(this.sleeves, this.clip),
      startPointer: { ...this.lastPointer },
      movingIds,
      snapped: false,
    };
    void handle;
  }

  private dragSleeve(ray: Ray): void {
    const drag = this.drag;
    if (!drag) return;
    const info = this.gizmo.updateDrag(ray);
    const ids = [...drag.movingIds];

    if (info.angleDelta !== undefined && info.axis) {
      // 旋转：绕世界轴叠加，旋转期间解除吸附（姿态自由）
      const dq = q.fromAxisAngle(info.axis, info.angleDelta);
      for (const id of ids) {
        const s = this.getSleeve(id)!;
        s.quaternion = q.mul(dq, s.quaternion);
        s.snapped = false;
        s.snapU = null;
        s.snapV = null;
        this.sleeveRenderer.sync(s);
      }
      drag.snapped = false;
      this.updateGizmoFromSelection();
      this.events.onStatus?.('旋转中（松手就位，拖动靠近牙面可重新吸附）');
      return;
    }

    if (!info.delta) return;

    if (this.gizmo.getMode() === 'translate') {
      // 以主选中件为吸附探针
      const primaryId = this.selection.first() ?? ids[0];
      const primary = this.getSleeve(primaryId)!;
      const probeTarget = v3.add(primary.position, info.delta);
      const snap = this.snapEngine.evaluate(probeTarget);

      if (this.snapEngine.inSnapZone(snap)) {
        // 吸附：整组贴到牙面，姿态跟随牙面标架，手柄方向同步旋转
        const actualDelta = v3.sub(snap.position, primary.position);
        for (const id of ids) {
          const s = this.getSleeve(id)!;
          if (id === primaryId) {
            this.applySnap(s, snap);
          } else {
            s.position = v3.add(s.position, actualDelta);
            s.quaternion = q.clone(snap.quaternion);
            s.snapped = true;
            const f = this.arch.closestPoint(s.position);
            s.snapU = f.u;
            s.snapV = f.v;
          }
          this.sleeveRenderer.sync(s);
        }
        drag.snapped = true;
        this.events.onStatus?.('已吸附牙槽嵴（手柄跟随牙面方向）');
      } else {
        // 自由移动
        for (const id of ids) {
          const s = this.getSleeve(id)!;
          s.position = v3.add(s.position, info.delta);
          s.snapped = false;
          s.snapU = null;
          s.snapV = null;
          this.sleeveRenderer.sync(s);
        }
        drag.snapped = false;
        this.events.onStatus?.(this.snapEngine.inBounceZone(snap)
          ? '接近牙面（松手将弹回吸附位）'
          : '自由移动中');
      }
      this.updateGizmoFromSelection();
    }
  }

  private endSleeveDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    const ids = [...drag.movingIds];
    const primaryId = this.selection.first() ?? ids[0];
    const primary = this.getSleeve(primaryId)!;

    // 弹回判定：未吸附但在弹回半径内 → 回到最近吸附位；超出则回到拖动前
    if (this.gizmo.getMode() === 'translate' && !primary.snapped) {
      const snap = this.snapEngine.evaluate(primary.position);
      if (this.snapEngine.inBounceZone(snap)) {
        const actualDelta = v3.sub(snap.position, primary.position);
        for (const id of ids) {
          const s = this.getSleeve(id)!;
          if (id === primaryId) this.applySnap(s, snap);
          else {
            s.position = v3.add(s.position, actualDelta);
            const f = this.arch.closestPoint(s.position);
            s.snapped = true;
            s.snapU = f.u;
            s.snapV = f.v;
            s.quaternion = q.clone(snap.quaternion);
          }
          this.sleeveRenderer.sync(s);
        }
      } else {
        this.restoreSnapshot(drag.before);
      }
    }

    // 碰撞避让（框选组平移场景）
    if (ids.length >= 1 && this.gizmo.getMode() === 'translate') {
      const result = resolveCollisions(this.arch, drag.movingIds, this.sleeves);
      if (result.pushedIds.length > 0) {
        this.sleeves = result.sleeves;
        for (const s of this.sleeves) this.sleeveRenderer.sync(s);
        this.events.onStatus?.(`碰撞避让：${result.pushedIds.length} 个相邻套管自动让开`);
      }
    }

    this.history.push(
      drag.kind === 'group' ? '组平移/旋转就位' : '套管移动就位',
      drag.before,
      takeSnapshot(this.sleeves, this.clip),
    );
    this.drag = null;
    this.updateGizmoFromSelection();
    this.emitSnapStatus();
  }

  private applySnap(s: SleeveState, snap: ReturnType<SnapEngine['evaluate']>): void {
    const next = this.snapEngine.apply(s, snap);
    s.position = next.position;
    s.quaternion = next.quaternion;
    s.snapped = next.snapped;
    s.snapU = next.snapU;
    s.snapV = next.snapV;
  }

  // ---------------- 剖切 ----------------

  private hitClipHandle(ray: Ray): boolean {
    const handle = this.clipGizmo.handleRay();
    const origin: Vec3Tuple = [handle.origin.x, handle.origin.y, handle.origin.z];
    const ab: Vec3Tuple = [handle.dir.x, handle.dir.y, handle.dir.z];
    // 射线到手柄轴线（过 origin、方向 ab）的最近距离
    const w = v3.cross(ray.dir, ab);
    const wLen = v3.len(w);
    if (wLen < 1e-6) return v3.dist(ray.origin, origin) < 2.5;
    const dist = Math.abs(v3.dot(v3.sub(ray.origin, origin), v3.scale(w, 1 / wLen)));
    return dist < 2.5;
  }

  private dragClip(ray: Ray): void {
    // 剖切轴是过原点、方向为 normal 的有向直线：
    // 取射线上距该轴最近的点，投影到 normal 上即新的平面 distance。
    const n = v3.normalize(this.clip.normal);
    const denom = 1 - v3.dot(ray.dir, n) ** 2;
    if (denom < 1e-6) return;
    const t = -v3.dot(v3.sub(ray.origin, v3.scale(n, v3.dot(ray.origin, n))), ray.dir) / denom;
    const closest = v3.add(ray.origin, v3.scale(ray.dir, Math.max(0, t)));
    this.clipGizmo.setDistance(v3.dot(closest, n));
    this.events.onClipChange?.({ ...this.clip });
  }

  private endClipDrag(): void {
    const drag = this.drag!;
    this.history.push('剖切推拉', drag.before, takeSnapshot(this.sleeves, this.clip));
    this.drag = null;
  }

  private commitClipOnly(): void {
    const before = takeSnapshot(this.sleeves, this.clip);
    this.history.push('剖切开关/朝向', before, takeSnapshot(this.sleeves, this.clip));
  }

  // ---------------- 对外命令（工具栏调用） ----------------

  setClipEnabled(on: boolean): void {
    const before = takeSnapshot(this.sleeves, this.clip);
    this.clipGizmo.setEnabled(on);
    this.history.push(on ? '开启剖切' : '关闭剖切', before, takeSnapshot(this.sleeves, this.clip));
    this.events.onClipChange?.({ ...this.clip });
  }

  setClipPreset(preset: ClipPreset): void {
    const before = takeSnapshot(this.sleeves, this.clip);
    this.clipGizmo.setPreset(preset);
    this.history.push('剖切朝向', before, takeSnapshot(this.sleeves, this.clip));
    this.events.onClipChange?.({ ...this.clip });
  }

  nudgeClip(delta: number): void {
    const before = takeSnapshot(this.sleeves, this.clip);
    this.clipGizmo.setDistance(this.clipGizmo.getDistance() + delta);
    this.history.push('剖切微调', before, takeSnapshot(this.sleeves, this.clip));
    this.events.onClipChange?.({ ...this.clip });
  }

  /** 直接设置剖切距离（不入撤销栈，供程序化控制/测试） */
  setClipDistance(distance: number): void {
    this.clipGizmo.setDistance(distance);
    this.events.onClipChange?.({ ...this.clip });
  }

  setGizmoMode(mode: 'translate' | 'rotate'): void {
    this.gizmo.setMode(mode);
  }

  clearSelection(): void {
    this.selection.clear();
    this.refreshSelection();
  }

  get selectedIds(): readonly number[] {
    return this.selection.ids;
  }

  get sleeveCount(): number {
    return this.sleeves.length;
  }

  /** 套管中心的 CSS 像素屏幕坐标（供自动化测试/标注覆盖层使用） */
  sleeveScreenPosition(id: number): { x: number; y: number } | null {
    const entity = this.sleeveRenderer.getEntity(id);
    if (!entity) return null;
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    // CameraComponent 版返回设备物理像素，按 drawingBuffer/CSS 比例换算
    const screen = this.cameraEntity.camera!.worldToScreen(entity.getPosition());
    const scaleX = canvas.clientWidth / canvas.width;
    const scaleY = canvas.clientHeight / canvas.height;
    return { x: screen.x * scaleX, y: screen.y * scaleY };
  }

  /**
   * 测试接缝：以与真实指针完全相同的屏幕射线驱动一次选中套管的拖拽，
   * 走 Gizmo 命中 → beginDrag → dragSleeve（吸附/自由）→ endSleeveDrag（弹回/碰撞/入栈）全链路。
   */
  testDragSelectedByScreen(points: Array<{ x: number; y: number }>): {
    id: number;
    position: Vec3Tuple;
    snapped: boolean;
  } | null {
    if (points.length < 2 || this.selection.size === 0) return null;
    const firstRay = this.screenRayAt(points[0].x, points[0].y);
    const handle = this.gizmo.hitTest(firstRay);
    if (!handle || !this.gizmo.beginDrag(handle, firstRay)) return null;
    this.beginSleeveDrag(handle, false);
    for (let i = 1; i < points.length; i++) {
      this.dragSleeve(this.screenRayAt(points[i].x, points[i].y));
    }
    this.endSleeveDrag();
    const id = this.selection.first()!;
    const s = this.getSleeve(id)!;
    return { id, position: [...s.position], snapped: s.snapped };
  }

  /** 测试接缝：旋转拖拽（旋转环模式，沿屏幕点序列产生极角增量） */
  testRotateSelectedByScreen(points: Array<{ x: number; y: number }>): QuatTuple | null {
    if (points.length < 2 || this.selection.size === 0) return null;
    this.gizmo.setMode('rotate');
    const firstRay = this.screenRayAt(points[0].x, points[0].y);
    const handle = this.gizmo.hitTest(firstRay);
    if (!handle || !this.gizmo.beginDrag(handle, firstRay)) return null;
    this.beginSleeveDrag(handle, false);
    for (let i = 1; i < points.length; i++) {
      this.dragSleeve(this.screenRayAt(points[i].x, points[i].y));
    }
    this.endSleeveDrag();
    const id = this.selection.first()!;
    return q.clone(this.getSleeve(id)!.quaternion);
  }

  private screenRayAt(x: number, y: number): Ray {
    const r = this.orbit.screenRay(x, y);
    return { origin: r.origin, dir: r.dir };
  }

  /** 测试接缝：读取某套管当前领域状态 */
  testSleeveState(id: number): SleeveState | null {
    const s = this.getSleeve(id);
    return s ? { ...s } : null;
  }

  /** 测试接缝：撤销栈深度 */
  get testHistoryDepth(): number {
    return this.history.depth;
  }

  /** 测试接缝：把指定套管移到牙弓外并解除吸附（模拟自由拖拽脱离） */
  testDetachSleeve(id: number, farPosition: Vec3Tuple): void {
    const s = this.getSleeve(id);
    if (!s) return;
    s.position = [...farPosition];
    s.snapped = false;
    s.snapU = null;
    s.snapV = null;
    this.sleeveRenderer.sync(s);
  }

  /** 测试接缝：读取各套管沿牙弓的弧长坐标（等距分布的准确判据） */
  testArcCoordinates(ids: number[]): number[] {
    return ids.map((id) => {
      const s = this.getSleeve(id)!;
      const f = this.arch.closestPoint(s.position);
      const N = 2000;
      let len = 0;
      let prev = this.arch.center(-1);
      for (let i = 1; i <= N; i++) {
        const u = -1 + (2 * i) / N;
        const p = this.arch.center(u);
        if (u <= f.u) len += v3.dist(prev, p);
        prev = p;
      }
      return len;
    });
  }

  /** 测试接缝：返回屏幕点射线命中的手柄（null 表示未命中） */
  testGizmoHandleAt(x: number, y: number): { mode: string; axis: string } | null {
    if (!this.gizmo.visible) return null;
    const h = this.gizmo.hitTest(this.screenRayAt(x, y));
    return h ? { mode: h.mode, axis: h.axis } : null;
  }

  /** 测试接缝：当前模式下可见的手柄 MI 数量（验证平移/旋转互斥显隐） */
  testGizmoVisibleMeshCount(): number {
    return this.gizmo.visibleMeshCount();
  }

  alignSelected(): void {
    const ordered = this.selection.ids
      .map((id) => this.getSleeve(id))
      .filter((s): s is SleeveState => s !== null);
    if (ordered.length < 2) {
      this.events.onStatus?.('至少选择两颗套管才能对齐');
      return;
    }
    const before = takeSnapshot(this.sleeves, this.clip);
    const aligned = alignSleeves(this.arch, ordered);
    for (const next of aligned) {
      const s = this.getSleeve(next.id)!;
      Object.assign(s, next);
      this.sleeveRenderer.sync(s);
    }
    this.history.push('对齐与等间距分布', before, takeSnapshot(this.sleeves, this.clip));
    this.updateGizmoFromSelection();
    this.emitSnapStatus();
    this.events.onStatus?.(`已按首颗方向对齐 ${aligned.length} 颗套管，弧长间距一致`);
  }

  undo(): void {
    const snap = this.history.undo();
    if (!snap) return;
    this.restoreSnapshot(snap);
    this.events.onStatus?.('已撤销上一步');
  }

  redo(): void {
    const snap = this.history.redo();
    if (!snap) return;
    this.restoreSnapshot(snap);
  }

  frameSelection(): void {
    const ids = this.selection.ids;
    if (ids.length === 0) {
      this.orbit.frame(new pc.Vec3(0, 2, -8), 150);
      return;
    }
    const c = this.selectionCenter();
    this.orbit.frame(new pc.Vec3(c[0], c[1], c[2]), 70);
  }

  private restoreSnapshot(snap: SceneSnapshot): void {
    // 以快照为准重建领域状态
    this.sleeves = snap.sleeves.map((s) => ({
      ...s,
      position: [...s.position] as Vec3Tuple,
      quaternion: [...s.quaternion] as QuatTuple,
    }));
    this.clip = {
      enabled: snap.clip.enabled,
      normal: [...snap.clip.normal] as Vec3Tuple,
      distance: snap.clip.distance,
    };
    this.clipGizmo.setEnabled(this.clip.enabled);
    this.clipGizmo.setDistance(this.clip.distance);
    this.sleeveRenderer.syncAll(this.sleeves);
    this.selection.replace(this.sleeves.filter((s) => this.selection.has(s.id)).map((s) => s.id));
    this.refreshSelection();
    this.events.onClipChange?.({ ...this.clip });
    this.emitSnapStatus();
  }

  // ---------------- 帧循环 ----------------

  private frame(): void {
    if (this.destroyed) return;
    this.orbit.update();
    this.clipGizmo.pushUniforms(this.clipSync);
    this.pushLightUniforms();
    const camPos = this.orbit.position;
    this.app.graphicsDevice.scope.resolve('uCameraPos').setValue([camPos.x, camPos.y, camPos.z]);
  }

  // ---------------- 工具 ----------------

  private getSleeve(id: number): SleeveState | undefined {
    return this.sleeves.find((s) => s.id === id);
  }

  private selectionCenter(): Vec3Tuple {
    const ids = [...this.selection.ids];
    if (ids.length === 0) return [0, 0, 0];
    const acc: Vec3Tuple = [0, 0, 0];
    for (const id of ids) {
      const p = this.getSleeve(id)!.position;
      acc[0] += p[0];
      acc[1] += p[1];
      acc[2] += p[2];
    }
    return [acc[0] / ids.length, acc[1] / ids.length, acc[2] / ids.length];
  }

  private updateGizmoFromSelection(): void {
    const ids = [...this.selection.ids];
    if (ids.length === 0) this.gizmo.hide();
    else if (ids.length === 1) {
      const s = this.getSleeve(ids[0])!;
      this.gizmo.show(s.position, s.quaternion, 1);
    } else {
      this.gizmo.show(this.selectionCenter(), q.identity(), 1);
    }
  }

  private marqueeRect(): { x: number; y: number; w: number; h: number } {
    const m = this.marquee!;
    return {
      x: Math.min(m.x0, m.x1),
      y: Math.min(m.y0, m.y1),
      w: Math.abs(m.x1 - m.x0),
      h: Math.abs(m.y1 - m.y0),
    };
  }

  private emitHistory(): void {
    this.events.onHistoryChange?.(this.history.canUndo, this.history.canRedo, this.history.labels());
  }

  private emitSnapStatus(): void {
    this.events.onSnapChange?.(this.sleeves.filter((s) => s.snapped).length);
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.picker.release();
    this.sleeveRenderer.destroyAll();
    this.app.destroy();
  }
}

// 类型导出供组件层使用
export type { ClipPreset };
export { SLEEVE_COLLISION_R, SLEEVE_HEIGHT };
