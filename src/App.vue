<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import TopToolbar from './components/TopToolbar.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import BottomBar from './components/BottomBar.vue'
import Viewport from './components/Viewport.vue'
import { createDefaultState, getPresetPoints } from './arch/config'
import { distributeFlowers } from './arch/distribution'
import { loadState, normalizeState, saveStateNow } from './arch/storage'
import type {
  BooleanStatus,
  DensityId,
  DistributionMode,
  FlowerTypeId,
  PresetId,
  ProjectState,
  Vec3Tuple
} from './types'

interface HistoryEntry {
  label: string
  snapshot: ProjectState
}

const state = reactive<ProjectState>(loadState())
const viewport = ref<InstanceType<typeof Viewport> | null>(null)

const plan = computed(() => distributeFlowers(state))
const booleanStatus = ref<BooleanStatus>({
  state: 'idle',
  message: '编辑控制点后将自动执行 Manifold 布尔合并。'
})
const saveText = ref('已自动保存到浏览器')
const notice = ref('')

const past = ref<HistoryEntry[]>([])
const future = ref<HistoryEntry[]>([])
const undoLabel = computed(() => past.value[past.value.length - 1]?.label ?? '')
const redoLabel = computed(() => future.value[future.value.length - 1]?.label ?? '')

let gestureSnapshot: ProjectState | null = null
let saveTimer: number | undefined
let noticeTimer: number | undefined

function cloneState(): ProjectState {
  return JSON.parse(JSON.stringify(state)) as ProjectState
}

function statesDiffer(a: ProjectState | null, b: ProjectState): boolean {
  if (!a) return false
  return JSON.stringify(a) !== JSON.stringify(b)
}

function pushHistory(label: string, snapshot: ProjectState): void {
  past.value.push({ label, snapshot })
  if (past.value.length > 60) past.value.shift()
  future.value = []
}

function beginGesture(): void {
  if (!gestureSnapshot) gestureSnapshot = cloneState()
}

function commitGesture(label: string): void {
  if (gestureSnapshot && statesDiffer(gestureSnapshot, state)) {
    pushHistory(label, gestureSnapshot)
  }
  gestureSnapshot = null
  window.clearTimeout(saveTimer)
  saveStateNow(cloneState())
  saveText.value = '所有更改已保存在此浏览器'
}

function runHistorical(label: string, mutator: () => void, refreshBoolean = false): void {
  pushHistory(label, cloneState())
  mutator()
  saveStateNow(cloneState())
  saveText.value = '所有更改已保存在此浏览器'
  if (refreshBoolean) void nextTick(() => void viewport.value?.refreshBoolean())
}

function onPointBegin(): void {
  beginGesture()
}

function onPointChange(index: number, point: Vec3Tuple): void {
  state.controlPoints[index] = point
}

function onPointEnd(): void {
  const changed = gestureSnapshot && statesDiffer(gestureSnapshot, state)
  commitGesture('拖动控制点')
  if (changed) void nextTick(() => void viewport.value?.refreshBoolean())
}

function selectPreset(preset: PresetId): void {
  if (state.preset === preset) return
  runHistorical(
    '切换骨架预设',
    () => {
      state.preset = preset
      state.controlPoints = getPresetPoints(preset)
    },
    true
  )
}

function updateDensity(density: DensityId): void {
  if (state.density === density) return
  runHistorical('调整花材密度档位', () => {
    state.density = density
  })
}

function updateFlowerType(flowerType: FlowerTypeId): void {
  if (state.flowerType === flowerType) return
  runHistorical('切换花材类型', () => {
    state.flowerType = flowerType
    state.seed = (Math.random() * 0xffffffff) >>> 0
  })
}

function updateMode(mode: DistributionMode): void {
  if (state.mode === mode) return
  runHistorical('切换分布模式', () => {
    state.mode = mode
  })
}

function updateJitter(value: number): void {
  state.jitterRange = value
}

function updateScale(value: number): void {
  state.flowerScale = value
}

