/**
 * 均匀网格空间索引。
 * 每帧要从数万要素里快速取出「视野内候选」,所以按世界坐标分桶。
 * 查询用版本戳去重(要素可跨多格),避免每帧分配 Set。
 */
export class GridIndex {
  readonly cell: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  /** 每格存一段变长下标:cellStart[cell]..cellStart[cell+1] 指向 items */
  private readonly cellStart: Int32Array;
  private readonly items: Int32Array;
  /** 去重戳:每次查询自增 */
  private readonly stamp: Int32Array;
  private stampGen = 0;
  private readonly itemCount: number;

  private constructor(
    cell: number,
    minX: number,
    minY: number,
    cols: number,
    rows: number,
    cellStart: Int32Array,
    items: Int32Array,
    itemCount: number,
  ) {
    this.cell = cell;
    this.minX = minX;
    this.minY = minY;
    this.cols = cols;
    this.rows = rows;
    this.cellStart = cellStart;
    this.items = items;
    this.itemCount = itemCount;
    this.stamp = new Int32Array(itemCount);
  }

  get length() {
    return this.itemCount;
  }

  /**
   * 用每个要素的包围盒构建索引。bbox 为 Float32Array[4*n]: minX,minY,maxX,maxY
   */
  static build(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    bbox: Float32Array,
    count: number,
    cell = 300,
  ): GridIndex {
    const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell) + 1);
    const rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / cell) + 1);
    const total = cols * rows;

    const counts = new Int32Array(total + 1);

    for (let i = 0; i < count; i++) {
      const x0 = Math.max(0, Math.floor((bbox[i * 4] - bounds.minX) / cell));
      const y0 = Math.max(0, Math.floor((bbox[i * 4 + 1] - bounds.minY) / cell));
      const x1 = Math.min(cols - 1, Math.floor((bbox[i * 4 + 2] - bounds.minX) / cell));
      const y1 = Math.min(rows - 1, Math.floor((bbox[i * 4 + 3] - bounds.minY) / cell));
      for (let y = y0; y <= y1; y++) {
        const base = y * cols;
        for (let x = x0; x <= x1; x++) {
          counts[base + x + 1]++;
        }
      }
    }

    for (let c = 0; c < total; c++) counts[c + 1] += counts[c];
    const cellStart = counts;
    const items = new Int32Array(cellStart[total]);
    const cursor = new Int32Array(total);

    for (let i = 0; i < count; i++) {
      const x0 = Math.max(0, Math.floor((bbox[i * 4] - bounds.minX) / cell));
      const y0 = Math.max(0, Math.floor((bbox[i * 4 + 1] - bounds.minY) / cell));
      const x1 = Math.min(cols - 1, Math.floor((bbox[i * 4 + 2] - bounds.minX) / cell));
      const y1 = Math.min(rows - 1, Math.floor((bbox[i * 4 + 3] - bounds.minY) / cell));
      for (let y = y0; y <= y1; y++) {
        const base = y * cols;
        for (let x = x0; x <= x1; x++) {
          const c = base + x;
          items[cellStart[c] + cursor[c]++] = i;
        }
      }
    }
    return new GridIndex(cell, bounds.minX, bounds.minY, cols, rows, cellStart, items, count);
  }

  /** 取世界矩形内的候选要素下标(可能含少量框外要素,需调用方再精确判定) */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: number[] = []): number[] {
    out.length = 0;
    const x0 = Math.max(0, Math.floor((minX - this.minX) / this.cell));
    const y0 = Math.max(0, Math.floor((minY - this.minY) / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((maxX - this.minX) / this.cell));
    const y1 = Math.min(this.rows - 1, Math.floor((maxY - this.minY) / this.cell));
    if (x1 < x0 || y1 < y0) return out;

    const gen = ++this.stampGen;
    const stamp = this.stamp;
    for (let y = y0; y <= y1; y++) {
      const base = y * this.cols;
      for (let x = x0; x <= x1; x++) {
        const c = base + x;
        const s = this.cellStart[c];
        const e = this.cellStart[c + 1];
        for (let k = s; k < e; k++) {
          const idx = this.items[k];
          if (stamp[idx] !== gen) {
            stamp[idx] = gen;
            out.push(idx);
          }
        }
      }
    }
    return out;
  }

  /** 遍历全部要素下标(不重复) */
  forEach(cb: (index: number) => void) {
    const gen = ++this.stampGen;
    const stamp = this.stamp;
    for (let i = 0; i < this.items.length; i++) {
      const idx = this.items[i];
      if (stamp[idx] !== gen) {
        stamp[idx] = gen;
        cb(idx);
      }
    }
  }
}

/** 点图层用:包围盒可直接由坐标推出 */
export function buildPointIndex(
  xs: Float32Array,
  ys: Float32Array,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  cell = 300,
): GridIndex {
  const n = xs.length;
  const bbox = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    bbox[i * 4] = xs[i];
    bbox[i * 4 + 1] = ys[i];
    bbox[i * 4 + 2] = xs[i];
    bbox[i * 4 + 3] = ys[i];
  }
  return GridIndex.build(bounds, bbox, n, cell);
}

/** 折线用:先算每条折线包围盒 */
export function buildPathIndex(
  coords: Float32Array,
  offsets: Int32Array,
  count: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  cell = 300,
): { index: GridIndex; bbox: Float32Array } {
  const bbox = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const s = offsets[i];
    const e = i + 1 < count ? offsets[i + 1] : coords.length / 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = s; k < e; k++) {
      const x = coords[k * 2];
      const y = coords[k * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    bbox[i * 4] = minX;
    bbox[i * 4 + 1] = minY;
    bbox[i * 4 + 2] = maxX;
    bbox[i * 4 + 3] = maxY;
  }
  return { index: GridIndex.build(bounds, bbox, count, cell), bbox };
}
