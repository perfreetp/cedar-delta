<script lang="ts">
  import type { Joint } from '../types';
  import { docStore, selectedJointId, addChildJoint } from '../stores/rig';
  import TreeNode from './TreeNode.svelte';

  function buildTree(joints: Joint[]): Map<string | null, Joint[]> {
    const map = new Map<string | null, Joint[]>();
    for (const j of joints) {
      const key = j.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(j);
    }
    return map;
  }

  $: tree = buildTree($docStore.joints);
  $: roots = tree.get(null) ?? [];
</script>

<div class="panel-section">
  <h3 class="panel-title">骨架层级（{$docStore.joints.length} 个关节）</h3>
  <div class="tree">
    {#each roots as root (root.id)}
      <TreeNode joint={root} {tree} depth={0} />
    {/each}
  </div>
  <button class="add-root" on:click={() => addChildJoint(null)}>＋ 新增根关节</button>
  <p class="hint">删除关节时，其子关节会自动挂接到上一级。</p>
</div>

<style>
  .panel-section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tree {
    overflow-y: auto;
    flex: 1;
    min-height: 60px;
  }
  .add-root {
    margin-top: 8px;
    width: 100%;
  }
  .hint {
    color: var(--text-dim);
    font-size: 11px;
    margin: 8px 0 0;
    line-height: 1.5;
  }
</style>
