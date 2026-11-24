import * as THREE from 'three';
import {
  DesignDocument,
  FlowerType,
  HISTORY_LIMIT,
  HistorySnapshot,
  MAX_INSTANCES,
  SelectionInfo,
  TransformMode,
  ViewMode,
} from './types';
import {
  cloneDocument,
  createEmptyDocument,
  createInstance,
  downloadJson,
  loadStoredDocument,
  saveStoredDocument,
  uid,
  validateDocument,
} from './utils';
import { createSeedDocument } from './seed';
import { composeInstanceMatrix, decomposeInstanceMatrix } from './transformMath';
import { getFlowerGeometry } from './geometry';
import type { SceneEditor } from './SceneEditor';

type Listener = () => void;

export interface ToastState {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export class EditorController {
  doc: DesignDocument;
  past: HistorySnapshot[] = [];
  future: HistorySnapshot[] = [];
  selection = new Set<string>();
  mode: TransformMode = 'translate';
  view: ViewMode = 'free';
  selectionInfo: SelectionInfo | null = null;
  toast: ToastState | null = null;
  scene: SceneEditor | null = null;

  private listeners = new Set<Listener>();
  private version = 0;
  private toastTimer: number | null = null;

  constructor() {
    const stored = loadStoredDocument();
    if (stored) {
      this.doc = stored;
    } else {
      this.doc = createSeedDocument();
      const seedGroup = this.doc.groups[0];
      this.selection = new Set(seedGroup?.memberIds ?? this.doc.instances.map((item) => item.id));
      this.refreshSelectionInfo();
      this.persist();
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  persist(): void {
    saveStoredDocument(this.doc);
  }

  showToast(text: string, kind: ToastState['kind'] = 'info'): void {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    this.toast = { id, text, kind };
    this.emit();
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      if (this.toast?.id === id) {
        this.toast = null;
        this.emit();
      }
    }, 2600);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get selectedIds(): string[] {
    return Array.from(this.selection);
  }

  get totalCount(): number {
    return this.doc.instances.length;
  }

  getTypeCount(type: FlowerType): number {
    return this.doc.instances.filter((i) => i.type === type).length;
  }

  getInstance(id: string) {
    return this.doc.instances.find((i) => i.id === id) ?? null;
  }

  private pushHistory(label: string, before: DesignDocument): void {
    this.past.push({ label, snapshot: before, time: Date.now() });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  /** 拖拽过程中直接修改 doc；结束时调用一次，写入一条历史。 */
  commitInteraction(label: string, before: DesignDocument): void {
    this.pushHistory(label, before);
    this.persist();
    this.refreshSelectionInfo();
    this.emit();
  }

  runCommand(label: string, mutate: (doc: DesignDocument) => void, options: { rebuild?: boolean } = {}): void {
    const before = cloneDocument(this.doc);
    mutate(this.doc);
    this.pushHistory(label, before);
    this.persist();
    this.refreshSelectionInfo();
    this.emit();
    if (options.rebuild !== false) this.scene?.rebuild();
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ label: entry.label, snapshot: cloneDocument(this.doc), time: Date.now() });
    this.doc = cloneDocument(entry.snapshot);
    this.pruneSelection();
    this.refreshSelectionInfo();
    this.persist();
    this.emit();
    this.scene?.rebuild();
    this.showToast(`已撤销：${entry.label}`, 'info');
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ label: entry.label, snapshot: cloneDocument(this.doc), time: Date.now() });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.doc = cloneDocument(entry.snapshot);
    this.pruneSelection();
    this.refreshSelectionInfo();
    this.persist();
    this.emit();
    this.scene?.rebuild();
    this.showToast(`已重做：${entry.label}`, 'info');
  }

  private pruneSelection(): void {
    const ids = new Set(this.doc.instances.map((i) => i.id));
    this.selection = new Set(Array.from(this.selection).filter((id) => ids.has(id)));
  }

  select(ids: string[] | Set<string>): void {
    this.selection = new Set(ids);
    this.refreshSelectionInfo();
    this.emit();
    this.scene?.syncSelectionHelpers();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.selectionInfo = null;
    this.emit();
    this.scene?.syncSelectionHelpers();
  }

  setTransformMode(mode: TransformMode): void {
    this.mode = mode;
    this.emit();
    this.scene?.setTransformMode(mode);
  }

  setView(view: ViewMode): void {
    this.view = view;
    this.emit();
    this.scene?.setView(view);
  }

  addFlower(type: FlowerType): void {
    if (this.doc.instances.length >= MAX_INSTANCES) {
      this.showToast(`单桌最多 ${MAX_INSTANCES} 个花材实例`, 'error');
      return;
    }
    const before = cloneDocument(this.doc);
    const item = createInstance(type, this.doc.instances.length + 1);
    this.doc.instances.push(item);
    this.selection = new Set([item.id]);
    this.pushHistory(`添加${type === 'rose' ? '玫瑰' : type === 'hydrangea' ? '绣球' : '尤加利叶'}`, before);
    this.persist();
    this.refreshSelectionInfo();
    this.emit();
    this.scene?.rebuild();
    this.showToast('已在桌面中心生成，拖动时会自动避开已有花球', 'success');
  }

  deleteSelected(): void {
    if (this.selection.size === 0) return;
    const count = this.selection.size;
    this.runCommand(`删除 ${count} 个实例`, (doc) => {
      doc.instances = doc.instances.filter((i) => !this.selection.has(i.id));
      for (const group of doc.groups) {
        group.memberIds = group.memberIds.filter((id) => !this.selection.has(id));
      }
      doc.groups = doc.groups.filter((g) => g.memberIds.length > 0);
    });
    this.selection.clear();
    this.selectionInfo = null;
    this.emit();
  }

  groupSelected(): void {
    const ids = this.selectedIds;
    if (ids.length < 2) {
      this.showToast('请框选至少两个实例后再成组', 'error');
      return;
    }
    const selected = new Set(ids);
    const alreadyOneGroup = this.doc.groups.find(
      (g) => g.memberIds.length === ids.length && g.memberIds.every((id) => selected.has(id)),
    );
    if (alreadyOneGroup) {
      this.showToast('所选实例已经是同一组', 'info');
      return;
    }

    this.runCommand('成组', (doc) => {
      for (const group of doc.groups) group.memberIds = group.memberIds.filter((id) => !selected.has(id));
      doc.groups = doc.groups.filter((g) => g.memberIds.length > 0);
      const group = { id: uid('group'), name: `花材组 ${doc.groups.length + 1}`, memberIds: ids, createdAt: Date.now() };
      doc.groups.push(group);
      for (const inst of doc.instances) if (selected.has(inst.id)) inst.groupId = group.id;
    });
    this.showToast(`已将 ${ids.length} 个实例成组`, 'success');
  }

  ungroupSelected(): void {
    const ids = new Set(this.selectedIds);
    if (ids.size === 0) return;
    this.runCommand('取消成组', (doc) => {
      const groupIds = new Set(
        doc.instances.filter((i) => ids.has(i.id) && i.groupId).map((i) => i.groupId as string),
      );
      for (const groupId of groupIds) {
        const group = doc.groups.find((g) => g.id === groupId);
        if (!group) continue;
        const allSelected = group.memberIds.every((id) => ids.has(id));
        if (allSelected) {
          for (const id of group.memberIds) {
            const inst = doc.instances.find((i) => i.id === id);
            if (inst) inst.groupId = null;
          }
          doc.groups = doc.groups.filter((g) => g.id !== groupId);
        } else {
          group.memberIds = group.memberIds.filter((id) => !ids.has(id));
          for (const id of ids) {
            const inst = doc.instances.find((i) => i.id === id);
            if (inst && inst.groupId === groupId) inst.groupId = null;
          }
        }
      }
    });
    this.showToast('已取消成组', 'success');
  }

  renameSelectedGroup(name: string): void {
    const info = this.selectionInfo;
    if (!info?.groupId || !name.trim()) return;
    this.runCommand('重命名组', (doc) => {
      const group = doc.groups.find((g) => g.id === info.groupId);
      if (group) group.name = name.trim();
    });
  }

  applyOffset(delta: [number, number, number]): void {
    if (this.selection.size === 0) return;
    this.runCommand('精确偏移', (doc) => {
      for (const inst of doc.instances) {
        if (!this.selection.has(inst.id)) continue;
        inst.position[0] += delta[0];
        inst.position[1] += delta[1];
        inst.position[2] += delta[2];
      }
    });
  }

  setCenterPosition(center: [number, number, number]): void {
    const info = this.selectionInfo;
    if (!info) return;
    const delta: [number, number, number] = [
      center[0] - info.center[0],
      center[1] - info.center[1],
      center[2] - info.center[2],
    ];
    this.applyOffset(delta);
  }

  setVaseHeight(value: number): void {
    if (this.selection.size === 0) return;
    this.runCommand('调整花器高度', (doc) => {
      for (const inst of doc.instances) {
        if (this.selection.has(inst.id)) inst.vaseHeight = value;
      }
    });
  }

  scaleSelectionUniform(factor: number): void {
    if (this.selection.size === 0 || !Number.isFinite(factor) || factor <= 0) return;
    const info = this.selectionInfo;
    if (!info) return;
    const c = new THREE.Vector3(...info.center);
    const matrix = new THREE.Matrix4()
      .makeTranslation(c.x, c.y, c.z)
      .multiply(new THREE.Matrix4().makeScale(factor, factor, factor))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));

    this.runCommand('缩放', (doc) => {
      for (const inst of doc.instances) {
        if (!this.selection.has(inst.id)) continue;
        const world = composeInstanceMatrix(inst);
        world.premultiply(matrix);
        decomposeInstanceMatrix(inst, world);
      }
    });
  }

  rotateSelectionY(degrees: number): void {
    if (this.selection.size === 0) return;
    const info = this.selectionInfo;
    if (!info) return;
    const angle = THREE.MathUtils.degToRad(degrees);
    const c = new THREE.Vector3(info.center[0], info.center[1], info.center[2]);
    const matrix = new THREE.Matrix4()
      .makeTranslation(c.x, c.y, c.z)
      .multiply(new THREE.Matrix4().makeRotationY(angle))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    this.runCommand('旋转', (doc) => {
      for (const inst of doc.instances) {
        if (!this.selection.has(inst.id)) continue;
        const world = composeInstanceMatrix(inst);
        world.premultiply(matrix);
        decomposeInstanceMatrix(inst, world);
      }
    });
  }

  mirrorSelected(copy = false): void {
    const sourceIds = this.selectedIds;
    if (sourceIds.length === 0) {
      this.showToast('请先选择要镜像的组', 'error');
      return;
    }
    const before = cloneDocument(this.doc);
    const sourceSet = new Set(sourceIds);
    const info = this.selectionInfo ?? this.computeSelectionInfo(sourceSet);
    if (!info) return;

    let targetIds = sourceIds;
    let label = '水平镜像';

    if (copy) {
      label = '水平镜像复制';
      const idMap = new Map<string, string>();
      const copies = this.doc.instances
        .filter((i) => sourceSet.has(i.id))
        .map((inst) => {
          const next = cloneDocument({ ...createEmptyDocument(), instances: [inst], groups: [] }).instances[0];
          const newId = uid('flower');
          idMap.set(inst.id, newId);
          next.id = newId;
          next.groupId = null;
          next.name = `${inst.name} 镜像`;
          return next;
        });
      this.doc.instances.push(...copies);
      targetIds = copies.map((i) => i.id);

      if (copies.length > 1) {
        const group = {
          id: uid('group'),
          name: `镜像组 ${this.doc.groups.length + 1}`,
          memberIds: targetIds,
          createdAt: Date.now(),
        };
        this.doc.groups.push(group);
        for (const inst of copies) inst.groupId = group.id;
      }
      if (this.doc.instances.length > MAX_INSTANCES) {
        this.doc = cloneDocument(before);
        this.showToast(`镜像后将超过 ${MAX_INSTANCES} 个实例`, 'error');
        return;
      }
    }

    const c = info.center;
    const mirror = new THREE.Matrix4()
      .makeTranslation(c[0], 0, c[2])
      .multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
      .multiply(new THREE.Matrix4().makeTranslation(-c[0], 0, -c[2]));

    const targetSet = new Set(targetIds);
    for (const inst of this.doc.instances) {
      if (!targetSet.has(inst.id)) continue;
      const world = composeInstanceMatrix(inst);
      world.premultiply(mirror);
      decomposeInstanceMatrix(inst, world);
    }

    this.selection = targetSet;
    this.pushHistory(label, before);
    this.persist();
    this.refreshSelectionInfo();
    this.emit();
    this.scene?.rebuild();
    this.showToast(copy ? '已生成水平镜像副本' : '已完成水平镜像', 'success');
  }

  circularArray(sectors: 8 | 12): void {
    const sourceIds = this.selectedIds;
    if (sourceIds.length === 0) {
      this.showToast('请先选择要阵列的组', 'error');
      return;
    }
    const additional = (sectors - 1) * sourceIds.length;
    if (this.doc.instances.length + additional > MAX_INSTANCES) {
      this.showToast(`阵列后将超过 ${MAX_INSTANCES} 个实例`, 'error');
      return;
    }

    this.runCommand(`环形阵列 ${sectors} 等分`, (doc) => {
      const sourceInstances = doc.instances.filter((i) => this.selection.has(i.id));
      const allAffected = new Set<string>(sourceIds);
      for (let k = 1; k < sectors; k++) {
        const angle = (k / sectors) * Math.PI * 2;
        const rotation = new THREE.Matrix4().makeRotationY(angle);
        const copyIds: string[] = [];
        for (const source of sourceInstances) {
          const copy = JSON.parse(JSON.stringify(source)) as (typeof sourceInstances)[number];
          copy.id = uid('flower');
          copy.groupId = null;
          copy.name = `${source.name} · 阵列${k + 1}`;
          const world = composeInstanceMatrix(copy);
          world.premultiply(rotation);
          decomposeInstanceMatrix(copy, world);
          doc.instances.push(copy);
          copyIds.push(copy.id);
          allAffected.add(copy.id);
        }
        if (copyIds.length > 1) {
          const group = {
            id: uid('group'),
            name: `环形 ${sectors} 等分 · ${k + 1}`,
            memberIds: copyIds,
            createdAt: Date.now(),
          };
          doc.groups.push(group);
          for (const id of copyIds) {
            const inst = doc.instances.find((i) => i.id === id);
            if (inst) inst.groupId = group.id;
          }
        }
      }
      this.selection = allAffected;
    });
    // runCommand's rebuild occurs before selection Set is reassigned inside callback? Actually callback sets this.selection.
    this.select(this.selection);
    this.showToast(`已按 ${sectors} 等分完成环形阵列`, 'success');
  }

  exportJson(): void {
    downloadJson(this.doc);
    this.showToast('布置方案 JSON 已导出', 'success');
  }

  importJsonText(text: string): void {
    try {
      const doc = validateDocument(JSON.parse(text));
      this.doc = doc;
      this.past = [];
      this.future = [];
      this.selection.clear();
      this.selectionInfo = null;
      this.persist();
      this.emit();
      this.scene?.rebuild();
      this.showToast('方案导入成功', 'success');
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : '导入失败', 'error');
    }
  }

  clearTable(): void {
    if (this.doc.instances.length === 0) return;
    this.runCommand('清空桌面', (doc) => {
      doc.instances = [];
      doc.groups = [];
    });
    this.selection.clear();
    this.selectionInfo = null;
    this.emit();
    this.showToast('桌面已清空', 'info');
  }

  resetSample(): void {
    this.doc = createSeedDocument();
    this.past = [];
    this.future = [];
    this.selection.clear();
    this.persist();
    this.emit();
    this.scene?.rebuild();
    this.showToast('已恢复示例主桌花', 'success');
  }

  computeSelectionInfo(ids: Set<string> = this.selection): SelectionInfo | null {
    if (ids.size === 0) return null;
    const box = new THREE.Box3();
    const instanceBox = new THREE.Box3();
    const matrix = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    const typeCounts = { rose: 0, hydrangea: 0, eucalyptus: 0 };
    let vaseSum = 0;
    let vaseCount = 0;
    let sameVase: number | null = null;
    let commonScale: [number, number, number] | null = null;
    let scaleMismatch = false;
    let groupId: string | null | undefined;

    for (const inst of this.doc.instances) {
      if (!ids.has(inst.id)) continue;
      typeCounts[inst.type] += 1;
      composeInstanceMatrix(inst, matrix);
      const geometry = getFlowerGeometry(inst.type);
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      instanceBox.copy(geometry.boundingBox!).applyMatrix4(matrix);
      box.union(instanceBox);

      vaseSum += inst.vaseHeight;
      vaseCount += 1;
      if (sameVase === null) sameVase = inst.vaseHeight;
      else if (Math.abs(sameVase - inst.vaseHeight) > 0.001) sameVase = Number.NaN;

      if (!commonScale) commonScale = [...inst.scale] as [number, number, number];
      else if (
        Math.abs(commonScale[0] - inst.scale[0]) > 0.001 ||
        Math.abs(commonScale[1] - inst.scale[1]) > 0.001 ||
        Math.abs(commonScale[2] - inst.scale[2]) > 0.001
      ) {
        scaleMismatch = true;
      }

      if (groupId === undefined) groupId = inst.groupId;
      else if (groupId !== inst.groupId) groupId = null;
    }

    if (box.isEmpty()) return null;
    box.getCenter(center);
    box.getSize(size);
    const group = groupId ? this.doc.groups.find((g) => g.id === groupId) : null;
    return {
      count: ids.size,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      center: [center.x, center.y, center.z],
      size: [size.x, size.y, size.z],
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
      typeCounts,
      vaseHeight: sameVase !== null && Number.isNaN(sameVase) ? null : sameVase ?? vaseSum / Math.max(1, vaseCount),
      scale: scaleMismatch ? null : commonScale,
    };
  }

  refreshSelectionInfo(): void {
    this.selectionInfo = this.computeSelectionInfo();
  }
}
