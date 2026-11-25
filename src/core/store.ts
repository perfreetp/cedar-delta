import { createSignal } from 'solid-js';
import type {
  Camera,
  Dataset,
  FeatureInfo,
  LabelConfig,
  LayerId,
  LodTier,
  ViewState,
} from '../types';
import { ALL_LAYERS } from './lod';
import { normalizeLayerOrder, sanitizeState, saveViewState } from './persist';

export type ViewId = 'overview' | 'floor';

export interface Selection {
  keys: Set<string>;
}

export function featureKey(layer: LayerId, index: number) {
  return `${layer}:${index}`;
}

export function parseKey(key: string): { layer: LayerId; index: number } | null {
  const [layer, idx] = key.split(':');
  if (!layer || idx === undefined) return null;
  const n = Number(idx);
  if (!Number.isFinite(n)) return null;
  return { layer: layer as LayerId, index: n };
}

export function createAppStore(ds: Dataset, initial: ViewState | null) {
  // 初始状态:优先用持久化内容,否则默认
  const [state, setState] = createSignal<ViewState>(
    initial ? sanitizeState(initial) : sanitizeState(null),
  );

  const [cameras, setCameras] = createSignal<Record<ViewId, Camera>>({
    overview: state().cameras.overview,
    floor: state().cameras.floor,
  });

  const [selection, setSelection] = createSignal<Set<string>>(new Set());
  const [boxMode, setBoxMode] = createSignal(false);
  const [follow, setFollow] = createSignal(state().follow);
  /** 最近一次选中来自哪个视图;另一视图据此决定是否跟随定位 */
  const [selectionSource, setSelectionSource] = createSignal<ViewId>('floor');
  /** 递增的定位请求:两个视图各取与自己相关的一条 */
  const [focusRequest, setFocusRequest] = createSignal<{
    target: ViewId;
    x: number;
    y: number;
    zoom: number;
    seq: number;
  } | null>(null);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [statusText, setStatusText] = createSignal('');

  /** 把当前状态组装成可存快照 */
  function snapshot(): ViewState {
    const s = state();
    const c = cameras();
    return {
      version: 1,
      cameras: { overview: { ...c.overview }, floor: { ...c.floor } },
      layers: s.layers.map((l) => ({ ...l })),
      tiers: s.tiers.map((t) => ({ ...t, enabled: { ...t.enabled } })),
      label: { ...s.label },
      follow: follow(),
    };
  }

  function commit(next: ViewState) {
    setState(next);
    setCameras({ overview: next.cameras.overview, floor: next.cameras.floor });
    setFollow(next.follow);
  }

  function patchState(fn: (s: ViewState) => ViewState) {
    const next = fn(state());
    setState(next);
  }

  /** 变更后持久化(saveViewState 内部已防抖) */
  function persist() {
    saveViewState(snapshot());
  }

  function setCamera(id: ViewId, cam: Camera) {
    setCameras((prev) => ({ ...prev, [id]: cam }));
  }

  function setLayerVisible(id: LayerId, visible: boolean) {
    patchState((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible } : l)),
    }));
    persist();
  }

  function setAllLayersVisible(visible: boolean) {
    patchState((s) => ({ ...s, layers: s.layers.map((l) => ({ ...l, visible })) }));
    persist();
  }

  function setLayerOpacity(id: LayerId, opacity: number) {
    patchState((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === id ? { ...l, opacity } : l)),
    }));
  }

  /** 拖拽重排:把 from 移到 to。危险源始终固定在末位(最上层) */
  function reorderLayers(fromIndex: number, toIndex: number) {
    patchState((s) => {
      const arr = [...s.layers];
      const from = arr[fromIndex];
      if (!from || from.id === 'hazard') return s;
      const [moved] = arr.splice(fromIndex, 1);
      // 目标位置若越过危险源,夹到危险源之前
      const hazardIdx = arr.findIndex((l) => l.id === 'hazard');
      let dest = toIndex;
      if (dest > hazardIdx) dest = hazardIdx;
      dest = Math.max(0, Math.min(arr.length, dest));
      arr.splice(dest, 0, moved);
      return { ...s, layers: normalizeLayerOrder(arr) };
    });
    persist();
  }

  function moveLayerBy(id: LayerId, delta: number) {
    const idx = state().layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    reorderLayers(idx, idx + delta);
  }

  function setTiers(tiers: LodTier[]) {
    patchState((s) => ({ ...s, tiers }));
    persist();
  }

  function patchTier(index: number, patch: Partial<LodTier>) {
    patchState((s) => {
      const tiers = s.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t));
      return { ...s, tiers: ensureSorted(tiers) };
    });
    persist();
  }

  function setTierEnabled(index: number, layer: Exclude<LayerId, 'hazard'>, on: boolean) {
    patchState((s) => ({
      ...s,
      tiers: s.tiers.map((t, i) =>
        i === index ? { ...t, enabled: { ...t.enabled, [layer]: on } } : t,
      ),
    }));
    persist();
  }

  function setLabelConfig(lc: LabelConfig) {
    patchState((s) => ({ ...s, label: lc }));
    persist();
  }

  function updateFollow(v: boolean) {
    setFollow(v);
    patchState((s) => ({ ...s, follow: v }));
    persist();
  }

  function toggleLayer(id: LayerId) {
    const cur = state().layers.find((l) => l.id === id);
    if (cur) setLayerVisible(id, !cur.visible);
  }

  /* ---------------- 选中 ---------------- */

  function selectOnly(layer: LayerId, index: number, source?: ViewId) {
    if (source) setSelectionSource(source);
    setSelection(new Set([featureKey(layer, index)]));
    if (source) requestFollow(source, layer, index);
  }

  function replaceSelection(keys: string[], source?: ViewId) {
    if (source) setSelectionSource(source);
    setSelection(new Set(keys));
    if (source && keys.length) requestFollowKeys(source, keys);
  }

  /** 选中一个要素后,把另一视图的相机移过去 */
  function requestFollow(source: ViewId, layer: LayerId, index: number) {
    if (!follow()) return;
    const ext = extentOf(layer, index);
    if (!ext) return;
    const target: ViewId = source === 'overview' ? 'floor' : 'overview';
    const span = Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY);
    const zoom =
      layer === 'area'
        ? Math.min(0.6, 9000 / Math.max(span, 600))
        : layer === 'path'
          ? 0.16
          : 0.34;
    setFocusRequest({
      target,
      x: (ext.minX + ext.maxX) / 2,
      y: (ext.minY + ext.maxY) / 2,
      zoom,
      seq: (focusRequest()?.seq ?? 0) + 1,
    });
  }

  /** 框选多个:定位到这批要素的整体范围 */
  function requestFollowKeys(source: ViewId, keys: string[]) {
    if (!follow()) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of keys) {
      const p = parseKey(k);
      if (!p) continue;
      const e = extentOf(p.layer, p.index);
      if (!e) continue;
      minX = Math.min(minX, e.minX); maxX = Math.max(maxX, e.maxX);
      minY = Math.min(minY, e.minY); maxY = Math.max(maxY, e.maxY);
    }
    if (!Number.isFinite(minX)) return;
    const target: ViewId = source === 'overview' ? 'floor' : 'overview';
    setFocusRequest({
      target,
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom: Math.min(0.5, Math.max(0.02, 600 / Math.max(maxX - minX, maxY - minY, 1))),
      seq: (focusRequest()?.seq ?? 0) + 1,
    });
  }

  function addToSelection(keys: string[], source?: ViewId) {
    setSelection((prev: Set<string>) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
    // 加选也要让另一视图跟到「新增这批」的位置,否则用户看不到刚选中的东西
    if (source && keys.length) {
      setSelectionSource(source);
      requestFollowKeys(source, keys);
    }
  }

  function toggleSelection(key: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function clearSelection() {
    setSelection(new Set<string>());
  }

  function layerVisibleMap(): Record<LayerId, boolean> {
    const out = {} as Record<LayerId, boolean>;
    for (const l of state().layers) out[l.id] = l.visible;
    for (const id of ALL_LAYERS) if (!(id in out)) out[id] = true;
    return out;
  }

  /* ---------------- 要素信息 ---------------- */

  function describe(layer: LayerId, index: number): FeatureInfo | null {
    if (layer === 'path') {
      if (index >= ds.path.count) return null;
      const s = ds.path.offsets[index];
      return {
        id: ds.path.ids[index],
        layer,
        index,
        name: ds.path.names[index],
        floor: ds.path.floor[index] >= 0 ? floorLabel(ds.path.floor[index]) : undefined,
        x: ds.path.coords[s * 2],
        y: ds.path.coords[s * 2 + 1],
        meta: { 权重: ds.path.weight[index].toFixed(2) },
      };
    }
    if (layer === 'area') {
      if (index >= ds.area.count) return null;
      const rankName = ['园区分区', '楼栋轮廓', '楼层平面'][ds.area.rank[index]] ?? '区域';
      return {
        id: ds.area.ids[index],
        layer,
        index,
        name: ds.area.names[index],
        floor: ds.area.floor[index] >= 0 ? floorLabel(ds.area.floor[index]) : undefined,
        x: ds.area.bbox[index * 4],
        y: ds.area.bbox[index * 4 + 1],
        meta: { 类型: rankName },
      };
    }
    const d = ds[layer];
    if (index >= d.count) return null;
    return {
      id: d.ids[index],
      layer,
      index,
      name: d.names[index],
      floor: d.floor[index] >= 0 ? floorLabel(d.floor[index]) : undefined,
      x: d.x[index],
      y: d.y[index],
    };
  }

  function floorLabel(floorIdx: number): string {
    const f = ds.floors[floorIdx];
    return f ? `${f.building} ${f.label}` : '室外';
  }

  function pointOf(layer: LayerId, index: number): { x: number; y: number } | null {
    if (layer === 'path') {
      if (index >= ds.path.count) return null;
      const s = ds.path.offsets[index];
      return { x: ds.path.coords[s * 2], y: ds.path.coords[s * 2 + 1] };
    }
    if (layer === 'area') {
      if (index >= ds.area.count) return null;
      return {
        x: (ds.area.bbox[index * 4] + ds.area.bbox[index * 4 + 2]) / 2,
        y: (ds.area.bbox[index * 4 + 1] + ds.area.bbox[index * 4 + 3]) / 2,
      };
    }
    const d = ds[layer];
    if (index >= d.count) return null;
    return { x: d.x[index], y: d.y[index] };
  }

  /** 要素的包围盒(光标跨视图定位时选合适缩放) */
  function extentOf(layer: LayerId, index: number) {
    if (layer === 'area') {
      return {
        minX: ds.area.bbox[index * 4],
        minY: ds.area.bbox[index * 4 + 1],
        maxX: ds.area.bbox[index * 4 + 2],
        maxY: ds.area.bbox[index * 4 + 3],
      };
    }
    if (layer === 'path') {
      const s = ds.path.offsets[index];
      const e = index + 1 < ds.path.count ? ds.path.offsets[index + 1] : ds.path.coords.length / 2;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = s; k < e; k++) {
        const x = ds.path.coords[k * 2], y = ds.path.coords[k * 2 + 1];
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      return { minX, minY, maxX, maxY };
    }
    const d = ds[layer];
    return { minX: d.x[index], minY: d.y[index], maxX: d.x[index], maxY: d.y[index] };
  }

  function selectionInfos(): FeatureInfo[] {
    const out: FeatureInfo[] = [];
    for (const key of selection()) {
      const p = parseKey(key);
      if (!p) continue;
      const info = describe(p.layer, p.index);
      if (info) out.push(info);
    }
    return out;
  }

  return {
    ds,
    state,
    cameras,
    selection,
    selectionSource,
    focusRequest,
    boxMode,
    setBoxMode,
    follow,
    hovered,
    setHovered,
    statusText,
    setStatusText,
    snapshot,
    commit,
    persist,
    setCamera,
    setLayerVisible,
    setAllLayersVisible,
    setLayerOpacity,
    reorderLayers,
    moveLayerBy,
    setTiers,
    patchTier,
    setTierEnabled,
    setLabelConfig,
    setFollow: updateFollow,
    toggleLayer,
    selectOnly,
    replaceSelection,
    addToSelection,
    toggleSelection,
    clearSelection,
    layerVisibleMap,
    describe,
    pointOf,
    extentOf,
    selectionInfos,
    floorLabel,
  };
}

function ensureSorted(tiers: LodTier[]): LodTier[] {
  const sorted = [...tiers].sort((a, b) => a.minZoom - b.minZoom);
  sorted[0] = { ...sorted[0], minZoom: 0 };
  return sorted.map((t, i) => ({ ...t, id: i }));
}

export type AppStore = ReturnType<typeof createAppStore>;
