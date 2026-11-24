// 三维编排引擎基类:场景、高度场网格(BVH)、中心线、闸门资源与编辑基础能力
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { installBVH } from '../lib/bvh';
import {
  GRID_SEGMENTS,
  POLE_HEIGHT,
  VERTS_PER_SIDE,
} from '../lib/constants';
import { Centerline } from '../lib/centerline';
import {
  buildHeights,
  computeColors,
  gridX,
  gridZ,
  heightAt,
  idx,
} from '../lib/terrain';
import { computeProfile, designElevation, type ProfilePoint } from '../lib/profile';
import { regroundGates } from '../lib/gates';
import { HistoryStack, makeSnapshot } from '../lib/history';
import { useEditorStore } from '../store';
import type {
  ControlPoint,
  Gate,
  Snapshot,
  Step,
  ToolMode,
} from '../lib/types';

export interface GateVisual {
  group: THREE.Group;
  hit: THREE.Mesh;
  bar: THREE.Mesh;
  poleA: THREE.Mesh;
  poleB: THREE.Mesh;
  headA: THREE.Mesh;
  headB: THREE.Mesh;
}

const GATE_RED = 0xe23b3b;
const GATE_GREEN = 0x2fbf6b;

export type DragState =
  | { kind: 'sculpt'; lastX: number; lastZ: number; target: number }
  | { kind: 'point'; id: string }
  | { kind: 'gate'; id: string }
  | null;

export class EditorEngineBase {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  protected container: HTMLElement;
  protected terrainMesh!: THREE.Mesh;
  protected terrainGeometry!: THREE.BufferGeometry;
  protected centerline!: Centerline;
  protected centerLineObj!: THREE.Line;
  protected widthLines!: THREE.LineSegments;
  protected cpHandles: THREE.Mesh[] = [];
  protected gateVisuals = new Map<string, GateVisual>();
  protected ghost!: THREE.Group;
  protected ghostBar!: THREE.Mesh;
  protected ghostPoleA!: THREE.Mesh;
  protected ghostPoleB!: THREE.Mesh;
  protected brushRing!: THREE.Mesh;

  protected heights!: Float32Array;
  protected colors!: Float32Array;
  protected history = new HistoryStack();
  protected raf = 0;
  protected disposed = false;

  protected raycaster = new THREE.Raycaster();
  protected pointerNdc = new THREE.Vector2();
  protected dragging: DragState = null;
  protected rebuildQueued = false;
  protected pendingCp: ControlPoint[] | null = null;

  constructor(container: HTMLElement) {
    installBVH();
    this.container = container;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0f1620');
    this.scene.fog = new THREE.Fog('#0f1620', 260, 520);

    this.camera = new THREE.PerspectiveCamera(52, w / h, 0.5, 1200);
    this.camera.position.set(70, 90, 150);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 2, 0);
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 420;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.setupLights();
    this.setupTerrain();
    this.centerline = new Centerline(useEditorStore.getState().controlPoints);
    this.setupCenterlineObjects();
    this.setupGates();
    this.buildGhost();
    this.setupBrushRing();

    this.rebuildTerrainFull();
    this.syncHistoryFlags();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  // ---------------- 场景搭建 ----------------

