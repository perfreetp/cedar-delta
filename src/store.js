import { createSignal, createMemo, createEffect, createRoot } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { hashSeed, mulberry32 } from './prng.js';

const STORAGE_KEY = 'cpr-beat-sheet-v1';
const DEFAULT_SEED = 'CPR-2026';
const DEFAULT_PARAMS = { rateTier: 3, depthTier: 3, handOffset: 0, groupSize: 5 };

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round2 = (v) => Math.round(v * 100) / 100;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw 0;
    const s = JSON.parse(raw);
    return {
      seed: typeof s.seed === 'string' && s.seed ? s.seed : DEFAULT_SEED,
      params: { ...DEFAULT_PARAMS, ...(s.params || {}) },
      edits: s.edits && typeof s.edits === 'object' ? s.edits : {},
    };
  } catch {
    return { seed: DEFAULT_SEED, params: { ...DEFAULT_PARAMS }, edits: {} };
  }
}

function createAppStore() {
  const initial = loadState();

  // ---- 原始状态:种子 / 四个参数 / 手改记录 / 选中项 / 画布宽 ----
  const [seed, setSeed] = createSignal(initial.seed);
  const [params, setParams] = createStore(initial.params);
  const [edits, setEdits] = createStore(initial.edits);
  const [selectedId, setSelectedId] = createSignal(null);
  const [viewWidth, setViewWidth] = createSignal(960);

  // ---- 参数派生(上游变了顺着往下算) ----
  // 频率档位 → 一版总按压次数(≈100~120 次/分 对应 1~5 档)
  const totalBars = createMemo(() => 12 + params.rateTier * 12);
  // 深度档位 → 深度量程上限(cm),同时是拖拽天花板
  const maxDepthCm = createMemo(() => 3 + params.depthTier);
  // 手位偏移 → 挤动相邻分组间距:偏移越大,组间空隙被挤得越小
  const groupGap = createMemo(() => clamp(26 - params.handOffset * 7, 6, 48));

  // ---- 版面推导:种子 + 参数 + 手改记录 → 每根竖条的位置/深度/分组 ----
  const layout = createMemo(() => {
    const W = Math.max(320, viewWidth());
    const H = 440;
    const marginL = 56;
    const marginR = 24;
    const top = 28;
    const bottom = 56;
    const maxD = maxDepthCm();
    const pxPerCm = (H - top - bottom) / maxD;
    const baseline = H - bottom;

    const n = totalBars();
    const gs = params.groupSize;
    const numGroups = Math.ceil(n / gs);
    const gap = groupGap();
    const availW = W - marginL - marginR;
    const totalGap = (numGroups - 1) * gap;
    const barW = clamp(((availW - totalGap) / n) * 0.62, 4, 16);
    const pitch = n > 1 ? (availW - totalGap - barW) / (n - 1) : 0;

    // 同一种子 → 同一随机序列 → 位置/深度完全一致;换种子整版重排
    const rng = mulberry32(hashSeed(seed()));
    const bars = [];
    for (let i = 0; i < n; i++) {
      const id = 'b' + i;
      const jitter = (rng() - 0.5) * pitch * 0.3;
      const autoDepth = round2(maxD * (0.45 + rng() * 0.5));
      const autoX = marginL + barW / 2 + i * pitch + Math.floor(i / gs) * gap + jitter;
      const e = edits[id];
      bars.push({
        id,
        index: i,
        // 手改过的条:留在原位不动;没改的:按新参数重排
        x: e ? e.x : autoX,
        depthCm: e ? Math.min(e.depthCm, maxD) : autoDepth,
        manual: !!e,
        group: 0,
        beatInGroup: 0,
      });
    }

    // 分组编号按当前 x 排序后重新切组 —— 手改条留在原位,编号跟着重算
    const sorted = [...bars].sort((a, b) => a.x - b.x);
    sorted.forEach((b, k) => {
      b.group = Math.floor(k / gs) + 1;
      b.beatInGroup = (k % gs) + 1;
    });
    const groups = [];
    for (let g = 0; g * gs < sorted.length; g++) {
      const members = sorted.slice(g * gs, (g + 1) * gs);
      groups.push({
        num: g + 1,
        x: (members[0].x + members[members.length - 1].x) / 2,
      });
    }

    return { bars, groups, W, H, marginL, marginR, baseline, pxPerCm, maxDepthCm: maxD, barW, gap };
  });

  // ---- 动作 ----
  function setParam(key, value) {
    setParams(key, value);
  }
  function commitEdit(id, x, depthCm) {
    setEdits(id, { x: Math.round(x * 10) / 10, depthCm: round2(depthCm) });
  }
  function resetEdit(id) {
    setEdits(produce((s) => { delete s[id]; }));
  }
  function clearEdits() {
    setEdits(produce((s) => { for (const k of Object.keys(s)) delete s[k]; }));
  }
  function randomizeSeed() {
    setSeed('CPR-' + Math.random().toString(36).slice(2, 8).toUpperCase());
  }
  function resetAll() {
    setSeed(DEFAULT_SEED);
    setParams({ ...DEFAULT_PARAMS });
    clearEdits();
    setSelectedId(null);
  }

  // 深度档位下调时,手改深度同步夹紧到新上限(依赖顺着算下去)
  createEffect(() => {
    const maxD = maxDepthCm();
    for (const [id, e] of Object.entries(edits)) {
      if (e.depthCm > maxD) setEdits(id, 'depthCm', maxD);
    }
  });

  // 自动保存:种子 + 参数 + 手改记录,下次打开回到同一版
  createEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          seed: seed(),
          params: {
            rateTier: params.rateTier,
            depthTier: params.depthTier,
            handOffset: params.handOffset,
            groupSize: params.groupSize,
          },
          edits: JSON.parse(JSON.stringify(edits)),
        })
      );
    } catch { /* 存储不可用时静默跳过 */ }
  });

  return {
    seed, setSeed,
    params, setParam,
    edits,
    selectedId, setSelectedId,
    viewWidth, setViewWidth,
    totalBars, maxDepthCm, groupGap,
    layout,
    commitEdit, resetEdit, clearEdits,
    randomizeSeed, resetAll,
  };
}

const appStore = createRoot(createAppStore);

export const {
  seed, setSeed,
  params, setParam,
  edits,
  selectedId, setSelectedId,
  viewWidth, setViewWidth,
  totalBars, maxDepthCm, groupGap,
  layout,
  commitEdit, resetEdit, clearEdits,
  randomizeSeed, resetAll,
} = appStore;
