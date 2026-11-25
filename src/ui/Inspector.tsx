import { For, Show, createMemo } from 'solid-js';
import type { AppStore } from '../core/store';
import { parseKey } from '../core/store';
import type { LayerId } from '../types';
import { LAYER_META } from './LayerPanel';

export function Inspector(props: { store: AppStore }) {
  const { store } = props;

  const infos = createMemo(() => store.selectionInfos());

  const byLayer = createMemo(() => {
    const m = new Map<LayerId, number>();
    for (const key of store.selection()) {
      const p = parseKey(key);
      if (!p) continue;
      m.set(p.layer, (m.get(p.layer) ?? 0) + 1);
    }
    return [...m.entries()];
  });

  const single = () => (infos().length === 1 ? infos()[0] : null);

  return (
    <div class="panel">
      <div class="panel__head">
        <h3>要素详情</h3>
        <Show when={store.selection().size > 0}>
          <span class="mono panel__meta">已选 {store.selection().size}</span>
        </Show>
      </div>

      <Show
        when={store.selection().size > 0}
        fallback={
          <div class="empty-state">
            <p>暂无选中要素</p>
            <p class="empty-state__hint">
              在地图上单击要素查看详情;按住 Shift 拖框或切到「框选」可一次选中多个。两个视图的选中状态是同步的。
            </p>
          </div>
        }
      >
        <Show when={byLayer().length > 1}>
          <div class="inspector__breakdown">
            <For each={byLayer()}>
              {([layer, n]) => (
                <span class="chip chip--static" style={{ '--chip': LAYER_META[layer].color }}>
                  {LAYER_META[layer].name} <b>{n}</b>
                </span>
              )}
            </For>
          </div>
        </Show>

        <Show when={single()}>
          {(info) => (
            <dl class="kv">
              <dt>名称</dt>
              <dd>{info().name}</dd>
              <dt>类型</dt>
              <dd>
                <span class="chip chip--static" style={{ '--chip': LAYER_META[info().layer].color }}>
                  {LAYER_META[info().layer].name}
                </span>
              </dd>
              <dt>所属</dt>
              <dd>{info().floor ?? '室外园区'}</dd>
              <dt>坐标</dt>
              <dd class="mono">{info().x.toFixed(0)}, {info().y.toFixed(0)}</dd>
              <For each={Object.entries(info().meta ?? {})}>
                {([k, v]) => (
                  <>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </>
                )}
              </For>
            </dl>
          )}
        </Show>

        <Show when={!single()}>
          <ul class="selection-list">
            <For each={infos().slice(0, 60)}>
              {(info) => (
                <li class="selection-list__row">
                  <span class="dot" style={{ background: LAYER_META[info.layer].color }} />
                  <span class="selection-list__name">{info.name}</span>
                  <span class="selection-list__floor">{info.floor ?? '室外'}</span>
                </li>
              )}
            </For>
            <Show when={infos().length > 60}>
              <li class="selection-list__more">还有 {infos().length - 60} 个…</li>
            </Show>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
