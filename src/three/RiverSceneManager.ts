import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RiverPath } from '../river';
import type { DetectionSettings, Obstacle, ProjectDocument, SelectionGestureUpdate, TransformMode, Vec3Tuple } from '../types';
import { createObstacleVisual, disposeObject3D, type ObstacleVisual } from './obstacleFactory';

export interface SceneCallbacks {
  onSelect: (id: string | null, additive: boolean) => void;
  onTransformStart: () => void;
  onTransformChange: (updates: SelectionGestureUpdate[]) => void;
  onTransformEnd: () => void;
}

interface DragSnapshot {
  centroid: THREE.Vector3;
  rigPosition: THREE.Vector3;
  rigQuaternion: THREE.Quaternion;
  items: Array<{ id: string; position: THREE.Vector3; quaternion: THREE.Quaternion }>;
}

export interface HighlightState {
  lane: Set<string>;
  pair: Set<string>;
  reef: Set<string>;
  selected: Set<string>;
}

export class RiverSceneManager {
  private container: HTMLElement;
  private callbacks: SceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private transform: TransformControls;
  private transformHelper: THREE.Object3D;
  private rig = new THREE.Group();
  private obstacleLayer = new THREE.Group();
  private channelGroup = new THREE.Group();
  private riverPath: RiverPath;
  private views = new Map<string, ObstacleVisual>();
  private resizeObserver: ResizeObserver;
  private frameId = 0;
  private clock = new THREE.Clock();
  private flowTexture: THREE.CanvasTexture | null = null;
  private waterMaterial: THREE.MeshStandardMaterial | null = null;
  private selectedIds: string[] = [];
  private selectionKey = '';
  private rigAttached = false;
  private mode: TransformMode = 'translate';
  private dragSnapshot: DragSnapshot | null = null;
  private pointerStart = { x: 0, y: 0 };
  private gizmoPointerDown = false;
  private highlight: HighlightState = { lane: new Set(), pair: new Set(), reef: new Set(), selected: new Set() };
  private detection?: DetectionSettings;
  private disposed = false;

