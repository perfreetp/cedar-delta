<script lang="ts">
  import {
    selectedJoint,
    mode,
    updateJointLimits,
    updateJointRadius,
    livePose,
    setJointAngle,
    clampedIds,
  } from '../stores/rig';
  import type { AngleLimit, Joint } from '../types';

  const AXES: { key: 'x' | 'y' | 'z'; label: string }[] = [
    { key: 'x', label: 'X 轴' },
    { key: 'y', label: 'Y 轴' },
    { key: 'z', label: 'Z 轴' },
  ];
  const AXIS_NAMES = ['X', 'Y', 'Z'];

  function num(v: number): number {
    return Number.isFinite(v) ? v : 0;
  }

  function getLimit(j: Joint, key: 'x' | 'y' | 'z'): AngleLimit {
    return j.limits[key];
  }

  function toggleLimit(e: Event, j: Joint, key: 'x' | 'y' | 'z'): void {
    updateJointLimits(j.id, key, { enabled: (e.target as HTMLInputElement).checked });
  }
  function changeMin(e: Event, j: Joint, key: 'x' | 'y' | 'z'): void {
    updateJointLimits(j.id, key, { min: Number((e.target as HTMLInputElement).value) });
  }
  function changeMax(e: Event, j: Joint, key: 'x' | 'y' | 'z'): void {
    updateJointLimits(j.id, key, { max: Number((e.target as HTMLInputElement).value) });
  }
  function changeRadius(e: Event, j: Joint): void {
    updateJointRadius(j.id, Math.max(0.02, Number((e.target as HTMLInputElement).value)));
  }
  function changeAngle(e: Event, j: Joint, idx: number): void {
    setJointAngle(j.id, idx as 0 | 1 | 2, Number((e.target as HTMLInputElement).value));
  }
  function angleAt(j: Joint, idx: number): number {
    const a = $livePose[j.id] ?? [0, 0, 0];
    return Math.round(a[idx] * 10) / 10;
  }
</script>

<div class="inspector">
  {#if !$selectedJoint}
    <p class="empty">在视口或左侧层级中选择一个关节，以编辑其活动范围。</p>
  {:else}
    {@const j = $selectedJoint}
    <div class="header">
      <span class="name">{j.name}</span>
      {#if $clampedIds.has(j.id)}
        <span class="tag clamp-tag">已触界</span>
      {/if}
    </div>
    <div class="meta">
      <span class="tag">ID: {j.id.slice(0, 14)}</span>
      {#if j.parentId === null}<span class="tag">根关节</span>{/if}
    </div>

    <h4 class="group">关节活动角度范围（度）</h4>
    {#each AXES as axis}
      {@const lim = getLimit(j, axis.key)}
      <div class="axis-block">
        <label class="axis-head">
          <input type="checkbox" checked={lim.enabled} on:change={(e) => toggleLimit(e, j, axis.key)} />
          <strong>{axis.label}</strong>
          {#if !lim.enabled}<span class="tag">不受限</span>{/if}
        </label>
        <div class="range-row" class:disabled={!lim.enabled}>
          <div class="range-cell">
            <label>下限
              <input
                type="number"
                value={num(lim.min)}
                disabled={!lim.enabled}
                on:change={(e) => changeMin(e, j, axis.key)}
              />
            </label>
          </div>
          <div class="range-cell">
            <label>上限
              <input
                type="number"
                value={num(lim.max)}
                disabled={!lim.enabled}
                on:change={(e) => changeMax(e, j, axis.key)}
              />
            </label>
          </div>
        </div>
      </div>
    {/each}

    <h4 class="group">显示</h4>
    <div class="field">
      <label>球体半径
        <input
          type="number"
          step="0.01"
          min="0.02"
          max="0.5"
          value={j.radius}
          on:change={(e) => changeRadius(e, j)}
        />
      </label>
    </div>

    {#if $mode === 'animate'}
      <h4 class="group">当前姿态（度，自动钳制）</h4>
      {#each [0, 1, 2] as idx}
        <div class="field">
          <label>{AXIS_NAMES[idx]} 角度
            <input type="number" value={angleAt(j, idx)} on:change={(e) => changeAngle(e, j, idx)} />
          </label>
        </div>
      {/each}
    {/if}

    <p class="note">修改约束后，已录制的动作会自动按新约束重算，关键帧保留。</p>
  {/if}
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty {
    color: var(--text-dim);
    line-height: 1.7;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    font-size: 15px;
    font-weight: 600;
  }
  .clamp-tag {
    color: #ffb0b0;
    border-color: #7a3535;
    background: rgba(255, 77, 77, 0.12);
  }
  .meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .group {
    margin: 10px 0 4px;
    font-size: 12px;
    color: var(--text-dim);
    letter-spacing: 0.06em;
  }
  .axis-block {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
  }
  .axis-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .range-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .range-row.disabled {
    opacity: 0.45;
  }
  .range-cell label {
    display: flex;
    flex-direction: column;
    font-size: 11px;
    color: var(--text-dim);
    gap: 3px;
  }
  .field label {
    display: contents;
    color: var(--text-dim);
  }
  .note {
    font-size: 11px;
    color: var(--text-dim);
    line-height: 1.6;
    margin: 8px 0 0;
  }
</style>
