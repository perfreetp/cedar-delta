/**
 * SceneEngine：three.js 渲染中枢
 * - 透视/俯视相机切换
 * - OrbitControls（交互期间由控制器禁用）
 * - 网格、灯光、选择轮廓、吸附辅助线、放置幽灵预览
 * - BVH 地面射线拾取 + 实例化物体射线拾取
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PlacedObject, Region, ViewMode } from '../types';
import { createGround } from './ground';
import { InstanceLayer } from './instanced';
import type { SnapGuide } from '../lib/snap';

export class SceneEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly perspectiveCamera: THREE.PerspectiveCamera;
  readonly topCamera: THREE.OrthographicCamera;
  readonly controls: OrbitControls;
  readonly ground: ReturnType<typeof createGround>;
  readonly instances = new InstanceLayer();
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private grid: THREE.GridHelper;
  private outlineGroup = new THREE.Group();
  private guideGroup = new THREE.Group();
  private ghost: THREE.Mesh | null = null;
  private hoverMarker: THREE.Mesh;
  private frame = 0;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  viewMode: ViewMode = 'perspective';

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // 相机
    const aspect = container.clientWidth / container.clientHeight;
    this.perspectiveCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.perspectiveCamera.position.set(22, 20, 26);
    this.topCamera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 1000);
    // 屏幕上方对应世界 -z（场地平面的常规俯视朝向）
    this.topCamera.up.set(0, 0, -1);
    this.topCamera.position.set(0, 60, 0);
    this.topCamera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.perspectiveCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.target.set(0, 0, 0);
    // 左键留给业务交互（选择/框选/绘制），右键旋转、中键平移、滚轮缩放
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };

    // 灯光
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc8d4e0, 0.85);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.25);
    dir.position.set(18, 30, 12);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -45;
    dir.shadow.camera.right = 45;
    dir.shadow.camera.top = 45;
    dir.shadow.camera.bottom = -45;
    dir.shadow.camera.far = 100;
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    // 网格
    this.grid = new THREE.GridHelper(200, 200, 0x9aa7b5, 0xd4dbe3);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.grid.position.y = 0.005;
    this.scene.add(this.grid);

    // 地面（含区域边界与拾取基底）
    this.ground = createGround();
    this.scene.add(this.ground.group);

    // 实例层与辅助对象
    this.scene.add(this.instances.group);
    this.outlineGroup.name = 'selection-outlines';
    this.scene.add(this.outlineGroup);
    this.guideGroup.name = 'snap-guides';
    this.scene.add(this.guideGroup);

    // 悬停位置标记
    this.hoverMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.34, 24),
      new THREE.MeshBasicMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.hoverMarker.rotation.x = -Math.PI / 2;
    this.hoverMarker.position.y = 0.06;
    this.hoverMarker.visible = false;
    this.scene.add(this.hoverMarker);

    this.scene.background = new THREE.Color(0xf2f4f7);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.animate();
  }

  get camera(): THREE.Camera {
    return this.viewMode === 'top' ? this.topCamera : this.perspectiveCamera;
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    if (mode === 'top') {
      const target = this.controls.target.clone();
      this.syncTopCamera();
      // 相机位于目标正上方，up 指向 -z，保证屏幕坐标与世界 x-z 稳定映射
      this.topCamera.position.set(target.x, 60, target.z);
      this.topCamera.up.set(0, 0, -1);
      this.topCamera.lookAt(target);
      this.controls.object = this.topCamera;
      this.controls.enableRotate = false;
      this.controls.enabled = true;
      this.controls.update();
    } else {
      this.controls.object = this.perspectiveCamera;
      this.controls.enableRotate = true;
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  private syncTopCamera(): void {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    const viewSize = 40;
    this.topCamera.left = (-viewSize * aspect) / 2;
    this.topCamera.right = (viewSize * aspect) / 2;
    this.topCamera.top = viewSize / 2;
    this.topCamera.bottom = -viewSize / 2;
    this.topCamera.updateProjectionMatrix();
  }

  setGridVisible(v: boolean): void {
    this.grid.visible = v;
  }

  setGridSize(size: number): void {
    const wasVisible = this.grid.visible;
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    const span = 200;
    this.grid = new THREE.GridHelper(span, Math.round(span / size), 0x8aa0b8, 0xd4dbe3);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.grid.position.y = 0.005;
    this.grid.visible = wasVisible;
    this.scene.add(this.grid);
  }

  // ———————————— 数据同步 ————————————

  rebuildGround(regions: Region[]): void {
    this.ground.update(regions);
  }

  rebuildInstances(objects: PlacedObject[], selected: Set<string>, hoverId: string | null): void {
    this.instances.rebuild(objects, selected, hoverId);
    this.updateSelectionOutlines(selected);
  }

  refreshInstances(): void {
    this.instances.updateAllMatrices();
  }

  updateHighlights(selected: Set<string>, hoverId: string | null): void {
    this.instances.updateHighlights(selected, hoverId);
    this.updateSelectionOutlines(selected);
  }

  private updateSelectionOutlines(ids: Set<string>): void {
    for (const child of [...this.outlineGroup.children]) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.outlineGroup.remove(line);
    }
    const mat = new THREE.LineBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.95 });
    for (const outline of this.instances.selectionOutlines(ids)) {
      const geo = new THREE.BufferGeometry().setFromPoints(outline.points);
      this.outlineGroup.add(new THREE.Line(geo, mat));
    }
  }

  /** 吸附辅助线 */
  showGuides(guides: SnapGuide[]): void {
    for (const child of [...this.guideGroup.children]) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.guideGroup.remove(line);
    }
    for (const g of guides) {
      const pts =
        g.axis === 'v'
          ? [new THREE.Vector3(g.value, 0.08, g.from), new THREE.Vector3(g.value, 0.08, g.to)]
          : [new THREE.Vector3(g.from, 0.08, g.value), new THREE.Vector3(g.to, 0.08, g.value)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.guideGroup.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: g.kind === 'grid' ? 0x3f7fcf : 0xe2574f }),
        ),
      );
    }
  }

  clearGuides(): void {
    this.showGuides([]);
  }

  // ———————————— 区域绘制预览 ————————————

  private drawPreview: THREE.Line | null = null;

  /** 多边形绘制预览；hover 为当前指针地面点（作为虚线尾段） */
  showDrawPreview(points: THREE.Vector3[], closed: boolean, hover: THREE.Vector3 | null): void {
    this.clearDrawPreview();
    const pts = points.map((p) => new THREE.Vector3(p.x, 0.1, p.z));
    if (hover) pts.push(new THREE.Vector3(hover.x, 0.1, hover.z));
    if (closed && pts.length > 1) pts.push(pts[0].clone());
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.drawPreview = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color: 0x2f6fb3,
        dashSize: 0.4,
        gapSize: 0.2,
      }),
    );
    this.drawPreview.computeLineDistances();
    this.scene.add(this.drawPreview);
  }

  clearDrawPreview(): void {
    if (!this.drawPreview) return;
    this.scene.remove(this.drawPreview);
    this.drawPreview.geometry.dispose();
    (this.drawPreview.material as THREE.Material).dispose();
    this.drawPreview = null;
  }

  // ———————————— 放置幽灵 ————————————

  showGhost(geometry: THREE.BufferGeometry, valid: boolean): void {
    this.hideGhost();
    const mat = new THREE.MeshStandardMaterial({
      color: valid ? 0x57c785 : 0xe2574f,
      transparent: true,
      opacity: 0.55,
    });
    this.ghost = new THREE.Mesh(geometry, mat);
    this.ghost.position.y = 0.02;
    this.scene.add(this.ghost);
  }

  moveGhost(pos: THREE.Vector3, rotation: number): void {
    if (!this.ghost) return;
    this.ghost.position.set(pos.x, 0.02, pos.z);
    this.ghost.rotation.y = rotation;
  }

  setGhostValid(valid: boolean): void {
    if (!this.ghost) return;
    (this.ghost.material as THREE.MeshStandardMaterial).color.set(
      valid ? 0x57c785 : 0xe2574f,
    );
  }

  hideGhost(): void {
    if (!this.ghost) return;
    this.scene.remove(this.ghost);
    this.ghost.geometry.dispose();
    (this.ghost.material as THREE.Material).dispose();
    this.ghost = null;
  }

  showHoverMarker(p: THREE.Vector3 | null): void {
    if (!p) {
      this.hoverMarker.visible = false;
      return;
    }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.set(p.x, 0.06, p.z);
  }

  // ———————————— 拾取 ————————————

  /** 屏幕坐标 -> 地面点（BVH 射线），不在区域上返回 null */
  pickGround(clientX: number, clientY: number): THREE.Vector3 | null {
    this.updateRaycaster(clientX, clientY);
    return this.ground.raycastGround(this.raycaster);
  }

  /** 屏幕坐标 -> 物体 id（先于地面调用） */
  pickObject(clientX: number, clientY: number): string | null {
    this.updateRaycaster(clientX, clientY);
    const meshes: THREE.Object3D[] = [];
    this.instances.group.children.forEach((m: THREE.Object3D) => meshes.push(m));
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const instanceId = hit.instanceId;
    if (instanceId === undefined) return null;
    // 反查物体：从 mesh 名称解析 catalogId，再按实例槽位映射
    const catalogId = hit.object.name.replace(/^inst-/, '').replace(/-\d+$/, '');
    const obj = this.instancesLookup(catalogId, instanceId);
    return obj;
  }

  private lookupMap = new Map<string, PlacedObject[]>();
  setLookup(map: Map<string, PlacedObject[]>): void {
    this.lookupMap = map;
  }

  private instancesLookup(catalogId: string, slot: number): string | null {
    const list = this.lookupMap.get(catalogId);
    return list && list[slot] ? list[slot].id : null;
  }

  private updateRaycaster(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  // ———————————— 框选矩形（世界坐标投影辅助） ————————————

  /** 屏幕两个角点 -> 地面平面上的矩形范围 */
  screenRectToGround(x0: number, y0: number, x1: number, y1: number): {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  } | null {
    const a = this.pickGround(x0, y0);
    const b = this.pickGround(x1, y1);
    if (!a || !b) return null;
    return {
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      minZ: Math.min(a.z, b.z),
      maxZ: Math.max(a.z, b.z),
    };
  }

  // ———————————— 框选（橡皮筋由 DOM 层渲染） ————————————

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.perspectiveCamera.aspect = w / h;
    this.perspectiveCamera.updateProjectionMatrix();
    if (this.viewMode === 'top') this.syncTopCamera();
  }

  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.instances.dispose();
    this.ground.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
