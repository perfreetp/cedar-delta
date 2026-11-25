import * as echarts from 'echarts';
import type { Camera, Dataset, LabelConfig, LayerId, LayerState, LodTier } from '../types';
import { camMatrix, viewBounds, worldToScreen, type CamMatrix, type Viewport } from '../core/camera';
import { defaultTiers, LABEL_PRIORITY, resolveDecision, type RenderDecision } from '../core/lod';
import { buildPathIndex, buildPointIndex, GridIndex } from '../data/grid-index';
import {
  BatchChevron,
  BatchCircle,
  BatchHalo,
  BatchPolygon,
  BatchPolyline,
  BatchSquare,
  BatchTriangle,
  BatchZigzag,
} from './batch-shapes';

/**
 * zrender 的图形类在 echarts 的公开类型里没有导出构造签名,
 * 这里收敛成最小可用形状,避免整文件被 unknown 污染。
 */
interface ZrAddable { add: (el: unknown) => void }
interface ZrRoot extends ZrAddable { removeAll: () => void }
interface ZrShapeEl {
  shape: { count: number; total?: number; data?: Float32Array; offsets?: Int32Array };
  style: Record<string, unknown>;
  ignore: boolean;
  dirtyShape: () => void;
}
type Newable<T> = new (opts: Record<string, unknown>) => T;

const graphic = echarts.graphic as unknown as {
  Group: Newable<ZrRoot>;
  Text: Newable<ZrShapeEl>;
};

/** 每个点族图层一份索引 */
interface PointLayerRuntime {
  layer: Exclude<LayerId, 'path' | 'area'>;
  index: GridIndex;
}

export interface RenderStats {
  drawing: number;
  visible: number;
  labels: number;
  decisions: RenderDecision;
  ms: number;
  /** 按图层统计的实际绘制数量(真实值,用于统计图与调优) */
  perLayer: Record<LayerId, number>;
}

export interface LabelPlacement {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
  kind: LayerId;
  index: number;
  /** 引线终点(锚点屏幕坐标) */
  ax: number;
  ay: number;
}

const COLORS: Record<LayerId, { fill: string; stroke: string; lineWidth: number }> = {
  hazard: { fill: 'rgba(248,113,113,0.92)', stroke: '#fecaca', lineWidth: 1 },
  exit: { fill: 'rgba(74,222,128,0.95)', stroke: '#bbf7d0', lineWidth: 1 },
  stair: { fill: 'rgba(167,139,250,0.9)', stroke: '#ddd6fe', lineWidth: 1 },
  assembly: { fill: 'rgba(56,189,248,0.12)', stroke: '#38bdf8', lineWidth: 2 },
  path: { fill: 'none', stroke: 'rgba(148,163,184,0.5)', lineWidth: 1 },
  point: { fill: 'rgba(103,232,249,0.62)', stroke: 'none', lineWidth: 1 },
  area: { fill: 'rgba(30,41,59,0.55)', stroke: 'rgba(56,189,248,0.55)', lineWidth: 1.2 },
};

/**
 * 每图层符号缓冲上限。峰值是 2 万个普通点位同屏可见(宿舍楼放大到楼层级时的极端情况),
 * 留 5 万足够,且单层内存仅 50000*4*4B = 800KB。
 */
const MAX_SYMBOLS = 50000;

export class FeatureRenderer {
  private zr: ReturnType<echarts.ECharts['getZr']>;
  private root: ZrRoot;

  private ds: Dataset;
  private pointIdx: PointLayerRuntime[] = [];
  private pathIndex: GridIndex;
  private areaIndex: GridIndex;
  private areaBboxCache: Float32Array;

  /** 每个图层的批量图元 */
  private symbols: Record<string, { el: ZrShapeEl; buf: Float32Array; count: number; cap: number }> = {};
  private polylineEl: ZrShapeEl;
  private fillPolygonEl: ZrShapeEl;
  private haloEl: ZrShapeEl;

