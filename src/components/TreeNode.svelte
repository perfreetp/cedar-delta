<script lang="ts">
  import type { Joint } from '../types';
  import { selectedJointId, addChildJoint, deleteJoint, renameJointById } from '../stores/rig';

  export let joint: Joint;
  export let tree: Map<string | null, Joint[]>;
  export let depth = 0;

  function onRenameInput(e: Event): void {
    renameJointById(joint.id, (e.target as HTMLInputElement).value);
  }
  $: children = tree.get(joint.id) ?? [];
</script>

<div
  class="node"
  class:selected={$selectedJointId === joint.id}
  class:root-node={joint.parentId === null}
  style="padding-left: {8 + depth * 14}px"
  role="button"
  tabindex="0"
  on:click={() => selectedJointId.set(joint.id)}
  on:keydown={(e) => e.key === 'Enter' && selectedJointId.set(joint.id)}
>
  <span class="dot" class:root={joint.parentId === null}></span>
  <input
    class="name-input"
    value={joint.name}
    title="重命名关节"
    on:change={onRenameInput}
    on:click|stopPropagation
  />
  <span class="actions">
    <button title="新增子关节" on:click|stopPropagation={() => addChildJoint(joint.id)}>＋</button>
    {#if joint.parentId !== null}
      <button
        class="del"
        title="删除关节（子关节自动重新挂接）"
        on:click|stopPropagation={() => deleteJoint(joint.id)}
      >
        ✕
      </button>
    {/if}
  </span>
</div>

{#each children as child (child.id)}
  <svelte:self joint={child} {tree} depth={depth + 1} />
{/each}

<style>
  .node {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;
  }
  .node:hover {
    background: rgba(91, 141, 239, 0.12);
  }
  .node.selected {
    background: rgba(255, 200, 87, 0.16);
    outline: 1px solid rgba(255, 200, 87, 0.45);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .dot.root {
    background: var(--accent-warm);
  }
  .name-input {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    background: transparent;
    border: 1px solid transparent;
  }
  .name-input:hover {
    border-color: var(--border);
  }
  .actions {
    display: flex;
    gap: 3px;
    flex: none;
  }
  .actions button {
    padding: 1px 6px;
    font-size: 12px;
  }
  .actions .del {
    color: #ff9a9a;
  }
</style>
