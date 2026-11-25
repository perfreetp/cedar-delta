import { createSignal, Show } from 'solid-js';
import { generateDataset } from './data/generate';
import { createAppStore, type ViewId } from './core/store';
import { defaultViewState, loadViewState, sanitizeState } from './core/persist';
import type { ViewState } from './types';
import { MapView, type MapApi } from './ui/MapView';
import { LayerPanel } from './ui/LayerPanel';
import { LodPanel } from './ui/LodPanel';
import { Toolbar } from './ui/Toolbar';
import { Inspector } from './ui/Inspector';
import { StatsChart } from './ui/StatsChart';

export function App() {
  const ds = generateDataset();
  const restored = loadViewState();
  const store = createAppStore(ds, restored ?? defaultViewState());
  // 只有「没有可恢复状态」时才自动取景,否则刷新会把用户调好的缩放冲掉
  const autoFit = restored === null;

  const [apis, setApis] = createSignal<Partial<Record<ViewId, MapApi>>>({});
  // 验收脚本需要驱动相机、读取数据规模;这里只挂一个只读引用,不参与任何业务逻辑
  const testHooks = window as unknown as {
    __evacMaps?: () => Partial<Record<ViewId, MapApi>>;
    __evacStore?: unknown;
  };
  testHooks.__evacMaps = apis;
  testHooks.__evacStore = store;
  const [tab, setTab] = createSignal<'layers' | 'tiers'>('layers');
  const [toastMsg, setToastMsg] = createSignal('');

  function toast(msg: string) {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((v) => (v === msg ? '' : v)), 2400);
  }

  /** 应用一份完整状态(载入预设/导入/重置) */
  function applyState(next: ViewState) {
    const clean = sanitizeState(next);
    store.commit(clean);
    // 相机由 store 更新后,让两视图重绘(createMemo 已监听 cameras)
    toast('方案已应用');
  }

  return (
    <div class="app">
      <TopBar
        store={store}
        apis={apis}
        onApplyState={applyState}
        onToast={toast}
      />

      <div class="app__body">
        <aside class="app__side app__side--left">
          <div class="tabs">
            <button
              class="tab"
              classList={{ 'tab--active': tab() === 'layers' }}
              onClick={() => setTab('layers')}
            >
              图层
            </button>
            <button
              class="tab"
              classList={{ 'tab--active': tab() === 'tiers' }}
              onClick={() => setTab('tiers')}
            >
              缩放档位
            </button>
          </div>
          <div class="app__side-scroll">
            <Show when={tab() === 'layers'} fallback={<LodPanel store={store} />}>
              <LayerPanel store={store} />
              <StatsChart store={store} apis={apis} />
            </Show>
          </div>
        </aside>

        <main class="app__main">
          <MapView
            store={store}
            viewId="overview"
            title="总览"
            subtitle="园区全局 · 区域轮廓与汇总点"
            register={(api) => setApis((p) => ({ ...p, overview: api }))}
            autoFit={autoFit}
          />
          <MapView
            store={store}
            viewId="floor"
            title="楼层"
            subtitle="楼栋 / 楼层细节 · 出口与每段路径"
            register={(api) => setApis((p) => ({ ...p, floor: api }))}
            autoFit={autoFit}
          />
        </main>

        <aside class="app__side app__side--right">
          <Inspector store={store} />
          <StatusPanel store={store} apis={apis} />
        </aside>
      </div>

      <Show when={toastMsg()}>
        <div class="toast toast--app">{toastMsg()}</div>
      </Show>
    </div>
  );
}

function TopBar(props: {
  store: ReturnType<typeof createAppStore>;
  apis: () => Partial<Record<ViewId, MapApi>>;
  onApplyState: (s: ViewState) => void;
  onToast: (m: string) => void;
}) {
  return <Toolbar store={props.store} apis={props.apis} onApplyState={props.onApplyState} />;
}

function StatusPanel(props: {
  store: ReturnType<typeof createAppStore>;
  apis: () => Partial<Record<ViewId, MapApi>>;
}) {
  return (
    <div class="panel">
      <div class="panel__head">
        <h3>状态</h3>
      </div>
      <dl class="kv kv--compact">
        <dt>要素总量</dt>
        <dd class="mono">
          {(
            props.store.ds.point.count +
            props.store.ds.path.count +
            props.store.ds.area.count +
            props.store.ds.exit.count +
            props.store.ds.stair.count +
            props.store.ds.assembly.count +
            props.store.ds.hazard.count
          ).toLocaleString()}
        </dd>
        <dt>楼层数</dt>
        <dd class="mono">{props.store.ds.floors.length}</dd>
        <dt>总览档位</dt>
        <dd>{props.apis().overview?.stats().tier ?? '—'}</dd>
        <dt>楼层档位</dt>
        <dd>{props.apis().floor?.stats().tier ?? '—'}</dd>
        <dt>总览绘制</dt>
        <dd class="mono">{props.apis().overview?.stats().drawing.toLocaleString() ?? '—'}</dd>
        <dt>楼层绘制</dt>
        <dd class="mono">{props.apis().floor?.stats().drawing.toLocaleString() ?? '—'}</dd>
      </dl>
      <p class="panel__note">
        方案状态(两个视图的缩放/平移/旋转、图层顺序与开关、档位配置)会自动保存到本机,下次打开自动还原。
      </p>
    </div>
  );
}
