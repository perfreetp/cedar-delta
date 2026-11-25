/**
 * 撤销系统：每次落盘的布置操作（拖动就位、对齐、碰撞避让后的组平移）
 * 都是一条 Command，携带操作前后的完整快照。
 *
 * 快照同时包含套管布置（含吸附关系 snapU/snapV/snapped）与剖切状态，
 * 因此一次撤销可以把吸附关系和剖切位置一起还原。
 */
import { cloneSleeve, type ClipState, type SleeveState } from './types';

export interface SceneSnapshot {
  sleeves: SleeveState[];
  clip: ClipState;
}

export interface Command {
  label: string;
  before: SceneSnapshot;
  after: SceneSnapshot;
}

function snapshotSleeves(s: SleeveState[]): SleeveState[] {
  return s.map(cloneSleeve);
}

function snapshotClip(c: ClipState): ClipState {
  return {
    enabled: c.enabled,
    normal: [c.normal[0], c.normal[1], c.normal[2]],
    distance: c.distance,
  };
}

export function takeSnapshot(sleeves: SleeveState[], clip: ClipState): SceneSnapshot {
  return { sleeves: snapshotSleeves(sleeves), clip: snapshotClip(clip) };
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(private readonly onChange?: () => void) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }

  /** 提交一条已执行完成的命令 */
  push(label: string, before: SceneSnapshot, after: SceneSnapshot): void {
    this.undoStack.push({ label, before, after });
    this.redoStack.length = 0;
    this.onChange?.();
  }

  undo(): SceneSnapshot | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    this.redoStack.push(cmd);
    this.onChange?.();
    return cmd.before;
  }

  redo(): SceneSnapshot | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.undoStack.push(cmd);
    this.onChange?.();
    return cmd.after;
  }

  labels(): string[] {
    return this.undoStack.map((c) => c.label);
  }
}
