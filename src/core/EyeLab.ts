import * as BABYLON from 'babylonjs';
import { HistoryStack } from './history';
import { EYE, createEyeModel, defaultLensTransform, type EyeModel } from './model';
import {
  circumcircle3,
  clamp,
  cloneState,
  distance,
  ellipsoidPlanePolygon,
  ellipsoidSupportRadius,
  formatMm,
  lensBasis as lensBasisFromState,
  rayAxisParameter,
  rayPlane,
  resolveAnchor,
  uid,
  type RayLike,
} from './math';
import type {
  HintMessage,
  LabState,
  Measurement,
  MeasurePoint,
  SelectionId,
  ToolId,
  TransformMode,
  Vec3,
} from './types';

export interface EyeLabEvents {
  onStateChange?: (state: LabState, info: UiInfo) => void;
  onHint?: (hint: HintMessage) => void;
  onSelectionChange?: (selection: SelectionId) => void;
}

export interface UiInfo {
  tool: ToolId;
  transformMode: TransformMode;
  selection: SelectionId;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

interface ClipDragState {
  mode: 'offset' | 'yaw';
  before: LabState;
  startX: number;
  startYaw: number;
}

interface PointDragState {
  measurementId: string;
  index: number;
  before: LabState;
}

const MAX_YAW_DRIFT = (14 * Math.PI) / 180;
const SNAP_PX = 24;

export class EyeLab {
  readonly canvas: HTMLCanvasElement;
  readonly engine: BABYLON.Engine;
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  readonly model: EyeModel;
  readonly history: HistoryStack;
  readonly gizmoManager: BABYLON.GizmoManager;

  state: LabState;
  tool: ToolId = 'select';
  transformMode: TransformMode = 'position';
  selection: SelectionId = 'lens';

