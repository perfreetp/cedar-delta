import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  ChoreographyFile,
  Keyframe,
  Puppet,
  StageConfig,
  ToolMode,
  Vec2,
  Waypoint,
} from './types';
import { computeDefaultKeyframeTime } from './core/timeline';
import { Spline } from './core/spline';

const PUPPET_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x2c3e50];

export const DEFAULT_STAGE: StageConfig = {
  imageUrl: null,
  worldWidth: 2400,
  worldHeight: 1600,
};

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  speed: number;
  loop: boolean;
}

export interface EditorState {
  tool: ToolMode;
  stage: StageConfig;
  puppets: Puppet[];
  selectedPuppetId: string | null;
  selectedWaypointId: string | null;
  selectedKeyframeId: string | null;
  playback: PlaybackState;

  setTool: (tool: ToolMode) => void;
  setStage: (patch: Partial<StageConfig>) => void;

  createPuppet: (start: Vec2, name?: string) => string;
  removePuppet: (puppetId: string) => void;
  selectPuppet: (puppetId: string | null) => void;
  renamePuppet: (puppetId: string, name: string) => void;
  togglePuppetVisible: (puppetId: string) => void;

  addWaypoint: (puppetId: string, pos: Vec2) => string;
  insertWaypointAt: (puppetId: string, segmentIndex: number, pos: Vec2) => string;
  moveWaypoint: (puppetId: string, waypointId: string, pos: Vec2) => void;
  removeWaypoint: (puppetId: string, waypointId: string) => void;
  selectWaypoint: (puppetId: string | null, waypointId: string | null) => void;

  addKeyframe: (puppetId: string, waypointId: string) => string;
  updateKeyframe: (puppetId: string, keyframeId: string, patch: Partial<Omit<Keyframe, 'id' | 'waypointId'>>) => void;
  removeKeyframe: (puppetId: string, keyframeId: string) => void;
  selectKeyframe: (keyframeId: string | null) => void;

  setPlayback: (patch: Partial<PlaybackState>) => void;
  tickPlayback: (deltaSec: number, durationSec: number) => void;

  loadFile: (file: ChoreographyFile) => void;
  reset: () => void;
  addStressPuppet: (waypointCount: number) => void;
}

const newId = (): string => nanoid(8);

const buildPuppet = (start: Vec2, color: number, index: number): Puppet => {
  const wp: Waypoint = { id: newId(), pos: { ...start } };
  const kf: Keyframe = {
    id: newId(),
    waypointId: wp.id,
    timeSec: 0,
    dwellSec: 0.5,
    headingDeg: null,
    headingOverride: false,
  };
  return {
    id: newId(),
    name: `偶 ${index + 1}`,
    color,
    waypoints: [wp],
    keyframes: [kf],
    visible: true,
  };
};

