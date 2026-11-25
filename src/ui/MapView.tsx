import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { Camera, LayerId } from '../types';
import { CameraTween, fitRect, type Viewport } from '../core/camera';
import type { AppStore, ViewId } from '../core/store';
import { featureKey } from '../core/store';
import type { GridIndex } from '../data/grid-index';
import { EChartHost, type EChartHandle } from '../render/EChartHost';
import { FeatureRenderer, type LabelPlacement } from '../render/FeatureRenderer';
import { LabelEngine } from '../render/LabelEngine';
import { InteractionController } from '../render/interaction';
import { pickAt, pickInRect, type PointIndices } from '../render/picking';

const IDLE_COMPLETE_MS = 150;

/**
 * 渲染耗时采样(渲染 + 刷新 + 标注三段)。
 * 只留最近 240 帧,开销可忽略;性能脚本靠它取真实工作量。
 */
let perfBuf: number[][] = [];
function recordPerf(draw: number, flush: number, label: number) {
  perfBuf.push([draw, flush, label]);
  if (perfBuf.length > 240) perfBuf = perfBuf.slice(-120);
  (window as unknown as { __evacPerf: number[][] }).__evacPerf = perfBuf;
}

/** 视图对外暴露的能力,供工具栏与联动调用 */
export interface MapApi {
  viewId: ViewId;
  flyTo: (target: Camera, duration?: number) => void;
  fitAll: () => void;
  resetRotation: () => void;
  focusWorld: (x: number, y: number, zoom: number) => void;
  placedLabels: () => readonly { x: number; y: number; w: number; h: number }[];
  stats: () => {
    drawing: number;
    visible: number;
    labels: number;
    tier: string;
    perLayer: Record<LayerId, number>;
  };
}

/**
 * 一个地图视图。两个视图各自持有相机与渲染器,共享同一个 store 里的选中状态。
 */
