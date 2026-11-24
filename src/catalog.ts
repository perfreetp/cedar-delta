/**
 * 物体库：桌椅、舞台、花柱等婚礼常用物体的预设定义
 * 尺寸单位为米，为真实婚礼场地常见尺寸。
 */
import type { CatalogItem } from './types';

export const CATEGORIES = ['桌椅', '舞台', '装饰', '设施'] as const;
export type CategoryName = (typeof CATEGORIES)[number];

export const CATALOG: CatalogItem[] = [
  // —— 桌椅 ——
  {
    id: 'round-table',
    category: '桌椅',
    name: '圆桌(10人)',
    width: 1.8,
    depth: 1.8,
    height: 0.75,
    color: '#b5895a',
    footprint: 'circle',
    geometry: 'roundTable',
  },
  {
    id: 'long-table',
    category: '桌椅',
    name: '长条桌',
    width: 2.4,
    depth: 0.9,
    height: 0.75,
    color: '#c49a6c',
    footprint: 'box',
    geometry: 'longTable',
  },
  {
    id: 'chair',
    category: '桌椅',
    name: '宴会椅',
    width: 0.45,
    depth: 0.5,
    height: 0.9,
    color: '#e8e2d8',
    footprint: 'box',
    geometry: 'chair',
  },
  {
    id: 'sofa',
    category: '桌椅',
    name: '休息沙发',
    width: 2.0,
    depth: 0.9,
    height: 0.85,
    color: '#8a9a7b',
    footprint: 'box',
    geometry: 'sofa',
  },
  // —— 舞台 ——
  {
    id: 'stage',
    category: '舞台',
    name: '舞台',
    width: 8,
    depth: 4,
    height: 0.6,
    color: '#7d6b5d',
    footprint: 'box',
    geometry: 'stage',
  },
  {
    id: 'arch',
    category: '舞台',
    name: '仪式拱门',
    width: 3,
    depth: 0.6,
    height: 2.6,
    color: '#d9c7a3',
    footprint: 'box',
    geometry: 'arch',
  },
  {
    id: 'backdrop',
    category: '舞台',
    name: '背景板',
    width: 6,
    depth: 0.4,
    height: 3,
    color: '#f3ead9',
    footprint: 'box',
    geometry: 'backdrop',
  },
  // —— 装饰 ——
  {
    id: 'flower-column',
    category: '装饰',
    name: '花柱',
    width: 0.5,
    depth: 0.5,
    height: 1.8,
    color: '#e58aa2',
    footprint: 'box',
    geometry: 'flowerColumn',
  },
  {
    id: 'flower-stand',
    category: '装饰',
    name: '桌花架',
    width: 0.4,
    depth: 0.4,
    height: 1.2,
    color: '#d66b86',
    footprint: 'box',
    geometry: 'flowerStand',
  },
  {
    id: 'carpet',
    category: '装饰',
    name: '红毯通道',
    width: 1.5,
    depth: 6,
    height: 0.02,
    color: '#a83246',
    footprint: 'box',
    geometry: 'carpet',
  },
  {
    id: 'candle',
    category: '装饰',
    name: '烛台',
    width: 0.25,
    depth: 0.25,
    height: 0.6,
    color: '#f2d38b',
    footprint: 'box',
    geometry: 'candle',
  },
  // —— 设施 ——
  {
    id: 'speaker',
    category: '设施',
    name: '音响',
    width: 0.6,
    depth: 0.5,
    height: 1.4,
    color: '#3c3c40',
    footprint: 'box',
    geometry: 'speaker',
  },
  {
    id: 'buffet-table',
    category: '设施',
    name: '自助餐台',
    width: 3,
    depth: 1,
    height: 0.9,
    color: '#9c7a54',
    footprint: 'box',
    geometry: 'buffetTable',
  },
  {
    id: 'sign-board',
    category: '设施',
    name: '迎宾牌',
    width: 0.9,
    depth: 0.3,
    height: 1.6,
    color: '#6d8f7b',
    footprint: 'box',
    geometry: 'signBoard',
  },
  {
    id: 'gift-table',
    category: '设施',
    name: '礼品桌',
    width: 1.5,
    depth: 0.7,
    height: 0.8,
    color: '#b08d64',
    footprint: 'box',
    geometry: 'giftTable',
  },
];

const CATALOG_MAP = new Map(CATALOG.map((c) => [c.id, c]));

export function getCatalogItem(id: string): CatalogItem {
  const item = CATALOG_MAP.get(id);
  if (!item) throw new Error(`未知物体库条目: ${id}`);
  return item;
}

export function catalogByCategory(cat: string): CatalogItem[] {
  return CATALOG.filter((c) => c.category === cat);
}