export const useEditorStore = create<EditorState>((set, get) => ({
  tool: 'stage',
  stage: { ...DEFAULT_STAGE },
  puppets: [],
  selectedPuppetId: null,
  selectedWaypointId: null,
  selectedKeyframeId: null,
  playback: { isPlaying: false, currentTime: 0, speed: 1, loop: false },

  setTool: (tool) => set({ tool }),
  setStage: (patch) => set((s) => ({ stage: { ...s.stage, ...patch } })),

  createPuppet: (start, name) => {
    const idx = get().puppets.length;
    const puppet = buildPuppet(start, PUPPET_COLORS[idx % PUPPET_COLORS.length], idx);
    if (name) puppet.name = name;
    set((s) => ({
      puppets: [...s.puppets, puppet],
      selectedPuppetId: puppet.id,
      selectedWaypointId: puppet.waypoints[0].id,
      selectedKeyframeId: puppet.keyframes[0].id,
    }));
    return puppet.id;
  },

  removePuppet: (puppetId) =>
    set((s) => {
      const puppets = s.puppets.filter((p) => p.id !== puppetId);
      return {
        puppets,
        selectedPuppetId: s.selectedPuppetId === puppetId ? (puppets[0]?.id ?? null) : s.selectedPuppetId,
        selectedWaypointId: null,
        selectedKeyframeId: null,
      };
    }),

  selectPuppet: (puppetId) =>
    set((s) => ({
      selectedPuppetId: puppetId,
      selectedWaypointId: null,
      selectedKeyframeId: null,
      ...(puppetId && s.tool === 'stage'
        ? { selectedWaypointId: s.puppets.find((p) => p.id === puppetId)?.waypoints[0]?.id ?? null }
        : {}),
    })),

  renamePuppet: (puppetId, name) =>
    set((s) => ({
      puppets: s.puppets.map((p) => (p.id === puppetId ? { ...p, name } : p)),
    })),

  togglePuppetVisible: (puppetId) =>
    set((s) => ({
      puppets: s.puppets.map((p) => (p.id === puppetId ? { ...p, visible: !p.visible } : p)),
    })),

  addWaypoint: (puppetId, pos) => {
    const wp: Waypoint = { id: newId(), pos: { ...pos } };
    set((s) => ({
      puppets: s.puppets.map((p) => (p.id === puppetId ? { ...p, waypoints: [...p.waypoints, wp] } : p)),
      selectedPuppetId: puppetId,
      selectedWaypointId: wp.id,
      selectedKeyframeId: null,
    }));
    return wp.id;
  },

  insertWaypointAt: (puppetId, segmentIndex, pos) => {
    const state = get();
    const puppet = state.puppets.find((p) => p.id === puppetId);
    if (!puppet) return '';
    const at = Math.min(Math.max(segmentIndex + 1, 1), puppet.waypoints.length);
    const wp: Waypoint = { id: newId(), pos: { ...pos } };

    // 用插入后的样条弧长为新经过点推算默认时刻
    const nextWaypoints = [...puppet.waypoints.slice(0, at), wp, ...puppet.waypoints.slice(at)];
    const spline = new Spline(nextWaypoints.map((w) => w.pos));
    const kfTime = computeDefaultKeyframeTime(spline, puppet.keyframes, at);
    const kf: Keyframe = {
      id: newId(),
      waypointId: wp.id,
      timeSec: kfTime,
      dwellSec: 0,
      headingDeg: null,
      headingOverride: false,
    };

    set((s) => ({
      puppets: s.puppets.map((p) =>
        p.id === puppetId
          ? {
              ...p,
              waypoints: nextWaypoints,
              keyframes: [...p.keyframes, kf].sort((a, b) => a.timeSec - b.timeSec),
            }
          : p,
      ),
      selectedPuppetId: puppetId,
      selectedWaypointId: wp.id,
      selectedKeyframeId: kf.id,
    }));
    return wp.id;
  },

  moveWaypoint: (puppetId, waypointId, pos) =>
    set((s) => ({
      puppets: s.puppets.map((p) =>
        p.id === puppetId
          ? {
              ...p,
              waypoints: p.waypoints.map((w) => (w.id === waypointId ? { ...w, pos: { ...pos } } : w)),
            }
          : p,
      ),
    })),

  removeWaypoint: (puppetId, waypointId) =>
    set((s) => {
      const puppet = s.puppets.find((p) => p.id === puppetId);
      if (!puppet || puppet.waypoints.length <= 1) return s;
      const waypoints = puppet.waypoints.filter((w) => w.id !== waypointId);
      // 关键帧跟随经过点删除；剩余关键帧的时刻不强制重排，由样条重算保证空间连续
      const keyframes = puppet.keyframes.filter((k) => k.waypointId !== waypointId);
      return {
        puppets: s.puppets.map((p) => (p.id === puppetId ? { ...p, waypoints, keyframes } : p)),
        selectedWaypointId: s.selectedWaypointId === waypointId ? null : s.selectedWaypointId,
        selectedKeyframeId:
          puppet.keyframes.find((k) => k.waypointId === waypointId)?.id === s.selectedKeyframeId
            ? null
            : s.selectedKeyframeId,
      };
    }),

  selectWaypoint: (puppetId, waypointId) =>
    set({
      selectedPuppetId: puppetId,
      selectedWaypointId: waypointId,
      selectedKeyframeId: null,
    }),

  addKeyframe: (puppetId, waypointId) => {
    const state = get();
    const puppet = state.puppets.find((p) => p.id === puppetId);
    if (!puppet) return '';
    const wpIndex = puppet.waypoints.findIndex((w) => w.id === waypointId);
    if (wpIndex < 0) return '';
    const existing = puppet.keyframes.find((k) => k.waypointId === waypointId);
    if (existing) {
      set({ selectedKeyframeId: existing.id, selectedPuppetId: puppetId });
      return existing.id;
    }
    const spline = new Spline(puppet.waypoints.map((w) => w.pos));
    const kf: Keyframe = {
      id: newId(),
      waypointId,
      timeSec: computeDefaultKeyframeTime(spline, puppet.keyframes, wpIndex),
      dwellSec: 0.5,
      headingDeg: null,
      headingOverride: false,
    };
    set((s) => ({
      puppets: s.puppets.map((p) =>
        p.id === puppetId
          ? { ...p, keyframes: [...p.keyframes, kf].sort((a, b) => a.timeSec - b.timeSec) }
          : p,
      ),
      selectedPuppetId: puppetId,
      selectedKeyframeId: kf.id,
      selectedWaypointId: null,
    }));
    return kf.id;
  },

  updateKeyframe: (puppetId, keyframeId, patch) =>
    set((s) => ({
      puppets: s.puppets.map((p) => {
        if (p.id !== puppetId) return p;
        const keyframes = p.keyframes
          .map((k) => (k.id === keyframeId ? { ...k, ...patch } : k))
          .sort((a, b) => a.timeSec - b.timeSec);
        return { ...p, keyframes };
      }),
    })),

  removeKeyframe: (puppetId, keyframeId) =>
    set((s) => ({
      puppets: s.puppets.map((p) => {
        if (p.id !== puppetId) return p;
        // 至少保留首帧（起点时刻），保证播放有时间锚
        const target = p.keyframes.find((k) => k.id === keyframeId);
        if (!target || target.waypointId === p.waypoints[0].id) return p;
        return { ...p, keyframes: p.keyframes.filter((k) => k.id !== keyframeId) };
      }),
      selectedKeyframeId: s.selectedKeyframeId === keyframeId ? null : s.selectedKeyframeId,
    })),

  selectKeyframe: (keyframeId) => set({ selectedKeyframeId: keyframeId, selectedWaypointId: null }),

  setPlayback: (patch) => set((s) => ({ playback: { ...s.playback, ...patch } })),

  tickPlayback: (deltaSec, durationSec) =>
    set((s) => {
      if (!s.playback.isPlaying) return s;
      const next = s.playback.currentTime + deltaSec * s.playback.speed;
      if (next >= durationSec) {
        if (s.playback.loop) {
          return { playback: { ...s.playback, currentTime: next % Math.max(1e-6, durationSec) } };
        }
        return {
          playback: { ...s.playback, currentTime: durationSec, isPlaying: false },
        };
      }
      return { playback: { ...s.playback, currentTime: next } };
    }),

  loadFile: (file) =>
    set({
      stage: { ...file.stage },
      puppets: file.puppets.map((p) => ({
        ...p,
        waypoints: p.waypoints.map((w) => ({ ...w, pos: { ...w.pos } })),
        keyframes: p.keyframes.map((k) => ({ ...k })),
      })),
      selectedPuppetId: file.puppets[0]?.id ?? null,
      selectedWaypointId: null,
      selectedKeyframeId: null,
      playback: { isPlaying: false, currentTime: 0, speed: 1, loop: false },
    }),

  reset: () =>
    set({
      stage: { ...DEFAULT_STAGE },
      puppets: [],
      selectedPuppetId: null,
      selectedWaypointId: null,
      selectedKeyframeId: null,
      playback: { isPlaying: false, currentTime: 0, speed: 1, loop: false },
    }),

  /** 压测：生成含大量经过点的长轨迹偶，用于验证数千点下缩放/平移/拖动流畅性 */
  addStressPuppet: (waypointCount) => {
    const idx = get().puppets.length;
    const puppet = buildPuppet({ x: 120, y: 800 }, PUPPET_COLORS[idx % PUPPET_COLORS.length], idx);
    puppet.name = `压测偶 ${waypointCount} 点`;
    for (let i = 1; i < waypointCount; i++) {
      const x = 120 + i * 22;
      const y = 800 + Math.sin(i * 0.08) * 320 + Math.cos(i * 0.03) * 90;
      const wp: Waypoint = { id: newId(), pos: { x, y } };
      puppet.waypoints.push(wp);
      // 每 200 点布一个关键帧，保证时间轴有足够调度点
      if (i % 200 === 0) {
        puppet.keyframes.push({
          id: newId(),
          waypointId: wp.id,
          timeSec: i / 50,
          dwellSec: i % 400 === 0 ? 0.5 : 0,
          headingDeg: null,
          headingOverride: false,
        });
      }
    }
    set((s) => ({
      puppets: [...s.puppets, puppet],
      selectedPuppetId: puppet.id,
      selectedWaypointId: null,
      selectedKeyframeId: null,
    }));
  },
}));

/** 选择器：偶的经过点 id -> 索引映射（供时间轴解析） */
export const waypointIndexResolver = (puppet: Puppet) => {
  const map = new Map<string, number>();
  puppet.waypoints.forEach((w, i) => map.set(w.id, i));
  return (id: string): number => map.get(id) ?? 0;
};

export const buildSpline = (puppet: Puppet): Spline => new Spline(puppet.waypoints.map((w) => w.pos));
