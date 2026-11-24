<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    docStore,
    isPlaying,
    isRecording,
    currentTime,
    addKeyframe,
    deleteKeyframe,
    applyPlaybackTime,
    recordSample,
    endRecording,
    setDuration,
    clearAllKeyframes,
  } from '../stores/rig';
  import { sortedKeyframes } from '../lib/animation';

  let raf = 0;
  let lastTs = 0;
  let recordAccum = 0;
  const RECORD_INTERVAL = 0.1; // 录制采样间隔（秒）

  $: duration = $docStore.duration;
  $: keyframes = sortedKeyframes($docStore);

  function tick(ts: number) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    if ($isRecording) {
      let t = $currentTime + dt;
      if (t >= duration) {
        t = duration;
        currentTime.set(t);
        recordSample(t);
        stopRecording();
        return;
      }
      currentTime.set(t);
      recordAccum += dt;
      if (recordAccum >= RECORD_INTERVAL) {
        recordAccum = 0;
        recordSample(t);
      }
    } else if ($isPlaying) {
      let t = $currentTime + dt;
      if (t >= duration) {
        t = duration;
        applyPlaybackTime(t);
        currentTime.set(t);
        isPlaying.set(false);
        return;
      }
      currentTime.set(t);
      applyPlaybackTime(t); // 回放同样经过约束钳制，触界关节高亮
    }
    raf = requestAnimationFrame(tick);
  }

  function ensureLoop() {
    if (!raf) {
      lastTs = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  function play() {
    if ($isRecording) return;
    if ($currentTime >= duration - 1e-4) currentTime.set(0);
    isPlaying.set(true);
    ensureLoop();
  }

  function pause() {
    isPlaying.set(false);
  }

  function stop() {
    isPlaying.set(false);
    currentTime.set(0);
    applyPlaybackTime(0);
  }

  function toggleRecord() {
    if ($isRecording) {
      stopRecording();
    } else {
      isPlaying.set(false);
      isRecording.set(true);
      recordAccum = RECORD_INTERVAL; // 立刻打第一帧
      ensureLoop();
    }
  }

  function stopRecording() {
    if (!$isRecording) return;
    isRecording.set(false);
    endRecording(); // 提交整段录制为一条撤销记录
  }

  function scrub(e: Event) {
    const t = Number((e.target as HTMLInputElement).value);
    currentTime.set(t);
    if (!$isRecording) applyPlaybackTime(t);
  }

  function onDuration(e: Event) {
    setDuration(Number((e.target as HTMLInputElement).value));
  }

  function kfPercent(time: number): string {
    return `${(time / duration) * 100}%`;
  }

  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    if ($isRecording) endRecording();
  });
</script>

<div class="timeline">
  <div class="controls">
    <button class="primary" on:click={$isPlaying ? pause : play} title="播放/暂停">
      {$isPlaying ? '⏸ 暂停' : '▶ 播放'}
    </button>
    <button on:click={stop} title="回到开头">⏹</button>
    <button class="record" class:recording={$isRecording} on:click={toggleRecord} title="录制（在视口中操作关节，自动采样关键帧）">
      {$isRecording ? '● 停止录制' : '● 录制'}
    </button>
    <button on:click={addKeyframe} title="在当前时间写入关键帧">＋ 关键帧</button>
    <button class="danger" on:click={clearAllKeyframes} disabled={keyframes.length === 0}>清空动作</button>
    <span class="time">
      {$currentTime.toFixed(2)}s / {duration.toFixed(1)}s
      {#if $isRecording}<span class="rec-badge">REC</span>{/if}
    </span>
    <label class="duration-field">
      时长
      <input
        type="number"
        min="0.5"
        step="0.5"
        value={duration}
        on:change={onDuration}
      />
    </label>
  </div>

  <div class="track">
    <input
      type="range"
      min="0"
      max={duration}
      step="0.01"
      value={$currentTime}
      on:input={scrub}
      on:change={scrub}
    />
    <div class="ticks">
      {#each keyframes as kf (kf.id)}
        <button
          class="kf"
          style="left: {kfPercent(kf.time)}"
          title={`关键帧 ${kf.time.toFixed(2)}s（点击删除）`}
          on:click={() => deleteKeyframe(kf.id)}
        >◆</button>
      {/each}
    </div>
  </div>
</div>

<style>
  .timeline {
    background: var(--panel);
    border-top: 1px solid var(--border);
    padding: 8px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .time {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .rec-badge {
    color: #fff;
    background: var(--danger);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    animation: blink 1s infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.35;
    }
  }
  .record {
    color: #ff8f8f;
  }
  .record.recording {
    background: var(--danger);
    color: #fff;
    border-color: var(--danger);
  }
  .duration-field {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
  }
  .duration-field input {
    width: 70px;
  }
  .track {
    position: relative;
    padding-bottom: 14px;
  }
  .ticks {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% - 14px);
    height: 14px;
    pointer-events: none;
  }
  .kf {
    position: absolute;
    transform: translateX(-50%);
    padding: 0;
    background: none;
    border: none;
    color: var(--accent-warm);
    font-size: 12px;
    cursor: pointer;
    pointer-events: auto;
    line-height: 1;
  }
  .kf:hover {
    color: var(--danger);
  }
</style>
