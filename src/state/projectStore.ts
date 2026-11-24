import { createSignal } from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { LIBRARY_ITEMS, LIBRARY_MAP } from '../data/library';
import { DEFAULT_RIVER, RiverPath } from '../river';
import { colliderHalfHeight } from '../lib/obstacleMath';
import { clamp, round, uid } from '../lib/utils';
import type {
  CollisionReport,
  LibraryItem,
  ObGroup,
  Obstacle,
  ProjectDocument,
  SelectionGestureUpdate,
  Vec3Tuple,
} from '../types';

function initialDocument(): ProjectDocument {
  const river = DEFAULT_RIVER;
  const path = new RiverPath(river);

  const make = (
    libraryId: string,
    s: number,
    lateral: number,
    overrides: Partial<Obstacle> = {},
  ): Obstacle => {
    const item = LIBRARY_MAP.get(libraryId)!;
    const frame = path.atDistance(s, lateral);
    const height = item.baseSize[1] * item.defaultScale[1];
    const obstacle: Obstacle = {
      id: uid('obs'),
      libraryId: item.id,
      name: item.name,
      category: item.category,
      kind: item.kind,
      position: [
        frame.position.x,
        overrides.position?.[1] ?? item.defaultExposure - height / 2,
        frame.position.z,
      ],
      rotation: [0, (-frame.angleY * 180) / Math.PI, 0],
      scale: [...item.defaultScale] as Vec3Tuple,
      exposure: item.defaultExposure,
      suspension:
        item.kind === 'buoy'
          ? Math.round((item.defaultExposure - height / 2) * 100) / 100
          : (item.defaultSuspension ?? 0),
      groupId: null,
      color: item.color,
      collider: structuredClone(item.collider),
      ...overrides,
    };
    if (overrides.position) obstacle.position = [...overrides.position];
    if (overrides.rotation) obstacle.rotation = [...overrides.rotation];
    if (overrides.scale) obstacle.scale = [...overrides.scale];
    if (overrides.exposure !== undefined && !overrides.position) {
      obstacle.position[1] =
        overrides.exposure - colliderHalfHeight(obstacle.collider) * obstacle.scale[1];
      if (obstacle.kind === 'buoy') obstacle.suspension = round(obstacle.position[1], 2);
    }
    return obstacle;
  };

  const reefGroup: ObGroup = { id: uid('grp'), name: '入口暗礁组', color: '#38bdf8' };
  const gateGroup: ObGroup = { id: uid('grp'), name: '1号回转门', color: '#22c55e' };

  const reef1 = make('rock-reef', 15, -2.7, { groupId: reefGroup.id, exposure: 0.22 });
  const reef2 = make('rock-slab', 20, 2.9, { groupId: reefGroup.id, exposure: 0.31 });
  reefGroup.batch = {
    spacing: 4.2,
    startS: 15,
    lateral: -2.7,
    memberIds: [reef1.id, reef2.id],
  };

  const gateLeft = make('buoy-red', 39, -2.1, { groupId: gateGroup.id });
  const gateRight = make('buoy-red', 39, 2.1, { groupId: gateGroup.id });
  gateGroup.batch = {
    spacing: 4.2,
    startS: 39,
    lateral: 0,
    memberIds: [gateLeft.id, gateRight.id],
  };

  return {
    format: 'rapid-river-obstacle-layout',
    formatVersion: 1,
    name: '青白江训练赛道-A段',
    river,
    detection: {
      laneThreshold: 7.5,
      pairThreshold: 0.08,
      reefThreshold: 0.35,
      showColliders: true,
      showChannel: true,
      showLabels: true,
    },
    obstacles: [
      make('rock-granite', 25, 0.8, { exposure: 1.05 }),
      reef1,
      reef2,
      make('art-deflector', 31, 3.4, { rotation: [0, -28, 0] }),
      gateLeft,
      gateRight,
      make('art-pier', 9, -6.1, { exposure: 2.35 }),
    ],
    groups: [reefGroup, gateGroup],
  };
}

