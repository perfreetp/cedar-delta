import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { EditorController } from './EditorController';
import { createFlowerMaterial, enableAcceleratedRaycast, getFlowerGeometry } from './geometry';
import { collisionRadius, composeInstanceMatrix, decomposeInstanceMatrix } from './transformMath';
import { cloneDocument } from './utils';
import { FlowerType, FLOWER_ORDER, MAX_INSTANCES, ViewMode } from './types';

interface InstanceLocation {
  type: FlowerType;
  index: number;
}

interface DragItem {
  id: string;
  startMatrix: THREE.Matrix4;
  startPos: THREE.Vector3;
  radius: number;
}

interface Obstacle {
  x: number;
  z: number;
  r: number;
}

class CollisionGrid {
  private cellSize = 1.1;
  private cells = new Map<string, Obstacle[]>();
  private maxRadius = 0.35;

  constructor(obstacles: Obstacle[]) {
    for (const obstacle of obstacles) {
      this.maxRadius = Math.max(this.maxRadius, obstacle.r);
      const key = this.key(Math.floor(obstacle.x / this.cellSize), Math.floor(obstacle.z / this.cellSize));
      const list = this.cells.get(key);
      if (list) list.push(obstacle);
      else this.cells.set(key, [obstacle]);
    }
  }

  private key(x: number, z: number): string {
    return `${x},${z}`;
  }

  query(x: number, z: number, radius: number, output: Obstacle[]): Obstacle[] {
    output.length = 0;
    const range = Math.ceil((radius + this.maxRadius) / this.cellSize) + 1;
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    for (let ix = cx - range; ix <= cx + range; ix++) {
      for (let iz = cz - range; iz <= cz + range; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (list) output.push(...list);
      }
    }
    return output;
  }
}

interface InteractionState {
  before: ReturnType<typeof cloneDocument>;
  mode: 'translate' | 'rotate' | 'scale';
  startPivotPosition: THREE.Vector3;
  startPivotMatrix: THREE.Matrix4;
  items: DragItem[];
  collisionGrid: CollisionGrid | null;
  moved: boolean;
}

