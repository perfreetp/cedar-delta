import type {
  BrushKind,
  Level,
  StrokeDetailRow,
  StrokeSummary,
} from './types';

export interface StrokeMeta {
  brush: BrushKind;
  title: string;
  diameterLevel: Level;
  strengthLevel: Level;
  symmetric: boolean;
  pointerCount: number;
  mirrorCount: number;
  axisCount: number;
}

export interface StrokeRecord extends StrokeMeta {
  id: number;
  createdAt: number;
  indices: Uint32Array;
  /** Exact positions immediately before this stroke. */
  from: Float32Array;
  /** Exact positions immediately after this stroke. */
  to: Float32Array;
  /** to - from, stored as the stroke's vertex displacement data. */
  delta: Float32Array;
  maxDisplacement: number;
  totalDisplacement: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Linear stroke history with a cursor. Every record stores exact from/to
 * positions, so undo/redo is independent of floating-point delta accumulation.
 */
export class StrokeHistory {
  readonly basePositions: Float32Array;
  records: StrokeRecord[] = [];
  cursor = 0;
  private nextId = 1;
  private strokeStart: Float32Array | null = null;

  constructor(currentPositions: Float32Array) {
    this.basePositions = currentPositions.slice();
  }

  beginStroke(currentPositions: Float32Array): void {
    this.strokeStart = currentPositions.slice();
  }

  cancelStroke(): void {
    this.strokeStart = null;
  }

  commitStroke(
    currentPositions: Float32Array,
    affectedIndices: Set<number> | number[],
    meta: StrokeMeta,
  ): StrokeRecord | null {
    if (!this.strokeStart) return null;
    const start = this.strokeStart;
    const candidates = Array.from(new Set(affectedIndices)).sort((a, b) => a - b);

    const indices: number[] = [];
    const from: number[] = [];
    const to: number[] = [];
    const delta: number[] = [];
    let maxDisplacement = 0;
    let totalDisplacement = 0;

    for (const vertexIndex of candidates) {
      const offset = vertexIndex * 3;
      const dx = currentPositions[offset] - start[offset];
      const dy = currentPositions[offset + 1] - start[offset + 1];
      const dz = currentPositions[offset + 2] - start[offset + 2];
      const length = Math.hypot(dx, dy, dz);
      // Ignore numerical/no-op touches.
      if (length < 1e-7) continue;

      indices.push(vertexIndex);
      from.push(start[offset], start[offset + 1], start[offset + 2]);
      to.push(
        currentPositions[offset],
        currentPositions[offset + 1],
        currentPositions[offset + 2],
      );
      delta.push(dx, dy, dz);
      maxDisplacement = Math.max(maxDisplacement, length);
      totalDisplacement += length;
    }

    this.strokeStart = null;
    if (indices.length === 0) return null;

    // A new stroke discards the redo branch, matching standard undo semantics.
    this.records.length = this.cursor;

    const record: StrokeRecord = {
      ...meta,
      id: this.nextId++,
      createdAt: Date.now(),
      indices: Uint32Array.from(indices),
      from: Float32Array.from(from),
      to: Float32Array.from(to),
      delta: Float32Array.from(delta),
      maxDisplacement,
      totalDisplacement,
    };
    this.records.push(record);
    this.cursor = this.records.length;
    return record;
  }

  private restore(record: StrokeRecord, target: 'from' | 'to', positions: Float32Array): void {
    const source = record[target];
    for (let j = 0; j < record.indices.length; j += 1) {
      const vertexOffset = record.indices[j] * 3;
      const dataOffset = j * 3;
      positions[vertexOffset] = source[dataOffset];
      positions[vertexOffset + 1] = source[dataOffset + 1];
      positions[vertexOffset + 2] = source[dataOffset + 2];
    }
  }

  undo(positions: Float32Array): StrokeRecord | null {
    if (this.cursor === 0) return null;
    const record = this.records[this.cursor - 1];
    this.restore(record, 'from', positions);
    this.cursor -= 1;
    return record;
  }

  redo(positions: Float32Array): StrokeRecord | null {
    if (this.cursor >= this.records.length) return null;
    const record = this.records[this.cursor];
    this.restore(record, 'to', positions);
    this.cursor += 1;
    return record;
  }

  /** Restore the untouched imported mesh without changing the record list. */
  resetToBase(positions: Float32Array): void {
    positions.set(this.basePositions);
    this.cursor = 0;
  }

  /** Replay records 0..inclusiveIndex from the immutable base mesh. */
  replayTo(positions: Float32Array, inclusiveIndex: number): StrokeRecord | null {
    positions.set(this.basePositions);
    const last = Math.min(inclusiveIndex, this.records.length - 1);
    let applied: StrokeRecord | null = null;
    for (let i = 0; i <= last; i += 1) {
      applied = this.records[i];
      this.restore(applied, 'to', positions);
    }
    this.cursor = last + 1;
    return applied;
  }

  /** Apply the next record during timed one-by-one replay. */
  replayNext(positions: Float32Array): StrokeRecord | null {
    return this.redo(positions);
  }

  isAtEnd(): boolean {
    return this.cursor >= this.records.length;
  }

  summary(): import('./types').HistorySnapshot {
    return {
      records: this.records.map((record, index) => this.toSummary(record, index)),
      cursor: this.cursor,
      canUndo: this.cursor > 0,
      canRedo: this.cursor < this.records.length,
      totalStrokes: this.records.length,
    };
  }

  toSummary(record: StrokeRecord, index: number): StrokeSummary {
    return {
      id: record.id,
      index,
      brush: record.brush,
      title: record.title,
      affected: record.indices.length,
      maxDisplacement: record.maxDisplacement,
      totalDisplacement: record.totalDisplacement,
      diameterLevel: record.diameterLevel,
      strengthLevel: record.strengthLevel,
      symmetric: record.symmetric,
      pointerCount: record.pointerCount,
      mirrorCount: record.mirrorCount,
      axisCount: record.axisCount,
      createdAtLabel: formatTime(record.createdAt),
    };
  }

  detailRows(recordId: number, limit = 300): StrokeDetailRow[] {
    const record = this.records.find((item) => item.id === recordId);
    if (!record) return [];
    const rows: StrokeDetailRow[] = [];
    const count = Math.min(record.indices.length, limit);
    for (let j = 0; j < count; j += 1) {
      const dx = record.delta[j * 3];
      const dy = record.delta[j * 3 + 1];
      const dz = record.delta[j * 3 + 2];
      const x = record.to[j * 3];
      rows.push({
        index: record.indices[j],
        dx,
        dy,
        dz,
        length: Math.hypot(dx, dy, dz),
        side: Math.abs(x) < 1e-5 ? '0' : x > 0 ? '+' : '−',
      });
    }
    return rows.sort((a, b) => b.length - a.length);
  }
}
