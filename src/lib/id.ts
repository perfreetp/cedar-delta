// 唯一 id 生成
export function uid(prefix = 'id'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff).toString(16);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}
