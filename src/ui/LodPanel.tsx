import { For, Show, createMemo } from 'solid-js';
import type { LayerId, LodTier } from '../types';
import type { AppStore } from '../core/store';
import { defaultTiers, tierByZoom } from '../core/lod';
import { LAYER_META } from './LayerPanel';

const TIER_LAYERS: Exclude<LayerId, 'hazard'>[] = ['area', 'path', 'point', 'assembly', 'stair', 'exit'];

export function LodPanel(props: { store: AppStore }) {
  const { store } = props;
  const tiers = () => store.state().tiers;

  const overviewTier = createMemo(() => tierByZoom(store.cameras().overview.zoom, tiers()).id);
  const floorTier = createMemo(() => tierByZoom(store.cameras().floor.zoom, tiers()).id);

  const currentZoomLabel = () =>
    `总览 ×${store.cameras().overview.zoom.toFixed(3)} · 楼层 ×${store.cameras().floor.zoom.toFixed(3)}`;

  return (
    <div class="panel">
      <div class="panel__head">
        <h3>缩放档位</h3>
        <span class="mono panel__meta">{currentZoomLabel()}</span>
      </div>
      <p class="panel__hint">
        每个档位有自己的显示阈值与图层组合。阈值按「每世界单位像素数」比较,超出该档下界即切换。
      </p>

      <div class="tier-list">
        <For each={tiers()}>
          {(tier: LodTier, i) => {
            const isCurrent = () => overviewTier() === i() || floorTier() === i();
            return (
              <div class="tier-card" classList={{ 'tier-card--current': isCurrent() }}>
                <div class="tier-card__head">
                  <span class="tier-card__idx">{i() + 1}</span>
                  <span class="tier-card__name">{tier.name}</span>
                  <Show when={isCurrent()}><span class="pill pill--live">当前</span></Show>
                  <label class="tier-card__zoom">
                    <span>≥</span>
                    <input
                      type="number"
                      step="0.01"
                      min={i() === 0 ? 0 : 0.001}
                      value={tier.minZoom.toFixed(3)}
                      disabled={i() === 0}
                      onChange={(e) => {
                        const v = Number(e.currentTarget.value);
                        if (Number.isFinite(v)) store.patchTier(i(), { minZoom: i() === 0 ? 0 : v });
                      }}
                    />
                  </label>
                </div>

                <div class="tier-card__modes">
                  <label>
                    <span>面</span>
                    <select
                      value={tier.areaMode}
                      onChange={(e) =>
                        store.patchTier(i(), { areaMode: e.currentTarget.value as LodTier['areaMode'] })
                      }
                    >
                      <option value="off">不画</option>
                      <option value="outline">仅轮廓</option>
                      <option value="fill">填充</option>
                    </select>
                  </label>
                  <label>
                    <span>路径</span>
                    <select
                      value={tier.pathMode}
                      onChange={(e) =>
                        store.patchTier(i(), { pathMode: e.currentTarget.value as LodTier['pathMode'] })
                      }
                    >
                      <option value="off">不画</option>
                      <option value="trunk">仅主干</option>
                      <option value="full">全部</option>
                    </select>
                  </label>
                  <label>
                    <span>点位</span>
                    <select
                      value={tier.pointMode}
                      onChange={(e) =>
                        store.patchTier(i(), { pointMode: e.currentTarget.value as LodTier['pointMode'] })
                      }
                    >
                      <option value="off">不画</option>
                      <option value="summary">汇总点</option>
                      <option value="individual">全部</option>
                    </select>
                  </label>
                </div>

                <div class="tier-card__layers">
                  <For each={TIER_LAYERS}>
                    {(id) => (
                      <label class="chip" style={{ '--chip': LAYER_META[id].color }}>
                        <input
                          type="checkbox"
                          checked={tier.enabled[id] !== false}
                          onChange={(e) => store.setTierEnabled(i(), id, e.currentTarget.checked)}
                        />
                        <span>{LAYER_META[id].name}</span>
                      </label>
                    )}
                  </For>
                  <span class="chip chip--fixed" style={{ '--chip': LAYER_META.hazard.color }}>
                    危险源常显
                  </span>
                </div>

                <div class="tier-card__labels">
                  <label>
                    标注上限
                    <input
                      type="number"
                      min="0"
                      max="3000"
                      step="20"
                      value={tier.labelBudget}
                      onChange={(e) => {
                        const v = Number(e.currentTarget.value);
                        if (Number.isFinite(v)) store.patchTier(i(), { labelBudget: Math.max(0, v) });
                      }}
                    />
                  </label>
                  <label>
                    最低优先级
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="10"
                      value={tier.labelMinPriority}
                      onChange={(e) => {
                        const v = Number(e.currentTarget.value);
                        if (Number.isFinite(v)) store.patchTier(i(), { labelMinPriority: v });
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <div class="panel__foot panel__foot--wrap">
        <button class="btn btn--ghost btn--xs" onClick={() => store.setTiers(defaultTiers())}>
          恢复默认档位
        </button>
      </div>
    </div>
  );
}

