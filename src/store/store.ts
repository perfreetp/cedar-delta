/**
 * 全局状态仓库：项目数据、选择集、碰撞世界、历史与自动保存的中枢。
 * three.js 视口通过 subscribe 机制拿到变更通知后重建实例化网格。
 */
import { createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type {
  PlacedObject,
  ProjectData,
  Region,
  SnapSettings,
  TransformSnapshot,
  Vec2,
} from '../types';
import { getCatalogItem } from '../catalog';
import { CollisionWorld, type RegionSet } from '../lib/collision';
import { HistoryStack } from '../lib/history';
import {
  emptyProject,
  exportProject,
  loadLocal,
  saveLocal,
  validateProject,
} from '../lib/storage';
import { uid } from '../lib/math2d';

type Listener = () => void;

export class PlannerStore {
  readonly history = new HistoryStack();
  readonly project = createStore<ProjectData>(loadLocal() ?? emptyProject());
  readonly selectedIds = createSignal<Set<string>>(new Set());
  /** 临时关闭吸附（按住修饰键或工具栏开关） */
  readonly snapTemporarilyOff = createSignal(false);
  /** 视图层订阅：项目结构/姿态变化 */
  private sceneListeners = new Set<Listener>();
  private collision = new CollisionWorld(4);
  private collisionDirty = true;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // 初始碰撞世界
    queueMicrotask(() => this.rebuildCollision());
  }

  // ————————————————— 订阅 —————————————————

  onSceneChange(fn: Listener): () => void {
    this.sceneListeners.add(fn);
    return () => this.sceneListeners.delete(fn);
  }

  private emitScene(): void {
    for (const fn of this.sceneListeners) fn();
  }

  // ————————————————— 基础访问 —————————————————

  get data(): ProjectData {
    return this.project[0];
  }

  get objects(): PlacedObject[] {
    return this.project[0].objects;
  }

  get regions(): Region[] {
    return this.project[0].regions;
  }

  get snapSettings(): SnapSettings {
    return this.project[0].snap;
  }

  get selected(): PlacedObject[] {
    const ids = this.selectedIds[0]();
    return this.objects.filter((o) => ids.has(o.id));
  }

  regionSet(): RegionSet {
    const rect = [];
    const polygon = [];
    for (const r of this.regions) {
      if (r.type === 'rect') rect.push(r);
      else polygon.push(r);
    }
    return { rect, polygon };
  }

  // ————————————————— 碰撞世界 —————————————————

  rebuildCollision(): void {
    this.collision.rebuild(this.objects);
    this.collisionDirty = false;
  }

  private ensureCollision(): CollisionWorld {
    if (this.collisionDirty) this.rebuildCollision();
    return this.collision;
  }

  /** 供视口/控制器使用的只读碰撞查询 */
  get collisionWorld(): CollisionWorld {
    return this.ensureCollision();
  }

  canPlaceObject(
    obj: PlacedObject,
    nx: number,
    nz: number,
    nrot: number,
    nscale: number,
  ): boolean {
    if (!this.ensureCollision().canPlace(obj, nx, nz, nrot, nscale)) return false;
    return this.ensureCollision().isInsideRegions(
      { ...obj, x: nx, z: nz, rotation: nrot, scale: nscale },
      this.regionSet(),
    );
  }

  canPlaceBatch(
    moves: { obj: PlacedObject; nx: number; nz: number; nrot: number; nscale: number }[],
  ): boolean {
    const world = this.ensureCollision();
    if (!world.canPlaceBatch(moves)) return false;
    return moves.every((m) =>
      world.isInsideRegions(
        { ...m.obj, x: m.nx, z: m.nz, rotation: m.nrot, scale: m.nscale },
        this.regionSet(),
      ),
    );
  }

  // ————————————————— 选择 —————————————————

  select(ids: string[] | null): void {
    this.selectedIds[1](new Set(ids ?? []));
  }

  toggleSelected(id: string): void {
    const next = new Set(this.selectedIds[0]());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds[1](next);
  }

  selectWithin(rect: { minX: number; maxX: number; minZ: number; maxZ: number }): PlacedObject[] {
    const hits = this.objects.filter((o) => {
      if (!o.visible) return false;
      return (
        o.x >= rect.minX &&
        o.x <= rect.maxX &&
        o.z >= rect.minZ &&
        o.z <= rect.maxZ
      );
    });
    this.select(hits.map((o) => o.id));
    return hits;
  }

  // ————————————————— 物体：增删 —————————————————

  /** 从物体库创建实例（不校验位置，由调用方确保在区域内） */
  createObject(catalogId: string, x: number, z: number, rotation = 0): PlacedObject | null {
    const item = getCatalogItem(catalogId);
    const obj: PlacedObject = {
      id: uid('obj'),
      catalogId: item.id,
      category: item.category,
      name: item.name,
      x,
      z,
      rotation,
      width: item.width,
      depth: item.depth,
      height: item.height,
      scale: 1,
      color: item.color,
      visible: true,
    };
    if (!this.canPlaceObject(obj, x, z, rotation, 1)) return null;
    this.history.push({
      label: `添加 ${item.name}`,
      undo: () => this.removeObjectsInternal([obj.id]),
      redo: () => this.addObjectsInternal([obj]),
    });
    return obj;
  }

  private addObjectsInternal(objs: PlacedObject[]): void {
    this.project[1](
      produce((p) => {
        p.objects.push(...objs.map((o) => ({ ...o })));
      }),
    );
    this.collisionDirty = true;
    this.emitScene();
    this.scheduleSave();
  }

  deleteSelected(): void {
    const targets = this.selected;
    if (targets.length === 0) return;
    const copies = targets.map((o) => ({ ...o }));
    const ids = new Set(copies.map((o) => o.id));
    this.history.push({
      label: `删除 ${copies.length} 个物体`,
      undo: () => this.addObjectsInternal(copies),
      redo: () => this.removeObjectsInternal([...ids]),
    });
    this.select(null);
  }

  private removeObjectsInternal(ids: string[]): void {
    const idset = new Set(ids);
    this.project[1](
      produce((p) => {
        p.objects = p.objects.filter((o) => !idset.has(o.id));
      }),
    );
    const sel = new Set(this.selectedIds[0]());
    for (const id of ids) sel.delete(id);
    this.selectedIds[1](sel);
    this.collisionDirty = true;
    this.emitScene();
    this.scheduleSave();
  }

  // ————————————————— 物体：变换（移动/旋转/缩放） —————————————————

  /**
   * 拖动过程中的实时更新（不入历史、不触发实例重建）。
   * 视口控制器随后直接调用 InstanceLayer.updateAllMatrices，避免数千物体卡顿。
   */
  applyTransformLive(updates: Map<string, { x: number; z: number; rotation: number; scale: number }>): void {
    this.project[1](
      produce((p) => {
        for (const o of p.objects) {
          const u = updates.get(o.id);
          if (u) Object.assign(o, u);
        }
      }),
    );
  }

  /** 交互结束后提交一条变换历史 */
  commitTransform(before: TransformSnapshot[], after: TransformSnapshot[]): void {
    const beforeMap = new Map(before.map((s) => [s.id, s]));
    const afterMap = new Map(after.map((s) => [s.id, s]));
    const apply = (map: Map<string, TransformSnapshot>) => {
      this.project[1](
        produce((p) => {
          for (const o of p.objects) {
            const s = map.get(o.id);
            if (s) {
              o.x = s.x;
              o.z = s.z;
              o.rotation = s.rotation;
              o.scale = s.scale;
            }
          }
        }),
      );
      this.collisionDirty = true;
      this.emitScene();
    };
    this.history.push({
      label: before.length > 1 ? `移动/旋转 ${before.length} 个物体` : '移动物体',
      undo: () => apply(beforeMap),
      redo: () => apply(afterMap),
    });
    this.collisionDirty = true;
    this.scheduleSave();
  }

  /** 直接设置单个物体属性（属性面板，入历史） */
  updateObject(id: string, patch: Partial<PlacedObject>): void {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj) return;
    const before = { ...obj };
    const after = { ...obj, ...patch };
    if (!this.canPlaceObject(after, after.x, after.z, after.rotation, after.scale)) return;
    this.history.push({
      label: `修改 ${obj.name}`,
      undo: () => {
        this.project[1](
          produce((p) => {
            const t = p.objects.find((o) => o.id === id);
            if (t) Object.assign(t, before);
          }),
        );
        this.emitScene();
      },
      redo: () => {
        this.project[1](
          produce((p) => {
            const t = p.objects.find((o) => o.id === id);
            if (t) Object.assign(t, patch);
          }),
        );
        this.collisionDirty = true;
        this.emitScene();
        this.scheduleSave();
      },
    });
  }

  // ————————————————— 区域 —————————————————

  addRectRegion(center: Vec2, width: number, depth: number): Region {
    const region: Region = {
      id: uid('reg'),
      type: 'rect',
      name: `矩形区域 ${this.regions.length + 1}`,
      x: center.x,
      z: center.z,
      width,
      depth,
      rotation: 0,
      color: pickRegionColor(this.regions.length),
    };
    this.history.push({
      label: '添加矩形区域',
      undo: () => this.removeRegionsInternal([region.id]),
      redo: () => this.addRegionsInternal([region]),
    });
    return region;
  }

  addPolygonRegion(points: Vec2[]): Region | null {
    if (points.length < 3) return null;
    const region: Region = {
      id: uid('reg'),
      type: 'polygon',
      name: `多边形区域 ${this.regions.length + 1}`,
      points: points.map((p) => ({ ...p })),
      color: pickRegionColor(this.regions.length),
    };
    this.history.push({
      label: '添加多边形区域',
      undo: () => this.removeRegionsInternal([region.id]),
      redo: () => this.addRegionsInternal([region]),
    });
    return region;
  }

  private addRegionsInternal(regs: Region[]): void {
    this.project[1](produce((p) => p.regions.push(...regs.map((r) => structuredClone(r)))));
    this.emitScene();
    this.scheduleSave();
  }

  updateRegion(id: string, patch: Partial<Region>): void {
    const region = this.regions.find((r) => r.id === id);
    if (!region) return;
    const before = structuredClone(region);
    this.history.push({
      label: '修改区域',
      undo: () => {
        this.project[1](
          produce((p) => {
            const t = p.regions.find((r) => r.id === id);
            if (t) Object.assign(t, before);
          }),
        );
        this.emitScene();
      },
      redo: () => {
        this.project[1](
          produce((p) => {
            const t = p.regions.find((r) => r.id === id);
            if (t) Object.assign(t, patch);
          }),
        );
        this.emitScene();
        this.scheduleSave();
      },
    });
  }

  removeRegion(id: string): void {
    const region = this.regions.find((r) => r.id === id);
    if (!region) return;
    const copy = structuredClone(region);
    this.history.push({
      label: '删除区域',
      undo: () => this.addRegionsInternal([copy]),
      redo: () => this.removeRegionsInternal([id]),
    });
  }

  private removeRegionsInternal(ids: string[]): void {
    const idset = new Set(ids);
    this.project[1](produce((p) => (p.regions = p.regions.filter((r) => !idset.has(r.id)))));
    this.emitScene();
    this.scheduleSave();
  }

  // ————————————————— 显示 / 吸附设置 —————————————————

  setCategoryVisible(category: string, visible: boolean): void {
    this.project[1](
      produce((p) => {
        for (const o of p.objects) {
          if (o.category === category) o.visible = visible;
        }
      }),
    );
    this.collisionDirty = true;
    this.emitScene();
    this.scheduleSave();
  }

  isCategoryVisible(category: string): boolean {
    return !this.objects.some((o) => o.category === category && !o.visible);
  }

  updateSnap(patch: Partial<SnapSettings>): void {
    this.project[1](produce((p) => Object.assign(p.snap, patch)));
    this.scheduleSave();
  }

  setProjectName(name: string): void {
    this.project[1](produce((p) => (p.name = name)));
    this.scheduleSave();
  }

  // ————————————————— 项目级 —————————————————

  /**
   * 批量追加物体（性能测试/批量导入用，不入历史）。
   * 一次 store 写入后统一重建碰撞世界，避免逐条写入的开销。
   */
  bulkLoadObjects(objs: PlacedObject[]): void {
    this.project[1](
      produce((p) => {
        p.objects.push(...objs.map((o) => ({ ...o })));
      }),
    );
    this.rebuildCollision();
    this.emitScene();
  }

  replaceProject(data: ProjectData): void {
    const validated = validateProject(data);
    this.project[1](validated);
    this.select(null);
    this.history.clear();
    this.rebuildCollision();
    this.emitScene();
    this.scheduleSave();
  }

  newProject(): void {
    this.replaceProject(emptyProject());
  }

  exportFile(): void {
    exportProject(this.data);
  }

  // ————————————————— 自动保存 —————————————————

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveLocal(this.data), 500);
  }

  saveNow(): void {
    saveLocal(this.data);
  }
}

const REGION_COLORS = ['#9fc3e8', '#b8dfb0', '#f2d59a', '#e6b3c0', '#c9b8e8', '#a8d8d8'];
function pickRegionColor(index: number): string {
  return REGION_COLORS[index % REGION_COLORS.length];
}

/** 全局单例 */
export const planner = new PlannerStore();
