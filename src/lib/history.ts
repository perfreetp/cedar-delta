// 编辑历史:雕刻 / 台阶 / 闸门 / 中心线统一快照,支持逐步撤销重做
import { HISTORY_LIMIT } from './constants';
import type { ControlPoint, Gate, Snapshot, Step } from './types';

export function makeSnapshot(
  base: Float32Array,
  controlPoints: ControlPoint[],
  steps: Step[],
  gates: Gate[],
): Snapshot {
  return {
    base: new Float32Array(base),
    controlPoints: controlPoints.map((p) => ({ ...p })),
    steps: steps.map((s) => ({ ...s })),
    gates: gates.map((g) => ({ ...g, pA: [...g.pA], pB: [...g.pB] })),
  };
}

export class HistoryStack {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** 提交一个新的编辑前快照 */
  push(snap: Snapshot): void {
    this.undoStack.push(snap);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * 撤销:把当前状态压入 redo,返回 undo 栈顶快照。
   * current 为撤销发生前的现场状态。
   */
  undo(current: Snapshot): Snapshot | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push(current);
    return snap;
  }

  /** 重做:把当前状态压入 undo,返回 redo 栈顶快照 */
  redo(current: Snapshot): Snapshot | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push(current);
    return snap;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }
}
