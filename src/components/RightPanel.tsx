/**
 * 右侧工作面板：吸附设置 / 图层显隐 / 属性编辑 / 区域管理
 */
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { CATEGORIES } from '../catalog';
import { planner } from '../store/store';
import type { PlacedObject, PolygonRegion, RectRegion } from '../types';

type Tab = 'snap' | 'layers' | 'props' | 'regions';

export function RightPanel() {
  const [tab, setTab] = createSignal<Tab>('snap');
  const selected = createMemo(() => planner.selected);

  return (
    <aside class="panel panel-right">
      <nav class="tab-nav">
        <button classList={{ active: tab() === 'snap' }} onClick={() => setTab('snap')}>
          吸附
        </button>
        <button classList={{ active: tab() === 'layers' }} onClick={() => setTab('layers')}>
          图层
        </button>
        <button
          classList={{ active: tab() === 'props' }}
          onClick={() => setTab('props')}
          disabled={selected().length === 0}
        >
          属性{selected().length > 1 ? `(${selected().length})` : ''}
        </button>
        <button classList={{ active: tab() === 'regions' }} onClick={() => setTab('regions')}>
          区域
        </button>
      </nav>

      <Switch>
        <Match when={tab() === 'snap'}>
          <SnapPanel />
        </Match>
        <Match when={tab() === 'layers'}>
          <LayersPanel />
        </Match>
        <Match when={tab() === 'props'}>
          <PropsPanel objects={selected()} />
        </Match>
        <Match when={tab() === 'regions'}>
          <RegionsPanel />
        </Match>
      </Switch>
    </aside>
  );
}

function SnapPanel() {
  const snap = () => planner.snapSettings;
  return (
    <div class="tab-body">
      <label class="row toggle">
        <input
          type="checkbox"
          checked={snap().gridEnabled}
          onChange={(e) => planner.updateSnap({ gridEnabled: e.currentTarget.checked })}
        />
        <span>网格吸附</span>
      </label>
      <label class="row toggle">
        <input
          type="checkbox"
          checked={snap().objectEnabled}
          onChange={(e) => planner.updateSnap({ objectEnabled: e.currentTarget.checked })}
        />
        <span>物体间吸附（边缘/中心线对齐）</span>
      </label>
      <label class="row toggle">
        <input
          type="checkbox"
          checked={!planner.snapTemporarilyOff[0]()}
          onChange={(e) => planner.snapTemporarilyOff[1](!e.currentTarget.checked)}
        />
        <span>吸附总开关（Alt 临时关闭）</span>
      </label>

      <label class="row column">
        <span>
          网格间距：<b>{snap().gridSize.toFixed(2)}</b> m
        </span>
        <input
          type="range"
          min="0.25"
          max="5"
          step="0.25"
          value={snap().gridSize}
          onInput={(e) => planner.updateSnap({ gridSize: Number(e.currentTarget.value) })}
        />
      </label>

      <label class="row column">
        <span>
          吸附距离阈值：<b>{snap().threshold.toFixed(2)}</b> m
        </span>
        <input
          type="range"
          min="0.05"
          max="2"
          step="0.05"
          value={snap().threshold}
          onInput={(e) => planner.updateSnap({ threshold: Number(e.currentTarget.value) })}
        />
      </label>

      <div class="tips">
        <p>📌 拖动时显示蓝色（网格）/红色（物体）对齐辅助线</p>
        <p>📌 旋转时自动吸附 15° 角与相邻物体朝向</p>
        <p>📌 重叠或超出区域的放置会被阻止</p>
      </div>
    </div>
  );
}

function LayersPanel() {
  const counts = createMemo(() => {
    const m = new Map<string, { total: number; hidden: number }>();
    for (const o of planner.objects) {
      const cur = m.get(o.category) ?? { total: 0, hidden: 0 };
      cur.total += 1;
      if (!o.visible) cur.hidden += 1;
      m.set(o.category, cur);
    }
    return m;
  });

  return (
    <div class="tab-body">
      <For each={[...CATEGORIES]}>
        {(cat) => {
          const stat = () => counts().get(cat);
          return (
            <Show when={stat()}>
              <label class="row toggle layer-row">
                <input
                  type="checkbox"
                  checked={stat()!.hidden === 0}
                  onChange={(e) => planner.setCategoryVisible(cat, e.currentTarget.checked)}
                />
                <span class="layer-name">{cat}</span>
                <span class="layer-count">
                  {stat()!.total - stat()!.hidden}/{stat()!.total}
                </span>
              </label>
            </Show>
          );
        }}
      </For>
      <Show when={planner.objects.length === 0}>
        <p class="empty">暂无物体，先从左侧物体库摆放</p>
      </Show>
    </div>
  );
}

