<script lang="ts">
  import {
    docStore,
    setRodValue,
    beginRodDrag,
    endRodDrag,
    updateRodConfig,
    addRodBinding,
    updateRodRatio,
    removeRodBinding,
  } from '../stores/rig';

  let pickId = '';

  $: rod = $docStore.rod;
  $: bindable = $docStore.joints.filter((j) => !rod.bindings.some((b) => b.jointId === j.id));
  $: jointName = new Map($docStore.joints.map((j) => [j.id, j.name]));

  const AXIS_LABELS = ['X 比例', 'Y 比例', 'Z 比例'];

  function onSlider(e: Event): void {
    setRodValue(Number((e.target as HTMLInputElement).value));
  }
  function onMin(e: Event): void {
    updateRodConfig({ min: Number((e.target as HTMLInputElement).value) });
  }
  function onMax(e: Event): void {
    updateRodConfig({ max: Number((e.target as HTMLInputElement).value) });
  }
  function onRatio(e: Event, jointId: string, idx: number): void {
    updateRodRatio(jointId, idx as 0 | 1 | 2, Number((e.target as HTMLInputElement).value));
  }
  function addBinding(): void {
    if (pickId) {
      addRodBinding(pickId);
      pickId = '';
    }
  }
</script>

<div class="rod-panel">
  <h3 class="panel-title">牵引杆</h3>
  <p class="hint">拖动视口中的金色旋钮或下方滑杆，按比例同时驱动一组关节；超出范围的关节会被约束在边界并高亮。</p>

  <div class="slider-row">
    <span class="endpoint">{rod.min}</span>
    <input
      type="range"
      min={rod.min}
      max={rod.max}
      step="0.01"
      value={rod.value}
      on:pointerdown={beginRodDrag}
      on:pointerup={endRodDrag}
      on:change={onSlider}
      on:input={onSlider}
    />
    <span class="endpoint">{rod.max}</span>
    <strong class="value">{rod.value.toFixed(2)}</strong>
  </div>

  <div class="field">
    <label>行程下限
      <input type="number" value={rod.min} on:change={onMin} />
    </label>
  </div>
  <div class="field">
    <label>行程上限
      <input type="number" value={rod.max} on:change={onMax} />
    </label>
  </div>

  <h4 class="group">绑定关节与驱动比例（度 / 单位行程）</h4>
  <div class="bindings">
    {#each rod.bindings as b (b.jointId)}
      <div class="binding">
        <div class="binding-head">
          <strong>{jointName.get(b.jointId) ?? b.jointId}</strong>
          <button class="del" title="移除绑定" on:click={() => removeRodBinding(b.jointId)}>✕</button>
        </div>
        <div class="ratio-grid">
          {#each b.ratio as r, idx}
            <label>
              {AXIS_LABELS[idx]}
              <input
                type="number"
                step="1"
                value={r}
                on:change={(e) => onRatio(e, b.jointId, idx)}
              />
            </label>
          {/each}
        </div>
      </div>
    {/each}
    {#if rod.bindings.length === 0}
      <p class="hint">尚未绑定关节。</p>
    {/if}
  </div>

  <div class="add-binding">
    <select bind:value={pickId}>
      <option value="">选择关节…</option>
      {#each bindable as j (j.id)}
        <option value={j.id}>{j.name}</option>
      {/each}
    </select>
    <button disabled={!pickId} on:click={addBinding}>添加绑定</button>
  </div>
</div>

<style>
  .rod-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hint {
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.6;
    margin: 0 0 6px;
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .endpoint {
    color: var(--text-dim);
    font-size: 11px;
    width: 34px;
    text-align: center;
  }
  .value {
    width: 48px;
    text-align: right;
    color: var(--accent-warm);
  }
  .group {
    margin: 10px 0 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .bindings {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .binding {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
  }
  .binding-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  .del {
    padding: 1px 7px;
    color: #ff9a9a;
  }
  .ratio-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .ratio-grid label {
    font-size: 11px;
    color: var(--text-dim);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .add-binding {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .field label {
    display: contents;
  }
</style>