const [doc, setDoc] = createStore<ProjectDocument>(initialDocument());
const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
const [activeModule, setActiveModule] = createSignal<'library' | 'transform' | 'collision' | 'export'>('library');
const [collisionReport, setCollisionReport] = createSignal<CollisionReport>({
  ready: false,
  computing: false,
  laneVolumes: {},
  pairs: [],
  durationMs: 0,
  obstacleCount: 0,
  solidCount: 0,
});
const [historyTick, setHistoryTick] = createSignal(0);
const [toast, setToast] = createSignal<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(null);

interface HistoryEntry {
  label: string;
  before: ProjectDocument;
  after: ProjectDocument;
}

const past: HistoryEntry[] = [];
const future: HistoryEntry[] = [];
const HISTORY_LIMIT = 120;
let gesture: { label: string; before: ProjectDocument } | null = null;
let toastTimer: number | undefined;

function notifyHistory() {
  setHistoryTick((n) => n + 1);
}

function showToast(text: string, tone: 'ok' | 'warn' | 'error' = 'ok') {
  setToast({ text, tone });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => setToast(null), 2600);
}

function cloneDoc(source: ProjectDocument = unwrap(doc) as ProjectDocument): ProjectDocument {
  return structuredClone(source);
}

function normalizeVertical(target: Obstacle): void {
  const halfHeight = colliderHalfHeight(target.collider) * target.scale[1];
  target.exposure = round(clamp(target.position[1] + halfHeight, 0, 8), 2);
  if (target.kind === 'buoy') target.suspension = round(target.position[1], 2);
}

