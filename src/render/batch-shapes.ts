import * as echarts from 'echarts';

/**
 * 批量图元:把成百上千个符号塞进一次 buildPath,遍历成本与图元数解耦。
 * 这是 4 万级要素还能 60fps 的关键 —— 逐要素建 Displayable 会慢 3~5 倍。
 *
 * 每种图元都吃一块预分配的屏幕坐标缓冲(由 FeatureRenderer 每帧填充)。
 */

const G = echarts.graphic as unknown as {
  extendShape: (opts: Record<string, unknown>) => new (opts?: Record<string, unknown>) => unknown;
};

type Ctx = {
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  arc: (x: number, y: number, r: number, a0: number, a1: number) => void;
  closePath?: () => void;
};

/** 点族批量缓冲布局:每个符号 4 个 float — x, y, sizePx, shapeId */
export interface SymbolBatchShape {
  data: Float32Array;
  count: number;
}

/**
 * 批量画多条折线/多边形。
 * total 是本帧真实写入的点数 —— 不能用 coords.length 兜底,
 * 否则最后一条会画到上一帧残留的脏数据上(表现为贯穿全图的白色斜带)。
 */
function polylineInto(
  ctx: Ctx,
  coords: Float32Array,
  offsets: Int32Array,
  count: number,
  total: number,
  closed: boolean,
) {
  for (let i = 0; i < count; i++) {
    const s = offsets[i];
    const e = i + 1 < count ? offsets[i + 1] : total;
    if (e - s < 2) continue;
    ctx.moveTo(coords[s * 2], coords[s * 2 + 1]);
    for (let k = s + 1; k < e; k++) ctx.lineTo(coords[k * 2], coords[k * 2 + 1]);
    if (closed) ctx.lineTo(coords[s * 2], coords[s * 2 + 1]);
  }
}

/** 方形/圆形混合批量:普通点位用方块(便宜),重点类用圆形 */
export const BatchSquare = G.extendShape({
  shape: { data: null as Float32Array | null, count: 0 },
  style: { fill: '#67e8f9' },
  buildPath(ctx: Ctx, shape: SymbolBatchShape) {
    const d = shape.data;
    if (!d) return;
    const n = shape.count;
    for (let i = 0; i < n; i++) {
      const x = d[i * 4];
      const y = d[i * 4 + 1];
      const r = d[i * 4 + 2];
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x - r, y - r);
    }
  },
});

export const BatchCircle = G.extendShape({
  shape: { data: null as Float32Array | null, count: 0, filled: true },
  style: { fill: '#67e8f9' },
  buildPath(ctx: Ctx, shape: SymbolBatchShape & { filled: boolean }) {
    const d = shape.data;
    if (!d) return;
    const n = shape.count;
    if (shape.filled === false) {
      // 只描边:逐个独立 circle 路径段,避免连线
      for (let i = 0; i < n; i++) {
        const x = d[i * 4], y = d[i * 4 + 1], r = d[i * 4 + 2];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.closePath?.();
      }
    } else {
      for (let i = 0; i < n; i++) {
        const x = d[i * 4], y = d[i * 4 + 1], r = d[i * 4 + 2];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
  },
});

/** 出口:向下箭头(指向室外) */
export const BatchChevron = G.extendShape({
  shape: { data: null as Float32Array | null, count: 0 },
  style: { fill: '#4ade80' },
  buildPath(ctx: Ctx, shape: SymbolBatchShape) {
    const d = shape.data;
    if (!d) return;
    const n = shape.count;
    for (let i = 0; i < n; i++) {
      const x = d[i * 4], y = d[i * 4 + 1], r = d[i * 4 + 2];
      const w = r * 0.95;
      ctx.moveTo(x, y + r * 1.15);
      ctx.lineTo(x - w, y - r * 0.35);
      ctx.lineTo(x - w * 0.34, y - r * 0.35);
      ctx.lineTo(x - w * 0.34, y - r);
      ctx.lineTo(x + w * 0.34, y - r);
      ctx.lineTo(x + w * 0.34, y - r * 0.35);
      ctx.lineTo(x + w, y - r * 0.35);
      ctx.lineTo(x, y + r * 1.15);
    }
  },
});

/** 楼梯:阶梯锯齿 */
export const BatchZigzag = G.extendShape({
  shape: { data: null as Float32Array | null, count: 0 },
  style: { fill: '#a78bfa' },
  buildPath(ctx: Ctx, shape: SymbolBatchShape) {
    const d = shape.data;
    if (!d) return;
    const n = shape.count;
    for (let i = 0; i < n; i++) {
      const x = d[i * 4], y = d[i * 4 + 1], r = d[i * 4 + 2];
      const w = r * 0.8, h = r * 1.1;
      ctx.moveTo(x - w, y + h);
      ctx.lineTo(x - w, y - h * 0.1);
      ctx.lineTo(x - w * 0.33, y - h * 0.1);
      ctx.lineTo(x - w * 0.33, y - h * 0.55);
      ctx.lineTo(x + w * 0.33, y - h * 0.55);
      ctx.lineTo(x + w * 0.33, y - h);
      ctx.lineTo(x + w, y - h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x - w, y + h);
    }
  },
});

/** 危险源:三角警示 */
export const BatchTriangle = G.extendShape({
  shape: { data: null as Float32Array | null, count: 0, ring: false },
  style: { fill: '#f87171' },
  buildPath(ctx: Ctx, shape: SymbolBatchShape & { ring: boolean }) {
    const d = shape.data;
    if (!d) return;
    const n = shape.count;
    for (let i = 0; i < n; i++) {
      const x = d[i * 4], y = d[i * 4 + 1], r = d[i * 4 + 2] * (shape.ring ? 1.9 : 1);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.92, y + r * 0.72);
      ctx.lineTo(x - r * 0.92, y + r * 0.72);
      ctx.lineTo(x, y - r);
    }
  },
});

/** 折线批量(路径层):统一线宽,故一次描边 */
export const BatchPolyline = G.extendShape({
  shape: { data: null as Float32Array | null, offsets: null as Int32Array | null, count: 0, total: 0 },
  style: { stroke: '#64748b', lineWidth: 1, fill: 'none' },
  buildPath(
    ctx: Ctx,
    shape: { data: Float32Array | null; offsets: Int32Array | null; count: number; total: number },
  ) {
    if (!shape.data || !shape.offsets) return;
    polylineInto(ctx, shape.data, shape.offsets, shape.count, shape.total, false);
  },
});

/** 多边形批量(区域/楼层轮廓):fill 为 false 时只描边 */
export const BatchPolygon = G.extendShape({
  shape: { data: null as Float32Array | null, offsets: null as Int32Array | null, count: 0, total: 0 },
  style: { stroke: '#38bdf8', lineWidth: 1, fill: null },
  buildPath(
    ctx: Ctx,
    shape: { data: Float32Array | null; offsets: Int32Array | null; count: number; total: number },
  ) {
    if (!shape.data || !shape.offsets) return;
    polylineInto(ctx, shape.data, shape.offsets, shape.count, shape.total, true);
  },
});

/** 选中高亮:每个选中点画一圈 + 外框 */
export const BatchHalo = G.extendShape({
  shape: { data: null as Float32Array | null, count: 0 },
  style: { stroke: '#fde047', lineWidth: 2, fill: null },
  buildPath(ctx: Ctx, shape: SymbolBatchShape) {
    const d = shape.data;
    if (!d) return;
    const n = shape.count;
    for (let i = 0; i < n; i++) {
      const x = d[i * 4], y = d[i * 4 + 1], r = d[i * 4 + 2];
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.closePath?.();
    }
  },
});
