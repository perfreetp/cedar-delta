<script setup lang="ts">
defineProps<{
  canUndo: boolean
  canRedo: boolean
  undoLabel: string
  redoLabel: string
  saveText: string
}>()

const emit = defineEmits<{
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'reset'): void
}>()
</script>

<template>
  <footer class="bottombar">
    <div class="history-actions">
      <button type="button" class="btn btn-history" :disabled="!canUndo" @click="emit('undo')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5 4 9l4 4M4 9h7.5a4.5 4.5 0 0 1 0 9H10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        撤销
        <kbd>Ctrl Z</kbd>
        <span v-if="undoLabel" class="history-label">{{ undoLabel }}</span>
      </button>
      <button type="button" class="btn btn-history" :disabled="!canRedo" @click="emit('redo')">
        <span v-if="redoLabel" class="history-label right">{{ redoLabel }}</span>
        <kbd>Ctrl ⇧ Z</kbd>
        重做
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5 4 4-4 4M16 9H8.5a4.5 4.5 0 0 0 0 9H10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      </button>
    </div>

    <div class="save-state">
      <span class="status-dot success"></span>
      {{ saveText }}
      <span class="save-divider">·</span>
      数据仅保存在当前浏览器
    </div>

    <div class="bottom-actions">
      <button type="button" class="btn btn-text danger" @click="emit('reset')">恢复默认</button>
    </div>
  </footer>
</template>
