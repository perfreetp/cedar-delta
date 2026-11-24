import {
  DEFAULT_TABLE_RADIUS,
  FlowerInstance,
  FlowerType,
  GroupData,
  MAX_INSTANCES,
  STORAGE_KEY,
  DesignDocument,
} from './types';

export function uid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function cloneDocument(doc: DesignDocument): DesignDocument {
  if (typeof structuredClone === 'function') return structuredClone(doc);
  return JSON.parse(JSON.stringify(doc)) as DesignDocument;
}

const FLOWER_TYPES: FlowerType[] = ['rose', 'hydrangea', 'eucalyptus'];

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asTriple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  return [asNumber(value[0], fallback[0]), asNumber(value[1], fallback[1]), asNumber(value[2], fallback[2])];
}

export function createInstance(type: FlowerType, index: number): FlowerInstance {
  const scaleBase = type === 'hydrangea' ? 0.95 : type === 'eucalyptus' ? 1.05 : 1;
  return {
    id: uid('flower'),
    type,
    name: `${type === 'rose' ? '玫瑰' : type === 'hydrangea' ? '绣球' : '尤加利叶'} ${index}`,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [scaleBase, scaleBase, scaleBase],
    vaseHeight: 0.12,
    groupId: null,
    colorSeed: Math.random(),
  };
}

export function createEmptyDocument(): DesignDocument {
  return {
    app: 'banquet-floral-editor',
    version: 1,
    tableRadius: DEFAULT_TABLE_RADIUS,
    instances: [],
    groups: [],
  };
}

export function validateDocument(raw: unknown): DesignDocument {
  if (!raw || typeof raw !== 'object') throw new Error('文件不是有效的布置 JSON');
  const source = raw as Partial<DesignDocument>;
  if (!Array.isArray(source.instances)) throw new Error('缺少 instances 数组');

  const instances: FlowerInstance[] = source.instances.slice(0, MAX_INSTANCES).map((item, index) => {
    const v = (item ?? {}) as Partial<FlowerInstance>;
    const type = FLOWER_TYPES.includes(v.type as FlowerType) ? (v.type as FlowerType) : 'rose';
    const scale = asTriple(v.scale, [1, 1, 1]).map((n) => clamp(n, 0.05, 8)) as [number, number, number];
    return {
      id: typeof v.id === 'string' ? v.id : uid('flower'),
      type,
      name: typeof v.name === 'string' ? v.name : `花材 ${index + 1}`,
      position: asTriple(v.position, [0, 0, 0]),
      rotation: asTriple(v.rotation, [0, 0, 0]),
      scale,
      vaseHeight: clamp(asNumber(v.vaseHeight, 0.12), -1, 4),
      groupId: typeof v.groupId === 'string' ? v.groupId : null,
      colorSeed: asNumber(v.colorSeed, Math.random()),
    };
  });

  const ids = new Set(instances.map((i) => i.id));
  const groups: GroupData[] = Array.isArray(source.groups)
    ? source.groups
        .map((g) => {
          const group = (g ?? {}) as Partial<GroupData>;
          const memberIds = Array.isArray(group.memberIds)
            ? group.memberIds.filter((id): id is string => typeof id === 'string' && ids.has(id))
            : [];
          return {
            id: typeof group.id === 'string' ? group.id : uid('group'),
            name: typeof group.name === 'string' ? group.name : '花材组',
            memberIds: Array.from(new Set(memberIds)),
            createdAt: typeof group.createdAt === 'number' ? group.createdAt : undefined,
          };
        })
        .filter((g) => g.memberIds.length > 0)
    : [];

  const groupIds = new Set(groups.map((g) => g.id));
  for (const inst of instances) {
    if (!inst.groupId || !groupIds.has(inst.groupId)) inst.groupId = null;
  }
  for (const group of groups) {
    for (const id of group.memberIds) {
      const inst = instances.find((i) => i.id === id);
      if (inst) inst.groupId = group.id;
    }
  }

  return {
    app: 'banquet-floral-editor',
    version: 1,
    tableRadius: clamp(asNumber(source.tableRadius, DEFAULT_TABLE_RADIUS), 2, 12),
    instances,
    groups,
  };
}

export function loadStoredDocument(): DesignDocument | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    return validateDocument(JSON.parse(text));
  } catch (error) {
    console.warn('读取本地布置失败', error);
    return null;
  }
}

export function saveStoredDocument(doc: DesignDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch (error) {
    console.warn('保存本地布置失败', error);
  }
}

export function downloadJson(doc: DesignDocument): void {
  const payload = {
    ...doc,
    exportedAt: new Date().toISOString(),
    generator: '宴屿婚礼桌花编辑器',
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `banquet-floral-layout-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