function PropsPanel(props: { objects: PlacedObject[] }) {
  const first = () => props.objects[0];
  const multi = () => props.objects.length > 1;

  const apply = (patch: Partial<PlacedObject>) => {
    if (multi()) {
      // 多选时仅支持旋转/缩放的批量相对操作
      for (const o of props.objects) planner.updateObject(o.id, patch);
    } else {
      planner.updateObject(first().id, patch);
    }
  };

  return (
    <Show when={first()} fallback={<p class="empty">未选择物体</p>}>
      <div class="tab-body">
        <h4>{multi() ? `已选 ${props.objects.length} 个物体` : first().name}</h4>
        <p class="hint">
          {first().category} · 预设 {first().width}×{first().depth}×{first().height}m
        </p>

        <label class="row column">
          <span>X 坐标：{first().x.toFixed(2)} m</span>
          <input
            type="number"
            step="0.1"
            value={first().x.toFixed(2)}
            disabled={multi()}
            onChange={(e) => apply({ x: Number(e.currentTarget.value) })}
          />
        </label>
        <label class="row column">
          <span>Z 坐标：{first().z.toFixed(2)} m</span>
          <input
            type="number"
            step="0.1"
            value={first().z.toFixed(2)}
            disabled={multi()}
            onChange={(e) => apply({ z: Number(e.currentTarget.value) })}
          />
        </label>
        <label class="row column">
          <span>旋转：{Math.round((first().rotation * 180) / Math.PI)}°</span>
          <input
            type="range"
            min="0"
            max={String(Math.PI * 2)}
            step={Math.PI / 24}
            value={first().rotation}
            onInput={(e) => apply({ rotation: Number(e.currentTarget.value) })}
          />
        </label>
        <label class="row column">
          <span>缩放倍率：{first().scale.toFixed(2)}</span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.05"
            value={first().scale}
            onInput={(e) => apply({ scale: Number(e.currentTarget.value) })}
          />
        </label>

        <div class="row">
          <button
            class="small"
            onClick={() => apply({ rotation: first().rotation + Math.PI / 2 })}
          >
            ↻ 旋转90°
          </button>
          <button class="small danger" onClick={() => planner.deleteSelected()}>
            🗑 删除
          </button>
        </div>
      </div>
    </Show>
  );
}

function RegionsPanel() {
  return (
    <div class="tab-body">
      <For each={planner.regions}>
        {(region, idx) => (
          <div class="region-card">
            <div class="region-head">
              <span class="dot" style={{ background: region.color }} />
              <strong>{region.name}</strong>
              <button
                class="icon-btn"
                title="删除区域"
                onClick={() => planner.removeRegion(region.id)}
              >
                ✕
              </button>
            </div>
            <Switch>
              <Match when={region.type === 'rect'}>
                <RectRegionEditor region={region as RectRegion} />
              </Match>
              <Match when={region.type === 'polygon'}>
                <p class="hint">{(region as PolygonRegion).points.length} 个顶点的多边形区域</p>
              </Match>
            </Switch>
            <span class="idx">#{idx() + 1}</span>
          </div>
        )}
      </For>
      <Show when={planner.regions.length === 0}>
        <p class="empty">还没有区域，使用顶部「矩形区域 / 多边形区域」绘制场地平面</p>
      </Show>
    </div>
  );
}

function RectRegionEditor(props: { region: RectRegion }) {
  const r = () => props.region;
  return (
    <>
      <label class="row column">
        <span>宽：{r().width.toFixed(2)} m</span>
        <input
          type="number"
          min="1"
          step="0.5"
          value={r().width}
          onChange={(e) =>
            planner.updateRegion(r().id, {
              width: Math.max(0.5, Number(e.currentTarget.value)),
            })
          }
        />
      </label>
      <label class="row column">
        <span>深：{r().depth.toFixed(2)} m</span>
        <input
          type="number"
          min="1"
          step="0.5"
          value={r().depth}
          onChange={(e) =>
            planner.updateRegion(r().id, {
              depth: Math.max(0.5, Number(e.currentTarget.value)),
            })
          }
        />
      </label>
      <label class="row column">
        <span>旋转：{Math.round((r().rotation * 180) / Math.PI)}°</span>
        <input
          type="range"
          min="0"
          max={String(Math.PI)}
          step={Math.PI / 36}
          value={r().rotation}
          onInput={(e) => planner.updateRegion(r().id, { rotation: Number(e.currentTarget.value) })}
        />
      </label>
    </>
  );
}
