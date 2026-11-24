<script lang="ts">
  import {
    mode,
    switchMode,
    undo,
    redo,
    canUndo,
    canRedo,
    getDocument,
    loadDocument,
  } from '../stores/rig';
  import { exportDocument, importDocument } from '../lib/io';

  let fileInput: HTMLInputElement;
  let errorMsg = '';

  function onExport() {
    exportDocument(getDocument());
  }

  async function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const doc = await importDocument(file);
      loadDocument(doc);
      errorMsg = '';
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '导入失败';
    } finally {
      input.value = '';
    }
  }

  function onKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<header class="toolbar">
  <div class="brand">
    <span class="logo">🎭</span>
    <strong>机关木偶骨架绑定工具</strong>
  </div>

  <div class="mode-switch">
    <button class:active={$mode === 'edit'} on:click={() => switchMode('edit')}>骨架编辑</button>
    <button class:active={$mode === 'animate'} on:click={() => switchMode('animate')}>动作动画</button>
  </div>

  <div class="spacer"></div>

  <div class="history-btns">
    <button title="撤销 (Ctrl+Z)" disabled={!$canUndo} on:click={undo}>↶ 撤销</button>
    <button title="重做 (Ctrl+Shift+Z)" disabled={!$canRedo} on:click={redo}>↷ 重做</button>
  </div>

  <button on:click={() => fileInput.click()}>📂 导入</button>
  <button class="primary" on:click={onExport}>💾 导出</button>
  <input
    bind:this={fileInput}
    type="file"
    accept=".json,application/json"
    style="display:none"
    on:change={onImportFile}
  />
</header>

{#if errorMsg}
  <div class="error-bar" role="alert">
    导入失败：{errorMsg}
    <button on:click={() => (errorMsg = '')}>✕</button>
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .logo {
    font-size: 18px;
  }
  .mode-switch {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .mode-switch button {
    border: none;
    border-radius: 0;
  }
  .mode-switch button.active {
    background: var(--accent);
    color: #fff;
  }
  .spacer {
    flex: 1;
  }
  .history-btns {
    display: flex;
    gap: 6px;
  }
  .error-bar {
    background: #3a2128;
    border-bottom: 1px solid #7a3535;
    color: #ffc4c4;
    padding: 6px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .error-bar button {
    padding: 1px 8px;
  }
</style>
