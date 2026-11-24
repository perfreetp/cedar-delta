import type { RigDocument } from '../types';

const FILE_MAGIC = 'PUPPET_RIG_DOC';
const FILE_VERSION = 1;

interface FileEnvelope {
  magic: string;
  version: number;
  exportedAt: string;
  document: RigDocument;
}

/** 导出为单个 JSON 文件并触发下载 */
export function exportDocument(doc: RigDocument): void {
  const envelope: FileEnvelope = {
    magic: FILE_MAGIC,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    document: doc,
  };
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name || 'puppet'}.rig.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 解析并校验导入文件 */
export async function importDocument(file: File): Promise<RigDocument> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法的 JSON');
  }
  const envelope = parsed as Partial<FileEnvelope>;
  if (envelope.magic !== FILE_MAGIC || !envelope.document) {
    throw new Error('文件格式不正确：缺少木偶骨架文件标识');
  }
  const doc = envelope.document as RigDocument;
  validateDocument(doc);
  return doc;
}

/** 结构校验：导入损坏/不相关文件时给出明确错误而不是白屏 */
export function validateDocument(doc: RigDocument): void {
  if (!doc || typeof doc !== 'object') throw new Error('文档内容为空');
  if (!Array.isArray(doc.joints) || doc.joints.length === 0) throw new Error('文档中没有关节数据');
  const ids = new Set<string>();
  for (const j of doc.joints) {
    if (typeof j.id !== 'string' || ids.has(j.id)) throw new Error(`关节 id 重复或非法: ${j.id}`);
    ids.add(j.id);
    if (!Array.isArray(j.localOffset) || j.localOffset.length !== 3) throw new Error(`关节 ${j.id} 的 localOffset 非法`);
    if (!j.limits || !j.limits.x || !j.limits.y || !j.limits.z) throw new Error(`关节 ${j.id} 的约束数据缺失`);
  }
  for (const j of doc.joints) {
    if (j.parentId !== null && !ids.has(j.parentId)) throw new Error(`关节 ${j.id} 引用了不存在的父关节`);
  }
  if (!Array.isArray(doc.keyframes)) throw new Error('关键帧数据缺失');
  for (const kf of doc.keyframes) {
    if (typeof kf.time !== 'number' || typeof kf.id !== 'string') throw new Error('关键帧格式非法');
    if (typeof kf.pose !== 'object') throw new Error('关键帧姿态数据非法');
  }
  if (!doc.rod || !Array.isArray(doc.rod.bindings)) throw new Error('牵引杆数据缺失');
}
