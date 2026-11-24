import type { ColliderSpec, Obstacle, ProjectDocument } from '../types';
import { DEFAULT_RIVER } from '../river';

export function serializeScheme(doc: ProjectDocument): string {
  return JSON.stringify(
    {
      ...doc,
      exportedAt: new Date().toISOString(),
      generator: 'rapid-river-obstacle-studio/1.0',
    },
    null,
    2,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const nums = value.map(Number);
  return nums.every(Number.isFinite) ? [nums[0], nums[1], nums[2]] : fallback;
}

function asRiverConfig(value: unknown): ProjectDocument['river'] {
  const rawRiver = isRecord(value) ? value : {};
  const number = (key: keyof typeof DEFAULT_RIVER, min: number, max: number) => {
    const parsed = Number(rawRiver[key]);
    const fallback = DEFAULT_RIVER[key];
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  return {
    length: number('length', 20, 200),
    width: number('width', 4, 60),
    centerWidth: number('centerWidth', 2, 40),
    curveAmplitude: number('curveAmplitude', 0, 12),
    segmentLength: number('segmentLength', 0.5, 8),
    waterLevel: number('waterLevel', -2, 4),
    channelBottom: number('channelBottom', -8, 2),
    channelTop: number('channelTop', -1, 12),
  };
}

export function parseScheme(text: string): ProjectDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!isRecord(raw)) throw new Error('方案根节点格式不正确');
  if (raw.format !== 'rapid-river-obstacle-layout') {
    throw new Error('不是本工具导出的赛道方案文件');
  }
  if (!Array.isArray(raw.obstacles) || !Array.isArray(raw.groups)) {
    throw new Error('方案缺少 obstacles 或 groups 数组');
  }

  const obstacles: Obstacle[] = raw.obstacles.filter(isRecord).map((o) => ({
    id: String(o.id ?? `imported_${Math.random().toString(36).slice(2)}`),
    libraryId: String(o.libraryId ?? 'rock-granite'),
    name: String(o.name ?? '未命名障碍'),
    category: (['岩石', '浮标', '人工障碍'].includes(String(o.category))
      ? String(o.category)
      : '人工障碍') as ProjectDocument['obstacles'][number]['category'],
    kind: (['rock', 'buoy', 'artificial'].includes(String(o.kind))
      ? String(o.kind)
      : 'artificial') as ProjectDocument['obstacles'][number]['kind'],
    position: asVec3(o.position, [0, 0, 0]),
    rotation: asVec3(o.rotation, [0, 0, 0]),
    scale: asVec3(o.scale, [1, 1, 1]).map((v) => Math.max(0.05, v)) as [number, number, number],
    exposure: Number.isFinite(Number(o.exposure)) ? Number(o.exposure) : 0.5,
    suspension: Number.isFinite(Number(o.suspension)) ? Number(o.suspension) : 0,
    groupId: typeof o.groupId === 'string' ? o.groupId : null,
    color: typeof o.color === 'string' ? o.color : '#94a3b8',
    collider: isRecord(o.collider) ? (structuredClone(o.collider) as ColliderSpec) : { kind: 'box', size: [1, 1, 1] },
  }));

  const groups = raw.groups.filter(isRecord).map((g) => ({
    id: String(g.id),
    name: String(g.name ?? '导入分组'),
    color: typeof g.color === 'string' ? g.color : '#38bdf8',
    ...(isRecord(g.batch)
      ? {
          batch: {
            spacing: Number(g.batch.spacing) || 4,
            startS: Number(g.batch.startS) || 0,
            lateral: Number(g.batch.lateral) || 0,
            memberIds: Array.isArray(g.batch.memberIds) ? g.batch.memberIds.map(String) : [],
          },
        }
      : {}),
  }));

  const detection = isRecord(raw.detection) ? raw.detection : {};
  return {
    format: 'rapid-river-obstacle-layout',
    formatVersion: 1,
    name: typeof raw.name === 'string' ? raw.name : '导入的赛道方案',
    river: asRiverConfig(raw.river),
    detection: {
      laneThreshold: Number(detection.laneThreshold) || 7.5,
      pairThreshold: Number(detection.pairThreshold) || 0.08,
      reefThreshold: Number(detection.reefThreshold) || 0.35,
      showColliders: detection.showColliders !== false,
      showChannel: detection.showChannel !== false,
      showLabels: detection.showLabels !== false,
    },
    obstacles,
    groups,
  };
}
