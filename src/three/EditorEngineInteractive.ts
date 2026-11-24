// 可交互编辑器引擎:在场景基类之上实现指针编辑、闸门/中心线拖拽、台阶与历史
import * as THREE from 'three';
import { EditorEngineBase, type GateVisual } from './EditorEngine';
import { useEditorStore } from '../store';
import { computeColors, heightAt, sculptStroke, type StrokePoint } from '../lib/terrain';
import { buildGate, regroundGates } from '../lib/gates';
import { validateSteps } from '../lib/profile';
import { Centerline } from '../lib/centerline';
import { uid } from '../lib/id';
import { DEFAULT_GATE_WIDTH, TERRAIN_LENGTH, TERRAIN_WIDTH } from '../lib/constants';
import type { ControlPoint, Gate, GateColor, Snapshot, Step } from '../lib/types';

const PLANE_Y = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class EditorEngine extends EditorEngineBase {
  private store = useEditorStore;
  private planePoint = new THREE.Vector3();
  private unsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement) {
    super(container);
    this.bindEvents();
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('contextmenu', (ev) => ev.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    this.unsubscribe = this.store.subscribe((s, prev) => {
      if (s.toolMode !== prev.toolMode) this.setToolMode(s.toolMode);
      if (s.selection !== prev.selection) this.refreshToolVisibility();
    });
  }

  // ---------------- 键盘 ----------------

  private onKeyDown = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) this.redo();
      else this.undo();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      this.redo();
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      this.deleteSelection();
    }
  };

  // ---------------- 指针移动 ----------------

  private onPointerMove = (ev: PointerEvent): void => {
    this.setNdc(ev);
    if (this.dragging) {
      if (this.dragging.kind === 'sculpt') this.handleSculptDrag(ev);
      else if (this.dragging.kind === 'point') this.handlePointDrag(ev);
      else if (this.dragging.kind === 'gate') this.handleGateDrag(ev);
      return;
    }
    const mode = this.store.getState().toolMode;
    const hit = this.pickTerrain();
    if (!hit) {
      this.brushRing.visible = false;
      this.ghost.visible = false;
      return;
    }
    if (mode === 'sculpt') this.updateBrushRing(hit.point);
    else if (mode === 'gate') this.updateGhostGate(hit.point);
  };

  // ---------------- 指针按下 ----------------

  private onPointerDown = (ev: PointerEvent): void => {
    if (ev.button !== 0) return;
    this.setNdc(ev);
    const mode = this.store.getState().toolMode;

    if (mode === 'gate') {
      const gate = this.pickGate();
      if (gate) {
        this.pushHistory();
        this.dragging = { kind: 'gate', id: gate.id };
        this.store.getState().setSelection({ kind: 'gate', id: gate.id });
        this.controls.enabled = false;
        return;
      }
      const hit = this.pickTerrain();
      if (hit) this.placeGate(hit.point);
      return;
    }

    if (mode === 'centerline') {
      const cp = this.pickControlPoint();
      if (cp) {
        this.pushHistory();
        this.dragging = { kind: 'point', id: cp.id };
        this.controls.enabled = false;
      }
      return;
    }

    if (mode === 'sculpt') {
      const hit = this.pickTerrain();
      if (hit) {
        this.pushHistory();
        this.dragging = {
          kind: 'sculpt',
          lastX: hit.point.x,
          lastZ: hit.point.z,
          target: hit.point.y,
        };
        this.controls.enabled = false;
        this.handleSculptDrag(ev);
      }
    }
  };

  private onPointerUp = (): void => {
    if (!this.dragging) return;
    const kind = this.dragging.kind;
    this.dragging = null;
    this.controls.enabled = true;
    if (kind === 'point') {
      this.pendingCp = null;
      this.rebuildQueued = false;
      this.rebuildTerrainFull(true);
    }
    this.syncHistoryFlags();
  };

  // ---------------- 雕刻 ----------------

  private handleSculptDrag(ev: PointerEvent): void {
    if (!this.dragging || this.dragging.kind !== 'sculpt') return;
    this.setNdc(ev);
    const hit = this.pickTerrain();
    if (!hit) return;
    const drag = this.dragging;
    const points = interpStroke(drag.lastX, drag.lastZ, hit.point.x, hit.point.z);
    const brush = this.store.getState().brush;
    const changed = sculptStroke(this.heights, this.centerline, brush, points, drag.target);
    if (changed.length) {
      this.updateTerrainAfterSculpt(changed);
      // 雕刻改变地面后,闸门立柱随之重新落地,保持地形与闸门一致
      const s = this.store.getState();
      this.applyGatesToState(regroundGates(this.centerline, this.heights, s.steps, s.gates));
    }
    drag.lastX = hit.point.x;
    drag.lastZ = hit.point.z;
    this.updateBrushRing(hit.point);
  }

  private updateBrushRing(p: THREE.Vector3): void {
    const brush = this.store.getState().brush;
    this.brushRing.visible = true;
    this.brushRing.scale.setScalar(brush.radius);
    this.brushRing.position.set(p.x, heightAt(this.heights, p.x, p.z) + 0.25, p.z);
    const color =
      brush.type === 'raise'
        ? 0xff8a5c
        : brush.type === 'lower'
          ? 0x5cc8ff
          : brush.type === 'smooth'
            ? 0x9dff8a
            : 0xffe066;
    (this.brushRing.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  // ---------------- 闸门 ----------------

  private updateGhostGate(p: THREE.Vector3): void {
    const s = this.store.getState();
    const info = this.centerline.nearest(p.x, p.z);
    const gate = this.computeGate(info.s, info.offset, s.gateColor, DEFAULT_GATE_WIDTH);
    this.ghost.visible = true;
    const tint = s.gateColor === 'red' ? 0xff7a7a : 0x7dffa9;
    this.ghost.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.visible && mesh.material) {
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(tint);
      }
    });
    this.layoutGateVisual(this.ghostVisual(), gate);
  }

  private ghostVisual(): GateVisual {
    return {
      group: this.ghost,
      hit: this.ghost.children[5] as THREE.Mesh,
      bar: this.ghost.children[0] as THREE.Mesh,
      poleA: this.ghost.children[1] as THREE.Mesh,
      poleB: this.ghost.children[2] as THREE.Mesh,
      headA: this.ghost.children[3] as THREE.Mesh,
      headB: this.ghost.children[4] as THREE.Mesh,
    };
  }

  private computeGate(s: number, offset: number, color: GateColor, width: number): Gate {
    const st = this.store.getState();
    return buildGate(this.centerline, this.heights, st.steps, { s, offset, color, width });
  }

  private placeGate(p: THREE.Vector3): void {
    const s = this.store.getState();
    const info = this.centerline.nearest(p.x, p.z);
    this.pushHistory();
    const gate = this.computeGate(info.s, info.offset, s.gateColor, DEFAULT_GATE_WIDTH);
    this.addGateVisual(gate);
    s.setGates([...s.gates, gate]);
    s.setSelection({ kind: 'gate', id: gate.id });
    this.refreshToolVisibility();
    s.showToast(
      `已放置${gate.color === 'red' ? '红' : '绿'}门,入水高度 ${gate.entryHeight.toFixed(2)} m`,
    );
    this.syncHistoryFlags();
  }

  private handleGateDrag(ev: PointerEvent): void {
    if (!this.dragging || this.dragging.kind !== 'gate') return;
    this.setNdc(ev);
    const ok = this.raycaster.ray.intersectPlane(PLANE_Y, this.planePoint);
    if (!ok) return;
    const x = THREE.MathUtils.clamp(
      this.planePoint.x,
      -TERRAIN_WIDTH / 2 + 2,
      TERRAIN_WIDTH / 2 - 2,
    );
    const z = THREE.MathUtils.clamp(
      this.planePoint.z,
      -TERRAIN_LENGTH / 2 + 2,
      TERRAIN_LENGTH / 2 - 2,
    );
    const info = this.centerline.nearest(x, z);
    const s = this.store.getState();
    const old = s.gates.find((g) => g.id === (this.dragging as { id: string }).id);
    if (!old) return;
    // 重新放置:门杆重新吸附等高线切线,立柱落地,下游坡度联动重算
    const gate = buildGate(this.centerline, this.heights, s.steps, {
      id: old.id,
      s: info.s,
      offset: info.offset,
      color: old.color,
      width: old.width,
    });
    s.setGates(s.gates.map((g) => (g.id === gate.id ? gate : g)));
    const v = this.gateVisuals.get(gate.id);
    if (v) this.layoutGateVisual(v, gate);
    s.bumpProfile();
  }

  // ---------------- 中心线控制点 ----------------

  private handlePointDrag(ev: PointerEvent): void {
    if (!this.dragging || this.dragging.kind !== 'point') return;
    this.setNdc(ev);
    const ok = this.raycaster.ray.intersectPlane(PLANE_Y, this.planePoint);
    if (!ok) return;
    const id = this.dragging.id;
    const x = THREE.MathUtils.clamp(
      this.planePoint.x,
      -TERRAIN_WIDTH / 2 + 4,
      TERRAIN_WIDTH / 2 - 4,
    );
    const z = THREE.MathUtils.clamp(
      this.planePoint.z,
      -TERRAIN_LENGTH / 2 + 4,
      TERRAIN_LENGTH / 2 - 4,
    );
    const s = this.store.getState();
    this.pendingCp = s.controlPoints.map((p) => (p.id === id ? { ...p, x, z } : p));
    // rAF 合帧,避免高频移动触发过多全量重建
    if (!this.rebuildQueued) {
      this.rebuildQueued = true;
      requestAnimationFrame(() => {
        if (!this.pendingCp) return;
        this.store.getState().setControlPoints(this.pendingCp);
        this.rebuildTerrainFull(false);
        this.rebuildQueued = false;
      });
    }
  }

  /** 在样条末尾追加控制点 */
  addControlPoint(x: number, z: number): void {
    const s = this.store.getState();
    this.pushHistory();
    const cp: ControlPoint = { id: uid('cp'), x, z };
    s.setControlPoints([...s.controlPoints, cp]);
    this.rebuildTerrainFull();
    this.syncHistoryFlags();
  }

  // ---------------- 台阶 ----------------

  addStep(s: number, drop: number, angle: number): void {
    const state = this.store.getState();
    const step: Step = { id: uid('step'), s, drop, angle };
    const validation = validateSteps([...state.steps, step]);
    if (!validation.ok) {
      state.showToast(validation.message ?? '台阶参数无效');
      return;
    }
    this.pushHistory();
    state.setSteps([...state.steps, step].sort((a, b) => a.s - b.s));
    this.rebuildTerrainFull();
    this.syncHistoryFlags();
  }

  updateStep(id: string, patch: Partial<Omit<Step, 'id'>>): void {
    const state = this.store.getState();
    const next = state.steps.map((st) => (st.id === id ? { ...st, ...patch } : st));
    const validation = validateSteps(next);
    if (!validation.ok) {
      state.showToast(validation.message ?? '台阶参数无效');
      return;
    }
    this.pushHistory();
    state.setSteps(next);
    this.rebuildTerrainFull();
    this.syncHistoryFlags();
  }

  removeStep(id: string): void {
    const state = this.store.getState();
    this.pushHistory();
    state.setSteps(state.steps.filter((st) => st.id !== id));
    this.rebuildTerrainFull();
    this.syncHistoryFlags();
  }

  // ---------------- 闸门管理 ----------------

  updateGateWidth(id: string, width: number): void {
    const s = this.store.getState();
    const old = s.gates.find((g) => g.id === id);
    if (!old) return;
    this.pushHistory();
    const gate = buildGate(this.centerline, this.heights, s.steps, {
      id,
      s: old.s,
      offset: old.offset,
      color: old.color,
      width,
    });
    s.setGates(s.gates.map((g) => (g.id === id ? gate : g)));
    const v = this.gateVisuals.get(id);
    if (v) this.layoutGateVisual(v, gate);
    this.syncHistoryFlags();
  }

  override deleteSelection(): void {
    const sel = this.store.getState().selection;
    if (sel?.kind === 'gate') this.deleteGate(sel.id);
  }

  deleteGate(id: string): void {
    const s = this.store.getState();
    this.pushHistory();
    s.setGates(s.gates.filter((g) => g.id !== id));
    const v = this.gateVisuals.get(id);
    if (v) {
      this.scene.remove(v.group);
      this.gateVisuals.delete(id);
    }
    s.setSelection(null);
    this.syncHistoryFlags();
  }

  // ---------------- 撤销 / 重做 ----------------

  override undo(): void {
    const snap = this.history.undo(this.currentSnapshot());
    if (snap) this.restoreSnapshot(snap);
  }

  override redo(): void {
    const snap = this.history.redo(this.currentSnapshot());
    if (snap) this.restoreSnapshot(snap);
  }

  private restoreSnapshot(snap: Snapshot): void {
    this.heights = new Float32Array(snap.base);
    const s = this.store.getState();
    s.replaceAll({
      controlPoints: snap.controlPoints.map((p) => ({ ...p })),
      steps: snap.steps.map((st) => ({ ...st })),
      gates: snap.gates.map((g) => ({ ...g, pA: [...g.pA], pB: [...g.pB] })),
    });
    // 中心线可能变化,重建样条并重算配色
    this.centerline = new Centerline(snap.controlPoints);
    this.colors = computeColors(this.centerline, this.heights);
    this.writeTerrainBuffers(true);
    this.terrainGeometry.boundsTree?.refit();
    this.refreshCenterlineObjects();
    this.rebuildGateVisuals(snap.gates);
    this.refreshToolVisibility();
    s.bumpTerrain();
    s.bumpProfile();
    this.syncHistoryFlags();
  }

  private rebuildGateVisuals(gates: Gate[]): void {
    for (const v of this.gateVisuals.values()) this.scene.remove(v.group);
    this.gateVisuals.clear();
    for (const g of gates) this.addGateVisual(g);
  }

  /** 导入赛道文件后整体载入 */
  loadSnapshot(snap: Snapshot): void {
    this.history.clear();
    this.restoreSnapshot(snap);
    this.syncHistoryFlags();
  }

  override dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.unsubscribe?.();
    super.dispose();
  }
}

function interpStroke(x0: number, z0: number, x1: number, z1: number): StrokePoint[] {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(dist / 2));
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t });
  }
  return pts;
}