export function MapView(props: {
  store: AppStore;
  viewId: ViewId;
  title: string;
  subtitle: string;
  register: (api: MapApi) => void;
  /** 首次进入时是否需要自动取景(会话里恢复过状态就不再自动取景) */
  autoFit: boolean;
}) {
  const { store } = props;
  let hostEl: HTMLDivElement | undefined;
  let labelLayerEl: HTMLDivElement | undefined;

  const [ready, setReady] = createSignal(false);
  const [box, setBox] = createSignal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [stats, setStats] = createSignal({
    drawing: 0,
    visible: 0,
    labels: 0,
    tier: '—',
    perLayer: { hazard: 0, exit: 0, stair: 0, assembly: 0, path: 0, point: 0, area: 0 },
  });

  let renderer: FeatureRenderer | null = null;
  let labelEngine: LabelEngine | null = null;
  let interaction: InteractionController | null = null;
  let chartHandle: EChartHandle | null = null;
  let pathIndex: GridIndex | null = null;
  let areaIndex: GridIndex | null = null;
  let pointIndices: PointIndices = {};

  let rafId = 0;
  let idleTimer = 0;
  let interactingNow = false;

  const cam = () => store.cameras()[props.viewId];

  const tween = new CameraTween((c) => store.setCamera(props.viewId, c));

  function viewport(): Viewport {
    return { width: hostEl?.clientWidth || 1, height: hostEl?.clientHeight || 1 };
  }

  function renderNow() {
    if (!renderer || !labelEngine) return;
    const t0 = performance.now();
    const vp = viewport();
    const c = cam();
    const st = renderer.render({
      camera: c,
      viewport: vp,
      layers: store.state().layers,
      tiers: store.state().tiers,
      labelConfig: store.state().label,
      interacting: interactingNow,
    });
    const t1 = performance.now();
    chartHandle?.zr.refreshImmediately(false);
    const t2 = performance.now();

    let labelCount = 0;
    const decision = renderer.getDecision();
    if (!interactingNow && decision) {
      const candidates = renderer.collectLabelCandidates(
        {
          cos: Math.cos(c.rotation), sin: Math.sin(c.rotation), zoom: c.zoom,
          cx: vp.width / 2, cy: vp.height / 2, wx: c.x, wy: c.y,
        },
        vp,
        decision,
        decision.labelBudget,
      );
      candidates.sort((a, b) => b.priority - a.priority);
      const placements = labelEngine.place(
        candidates,
        decision.labelBudget,
        vp,
        (cand) => (cand.layer === 'point' ? 2 : 6),
      );
      labelCount = placements.length;
      drawLabels(placements);

      // 供验收脚本核对「候选 → 实际放置」的取舍(按视图分开,避免互相覆盖)
      const hook = window as unknown as { __evacDbg?: Record<string, unknown> };
      const dbg = hook.__evacDbg ?? {};
      dbg[props.viewId] = {
        candidates: candidates.map((c) => `${c.priority}:${c.layer}`),
        placed: placements.map((p) => p.kind),
        decision: {
          tier: decision.tier.name,
          layerOn: decision.layerOn,
          minPriority: decision.labelMinPriority,
          budget: decision.labelBudget,
        },
      };
      hook.__evacDbg = dbg;
    } else {
      clearLabels();
    }

    recordPerf(t1 - t0, t2 - t1, performance.now() - t2);
    setStats({
      drawing: st.drawing,
      visible: st.visible,
      labels: labelCount,
      tier: decision?.tier.name ?? '—',
      perLayer: st.perLayer,
    });
  }

  function clearLabels() {
    if (labelLayerEl) labelLayerEl.replaceChildren();
  }

  /** 标注画在 HTML 层:天然保持水平、可选中、样式可控 */
  function drawLabels(placements: LabelPlacement[]) {
    const el = labelLayerEl;
    if (!el) return;
    const frag = document.createDocumentFragment();
    for (const p of placements) {
      const d = document.createElement('div');
      d.className = `map-label map-label--${p.kind}`;
      d.style.transform = `translate(${p.x}px, ${p.y}px) translateY(-50%)`;
      d.textContent = p.text;
      frag.appendChild(d);
    }
    el.replaceChildren(frag);
  }

  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderNow();
    });
  }

  /**
   * 交互期降级渲染;静止 150ms 后自动补全精度并重排标注。
   * 这里必须由「进入交互」自己负责收尾 —— 滚轮缩放没有 pointerup 事件,
   * 若等外部通知退出交互,缩放后就会一直停在降级状态(标注全无)。
   */
  function markInteracting(active: boolean) {
    if (active) interactingNow = true;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      if (!interactingNow) return;
      interactingNow = false;
      scheduleRender();
    }, IDLE_COMPLETE_MS);
    scheduleRender();
  }

  createMemo(() => {
    // 响应式依赖:任一变化都重绘
    cam();
    store.state().layers;
    store.state().tiers;
    store.state().label;
    store.selection();
    if (ready()) scheduleRender();
  });

  createMemo(() => {
    // 持久化:相机或图层变化都存一次(内部防抖)
    cam();
    store.state();
    store.selection();
    if (ready()) store.persist();
  });

  onMount(() => {
    onCleanup(() => {
      interaction?.dispose();
      renderer?.dispose();
      tween.stop();
      if (rafId) cancelAnimationFrame(rafId);
      if (idleTimer) clearTimeout(idleTimer);
    });
  });

  function onReady(h: EChartHandle) {
    chartHandle = h;
    const ds = store.ds;
    renderer = new FeatureRenderer(h.zr, ds, () => store.selection());
    labelEngine = new LabelEngine();

    const idx = renderer.getIndices();
    pointIndices = idx.points;
    pathIndex = idx.path;
    areaIndex = idx.area;

    interaction = new InteractionController(hostEl!, {
      getCamera: () => cam(),
      setCamera: (c, o) => {
        tween.stop();
        store.setCamera(props.viewId, c);
        markInteracting(o?.interacting ?? false);
      },
      getViewport: viewport,
      isBoxMode: () => store.boxMode(),
      onClick: (sx, sy, mods) => handleClick(sx, sy, mods),
      onBoxUpdate: (r) => setBox(r),
      onBoxSelect: (r, additive) => handleBoxSelect(r, additive),
      onEscape: () => {
        store.clearSelection();
        store.setBoxMode(false);
        store.setStatusText('');
      },
    });

    h.onResize(() => {
      labelEngine?.reset();
      scheduleRender();
    });

    setReady(true);
    renderNow();

    if (props.autoFit) {
      // 容器尺寸要等一帧才稳定,否则会按 1×1 取景
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const vp = viewport();
          if (vp.width < 40 || vp.height < 40) return;
          const box =
            props.viewId === 'overview'
              ? fitRect(store.ds.content, vp, cam().rotation, 0.94)
              : floorViewBox(store, vp);
          store.setCamera(props.viewId, { ...cam(), x: box.x, y: box.y, zoom: box.zoom });
        });
      });
    }

    props.register({
      viewId: props.viewId,
      flyTo: (target, duration = 460) => tween.easeTo(cam(), target, duration),
      fitAll: () => {
        const c = fitRect(store.ds.bounds, viewport(), cam().rotation, 0.9);
        tween.easeTo(cam(), c, 420);
      },
      resetRotation: () => tween.easeTo(cam(), { ...cam(), rotation: 0 }, 320),
      /** 以世界坐标为中心定位到指定缩放(工具栏与验收脚本共用同一条路径) */
      focusWorld: (x: number, y: number, zoom: number) =>
        tween.easeTo(cam(), { x, y, zoom, rotation: cam().rotation }, 380),
      placedLabels: () => labelEngine?.getPlaced() ?? [],
      stats,
    });
  }

  function handleClick(sx: number, sy: number, mods: { shift: boolean; alt: boolean }) {
    if (!pathIndex || !areaIndex) return;
    const order = store.state().layers.map((l) => l.id);
    const hit = pickAt(store.ds, cam(), viewport(), sx, sy, pointIndices, order, areaIndex, pathIndex);
    if (!hit) {
      if (!mods.shift) store.clearSelection();
      return;
    }
    const key = featureKey(hit.layer, hit.index);
    if (mods.shift) store.toggleSelection(key);
    else store.selectOnly(hit.layer, hit.index, props.viewId);
  }

  function handleBoxSelect(
    rect: { x0: number; y0: number; x1: number; y1: number },
    additive: boolean,
  ) {
    if (!pathIndex || !areaIndex) return;
    const on = store.layerVisibleMap();
    const hits = pickInRect(store.ds, cam(), viewport(), rect, pointIndices, pathIndex, areaIndex, on);
    const keys = hits.map((h) => featureKey(h.layer, h.index));
    if (additive) {
      store.addToSelection(keys, props.viewId);
      store.setStatusText(`加选 ${keys.length} 个要素,共 ${store.selection().size} 个`);
    } else {
      store.replaceSelection(keys, props.viewId);
      store.setStatusText(hits.length ? `框选命中 ${hits.length} 个要素` : '框选未命中');
    }
  }

  // 另一视图发来的定位请求(只处理指明给本视图的)
  let lastFocusSeq = 0;
  createMemo(() => {
    const req = store.focusRequest();
    if (!req || !ready() || req.target !== props.viewId) return;
    if (req.seq === lastFocusSeq) return;
    lastFocusSeq = req.seq;
    tween.easeTo(cam(), { x: req.x, y: req.y, zoom: req.zoom, rotation: cam().rotation }, 480);
  });

  return (
    <section class="map-view">
      <header class="map-view__head">
        <div class="map-view__title">
          <h2>{props.title}</h2>
          <p>{props.subtitle}</p>
        </div>
        <div class="map-view__badges">
          <span class="badge badge--tier">{stats().tier}</span>
          <span class="badge">×{cam().zoom.toFixed(3)}</span>
          <span class="badge">{Math.round((cam().rotation * 180) / Math.PI)}°</span>
        </div>
      </header>

      <div
        class="map-view__canvas"
        ref={hostEl}
        style={{ cursor: store.boxMode() ? 'crosshair' : 'grab' }}
      >
        <EChartHost class="map-view__chart" onReady={onReady} />
        <div class="map-view__labels" ref={labelLayerEl} />
        <Show when={box()}>
          {(b) => (
            <div
              class="map-view__box"
              style={{
                left: `${Math.min(b().x0, b().x1)}px`,
                top: `${Math.min(b().y0, b().y1)}px`,
                width: `${Math.abs(b().x1 - b().x0)}px`,
                height: `${Math.abs(b().y1 - b().y0)}px`,
              }}
            />
          )}
        </Show>
        <div class="map-view__stats">
          <span>绘制 <b>{stats().drawing.toLocaleString()}</b></span>
          <span>视口内 <b>{stats().visible.toLocaleString()}</b></span>
          <span>标注 <b>{stats().labels}</b></span>
        </div>
        <div class="map-view__hint">
          拖动平移 · 滚轮缩放 · 右键 / Alt 旋转 · Shift / 框选模式拖框多选
        </div>
      </div>
    </section>
  );
}

/** 楼层视图初始取景:框住 A 栋首层那块楼层平面 */
function floorViewBox(store: AppStore, vp: Viewport) {
  const f0 = store.ds.floors[0];
  const polys = store.ds.floors.filter((f) => f.building === f0.building);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of polys) {
    for (let i = 0; i < f.polygon.length; i += 2) {
      minX = Math.min(minX, f.polygon[i]);
      maxX = Math.max(maxX, f.polygon[i]);
      minY = Math.min(minY, f.polygon[i + 1]);
      maxY = Math.max(maxY, f.polygon[i + 1]);
    }
  }
  return fitRect({ minX, minY, maxX, maxY }, vp, 0, 0.9);
}

export type { LayerId };
