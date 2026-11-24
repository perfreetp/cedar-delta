import type { ChoreographyFile, StageConfig } from '../types';
import { useEditorStore } from '../store';

export function exportChoreography(): ChoreographyFile {
  const s = useEditorStore.getState();
  let durationSec = 0;
  for (const p of s.puppets) {
    const last = [...p.keyframes].sort((a, b) => b.timeSec - a.timeSec)[0];
    if (last) durationSec = Math.max(durationSec, last.timeSec + last.dwellSec);
  }
  return {
    format: 'puppet-choreography',
    version: 1,
    exportedAt: new Date().toISOString(),
    durationSec,
    stage: s.stage,
    puppets: s.puppets,
  };
}

export function downloadJson(data: ChoreographyFile, filename = `choreography-${Date.now()}.json`): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function validateFile(raw: unknown): { ok: true; file: ChoreographyFile } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '文件不是有效 JSON 对象' };
  const f = raw as Partial<ChoreographyFile>;
  if (f.format !== 'puppet-choreography') return { ok: false, error: '缺少 format 标识，不是走位文件' };
  if (f.version !== 1) return { ok: false, error: `不支持的版本: ${String(f.version)}` };
  if (!Array.isArray(f.puppets)) return { ok: false, error: 'puppets 字段缺失' };
  const stage = f.stage as StageConfig | undefined;
  if (!stage || typeof stage.worldWidth !== 'number' || typeof stage.worldHeight !== 'number') {
    return { ok: false, error: 'stage 配置缺失' };
  }
  for (const p of f.puppets) {
    if (!Array.isArray(p.waypoints) || p.waypoints.length < 1) {
      return { ok: false, error: `偶 ${p.name ?? p.id} 缺少经过点` };
    }
    if (!Array.isArray(p.keyframes) || p.keyframes.length < 1) {
      return { ok: false, error: `偶 ${p.name ?? p.id} 缺少关键帧` };
    }
  }
  return { ok: true, file: f as ChoreographyFile };
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readImageAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
