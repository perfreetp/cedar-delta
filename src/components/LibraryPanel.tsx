import { createMemo, createSignal, For, Show } from 'solid-js';
import { LIBRARY_ITEMS } from '../data/library';
import { projectStore } from '../state/projectStore';
import type { LibraryItem } from '../types';
import { PanelSection } from './controls';

const CATEGORIES = ['全部', '岩石', '浮标', '人工障碍'] as const;

export default function LibraryPanel() {
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<(typeof CATEGORIES)[number]>('全部');

  const items = createMemo(() =>
    LIBRARY_ITEMS.filter((item) => {
      const matchCategory = category() === '全部' || item.category === category();
      const q = query().trim().toLowerCase();
      const matchQuery = !q || `${item.name}${item.description}${item.id}`.toLowerCase().includes(q);
      return matchCategory && matchQuery;
    }),
  );

  const onDragStart = (event: DragEvent, item: LibraryItem) => {
    event.dataTransfer?.setData('application/x-river-library', item.id);
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div>
      <PanelSection title="障碍库" count={LIBRARY_ITEMS.length}>
        <input
          class="input library-search"
          placeholder="搜索岩石、浮标、门架…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="category-tabs">
          <For each={CATEGORIES}>
            {(cat) => (
              <button class={`chip ${category() === cat ? 'active' : ''}`} onClick={() => setCategory(cat)}>
                {cat}
              </button>
            )}
          </For>
        </div>

        <div class="library-grid">
          <For each={items()}>
            {(item) => (
              <button
                class="library-card"
                draggable={true}
                style={{ '--card-color': item.color }}
                onDragStart={(e) => onDragStart(e, item)}
                onClick={() => projectStore.addLibraryItem(item.id)}
                title="拖到河道，或点击直接放入"
              >
                <div class="library-icon">{item.icon}</div>
                <div class="library-name">{item.name}</div>
                <div class="library-desc">{item.description}</div>
              </button>
            )}
          </For>
        </div>
        <Show when={items().length === 0}>
          <div class="empty-state">
            <span class="big">⌕</span>
            没有匹配的障碍模板
          </div>
        </Show>
      </PanelSection>

      <PanelSection title="拖放提示">
        <p class="help-text">
          1. 将卡片拖到三维水面，落点会自动映射到 <b>y=0</b> 水面。
          <br />
          2. 单击障碍可选中；属于分组的障碍会整组选中。
          <br />
          3. 按住 <span class="kbd">Shift</span> 点击可加减选。
          <br />
          4. 快捷键 <span class="kbd">W</span> 平移、<span class="kbd">E</span> 旋转、
          <span class="kbd">Esc</span> 取消选择。
        </p>
      </PanelSection>
    </div>
  );
}
