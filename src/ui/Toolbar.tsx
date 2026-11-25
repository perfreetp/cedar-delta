import { For, Show, createSignal } from 'solid-js';
import type { AppStore } from '../core/store';
import {
  exportState,
  importState,
  loadPresets,
  savePresets,
  type Preset,
} from '../core/persist';
import { defaultTiers } from '../core/lod';
import type { MapApi } from './MapView';
import type { ViewId } from '../core/store';

export function Toolbar(props: {
  store: AppStore;
  apis: () => Partial<Record<ViewId, MapApi>>;
  onApplyState: (s: ReturnType<AppStore['snapshot']>) => void;
}) {
  const { store } = props;
  const [presets, setPresets] = createSignal<Preset[]>(loadPresets());
  const [presetName, setPresetName] = createSignal('');
  const [showImport, setShowImport] = createSignal(false);
  const [importText, setImportText] = createSignal('');
  const [flash, setFlash] = createSignal('');

  function toast(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash((v) => (v === msg ? '' : v)), 2200);
  }

  function savePreset() {
    const name = presetName().trim() || `方案 ${presets().length + 1}`;
    const p: Preset = {
      id: `p${Date.now().toString(36)}`,
      name,
      savedAt: Date.now(),
      state: store.snapshot(),
    };
    const next = [p, ...presets()].slice(0, 20);
    setPresets(next);
    savePresets(next);
    setPresetName('');
    toast(`已保存预设「${name}」`);
  }

  function applyPreset(p: Preset) {
    props.onApplyState(p.state);
    toast(`已载入「${p.name}」`);
  }

  function removePreset(id: string) {
    const next = presets().filter((p) => p.id !== id);
    setPresets(next);
    savePresets(next);
  }

  function doExport() {
    const text = exportState(store.snapshot());
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `疏散方案-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出当前方案');
  }

  function doImport() {
    const s = importState(importText());
    if (!s) {
      toast('导入失败:JSON 格式不正确');
      return;
    }
    props.onApplyState(s);
    setShowImport(false);
    setImportText('');
    toast('已导入方案');
  }

  return (
    <div class="toolbar">
      <div class="toolbar__group">
        <button
          class="btn"
          classList={{ 'btn--active': !store.boxMode() }}
          onClick={() => store.setBoxMode(false)}
          title="左键拖动平移"
        >
          平移
        </button>
        <button
          class="btn"
          classList={{ 'btn--active': store.boxMode() }}
          onClick={() => store.setBoxMode(true)}
          title="拖框多选(也可随时按住 Shift 拖框)"
        >
          框选
        </button>
      </div>

      <div class="toolbar__group">
        <button
          class="btn"
          classList={{ 'btn--active': store.follow() }}
          onClick={() => store.setFollow(!store.follow())}
          title="选中要素后,另一视图自动定位过去"
        >
          {store.follow() ? '跟随联动 · 开' : '跟随联动 · 关'}
        </button>
      </div>

      <div class="toolbar__group">
        <button class="btn btn--ghost" onClick={() => props.apis().overview?.fitAll()}>总览适配</button>
        <button class="btn btn--ghost" onClick={() => props.apis().floor?.fitAll()}>楼层适配</button>
        <button class="btn btn--ghost" onClick={() => { props.apis().overview?.resetRotation(); props.apis().floor?.resetRotation(); }}>
          复位角度
        </button>
      </div>

      <div class="toolbar__spacer" />

      <div class="toolbar__group toolbar__group--save">
        <input
          class="input input--sm"
          placeholder="预设名称"
          value={presetName()}
          onInput={(e) => setPresetName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && savePreset()}
        />
        <button class="btn btn--primary" onClick={savePreset}>保存方案</button>
        <Show when={presets().length > 0}>
          <select
            class="input input--sm"
            onChange={(e) => {
              const p = presets().find((x) => x.id === e.currentTarget.value);
              if (p) applyPreset(p);
              e.currentTarget.value = '';
            }}
          >
            <option value="">载入预设…</option>
            <For each={presets()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </select>
        </Show>
        <button class="btn btn--ghost" onClick={doExport} title="导出为 JSON 文件">导出</button>
        <button class="btn btn--ghost" onClick={() => setShowImport(true)} title="从 JSON 导入">导入</button>
      </div>

      <Show when={showImport()}>
        <div class="modal-backdrop" onClick={() => setShowImport(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <h3>导入方案</h3>
            <p class="panel__hint">粘贴导出的 JSON 内容。</p>
            <textarea
              class="input input--area"
              rows={10}
              value={importText()}
              onInput={(e) => setImportText(e.currentTarget.value)}
            />
            <div class="modal__actions">
              <button class="btn btn--ghost" onClick={() => setShowImport(false)}>取消</button>
              <button class="btn btn--primary" onClick={doImport}>导入</button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={presets().length > 0}>
        <div class="toolbar__presets">
          <For each={presets()}>
            {(p) => (
              <span class="preset-chip">
                <button class="preset-chip__load" onClick={() => applyPreset(p)}>{p.name}</button>
                <button class="preset-chip__del" onClick={() => removePreset(p.id)} title="删除">×</button>
              </span>
            )}
          </For>
        </div>
      </Show>

      <Show when={flash()}>
        <div class="toast">{flash()}</div>
      </Show>
    </div>
  );
}

export { defaultTiers };