function replaceState(snapshot: ProjectState): void {
  const normalized = normalizeState(snapshot)
  state.version = normalized.version
  state.preset = normalized.preset
  state.controlPoints = normalized.controlPoints
  state.density = normalized.density
  state.flowerType = normalized.flowerType
  state.flowerScale = normalized.flowerScale
  state.mode = normalized.mode
  state.jitterRange = normalized.jitterRange
  state.seed = normalized.seed
}

function undo(): void {
  const entry = past.value.pop()
  if (!entry) return
  future.value.push({ label: entry.label, snapshot: cloneState() })
  replaceState(entry.snapshot)
  saveStateNow(cloneState())
  void nextTick(() => void viewport.value?.refreshBoolean())
}

function redo(): void {
  const entry = future.value.pop()
  if (!entry) return
  past.value.push({ label: entry.label, snapshot: cloneState() })
  replaceState(entry.snapshot)
  saveStateNow(cloneState())
  void nextTick(() => void viewport.value?.refreshBoolean())
}

function resetProject(): void {
  runHistorical(
    '恢复默认项目',
    () => {
      const defaults = createDefaultState()
      replaceState(defaults)
    },
    true
  )
  showNotice('已恢复默认花门，可通过撤销找回当前方案。')
}

function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault()
    undo()
  } else if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault()
    redo()
  }
}

function exportJSON(): void {
  const payload = {
    app: 'wedding-arch-skeleton-styler',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    ...cloneState()
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `wedding-arch-${state.preset}-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  showNotice('JSON 已导出，可分享给其他造型师。')
}

async function importJSON(file: File): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await file.text())
    const normalized = normalizeState(parsed)
    runHistorical('导入 JSON 方案', () => replaceState(normalized), true)
    showNotice('方案已导入，并已写入浏览器本地存储。')
  } catch (error) {
    console.error(error)
    showNotice('导入失败：请选择本工具导出的有效 JSON 文件。', true)
  }
}

function showNotice(message: string, isError = false): void {
  notice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
  }, 3600)
  if (isError) booleanStatus.value = { state: 'error', message }
}

watch(
  state,
  () => {
    saveText.value = '正在保存…'
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveStateNow(cloneState())
      saveText.value = '已自动保存到浏览器'
    }, 260)
  },
  { deep: true }
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void nextTick(() => void viewport.value?.refreshBoolean())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(saveTimer)
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <div class="app-shell">
    <TopToolbar
      :mode="state.mode"
      :jitter-range="state.jitterRange"
      @update:mode="updateMode"
      @update:jitter-range="updateJitter"
      @gesture-start="beginGesture"
      @gesture-end="commitGesture"
      @export="exportJSON"
      @import-file="importJSON"
    />

    <main class="workspace">
      <LeftPanel
        :preset="state.preset"
        :points="state.controlPoints"
        :status="booleanStatus"
        @select-preset="selectPreset"
      />

      <section class="center-stage">
        <Viewport
          ref="viewport"
          :points="state.controlPoints"
          :plan="plan"
          :flower-type="state.flowerType"
          :flower-scale="state.flowerScale"
          @point-begin="onPointBegin"
          @point-change="onPointChange"
          @point-end="onPointEnd"
          @boolean-status="booleanStatus = $event"
        />
      </section>

      <RightPanel
        :density="state.density"
        :flower-type="state.flowerType"
        :flower-scale="state.flowerScale"
        :plan="plan"
        @update:density="updateDensity"
        @update:flower-type="updateFlowerType"
        @update:flower-scale="updateScale"
        @gesture-start="beginGesture"
        @gesture-end="commitGesture"
      />
    </main>

    <BottomBar
      :can-undo="past.length > 0"
      :can-redo="future.length > 0"
      :undo-label="undoLabel"
      :redo-label="redoLabel"
      :save-text="saveText"
      @undo="undo"
      @redo="redo"
      @reset="resetProject"
    />

    <Transition name="toast">
      <div v-if="notice" class="toast" role="status">{{ notice }}</div>
    </Transition>
  </div>
</template>
