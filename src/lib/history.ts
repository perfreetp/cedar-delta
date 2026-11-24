import type { JointPose, RigDocument } from '../types';
import { cloneDoc } from './math';

interface Entry {
  doc: RigDocument;
  /** 该历史点对应的临时姿态（IK/牵引杆拖动需要随撤销一起回退） */
  pose: JointPose;
  label: string;
}

export interface HistoryStep {
  doc: RigDocument;
  pose: JointPose;
}

const EMPTY_POSE: JointPose = {};

/**
 * 基于文档快照的撤销/重做栈。
 * 每次结构性修改（拖动结束、约束编辑、关键帧增删、层级增删等）入栈一个快照。
 * 临时姿态（IK/牵引杆）在相关操作中随快照一起保存，保证撤销时画面同步回退。
 */
export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private current: RigDocument;
  private currentPose: JointPose = {};
  private listeners = new Set<() => void>();
  private txSnapshot: RigDocument | null = null;
  private txPose: JointPose | null = null;
  private txLabel = '';

  constructor(initial: RigDocument) {
    this.current = cloneDoc(initial);
  }

  get value(): RigDocument {
    return this.current;
  }

  get pose(): JointPose {
    return this.currentPose;
  }

  /** 实时姿态变更（不入历史，由调用方在拖动事务中使用） */
  setPose(pose: JointPose): void {
    this.currentPose = structuredClone(pose);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** 在修改前调用：保存当前状态快照 */
  push(label: string): void {
    this.past.push({ doc: cloneDoc(this.current), pose: structuredClone(this.currentPose), label });
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.emit();
  }

  /** 直接替换当前文档（载入文件时使用，清空历史与未提交事务） */
  replace(doc: RigDocument): void {
    this.current = cloneDoc(doc);
    this.currentPose = {};
    this.past = [];
    this.future = [];
    this.txSnapshot = null;
    this.txPose = null;
    this.emit();
  }

  /** 以函数式更新当前文档；label 非空时先入栈快照 */
  update(label: string | null, fn: (doc: RigDocument) => RigDocument): RigDocument {
    if (label !== null) this.push(label);
    this.current = fn(cloneDoc(this.current));
    this.emit();
    return this.current;
  }

  // ---- 事务：拖动等高频修改只在开始时保存一个快照，结束时一次性入栈 ----

  /** 开始事务：保存修改前的文档与姿态快照（嵌套调用只认最外层） */
  begin(label: string, pose?: JointPose): void {
    if (!this.txSnapshot) {
      this.txSnapshot = cloneDoc(this.current);
      this.txPose = structuredClone(pose ?? this.currentPose);
      this.txLabel = label;
    }
  }

  /** 事务中的实时修改（不入栈） */
  transact(fn: (doc: RigDocument) => RigDocument): void {
    this.current = fn(cloneDoc(this.current));
    this.emit();
  }

  /** 提交事务：把开始前的快照压入撤销栈 */
  commit(): void {
    if (this.txSnapshot) {
      this.past.push({ doc: this.txSnapshot, pose: this.txPose ?? EMPTY_POSE, label: this.txLabel });
      if (this.past.length > 100) this.past.shift();
      this.future = [];
      this.txSnapshot = null;
      this.txPose = null;
      this.emit();
    }
  }

  /** 取消事务：恢复到开始前状态 */
  cancel(): void {
    if (this.txSnapshot) {
      this.current = this.txSnapshot;
      if (this.txPose) this.currentPose = this.txPose;
      this.txSnapshot = null;
      this.txPose = null;
      this.emit();
    }
  }

  get inTransaction(): boolean {
    return this.txSnapshot !== null;
  }

  undo(): HistoryStep | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({
      doc: cloneDoc(this.current),
      pose: structuredClone(this.currentPose),
      label: entry.label,
    });
    this.current = entry.doc;
    this.currentPose = structuredClone(entry.pose);
    this.emit();
    return { doc: this.current, pose: this.currentPose };
  }

  redo(): HistoryStep | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({
      doc: cloneDoc(this.current),
      pose: structuredClone(this.currentPose),
      label: entry.label,
    });
    this.current = entry.doc;
    this.currentPose = structuredClone(entry.pose);
    this.emit();
    return { doc: this.current, pose: this.currentPose };
  }
}