  protected setupLights(): void {
    const hemi = new THREE.HemisphereLight('#cfe4ff', '#3a332a', 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff2dc', 2.0);
    sun.position.set(90, 140, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 150;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#88aaff', 0.35);
    fill.position.set(-80, 60, -90);
    this.scene.add(fill);
  }

  protected setupTerrain(): void {
    const count = VERTS_PER_SIDE * VERTS_PER_SIDE;
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    for (let iz = 0; iz <= GRID_SEGMENTS; iz++) {
      for (let ix = 0; ix <= GRID_SEGMENTS; ix++) {
        const vi = idx(ix, iz);
        positions[vi * 3] = gridX(ix);
        positions[vi * 3 + 1] = 0;
        positions[vi * 3 + 2] = gridZ(iz);
        uvs[vi * 2] = ix / GRID_SEGMENTS;
        uvs[vi * 2 + 1] = iz / GRID_SEGMENTS;
      }
    }
    const indices: number[] = [];
    for (let iz = 0; iz < GRID_SEGMENTS; iz++) {
      for (let ix = 0; ix < GRID_SEGMENTS; ix++) {
        const a = idx(ix, iz);
        const b = idx(ix + 1, iz);
        const c = idx(ix, iz + 1);
        const d2 = idx(ix + 1, iz + 1);
        indices.push(a, c, b, b, c, d2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    this.terrainGeometry = geo;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.96,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = 'terrain';
    this.scene.add(this.terrainMesh);
  }

  protected setupCenterlineObjects(): void {
    const mat = new THREE.LineBasicMaterial({ color: 0x37e0ff, transparent: true, opacity: 0.9 });
    this.centerLineObj = new THREE.Line(new THREE.BufferGeometry(), mat);
    this.centerLineObj.visible = false;
    this.scene.add(this.centerLineObj);

    const wmat = new THREE.LineBasicMaterial({
      color: 0x66d9ef,
      transparent: true,
      opacity: 0.4,
    });
    this.widthLines = new THREE.LineSegments(new THREE.BufferGeometry(), wmat);
    this.widthLines.visible = false;
    this.scene.add(this.widthLines);

    const sphereGeo = new THREE.SphereGeometry(1.7, 16, 12);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffd34d,
      emissive: 0x6b4e00,
      roughness: 0.4,
    });
    this.cpHandles = this.centerline.points.map((cp) => {
      const m = new THREE.Mesh(sphereGeo, sphereMat);
      m.position.set(cp.x, 0.9, cp.z);
      m.userData.cpId = cp.id;
      this.scene.add(m);
      return m;
    });
    this.refreshCenterlineObjects();
  }

  protected refreshCenterlineObjects(): void {
    const linePts = this.centerline.toLinePoints(0.55);
    this.centerLineObj.geometry.dispose();
    this.centerLineObj.geometry = new THREE.BufferGeometry().setFromPoints(linePts);

    const seg: number[] = [];
    for (const smp of this.centerline.samples) {
      const lx = smp.x + smp.nx * smp.halfWidth;
      const lz = smp.z + smp.nz * smp.halfWidth;
      const rx = smp.x - smp.nx * smp.halfWidth;
      const rz = smp.z - smp.nz * smp.halfWidth;
      seg.push(lx, 0.4, lz, rx, 0.4, rz);
    }
    this.widthLines.geometry.dispose();
    this.widthLines.geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(seg, 3),
    );

    // 控制点数量可能变化,完整重建手柄
    for (const h of this.cpHandles) this.scene.remove(h);
    const sphereGeo = new THREE.SphereGeometry(1.7, 16, 12);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xffd34d,
      emissive: 0x6b4e00,
      roughness: 0.4,
    });
    this.cpHandles = this.centerline.points.map((cp) => {
      const m = new THREE.Mesh(sphereGeo, sphereMat);
      m.position.set(cp.x, 0.9, cp.z);
      m.userData.cpId = cp.id;
      m.visible = this.centerLineObj.visible;
      this.scene.add(m);
      return m;
    });
  }