  constructor(container: HTMLElement, document: ProjectDocument, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.riverPath = new RiverPath(document.river);

    const width = container.clientWidth || 1200;
    const height = container.clientHeight || 700;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'river-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#b9d8ef');
    this.scene.fog = new THREE.Fog('#b9d8ef', 58, 145);

    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 260);
    this.camera.position.set(17, 20, 31);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.1, -7);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.075;
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.minDistance = 5;
    this.orbit.maxDistance = 95;
    this.orbit.update();

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.size = 0.82;
    this.transform.setMode(this.mode);
    this.transformHelper = this.transform.getHelper();
    this.transformHelper.visible = false;
    this.scene.add(this.transformHelper);
    this.scene.add(this.rig);

    this.setupLights();
    this.buildRiver(document);
    this.scene.add(this.obstacleLayer);

    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.animate();
  }

  private setupLights() {
    const hemi = new THREE.HemisphereLight('#e0f2fe', '#57534e', 1.65);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff7ed', 2.45);
    sun.position.set(20, 34, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -55;
    sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 95;
    sun.shadow.bias = -0.00025;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight('#93c5fd', 0.55);
    fill.position.set(-18, 12, -20);
    this.scene.add(fill);
  }

  private buildRiver(document: ProjectDocument) {
    const river = document.river;
    const path = this.riverPath;

    const ground = new THREE.Mesh(
      path.makeOffsetRibbon(0, 78, river.channelBottom - 0.32),
      new THREE.MeshStandardMaterial({ color: '#4d7c3f', roughness: 1, side: THREE.DoubleSide }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    const leftBank = new THREE.Mesh(
      path.makeOffsetRibbon(-river.width / 2 - 2.6, 5.2, 0.16),
      new THREE.MeshStandardMaterial({ color: '#6b8f3e', roughness: 0.95, side: THREE.DoubleSide }),
    );
    const rightBank = new THREE.Mesh(
      path.makeOffsetRibbon(river.width / 2 + 2.6, 5.2, 0.16),
      leftBank.material,
    );
    leftBank.receiveShadow = rightBank.receiveShadow = true;
    this.scene.add(leftBank, rightBank);

    const bed = new THREE.Mesh(
      path.makeRibbon(river.width - 1.2, river.channelBottom + 0.08),
      new THREE.MeshStandardMaterial({ color: '#8a7658', roughness: 1, side: THREE.DoubleSide }),
    );
    bed.receiveShadow = true;
    this.scene.add(bed);

    this.flowTexture = this.createFlowTexture();
    this.flowTexture.repeat.set(1, 1);
    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: this.flowTexture,
      transparent: true,
      opacity: 0.84,
      roughness: 0.16,
      metalness: 0.04,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const water = new THREE.Mesh(path.makeRibbon(river.width, river.waterLevel + 0.035), this.waterMaterial);
    water.receiveShadow = true;
    water.renderOrder = 2;
    this.scene.add(water);

    this.addFoamLines();
    this.addScenery();
    this.buildChannelHelpers(document);
    this.scene.add(this.channelGroup);

    const grid = new THREE.GridHelper(104, 52, '#64748b', '#334155');
    grid.position.y = river.channelBottom - 0.58;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((m) => {
      const line = m as THREE.LineBasicMaterial;
      line.transparent = true;
      line.opacity = 0.16;
    });
    this.scene.add(grid);
  }

  private createFlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, '#168fd2');
    gradient.addColorStop(0.5, '#0e74b8');
    gradient.addColorStop(1, '#0b5f9e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = 'rgba(224,242,254,.24)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (let y = -40; y < 300; y += 46) {
      ctx.beginPath();
      for (let x = -20; x <= 280; x += 12) {
        const yy = y + Math.sin(x * 0.045 + y) * 10;
        if (x === -20) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private addFoamLines() {
    for (const side of [-1, 1]) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 180; i++) {
        const p = this.riverPath.curve.getPointAt(i / 180);
        const tangent = this.riverPath.curve.getTangentAt(i / 180).normalize();
        const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
        p.addScaledVector(normal, side * (this.riverPath.config.width / 2 - 0.35));
        p.y = 0.08;
        points.push(p);
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.5 }),
      );
      this.scene.add(line);
    }
  }

  private addScenery() {
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: '#78716c', roughness: 1, flatShading: true });
    const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.18, 1.1, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#7c4a21', roughness: 1 });
    const leafGeometry = new THREE.ConeGeometry(0.85, 2.1, 8);
    const leafMaterials = [
      new THREE.MeshStandardMaterial({ color: '#166534', roughness: 0.9, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: '#15803d', roughness: 0.9, flatShading: true }),
    ];

    for (let i = 0; i < 42; i++) {
      const u = (i + 0.5) / 42;
      const p = this.riverPath.curve.getPointAt(u);
      const tangent = this.riverPath.curve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
      const side = i % 2 === 0 ? -1 : 1;
      const distance = this.riverPath.config.width / 2 + 1.2 + ((i * 37) % 45) / 10;
      p.addScaledVector(normal, side * distance);
      p.y = 0.2;

      if (i % 3 === 0) {
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        rock.position.copy(p);
        const scale = 0.35 + ((i * 17) % 10) / 12;
        rock.scale.set(scale * 1.4, scale * 0.75, scale);
        rock.rotation.set(i * 0.7, i * 1.3, i * 0.2);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.scene.add(rock);
      } else {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 0.55;
        trunk.castShadow = true;
        const leaves = new THREE.Mesh(leafGeometry, leafMaterials[i % 2]);
        leaves.position.y = 1.85;
        leaves.castShadow = true;
        tree.add(trunk, leaves);
        tree.position.copy(p);
        const scale = 0.75 + ((i * 23) % 10) / 16;
        tree.scale.setScalar(scale);
        this.scene.add(tree);
      }
    }
  }

  private buildChannelHelpers(document: ProjectDocument) {
    const width = document.river.centerWidth;
    const area = new THREE.Mesh(
      this.riverPath.makeRibbon(width, 0.11, 180),
      new THREE.MeshBasicMaterial({
        color: '#22c55e',
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    area.renderOrder = 4;
    this.channelGroup.add(area);

    for (const side of [-1, 1]) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 180; i++) {
        const u = i / 180;
        const p = this.riverPath.curve.getPointAt(u);
        const tangent = this.riverPath.curve.getTangentAt(u).normalize();
        const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
        p.addScaledVector(normal, side * width / 2);
        p.y = 0.16;
        points.push(p);
      }
      const edge = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.72, depthTest: false }),
      );
      edge.renderOrder = 30;
      this.channelGroup.add(edge);
    }

    const segmentMaterial = new THREE.LineBasicMaterial({
      color: '#86efac',
      transparent: true,
      opacity: 0.12,
      depthTest: false,
    });
    for (const segment of this.riverPath.channelSegments()) {
      const height = document.river.channelTop - document.river.channelBottom;
      const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, segment.length));
      const edges = new THREE.LineSegments(geometry, segmentMaterial);
      edges.position.set(...segment.position);
      edges.rotation.y = segment.angleY;
      edges.renderOrder = 18;
      this.channelGroup.add(edges);
    }
  }

  private bindEvents() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    this.transform.addEventListener('dragging-changed', this.handleDraggingChanged);
    this.transform.addEventListener('objectChange', this.handleObjectChange);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
      return;
    }
    if (event.key === 'w' || event.key === 'W') this.setMode('translate');
    if (event.key === 'e' || event.key === 'E') this.setMode('rotate');
    if (event.key === 'Escape') this.callbacks.onSelect(null, false);
  };

  private handlePointerDown = (event: PointerEvent) => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.gizmoPointerDown = Boolean(this.transform.axis) || this.transform.dragging;
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (this.gizmoPointerDown || this.transform.dragging) return;
    const moved = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
    if (moved > 6) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObjects(this.obstacleLayer.children, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.obstacleId) object = object.parent;
      if (object?.userData.obstacleId) {
        this.callbacks.onSelect(String(object.userData.obstacleId), event.shiftKey);
        return;
      }
    }
    this.callbacks.onSelect(null, event.shiftKey);
  };

  private handleDraggingChanged = (event: { value?: unknown }) => {
    const dragging = Boolean(event.value);
    this.orbit.enabled = !dragging;
    if (dragging) {
      this.callbacks.onTransformStart();
      const items = this.selectedIds
        .map((id) => {
          const root = this.views.get(id)?.root;
          return root ? { id, position: root.position.clone(), quaternion: root.quaternion.clone() } : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      this.dragSnapshot = {
        centroid: this.rig.position.clone(),
        rigPosition: this.rig.position.clone(),
        rigQuaternion: this.rig.quaternion.clone(),
        items,
      };
    } else {
      this.dragSnapshot = null;
      this.callbacks.onTransformEnd();
    }
  };

  private handleObjectChange = () => {
    const snapshot = this.dragSnapshot;
    if (!snapshot) return;
    const deltaQuaternion = this.rig.quaternion.clone().multiply(snapshot.rigQuaternion.clone().invert());
    const deltaPosition = this.rig.position.clone().sub(snapshot.rigPosition);
    const euler = new THREE.Euler(0, 0, 0, 'XYZ');

    const updates: SelectionGestureUpdate[] = snapshot.items.map((item) => {
      const offset = item.position.clone().sub(snapshot.centroid).applyQuaternion(deltaQuaternion);
      const position = snapshot.centroid.clone().add(deltaPosition).add(offset);
      const quaternion = deltaQuaternion.clone().multiply(item.quaternion);
      euler.setFromQuaternion(quaternion, 'XYZ');
      return {
        id: item.id,
        position: [position.x, position.y, position.z],
        rotation: [
          THREE.MathUtils.radToDeg(euler.x),
          THREE.MathUtils.radToDeg(euler.y),
          THREE.MathUtils.radToDeg(euler.z),
        ],
      };
    });
    this.callbacks.onTransformChange(updates);
  };

  setMode(mode: TransformMode) {
    this.mode = mode;
    this.transform.setMode(mode);
  }

  getMode(): TransformMode {
    return this.mode;
  }

  screenToWaterPoint(clientX: number, clientY: number): Vec3Tuple | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.riverPath.config.waterLevel);
    const point = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, point);
    if (!hit) return null;
    return [point.x, 0, point.z];
  }

  sync(obstacles: Obstacle[], selectedIds: string[], detection: DetectionSettings) {
    this.detection = detection;
    this.selectedIds = selectedIds;
    const selectedSet = new Set(selectedIds);
    this.highlight.selected = selectedSet;

    const ids = new Set(obstacles.map((o) => o.id));
    for (const [id, view] of this.views) {
      if (!ids.has(id)) {
        this.obstacleLayer.remove(view.root);
        disposeObject3D(view.root);
        this.views.delete(id);
      }
    }

    for (const obstacle of obstacles) {
      let view = this.views.get(obstacle.id);
      if (!view) {
        view = createObstacleVisual(obstacle);
        this.views.set(obstacle.id, view);
        this.obstacleLayer.add(view.root);
      }
      const root = view.root;
      root.position.set(...obstacle.position);
      root.rotation.set(
        THREE.MathUtils.degToRad(obstacle.rotation[0]),
        THREE.MathUtils.degToRad(obstacle.rotation[1]),
        THREE.MathUtils.degToRad(obstacle.rotation[2]),
      );
      root.scale.set(...obstacle.scale);

      if (view.waterRing) {
        view.waterRing.position.y = (0.065 - obstacle.position[1]) / Math.max(obstacle.scale[1], 0.05);
      }
      if (view.measureLine) {
        view.measureLine.visible = obstacle.kind === 'buoy' && selectedSet.has(obstacle.id);
        const positionAttribute = view.measureLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        const x = 0.98 / Math.max(obstacle.scale[0], 0.05);
        const bottomY = (0.08 - obstacle.position[1]) / Math.max(obstacle.scale[1], 0.05);
        const topY = (obstacle.position[1] + 0.82 - obstacle.position[1]) / Math.max(obstacle.scale[1], 0.05);
        positionAttribute.setXYZ(0, x, bottomY, 0);
        positionAttribute.setXYZ(1, x, topY, 0);
        positionAttribute.needsUpdate = true;
        view.measureLine.geometry.computeBoundingSphere();
      }

      view.badge.sprite.position.y = view.topLocal + 0.58 / Math.max(obstacle.scale[1], 0.05);
      view.badge.sprite.scale.set(
        2.15 / Math.max(Math.sqrt(obstacle.scale[0] * obstacle.scale[2]), 0.2),
        0.81 / Math.max(obstacle.scale[1], 0.2),
        1,
      );

      const showCollider = detection.showColliders || selectedSet.has(obstacle.id);
      for (const material of view.colliderMaterials) material.visible = showCollider;
      for (const material of view.lineMaterials) material.visible = showCollider;
    }

    this.channelGroup.visible = detection.showChannel;
    this.updateSelectionRig(obstacles, selectedIds);
    this.applyHighlightStyles();
  }

  private updateSelectionRig(obstacles: Obstacle[], selectedIds: string[]) {
    const key = selectedIds.join('|');
    if (this.transform.dragging) {
      this.selectionKey = key;
      return;
    }

    const selected = obstacles.filter((o) => selectedIds.includes(o.id));
    if (!selected.length) {
      if (key !== this.selectionKey || this.rigAttached) {
        this.transform.detach();
        this.rigAttached = false;
        this.transformHelper.visible = false;
      }
      this.selectionKey = key;
      return;
    }

    const centroid = selected.reduce(
      (acc, o) => acc.add(new THREE.Vector3(...o.position)),
      new THREE.Vector3(),
    ).multiplyScalar(1 / selected.length);
    this.rig.position.copy(centroid);

    if (key !== this.selectionKey || !this.rigAttached) {
      this.rig.quaternion.identity();
      this.rig.scale.set(1, 1, 1);
      this.transformHelper.visible = true;
      this.transform.attach(this.rig);
      this.rigAttached = true;
      this.transform.setMode(this.mode);
    }
    this.selectionKey = key;
  }

  setHighlights(highlight: HighlightState) {
    this.highlight = highlight;
    this.applyHighlightStyles();
  }

  private applyHighlightStyles() {
    for (const [id, view] of this.views) {
      const isLane = this.highlight.lane.has(id);
      const isPair = this.highlight.pair.has(id);
      const isReef = this.highlight.reef.has(id);
      const isSelected = this.highlight.selected.has(id);
      const alertColor = isLane ? '#ff3158' : isPair ? '#c084fc' : isReef ? '#38bdf8' : isSelected ? '#22d3ee' : '#38bdf8';
      const emissive = isLane ? '#7f1d1d' : isPair ? '#4c1d95' : isReef ? '#075985' : '#000000';

      for (const material of view.bodyMaterials) {
        material.emissive.set(emissive);
        material.emissiveIntensity = isLane || isPair ? 0.42 : isReef ? 0.32 : 0;
      }
      for (const material of view.colliderMaterials) {
        material.color.set(alertColor);
        material.opacity = isLane ? 0.18 : isPair ? 0.16 : isSelected ? 0.11 : 0.055;
      }
      for (const material of view.lineMaterials) {
        material.color.set(alertColor);
        material.opacity = isLane || isPair || isSelected ? 0.95 : 0.62;
      }

      if (!this.detection?.showLabels) {
        view.badge.hide();
      } else if (isLane) {
        view.badge.set('占道', '#e11d48');
      } else if (isPair) {
        view.badge.set('穿插', '#9333ea');
      } else if (isReef) {
        view.badge.set('暗礁', '#0284c7');
      } else {
        view.badge.hide();
      }
    }
  }

  focusSelection() {
    if (!this.selectedIds.length) return;
    const positions = this.selectedIds
      .map((id) => this.views.get(id)?.root.position)
      .filter((p): p is THREE.Vector3 => Boolean(p));
    if (!positions.length) return;
    const target = positions.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / positions.length);
    this.orbit.target.lerp(target, 1);
    this.orbit.update();
  }

  private resize() {
    if (this.disposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = () => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;
    if (this.flowTexture) this.flowTexture.offset.y -= delta * 0.055;

    for (const [id, view] of this.views) {
      const pulse = this.highlight.lane.has(id) || this.highlight.pair.has(id);
      if (pulse) {
        const opacity = 0.55 + Math.sin(elapsed * 7.5) * 0.28;
        view.lineMaterials.forEach((m) => (m.opacity = opacity));
      }
      if (view.badge.sprite.visible && (this.highlight.lane.has(id) || this.highlight.pair.has(id))) {
        const scale = 1 + Math.sin(elapsed * 6) * 0.055;
        view.badge.sprite.material.rotation = 0;
        view.badge.sprite.scale.multiplyScalar(1);
        view.badge.sprite.userData.pulse = scale;
      }
    }

    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.transform.removeEventListener('dragging-changed', this.handleDraggingChanged);
    this.transform.removeEventListener('objectChange', this.handleObjectChange);
    this.transform.dispose();
    this.orbit.dispose();
    for (const view of this.views.values()) disposeObject3D(view.root);
    this.views.clear();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry?.dispose();
        const material = object.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      }
    });
    this.flowTexture?.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