interface MarqueeState {
  active: boolean;
  additive: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export class SceneEditor {
  private host: HTMLElement;
  private controller: EditorController;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private outlinePass: OutlinePass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls;
  private transformControls: TransformControls;
  private resizeObserver: ResizeObserver;

  private instanceMeshes = {} as Record<FlowerType, THREE.InstancedMesh>;
  private outlineMeshes = {} as Record<FlowerType, THREE.InstancedMesh>;
  private entries: Record<FlowerType, string[]> = { rose: [], hydrangea: [], eucalyptus: [] };
  private locationById = new Map<string, InstanceLocation>();
  private instanceById = new Map<string, (typeof this.controller.doc.instances)[number]>();
  private flowerMaterial: THREE.MeshStandardMaterial;
  private outlineMaterial: THREE.MeshBasicMaterial;

  private pivot = new THREE.Object3D();
  private selectionBox = new THREE.Box3();
  private boxHelper: THREE.Box3Helper;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private lastLocalPointer = new THREE.Vector2(0, 0);
  private obstacleQuery: Obstacle[] = [];

  private interaction: InteractionState | null = null;
  private marquee: MarqueeState = {
    active: false,
    additive: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
  };

  private marqueeElement: HTMLDivElement;
  private tooltipElement: HTMLDivElement;
  private uiDirty = false;
  private lastUiEmit = 0;

  private viewTween: {
    start: number;
    duration: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromUp: THREE.Vector3;
    toUp: THREE.Vector3;
  } | null = null;

  private tmpMatrix = new THREE.Matrix4();
  private tmpMatrix2 = new THREE.Matrix4();
  private tmpVector = new THREE.Vector3();
  private tmpVector2 = new THREE.Vector3();
  private tmpScaleMatrix = new THREE.Matrix4();

  constructor(host: HTMLElement, controller: EditorController) {
    this.host = host;
    this.controller = controller;
    enableAcceleratedRaycast();

    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    this.scene.background = new THREE.Color('#e8edf4');
    this.scene.fog = new THREE.Fog('#e8edf4', 18, 34);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.08, 80);
    this.camera.position.set(6.8, 5.4, 8.6);
    this.camera.lookAt(0, 0.55, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.domElement.className = 'three-canvas';
    host.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outlinePass = new OutlinePass(new THREE.Vector2(width, height), this.scene, this.camera, []);
    this.outlinePass.edgeStrength = 4.2;
    this.outlinePass.edgeGlow = 0.12;
    this.outlinePass.edgeThickness = 1.6;
    this.outlinePass.pulsePeriod = 0;
    this.outlinePass.visibleEdgeColor.set('#ffb020');
    this.outlinePass.hiddenEdgeColor.set('#c85a72');
    this.composer.addPass(this.outlinePass);
    this.composer.addPass(new OutputPass());

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.target.set(0, 0.55, 0);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.minDistance = 3.2;
    this.orbitControls.maxDistance = 19;
    this.orbitControls.maxPolarAngle = Math.PI * 0.495;
    this.orbitControls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbitControls.update();

    this.addLightsAndTable();

    this.flowerMaterial = createFlowerMaterial();
    this.outlineMaterial = new THREE.MeshBasicMaterial({
      color: '#ffb020',
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });

    for (const type of FLOWER_ORDER) this.createInstancedMeshes(type);

    this.boxHelper = new THREE.Box3Helper(this.selectionBox, 0xf59e0b);
    this.boxHelper.visible = false;
    this.boxHelper.renderOrder = 40;
    const boxMaterial = this.boxHelper.material as THREE.LineBasicMaterial;
    boxMaterial.depthTest = false;
    boxMaterial.transparent = true;
    boxMaterial.opacity = 0.95;
    this.scene.add(this.boxHelper);

    this.scene.add(this.pivot);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setSize(0.82);
    this.transformControls.setMode(controller.mode);
    this.transformControls.rotationSnap = THREE.MathUtils.degToRad(15);
    this.transformControls.addEventListener('dragging-changed', this.handleDraggingChanged);
    this.transformControls.addEventListener('objectChange', this.handleObjectChange);
    this.scene.add(this.transformControls.getHelper());

    this.marqueeElement = document.createElement('div');
    this.marqueeElement.className = 'marquee-rect';
    this.marqueeElement.style.display = 'none';
    host.appendChild(this.marqueeElement);

    this.tooltipElement = document.createElement('div');
    this.tooltipElement.className = 'drag-tooltip';
    this.tooltipElement.style.display = 'none';
    host.appendChild(this.tooltipElement);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('contextmenu', this.handleContextMenu);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(host);

    this.rebuild();
    this.setView(controller.view, false);
    this.renderer.setAnimationLoop(this.animate);
  }

  private addLightsAndTable(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc9b89d, 1.65);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.35);
    key.position.set(5.5, 9.5, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 24;
    key.shadow.bias = -0.00025;
    key.shadow.radius = 4;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.65);
    fill.position.set(-6, 5, -5);
    this.scene.add(fill);

