import { cloneState } from './math';
import type { LabState } from './types';

export interface Command {
  label: string;
  before: LabState;
  after: LabState;
}

type ApplyState = (state: LabState, source: 'undo' | 'redo' | 'commit') => void;

export class HistoryStack {
  private past: Command[] = [];
  private future: Command[] = [];

  constructor(private apply: ApplyState) {}

  /** Record an already-performed change. */
  commit(label: string, before: LabState, after: LabState): Command {
    const command: Command = {
      label,
      before: cloneState(before),
      after: cloneState(after),
    };
    this.past.push(command);
    if (this.past.length > 100) this.past.shift();
    this.future.length = 0;
    return command;
  }

  /** Mutate a fresh state and record the whole transaction. */
  execute(label: string, current: LabState, mutate: (draft: LabState) => void): LabState {
    const before = cloneState(current);
    const after = cloneState(current);
    mutate(after);
    this.commit(label, before, after);
    this.apply(cloneState(after), 'commit');
    return after;
  }

  undo(): Command | null {
    const command = this.past.pop();
    if (!command) return null;
    this.future.push(command);
    this.apply(cloneState(command.before), 'undo');
    return command;
  }

  redo(): Command | null {
    const command = this.future.pop();
    if (!command) return null;
    this.past.push(command);
    this.apply(cloneState(command.after), 'redo');
    return command;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
