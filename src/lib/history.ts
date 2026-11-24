/**
 * 撤销 / 重做：命令模式，拖动/旋转整段交互合并为一条历史记录。
 * 与具体 store 解耦——store 负责提供 undo/redo 回调。
 */
import { createSignal } from 'solid-js';

export interface HistoryCommand {
  label: string;
  undo: () => void;
  redo: () => void;
}

const CAPACITY = 100;

export class HistoryStack {
  private stack: HistoryCommand[] = [];
  private pointer = 0;
  private frozen = false;
  readonly canUndo = createSignal(false);
  readonly canRedo = createSignal(false);
  /** 最近一次动作文本（状态栏提示用） */
  readonly lastLabel = createSignal('');

  private refresh(): void {
    this.canUndo[1](this.pointer > 0);
    this.canRedo[1](this.pointer < this.stack.length);
  }

  /** 执行一条命令并压栈 */
  push(cmd: HistoryCommand): void {
    if (this.frozen) return;
    // 丢弃 redo 分支
    if (this.pointer < this.stack.length) {
      this.stack.length = this.pointer;
    }
    cmd.redo();
    this.stack.push(cmd);
    if (this.stack.length > CAPACITY) {
      this.stack.shift();
    } else {
      this.pointer += 1;
    }
    this.lastLabel[1](cmd.label);
    this.refresh();
  }

  undo(): void {
    if (this.pointer <= 0) return;
    this.pointer -= 1;
    const cmd = this.stack[this.pointer];
    this.frozen = true;
    try {
      cmd.undo();
    } finally {
      this.frozen = false;
    }
    this.lastLabel[1](`撤销: ${cmd.label}`);
    this.refresh();
  }

  redo(): void {
    if (this.pointer >= this.stack.length) return;
    const cmd = this.stack[this.pointer];
    this.pointer += 1;
    this.frozen = true;
    try {
      cmd.redo();
    } finally {
      this.frozen = false;
    }
    this.lastLabel[1](`重做: ${cmd.label}`);
    this.refresh();
  }

  clear(): void {
    this.stack = [];
    this.pointer = 0;
    this.lastLabel[1]('');
    this.refresh();
  }
}
