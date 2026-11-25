/**
 * 选择模型：保留插入顺序（对齐时"第一个选中"即序列首位）。
 */
export class SelectionModel {
  private order: number[] = [];
  private set = new Set<number>();

  get ids(): readonly number[] {
    return this.order;
  }

  get size(): number {
    return this.order.length;
  }

  has(id: number): boolean {
    return this.set.has(id);
  }

  first(): number | null {
    return this.order[0] ?? null;
  }

  select(id: number): void {
    if (!this.set.has(id)) {
      this.set.add(id);
      this.order.push(id);
    }
  }

  toggle(id: number): void {
    if (this.set.has(id)) this.remove(id);
    else this.select(id);
  }

  /** 追加选择（Shift/Ctrl 语义）；无修饰键时替换选择 */
  pick(id: number, additive: boolean): void {
    if (!additive) this.clear();
    this.select(id);
  }

  remove(id: number): void {
    if (this.set.delete(id)) this.order = this.order.filter((x) => x !== id);
  }

  replace(ids: Iterable<number>): void {
    this.clear();
    for (const id of ids) this.select(id);
  }

  clear(): void {
    this.set.clear();
    this.order = [];
  }
}