  private polyBuf: Float32Array;
  private polyOffsets: Int32Array;
  private fillBuf: Float32Array;
  private fillOffsets: Int32Array;
  private haloBuf = new Float32Array(MAX_SYMBOLS * 4);
  private haloCount = 0;

  private labels: ZrShapeEl[] = [];
  private labelPoolSize = 0;


  stats: RenderStats;

  constructor(
    zr: ReturnType<echarts.ECharts['getZr']>,
    ds: Dataset,
    private readonly getSelection: () => Set<string>,
  ) {
    this.zr = zr;
    this.ds = ds;

    this.root = new graphic.Group({});
    (this.zr as unknown as ZrAddable).add(this.root);
    const root = this.root;

    // 点族索引
    for (const layer of ['hazard', 'exit', 'stair', 'assembly', 'point'] as const) {
      const l = ds[layer];
      this.pointIdx.push({ layer, index: buildPointIndex(l.x, l.y, ds.bounds) });
    }

    const pb = buildPathIndex(ds.path.coords, ds.path.offsets, ds.path.count, ds.bounds);
    this.pathIndex = pb.index;

    this.areaBboxCache = ds.area.bbox.slice();
    this.areaIndex = GridIndex.build(ds.bounds, this.areaBboxCache, ds.area.count);

    // 批量图元
    const mkSymbols = (ShapeCls: Newable<ZrShapeEl>, layer: LayerId, extraStyle: Record<string, unknown> = {}) => {
      const buf = new Float32Array(MAX_SYMBOLS * 4);
      const el = new ShapeCls({
        shape: { data: buf, count: 0 },
        style: { ...COLORS[layer], ...extraStyle },
        silent: true,
      });
      root.add(el);
      this.symbols[layer] = { el, buf, count: 0, cap: MAX_SYMBOLS };
    };

    const C = (cls: unknown) => cls as Newable<ZrShapeEl>;
    mkSymbols(C(BatchTriangle), 'hazard');
    mkSymbols(C(BatchChevron), 'exit');
    mkSymbols(C(BatchZigzag), 'stair');
    mkSymbols(C(BatchCircle), 'assembly', { fill: 'rgba(56,189,248,0.10)' });
    mkSymbols(C(BatchSquare), 'point');

    // 汇总量(楼栋中心大圆)
    const sumBuf = new Float32Array(256 * 4);
    const sumEl = new (BatchCircle as unknown as Newable<ZrShapeEl>)({
      shape: { data: sumBuf, count: 0 },
      style: { fill: 'rgba(103,232,249,0.55)', stroke: '#67e8f9', lineWidth: 1 },
      silent: true,
    });
    root.add(sumEl);
    this.symbols['summary'] = { el: sumEl, buf: sumBuf, count: 0, cap: 256 };

    // 路径
    this.polyBuf = new Float32Array(400000);
    this.polyOffsets = new Int32Array(4000);
    this.polylineEl = new (BatchPolyline as unknown as Newable<ZrShapeEl>)({
      shape: { data: this.polyBuf, offsets: this.polyOffsets, count: 0 },
      style: { stroke: COLORS.path.stroke, lineWidth: COLORS.path.lineWidth, fill: 'none' },
      silent: true,
    });
    root.add(this.polylineEl);

    // 区域
    this.fillBuf = new Float32Array(20000);
    this.fillOffsets = new Int32Array(512);
    this.fillPolygonEl = new (BatchPolygon as unknown as Newable<ZrShapeEl>)({
      shape: { data: this.fillBuf, offsets: this.fillOffsets, count: 0 },
      style: { fill: COLORS.area.fill, stroke: COLORS.area.stroke, lineWidth: COLORS.area.lineWidth },
      silent: true,
    });
    root.add(this.fillPolygonEl);

    // 选中高亮
    this.haloEl = new (BatchHalo as unknown as Newable<ZrShapeEl>)({
      shape: { data: this.haloBuf, count: 0 },
      style: { stroke: '#fde047', lineWidth: 2, fill: null },
      silent: true,
    });
    root.add(this.haloEl);

    // 准备标注池
    this.ensureLabelPool(600);

    this.stats = {
      drawing: 0,
      visible: 0,
      labels: 0,
      decisions: resolveDecision(
        1,
        defaultTiers(),
        { hazard: true, exit: true, stair: true, assembly: true, path: true, point: true, area: true },
        1,
      ),
      ms: 0,
      perLayer: { hazard: 0, exit: 0, stair: 0, assembly: 0, path: 0, point: 0, area: 0 },
    };
  }

