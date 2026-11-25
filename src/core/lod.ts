import type { LayerId, LodConfig, LodTier } from '../types';

export const LABEL_PRIORITY: Record<LayerId, number> = {
  hazard: 100,
  exit: 90,
  stair: 70,
  assembly: 60,
  point: 30,
  path: 10,
  area: 20,
};

export const ALL_LAYERS: LayerId[] = ['hazard', 'exit', 'stair', 'assembly', 'path', 'point', 'area'];

export function defaultTiers(): LodTier[] {
  return [
    {
      id: 0,
      name: '全局',
      minZoom: 0,
      areaMode: 'outline',
      // 全局档位只看轮廓与汇总点;需要看主干可在档位面板里改成「仅主干」
      pathMode: 'off',
      pointMode: 'summary',
      enabled: { exit: true, stair: true, assembly: true, path: true, point: false, area: true },
      labelBudget: 18,
      labelMinPriority: 90,
    },
    {
      id: 1,
      name: '楼栋',
      minZoom: 0.055,
      areaMode: 'fill',
      pathMode: 'full',
      pointMode: 'individual',
      enabled: { exit: true, stair: true, assembly: true, path: true, point: true, area: true },
      labelBudget: 90,
      labelMinPriority: 70,
    },
    {
      id: 2,
      name: '楼层',
      minZoom: 0.24,
      areaMode: 'fill',
      pathMode: 'full',
      pointMode: 'individual',
      enabled: { exit: true, stair: true, assembly: true, path: true, point: true, area: true },
      labelBudget: 260,
      labelMinPriority: 30,
    },
    {
      id: 3,
      name: '房间级',
      minZoom: 1.2,
      areaMode: 'fill',
      pathMode: 'full',
      pointMode: 'individual',
      enabled: { exit: true, stair: true, assembly: true, path: true, point: true, area: true },
      labelBudget: 420,
      labelMinPriority: 30,
    },
  ];
}

export function defaultLodConfig(): LodConfig {
  return { tiers: defaultTiers() };
}

/** 按 zoom 选档位:取 minZoom 不超过当前 zoom 的最高档 */
export function resolveTierIndex(zoom: number, tiers: LodTier[]): number {
  const sorted = [...tiers].sort((a, b) => a.minZoom - b.minZoom);
  let idx = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (zoom >= sorted[i].minZoom) idx = i;
    else break;
  }
  return idx;
}

export function tierByZoom(zoom: number, tiers: LodTier[]): LodTier {
  const list = tiers.length ? tiers : defaultTiers();
  const sorted = [...list].sort((a, b) => a.minZoom - b.minZoom);
  const i = resolveTierIndex(zoom, sorted);
  return sorted[Math.min(i, sorted.length - 1)];
}

/** 当前帧的渲染决策表 */
export interface RenderDecision {
  tier: LodTier;
  tierIndex: number;
  /** 图层是否绘制(图层开关 × 档位配置;危险源不受档位限制,只受开关控制) */
  layerOn: Record<LayerId, boolean>;
  pointMode: LodTier['pointMode'];
  pathMode: LodTier['pathMode'];
  areaMode: LodTier['areaMode'];
  labelBudget: number;
  labelMinPriority: number;
}

export function resolveDecision(
  zoom: number,
  tiers: LodTier[],
  layerVisible: Record<LayerId, boolean>,
  pointBudgetScale: number,
): RenderDecision {
  const tier = tierByZoom(zoom, tiers);
  const layerOn = { ...layerVisible } as Record<LayerId, boolean>;
  for (const id of ALL_LAYERS) {
    if (id === 'hazard') continue;
    const en = tier.enabled[id as Exclude<LayerId, 'hazard'>];
    layerOn[id] = layerVisible[id] && en !== false;
  }
  return {
    tier,
    tierIndex: tier.id,
    layerOn,
    pointMode: tier.pointMode,
    pathMode: tier.pathMode,
    areaMode: tier.areaMode,
    // 交互时压缩标注预算与点位采样
    labelBudget: Math.round(tier.labelBudget * pointBudgetScale),
    labelMinPriority: tier.labelMinPriority,
  };
}
