import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BRUSH_META, DIAMETER_BY_LEVEL, STRENGTH_BY_LEVEL } from './brushConfig';
import { StrokeHistory, type StrokeRecord } from './history';
import { SculptKernel, computeBrushPlane, type StampRequest, type StampResult } from './kernel';
import { createDollHeadGeometry } from './createDollHead';
import { buildTopology, type Topology } from './topology';
import { exportMeshAsGLB, exportMeshAsOBJ, importGeometryFromFile } from './meshIO';
import type {
  BrushSettings,
  HistorySnapshot,
  MeshStats,
  SymmetrySettings,
} from './types';

export interface SculptEngineCallbacks {
  onHistoryChange?: (snapshot: HistorySnapshot) => void;
  onStats?: (stats: MeshStats) => void;
  onStrokeActiveChange?: (active: boolean) => void;
  onError?: (message: string) => void;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function makeBrushRing(color: number): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.RingGeometry(0.93, 1, 128);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.renderOrder = 1000;
  ring.raycast = () => undefined;
  ring.visible = false;
  return ring;
}

export class SculptEngine {
  private container: HTMLDivElement;
  private callbacks: SculptEngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2(-10, -10);
  private resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private lastFrameTime = performance.now();
  private disposed = false;

  private material: THREE.MeshStandardMaterial;
  private mesh: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private topology: Topology | null = null;
  private kernel: SculptKernel | null = null;
  private history: StrokeHistory | null = null;
  private axisEpsilon = 0.002;

  private mainRing = makeBrushRing(0x67e8f9);
  private mirrorRing = makeBrushRing(0xf0abfc);
  private symmetryGuide = new THREE.Group();

  private brush: BrushSettings = {
    kind: 'raise',
    diameterLevel: 2,
    strengthLevel: 2,
  };

  private symmetry: SymmetrySettings = {
    enabled: true,
    axis: 'x',
    affectPositive: true,
    affectNegative: true,
    lockAxis: true,
  };

  private pointerInside = false;
  private sculpting = false;
  private inputLocked = false;
  private activePointerId: number | null = null;
  private hoverHit: THREE.Intersection | null = null;
  private lastStampCenter: THREE.Vector3 | null = null;
  private dragPlane = new THREE.Plane();
  private lastDragPoint = new THREE.Vector3();
  private strokePlane: StampRequest['plane'] = null;
  private strokeAffected = new Set<number>();
  private pointerStartSide: -1 | 1 = 1;