function snapshotsEqual(a: ProjectDocument, b: ProjectDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function commit(label: string, mutator?: (draft: ProjectDocument) => void): string | null {
  const before = cloneDoc();
  if (mutator) setDoc(produce(mutator));
  const after = cloneDoc();
  if (snapshotsEqual(before, after)) return null;
  past.push({ label, before, after });
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  notifyHistory();
  return label;
}

function beginGesture(label: string) {
  gesture = { label, before: cloneDoc() };
}

function gestureMutate(mutator: (draft: ProjectDocument) => void) {
  setDoc(produce(mutator));
}

function endGesture(): boolean {
  if (!gesture) return false;
  const currentGesture = gesture;
  gesture = null;
  const after = cloneDoc();
  if (snapshotsEqual(currentGesture.before, after)) return false;
  past.push({ label: currentGesture.label, before: currentGesture.before, after });
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  notifyHistory();
  return true;
}

function cancelGesture() {
  if (!gesture) return;
  applySnapshot(gesture.before);
  gesture = null;
}

function undo() {
  const entry = past.pop();
  if (!entry) return;
  future.push(entry);
  applySnapshot(entry.before);
  notifyHistory();
  showToast(`已撤销：${entry.label}`);
}

function redo() {
  const entry = future.pop();
  if (!entry) return;
  past.push(entry);
  applySnapshot(entry.after);
  notifyHistory();
  showToast(`已重做：${entry.label}`);
}

function applySnapshot(snapshot: ProjectDocument) {
  setDoc(reconcile(cloneDoc(snapshot)));
}

function canUndo() {
  historyTick();
  return past.length > 0;
}

function canRedo() {
  historyTick();
  return future.length > 0;
}

function createObstacle(item: LibraryItem, point?: Vec3Tuple): Obstacle {
  const height = item.baseSize[1] * item.defaultScale[1];
  const position: Vec3Tuple = point
    ? [point[0], item.defaultExposure - height / 2, point[2]]
    : [0, item.defaultExposure - height / 2, 0];

  if (!point) {
    const path = new RiverPath(doc.river);
    const frame = path.atDistance(path.length * 0.55, 0);
    position[0] = frame.position.x;
    position[2] = frame.position.z;
    position[1] = item.defaultExposure - height / 2;
  }

  return {
    id: uid('obs'),
    libraryId: item.id,
    name: item.name,
    category: item.category,
    kind: item.kind,
    position,
    rotation: [0, 0, 0],
    scale: [...item.defaultScale] as Vec3Tuple,
    exposure: item.defaultExposure,
    suspension: item.kind === 'buoy' ? Math.round(position[1] * 100) / 100 : (item.defaultSuspension ?? clamp(position[1], -2, 6)),
    groupId: null,
    color: item.color,
    collider: structuredClone(item.collider),
  };
}

function addLibraryItem(libraryId: string, point?: Vec3Tuple): string | null {
  const item = LIBRARY_MAP.get(libraryId);
  if (!item) return null;
  const obstacle = createObstacle(item, point);
  commit(`添加${item.name}`, (d) => {
    d.obstacles.push(obstacle);
  });
  setSelectedIds([obstacle.id]);
  showToast(`已放入：${item.name}`);
  return obstacle.id;
}

function updateObstacle(id: string, patch: Partial<Obstacle>, label = '修改属性') {
  commit(label, (d) => {
    const target = d.obstacles.find((o) => o.id === id);
    if (target) {
      Object.assign(target, patch);
      normalizeVertical(target);
    }
  });
}

function updateObstacleLive(id: string, patch: Partial<Obstacle>) {
  gestureMutate((d) => {
    const target = d.obstacles.find((o) => o.id === id);
    if (target) {
      Object.assign(target, patch);
      normalizeVertical(target);
    }
  });
}

function applyTransformGesture(updates: SelectionGestureUpdate[]) {
  gestureMutate((d) => {
    for (const update of updates) {
      const target = d.obstacles.find((o) => o.id === update.id);
      if (!target) continue;
      target.position = [...update.position];
      target.rotation = update.rotation.map((v) => Math.round(v * 100) / 100) as Vec3Tuple;
      normalizeVertical(target);
    }
  });
}

function deleteIds(ids: string[]) {
  if (!ids.length) return;
  const idSet = new Set(ids);
  commit(`删除 ${ids.length} 个障碍`, (d) => {
    d.obstacles = d.obstacles.filter((o) => !idSet.has(o.id));
    for (const group of d.groups) {
      if (group.batch) group.batch.memberIds = group.batch.memberIds.filter((id) => !idSet.has(id));
    }
    d.groups = d.groups.filter((g) => !g.batch || g.batch.memberIds.length > 0);
  });
  setSelectedIds([]);
  showToast(`已删除 ${ids.length} 个障碍`);
}

function deleteSelected() {
  deleteIds(selectedIds());
}

function duplicateIds(ids: string[]): string[] {
  if (!ids.length) return [];
  const newIds: string[] = [];
  commit(`复制 ${ids.length} 个障碍`, (d) => {
    const copies = ids
      .map((id) => d.obstacles.find((o) => o.id === id))
      .filter((o): o is Obstacle => Boolean(o))
      .map((source) => {
        const copy = structuredClone(source);
        copy.id = uid('obs');
        copy.name = `${source.name} 副本`;
        copy.position = [source.position[0] + 0.8, source.position[1], source.position[2] + 0.8];
        copy.groupId = null;
        newIds.push(copy.id);
        return copy;
      });
    d.obstacles.push(...copies);
  });
  setSelectedIds(newIds);
  return newIds;
}

function duplicateSelected() {
  duplicateIds(selectedIds());
}

function selectObstacle(id: string | null, additive = false) {
  if (!id) {
    setSelectedIds([]);
    return;
  }
  const obstacle = doc.obstacles.find((o) => o.id === id);
  let next: string[];
  if (additive) {
    const current = selectedIds();
    next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  } else if (obstacle?.groupId) {
    next = doc.obstacles.filter((o) => o.groupId === obstacle.groupId).map((o) => o.id);
  } else {
    next = [id];
  }
  setSelectedIds(next);
}

function createGroupFromSelection(name?: string): string | null {
  const ids = selectedIds();
  if (ids.length < 2) {
    showToast('请至少选择两个障碍再编组', 'warn');
    return null;
  }
  const group: ObGroup = {
    id: uid('grp'),
    name: name?.trim() || `障碍分组 ${doc.groups.length + 1}`,
    color: ['#38bdf8', '#a78bfa', '#fb7185', '#34d399', '#fbbf24'][doc.groups.length % 5],
  };
  commit('创建分组', (d) => {
    d.groups.push(group);
    for (const o of d.obstacles) if (ids.includes(o.id)) o.groupId = group.id;
  });
  showToast(`已编组：${group.name}`);
  return group.id;
}

function renameGroup(groupId: string, name: string) {
  commit('重命名分组', (d) => {
    const group = d.groups.find((g) => g.id === groupId);
    if (group) group.name = name;
  });
}

function setGroupColor(groupId: string, color: string) {
  commit('修改分组颜色', (d) => {
    const group = d.groups.find((g) => g.id === groupId);
    if (group) group.color = color;
  });
}

function dissolveGroup(groupId: string) {
  commit('解散分组', (d) => {
    for (const o of d.obstacles) if (o.groupId === groupId) o.groupId = null;
    d.groups = d.groups.filter((g) => g.id !== groupId);
  });
  showToast('分组已解散');
}

function deleteGroup(groupId: string) {
  const memberIds = doc.obstacles.filter((o) => o.groupId === groupId).map((o) => o.id);
  commit('删除整组', (d) => {
    d.obstacles = d.obstacles.filter((o) => o.groupId !== groupId);
    d.groups = d.groups.filter((g) => g.id !== groupId);
  });
  setSelectedIds([]);
  showToast(`已删除分组及 ${memberIds.length} 个障碍`);
}

function selectGroupMembers(groupId: string) {
  setSelectedIds(doc.obstacles.filter((o) => o.groupId === groupId).map((o) => o.id));
}

function createBuoyRow(countInput = 8, spacingInput = 4): string | null {
  const selectedBuoy = selectedIds()
    .map((id) => doc.obstacles.find((o) => o.id === id))
    .find((o): o is Obstacle => Boolean(o && o.kind === 'buoy'));
  const templateItem = LIBRARY_MAP.get(selectedBuoy?.libraryId ?? 'buoy-red') ?? LIBRARY_ITEMS[3];
  const count = Math.max(2, Math.min(40, Math.round(countInput)));
  const requestedSpacing = clamp(spacingInput, 1, 20);
  const path = new RiverPath(doc.river);
  const maxFitSpacing = (path.length - 6) / (count - 1);
  const spacing = Math.min(requestedSpacing, Math.max(0.8, maxFitSpacing));

  let startS: number;
  let lateral: number;
  let template: Obstacle;
  if (selectedBuoy) {
    const info = path.nearest(selectedBuoy.position[0], selectedBuoy.position[2]);
    startS = clamp(info.s, 3, Math.max(3, path.length - 3 - spacing * (count - 1)));
    lateral = info.lateral;
    template = structuredClone(unwrap(selectedBuoy) as Obstacle);
  } else {
    startS = Math.max(3, (path.length - spacing * (count - 1)) / 2);
    lateral = 0;
    template = createObstacle(templateItem);
  }

  const groupId = uid('grp');
  const memberIds: string[] = selectedBuoy ? [selectedBuoy.id] : [];
  const newObstacles: Obstacle[] = [];
  const createCount = selectedBuoy ? count - 1 : count;
  const startIndex = selectedBuoy ? 1 : 0;

  for (let rowIndex = 0; rowIndex < createCount; rowIndex++) {
    const sequenceIndex = startIndex + rowIndex;
    const frame = path.atDistance(startS + sequenceIndex * spacing, lateral);
    const obstacle: Obstacle = {
      ...structuredClone(template),
      id: uid('obs'),
      name: `${templateItem.name} ${String(sequenceIndex + 1).padStart(2, '0')}`,
      position: [frame.position.x, template.position[1], frame.position.z],
      rotation: [template.rotation[0], (-frame.angleY * 180) / Math.PI, template.rotation[2]],
      groupId,
    };
    newObstacles.push(obstacle);
    memberIds.push(obstacle.id);
  }

  const group: ObGroup = {
    id: groupId,
    name: `浮标等距列 · ${spacing.toFixed(1)}m`,
    color: '#38bdf8',
    batch: { spacing, startS, lateral, memberIds },
  };

  commit('批量复制浮标列', (d) => {
    for (const oldGroup of d.groups) {
      if (oldGroup.batch && selectedBuoy) {
        oldGroup.batch.memberIds = oldGroup.batch.memberIds.filter((id) => id !== selectedBuoy.id);
      }
    }
    d.groups = d.groups.filter((g) => !g.batch || g.batch.memberIds.length > 0);
    d.groups.push(group);
    d.obstacles.push(...newObstacles);

    if (selectedBuoy) {
      const existing = d.obstacles.find((o) => o.id === selectedBuoy.id);
      if (existing) {
        const firstFrame = path.atDistance(startS, lateral);
        existing.groupId = groupId;
        existing.position[0] = firstFrame.position.x;
        existing.position[2] = firstFrame.position.z;
        existing.rotation[1] = (-firstFrame.angleY * 180) / Math.PI;
      }
    }
  });
  setSelectedIds(memberIds);
  setActiveModule('transform');
  showToast(selectedBuoy ? `已以选中浮标为首生成 ${count} 个等距浮标` : `已沿河道生成 ${count} 个等距浮标`);
  return groupId;
}

function layoutBatch(groupId: string, spacing: number) {
  const group = doc.groups.find((g) => g.id === groupId);
  if (!group?.batch) return;
  const batch = group.batch;
  const members = batch.memberIds
    .map((id) => doc.obstacles.find((o) => o.id === id))
    .filter((o): o is Obstacle => Boolean(o));
  if (!members.length) return;

  const path = new RiverPath(doc.river);
  const first = members[0];
  const anchor = path.nearest(first.position[0], first.position[2]);
  const maxFitSpacing = members.length > 1 ? (path.length - 6) / (members.length - 1) : 25;
  const safeSpacing = clamp(spacing, 0.8, Math.max(0.8, maxFitSpacing));
  const span = safeSpacing * (members.length - 1);
  const startS = clamp(anchor.s, 3, Math.max(3, path.length - 3 - span));

  setDoc(
    produce((d) => {
      const draftGroup = d.groups.find((g) => g.id === groupId);
      if (draftGroup?.batch) {
        draftGroup.batch.spacing = safeSpacing;
        draftGroup.batch.startS = startS;
        draftGroup.batch.lateral = anchor.lateral;
        draftGroup.name = draftGroup.name.replace(/·.*$/, `· ${safeSpacing.toFixed(1)}m`);
      }
      const ids = draftGroup?.batch?.memberIds ?? batch.memberIds;
      ids.forEach((id, index) => {
        const target = d.obstacles.find((o) => o.id === id);
        if (!target) return;
        const frame = path.atDistance(startS + index * safeSpacing, anchor.lateral);
        target.position[0] = frame.position.x;
        target.position[2] = frame.position.z;
      });
    }),
  );
}

function setDetection(patch: Partial<ProjectDocument['detection']>) {
  setDoc(
    produce((d) => {
      Object.assign(d.detection, patch);
    }),
  );
}

function setProjectName(name: string) {
  setDoc('name', name);
}

function loadImportedDocument(next: ProjectDocument) {
  const before = cloneDoc();
  applySnapshot(next);
  const after = cloneDoc();
  past.push({ label: '导入方案', before, after });
  future.length = 0;
  notifyHistory();
  setSelectedIds([]);
}

function resetWorkspace() {
  const fresh = initialDocument();
  const before = cloneDoc();
  applySnapshot(fresh);
  past.push({ label: '重置示例赛道', before, after: cloneDoc(fresh) });
  future.length = 0;
  notifyHistory();
  setSelectedIds([]);
  showToast('已重置为示例赛道');
}

export const projectStore = {
  doc,
  selectedIds,
  setSelectedIds,
  activeModule,
  setActiveModule,
  collisionReport,
  setCollisionReport,
  toast,
  showToast,
  historyTick,
  commit,
  beginGesture,
  endGesture,
  cancelGesture,
  gestureMutate,
  undo,
  redo,
  canUndo,
  canRedo,
  addLibraryItem,
  updateObstacle,
  updateObstacleLive,
  applyTransformGesture,
  deleteSelected,
  deleteIds,
  duplicateSelected,
  duplicateIds,
  selectObstacle,
  createGroupFromSelection,
  renameGroup,
  setGroupColor,
  dissolveGroup,
  deleteGroup,
  selectGroupMembers,
  createBuoyRow,
  layoutBatch,
  setDetection,
  setProjectName,
  loadImportedDocument,
  resetWorkspace,
};
