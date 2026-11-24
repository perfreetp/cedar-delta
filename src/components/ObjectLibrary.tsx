/**
 * 左侧物体库：按类别分组展示预设物体，点击进入放置模式，
 * 在地面点击摆放；支持连续放置，Esc 退出。
 */
import { For, createSignal } from 'solid-js';
import { CATEGORIES, catalogByCategory } from '../catalog';
import type { CatalogItem } from '../types';
import type { InteractionController } from '../three/controller';

export function ObjectLibrary(props: {
  controller: () => InteractionController | undefined;
}) {
  const [active, setActive] = createSignal<string | null>(null);

  const choose = (item: CatalogItem) => {
    const c = props.controller();
    if (!c) return;
    c.setPlaceMode(item);
    setActive(item.id);
    c.onModeChange(() => {
      if (c.getModeKind() !== 'place') setActive(null);
    });
  };

  return (
    <aside class="panel panel-left">
      <h3>物体库</h3>
      <p class="hint">点击物体后在场地内点击放置，按 R 旋转 90°，Esc 退出</p>
      <For each={[...CATEGORIES]}>
        {(cat) => (
          <section class="catalog-group">
            <h4>{cat}</h4>
            <div class="catalog-grid">
              <For each={catalogByCategory(cat)}>
                {(item) => (
                  <button
                    class="catalog-item"
                    classList={{ active: active() === item.id }}
                    onClick={() => choose(item)}
                    title={`${item.name}（${item.width}×${item.depth}×${item.height}m）`}
                  >
                    <span
                      class="catalog-swatch"
                      style={{ background: item.color }}
                    />
                    <span class="catalog-name">{item.name}</span>
                    <span class="catalog-size">
                      {item.width}×{item.depth}m
                    </span>
                  </button>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </aside>
  );
}
