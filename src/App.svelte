<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import Viewport from './components/Viewport.svelte';
  import HierarchyPanel from './components/HierarchyPanel.svelte';
  import InspectorPanel from './components/InspectorPanel.svelte';
  import RodPanel from './components/RodPanel.svelte';
  import Timeline from './components/Timeline.svelte';
  import { mode, clampedIds } from './stores/rig';
</script>

<div class="app">
  <Toolbar />

  <div class="workspace">
    <aside class="side left">
      <HierarchyPanel />
    </aside>

    <main class="center">
      <Viewport />
      <div class="legend">
        <span><i class="sw normal"></i>普通关节</span>
        <span><i class="sw root"></i>根关节</span>
        <span><i class="sw selected"></i>选中</span>
        <span><i class="sw clamped"></i>约束触界</span>
        <span class="hint-text">
          {$mode === 'edit'
            ? '拖动球体调整关节位置（骨骼长度随之变化）；空白处拖动旋转视角，滚轮缩放。'
            : '拖动任意关节球做 IK 末端驱动；右侧金色牵引杆按比例驱动绑定关节。'}
        </span>
        {#if $clampedIds.size > 0}
          <span class="clamp-count">触界关节：{$clampedIds.size}</span>
        {/if}
      </div>
    </main>

    <aside class="side right">
      <InspectorPanel />
      {#if $mode === 'animate'}
        <div class="divider"></div>
        <RodPanel />
      {/if}
    </aside>
  </div>

  {#if $mode === 'animate'}
    <Timeline />
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 260px 1fr 300px;
  }
  .side {
    background: var(--panel);
    padding: 12px;
    overflow-y: auto;
  }
  .side.left {
    border-right: 1px solid var(--border);
  }
  .side.right {
    border-left: 1px solid var(--border);
  }
  .center {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .legend {
    position: absolute;
    left: 12px;
    bottom: 12px;
    background: rgba(20, 23, 31, 0.82);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 11px;
    color: var(--text-dim);
    flex-wrap: wrap;
    max-width: calc(100% - 24px);
    pointer-events: none;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }
  .sw.normal {
    background: #5b8def;
  }
  .sw.root {
    background: #8a7cff;
  }
  .sw.selected {
    background: #ffc857;
  }
  .sw.clamped {
    background: #ff4d4d;
  }
  .hint-text {
    color: var(--text-dim);
  }
  .clamp-count {
    color: #ff9a9a;
    font-weight: 600;
  }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 14px 0;
  }
</style>
