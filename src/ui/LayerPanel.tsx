import { For, Show, createSignal } from 'solid-js';
import type { LayerId } from '../types';
import type { AppStore } from '../core/store';
import { layerCounts } from '../data/generate';

const LAYER_META: Record<LayerId, { name: string; color: string; desc: string }> = {
  hazard: { name: '危险源', color: '#f87171', desc: '易燃 / 电气 / 拥堵风险点' },
  exit: { name: '出口', color: '#4ade80', desc: '安全出口与疏散门' },
  stair: { name: '楼梯', color: '#a78bfa', desc: '竖向疏散通道' },
  assembly: { name: '集合点', color: '#38bdf8', desc: '室外应急集结点' },
  path: { name: '路径线', color: '#94a3b8', desc: '疏散路径段' },
  point: { name: '普通点位', color: '#67e8f9', desc: '房间 / 工位 / 人群' },
  area: { name: '区域面', color: '#1e3a8a', desc: '园区分区与楼层轮廓' },
};

export function LayerPanel(props: { store: AppStore }) {
  const { store } = props;
  const counts = layerCounts(store.ds);

  let dragId: LayerId | null = null;
  const [dragOver, setDragOver] = createSignal<number | null>(null);

  const layers = () => store.state().layers;

  function onDragStart(e: DragEvent, id: LayerId) {
    if (id === 'hazard') {
      e.preventDefault();
      return;
    }
    dragId = id;
    e.dataTransfer?.setData('text/plain', id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent, index: number) {
    if (!dragId) return;
    e.preventDefault();
    setDragOver(index);
  }

  function onDrop(e: DragEvent, index: number) {
    e.preventDefault();
    if (!dragId) return;
    const from = layers().findIndex((l) => l.id === dragId);
    if (from >= 0 && from !== index) store.reorderLayers(from, index);
    dragId = null;
    setDragOver(null);
  }

  function onDragEnd() {
    dragId = null;
    setDragOver(null);
  }

  return (
    <div class="panel">
      <div class="panel__head">
        <h3>图层</h3>
        <div class="panel__actions">
          <button class="btn btn--ghost btn--xs" onClick={() => store.setAllLayersVisible(true)}>全开</button>
          <button class="btn btn--ghost btn--xs" onClick={() => store.setAllLayersVisible(false)}>全关</button>
        </div>
      </div>

      <p class="panel__hint">拖动调整叠放顺序,越靠下越在上层。危险源固定压在最上面。</p>

      <ul class="layer-list">
        <For each={layers()}>
          {(layer, i) => {
            const meta = LAYER_META[layer.id];
            const locked = layer.id === 'hazard';
            return (
              <li
                class="layer-row"
                classList={{
                  'layer-row--locked': locked,
                  'layer-row--hidden': !layer.visible,
                  'layer-row--over': dragOver() === i(),
                  'layer-row--dragging': dragId === layer.id,
                }}
                draggable={!locked}
                onDragStart={(e) => onDragStart(e, layer.id)}
                onDragOver={(e) => onDragOver(e, i())}
                onDragLeave={() => setDragOver((v) => (v === i() ? null : v))}
                onDrop={(e) => onDrop(e, i())}
                onDragEnd={onDragEnd}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (!e.altKey || locked) return;
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation();
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    store.moveLayerBy(layer.id, -1);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    store.moveLayerBy(layer.id, 1);
                  }
                }}
              >
                <span class="layer-row__grip" title={locked ? '危险源固定置顶' : '拖动排序(或聚焦后按 Alt+↑/↓)'}>
                  {locked ? '📌' : '⠿'}
                </span>
                <span class="layer-row__swatch" style={{ background: meta.color }} />
                <span class="layer-row__main">
                  <span class="layer-row__name">{meta.name}</span>
                  <span class="layer-row__desc">{meta.desc}</span>
                </span>
                <span class="layer-row__count">{counts[layer.id].toLocaleString()}</span>
                <label class="switch" title={layer.visible ? '隐藏图层' : '显示图层'}>
                  <input
                    type="checkbox"
                    checked={layer.visible}
                    onChange={(e) => store.setLayerVisible(layer.id, e.currentTarget.checked)}
                  />
                  <span class="switch__track"><span class="switch__dot" /></span>
                </label>
              </li>
            );
          }}
        </For>
      </ul>

      <Show when={store.selection().size > 0}>
        <div class="panel__foot">
          <span>已选 <b>{store.selection().size}</b></span>
          <button class="btn btn--ghost btn--xs" onClick={() => store.clearSelection()}>清空选择</button>
        </div>
      </Show>
    </div>
  );
}

export { LAYER_META };
