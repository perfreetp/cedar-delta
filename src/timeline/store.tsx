import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { Easing, Pose, TimelineDoc, TrackTarget } from './types';
import {
  createDefaultDoc,
  deleteKey,
  deserialize,
  findNode,
  groupNodes,
  isGroup,
  moveGroup,
  moveKey,
  sampleAll,
  scaleGroup,
  serialize,
  ungroup,
  upsertKey,
  globalToLocal,
} from './model';
import { allTracks } from './model';
import type { TrackNode } from './types';

const STORAGE_KEY = 'implant-timeline-v1';

export interface CurveEditTarget {
  trackId: string;
  keyId: string;
}

interface State {
  doc: TimelineDoc;
  time: number;
  playing: boolean;
  loop: boolean;
  ripple: boolean;
  cameraDriven: boolean;
  selectedKey: { trackId: string; keyId: string } | null;
  selectedNodeIds: string[];
  curveEdit: CurveEditTarget | null;
  savedAt: number | null;
}

type Action =
  | { type: 'setTime'; time: number }
  | { type: 'tick'; dt: number }
  | { type: 'togglePlay' }
  | { type: 'toggleLoop' }
  | { type: 'toggleRipple' }
  | { type: 'toggleCameraDriven' }
  | { type: 'doc'; doc: TimelineDoc }
  | { type: 'mutate'; fn: (doc: TimelineDoc) => void }
  | { type: 'selectKey'; trackId: string; keyId: string }
  | { type: 'clearKeySelection' }
  | { type: 'toggleNode'; id: string }
  | { type: 'setCurveEdit'; target: CurveEditTarget | null }
  | { type: 'saved' };

function clone(doc: TimelineDoc): TimelineDoc {
  return JSON.parse(JSON.stringify(doc)) as TimelineDoc;
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'setTime':
      return { ...s, time: Math.max(0, Math.min(a.time, s.doc.duration)), playing: false };
    case 'tick': {
      let t = s.time + a.dt;
      let playing = s.playing;
      if (t >= s.doc.duration) {
        if (s.loop) t = t % s.doc.duration;
        else {
          t = s.doc.duration;
          playing = false;
        }
      }
      return { ...s, time: t, playing };
    }
    case 'togglePlay':
      return { ...s, playing: !s.playing };
    case 'toggleLoop':
      return { ...s, loop: !s.loop };
    case 'toggleRipple':
      return { ...s, ripple: !s.ripple };
    case 'toggleCameraDriven':
      return { ...s, cameraDriven: !s.cameraDriven };
    case 'doc':
      return { ...s, doc: a.doc, time: Math.min(s.time, a.doc.duration) };
    case 'mutate': {
      const doc = clone(s.doc);
      a.fn(doc);
      return { ...s, doc };
    }
    case 'selectKey':
      return { ...s, selectedKey: { trackId: a.trackId, keyId: a.keyId } };
    case 'clearKeySelection':
      return { ...s, selectedKey: null };
    case 'toggleNode': {
      const has = s.selectedNodeIds.includes(a.id);
      return {
        ...s,
        selectedNodeIds: has
          ? s.selectedNodeIds.filter((x) => x !== a.id)
          : [...s.selectedNodeIds, a.id],
      };
    }
    case 'setCurveEdit':
      return { ...s, curveEdit: a.target };
    case 'saved':
      return { ...s, savedAt: Date.now() };
    default:
      return s;
  }
}

function loadInitial(): TimelineDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return deserialize(raw);
  } catch {
    /* 损坏则重建 */
  }
  return createDefaultDoc();
}

/** 场景层注册的接口:取/设某个目标的当前姿态(由 Babylon 视口实现) */
export interface SceneApi {
  getPose: (target: TrackTarget) => Pose | null;
  applyPoses: (poses: Map<string, Pose>) => void;
  refreshHelpers: () => void;
  setGizmoTarget: (target: 'instrument' | 'guidewire' | null) => void;
}
export const sceneApiRef: { current: SceneApi | null } = { current: null };

interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  /** 在当前播放头时间记录关键帧(从 3D 场景取当前姿态) */
  recordKey: (trackId: string) => void;
  save: () => void;
  exportJson: () => void;
  importJson: (text: string) => boolean;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    doc: loadInitial(),
    time: 0,
    playing: false,
    loop: true,
    ripple: true,
    cameraDriven: true,
    selectedKey: null,
    selectedNodeIds: [],
    curveEdit: null,
    savedAt: null,
  }));

  // 播放循环
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  useEffect(() => {
    if (!state.playing) return;
    lastRef.current = performance.now();
    const step = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      dispatch({ type: 'tick', dt });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.playing]);

  // 时间或文档变化 -> 驱动 3D 场景(多轨同一时钟,天然同步)
  useEffect(() => {
    sceneApiRef.current?.applyPoses(sampleAll(state.doc, state.time));
  }, [state.doc, state.time]);

  const recordKey = useCallback(
    (trackId: string) => {
      const track = findNode(state.doc.nodes, trackId);
      if (!track || isGroup(track)) return;
      const pose = sceneApiRef.current?.getPose((track as TrackNode).target);
      if (!pose) return;
      const local = globalToLocal(state.doc, trackId, state.time);
      dispatch({ type: 'mutate', fn: (doc) => {
        const t = findNode(doc.nodes, trackId);
        if (t && !isGroup(t)) upsertKey(t as TrackNode, local, pose);
      } });
    },
    [state.doc, state.time],
  );

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, serialize(state.doc));
    dispatch({ type: 'saved' });
  }, [state.doc]);

  const exportJson = useCallback(() => {
    const blob = new Blob([serialize(state.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'implant-timeline.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [state.doc]);

  const importJson = useCallback((text: string) => {
    try {
      const doc = deserialize(text);
      dispatch({ type: 'doc', doc });
      return true;
    } catch {
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    dispatch({ type: 'doc', doc: createDefaultDoc() });
  }, []);

  const store = useMemo(
    () => ({ state, dispatch, recordKey, save, exportJson, importJson, reset }),
    [state, recordKey, save, exportJson, importJson, reset],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useTimeline(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useTimeline must be used inside TimelineProvider');
  return s;
}

// 便捷操作集合(组件里直接用)
export const ops = {
  moveKey,
  deleteKey,
  moveGroup,
  scaleGroup,
  ungroup,
  allTracks,
};

export function setEasingOp(doc: TimelineDoc, trackId: string, keyId: string, easing: Easing) {
  const t = findNode(doc.nodes, trackId);
  if (t && !isGroup(t)) {
    const k = (t as TrackNode).keys.find((kk) => kk.id === keyId);
    if (k) k.easing = easing;
  }
}

export function groupSelected(doc: TimelineDoc, ids: string[]) {
  groupNodes(doc, ids);
}
