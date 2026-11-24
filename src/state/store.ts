import { useSyncExternalStore } from 'react';

/** 挤出参数（全局，作用于所有字块） */
export interface ExtrudeParams {
  /** 挤出厚度（场景单位） */
  depth: number;
  /** 侧边斜切（倒角）宽度 */
  bevelSize: number;
  /** 倒角厚度（沿法向） */
  bevelThickness: number;
  bevelSegments: number;
  /** 前脸浮雕缩放比（相对字形外轮廓） */
  reliefScale: number;
  /** 前脸内凹浮雕深度 */
  reliefDepth: number;
}

/** 排布参数 */
export interface LayoutParams {
  mode: 'line' | 'arc';
  /** 字间距（相邻字块边缘距离） */
  spacing: number;
  /** 圆弧总弧度（度），仅 arc 模式 */
  arcAngle: number;
  /** 弧的凸向：1 朝观察者，-1 背向 */
  arcBulge: 1 | -1;
}

export interface Block {
  id: string;
  glyphIndex: number;
  char: string;
}

export interface AppState {
  blocks: Block[];
  extrude: ExtrudeParams;
  layout: LayoutParams;
  selectedId: string | null;
}

const initialState: AppState = {
  blocks: [],
  extrude: {
    depth: 0.35,
    bevelSize: 0.03,
    bevelThickness: 0.03,
    bevelSegments: 3,
    reliefScale: 0.72,
    reliefDepth: 0.04,
  },
  layout: { mode: 'arc', spacing: 0.08, arcAngle: 120, arcBulge: 1 },
  selectedId: null,
};

type Listener = () => void;

/**
 * 全局 store：快照式不可变状态 + 整体回退历史。
 * 滑块拖动走 beginTransaction/setTransient/endTransaction，
 * 一次拖动只产生一条历史记录。
 */
class Store {
  private state: AppState = initialState;
  private past: AppState[] = [];
  private future: AppState[] = [];
  private txBase: AppState | null = null;
  private listeners = new Set<Listener>();

  get = (): AppState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** 提交一个可回退的修改 */
  commit(fn: (s: AppState) => AppState) {
    this.past.push(this.state);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.state = fn(this.state);
    this.emit();
  }

  /** 拖动开始：记录基准快照 */
  beginTransaction() {
    if (!this.txBase) this.txBase = this.state;
  }

  /** 拖动中的瞬时更新（不进历史） */
  setTransient(fn: (s: AppState) => AppState) {
    this.state = fn(this.state);
    this.emit();
  }

  /** 拖动结束：把整次拖动压成一条历史 */
  endTransaction() {
    if (this.txBase && this.txBase !== this.state) {
      this.past.push(this.txBase);
      if (this.past.length > 200) this.past.shift();
      this.future = [];
    }
    this.txBase = null;
    this.emit();
  }

  undo() {
    if (this.txBase) this.endTransaction();
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state);
    this.state = prev;
    this.emit();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state);
    this.state = next;
    this.emit();
  }

  canUndo = () => this.past.length > 0;
  canRedo = () => this.future.length > 0;
}

export const store = new Store();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.get);
}

let idCounter = 0;
export function nextId(): string {
  return `b${Date.now().toString(36)}_${idCounter++}`;
}