  private ensureLabelPool(n: number) {
    if (this.labelPoolSize >= n) return;
    const Text = graphic.Text;
    const root = this.root;
    for (let i = this.labelPoolSize; i < n; i++) {
      const t = new Text({
        x: 0,
        y: 0,
        style: {
          text: '',
          fill: '#e2e8f0',
          font: '11px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
          align: 'left',
          verticalAlign: 'middle',
          backgroundColor: 'rgba(2,6,23,0.72)',
          padding: [2, 5],
          borderRadius: 3,
        },
        ignore: true,
        silent: true,
      });
      root.add(t);
      this.labels.push(t);
    }
    this.labelPoolSize = n;
  }


  dispose() {
    this.root.removeAll();
  }

  /**
   * 主渲染。interacting 时降级:点位采样、无标注。
   */
  render(opts: {
    camera: Camera;
    viewport: Viewport;
    layers: LayerState[];
    tiers: LodTier[];
    labelConfig: LabelConfig;
    interacting: boolean;
    placementSink?: (labels: LabelPlacement[]) => void;
  }): RenderStats {
    const t0 = performance.now();
    const { camera, viewport, layers, tiers, interacting } = opts;

    const m = camMatrix(camera, viewport);
    const vb = viewBounds(m, viewport, 80);

    const visibleMap: Record<LayerId, boolean> = {
      hazard: true, exit: true, stair: true, assembly: true, path: true, point: true, area: true,
    };
    const opacity: Record<LayerId, number> = { ...visibleMap } as unknown as Record<LayerId, number>;
    for (const l of layers) {
      visibleMap[l.id] = l.visible;
      opacity[l.id] = l.opacity;
    }

    const budgetScale = interacting ? 0.45 : 1;
    const decision = resolveDecision(camera.zoom, tiers, visibleMap, budgetScale);

    const drawOrder: LayerId[] = layers.map((l) => l.id);
    if (!drawOrder.includes('hazard')) drawOrder.push('hazard');

    let drawing = 0;
    let visible = 0;
    const perLayer: Record<LayerId, number> = { hazard: 0, exit: 0, stair: 0, assembly: 0, path: 0, point: 0, area: 0 };

    // 汇总点模式:全局档位只画楼栋中心
    if (decision.pointMode === 'summary') {
      const s = this.symbols['summary'];
      const sum = this.ds.summary;
      let n = 0;
      for (let i = 0; i < sum.count; i++) {
        const [sx, sy] = worldToScreen(m, sum.x[i], sum.y[i]);
        if (sx < -60 || sx > viewport.width + 60 || sy < -60 || sy > viewport.height + 60) continue;
        s.buf[n * 4] = sx;
        s.buf[n * 4 + 1] = sy;
        // 汇总点:小圆点 + 按人数微调,不喧宾夺主
        s.buf[n * 4 + 2] = Math.min(13, 4.5 + Math.sqrt(sum.weight[i]) * 0.12);
        n++;
      }
      s.count = n;
      this.dirty(s.el, n);
      drawing += n;
    }

    // 点族
    const individual = decision.pointMode === 'individual';
    for (const layer of ['hazard', 'exit', 'stair', 'assembly', 'point'] as const) {
      const s = this.symbols[layer];
      const on = decision.layerOn[layer] && visibleMap[layer];
      if (!on) {
        s.count = 0;
        this.dirty(s.el, 0);
        continue;
      }
      // 汇总点档位(全局):所有点族都收进汇总点,只留区域轮廓与汇总点
      if (!individual) {
        s.count = 0;
        this.dirty(s.el, 0);
        continue;
      }
      const idx = this.pointIdx.find((p) => p.layer === layer)!;
      const cand = idx.index.queryRect(vb.minX, vb.minY, vb.maxX, vb.maxY, []);
      const data = this.ds[layer];
      let n = 0;
      /**
       * 交互期采样:普通点位可以稀疏(视觉上仍是一整片),但出口/楼梯/危险源/集合点这一类
       * 数量少而语义关键,必须全量画,否则拖动时关键要素会突然消失。
       */
      const sparse = interacting && layer === 'point' && cand.length > 1400;
      const stride = sparse ? Math.max(1, Math.floor(cand.length / 1400)) : 1;
      for (let k = 0; k < cand.length && n < s.cap; k += stride) {
        const i = cand[k];
        const wx = data.x[i], wy = data.y[i];
        const dx = (wx - m.wx) * m.zoom;
        const dy = (wy - m.wy) * m.zoom;
        const sx = m.cx + dx * m.cos - dy * m.sin;
        const sy = m.cy + dx * m.sin + dy * m.cos;
        if (sx < -40 || sx > viewport.width + 40 || sy < -40 || sy > viewport.height + 40) continue;
        // 世界尺寸 → 屏幕尺寸,并夹到可读范围
        let r = (data.size[i] * m.zoom) / 2 + (layer === 'point' ? 0.9 : 3);
        r = Math.max(layer === 'point' ? 1.1 : 3.5, Math.min(layer === 'point' ? 6 : 16, r));
        if (interacting && layer === 'point') r = Math.max(1, r * 0.8);
        const o = n * 4;
        s.buf[o] = sx;
        s.buf[o + 1] = sy;
        s.buf[o + 2] = r;
        s.buf[o + 3] = i;
        n++;
      }
      s.count = n;
      this.dirty(s.el, n);
      drawing += n;
      visible += cand.length;
      perLayer[layer] = n;
      s.el.style.opacity = opacity[layer] ?? 1;
    }

    // 路径
    if (decision.layerOn.path && visibleMap.path && decision.pathMode !== 'off') {
      const onlyTrunk = decision.pathMode === 'trunk';
      const cand = this.pathIndex.queryRect(vb.minX, vb.minY, vb.maxX, vb.maxY, []);
      const coords = this.ds.path.coords;
      let out = 0;
      let n = 0;
      const stride = interacting && cand.length > 900 ? Math.max(1, Math.floor(cand.length / 900)) : 1;
      for (let k = 0; k < cand.length; k += stride) {
        const i = cand[k];
        if (onlyTrunk && this.ds.path.weight[i] < 1.2) continue;
        const s = this.ds.path.offsets[i];
        const e = i + 1 < this.ds.path.count ? this.ds.path.offsets[i + 1] : coords.length / 2;
        if (out + (e - s) * 2 + 2 >= this.polyBuf.length || n >= this.polyOffsets.length - 1) break;
        this.polyOffsets[n++] = out / 2;
        for (let p = s; p < e; p++) {
          const wx = coords[p * 2], wy = coords[p * 2 + 1];
          const dx = (wx - m.wx) * m.zoom;
          const dy = (wy - m.wy) * m.zoom;
          this.polyBuf[out++] = m.cx + dx * m.cos - dy * m.sin;
          this.polyBuf[out++] = m.cy + dx * m.sin + dy * m.cos;
        }
      }
      const el = this.polylineEl;
      el.shape.count = n;
      el.shape.total = out / 2;
      el.dirtyShape();
      el.style.opacity = opacity.path ?? 1;
      // 交互期线宽下限,保证可见
      el.style.lineWidth = interacting ? 1.15 : 1;
      drawing += n;
      visible += cand.length;
      perLayer.path = n;
    } else {
      this.polylineEl.shape.count = 0;
      this.polylineEl.dirtyShape();
    }

    // 区域面
    if (decision.layerOn.area && visibleMap.area && decision.areaMode !== 'off') {
      const fill = decision.areaMode === 'fill';
      const cand = this.areaIndex.queryRect(vb.minX, vb.minY, vb.maxX, vb.maxY, []);
      const coords = this.ds.area.coords;
      let out = 0;
      let n = 0;
      for (let k = 0; k < cand.length; k++) {
        const i = cand[k];
        const rank = this.ds.area.rank[i];
        // 全局档位:面层只画楼栋轮廓(rank<=1),楼层轮廓留给放大后
        if (!fill && rank === 2 && camera.zoom > 0.06) break;
        if (!fill && rank === 2) continue;
        const s = this.ds.area.offsets[i];
        const e = i + 1 < this.ds.area.count ? this.ds.area.offsets[i + 1] : coords.length / 2;
        if (out + (e - s) * 2 + 2 >= this.fillBuf.length || n >= this.fillOffsets.length - 1) break;
        this.fillOffsets[n++] = out / 2;
        for (let p = s; p < e; p++) {
          const wx = coords[p * 2], wy = coords[p * 2 + 1];
          const dx = (wx - m.wx) * m.zoom;
          const dy = (wy - m.wy) * m.zoom;
          this.fillBuf[out++] = m.cx + dx * m.cos - dy * m.sin;
          this.fillBuf[out++] = m.cy + dx * m.sin + dy * m.cos;
        }
      }
      const el = this.fillPolygonEl;
      el.shape.count = n;
      el.shape.total = out / 2;
      el.dirtyShape();
      el.style.opacity = opacity.area ?? 1;
      el.style.fill = fill ? COLORS.area.fill : null;
      el.style.lineWidth = fill ? COLORS.area.lineWidth : 1.6;
      el.style.stroke = fill ? COLORS.area.stroke : 'rgba(56,189,248,0.8)';
      drawing += n;
      visible += n;
      perLayer.area = n;
    } else {
      this.fillPolygonEl.shape.count = 0;
      this.fillPolygonEl.dirtyShape();
    }

    // 选中高亮
    this.renderHalos(m, viewport, decision);

    this.stats = {
      drawing,
      visible,
      labels: 0,
      decisions: decision,
      ms: 0,
      perLayer,
    };
    this.lastRenderArgs = { camera, viewport, decision, interacting };

    this.stats.ms = performance.now() - t0;
    return this.stats;
  }