  constructor(container: HTMLDivElement, callbacks: SculptEngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 100);
    this.camera.position.set(0, 0.25, 5.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.mouseButtons = {
      LEFT: -1 as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: -1 as unknown as THREE.TOUCH,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    this.material = new THREE.MeshStandardMaterial({
      color: 0xe8b88f,
      roughness: 0.64,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    this.setupLights();
    this.setupSymmetryGuide();
    this.scene.add(this.mainRing, this.mirrorRing, this.symmetryGuide);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('pointerenter', this.handlePointerEnter);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('contextmenu', this.handleContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.loadGeometry(createDollHeadGeometry(), '内置偶头基础网格', '内置基础网格');
    this.animate();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xfff1df, 0x26324d, 1.8);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3.5, 4.5, 5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8db8ff, 1.1);
    fill.position.set(-4, 1.5, 3);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xf0abfc, 1.25);
    rim.position.set(-2.5, 3, -4);
    this.scene.add(rim);
  }

  private setupSymmetryGuide(): void {
    const planeGeometry = new THREE.PlaneGeometry(5.2, 5.2);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.y = Math.PI / 2;
    plane.renderOrder = 1;

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(planeGeometry),
      new THREE.LineBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.24,
        depthTest: false,
      }),
    );
    edges.rotation.y = Math.PI / 2;
    edges.renderOrder = 999;

    this.symmetryGuide.add(plane, edges);
    this.symmetryGuide.visible = this.symmetry.enabled;
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    this.controls.update();

    if (this.sculpting && !this.inputLocked && this.mesh && this.kernel) {
      const hit = this.pick();
      this.hoverHit = hit;
      if (hit && this.brush.kind !== 'grab') {
        this.applyContinuousStamp(hit.point, dt);
      }
      if (hit) this.updateRings(hit);
    }

    this.renderer.render(this.scene, this.camera);
  };

  getRadius(): number {
    return DIAMETER_BY_LEVEL[this.brush.diameterLevel] / 2;
  }

  setBrush(brush: BrushSettings): void {
    this.brush = brush;
    this.mainRing.scale.setScalar(this.getRadius());
    this.mirrorRing.scale.setScalar(this.getRadius());
  }

  setSymmetry(symmetry: SymmetrySettings): void {
    this.symmetry = symmetry;
    this.symmetryGuide.visible = symmetry.enabled;
    this.mirrorRing.visible =
      symmetry.enabled && this.pointerInside && this.mainRing.visible;
  }

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
    if (locked && this.sculpting) {
      this.cancelStroke();
    }
  }

  loadGeometry(geometry: THREE.BufferGeometry, name: string, source: string): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }

    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = name;
    this.scene.add(this.mesh);

    const normalAttribute = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const vertexCount = positionAttribute.count;
    this.topology = buildTopology(geometry.index?.array ?? null, vertexCount);

    const size = new THREE.Vector3();
    geometry.boundingBox?.getSize(size);
    const maxDimension = Math.max(size.x, size.y, size.z);
    this.axisEpsilon = Math.max(0.0004, maxDimension * 5e-4);

    this.kernel = new SculptKernel(
      positionAttribute.array as Float32Array,
      normalAttribute.array as Float32Array,
      this.topology,
      this.axisEpsilon,
    );
    this.history = new StrokeHistory(positionAttribute.array as Float32Array);

    this.frameMesh();
    this.mainRing.scale.setScalar(this.getRadius());
    this.mirrorRing.scale.setScalar(this.getRadius());
    this.symmetryGuide.visible = this.symmetry.enabled;

    const triangles = geometry.index
      ? geometry.index.count / 3
      : vertexCount / 3;
    this.callbacks.onStats?.({
      name,
      source,
      vertices: vertexCount,
      triangles: Math.round(triangles),
    });
    this.emitHistory();
  }

  async loadFile(file: File): Promise<void> {
    const geometry = await importGeometryFromFile(file);
    this.loadGeometry(geometry, file.name, '文件导入');
  }

  loadBuiltIn(): void {
    this.loadGeometry(createDollHeadGeometry(), '内置偶头基础网格', '内置基础网格');
  }

  private frameMesh(): void {
    if (!this.geometry) return;
    this.geometry.computeBoundingSphere();
    const sphere = this.geometry.boundingSphere;
    if (!sphere) return;

    const center = sphere.center.clone();
    const radius = Math.max(0.1, sphere.radius);
    this.controls.target.copy(center);

    const verticalHalfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const aspect = Math.max(0.2, this.camera.aspect);
    const verticalDistance = radius / Math.sin(verticalHalfFov);
    const horizontalDistance = radius / (Math.sin(verticalHalfFov) * aspect);
    const distance = Math.max(verticalDistance, horizontalDistance) * 1.12;

    this.camera.position.set(
      center.x,
      center.y + radius * 0.08,
      center.z + distance,
    );
    this.camera.near = Math.max(0.01, distance / 100);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.55;
    this.controls.maxDistance = radius * 6;
    this.controls.update();
  }

  private updatePointerNdc(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pick(): THREE.Intersection | null {
    if (!this.mesh) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.mesh, false);
    return hits[0] ?? null;
  }

  private getHitNormal(hit: THREE.Intersection): THREE.Vector3 {
    const normal = new THREE.Vector3();
    const normalAttribute = this.geometry?.getAttribute('normal') as
      | THREE.BufferAttribute
      | undefined;

    if (normalAttribute && this.geometry) {
      let a = 0;
      let b = 1;
      let c = 2;
      if (hit.faceIndex != null) {
        if (this.geometry.index) {
          const index = this.geometry.index;
          const start = hit.faceIndex * 3;
          a = index.getX(start);
          b = index.getX(start + 1);
          c = index.getX(start + 2);
        } else {
          a = hit.faceIndex * 3;
          b = a + 1;
          c = a + 2;
        }
      } else if (hit.face) {
        a = hit.face.a;
        b = hit.face.b;
        c = hit.face.c;
      }
      normal
        .fromBufferAttribute(normalAttribute, a)
        .add(new THREE.Vector3().fromBufferAttribute(normalAttribute, b))
        .add(new THREE.Vector3().fromBufferAttribute(normalAttribute, c))
        .normalize();
    }

    if (normal.lengthSq() < 1e-8 && hit.face?.normal) {
      normal.copy(hit.face.normal).normalize();
    }
    if (normal.lengthSq() < 1e-8) {
      normal.copy(this.raycaster.ray.direction).negate();
    }
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate();
    return normal;
  }

  private offsetNormal(normal: THREE.Vector3): number {
    const sphereRadius = this.geometry?.boundingSphere?.radius ?? 2;
    return sphereRadius * 0.002;
  }

  private isSideEnabled(side: -1 | 0 | 1): boolean {
    if (!this.symmetry.enabled) return true;
    if (side === 1) return this.symmetry.affectPositive;
    if (side === -1) return this.symmetry.affectNegative;
    return this.symmetry.affectPositive || this.symmetry.affectNegative;
  }

  private updateRings(hit: THREE.Intersection | null): void {
    if (!hit || !this.pointerInside) {
      this.mainRing.visible = false;
      this.mirrorRing.visible = false;
      return;
    }

    const normal = this.getHitNormal(hit);
    const offset = this.offsetNormal(normal);
    const mainSide: -1 | 0 | 1 =
      Math.abs(hit.point.x) <= this.axisEpsilon ? 0 : hit.point.x > 0 ? 1 : -1;
    const mirrorSide: -1 | 0 | 1 = mainSide === 0 ? 0 : mainSide === 1 ? -1 : 1;

    this.mainRing.visible = true;
    this.mainRing.material.opacity = this.isSideEnabled(mainSide) ? 0.94 : 0.18;
    this.mainRing.position.copy(hit.point).addScaledVector(normal, offset);
    this.mainRing.quaternion.setFromUnitVectors(Z_AXIS, normal);
    this.mainRing.scale.setScalar(this.getRadius());

    if (this.symmetry.enabled) {
      const mirrorPoint = hit.point.clone();
      mirrorPoint.x *= -1;
      const mirrorNormal = normal.clone();
      mirrorNormal.x *= -1;
      this.mirrorRing.visible = true;
      this.mirrorRing.material.opacity = this.isSideEnabled(mirrorSide) ? 0.9 : 0.16;
      this.mirrorRing.position.copy(mirrorPoint).addScaledVector(mirrorNormal, offset);
      this.mirrorRing.quaternion.setFromUnitVectors(
        Z_AXIS,
        mirrorNormal.normalize(),
      );
      this.mirrorRing.scale.setScalar(this.getRadius());
    } else {
      this.mirrorRing.visible = false;
    }
  }

  private handleContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private handlePointerEnter = (): void => {
    this.pointerInside = true;
  };

  private handlePointerLeave = (): void => {
    this.pointerInside = false;
    if (!this.sculpting) {
      this.mainRing.visible = false;
      this.mirrorRing.visible = false;
    }
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.inputLocked) return;
    this.updatePointerNdc(event);
    const hit = this.pick();
    if (!hit || !this.history || !this.kernel) return;

    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.controls.enabled = false;
    this.sculpting = true;
    this.hoverHit = hit;
    this.strokeAffected.clear();
    this.history.beginStroke(this.getPositionArray());

    const radius = this.getRadius();
    const normal = this.getHitNormal(hit);
    this.pointerStartSide = hit.point.x < 0 ? -1 : 1;
    this.lastStampCenter = hit.point.clone();

    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    this.dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, hit.point);
    this.lastDragPoint.copy(hit.point);

    this.strokePlane =
      this.brush.kind === 'flatten'
        ? computeBrushPlane(
            this.getPositionArray(),
            this.getNormalArray(),
            hit.point,
            radius,
            normal,
          )
        : null;

    if (this.brush.kind !== 'grab') {
      this.runStamp({
        kind: this.brush.kind,
        center: hit.point,
        radius,
        strength: this.getStrength(),
        dt: 1 / 60,
        plane: this.strokePlane,
        fallbackNormal: normal,
        symmetry: this.symmetry,
      });
      this.syncGeometry();
    }

    this.updateRings(hit);
    this.callbacks.onStrokeActiveChange?.(true);
  };

  private getStrength(): number {
    return STRENGTH_BY_LEVEL[this.brush.strengthLevel];
  }

  private handlePointerMove = (event: PointerEvent): void => {
    this.updatePointerNdc(event);
    this.pointerInside = true;
    const hit = this.pick();
    this.hoverHit = hit;

    if (!this.sculpting || this.activePointerId !== event.pointerId || !hit) {
      this.updateRings(hit);
      return;
    }

    if (this.brush.kind === 'grab' && this.kernel) {
      const planePoint = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, planePoint)) return;

      const delta = planePoint.clone().sub(this.lastDragPoint);
      this.lastDragPoint.copy(planePoint);

      const fromCenter = this.lastStampCenter ?? hit.point.clone();
      const radius = this.getRadius();
      const steps = Math.max(
        1,
        Math.min(40, Math.ceil(delta.length() / Math.max(0.02, radius * 0.16))),
      );
      const subDelta = delta.clone().divideScalar(steps);

      for (let step = 1; step <= steps; step += 1) {
        const center = fromCenter.clone().lerp(hit.point, step / steps);
        this.runStamp({
          kind: 'grab',
          center,
          radius,
          strength: this.getStrength(),
          dt: 1 / 60,
          grabDelta: subDelta,
          symmetry: this.symmetry,
        });
      }

      this.lastStampCenter?.copy(hit.point);
      this.syncGeometry();
      this.updateRings(hit);
    }
  };

  private applyContinuousStamp(point: THREE.Vector3, dt: number): void {
    if (!this.kernel) return;
    const radius = this.getRadius();
    const strength = this.getStrength();

    if (!this.lastStampCenter) this.lastStampCenter = point.clone();
    const travel = this.lastStampCenter.distanceTo(point);
    const spacing = radius * 0.3;

    if (travel > spacing * 1.15) {
      const steps = Math.min(24, Math.max(1, Math.floor(travel / spacing)));
      for (let step = 1; step <= steps; step += 1) {
        const center = this.lastStampCenter.clone().lerp(point, step / steps);
        this.runStamp({
          kind: this.brush.kind,
          center,
          radius,
          strength,
          dt: 1 / 60,
          plane: this.strokePlane,
          fallbackNormal: this.getHitNormal(this.hoverHit!),
          symmetry: this.symmetry,
        });
      }
      this.lastStampCenter.copy(point);
    } else {
      this.runStamp({
        kind: this.brush.kind,
        center: point,
        radius,
        strength,
        dt,
        plane: this.strokePlane,
        fallbackNormal: this.hoverHit ? this.getHitNormal(this.hoverHit) : { x: 0, y: 0, z: 1 },
        symmetry: this.symmetry,
      });
      this.lastStampCenter.copy(point);
    }

    this.syncGeometry();
  }

  private runStamp(request: StampRequest): StampResult | null {
    if (!this.kernel) return null;
    const result = this.kernel.applyStamp(request);
    for (const index of result.indices) this.strokeAffected.add(index);
    return result;
  }

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.sculpting || this.activePointerId !== event.pointerId) return;
    this.commitStroke();
    this.finishPointer(event);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) return;
    this.cancelStroke();
    this.finishPointer(event);
  };

  private finishPointer(event: PointerEvent): void {
    this.sculpting = false;
    this.activePointerId = null;
    this.lastStampCenter = null;
    this.strokePlane = null;
    this.controls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    this.callbacks.onStrokeActiveChange?.(false);
    const hit = this.pick();
    this.updateRings(hit);
  }

  cancelStroke(): void {
    if (this.history) this.history.cancelStroke();
    this.strokeAffected.clear();
    this.sculpting = false;
    this.activePointerId = null;
    this.lastStampCenter = null;
    this.strokePlane = null;
    if (this.renderer) this.controls.enabled = true;
    this.callbacks.onStrokeActiveChange?.(false);
  }

  private commitStroke(): StrokeRecord | null {
    if (!this.history || !this.kernel) return null;
    const positions = this.getPositionArray();

    let pointerCount = this.strokeAffected.size;
    let mirrorCount = 0;
    let axisCount = 0;

    if (this.symmetry.enabled) {
      pointerCount = 0;
      this.strokeAffected.forEach((index) => {
        const x = positions[index * 3];
        if (Math.abs(x) <= this.axisEpsilon) {
          axisCount += 1;
        } else if (Math.sign(x) === this.pointerStartSide) {
          pointerCount += 1;
        } else {
          mirrorCount += 1;
        }
      });
    }

    const record = this.history.commitStroke(positions, this.strokeAffected, {
      brush: this.brush.kind,
      title: BRUSH_META[this.brush.kind].name,
      diameterLevel: this.brush.diameterLevel,
      strengthLevel: this.brush.strengthLevel,
      symmetric: this.symmetry.enabled,
      pointerCount,
      mirrorCount,
      axisCount,
    });

    this.strokeAffected.clear();
    this.syncGeometry();
    this.emitHistory();
    return record;
  }

  private getPositionArray(): Float32Array {
    if (!this.geometry) return new Float32Array();
    return (this.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array as Float32Array;
  }

  private getNormalArray(): Float32Array | null {
    const attribute = this.geometry?.getAttribute('normal') as
      | THREE.BufferAttribute
      | undefined;
    return (attribute?.array as Float32Array | undefined) ?? null;
  }

  private syncGeometry(): void {
    if (!this.geometry) return;
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    const normal = this.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (normal) normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  private emitHistory(): void {
    if (this.history) this.callbacks.onHistoryChange?.(this.history.summary());
  }

  undo(): void {
    if (!this.history || this.inputLocked) return;
    this.history.undo(this.getPositionArray());
    this.syncGeometry();
    this.emitHistory();
  }

  redo(): void {
    if (!this.history || this.inputLocked) return;
    this.history.redo(this.getPositionArray());
    this.syncGeometry();
    this.emitHistory();
  }

  /** Programmatic timed replay is allowed while pointer input is locked. */
  replayNext(): void {
    if (!this.history) return;
    this.history.redo(this.getPositionArray());
    this.syncGeometry();
    this.emitHistory();
  }

  resetForReplay(): void {
    if (!this.history) return;
    this.history.resetToBase(this.getPositionArray());
    this.syncGeometry();
    this.emitHistory();
  }

  replayToStroke(index: number): void {
    if (!this.history || this.inputLocked) return;
    this.history.replayTo(this.getPositionArray(), index);
    this.syncGeometry();
    this.emitHistory();
  }

  getHistorySnapshot(): HistorySnapshot | null {
    return this.history?.summary() ?? null;
  }

  getStrokeDetail(id: number) {
    return this.history?.detailRows(id, 500) ?? [];
  }

  exportOBJ(): void {
    if (!this.mesh) throw new Error('网格尚未就绪');
    this.syncGeometry();
    exportMeshAsOBJ(this.mesh);
  }

  async exportGLB(): Promise<void> {
    if (!this.mesh) throw new Error('网格尚未就绪');
    this.syncGeometry();
    await exportMeshAsGLB(this.mesh);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    canvas.removeEventListener('pointerenter', this.handlePointerEnter);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    canvas.removeEventListener('contextmenu', this.handleContextMenu);

    this.controls.dispose();
    if (this.mesh) this.mesh.geometry.dispose();
    this.material.dispose();
    this.mainRing.geometry.dispose();
    this.mainRing.material.dispose();
    this.mirrorRing.geometry.dispose();
    this.mirrorRing.material.dispose();
    this.symmetryGuide.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.LineSegments;
      if ('geometry' in renderable) renderable.geometry.dispose();
      const material = (renderable as THREE.Mesh).material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    });
    this.renderer.dispose();
    canvas.remove();
  }
}
