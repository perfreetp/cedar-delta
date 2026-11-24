import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Joint, JointPose } from '../types';
import { solveFK } from '../lib/math';

const COLOR_NORMAL = new THREE.Color(0x5b8def);
const COLOR_ROOT = new THREE.Color(0x8a7cff);
const COLOR_SELECTED = new THREE.Color(0xffc857);
const COLOR_HOVER = new THREE.Color(0x9fd8ff);
const COLOR_CLAMPED = new THREE.Color(0xff4d4d);
const COLOR_BONE = new THREE.Color(0xc7cede);
const COLOR_TARGET = new THREE.Color(0x35d0a0);

export interface DragState {
  kind: 'joint' | 'effector' | 'rod';
  jointId?: string;
  branchRootId?: string;
}

export interface RigViewCallbacks {
  onJointDragStart: (jointId: string) => void;
  onJointDrag: (jointId: string, worldPos: THREE.Vector3) => void;
  onJointDragEnd: () => void;
  onEffectorDragStart: (jointId: string, branchRootId: string | undefined) => void;
  onEffectorDrag: (jointId: string, worldPos: THREE.Vector3, branchRootId: string | undefined) => void;
  onEffectorDragEnd: () => void;
  onSelect: (jointId: string | null) => void;
  onHoverChange: (jointId: string | null) => void;
  onRodDragStart: () => void;
  onRodDrag: (value: number) => void;
  onRodDragEnd: () => void;
  /** 当前是否动画模式（决定球体拖动语义） */
  getMode: () => 'edit' | 'animate';
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * three.js 视口：
 * - 关节球体与骨骼圆柱均使用 InstancedMesh，几十个关节也只产生少量 draw call
 * - 每帧重建实例矩阵，配合 rAF 渲染，拖动流畅
 */
export class RigView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement;

  private sphereMesh!: THREE.InstancedMesh;
  private boneMesh!: THREE.InstancedMesh;
  private targetHandle!: THREE.Mesh;
  private rodGroup!: THREE.Group;
  private rodKnob!: THREE.Mesh;
  private rodMin = -2;
  private rodMax = 2;

  private joints: Joint[] = [];
  private pose: JointPose = {};
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private clamped = new Set<string>();
  private cb: RigViewCallbacks;

  private drag: DragState | null = null;
  private dragPlane = new THREE.Plane();
  private dragPoint = new THREE.Vector3();
  private rafId = 0;
  private tmpMat = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpVec = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private rodStartY = 0;
  private rodStartValue = 0;

