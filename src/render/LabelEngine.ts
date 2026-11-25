import type { LayerId } from '../types';
import type { LabelPlacement } from './FeatureRenderer';

export interface LabelCandidate {
  layer: LayerId;
  index: number;
  sx: number;
  sy: number;
  priority: number;
  text: string;
}

/** 屏幕空间矩形 */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 标注避让:按优先级降序贪婪放置,冲突则换方位,再不行就收起。
 * 全部在屏幕坐标里做轴对齐矩形判定,因此相机旋转后只是重新排布,不会叠成一团。
 */
export class LabelEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly measureCache = new Map<string, { w: number; h: number }>();
  private readonly cellSize = 64;
  private readonly buckets = new Map<number, Rect[]>();
  private readonly placed: Rect[] = [];

  readonly font = '11px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
  /**
   * 必须与 styles.css 里 .map-label 完全一致:
   * font-size 11 / line-height 16 / padding 2px 5px / border 1px。
   * 少算边框或行高都会让「算着不重叠、看着叠在一起」。
   */
  private readonly padX = 5;
  private readonly border = 1;
  private readonly lineHeight = 16;
  private readonly padY = 2;

  constructor() {
    const c = document.createElement('canvas');
    this.ctx = c.getContext('2d')!;
    this.ctx.font = this.font;
  }

  private measure(text: string) {
    let m = this.measureCache.get(text);
    if (!m) {
      const textW = this.ctx.measureText(text).width;
      m = {
        w: Math.ceil(textW) + (this.padX + this.border) * 2,
        h: this.lineHeight + (this.padY + this.border) * 2,
      };
      if (this.measureCache.size < 8000) this.measureCache.set(text, m);
    }
    return m;
  }

  reset() {
    this.placed.length = 0;
    this.buckets.clear();
  }

  private insert(r: Rect) {
    this.placed.push(r);
    const x0 = Math.floor(r.x / this.cellSize);
    const x1 = Math.floor((r.x + r.w) / this.cellSize);
    const y0 = Math.floor(r.y / this.cellSize);
    const y1 = Math.floor((r.y + r.h) / this.cellSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = (y + 4096) * 65536 + (x + 4096);
        let arr = this.buckets.get(key);
        if (!arr) {
          arr = [];
          this.buckets.set(key, arr);
        }
        arr.push(r);
      }
    }
  }

  /**
   * 碰撞判定用 1.5px 的间隙。
   * 原因:CSS 实际渲染宽度与 canvas 测量有零点几像素的差异,
   * 不留间隙就会出现「算着不重叠、看着叠了一条边」的伪重叠。
   */
  private static readonly GAP = 1.5;

  private collides(rect: Rect): boolean {
    const g = LabelEngine.GAP;
    const r = { x: rect.x - g, y: rect.y - g, w: rect.w + g * 2, h: rect.h + g * 2 };
    const x0 = Math.floor(r.x / this.cellSize);
    const x1 = Math.floor((r.x + r.w) / this.cellSize);
    const y0 = Math.floor(r.y / this.cellSize);
    const y1 = Math.floor((r.y + r.h) / this.cellSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const arr = this.buckets.get((y + 4096) * 65536 + (x + 4096));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return true;
        }
      }
    }
    return false;
  }

  /**
   * 放置标注。
   * @param candidates 已按优先级排序(高在前)
   * @param budget 最多放多少个
   * @param viewport 视口,用于裁剪屏幕外与贴边翻转
   */
  place(
    candidates: LabelCandidate[],
    budget: number,
    viewport: { width: number; height: number },
    anchorRadius: (c: LabelCandidate) => number,
  ): LabelPlacement[] {
    this.reset();
    const out: LabelPlacement[] = [];
    if (budget <= 0) return out;

    // 方位:右、左、上、下,再斜角
    const offsets = [
      { align: 'left', valign: 'middle', dx: 1, dy: 0 },
      { align: 'right', valign: 'middle', dx: -1, dy: 0 },
      { align: 'center', valign: 'bottom', dx: 0, dy: -1 },
      { align: 'center', valign: 'top', dx: 0, dy: 1 },
      { align: 'left', valign: 'bottom', dx: 1, dy: -1 },
      { align: 'left', valign: 'top', dx: 1, dy: 1 },
      { align: 'right', valign: 'bottom', dx: -1, dy: -1 },
      { align: 'right', valign: 'top', dx: -1, dy: 1 },
    ] as const;

    for (const c of candidates) {
      if (out.length >= budget) break;
      if (c.sx < -20 || c.sx > viewport.width + 20 || c.sy < -20 || c.sy > viewport.height + 20) continue;
      const dim = this.measure(c.text);
      const r = anchorRadius(c);
      let chosen: Rect | null = null;
      // 锚点本身作为障碍物:标注不会盖住要素图标。仅在真正放下后再登记
      const anchorRect: Rect = { x: c.sx - r, y: c.sy - r, w: r * 2, h: r * 2 };

      // 高优先级多试几圈,尽量放下;放不下就收起来,绝不压到已放置的标注
      const maxRing = c.priority >= 90 ? 3 : 1;
      for (let ring = 1; ring <= maxRing && !chosen; ring++) {
        const gap = r + 5 + (ring - 1) * 22;
        for (const off of offsets) {
          const adx = Math.abs(off.dx);
          const ady = Math.abs(off.dy);
          let x: number, y: number;
          if (off.align === 'left') x = c.sx + gap * adx;
          else if (off.align === 'right') x = c.sx - gap * adx - dim.w;
          else x = c.sx - dim.w / 2;
          if (off.valign === 'middle') y = c.sy - dim.h / 2;
          else if (off.valign === 'bottom') y = c.sy - gap * ady - dim.h;
          else y = c.sy + gap * ady;

          const rect: Rect = { x, y, w: dim.w, h: dim.h };
          if (rect.x < 2 || rect.y < 2 || rect.x + rect.w > viewport.width - 2 || rect.y + rect.h > viewport.height - 2) continue;
          if (this.collides(rect)) continue;
          chosen = rect;
          break;
        }
      }

      // 放不下就收起:按优先级降序处理,先放下的必然是出口/危险源等要紧要素
      if (!chosen) continue;

      this.insert(anchorRect);
      this.insert(chosen);
      out.push(this.toPlacement(c, chosen!));
    }
    return out;
  }

  private toPlacement(c: LabelCandidate, rect: Rect): LabelPlacement {
    return {
      text: c.text,
      // 对齐到整像素:文字更清晰,且与碰撞判定用的矩形严格一致
      x: Math.round(rect.x + this.padX + this.border),
      y: Math.round(rect.y + rect.h / 2),
      w: rect.w,
      h: rect.h,
      priority: c.priority,
      kind: c.layer,
      index: c.index,
      ax: c.sx,
      ay: c.sy,
    };
  }

  /** 已放置矩形,供自检脚本断言不重叠 */
  getPlaced(): readonly Rect[] {
    return this.placed;
  }
}
