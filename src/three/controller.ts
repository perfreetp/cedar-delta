/**
 * InteractionController：画布上的全部指针/键盘交互
 *
 * 模式：
 * - select  选择/移动/旋转/框选
 * - draw-rect / draw-polygon  场地平面绘制
 * - place(catalogId)  从物体库拖入后的放置模式
 *
 * 交互约定：
 * - 左键拖动空白处 → 框选；拖动物体 → 移动（实时吸附+碰撞校验）
 * - Shift+拖动 → 旋转；按住 Alt → 临时关闭吸附；Delete 删除；Ctrl+Z/Y 撤销重做
 * - 右键/中键 → OrbitControls 旋转视角（select 模式下）
 */
import * as THREE from 'three';
import type { CatalogItem, PlacedObject, TransformSnapshot, Vec2 } from '../types';
import type { SceneEngine } from './engine';
import type { PlannerStore } from '../store/store';
import { snapAngle, snapPosition, type SnapGuide } from '../lib/snap';
import { buildGeometry } from '../lib/geometry';

type Mode =
  | { kind: 'select' }
  | { kind: 'draw-rect' }
  | { kind: 'draw-polygon'; points: Vec2[] }
  | { kind: 'place'; item: CatalogItem };

interface DragState {
  type: 'move' | 'rotate' | 'box' | 'draw-rect' | 'polygon-preview';
  startClientX: number;
  startClientY: number;
  startGround: Vec2 | null;
  /** 移动前每个参与物体的姿态 */
  before: TransformSnapshot[];
  /** 移动过程中工作副本 id -> 姿态 */
  working: Map<string, { x: number; z: number; rotation: number; scale: number }>;
  /** 框选橡皮筋 DOM */
  bandEl: HTMLDivElement | null;
  /** 旋转起始指针角度与物体角度 */
  rotateAnchorAngle: number;
  rotateStartRotations: Map<string, number>;
}

export class InteractionController {
  private engine: SceneEngine;
  private store: PlannerStore;
  private mode: Mode = { kind: 'select' };
  private drag: DragState | null = null;
  private hoverObjectId: string | null = null;
  private lookup = new Map<string, PlacedObject[]>();
  private el: HTMLElement;
  private keyHandlers: { down: (e: KeyboardEvent) => void; up: (e: KeyboardEvent) => void };
  /** 用于外部（Solid 面板）感知模式变化 */
  readonly modeVersion = { v: 0, listeners: new Set<() => void>() };

  constructor(engine: SceneEngine, store: PlannerStore) {
    this.engine = engine;
    this.store = store;
    this.el = engine.renderer.domElement;
    this.el.addEventListener('pointerdown', this.onPointerDown);
    this.el.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.el.addEventListener('contextmenu', this.onContextMenu);
    this.el.addEventListener('dblclick', this.onDblClick);

    this.keyHandlers = {
      down: this.onKeyDown,
      up: this.onKeyUp,
    };
    window.addEventListener('keydown', this.keyHandlers.down);
    window.addEventListener('keyup', this.keyHandlers.up);
  }

  // ———————————— 模式切换（面板调用） ————————————

  setSelectMode(): void {
    this.cancelMode();
    this.mode = { kind: 'select' };
    this.bumpMode();
  }

  setDrawRectMode(): void {
    this.cancelMode();
    this.mode = { kind: 'draw-rect' };
    this.el.style.cursor = 'crosshair';
    this.bumpMode();
  }

  setDrawPolygonMode(): void {
    this.cancelMode();
    this.mode = { kind: 'draw-polygon', points: [] };
    this.el.style.cursor = 'crosshair';
    this.bumpMode();
  }

  /** 物体库点击后进入放置模式 */
  setPlaceMode(item: CatalogItem): void {
    this.cancelMode();
    this.mode = { kind: 'place', item };
    const geo = buildGeometry(item).geometries[0];
    this.engine.showGhost(geo.clone(), true);
    this.el.style.cursor = 'copy';
    this.bumpMode();
  }

  getModeKind(): string {
    return this.mode.kind;
  }

  onModeChange(fn: () => void): () => void {
    this.modeVersion.listeners.add(fn);
    return () => this.modeVersion.listeners.delete(fn);
  }

  private bumpMode(): void {
    this.modeVersion.v++;
    for (const fn of this.modeVersion.listeners) fn();
  }

