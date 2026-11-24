import { createEffect, For, Match, Switch, onCleanup, onMount } from 'solid-js';
import CollisionPanel from './components/CollisionPanel';
import ExportPanel from './components/ExportPanel';
import LibraryPanel from './components/LibraryPanel';
import TopBar from './components/TopBar';
import TransformPanel from './components/TransformPanel';
import Viewport from './components/Viewport';
import { MODULE_META } from './types';
import { projectStore } from './state/projectStore';

export default function App() {
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const inputType = tag === 'INPUT' ? (target as HTMLInputElement).type : '';
      const textualEditing = Boolean(
        target &&
          (tag === 'TEXTAREA' ||
            target.isContentEditable ||
            (tag === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(inputType))),
      );
      const anyFormControl = Boolean(
        target && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable),
      );

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        if (textualEditing) return;
        event.preventDefault();
        if (event.shiftKey) projectStore.redo();
        else projectStore.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        if (textualEditing) return;
        event.preventDefault();
        projectStore.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        if (anyFormControl) return;
        event.preventDefault();
        projectStore.duplicateSelected();
        return;
      }
      if (!anyFormControl && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        projectStore.deleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  createEffect(() => {
    const ids = projectStore.selectedIds();
    const alive = new Set(projectStore.doc.obstacles.map((o) => o.id));
    if (ids.some((id) => !alive.has(id))) projectStore.setSelectedIds(ids.filter((id) => alive.has(id)));
  });

  const activeMeta = () => MODULE_META.find((m) => m.key === projectStore.activeModule())!;
  const riskCount = () => {
    const report = projectStore.collisionReport();
    const d = projectStore.doc.detection;
    const lane = Object.values(report.laneVolumes).filter((v) => v > d.laneThreshold).length;
    const pair = report.pairs.filter((p) => p.volume > d.pairThreshold).length;
    const reef = projectStore.doc.obstacles.filter((o) => o.exposure <= d.reefThreshold).length;
    return lane + pair + reef;
  };

  return (
    <div class="app-shell">
      <TopBar />

      <div class="workspace">
        <nav class="module-rail" aria-label="四个功能模块">
          <For each={MODULE_META}>
            {(meta) => (
              <button
                class={`rail-button ${projectStore.activeModule() === meta.key ? 'active' : ''}`}
                onClick={() => projectStore.setActiveModule(meta.key)}
                title={meta.title}
              >
                <span class="rail-index">{meta.index}</span>
                <span class="rail-icon">{meta.icon}</span>
                <span class="rail-label">{meta.title}</span>
              </button>
            )}
          </For>
        </nav>

        <aside class="module-panel">
          <header class="panel-header">
            <div class="panel-eyebrow">MODULE {activeMeta().index}</div>
            <h1 class="panel-title">{activeMeta().title}</h1>
            <p class="panel-subtitle">{activeMeta().subtitle}</p>
          </header>
          <div class="panel-body">
            <Switch>
              <Match when={projectStore.activeModule() === 'library'}>
                <LibraryPanel />
              </Match>
              <Match when={projectStore.activeModule() === 'transform'}>
                <TransformPanel />
              </Match>
              <Match when={projectStore.activeModule() === 'collision'}>
                <CollisionPanel />
              </Match>
              <Match when={projectStore.activeModule() === 'export'}>
                <ExportPanel />
              </Match>
            </Switch>
          </div>
        </aside>

        <Viewport />
      </div>

      <footer class="statusbar">
        <span>障碍 {projectStore.doc.obstacles.length}</span>
        <span>分组 {projectStore.doc.groups.length}</span>
        <span>选中 {projectStore.selectedIds().length}</span>
        <span style={{ color: riskCount() ? '#fda4af' : '#6ee7b7' }}>
          {riskCount() ? `风险标记 ${riskCount()}` : '无超阈值风险'}
        </span>
        <span class="spacer" />
        <span>撤销历史 {projectStore.canUndo() ? '可用' : '栈底'} / {projectStore.canRedo() ? '可重做' : '无重做'}</span>
        <span>自动保存于本会话内存 · 导出 JSON 可持久分享</span>
      </footer>

      <div class="toast-stack">
        {projectStore.toast() && <div class={`toast ${projectStore.toast()!.tone}`}>{projectStore.toast()!.text}</div>}
      </div>
    </div>
  );
}
