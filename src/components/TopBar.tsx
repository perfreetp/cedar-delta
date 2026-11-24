import { projectStore } from '../state/projectStore';

export default function TopBar() {
  const canUndo = () => projectStore.canUndo();
  const canRedo = () => projectStore.canRedo();

  return (
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">激</div>
        <div>
          <div class="brand-title">激流赛道障碍布置工作室</div>
          <div class="brand-sub">SolidJS · Three.js · Manifold 布尔碰撞</div>
        </div>
      </div>

      <input
        class="project-name-input"
        value={projectStore.doc.name}
        aria-label="方案名称"
        onInput={(event) => projectStore.setProjectName(event.currentTarget.value)}
      />

      <div class="topbar-spacer" />
      <div class="top-actions">
        <button class="btn ghost" onClick={projectStore.undo} disabled={!canUndo()} title="撤销 Ctrl/⌘ + Z">
          ↶ <span class="label">撤销</span>
        </button>
        <button
          class="btn ghost"
          onClick={projectStore.redo}
          disabled={!canRedo()}
          title="重做 Ctrl/⌘ + Shift + Z"
        >
          ↷ <span class="label">重做</span>
        </button>
        <button
          class="btn ghost"
          onClick={() => {
            if (window.confirm('确定恢复为内置示例赛道吗？当前未导出的布置会进入撤销记录。')) projectStore.resetWorkspace();
          }}
        >
          示例
        </button>
        <button class="btn primary" onClick={() => projectStore.setActiveModule('export')}>
          ↥ <span class="label">导出方案</span>
        </button>
      </div>
    </header>
  );
}