  private lastRenderArgs: {
    camera: Camera;
    viewport: Viewport;
    decision: RenderDecision;
    interacting: boolean;
  } | null = null;

  getDecision(): RenderDecision | null {
    return this.lastRenderArgs?.decision ?? null;
  }

  private renderHalos(m: CamMatrix, viewport: Viewport, decision: RenderDecision) {
    const sel = this.getSelection();
    if (sel.size === 0) {
      this.haloEl.shape.count = 0;
      this.haloEl.dirtyShape();
      return;
    }
    let n = 0;
    const vb = viewBounds(m, viewport, 80);
    for (const key of sel) {
      const [layer, idxStr] = key.split(':');
      const i = Number(idxStr);
      const lid = layer as LayerId;
      // 普通点位不画光环:大面积框选时上千个圈会糊成一片,选中感由详情面板与计数承担
      if (lid === 'path' || lid === 'area' || lid === 'point') continue;
      if (!decision.layerOn[lid]) continue;
      const data = this.ds[lid as Exclude<LayerId, 'path' | 'area'>];
      if (!data || i >= data.count) continue;
      const wx = data.x[i], wy = data.y[i];
      if (wx < vb.minX || wx > vb.maxX || wy < vb.minY || wy > vb.maxY) continue;
      const [sx, sy] = worldToScreen(m, wx, wy);
      if (sx < -40 || sx > viewport.width + 40 || sy < -40 || sy > viewport.height + 40) continue;
      let r = (data.size[i] * m.zoom) / 2 + 3;
      r = Math.max(6, Math.min(20, r + 5));
      this.haloBuf[n * 4] = sx;
      this.haloBuf[n * 4 + 1] = sy;
      this.haloBuf[n * 4 + 2] = r;
      this.haloBuf[n * 4 + 3] = i;
      n++;
      if (n >= 1200) break;
    }
    this.haloEl.shape.count = n;
    this.haloEl.dirtyShape();
    this.haloCount = n;
  }

