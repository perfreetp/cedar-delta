<script setup lang="ts">
import { ref } from 'vue'
import type { DistributionMode } from '../types'

defineProps<{
  mode: DistributionMode
  jitterRange: number
}>()

const emit = defineEmits<{
  (e: 'update:mode', mode: DistributionMode): void
  (e: 'update:jitterRange', value: number): void
  (e: 'gesture-start'): void
  (e: 'gesture-end', label: string): void
  (e: 'export'): void
  (e: 'import-file', file: File): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('import-file', file)
  input.value = ''
}

function onRangeKeydown(event: KeyboardEvent): void {
  if (event.key.startsWith('Arrow')) emit('gesture-start')
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M8 31C8 16.5 13.4 7 20 7s12 9.5 12 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M8 31h5M27 31h5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="20" cy="8.5" r="2.6" fill="#e35d83"/>
          <circle cx="12.5" cy="18" r="2.1" fill="#f0a6bb"/>
          <circle cx="27.5" cy="18" r="2.1" fill="#f0a6bb"/>
        </svg>
      </div>
      <div class="brand-text">
        <h1>花门骨架造型器</h1>
        <p>Arch Atelier · Curve &amp; Bloom Path Studio</p>
      </div>
    </div>

    <div class="distribution-control" role="group" aria-label="分布模式">
      <div class="segmented">
        <button
          type="button"
          :class="{ active: mode === 'uniform' }"
          @click="emit('update:mode', 'uniform')"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14M5 6v8M10 5v10M15 6v8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          沿路径均匀
        </button>
        <button
          type="button"
          :class="{ active: mode === 'jitter' }"
          @click="emit('update:mode', 'jitter')"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10c2.2-5 3.8 5 6 0s3.8 5 8 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>
          随机抖动
        </button>
      </div>

      <label class="jitter-control" :class="{ disabled: mode !== 'jitter' }">
        <span>抖动范围</span>
        <input
          type="range"
          min="0"
          max="0.8"
          step="0.02"
          :value="jitterRange"
          :disabled="mode !== 'jitter'"
          :style="{ '--range-fill': `${(jitterRange / 0.8) * 100}%` }"
          @pointerdown="emit('gesture-start')"
          @keydown="onRangeKeydown"
          @input="emit('update:jitterRange', Number(($event.target as HTMLInputElement).value))"
          @change="emit('gesture-end', '调整随机抖动范围')"
        />
        <output>{{ jitterRange.toFixed(2) }} m</output>
      </label>
    </div>

    <div class="top-actions">
      <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFileChange" />
      <button type="button" class="btn btn-ghost" @click="fileInput?.click()">导入</button>
      <button type="button" class="btn btn-primary" @click="emit('export')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4 15.5h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        导出 JSON
      </button>
    </div>
  </header>
</template>
