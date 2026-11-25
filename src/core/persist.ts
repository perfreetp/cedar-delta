import type { Camera, LayerId, LayerState, LodTier, ViewState } from '../types';
import { ALL_LAYERS, defaultTiers } from './lod';

const STATE_KEY = 'evac.viewstate.v1';
const PRESET_KEY = 'evac.presets.v1';

export interface Preset {
  id: string;
  name: string;
  savedAt: number;
  state: ViewState;
}

export function defaultLayerStates(): LayerState[] {
  // 数组顺序即绘制顺序(靠后的画在上面)
  return [
    { id: 'area', visible: true, opacity: 1 },
    { id: 'path', visible: true, opacity: 1 },
    { id: 'point', visible: true, opacity: 1 },
    { id: 'assembly', visible: true, opacity: 1 },
    { id: 'stair', visible: true, opacity: 1 },
    { id: 'exit', visible: true, opacity: 1 },
    { id: 'hazard', visible: true, opacity: 1 },
  ];
}

export function defaultViewState(): ViewState {
  return {
    version: 1,
    cameras: {
      overview: { x: 12000, y: 12000, zoom: 0.03, rotation: 0 },
      floor: { x: 2500, y: 4200, zoom: 0.09, rotation: 0 },
    },
    layers: defaultLayerStates(),
    tiers: defaultTiers(),
    label: { budget: 320, collapseBelow: 60 },
    follow: true,
  };
}

function clampCamera(c: unknown): Camera | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const nums = ['x', 'y', 'zoom', 'rotation'] as const;
  for (const k of nums) if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return null;
  // 全局档位的 zoom 可以低到 0.02 左右,下限必须留足余量,否则刷新后取景会被夹住
  const zoom = Math.min(8, Math.max(0.0005, o.zoom as number));
  return { x: o.x as number, y: o.y as number, zoom, rotation: o.rotation as number };
}

/** 校验并修补从存储读出的状态,任何异常都回退到默认值 */
export function sanitizeState(raw: unknown): ViewState {
  const def = defaultViewState();
  if (!raw || typeof raw !== 'object') return def;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return def;

  const out: ViewState = { ...def };

  const cams = o.cameras as Record<string, unknown> | undefined;
  const oc = clampCamera(cams?.overview);
  const fc = clampCamera(cams?.floor);
  out.cameras = { overview: oc ?? def.cameras.overview, floor: fc ?? def.cameras.floor };

  if (Array.isArray(o.layers)) {
    const seen = new Set<LayerId>();
    const layers: LayerState[] = [];
    for (const item of o.layers) {
      if (!item || typeof item !== 'object') continue;
      const l = item as Record<string, unknown>;
      const id = l.id as LayerId;
      if (!ALL_LAYERS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      layers.push({
        id,
        visible: typeof l.visible === 'boolean' ? l.visible : true,
        opacity: typeof l.opacity === 'number' ? Math.min(1, Math.max(0.1, l.opacity)) : 1,
      });
    }
    // 补全缺失的图层
    for (const id of ALL_LAYERS) if (!seen.has(id)) layers.push({ id, visible: true, opacity: 1 });
    out.layers = normalizeLayerOrder(layers);
  }

  if (Array.isArray(o.tiers)) {
    const tiers = mergeTiers(o.tiers, def.tiers);
    if (tiers) out.tiers = tiers;
  }

  const lbl = o.label as Record<string, unknown> | undefined;
  if (lbl && typeof lbl.budget === 'number') {
    out.label = {
      budget: Math.min(2000, Math.max(0, Math.round(lbl.budget))),
      collapseBelow: typeof lbl.collapseBelow === 'number' ? lbl.collapseBelow : def.label.collapseBelow,
    };
  }

  if (typeof o.follow === 'boolean') out.follow = o.follow;
  return out;
}

/** 危险源永远压在最上层 */
export function normalizeLayerOrder(layers: LayerState[]): LayerState[] {
  const rest = layers.filter((l) => l.id !== 'hazard');
  const hazard = layers.find((l) => l.id === 'hazard');
  return hazard ? [...rest, hazard] : rest;
}

function mergeTiers(raw: unknown[], base: LodTier[]): LodTier[] | null {
  if (!raw.length) return null;
  const out: LodTier[] = [];
  for (let i = 0; i < base.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') {
      out.push(base[i]);
      continue;
    }
    const t = item as Record<string, unknown>;
    const merged: LodTier = {
      ...base[i],
      minZoom: typeof t.minZoom === 'number' && Number.isFinite(t.minZoom) ? t.minZoom : base[i].minZoom,
      labelBudget:
        typeof t.labelBudget === 'number' ? Math.min(3000, Math.max(0, Math.round(t.labelBudget))) : base[i].labelBudget,
      labelMinPriority:
        typeof t.labelMinPriority === 'number' ? t.labelMinPriority : base[i].labelMinPriority,
    };
    if (t.areaMode === 'off' || t.areaMode === 'outline' || t.areaMode === 'fill') merged.areaMode = t.areaMode;
    if (t.pathMode === 'off' || t.pathMode === 'trunk' || t.pathMode === 'full') merged.pathMode = t.pathMode;
    if (t.pointMode === 'off' || t.pointMode === 'summary' || t.pointMode === 'individual') merged.pointMode = t.pointMode;
    if (t.enabled && typeof t.enabled === 'object') {
      const en = t.enabled as Record<string, unknown>;
      merged.enabled = { ...base[i].enabled };
      for (const k of Object.keys(base[i].enabled) as Exclude<LayerId, 'hazard'>[]) {
        if (typeof en[k] === 'boolean') merged.enabled[k] = en[k] as boolean;
      }
    }
    out.push(merged);
  }
  // 第一档必须从 0 开始,保证任何 zoom 都有档位
  out[0] = { ...out[0], minZoom: 0 };
  out.sort((a, b) => a.minZoom - b.minZoom);
  out.forEach((t, i) => (t.id = i));
  return out;
}

export function loadViewState(): ViewState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return sanitizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

let saveTimer = 0;
export function saveViewState(state: ViewState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* 存储不可用时静默忽略 */
    }
  }, 400);
}

export function clearViewState() {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p: unknown) => p && typeof p === 'object' && typeof (p as Preset).id === 'string')
      .map((p: Preset) => ({ ...p, state: sanitizeState(p.state) }));
  } catch {
    return [];
  }
}

export function savePresets(presets: Preset[]) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
}

export function exportState(state: ViewState): string {
  return JSON.stringify(state, null, 2);
}

export function importState(text: string): ViewState | null {
  try {
    return sanitizeState(JSON.parse(text));
  } catch {
    return null;
  }
}