    const radius = this.controller.doc.tableRadius;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(18, 96),
      new THREE.MeshStandardMaterial({ color: '#dfe6ef', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.84;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.68, 0.72, 48),
      new THREE.MeshStandardMaterial({ color: '#cdbb9f', roughness: 0.82 }),
    );
    pedestal.position.y = -0.48;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);

    const cloth = new THREE.Mesh(
      new THREE.CylinderGeometry(radius + 0.04, radius - 0.42, 0.72, 128, 1, true),
      new THREE.MeshStandardMaterial({ color: '#f1e7d8', roughness: 0.96, side: THREE.DoubleSide }),
    );
    cloth.position.y = -0.42;
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    this.scene.add(cloth);

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius + 0.05, 0.16, 128),
      new THREE.MeshStandardMaterial({ color: '#fffaf1', roughness: 0.88 }),
    );
    top.position.y = -0.08;
    top.receiveShadow = true;
    top.castShadow = true;
    this.scene.add(top);

    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 0.015, 0.035, 10, 160),
      new THREE.MeshStandardMaterial({ color: '#d8b36a', roughness: 0.45, metalness: 0.25 }),
    );
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.012;
    edge.castShadow = true;
    this.scene.add(edge);

    const grid = new THREE.PolarGridHelper(radius - 0.12, 16, 5, 128, 0xc8b996, 0xe2d8c4);
    grid.position.y = 0.006;
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.28;
    gridMaterial.depthWrite = false;
    this.scene.add(grid);
  }

  private createInstancedMeshes(type: FlowerType): void {
    const geometry = getFlowerGeometry(type);

    const mesh = new THREE.InstancedMesh(geometry, this.flowerMaterial, MAX_INSTANCES);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.flowerType = type;
    this.instanceMeshes[type] = mesh;
    this.scene.add(mesh);

    const outline = new THREE.InstancedMesh(geometry, this.outlineMaterial, MAX_INSTANCES);
    outline.count = 0;
    outline.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    outline.frustumCulled = false;
    outline.renderOrder = 20;
    outline.raycast = () => {};
    this.outlineMeshes[type] = outline;
    this.scene.add(outline);
  }

  rebuild(): void {
    this.entries = { rose: [], hydrangea: [], eucalyptus: [] };
    this.locationById.clear();
    this.instanceById = new Map(this.controller.doc.instances.map((instance) => [instance.id, instance]));

    const counts: Record<FlowerType, number> = { rose: 0, hydrangea: 0, eucalyptus: 0 };
    const matrix = new THREE.Matrix4();

    for (const instance of this.controller.doc.instances) {
      const index = counts[instance.type]++;
      this.entries[instance.type][index] = instance.id;
      this.locationById.set(instance.id, { type: instance.type, index });
      composeInstanceMatrix(instance, matrix);
      this.instanceMeshes[instance.type].setMatrixAt(index, matrix);
    }

    for (const type of FLOWER_ORDER) {
      const mesh = this.instanceMeshes[type];
      mesh.count = counts[type];
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.syncSelectionHelpers();
  }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformControls.setMode(mode);
  }

  setView(mode: ViewMode, animated = true): void {
    const target = new THREE.Vector3(0, 0.58, 0);
    let position: THREE.Vector3;
    let up = new THREE.Vector3(0, 1, 0);

    if (mode === 'top') {
      position = new THREE.Vector3(0.001, 13.2, 0.001);
      up = new THREE.Vector3(0, 0, -1);
    } else if (mode === 'side') {
      position = new THREE.Vector3(0, 2.35, 11.8);
    } else {
      position = new THREE.Vector3(6.8, 5.4, 8.6);
    }

    this.orbitControls.enableRotate = mode === 'free';
    this.orbitControls.mouseButtons.RIGHT = mode === 'free' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;

    if (!animated) {
      this.camera.up.copy(up);
      this.camera.position.copy(position);
      this.orbitControls.target.copy(target);
      this.camera.lookAt(target);
      this.orbitControls.update();
      this.viewTween = null;
      return;
    }

    this.viewTween = {
      start: performance.now(),
      duration: 460,
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.orbitControls.target.clone(),
      toTarget: target,
      fromUp: this.camera.up.clone(),
      toUp: up,
    };
    this.orbitControls.enabled = false;
  }

  syncSelectionHelpers(): void {
    const selected = this.controller.selection;
    if (selected.size === 0) {
      for (const type of FLOWER_ORDER) this.outlineMeshes[type].count = 0;
      this.outlinePass.selectedObjects = [];
      this.transformControls.detach();
      this.boxHelper.visible = false;
      return;
    }

    this.updateOutlineMatrices();
    this.outlinePass.selectedObjects = FLOWER_ORDER.map((type) => this.outlineMeshes[type]);
    this.controller.refreshSelectionInfo();
    const info = this.controller.selectionInfo;
    if (!info) return;

    this.selectionBox.min.fromArray(info.min);
    this.selectionBox.max.fromArray(info.max);
    this.boxHelper.visible = true;

    this.pivot.position.fromArray(info.center);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
    if (this.transformControls.object !== this.pivot) this.transformControls.attach(this.pivot);
  }

  private updateOutlineMatrices(): void {
    const counters: Record<FlowerType, number> = { rose: 0, hydrangea: 0, eucalyptus: 0 };
    const instanceMatrix = new THREE.Matrix4();
    const outlineMatrix = new THREE.Matrix4();
    const scaleMatrix = new THREE.Matrix4().makeScale(1.09, 1.09, 1.09);

    for (const id of this.controller.selection) {
      const location = this.locationById.get(id);
      if (!location) continue;
      const mesh = this.instanceMeshes[location.type];
      mesh.getMatrixAt(location.index, instanceMatrix);
      outlineMatrix.multiplyMatrices(instanceMatrix, scaleMatrix);
      const outline = this.outlineMeshes[location.type];
      const outlineIndex = counters[location.type]++;
      outline.setMatrixAt(outlineIndex, outlineMatrix);
    }

    for (const type of FLOWER_ORDER) {
      const outline = this.outlineMeshes[type];
      outline.count = counters[type];
      outline.instanceMatrix.needsUpdate = true;
    }
  }

  private handleResize = (): void => {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.outlinePass.resolution.set(width, height);
  };

  private handleContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.lastLocalPointer.set(x, y);
    this.pointerNdc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    // TransformControls 已命中手柄时，不启动框选。
    if (this.transformControls.dragging || this.transformControls.axis) return;

    this.updatePointer(event);
    this.marquee = {
      active: true,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      pointerId: event.pointerId,
      startX: this.lastLocalPointer.x,
      startY: this.lastLocalPointer.y,
      x: this.lastLocalPointer.x,
      y: this.lastLocalPointer.y,
    };
    this.orbitControls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    this.updatePointer(event);
    if (!this.marquee.active) return;

    this.marquee.x = this.lastLocalPointer.x;
    this.marquee.y = this.lastLocalPointer.y;
    const left = Math.min(this.marquee.startX, this.marquee.x);
    const top = Math.min(this.marquee.startY, this.marquee.y);
    const width = Math.abs(this.marquee.x - this.marquee.startX);
    const height = Math.abs(this.marquee.y - this.marquee.startY);

    Object.assign(this.marqueeElement.style, {
      display: 'block',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.marquee.active) return;
    const distance = Math.hypot(
      this.lastLocalPointer.x - this.marquee.startX,
      this.lastLocalPointer.y - this.marquee.startY,
    );
    const additive = this.marquee.additive;
    this.marquee.active = false;
    this.marqueeElement.style.display = 'none';
    this.orbitControls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }

    if (distance < 5) this.pickAtPointer(additive);
    else this.selectInsideMarquee(additive);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    this.marquee.active = false;
    this.marqueeElement.style.display = 'none';
    this.orbitControls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  private pickAtPointer(additive: boolean): void {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(FLOWER_ORDER.map((type) => this.instanceMeshes[type]), false);
    const hit = hits[0];
    if (hit?.instanceId === undefined || hit.instanceId === null) {
      if (!additive) this.controller.select([]);
      return;
    }

    const type = hit.object.userData.flowerType as FlowerType;
    const id = this.entries[type][hit.instanceId];
    if (!id) return;

    if (additive) {
      const next = new Set(this.controller.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.controller.select(next);
      return;
    }

    if (this.controller.selection.has(id)) return;

    const instance = this.instanceById.get(id);
    if (instance?.groupId) {
      const group = this.controller.doc.groups.find((g) => g.id === instance.groupId);
      if (group) {
        this.controller.select(group.memberIds);
        return;
      }
    }
    this.controller.select([id]);
  }

  private selectInsideMarquee(additive: boolean): void {
    const rect = this.host.getBoundingClientRect();
    const x1 = Math.min(this.marquee.startX, this.marquee.x);
    const x2 = Math.max(this.marquee.startX, this.marquee.x);
    const y1 = Math.min(this.marquee.startY, this.marquee.y);
    const y2 = Math.max(this.marquee.startY, this.marquee.y);
    const selected = new Set(additive ? this.controller.selection : []);

    const matrix = new THREE.Matrix4();
    const boxCenter = new THREE.Vector3();
    const projected = new THREE.Vector3();

    for (const instance of this.controller.doc.instances) {
      composeInstanceMatrix(instance, matrix);
      const geometry = getFlowerGeometry(instance.type);
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      geometry.boundingBox!.getCenter(boxCenter);
      projected.copy(boxCenter).applyMatrix4(matrix).project(this.camera);
      if (projected.z > 1 || projected.z < -1) continue;

      const sx = (projected.x * 0.5 + 0.5) * rect.width;
      const sy = (-projected.y * 0.5 + 0.5) * rect.height;
      if (sx >= x1 - 8 && sx <= x2 + 8 && sy >= y1 - 8 && sy <= y2 + 8) selected.add(instance.id);
    }

    this.controller.select(selected);
  }

  private handleDraggingChanged = (event: { value?: unknown }): void => {
    const dragging = Boolean(event.value);
    this.orbitControls.enabled = !dragging;
    if (dragging) this.beginInteraction();
    else this.endInteraction();
  };

  private beginInteraction(): void {
    if (this.controller.selection.size === 0) return;
    const items: DragItem[] = [];
    const selected = this.controller.selection;

    for (const id of selected) {
      const instance = this.instanceById.get(id);
      if (!instance) continue;
      const matrix = composeInstanceMatrix(instance, new THREE.Matrix4());
      items.push({
        id,
        startMatrix: matrix,
        startPos: new THREE.Vector3().setFromMatrixPosition(matrix),
        radius: collisionRadius(instance),
      });
    }

    const obstacles: Obstacle[] = [];
    for (const instance of this.controller.doc.instances) {
      if (selected.has(instance.id)) continue;
      obstacles.push({ x: instance.position[0], z: instance.position[2], r: collisionRadius(instance) });
    }

    this.pivot.updateMatrixWorld(true);
    this.interaction = {
      before: cloneDocument(this.controller.doc),
      mode: this.transformControls.mode,
      startPivotPosition: this.pivot.position.clone(),
      startPivotMatrix: this.pivot.matrixWorld.clone(),
      items,
      collisionGrid: this.transformControls.mode === 'translate' ? new CollisionGrid(obstacles) : null,
      moved: false,
    };
  }

  private handleObjectChange = (): void => {
    const interaction = this.interaction;
    if (!interaction) return;
    interaction.moved = true;

    let collisionBlocked = false;
    let translationX = 0;
    let translationZ = 0;

    if (interaction.mode === 'translate') {
      const translation = this.tmpVector
        .copy(this.pivot.position)
        .sub(interaction.startPivotPosition);
      translation.y = 0;
      const result = this.resolveCollisions(translation, interaction);
      translationX = result.x;
      translationZ = result.z;
      collisionBlocked = result.blocked;
      this.pivot.position.copy(interaction.startPivotPosition);
      this.pivot.position.x += translationX;
      this.pivot.position.z += translationZ;
      this.pivot.updateMatrixWorld(true);
    }

    this.tmpMatrix2.copy(interaction.startPivotMatrix).invert();
    const deltaMatrix = this.tmpMatrix.multiplyMatrices(this.pivot.matrixWorld, this.tmpMatrix2);
    const bakedMatrix = new THREE.Matrix4();

    for (const item of interaction.items) {
      bakedMatrix.multiplyMatrices(deltaMatrix, item.startMatrix);
      const location = this.locationById.get(item.id);
      const instance = this.instanceById.get(item.id);
      if (!location || !instance) continue;
      this.instanceMeshes[location.type].setMatrixAt(location.index, bakedMatrix);
      decomposeInstanceMatrix(instance, bakedMatrix);
    }

    for (const type of FLOWER_ORDER) this.instanceMeshes[type].instanceMatrix.needsUpdate = true;

    this.updateOutlineMatrices();
    this.controller.refreshSelectionInfo();
    if (this.controller.selectionInfo) {
      this.selectionBox.min.fromArray(this.controller.selectionInfo.min);
      this.selectionBox.max.fromArray(this.controller.selectionInfo.max);
    }
    this.uiDirty = true;
    this.showDragTooltip(interaction.mode, translationX, translationZ, collisionBlocked);
  };

  private resolveCollisions(
    translation: THREE.Vector3,
    interaction: InteractionState,
  ): { x: number; z: number; blocked: boolean } {
    let x = translation.x;
    let z = translation.z;
    let blocked = false;
    const tableRadius = this.controller.doc.tableRadius;
    const grid = interaction.collisionGrid;
    const nearby: Obstacle[] = [];

    for (let iteration = 0; iteration < 6; iteration++) {
      for (const item of interaction.items) {
        const cx = item.startPos.x + x;
        const cz = item.startPos.z + z;

        const centerDistance = Math.hypot(cx, cz);
        const tableLimit = tableRadius - item.radius - 0.04;
        if (centerDistance > tableLimit && centerDistance > 0.0001) {
          const overlap = centerDistance - tableLimit;
          x -= (cx / centerDistance) * overlap;
          z -= (cz / centerDistance) * overlap;
          blocked = true;
        }

        if (!grid) continue;
        grid.query(cx, cz, item.radius, nearby);
        for (const obstacle of nearby) {
          let dx = cx - obstacle.x;
          let dz = cz - obstacle.z;
          let distance = Math.hypot(dx, dz);
          const minimum = item.radius + obstacle.r + 0.035;
          if (distance >= minimum) continue;

          blocked = true;
          if (distance < 0.0001) {
            dx = 1;
            dz = 0;
            distance = 1;
          }
          const push = minimum - distance;
          x += (dx / distance) * push;
          z += (dz / distance) * push;
        }
      }
    }

    // 最后再检测一次，用于提示用户已到达密集区域。
    if (grid) {
      for (const item of interaction.items) {
        const cx = item.startPos.x + x;
        const cz = item.startPos.z + z;
        grid.query(cx, cz, item.radius, nearby);
        for (const obstacle of nearby) {
          const distance = Math.hypot(cx - obstacle.x, cz - obstacle.z);
          if (distance < item.radius + obstacle.r) blocked = true;
        }
      }
    }

    translation.x = x;
    translation.z = z;
    return { x, z, blocked };
  }

  private showDragTooltip(
    mode: 'translate' | 'rotate' | 'scale',
    dx: number,
    dz: number,
    blocked: boolean,
  ): void {
    const p = this.pivot.position;
    const round = (n: number) => Math.round(n * 100) / 100;
    let text = '';
    let subtext = '';

    if (mode === 'translate') {
      text = `X ${round(p.x)}　Y ${round(p.y)}　Z ${round(p.z)}`;
      subtext = `ΔX ${round(dx)}　ΔZ ${round(dz)} · ${blocked ? '已绕开花球/桌沿' : '已贴合桌面'}`;
    } else if (mode === 'rotate') {
      const degrees = Math.round(THREE.MathUtils.radToDeg(this.pivot.rotation.y));
      text = `旋转 Y ${degrees}°`;
      subtext = '15° 吸附已开启';
    } else {
      text = `缩放 ${this.pivot.scale.x.toFixed(2)}× / ${this.pivot.scale.y.toFixed(2)}×`;
      subtext = '组中心缩放';
    }

    this.tooltipElement.innerHTML = `<div class="tooltip-coords">${text}</div><div class="tooltip-sub ${blocked ? 'warning' : ''}">${subtext}</div>`;
    this.tooltipElement.style.display = 'block';

    const hostRect = this.host.getBoundingClientRect();
    const width = this.tooltipElement.offsetWidth || 180;
    let left = this.lastLocalPointer.x + 16;
    let top = this.lastLocalPointer.y + 18;
    if (left + width > hostRect.width - 8) left = this.lastLocalPointer.x - width - 12;
    if (top + 58 > hostRect.height - 8) top = this.lastLocalPointer.y - 62;
    this.tooltipElement.style.left = `${Math.max(8, left)}px`;
    this.tooltipElement.style.top = `${Math.max(8, top)}px`;
  }

  private hideTooltip(): void {
    this.tooltipElement.style.display = 'none';
  }

  private endInteraction(): void {
    const interaction = this.interaction;
    if (interaction?.moved) {
      const label = interaction.mode === 'translate' ? '移动' : interaction.mode === 'rotate' ? '旋转' : '缩放';
      this.controller.commitInteraction(label, interaction.before);
    }
    this.interaction = null;
    this.hideTooltip();
    this.syncSelectionHelpers();
  }

  private animate = (time: number): void => {
    if (this.viewTween) this.updateViewTween(time);
    this.orbitControls.update();

    if (this.uiDirty && time - this.lastUiEmit > 90) {
      this.uiDirty = false;
      this.lastUiEmit = time;
      this.controller.emit();
    }

    this.composer.render();
  };

  private updateViewTween(time: number): void {
    const tween = this.viewTween;
    if (!tween) return;
    const raw = Math.min(1, (time - tween.start) / tween.duration);
    const eased = 1 - (1 - raw) ** 3;
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    this.orbitControls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    this.camera.up.lerpVectors(tween.fromUp, tween.toUp, eased).normalize();
    this.camera.lookAt(this.orbitControls.target);
    if (raw >= 1) {
      this.viewTween = null;
      this.orbitControls.enabled = true;
      this.orbitControls.update();
    }
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    canvas.removeEventListener('contextmenu', this.handleContextMenu);

    this.transformControls.removeEventListener('dragging-changed', this.handleDraggingChanged);
    this.transformControls.removeEventListener('objectChange', this.handleObjectChange);
    this.transformControls.dispose();
    this.orbitControls.dispose();

    this.marqueeElement.remove();
    this.tooltipElement.remove();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