  protected buildGateVisual(color: number, opacity: number): THREE.Group {
    const group = new THREE.Group();
    const barGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 10);
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 10);
    const headGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
    const mat = new THREE.MeshStandardMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      roughness: 0.5,
      metalness: 0.25,
    });
    const bar = new THREE.Mesh(barGeo, mat);
    const poleA = new THREE.Mesh(poleGeo, mat);
    const poleB = new THREE.Mesh(poleGeo, mat);
    const headA = new THREE.Mesh(headGeo, mat);
    const headB = new THREE.Mesh(headGeo, mat);
    group.add(bar, poleA, poleB, headA, headB);
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    group.add(hit);
    return group;
  }

  protected setupGates(): void {
    for (const g of useEditorStore.getState().gates) this.addGateVisual(g);
  }

  protected addGateVisual(g: Gate): GateVisual {
    const color = g.color === 'red' ? GATE_RED : GATE_GREEN;
    const group = this.buildGateVisual(color, 1);
    const bar = group.children[0] as THREE.Mesh;
    const poleA = group.children[1] as THREE.Mesh;
    const poleB = group.children[2] as THREE.Mesh;
    const headA = group.children[3] as THREE.Mesh;
    const headB = group.children[4] as THREE.Mesh;
    const hit = group.children[5] as THREE.Mesh;
    hit.userData.gateId = g.id;
    const visual: GateVisual = { group, hit, bar, poleA, poleB, headA, headB };
    this.gateVisuals.set(g.id, visual);
    this.scene.add(group);
    this.layoutGateVisual(visual, g);
    return visual;
  }

  protected layoutGateVisual(v: GateVisual, g: Gate): void {
    const [ax, ay, az] = g.pA;
    const [bx, by, bz] = g.pB;
    const aTop = ay + POLE_HEIGHT;
    const bTop = by + POLE_HEIGHT;
    v.poleA.scale.y = POLE_HEIGHT;
    v.poleA.position.set(ax, ay + POLE_HEIGHT / 2, az);
    v.poleB.scale.y = POLE_HEIGHT;
    v.poleB.position.set(bx, by + POLE_HEIGHT / 2, bz);
    v.headA.position.set(ax, aTop + 0.2, az);
    v.headB.position.set(bx, bTop + 0.2, bz);

    const mid = new THREE.Vector3((ax + bx) / 2, (aTop + bTop) / 2, (az + bz) / 2);
    v.bar.position.copy(mid);
    v.bar.scale.y = g.width;
    const dir = new THREE.Vector3(bx - ax, bTop - aTop, bz - az).normalize();
    v.bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    v.hit.position.copy(mid);
    v.hit.scale.set(1.4, POLE_HEIGHT + 1, g.width + 1.2);
    v.hit.quaternion.copy(v.bar.quaternion);
  }

  protected buildGhost(): void {
    this.ghost = this.buildGateVisual(0x9fd0ff, 0.5);
    this.ghost.visible = false;
    this.ghostBar = this.ghost.children[0] as THREE.Mesh;
    this.ghostPoleA = this.ghost.children[1] as THREE.Mesh;
    this.ghostPoleB = this.ghost.children[2] as THREE.Mesh;
    this.scene.add(this.ghost);
  }

  protected setupBrushRing(): void {
    const geo = new THREE.RingGeometry(0.96, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.brushRing = new THREE.Mesh(geo, mat);
    this.brushRing.visible = false;
    this.scene.add(this.brushRing);
  }

  // ---------------- 地形构建 / 更新 ----------------

  protected rebuildTerrainFull(rebuildBvh = true): void {
    const state = useEditorStore.getState();
    this.centerline = new Centerline(state.controlPoints);
    this.heights = buildHeights(this.centerline, state.steps);
    this.colors = computeColors(this.centerline, this.heights);
    this.writeTerrainBuffers(true);
    // 中心线拖拽逐帧重建时跳过 BVH(拖拽走平面求交),松手时再统一重建
    if (rebuildBvh) this.terrainGeometry.computeBoundsTree();
    this.refreshCenterlineObjects();
    this.refreshToolVisibility();
    this.applyGatesToState(regroundGates(this.centerline, this.heights, state.steps, state.gates));
    state.bumpTerrain();
    state.bumpProfile();
  }

  protected writeTerrainBuffers(withColors: boolean): void {
    const pos = this.terrainGeometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.heights.length; i++) pos.setY(i, this.heights[i]);
    pos.needsUpdate = true;
    if (withColors) {
      this.terrainGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    }
    this.terrainGeometry.computeVertexNormals();
    this.terrainGeometry.attributes.normal.needsUpdate = true;
  }

  protected updateTerrainAfterSculpt(changed: number[]): void {
    const pos = this.terrainGeometry.attributes.position as THREE.BufferAttribute;
    for (const vi of changed) pos.setY(vi, this.heights[vi]);
    pos.needsUpdate = true;
    this.terrainGeometry.computeVertexNormals();
    this.terrainGeometry.attributes.normal.needsUpdate = true;
    this.terrainGeometry.boundsTree?.refit();
    useEditorStore.getState().bumpTerrain();
  }

  protected applyGatesToState(gates: Gate[]): void {
    useEditorStore.getState().setGates(gates);
    for (const g of gates) {
      const v = this.gateVisuals.get(g.id);
      if (v) this.layoutGateVisual(v, g);
    }
  }

  // ---------------- 公共只读访问 ----------------

  getProfile(): ProfilePoint[] {
    return computeProfile(this.centerline, useEditorStore.getState().steps);
  }

  getDesignElevation(s: number): number {
    return designElevation(s, useEditorStore.getState().steps);
  }

  getCenterline(): Centerline {
    return this.centerline;
  }

  getHeights(): Float32Array {
    return this.heights;
  }

  getSteps(): Step[] {
    return useEditorStore.getState().steps;
  }

  sampleHeight(x: number, z: number): number {
    return heightAt(this.heights, x, z);
  }

  // ---------------- 工具切换 / 可见性 ----------------

  setToolMode(mode: ToolMode): void {
    this.brushRing.visible = false;
    this.ghost.visible = false;
    this.refreshToolVisibility();
    const centerVisible = mode === 'centerline';
    this.centerLineObj.visible = centerVisible;
    this.widthLines.visible = centerVisible;
    for (const h of this.cpHandles) h.visible = centerVisible;
    if (mode !== 'gate') useEditorStore.getState().setSelection(null);
    this.refreshToolVisibility();
  }

  protected refreshToolVisibility(): void {
    const gateMode = useEditorStore.getState().toolMode === 'gate';
    const selection = useEditorStore.getState().selection;
    for (const v of this.gateVisuals.values()) {
      const id = v.hit.userData.gateId as string;
      const selected = selection?.kind === 'gate' && selection.id === id;
      v.group.visible = gateMode || selected;
    }
  }

  // ---------------- 拾取 ----------------

  protected setNdc(ev: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  protected pickTerrain(): THREE.Intersection | null {
    const hits = this.raycaster.intersectObject(this.terrainMesh, false);
    return hits.length ? hits[0] : null;
  }

  protected pickGate(): Gate | null {
    const meshes: THREE.Object3D[] = [];
    for (const v of this.gateVisuals.values()) if (v.group.visible) meshes.push(v.hit);
    if (!meshes.length) return null;
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.gateId as string;
    return useEditorStore.getState().gates.find((g) => g.id === id) ?? null;
  }

  protected pickControlPoint(): ControlPoint | null {
    const visible = this.cpHandles.filter((m) => m.visible);
    if (!visible.length) return null;
    const hits = this.raycaster.intersectObjects(visible, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.cpId as string;
    return useEditorStore.getState().controlPoints.find((p) => p.id === id) ?? null;
  }

  // ---------------- 历史 ----------------

  pushHistory(): void {
    const s = useEditorStore.getState();
    this.history.push(makeSnapshot(this.heights, s.controlPoints, s.steps, s.gates));
    this.syncHistoryFlags();
  }

  protected syncHistoryFlags(): void {
    useEditorStore.getState().setHistoryFlags({
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      depth: this.history.depth,
    });
  }

  currentSnapshot(): Snapshot {
    const s = useEditorStore.getState();
    return makeSnapshot(this.heights, s.controlPoints, s.steps, s.gates);
  }

  // 由子类实现的编辑操作占位
  undo(): void {}
  redo(): void {}
  deleteSelection(): void {}

  // ---------------- 渲染循环 / 尺寸 ----------------

  protected onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  protected loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.terrainGeometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
