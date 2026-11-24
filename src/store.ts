// 全局 UI / 赛道数据状态(zustand)
import { create } from 'zustand';
import { DEFAULT_CONTROL_POINTS } from './lib/constants';
import { uid } from './lib/id';
import type {
  BrushSettings,
  BrushType,
  ControlPoint,
  Gate,
  GateColor,
  ModuleId,
  Step,
  ToolMode,
} from './lib/types';

export interface EditorState {
  // 模块与工具
  activeModule: ModuleId;
  toolMode: ToolMode;
  brush: BrushSettings;
  gateColor: GateColor;
  trackName: string;
  selection: { kind: 'gate' | 'point'; id: string } | null;
  toast: string | null;

  // 赛道数据(地形高度场由引擎持有,不进入 React 状态)
  controlPoints: ControlPoint[];
  steps: Step[];
  gates: Gate[];

  // 历史与刷新计数
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
  terrainVersion: number;
  profileVersion: number;

  setModule: (m: ModuleId) => void;
  setToolMode: (t: ToolMode) => void;
  patchBrush: (p: Partial<BrushSettings>) => void;
  setBrushType: (t: BrushType) => void;
  setGateColor: (c: GateColor) => void;
  setTrackName: (n: string) => void;
  setSelection: (s: EditorState['selection']) => void;
  showToast: (msg: string) => void;

  setHistoryFlags: (p: { canUndo: boolean; canRedo: boolean; depth: number }) => void;
  bumpTerrain: () => void;
  bumpProfile: () => void;

  setControlPoints: (cps: ControlPoint[]) => void;
  setSteps: (steps: Step[]) => void;
  setGates: (gates: Gate[]) => void;
  replaceAll: (data: {
    controlPoints: ControlPoint[];
    steps: Step[];
    gates: Gate[];
  }) => void;
}

const initialControlPoints: ControlPoint[] = DEFAULT_CONTROL_POINTS.map(
  (p: { x: number; z: number }) => ({
    id: uid('cp'),
    ...p,
  }),
);

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorState>((set) => ({
  activeModule: 'sculpt',
  toolMode: 'sculpt',
  brush: { type: 'raise', radius: 10, strength: 0.5, symmetric: false },
  gateColor: 'red',
  trackName: '未命名赛道',
  selection: null,
  toast: null,

  controlPoints: initialControlPoints,
  steps: [],
  gates: [],

  canUndo: false,
  canRedo: false,
  historyDepth: 0,
  terrainVersion: 0,
  profileVersion: 0,

  setModule: (activeModule) =>
    set(() => {
      // 顶部切换模块时统一退出中心线编辑模式
      const toolMode: ToolMode = activeModule === 'gate' ? 'gate' : 'sculpt';
      return { activeModule, toolMode, selection: null };
    }),
  setToolMode: (toolMode) => set({ toolMode }),
  patchBrush: (p) => set((s) => ({ brush: { ...s.brush, ...p } })),
  setBrushType: (type) => set((s) => ({ brush: { ...s.brush, type } })),
  setGateColor: (gateColor) => set({ gateColor }),
  setTrackName: (trackName) => set({ trackName }),
  setSelection: (selection) => set({ selection }),
  showToast: (msg) =>
    set(() => {
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => useEditorStore.setState({ toast: null }), 2600);
      return { toast: msg };
    }),

  setHistoryFlags: (p) =>
    set({ canUndo: p.canUndo, canRedo: p.canRedo, historyDepth: p.depth }),
  bumpTerrain: () => set((s) => ({ terrainVersion: s.terrainVersion + 1 })),
  bumpProfile: () => set((s) => ({ profileVersion: s.profileVersion + 1 })),

  setControlPoints: (controlPoints) => set({ controlPoints }),
  setSteps: (steps) => set({ steps }),
  setGates: (gates) => set({ gates }),
  replaceAll: (data) =>
    set({
      controlPoints: data.controlPoints,
      steps: data.steps,
      gates: data.gates,
      selection: null,
    }),
}));