  private dirty(el: ZrShapeEl, count: number) {
    el.shape.count = count;
    el.ignore = count === 0;
    el.dirtyShape();
  }

  getHaloCount() {
    return this.haloCount;
  }

  /** 供拾取复用,避免重复建索引 */
  getIndices() {
    const points: Partial<Record<Exclude<LayerId, 'path' | 'area'>, GridIndex>> = {};
    for (const p of this.pointIdx) points[p.layer] = p.index;
    return { points, path: this.pathIndex, area: this.areaIndex };
  }

  /** 标注候选收集(供 LabelEngine 使用):只取当前可见且到档位的要素 */
  collectLabelCandidates(
    m: CamMatrix,
    viewport: Viewport,
    decision: RenderDecision,
    limit: number,
  ): { layer: LayerId; index: number; sx: number; sy: number; priority: number; text: string }[] {
    const out: { layer: LayerId; index: number; sx: number; sy: number; priority: number; text: string }[] = [];
    if (decision.pointMode === 'off') return out;
    const vb = viewBounds(m, viewport, 0);
    const individual = decision.pointMode === 'individual';

    const addLayer = (layer: Exclude<LayerId, 'path' | 'area'>, max: number) => {
      if (!decision.layerOn[layer]) return;
      if (layer === 'point' && !individual) return;
      const priority = LABEL_PRIORITY[layer];
      if (priority < decision.labelMinPriority) return;
      const idx = this.pointIdx.find((p) => p.layer === layer)!;
      const data = this.ds[layer];
      const cand = idx.index.queryRect(vb.minX, vb.minY, vb.maxX, vb.maxY, []);
      let n = 0;
      for (let k = 0; k < cand.length && n < max; k++) {
        const i = cand[k];
        const wx = data.x[i], wy = data.y[i];
        const dx = (wx - m.wx) * m.zoom;
        const dy = (wy - m.wy) * m.zoom;
        const sx = m.cx + dx * m.cos - dy * m.sin;
        const sy = m.cy + dx * m.sin + dy * m.cos;
        if (sx < 0 || sx > viewport.width || sy < 0 || sy > viewport.height) continue;
        // 拥挤时用短名:长名称会挤掉相邻标注
        out.push({ layer, index: i, sx, sy, priority, text: data.short[i] || data.names[i] });
        n++;
      }
    };

    // 按优先级从高到低收集,普通点位给更大配额
    // 汇总点档位下点族并没有逐个绘制,自然也不该出 individually 的标注
    if (individual) {
      addLayer('hazard', limit);
      addLayer('exit', limit);
      addLayer('stair', limit);
      addLayer('assembly', limit);
    }

    // 区域/楼栋名称:轮廓层始终给名字,否则全局档位一片空白认不出地方
    if (decision.layerOn.area) {
      for (let i = 0; i < this.ds.area.count; i++) {
        const rank = this.ds.area.rank[i];
        const wantRank = decision.areaMode === 'outline' ? 1 : 2;
        if (rank !== wantRank) continue;
        const cx = (this.ds.area.bbox[i * 4] + this.ds.area.bbox[i * 4 + 2]) / 2;
        const cy = (this.ds.area.bbox[i * 4 + 1] + this.ds.area.bbox[i * 4 + 3]) / 2;
        const dx = (cx - m.wx) * m.zoom;
        const dy = (cy - m.wy) * m.zoom;
        const sx = m.cx + dx * m.cos - dy * m.sin;
        const sy = m.cy + dx * m.sin + dy * m.cos;
        if (sx < 0 || sx > viewport.width || sy < 0 || sy > viewport.height) continue;
        out.push({
          layer: 'area',
          index: i,
          sx,
          sy,
          priority: rank === 1 ? 55 : 40,
          text: this.ds.area.names[i],
        });
      }
    }

    addLayer('point', Math.max(limit, 1200));
    return out;
  }
}