  constructor(container: HTMLElement, cb: RigViewCallbacks) {
    this.container = container;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14171f);
    this.scene.fog = new THREE.Fog(0x14171f, 6, 14);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 100);
    this.camera.position.set(2.6, 1.9, 3.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.buildLights();
    this.buildGround();
    this.buildInstances();
    this.buildTargetHandle();
    this.buildRod();
    this.bindEvents();

    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.controls.update();
      this.updateInstances();
      this.renderer.render(this.scene, this.camera);
    };
    loop();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-4, 2, -3);
    this.scene.add(fill);
  }

  private buildGround(): void {
    const grid = new THREE.GridHelper(6, 24, 0x2c3346, 0x222838);
    grid.position.y = 0;
    this.scene.add(grid);
  }

  private buildInstances(): void {
    const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
    const sphereMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.15 });
    this.sphereMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, 512);
    this.sphereMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sphereMesh.frustumCulled = false;
    this.scene.add(this.sphereMesh);

    const boneGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    const boneMat = new THREE.MeshStandardMaterial({ color: COLOR_BONE, roughness: 0.6, metalness: 0.3 });
    this.boneMesh = new THREE.InstancedMesh(boneGeo, boneMat, 512);
    this.boneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boneMesh.frustumCulled = false;
    this.scene.add(this.boneMesh);
  }

  /** 末端目标手柄（动画模式显示在选中的末端关节处） */
  private buildTargetHandle(): void {
    const geo = new THREE.SphereGeometry(0.05, 16, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_TARGET,
      emissive: COLOR_TARGET,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    this.targetHandle = new THREE.Mesh(geo, mat);
    this.targetHandle.visible = false;
    this.scene.add(this.targetHandle);
  }

  /** 牵引杆：屏幕右侧的竖直滑杆 + 可拖旋钮 */
  private buildRod(): void {
    this.rodGroup = new THREE.Group();
    const barGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 12);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x66708c, roughness: 0.5 });
    const bar = new THREE.Mesh(barGeo, barMat);
    this.rodGroup.add(bar);

    const knobGeo = new THREE.SphereGeometry(0.055, 18, 14);
    const knobMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0x8a5a00,
      emissiveIntensity: 0.4,
      roughness: 0.35,
    });
    this.rodKnob = new THREE.Mesh(knobGeo, knobMat);
    this.rodGroup.add(this.rodKnob);

    // 两端限位环
    const ringGeo = new THREE.TorusGeometry(0.04, 0.008, 8, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x9aa4bf });
    const ringTop = new THREE.Mesh(ringGeo, ringMat);
    ringTop.rotation.x = Math.PI / 2;
    ringTop.position.y = 0.5;
    const ringBottom = ringTop.clone();
    ringBottom.position.y = -0.5;
    this.rodGroup.add(ringTop, ringBottom);

    this.rodGroup.visible = false;
    this.scene.add(this.rodGroup);
  }

  // ---------------------------------------------------------------- 数据更新

  setSkeleton(joints: Joint[]): void {
    this.joints = joints;
    this.sphereMesh.count = joints.length;
    this.boneMesh.count = Math.max(0, joints.filter((j) => j.parentId).length);
  }

  setPose(pose: JointPose): void {
    this.pose = pose;
  }

  setSelection(id: string | null): void {
    this.selectedId = id;
  }

  setClamped(ids: Set<string>): void {
    this.clamped = ids;
  }

  setRodVisible(visible: boolean, min: number, max: number, value: number): void {
    this.rodGroup.visible = visible;
    this.rodMin = min;
    this.rodMax = max;
    this.placeRod(value);
  }

  setRodValue(value: number): void {
    this.placeRod(value);
  }

  /** 牵引杆固定在相机右侧，旋钮高度随 value 映射到 [-0.5, 0.5] */
  private placeRod(value: number): void {
    const span = this.rodMax - this.rodMin || 1;
    const t = (value - this.rodMin) / span;
    this.rodKnob.position.y = -0.5 + t * 1.0;
  }

  private updateRodPlacement(): void {
    if (!this.rodGroup.visible) return;
    // 放在相机右前方，跟随视角但不随轨道旋转翻滚
    const offset = new THREE.Vector3(1.4, 0, 0).applyQuaternion(this.camera.quaternion);
    this.rodGroup.position.copy(this.controls.target).add(offset);
    this.rodGroup.quaternion.copy(this.camera.quaternion);
  }

  // ---------------------------------------------------------------- 实例矩阵

  private updateInstances(): void {
    if (this.joints.length === 0) return;
    const solved = solveFK(this.joints, this.pose);
    const byId = new Map(this.joints.map((j) => [j.id, j]));
    const color = new THREE.Color();

    // 球体
    let i = 0;
    for (const joint of this.joints) {
      const data = solved.joints.get(joint.id)!;
      this.tmpScale.setScalar(joint.radius);
      this.tmpMat.compose(data.position, this.tmpQuat.identity(), this.tmpScale);
      this.sphereMesh.setMatrixAt(i, this.tmpMat);

      if (this.clamped.has(joint.id)) color.copy(COLOR_CLAMPED);
      else if (joint.id === this.selectedId) color.copy(COLOR_SELECTED);
      else if (joint.id === this.hoverId) color.copy(COLOR_HOVER);
      else if (joint.parentId === null) color.copy(COLOR_ROOT);
      else color.copy(COLOR_NORMAL);
      this.sphereMesh.setColorAt(i, color);
      i++;
    }
    this.sphereMesh.instanceMatrix.needsUpdate = true;
    if (this.sphereMesh.instanceColor) this.sphereMesh.instanceColor.needsUpdate = true;

    // 骨骼（父 → 子 的圆柱）
    let b = 0;
    for (const joint of this.joints) {
      if (!joint.parentId) continue;
      const parent = solved.joints.get(joint.parentId);
      const child = solved.joints.get(joint.id);
      if (!parent || !child) continue;
      const dir = this.tmpVec.copy(child.position).sub(parent.position);
      const len = dir.length();
      if (len < 1e-6) continue;
      const mid = new THREE.Vector3().copy(parent.position).addScaledVector(dir, 0.5);
      this.tmpQuat.setFromUnitVectors(Y_AXIS, dir.normalize());
      this.tmpScale.set(1, len, 1);
      this.tmpMat.compose(mid, this.tmpQuat, this.tmpScale);
      this.boneMesh.setMatrixAt(b++, this.tmpMat);
    }
    this.boneMesh.instanceMatrix.needsUpdate = true;

    // 末端目标手柄
    if (this.targetHandle.visible && this.selectedId) {
      const s = solved.joints.get(this.selectedId);
      if (s) this.targetHandle.position.copy(s.position);
    }
    this.updateRodPlacement();
    void byId;
  }

  // ---------------------------------------------------------------- 拾取与交互

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** 射线拾取关节球体，返回关节 id（考虑各自半径） */
  private pickJoint(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.sphereMesh, false);
    if (hits.length === 0) return null;
    const instanceId = hits[0].instanceId;
    if (instanceId === undefined) return null;
    return this.joints[instanceId]?.id ?? null;
  }

  private pickRodKnob(): boolean {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObject(this.rodKnob, false).length > 0;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.updatePointer(e);

    // 牵引杆旋钮优先
    if (this.rodGroup.visible && this.pickRodKnob()) {
      this.drag = { kind: 'rod' };
      this.controls.enabled = false;
      this.cb.onRodDragStart();
      // 记录屏幕纵向起点与当前值，拖动时按像素映射
      this.rodStartY = e.clientY;
      this.rodStartValue = this.currentRodValue();
      return;
    }

    const jointId = this.pickJoint();
    if (!jointId) {
      this.cb.onSelect(null);
      return;
    }
    this.cb.onSelect(jointId);

    const joint = this.joints.find((j) => j.id === jointId)!;
    const solved = solveFK(this.joints, this.pose);
    const jointPos = solved.joints.get(jointId)!.position;

    if (this.cb.getMode() === 'animate' && joint.parentId !== null) {
      // 动画模式：拖末端手柄做 IK。链根取最近的“根附近”关节
      const branchRoot = this.findBranchRoot(jointId);
      this.drag = { kind: 'effector', jointId, branchRootId: branchRoot };
      this.targetHandle.visible = true;
      this.cb.onEffectorDragStart(jointId, branchRoot);
      // 拖动平面：过关节点、朝向相机
      this.dragPlane.setFromNormalAndCoplanarPoint(
        new THREE.Vector3().subVectors(this.camera.position, jointPos).normalize(),
        jointPos,
      );
    } else {
      // 编辑模式：拖动球体改绑定位置
      this.drag = { kind: 'joint', jointId };
      this.dragPlane.setFromNormalAndCoplanarPoint(
        new THREE.Vector3().subVectors(this.camera.position, jointPos).normalize(),
        jointPos,
      );
      this.cb.onJointDragStart(jointId);
    }
    this.controls.enabled = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.updatePointer(e);

    if (this.drag) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (this.drag.kind === 'rod') {
        const span = this.rodMax - this.rodMin || 1;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const delta = (this.rodStartY - e.clientY) / rect.height; // 向上为正
        const value = THREE.MathUtils.clamp(this.rodStartValue + delta * span * 1.6, this.rodMin, this.rodMax);
        this.cb.onRodDrag(value);
        return;
      }
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
        if (this.drag.kind === 'joint' && this.drag.jointId) {
          this.cb.onJointDrag(this.drag.jointId, this.dragPoint);
        } else if (this.drag.kind === 'effector' && this.drag.jointId) {
          this.cb.onEffectorDrag(this.drag.jointId, this.dragPoint, this.drag.branchRootId);
        }
      }
      return;
    }

    // 悬停高亮
    const id = this.pickJoint();
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.cb.onHoverChange(id);
      this.renderer.domElement.style.cursor = id ? 'pointer' : 'default';
    }
  };

  private onPointerUp = (): void => {
    if (!this.drag) return;
    this.controls.enabled = true;
    if (this.drag.kind === 'joint') this.cb.onJointDragEnd();
    if (this.drag.kind === 'effector') {
      this.targetHandle.visible = false;
      this.cb.onEffectorDragEnd();
    }
    if (this.drag.kind === 'rod') this.cb.onRodDragEnd();
    this.drag = null;
  };

  private currentRodValue(): number {
    // 由外部最新值通过 setRodValue 同步；这里用旋钮位置反推
    const span = this.rodMax - this.rodMin || 1;
    const t = (this.rodKnob.position.y + 0.5) / 1.0;
    return this.rodMin + t * span;
  }

  /**
   * 找链根：沿父链向上，选第一个“分叉点或根”的下游关节。
   * 简单策略：取末端向上数的第 3 个祖先（肩/髋这类），找不到则取根关节。
   */
  private findBranchRoot(endId: string): string | undefined {
    const byId = new Map(this.joints.map((j) => [j.id, j]));
    const chain: string[] = [];
    let cur = byId.get(endId);
    while (cur) {
      chain.unshift(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    if (chain.length <= 3) return chain[0];
    return chain[Math.max(0, chain.length - 3)];
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
