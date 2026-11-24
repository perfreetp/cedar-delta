/**
 * 数据持久化：
 * - localStorage 自动保存（浏览器内数据）
 * - 导出 .wvp.json 文件用于分享，导入文件继续编辑
 */
import type { ProjectData, Region, SnapSettings, PlacedObject } from '../types';

const STORAGE_KEY = 'wedding-venue-planner:project:v1';
const FILE_MAGIC = 'WVP';
export const PROJECT_VERSION = 1;

export function defaultSnap(): SnapSettings {
  return {
    gridEnabled: true,
    objectEnabled: true,
    gridSize: 1,
    threshold: 0.35,
  };
}

export function emptyProject(name = '未命名婚礼场地'): ProjectData {
  const now = Date.now();
  return {
    version: PROJECT_VERSION,
    name,
    regions: [],
    objects: [],
    snap: defaultSnap(),
    createdAt: now,
    updatedAt: now,
  };
}

export function saveLocal(data: ProjectData): void {
  try {
    const payload: ProjectData = { ...data, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // 配额不足等错误不中断编辑
    console.warn('自动保存失败', err);
  }
}

export function loadLocal(): ProjectData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ProjectData;
    return validateProject(data);
  } catch (err) {
    console.warn('读取本地项目失败', err);
    return null;
  }
}

export function clearLocal(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** 导出项目文件并触发浏览器下载 */
export function exportProject(data: ProjectData): void {
  const payload = {
    magic: FILE_MAGIC,
    ...data,
    updatedAt: Date.now(),
  } satisfies ProjectData & { magic: string };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = data.name.replace(/[\\/:*?"<>|]/g, '_');
  a.href = url;
  a.download = `${safeName}.wvp.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 从 File 对象导入项目 */
export function importProjectFile(file: File): Promise<ProjectData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as ProjectData & { magic?: string };
        resolve(validateProject(data));
      } catch (err) {
        reject(new Error('文件解析失败：不是有效的项目文件'));
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

/** 项目结构校验与兜底修复 */
export function validateProject(input: unknown): ProjectData {
  if (typeof input !== 'object' || input === null) {
    throw new Error('项目数据格式不正确');
  }
  const d = input as Partial<ProjectData>;
  if (d.version !== PROJECT_VERSION) {
    throw new Error(`不支持的项目版本: ${String(d.version)}`);
  }
  const regions = Array.isArray(d.regions) ? (d.regions.filter(validRegion) as Region[]) : [];
  const objects = Array.isArray(d.objects) ? (d.objects.filter(validObject) as PlacedObject[]) : [];
  return {
    version: PROJECT_VERSION,
    name: typeof d.name === 'string' && d.name.trim() ? d.name : '导入的婚礼场地',
    regions,
    objects,
    snap: { ...defaultSnap(), ...(d.snap ?? {}) },
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
  };
}

function validRegion(r: unknown): boolean {
  if (typeof r !== 'object' || r === null) return false;
  const reg = r as Region;
  if (reg.type === 'rect') {
    return (
      typeof reg.x === 'number' &&
      typeof reg.z === 'number' &&
      typeof reg.width === 'number' &&
      reg.width > 0 &&
      typeof reg.depth === 'number' &&
      reg.depth > 0
    );
  }
  if (reg.type === 'polygon') {
    return Array.isArray(reg.points) && reg.points.length >= 3;
  }
  return false;
}

function validObject(o: unknown): boolean {
  if (typeof o !== 'object' || o === null) return false;
  const obj = o as PlacedObject;
  return (
    typeof obj.id === 'string' &&
    typeof obj.catalogId === 'string' &&
    typeof obj.x === 'number' &&
    typeof obj.z === 'number' &&
    typeof obj.width === 'number' &&
    obj.width > 0 &&
    typeof obj.depth === 'number' &&
    obj.depth > 0
  );
}
