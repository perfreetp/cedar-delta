// 赛道文件导出 / 导入(自包含 JSON,可分享)
import {
  GRID_SEGMENTS,
  TERRAIN_LENGTH,
  TERRAIN_WIDTH,
} from './constants';
import type { ControlPoint, Gate, Step, TrackFile } from './types';

export function serializeTrack(
  name: string,
  base: Float32Array,
  controlPoints: ControlPoint[],
  steps: Step[],
  gates: Gate[],
): TrackFile {
  return {
    format: 'whitewater-track',
    version: 1,
    meta: { name, exportedAt: new Date().toISOString() },
    grid: {
      segments: GRID_SEGMENTS,
      width: TERRAIN_WIDTH,
      length: TERRAIN_LENGTH,
    },
    controlPoints: controlPoints.map((p) => ({ ...p })),
    steps: steps.map((s) => ({ ...s })),
    gates: gates.map((g) => ({
      ...g,
      pA: [g.pA[0], g.pA[1], g.pA[2]] as [number, number, number],
      pB: [g.pB[0], g.pB[1], g.pB[2]] as [number, number, number],
    })),
    baseHeights: Array.from(base),
  };
}

export function downloadTrack(file: TrackFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = file.meta.name.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || 'track';
  a.download = `${safe}.whtrack.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseTrack(text: string): TrackFile {
  const data = JSON.parse(text) as TrackFile;
  if (data.format !== 'whitewater-track') {
    throw new Error('文件格式不正确:缺少 whitewater-track 标识');
  }
  if (!Array.isArray(data.baseHeights) || !Array.isArray(data.controlPoints)) {
    throw new Error('文件内容不完整');
  }
  return data;
}