  private cancelMode(): void {
    this.engine.hideGhost();
    this.engine.clearGuides();
    this.engine.clearDrawPreview();
    this.engine.showHoverMarker(null);
    this.el.style.cursor = '';
  }

  // ———————————— 数据同步（store 变更后由组件调用） ————————————

  syncFromStore(): void {
    this.lookup.clear();
    const byCatalog = new Map<string, PlacedObject[]>();
    for (const o of this.store.objects) {
      if (!o.visible) continue;
      let list = byCatalog.get(o.catalogId);
      if (!list) {
        list = [];
        byCatalog.set(o.catalogId, list);
      }
      list.push(o);
    }
    this.lookup = byCatalog;
    this.engine.setLookup(byCatalog);
  }

  // ———————————— 指针事件 ————————————

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private groundPoint(e: PointerEvent): Vec2 | null {
    const p = this.engine.pickGround(e.clientX, e.clientY);
    return p ? { x: p.x, z: p.z } : null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const gp = this.groundPoint(e);

    // —— 右键：绘制/放置模式下用于取消，选择模式下交给 OrbitControls 旋转 ——
    if (e.button === 2) {
      if (this.mode.kind === 'draw-polygon') {
        if (this.mode.points.length >= 3) {
          this.store.addPolygonRegion(this.mode.points);
        }
        this.setSelectMode();
      } else if (this.mode.kind === 'draw-rect' || this.mode.kind === 'place') {
        this.setSelectMode();
      }
      return;
    }

    // —— 多边形绘制：左键加点，右键/双击结束 ——
    if (this.mode.kind === 'draw-polygon') {
      if (e.button === 0 && gp) {
        this.mode.points.push(gp);
        this.updatePolygonPreview(gp);
      }
      return;
    }

    // —— 矩形区域绘制 ——
    if (this.mode.kind === 'draw-rect' && e.button === 0 && gp) {
      this.drag = {
        type: 'draw-rect',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startGround: gp,
        before: [],
        working: new Map(),
        bandEl: null,
        rotateAnchorAngle: 0,
        rotateStartRotations: new Map(),
      };
      this.engine.controls.enabled = false;
      this.el.setPointerCapture(e.pointerId);
      return;
    }

    // —— 放置模式 ——
    if (this.mode.kind === 'place' && e.button === 0 && gp) {
      this.commitPlace(gp, e);
      return;
    }

    if (this.mode.kind !== 'select' || e.button !== 0) return;

    // —— 选择模式 ——
    const objId = this.engine.pickObject(e.clientX, e.clientY);
    const clicked = objId ? this.store.objects.find((o) => o.id === objId) : null;

    if (clicked) {
      // 选择逻辑：未选中 -> 单选（shift 追加）；已选中 -> 整组操作
      const sel = this.store.selectedIds[0]();
      if (!sel.has(clicked.id)) {
        if (e.shiftKey) this.store.toggleSelected(clicked.id);
        else this.store.select([clicked.id]);
      }
      const targets = this.store.selected;
      this.drag = {
        type: e.shiftKey ? 'rotate' : 'move',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startGround: gp,
        before: targets.map((o) => snapshot(o)),
        working: new Map(targets.map((o) => [o.id, snapshot(o)])),
        bandEl: null,
        rotateAnchorAngle: gp ? Math.atan2(gp.z - avgZ(targets), gp.x - avgX(targets)) : 0,
        rotateStartRotations: new Map(targets.map((o) => [o.id, o.rotation])),
      };
      this.engine.controls.enabled = false;
      this.el.setPointerCapture(e.pointerId);
    } else if (gp) {
      // 空白处：框选
      const band = document.createElement('div');
      band.className = 'rubber-band';
      document.body.appendChild(band);
      this.drag = {
        type: 'box',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startGround: gp,
        before: [],
        working: new Map(),
        bandEl: band,
        rotateAnchorAngle: 0,
        rotateStartRotations: new Map(),
      };
      this.engine.controls.enabled = false;
      this.el.setPointerCapture(e.pointerId);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const gp = this.groundPoint(e);

    // 放置模式：幽灵跟随
    if (this.mode.kind === 'place') {
      if (gp) {
        const item = this.mode.item;
        const valid = this.previewPlaceValid(item, gp);
        this.engine.setGhostValid(valid);
        this.engine.moveGhost(new THREE.Vector3(gp.x, 0, gp.z), this.ghostRotation);
        this.engine.showHoverMarker(new THREE.Vector3(gp.x, 0, gp.z));
      } else {
        this.engine.showHoverMarker(null);
      }
      return;
    }

    // 多边形绘制：虚线跟随指针
    if (this.mode.kind === 'draw-polygon') {
      this.updatePolygonPreview(gp);
      return;
    }

    if (!this.drag) {
      // 悬停高亮
      if (this.mode.kind === 'select') {
        const id = this.engine.pickObject(e.clientX, e.clientY);
        if (id !== this.hoverObjectId) {
          this.hoverObjectId = id;
          this.engine.updateHighlights(this.store.selectedIds[0](), id);
        }
      }
      return;
    }

    const d = this.drag;

    // —— 矩形区域绘制 ——
    if (d.type === 'draw-rect' && d.startGround && gp) {
      const a = new THREE.Vector3(d.startGround.x, 0, d.startGround.z);
      const b = new THREE.Vector3(gp.x, 0, gp.z);
      const corners = [
        a,
        new THREE.Vector3(b.x, 0, a.z),
        b,
        new THREE.Vector3(a.x, 0, b.z),
      ];
      this.engine.showDrawPreview(corners, true, null);
      return;
    }

    // —— 框选橡皮筋 ——
    if (d.type === 'box' && d.bandEl) {
      const x = Math.min(e.clientX, d.startClientX);
      const y = Math.min(e.clientY, d.startClientY);
      const w = Math.abs(e.clientX - d.startClientX);
      const h = Math.abs(e.clientY - d.startClientY);
      d.bandEl.style.left = `${x}px`;
      d.bandEl.style.top = `${y}px`;
      d.bandEl.style.width = `${w}px`;
      d.bandEl.style.height = `${h}px`;
      return;
    }

    if (!gp || !d.startGround) return;

    if (d.type === 'move') {
      this.handleMove(e, gp, d);
    } else if (d.type === 'rotate') {
      this.handleRotate(gp, d);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    // 透视与俯视都需要 OrbitControls（俯视仅平移/缩放），拖动结束后恢复
    this.engine.controls.enabled = true;

    if (d.type === 'box' && d.bandEl) {
      d.bandEl.remove();
      const rect = this.engine.screenRectToGround(
        d.startClientX,
        d.startClientY,
        e.clientX,
        e.clientY,
      );
      if (rect) {
        const hits = this.store.selectWithin(rect);
        if (e.shiftKey === false && hits.length === 0) this.store.select(null);
      }
      return;
    }

    if (d.type === 'draw-rect' && d.startGround) {
      const gp = this.groundPoint(e);
      this.engine.clearDrawPreview();
      if (gp) {
        const width = Math.abs(gp.x - d.startGround.x);
        const depth = Math.abs(gp.z - d.startGround.z);
        if (width >= 0.5 && depth >= 0.5) {
          this.store.addRectRegion(
            { x: (gp.x + d.startGround.x) / 2, z: (gp.z + d.startGround.z) / 2 },
            Math.round(width * 100) / 100,
            Math.round(depth * 100) / 100,
          );
        }
      }
      this.setSelectMode();
      return;
    }

    if (d.type === 'move' || d.type === 'rotate') {
      // 提交历史（若姿态确实变化）
      const after: TransformSnapshot[] = [];
      let changed = false;
      for (const obj of this.store.selected) {
        const w = d.working.get(obj.id);
        if (!w) continue;
        after.push({ id: obj.id, ...w });
        const b = d.before.find((s) => s.id === obj.id);
        if (b && (b.x !== w.x || b.z !== w.z || b.rotation !== w.rotation || b.scale !== w.scale)) {
          changed = true;
        }
      }
      if (changed) this.store.commitTransform(d.before, after);
      this.engine.clearGuides();
    }
  };

  private onDblClick = (): void => {
    if (this.mode.kind === 'draw-polygon' && this.mode.points.length >= 3) {
      this.store.addPolygonRegion(this.mode.points);
      this.setSelectMode();
    }
  };

  private updatePolygonPreview(hover: Vec2 | null): void {
    if (this.mode.kind !== 'draw-polygon') return;
    const pts = this.mode.points.map((p) => new THREE.Vector3(p.x, 0, p.z));
    this.engine.showDrawPreview(
      pts,
      false,
      hover ? new THREE.Vector3(hover.x, 0, hover.z) : null,
    );
  }

  // ———————————— 移动 + 吸附 + 碰撞 ————————————

  private handleMove(e: PointerEvent, gp: Vec2, d: DragState): void {
    const dx = gp.x - d.startGround!.x;
    const dz = gp.z - d.startGround!.z;
    const snapEnabled = !e.altKey && !this.store.snapTemporarilyOff[0]();
    const settings = this.store.snapSettings;

    // 先用原始位移生成候选姿态
    const candidates = this.store.selected.map((obj) => {
      const b = d.before.find((s) => s.id === obj.id)!;
      return { obj, nx: b.x + dx, nz: b.z + dz, nrot: b.rotation };
    });

    const others = this.store.objects.filter((o) => !this.store.selectedIds[0]().has(o.id));
    const snap = snapPosition(candidates, others, settings, snapEnabled);

    // snap 返回整组中心；换算回每个物体的修正位移
    // 未吸附时中心 = 候选中心，修正为 0
    const baseCenterX = avg(candidates.map((c) => c.nx));
    const baseCenterZ = avg(candidates.map((c) => c.nz));
    const corrX = snap.x - baseCenterX;
    const corrZ = snap.z - baseCenterZ;

    const finalMoves = candidates.map((c) => ({
      obj: c.obj,
      nx: c.nx + corrX,
      nz: c.nz + corrZ,
      nrot: c.nrot,
      nscale: c.obj.scale,
    }));

    // 碰撞/边界校验：失败则回退到无吸附位置，再失败则整体放弃本帧
    let accepted = finalMoves;
    if (!this.store.canPlaceBatch(finalMoves)) {
      const fallback = candidates.map((c) => ({
        obj: c.obj,
        nx: c.nx,
        nz: c.nz,
        nrot: c.nrot,
        nscale: c.obj.scale,
      }));
      if (!this.store.canPlaceBatch(fallback)) {
        this.engine.showGuides([]);
        return; // 阻止重叠放置：保持上一帧位置
      }
      accepted = fallback;
      this.engine.showGuides([]);
    } else {
      this.engine.showGuides(snap.guides as SnapGuide[]);
    }

    for (const m of accepted) {
      d.working.set(m.obj.id, {
        x: m.nx,
        z: m.nz,
        rotation: m.nrot,
        scale: m.nscale,
      });
    }
    this.store.applyTransformLive(d.working);
    this.engine.refreshInstances();
  }

  // ———————————— 旋转 ————————————

  private ghostRotation = 0;

  private handleRotate(gp: Vec2, d: DragState): void {
    const targets = this.store.selected;
    const cx = avgX(targets);
    const cz = avgZ(targets);
    const angleNow = Math.atan2(gp.z - cz, gp.x - cx);
    const delta = angleNow - d.rotateAnchorAngle;

    const snapEnabled = !this.store.snapTemporarilyOff[0]();
    const settings = this.store.snapSettings;
    const others = this.store.objects.filter((o) => !this.store.selectedIds[0]().has(o.id));
    // 吸附只作用于整组的转角增量，保证组内相对位置严格不变
    const anchor = targets[0];
    const snapped = snapAngle(
      (d.rotateStartRotations.get(anchor.id) ?? anchor.rotation) + delta,
      others,
      settings,
      snapEnabled,
    );
    const startAnchor = d.rotateStartRotations.get(anchor.id) ?? anchor.rotation;
    const groupDelta = snapped.angle - startAnchor;
    const cos = Math.cos(groupDelta);
    const sin = Math.sin(groupDelta);

    const moves = targets.map((obj) => {
      const startRot = d.rotateStartRotations.get(obj.id) ?? obj.rotation;
      // 绕组中心公转：保持组内相对布局
      const ox = obj.x - cx;
      const oz = obj.z - cz;
      const nx = cx + ox * cos - oz * sin;
      const nz = cz + ox * sin + oz * cos;
      // 同步自转相同角度
      const nrot = startRot + groupDelta;
      return { obj, nx, nz, nrot, nscale: obj.scale };
    });

    if (!this.store.canPlaceBatch(moves)) return; // 旋转后重叠 -> 阻止
    for (const m of moves) {
      d.working.set(m.obj.id, { x: m.nx, z: m.nz, rotation: m.nrot, scale: m.nscale });
    }
    this.store.applyTransformLive(d.working);
    this.engine.refreshInstances();
  }

  // ———————————— 放置模式 ————————————

  private previewPlaceValid(item: CatalogItem, gp: Vec2): boolean {
    const proto: PlacedObject = {
      id: 'preview',
      catalogId: item.id,
      category: item.category,
      name: item.name,
      x: gp.x,
      z: gp.z,
      rotation: this.ghostRotation,
      width: item.width,
      depth: item.depth,
      height: item.height,
      scale: 1,
      color: item.color,
      visible: true,
    };
    return this.store.canPlaceObject(proto, gp.x, gp.z, this.ghostRotation, 1);
  }

  private commitPlace(gp: Vec2, e: PointerEvent): void {
    if (this.mode.kind !== 'place') return;
    const item = this.mode.item;
    if (e.altKey) this.ghostRotation += Math.PI / 12;
    const created = this.store.createObject(item.id, gp.x, gp.z, this.ghostRotation);
    if (created) {
      this.store.select([created.id]);
      // 连续放置：不退出模式，便于快速摆多桌；Esc/右键退出
    }
  }

  /** 放置模式下点击旋转幽灵 90°，或按住 Alt 点击微调 */
  rotateGhost(): void {
    this.ghostRotation += Math.PI / 2;
    if (this.mode.kind === 'place') {
      this.engine.moveGhost(new THREE.Vector3(0, 0, 0), this.ghostRotation);
    }
  }

  // ———————————— 键盘 ————————————

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    if (e.key === 'Alt') {
      this.store.snapTemporarilyOff[1](true);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.history.redo();
      else this.store.history.undo();
      this.syncFromStore();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.history.redo();
      this.syncFromStore();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.store.selected.length > 0) {
        e.preventDefault();
        this.store.deleteSelected();
      }
      return;
    }
    if (e.key === 'Escape') {
      this.store.select(null);
      if (this.mode.kind !== 'select') this.setSelectMode();
      return;
    }
    if (this.mode.kind === 'place' && e.key.toLowerCase() === 'r') {
      this.rotateGhost();
    }
    // 方向键微调（0.1 米 / 15°）
    const sel = this.store.selected;
    if (sel.length > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? Math.PI / 12 : 0.1;
      const moves = sel.map((obj) => {
        let nx = obj.x;
        let nz = obj.z;
        let nrot = obj.rotation;
        if (e.shiftKey) {
          if (e.key === 'ArrowLeft') nrot -= step;
          if (e.key === 'ArrowRight') nrot += step;
        } else {
          if (e.key === 'ArrowUp') nz -= step;
          if (e.key === 'ArrowDown') nz += step;
          if (e.key === 'ArrowLeft') nx -= step;
          if (e.key === 'ArrowRight') nx += step;
        }
        return { obj, nx, nz, nrot, nscale: obj.scale };
      });
      if (this.store.canPlaceBatch(moves)) {
        const before = sel.map((o) => snapshot(o));
        const working = new Map(moves.map((m) => [m.obj.id, { x: m.nx, z: m.nz, rotation: m.nrot, scale: m.nscale }]));
        this.store.applyTransformLive(working);
        this.store.commitTransform(before, moves.map((m) => ({ id: m.obj.id, x: m.nx, z: m.nz, rotation: m.nrot, scale: m.nscale })));
        this.engine.refreshInstances();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') this.store.snapTemporarilyOff[1](false);
  };

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.el.removeEventListener('contextmenu', this.onContextMenu);
    this.el.removeEventListener('dblclick', this.onDblClick);
    window.removeEventListener('keydown', this.keyHandlers.down);
    window.removeEventListener('keyup', this.keyHandlers.up);
  }
}

// ————— 工具函数 —————
function snapshot(o: PlacedObject): TransformSnapshot {
  return { id: o.id, x: o.x, z: o.z, rotation: o.rotation, scale: o.scale };
}
function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function avgX(objs: PlacedObject[]): number {
  return avg(objs.map((o) => o.x));
}
function avgZ(objs: PlacedObject[]): number {
  return avg(objs.map((o) => o.z));
}