  private events: EyeLabEvents;
  private highlight: BABYLON.HighlightLayer;
  private corneaBoxGizmo: BABYLON.BoundingBoxGizmo;
  private clipPlaneMesh!: BABYLON.Mesh;
  private clipOffsetHandle!: BABYLON.Mesh;
  private clipYawHandle!: BABYLON.Mesh;
  private lensSectionMesh!: BABYLON.Mesh;
  private lensOutline: BABYLON.LinesMesh | null = null;
  private clipDrag: ClipDragState | null = null;
  private pointDrag: PointDragState | null = null;
  private pointerDownAt: { x: number; y: number; time: number } | null = null;
  private lastBlockedHint = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, events: EyeLabEvents = {}) {
    this.canvas = canvas;
    this.events = events;

    this.engine = new BABYLON.Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true }, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.025, 0.045, 0.085, 1);

    this.camera = new BABYLON.ArcRotateCamera(
      'main-camera',
      Math.PI / 4.2,
      Math.PI / 3.05,
      39,
      new BABYLON.Vector3(0, 0.5, 2.4),
      this.scene,
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 18;
    this.camera.upperRadiusLimit = 78;
    this.camera.wheelDeltaPercentage = 0.012;
    this.camera.pinchDeltaPercentage = 0.012;
    this.camera.upperBetaLimit = Math.PI * 0.86;
    this.camera.lowerBetaLimit = 0.12;

    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0.2, 1, 0.4), this.scene);
    hemi.intensity = 0.9;
    hemi.groundColor = new BABYLON.Color3(0.12, 0.16, 0.28);
    const key = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.45, -0.75, -0.55), this.scene);
    key.position = new BABYLON.Vector3(18, 28, 24);
    key.intensity = 1.25;
    const rim = new BABYLON.PointLight('rim', new BABYLON.Vector3(-16, 8, -12), this.scene);
    rim.intensity = 0.8;
    rim.diffuse = new BABYLON.Color3(0.35, 0.65, 1);

    this.model = createEyeModel(this.scene);

    this.state = {
      lens: defaultLensTransform(),
      clip: {
        offset: 0,
        yaw: Math.PI / 2,
        snap: true,
        snappedKey: '视轴中心',
        angleSnapped: true,
        enabled: true,
      },
      microVisible: true,
      measurements: [],
    };
    this.syncLensBasis();

    this.history = new HistoryStack((next) => this.applyState(next));

    this.highlight = new BABYLON.HighlightLayer('selection-highlight', this.scene, { blurHorizontalSize: 1.2, blurVerticalSize: 1.2 });

    this.gizmoManager = new BABYLON.GizmoManager(this.scene);
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;
    this.gizmoManager.scaleRatio = 1.15;
    this.configureTransformGizmos();

    this.corneaBoxGizmo = new BABYLON.BoundingBoxGizmo(new BABYLON.Color3(0.72, 0.62, 1), this.gizmoManager.utilityLayer);
    this.corneaBoxGizmo.setEnabledScaling(false);
    this.corneaBoxGizmo.setEnabledRotationAxis('');
    this.corneaBoxGizmo.attachedMesh = null;

    this.createClipRig();
    this.applyState(cloneState(this.state));
    this.select('lens', false);

    this.scene.onPointerObservable.add((info) => this.handlePointerObservable(info));

    this.resizeObserver = new ResizeObserver(() => this.engine.resize());
    this.resizeObserver.observe(canvas);
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    window.addEventListener('resize', this.handleWindowResize);

    this.engine.runRenderLoop(() => {
      if (!this.disposed) this.scene.render();
    });
  }

  // ---------------------------------------------------------------------------
  // Public state / UI
  // ---------------------------------------------------------------------------

  getUiInfo(): UiInfo {
    return {
      tool: this.tool,
      transformMode: this.transformMode,
      selection: this.selection,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
    };
  }

  private stateListeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  emitState(): void {
    this.events.onStateChange?.(this.state, this.getUiInfo());
    this.stateListeners.forEach((listener) => listener());
  }

  hint(text: string, tone: HintMessage['tone'] = 'info'): void {
    this.events.onHint?.({ text, tone });
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    if (tool !== 'select') {
      this.gizmoManager.attachToMesh(null);
      this.corneaBoxGizmo.attachedMesh = null;
    } else {
      this.refreshSelectionGizmo();
    }
    this.updateClipRig();
    this.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    this.emitState();
  }

  setTransformMode(mode: TransformMode): void {
    this.transformMode = mode;
    if (this.selection !== 'lens') this.select('lens', true);
    this.refreshTransformGizmoModes();
    this.emitState();
  }

  select(selection: SelectionId, notify = true): void {
    this.selection = selection;
    this.highlight.removeAllMeshes();
    if (selection === 'lens') {
      this.highlight.addMesh(this.model.lens, BABYLON.Color3.FromHexString('#38e8ff'));
    } else if (selection === 'cornea') {
      this.highlight.addMesh(this.model.cornea, BABYLON.Color3.FromHexString('#b794ff'));
    }
    this.refreshSelectionGizmo();
    if (notify) {
      this.events.onSelectionChange?.(selection);
      this.emitState();
    }
  }

  undo(): void {
    const cmd = this.history.undo();
    if (cmd) this.hint(`已撤销：${cmd.label}`, 'info');
  }

  redo(): void {
    const cmd = this.history.redo();
    if (cmd) this.hint(`已重做：${cmd.label}`, 'success');
  }

  setMicroVisible(visible: boolean): void {
    this.state.microVisible = visible;
    this.model.micro.setEnabled(visible);
    this.model.micro.isPickable = visible;
    this.hint(visible ? `已显示 ${EYE.microCount.toLocaleString()} 个解剖微结构` : '微结构已整体关闭，拾取已排除该层', visible ? 'info' : 'success');
    this.emitState();
  }

  toggleClipSnap(): void {
    const before = cloneState(this.state);
    this.state.clip.snap = !this.state.clip.snap;
    if (!this.state.clip.snap) {
      this.state.clip.snappedKey = null;
      this.state.clip.angleSnapped = false;
    }
    const after = cloneState(this.state);
    this.history.commit(this.state.clip.snap ? '开启吸附' : '切换自由模式', before, after);
    this.updateClipRig();
    this.hint(this.state.clip.snap ? '吸附模式：关键解剖位置会磁吸' : '自由模式：可自由拖动（主轴偏转角仍受限）', this.state.clip.snap ? 'success' : 'warning');
    this.emitState();
  }

  setClipEnabled(enabled: boolean): void {
    const before = cloneState(this.state);
    this.state.clip.enabled = enabled;
    const after = cloneState(this.state);
    this.history.commit(enabled ? '启用剖切' : '关闭剖切', before, after);
    this.updateClipRig();
    this.hint(enabled ? '剖切面已启用' : '剖切面已关闭', 'info');
    this.emitState();
  }

  resetView(): void {
    this.camera.alpha = Math.PI / 4.2;
    this.camera.beta = Math.PI / 3.05;
    this.camera.radius = 39;
    this.camera.target = new BABYLON.Vector3(0, 0.5, 2.4);
    this.hint('视角已复位', 'info');
  }

  deleteMeasurement(id: string): void {
    this.history.execute('删除测量', this.state, (draft) => {
      draft.measurements = draft.measurements.filter((m) => m.id !== id);
    });
    this.emitState();
  }

  clearMeasurements(): void {
    if (!this.state.measurements.length) return;
    this.history.execute('清空测量', this.state, (draft) => {
      draft.measurements = [];
    });
    this.emitState();
  }

  startCurvatureFromSelection(): void {
    this.setTool('curvature');
    this.select('cornea', false);
    this.hint('在紫色角膜上依次点取 3 点，点后可直接拖回重放', 'info');
  }

  getSelectionAnchor(): Vec3 {
    if (this.selection === 'cornea') {
      this.model.cornea.refreshBoundingInfo();
      const max = this.model.cornea.getBoundingInfo().boundingBox.maximumWorld;
      const min = this.model.cornea.getBoundingInfo().boundingBox.minimumWorld;
      return [(max.x + min.x) / 2, max.y + 0.9, (max.z + min.z) / 2];
    }
    this.model.lens.refreshBoundingInfo();
    const box = this.model.lens.getBoundingInfo().boundingBox;
    const center = box.centerWorld;
    return [center.x, box.maximumWorld.y + 1.1, center.z];
  }

  project(v: Vec3): { x: number; y: number; visible: boolean } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return { x: -9999, y: -9999, visible: false };
    const p = BABYLON.Vector3.Project(
      new BABYLON.Vector3(v[0], v[1], v[2]),
      BABYLON.Matrix.Identity(),
      this.scene.getTransformMatrix(),
      new BABYLON.Viewport(0, 0, rect.width, rect.height),
    );
    const to = new BABYLON.Vector3(v[0] - this.camera.position.x, v[1] - this.camera.position.y, v[2] - this.camera.position.z);
    const visible = BABYLON.Vector3.Dot(to, this.camera.getForwardRay().direction) > 0 && p.z >= 0 && p.z <= 1.05;
    return { x: p.x, y: p.y, visible };
  }

  // ---------------------------------------------------------------------------
  // State application
  // ---------------------------------------------------------------------------

  private applyState(next: LabState): void {
    // Visibility toggles are viewport preferences, not anatomical edit history.
    next.microVisible = this.state?.microVisible ?? next.microVisible;
    this.state = next;

    const l = this.model.lens;
    l.position.set(...next.lens.position);
    l.rotation.set(...next.lens.rotation);
    l.scaling.set(...next.lens.scaling);
    l.computeWorldMatrix(true);
    this.syncLensBasis();

    this.model.micro.setEnabled(next.microVisible);
    this.model.micro.isPickable = next.microVisible;

    this.updateClipRig();
    this.updateSection();
    this.refreshSelectionGizmo();
    this.emitState();
  }

  private syncLensBasis(): void {
    const m = this.model.lens.getWorldMatrix();
    const right = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Right(), m).normalize();
    const up = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Up(), m).normalize();
    const forward = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Forward(), m).normalize();
    this.state.lensBasis = [right.asArray() as Vec3, up.asArray() as Vec3, forward.asArray() as Vec3];
  }

  // ---------------------------------------------------------------------------
  // Transform gizmos and lens-cornea snap
  // ---------------------------------------------------------------------------

  private configureTransformGizmos(): void {
    this.gizmoManager.positionGizmoEnabled = true;
    const position = this.gizmoManager.gizmos.positionGizmo;
    position?.onDragStartObservable.add(() => this.beginLensTransformDrag('平移晶状体'));
    position?.onDragObservable.add(() => {
      this.applyLensCorneaSnap();
      this.syncLensFromMesh();
    });
    position?.onDragEndObservable.add(() => this.endLensTransformDrag('平移晶状体'));

    this.gizmoManager.rotationGizmoEnabled = true;
    const rotation = this.gizmoManager.gizmos.rotationGizmo;
    rotation?.onDragStartObservable.add(() => this.beginLensTransformDrag('旋转晶状体'));
    rotation?.onDragObservable.add(() => this.syncLensFromMesh());
    rotation?.onDragEndObservable.add(() => this.endLensTransformDrag('旋转晶状体'));

    this.gizmoManager.scaleGizmoEnabled = true;
    const scale = this.gizmoManager.gizmos.scaleGizmo;
    scale?.onDragStartObservable.add(() => this.beginLensTransformDrag('缩放晶状体'));
    scale?.onDragObservable.add(() => this.syncLensFromMesh());
    scale?.onDragEndObservable.add(() => this.endLensTransformDrag('缩放晶状体'));

    this.refreshTransformGizmoModes();
  }

  private dragBefore: LabState | null = null;

  private beginLensTransformDrag(label: string): void {
    this.dragBefore = cloneState(this.state);
    this.canvas.style.cursor = 'grabbing';
    this.hint(label, 'info');
  }

  private syncLensFromMesh(): void {
    const l = this.model.lens;
    this.state.lens.position = l.position.asArray() as Vec3;
    this.state.lens.rotation = l.rotation.asArray() as Vec3;
    this.state.lens.scaling = l.scaling.asArray() as Vec3;
    this.syncLensBasis();
    this.updateSection();
  }

  private endLensTransformDrag(label: string): void {
    if (!this.dragBefore) return;
    this.syncLensFromMesh();
    const after = cloneState(this.state);
    const before = this.dragBefore;
    this.dragBefore = null;
    this.canvas.style.cursor = 'default';
    if (JSON.stringify(before.lens) !== JSON.stringify(after.lens)) {
      this.history.commit(label, before, after);
      if (after.lens.snappedToCornea) this.hint('晶状体已吸附到角膜后表面', 'success');
    }
    this.emitState();
  }

  private applyLensCorneaSnap(): void {
    // Lens-to-cornea magnetism is an editing aid in its own right; Shift gives
    // temporary free placement even when clipping snap mode is enabled.
    if (this.isShiftPressed()) return;

    this.syncLensBasis();
    const nVec = this.model.lens.position.subtract(EYE.corneaCenter);
    const centerDistance = nVec.length();
    if (centerDistance < 1e-6) return;
    const n = nVec.scale(1 / centerDistance);
    // The corneal cap is anterior; only magnetize from that side.
    if (n.z < 0.18) {
      this.state.lens.snappedToCornea = false;
      return;
    }

    const basis = this.state.lensBasis ?? lensBasisFromState(this.state);
    const support = ellipsoidSupportRadius(
      {
        center: this.state.lens.position,
        radii: [
          EYE.lensRadii.x * this.model.lens.scaling.x,
          EYE.lensRadii.y * this.model.lens.scaling.y,
          EYE.lensRadii.z * this.model.lens.scaling.z,
        ],
        basis,
      },
      n.asArray() as Vec3,
    );

    // The lens is inside the large corneal curvature sphere, so internal
    // tangency is R_cornea = centerDistance + lensSupportRadius.
    const gap = EYE.corneaInnerRadius - centerDistance - support;
    if (gap <= 1.55 && gap >= -2.2) {
      const targetDistance = Math.max(0.25, EYE.corneaInnerRadius - support);
      const snapped = EYE.corneaCenter.add(n.scale(targetDistance));
      this.model.lens.position.copyFrom(snapped);
      this.state.lens.snappedToCornea = true;
      this.hint('靠近角膜：已自动吸附到角膜后表面（按住 Shift 可临时自由）', 'success');
    } else {
      this.state.lens.snappedToCornea = false;
    }
  }

  private shiftPressed = false;
  private isShiftPressed(): boolean {
    return this.shiftPressed;
  }
  setShiftPressed(value: boolean): void {
    this.shiftPressed = value;
  }

  private refreshTransformGizmoModes(): void {
    const attachedToLens = this.selection === 'lens' && this.tool === 'select';
    this.gizmoManager.positionGizmoEnabled = attachedToLens && this.transformMode === 'position';
    this.gizmoManager.rotationGizmoEnabled = attachedToLens && this.transformMode === 'rotation';
    this.gizmoManager.scaleGizmoEnabled = attachedToLens && this.transformMode === 'scaling';
    if (attachedToLens) this.gizmoManager.attachToMesh(this.model.lens);
  }

  private refreshSelectionGizmo(): void {
    const lensActive = this.selection === 'lens' && this.tool === 'select';
    if (lensActive) {
      this.refreshTransformGizmoModes();
      this.corneaBoxGizmo.attachedMesh = null;
    } else {
      this.gizmoManager.attachToMesh(null);
      if (this.selection === 'cornea' && this.tool === 'select') {
        this.corneaBoxGizmo.attachedMesh = this.model.cornea;
      } else {
        this.corneaBoxGizmo.attachedMesh = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Clipping rig
  // ---------------------------------------------------------------------------

  clipNormal(state: LabState = this.state): Vec3 {
    return [Math.sin(state.clip.yaw), 0, Math.cos(state.clip.yaw)];
  }

  private createClipRig(): void {
    this.clipPlaneMesh = BABYLON.MeshBuilder.CreatePlane(
      'clip-plane-interaction',
      { width: 31, height: 31, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
      this.scene,
    );
    const planeMat = new BABYLON.StandardMaterial('clip-plane-mat', this.scene);
    planeMat.diffuseColor = new BABYLON.Color3(0.1, 0.75, 1);
    planeMat.emissiveColor = new BABYLON.Color3(0.04, 0.28, 0.42);
    planeMat.alpha = 0.1;
    planeMat.backFaceCulling = false;
    planeMat.disableDepthWrite = true;
    this.clipPlaneMesh.material = planeMat;
    this.clipPlaneMesh.metadata = { clipHandle: 'surface' };
    this.clipPlaneMesh.isPickable = false;

    const borderPoints = [
      new BABYLON.Vector3(-15.5, -15.5, 0.02),
      new BABYLON.Vector3(15.5, -15.5, 0.02),
      new BABYLON.Vector3(15.5, 15.5, 0.02),
      new BABYLON.Vector3(-15.5, 15.5, 0.02),
      new BABYLON.Vector3(-15.5, -15.5, 0.02),
    ];
    const border = BABYLON.MeshBuilder.CreateLines('clip-plane-border', { points: borderPoints }, this.scene);
    border.color = new BABYLON.Color3(0.25, 0.9, 1);
    border.alpha = 0.8;
    border.parent = this.clipPlaneMesh;
    border.isPickable = false;

    this.clipOffsetHandle = BABYLON.MeshBuilder.CreateSphere('clip-offset-handle', { diameter: 1.05, segments: 24 }, this.scene);
    const offsetMat = new BABYLON.StandardMaterial('clip-offset-mat', this.scene);
    offsetMat.diffuseColor = new BABYLON.Color3(0.1, 0.9, 1);
    offsetMat.emissiveColor = new BABYLON.Color3(0.05, 0.45, 0.55);
    this.clipOffsetHandle.material = offsetMat;
    this.clipOffsetHandle.metadata = { clipHandle: 'offset' };

    this.clipYawHandle = BABYLON.MeshBuilder.CreateSphere('clip-yaw-handle', { diameter: 0.82, segments: 24 }, this.scene);
    const yawMat = new BABYLON.StandardMaterial('clip-yaw-mat', this.scene);
    yawMat.diffuseColor = new BABYLON.Color3(1, 0.62, 0.16);
    yawMat.emissiveColor = new BABYLON.Color3(0.45, 0.2, 0.02);
    this.clipYawHandle.material = yawMat;
    this.clipYawHandle.metadata = { clipHandle: 'yaw' };

    this.lensSectionMesh = new BABYLON.Mesh('lens-section-fill', this.scene);
    const sectionMat = new BABYLON.StandardMaterial('lens-section-mat', this.scene);
    sectionMat.diffuseColor = new BABYLON.Color3(1, 0.72, 0.24);
    sectionMat.emissiveColor = new BABYLON.Color3(0.42, 0.2, 0.03);
    sectionMat.alpha = 0.48;
    sectionMat.backFaceCulling = false;
    sectionMat.disableDepthWrite = true;
    this.lensSectionMesh.material = sectionMat;
    this.lensSectionMesh.isPickable = false;
  }

  private updateClipRig(): void {
    const clip = this.state.clip;
    const nArr = this.clipNormal();
    const n = new BABYLON.Vector3(...nArr);
    const plane = clip.enabled ? new BABYLON.Plane(n.x, n.y, n.z, -clip.offset) : null;
    this.model.clipMaterials.forEach((material) => {
      (material as BABYLON.StandardMaterial).clipPlane = plane;
    });

    this.clipPlaneMesh.setEnabled(clip.enabled);
    this.clipPlaneMesh.position.copyFrom(n.scale(clip.offset));
    this.clipPlaneMesh.rotation.set(0, clip.yaw, 0);
    this.clipPlaneMesh.isPickable = this.tool === 'clip' && clip.enabled;

    this.clipOffsetHandle.setEnabled(clip.enabled && this.tool === 'clip');
    this.clipYawHandle.setEnabled(clip.enabled && this.tool === 'clip');
    this.clipOffsetHandle.isPickable = this.tool === 'clip';
    this.clipYawHandle.isPickable = this.tool === 'clip';

    const top = new BABYLON.Vector3(0, 12.7, 0);
    this.clipOffsetHandle.position.copyFrom(n.scale(clip.offset + 1.1).add(top));
    this.clipYawHandle.position.copyFrom(n.scale(clip.offset).add(new BABYLON.Vector3(0, 14.4, 0)));
  }

  private clipLandmarks(): Array<{ value: number; key: string; label: string }> {
    const n = this.clipNormal();
    const lensCenterProjection =
      n[0] * this.state.lens.position[0] + n[1] * this.state.lens.position[1] + n[2] * this.state.lens.position[2];
    const basis = this.state.lensBasis ?? lensBasisFromState(this.state);
    const support = ellipsoidSupportRadius(
      {
        center: this.state.lens.position,
        radii: [
          EYE.lensRadii.x * this.state.lens.scaling[0],
          EYE.lensRadii.y * this.state.lens.scaling[1],
          EYE.lensRadii.z * this.state.lens.scaling[2],
        ],
        basis,
      },
      n,
    );
    return [
      { value: 0, key: 'axis', label: '视轴中心标准纵切面' },
      { value: lensCenterProjection, key: 'lens-center', label: '晶状体中心切面' },
      { value: lensCenterProjection + support, key: 'lens-edge', label: '晶状体外侧切线' },
      { value: lensCenterProjection - support, key: 'lens-edge-opposite', label: '晶状体对侧切线' },
      { value: 4.6 * this.state.lens.scaling[0], key: 'lens-equator', label: '晶状体赤道' },
      { value: -4.6 * this.state.lens.scaling[0], key: 'lens-equator-opposite', label: '对侧晶状体赤道' },
      { value: 7.2, key: 'limbus', label: '角膜缘关键断面' },
      { value: -7.2, key: 'limbus-opposite', label: '对侧角膜缘' },
      { value: 11.6, key: 'globe-wall', label: '巩膜/脉络膜外壁' },
    ];
  }

  private updateClipFromPointer(event: PointerEvent): void {
    if (!this.clipDrag) return;
    const ray = this.rayFromClient(event.clientX, event.clientY);
    if (!ray) return;
    // Offset uses the current normal; yaw changes are based on pointer delta.
    const n = this.clipNormal();

    if (this.clipDrag.mode === 'offset') {
      const rayLike: RayLike = { origin: ray.origin.asArray() as Vec3, direction: ray.direction.asArray() as Vec3 };
      let offset = clamp(rayAxisParameter(rayLike, [0, 0, 0], n), -12.8, 15.2);
      this.state.clip.snappedKey = null;
      if (this.state.clip.snap && !event.shiftKey) {
        let best: { distance: number; value: number; key: string; label: string } | null = null;
        for (const landmark of this.clipLandmarks()) {
          const d = Math.abs(landmark.value - offset);
          if (d < 0.62 && (!best || d < best.distance)) best = { distance: d, ...landmark };
        }
        if (best) {
          offset = best.value;
          this.state.clip.snappedKey = best.label;
          this.hint(`剖切面吸附：${best.label}（${offset.toFixed(1)} mm）`, 'success');
        }
      }
      this.state.clip.offset = offset;
    } else {
      const dx = event.clientX - this.clipDrag.startX;
      let yaw = this.clipDrag.startYaw + dx * 0.0062;
      let drift = yaw - Math.PI / 2;
      if (this.state.clip.snap && Math.abs(drift) < 0.045) {
        yaw = Math.PI / 2;
        drift = 0;
        this.state.clip.angleSnapped = true;
        this.hint('剖切方向已吸附到视轴', 'success');
      } else {
        this.state.clip.angleSnapped = false;
      }
      if (Math.abs(drift) > MAX_YAW_DRIFT) {
        yaw = Math.PI / 2 + clamp(drift, -MAX_YAW_DRIFT, MAX_YAW_DRIFT);
        const now = performance.now();
        if (now - this.lastBlockedHint > 650) {
          this.lastBlockedHint = now;
          this.hint('已卡住：剖切方向偏离主轴不能超过 14°，反向拖回即可', 'warning');
        }
      }
      this.state.clip.yaw = yaw;
    }

    this.updateClipRig();
    this.updateSection();
  }

  private endClipDrag(): void {
    if (!this.clipDrag) return;
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    const before = this.clipDrag.before;
    this.clipDrag = null;
    this.camera.attachControl(this.canvas, true);
    const after = cloneState(this.state);
    if (JSON.stringify(before.clip) !== JSON.stringify(after.clip)) {
      this.history.commit('剖切拖动', before, after);
    }
    this.emitState();
  }

  // ---------------------------------------------------------------------------
  // Section cap
  // ---------------------------------------------------------------------------

  private updateSection(): void {
    if (!this.lensSectionMesh) return;
    this.syncLensBasis();
    const n = this.clipNormal();
    const planeD = this.state.clip.offset;
    if (!this.state.clip.enabled) {
      this.lensSectionMesh.setEnabled(false);
      this.lensOutline?.setEnabled(false);
      return;
    }

    const poly = this.lensIntersectionPolygon(n, planeD);
    if (!poly) {
      this.lensSectionMesh.setEnabled(false);
      this.lensOutline?.setEnabled(false);
      return;
    }

    const shift: Vec3 = [-n[0] * 0.035, -n[1] * 0.035, -n[2] * 0.035];
    const center: Vec3 = [poly.center[0] + shift[0], poly.center[1] + shift[1], poly.center[2] + shift[2]];
    const boundary = poly.points.map((p) => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]] as Vec3);
    const positions = [center, ...boundary].flat();
    const indices: number[] = [];
    for (let i = 0; i < boundary.length - 1; i += 1) {
      indices.push(0, i + 1, i + 2);
    }
    const normals: number[] = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(this.lensSectionMesh, true);
    this.lensSectionMesh.setEnabled(true);

    const linePoints = poly.points.map((p) => new BABYLON.Vector3(p[0], p[1], p[2]));
    if (!this.lensOutline) {
      this.lensOutline = BABYLON.MeshBuilder.CreateLines('lens-section-outline', { points: linePoints, updatable: true }, this.scene);
      this.lensOutline.color = new BABYLON.Color3(1, 0.82, 0.28);
      this.lensOutline.isPickable = false;
    } else {
      BABYLON.MeshBuilder.CreateLines('lens-section-outline', {
        points: linePoints,
        instance: this.lensOutline,
        updatable: true,
      }, this.scene);
    }
    this.lensOutline.setEnabled(true);
  }

  private lensIntersectionPolygon(n: Vec3, d: number) {
    const basis = this.state.lensBasis ?? lensBasisFromState(this.state);
    return (
      this.ellipsoidPolygon({
        center: this.state.lens.position,
        radii: [
          EYE.lensRadii.x * this.state.lens.scaling[0],
          EYE.lensRadii.y * this.state.lens.scaling[1],
          EYE.lensRadii.z * this.state.lens.scaling[2],
        ],
        basis,
      }, n, d)
    );
  }

  private ellipsoidPolygon(
    spec: { center: Vec3; radii: Vec3; basis: [Vec3, Vec3, Vec3] },
    planeNormal: Vec3,
    planeD: number,
  ) {
    return ellipsoidPlanePolygon(spec, planeNormal, planeD, 96);
  }

  // ---------------------------------------------------------------------------
  // Pointer picking and measurements
  // ---------------------------------------------------------------------------

  private handleWindowResize = (): void => {
    this.engine.resize();
  };

  private handleWindowPointerMove = (event: PointerEvent): void => {
    if (this.clipDrag) this.updateClipFromPointer(event);
  };

  private handleWindowPointerUp = (): void => {
    this.endClipDrag();
  };

  private handlePointerObservable(info: BABYLON.PointerInfo): void {
    const event = info.event as PointerEvent;
    if (info.type === BABYLON.PointerEventTypes.POINTERDOWN && event.button === 0) {
      this.pointerDownAt = { x: event.clientX, y: event.clientY, time: performance.now() };
      if (this.tool === 'clip') this.tryBeginClipDrag(event);
    }

    if (info.type === BABYLON.PointerEventTypes.POINTERUP && event.button === 0) {
      const down = this.pointerDownAt;
      this.pointerDownAt = null;
      if (this.clipDrag) {
        this.endClipDrag();
        return;
      }
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const elapsed = performance.now() - down.time;
      if (moved > 6 || elapsed > 700 || this.gizmoManager.isDragging) return;
      this.handleTap(event);
    }

    if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      this.updateHoverCursor();
    }
  }

  private tryBeginClipDrag(event: PointerEvent): void {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => Boolean(mesh.metadata?.clipHandle),
      false,
    );
    const handle = pick?.pickedMesh?.metadata?.clipHandle as 'offset' | 'yaw' | 'surface' | undefined;
    if (!pick?.hit || !handle) return;
    const mode = handle === 'yaw' ? 'yaw' : 'offset';
    this.clipDrag = {
      mode,
      before: cloneState(this.state),
      startX: event.clientX,
      startYaw: this.state.clip.yaw,
    };
    this.camera.detachControl();
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    this.hint(mode === 'offset' ? '拖动剖切面：实时更新断面，靠近关键点会吸附' : '旋转剖切方向：偏离主轴过大会卡住', 'info');
  }

  private updateHoverCursor(): void {
    if (this.clipDrag || this.pointDrag) return;
    if (this.gizmoManager.isHovered) {
      this.canvas.style.cursor = 'grab';
      return;
    }
    if (this.tool === 'select') {
      const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => Boolean(m.metadata?.selectable), true);
      this.canvas.style.cursor = pick?.hit ? 'pointer' : 'grab';
    } else if (this.tool === 'clip') {
      const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => Boolean(m.metadata?.clipHandle), true);
      this.canvas.style.cursor = pick?.hit ? 'grab' : 'crosshair';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  private handleTap(event: PointerEvent): void {
    if (this.tool === 'select') {
      const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => Boolean(m.metadata?.selectable), false);
      const category = pick?.pickedMesh?.metadata?.category as SelectionId | undefined;
      if (pick?.hit && (category === 'lens' || category === 'cornea')) {
        this.select(category);
      } else {
        this.select(null);
      }
      return;
    }

    if (this.tool === 'acd' || this.tool === 'lensThickness') {
      this.addSectionMeasurePoint(this.tool, event);
      return;
    }
    if (this.tool === 'curvature') {
      this.addCurvaturePoint(event);
    }
  }

  private rayFromClient(clientX: number, clientY: number): BABYLON.Ray | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return this.scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), this.camera);
  }

  private currentPlane(): { point: Vec3; normal: Vec3 } {
    const normal = this.clipNormal();
    return { point: [normal[0] * this.state.clip.offset, normal[1] * this.state.clip.offset, normal[2] * this.state.clip.offset], normal };
  }

  private findAnchorNearClient(clientX: number, clientY: number): MeasurePoint | null {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const anchors: Array<{ anchor: MeasurePoint['anchor']; p: Vec3 }> = [
      { anchor: { type: 'corneaPole', surface: 'posterior' }, p: resolveAnchor({ type: 'corneaPole', surface: 'posterior' }, this.state) },
      { anchor: { type: 'corneaPole', surface: 'anterior' }, p: resolveAnchor({ type: 'corneaPole', surface: 'anterior' }, this.state) },
      { anchor: { type: 'lensPole', end: 'anterior' }, p: resolveAnchor({ type: 'lensPole', end: 'anterior' }, this.state) },
      { anchor: { type: 'lensPole', end: 'posterior' }, p: resolveAnchor({ type: 'lensPole', end: 'posterior' }, this.state) },
    ];
    let best: { distance: number; mp: MeasurePoint } | null = null;
    for (const item of anchors) {
      const projected = this.project(item.p);
      if (!projected.visible) continue;
      const d = Math.hypot(projected.x - localX, projected.y - localY);
      if (d < SNAP_PX && (!best || d < best.distance)) {
        best = { distance: d, mp: { p: item.p, anchor: item.anchor } };
      }
    }
    return best?.mp ?? null;
  }

  private addSectionMeasurePoint(kind: 'acd' | 'lensThickness', event: PointerEvent): void {
    const ray = this.rayFromClient(event.clientX, event.clientY);
    if (!ray) return;
    const plane = this.currentPlane();
    const rayLike: RayLike = { origin: ray.origin.asArray() as Vec3, direction: ray.direction.asArray() as Vec3 };
    const p = rayPlane(rayLike, plane.point, plane.normal);
    if (!p) return;

    const before = cloneState(this.state);
    const anchorPoint = this.findAnchorNearClient(event.clientX, event.clientY);
    const point: MeasurePoint = anchorPoint ?? { p };

    let measurement = this.state.measurements.find((m) => m.kind === kind && !m.done);
    if (!measurement) {
      measurement = {
        id: uid('measure'),
        kind,
        points: [],
        done: false,
        createdAt: Date.now(),
      };
      this.state.measurements.push(measurement);
    }
    measurement.points.push(point);
    if (measurement.points.length >= 2) {
      measurement.points = measurement.points.slice(0, 2);
      measurement.done = true;
      measurement.value = distance(measurement.points[0].p, measurement.points[1].p);
      this.hint(
        kind === 'acd' ? `前房深度：${formatMm(measurement.value)}` : `晶状体厚度：${formatMm(measurement.value)}`,
        'success',
      );
    } else {
      this.hint(kind === 'acd' ? '第 1 点：角膜后表面；请再点晶状体前极' : '第 1 点：晶状体前极；请再点晶状体后极', 'info');
    }

    const after = cloneState(this.state);
    this.history.commit('添加测量点', before, after);
    this.emitState();
  }

  private pickCorneaPoint(clientX: number, clientY: number): Vec3 | null {
    const x = clientX - this.canvas.getBoundingClientRect().left;
    const y = clientY - this.canvas.getBoundingClientRect().top;
    const pick = this.scene.pick(x, y, (mesh) => mesh === this.model.cornea && mesh.isPickable, false);
    if (pick?.hit && pick.pickedPoint) return pick.pickedPoint.asArray() as Vec3;

    const ray = this.rayFromClient(clientX, clientY);
    if (!ray) return null;
    const center = EYE.corneaCenter;
    const radius = EYE.corneaOuterRadius;
    const oc = ray.origin.subtract(center);
    const b = BABYLON.Vector3.Dot(oc, ray.direction);
    const c = BABYLON.Vector3.Dot(oc, oc) - radius * radius;
    const discriminant = b * b - c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    let t = -b - root;
    if (t < 0) t = -b + root;
    if (t < 0) return null;
    const p = ray.origin.add(ray.direction.scale(t));
    return p.asArray() as Vec3;
  }

  private addCurvaturePoint(event: PointerEvent): void {
    const p = this.pickCorneaPoint(event.clientX, event.clientY);
    if (!p) {
      this.hint('请点在角膜或其附近；三点将确定曲率圆', 'warning');
      return;
    }

    const before = cloneState(this.state);
    let measurement = this.state.measurements.find((m) => m.kind === 'curvature' && !m.done);
    if (!measurement) {
      measurement = { id: uid('curve'), kind: 'curvature', points: [], done: false, createdAt: Date.now() };
      this.state.measurements.push(measurement);
    }
    measurement.points.push({ p });
    if (measurement.points.length >= 3) {
      measurement.points = measurement.points.slice(0, 3);
      const circle = circumcircle3(
        measurement.points[0].p,
        measurement.points[1].p,
        measurement.points[2].p,
      );
      if (!circle.valid) {
        this.hint('三点几乎共线，无法确定曲率，请拖动其中一点', 'warning');
        measurement.done = false;
      } else {
        measurement.done = true;
        measurement.radius = circle.radius;
        measurement.value = circle.radius;
        measurement.center = circle.center;
        this.hint(`角膜曲率半径 R = ${formatMm(circle.radius)}（点可拖回重放）`, 'success');
      }
    } else {
      this.hint(`曲率测量第 ${measurement.points.length}/3 点，放错可直接拖动该点`, 'info');
    }
    const after = cloneState(this.state);
    this.history.commit('添加曲率点', before, after);
    this.emitState();
  }

  // Overlay drag API ----------------------------------------------------------

  beginPointDrag(measurementId: string, index: number): void {
    this.pointDrag = { measurementId, index, before: cloneState(this.state) };
  }

  updatePointDragFromClient(clientX: number, clientY: number): void {
    if (!this.pointDrag) return;
    const measurement = this.state.measurements.find((m) => m.id === this.pointDrag?.measurementId);
    if (!measurement) return;

    let nextPoint: MeasurePoint | null = null;
    if (measurement.kind === 'curvature') {
      const p = this.pickCorneaPoint(clientX, clientY);
      if (p) nextPoint = { p };
    } else {
      const ray = this.rayFromClient(clientX, clientY);
      if (ray) {
        const plane = this.currentPlane();
        const rayLike: RayLike = { origin: ray.origin.asArray() as Vec3, direction: ray.direction.asArray() as Vec3 };
        const p = rayPlane(rayLike, plane.point, plane.normal);
        if (p) nextPoint = this.findAnchorNearClient(clientX, clientY) ?? { p };
      }
    }

    if (!nextPoint) return;
    measurement.points[this.pointDrag.index] = nextPoint;
    this.recomputeMeasurement(measurement);
    this.emitState();
  }

  endPointDrag(): void {
    if (!this.pointDrag) return;
    const { before, measurementId } = this.pointDrag;
    this.pointDrag = null;
    const after = cloneState(this.state);
    const afterMeasurement = after.measurements.find((m) => m.id === measurementId);
    const beforeMeasurement = before.measurements.find((m) => m.id === measurementId);
    if (JSON.stringify(beforeMeasurement) !== JSON.stringify(afterMeasurement)) {
      this.history.commit('拖动测量点', before, after);
      if (afterMeasurement?.kind === 'curvature' && afterMeasurement.radius) {
        this.hint(`曲率点已重放：R = ${formatMm(afterMeasurement.radius)}`, 'success');
      }
    }
    this.emitState();
  }

  private recomputeMeasurement(measurement: Measurement): void {
    if (measurement.kind === 'curvature' && measurement.points.length === 3) {
      const circle = circumcircle3(measurement.points[0].p, measurement.points[1].p, measurement.points[2].p);
      if (circle.valid) {
        measurement.done = true;
        measurement.radius = circle.radius;
        measurement.value = circle.radius;
        measurement.center = circle.center;
      }
    } else if (measurement.points.length >= 2) {
      measurement.done = true;
      measurement.value = distance(
        resolveAnchorSafe(measurement.points[0], this.state),
        resolveAnchorSafe(measurement.points[1], this.state),
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.handleWindowResize);
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    this.resizeObserver?.disconnect();
    this.gizmoManager.dispose();
    this.corneaBoxGizmo.dispose();
    this.highlight.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}

function resolveAnchorSafe(point: MeasurePoint, state: LabState): Vec3 {
  return point.anchor ? resolveAnchor(point.anchor, state) : point.p;
}
