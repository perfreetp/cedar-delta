<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">演</div>
        <div>
          <h1>应急演练场地布点工具</h1>
          <p>长方形空地 · 功能分区 · 间距约束 · 种子复现 · 布置图导出</p>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="seed-pill">当前种子 <b>{{ currentSeed || seedInput }}</b></span>
        <button class="btn btn-primary" type="button" :disabled="!objects.length" @click="planOpen = true">
          生成布置图
        </button>
      </div>
    </header>

    <main class="workspace">
      <aside class="panel control-panel" aria-label="场地与数量参数">
        <section class="card-section">
          <h2>1. 场地与通道</h2>

          <label class="field">
            <span class="field-label">场地长（m）</span>
            <input v-model.number="draft.length" type="number" min="30" max="220" step="1" />
          </label>
          <input v-model.number="draft.length" class="range" type="range" min="30" max="220" step="1" />

          <label class="field">
            <span class="field-label">场地宽（m）</span>
            <input v-model.number="draft.width" type="number" min="20" max="160" step="1" />
          </label>
          <input v-model.number="draft.width" class="range" type="range" min="20" max="160" step="1" />

          <label class="field">
            <span class="field-label">主通道宽度（m）</span>
            <input v-model.number="draft.passageWidth" type="number" min="3" max="10" step="0.5" />
          </label>
          <input v-model.number="draft.passageWidth" class="range" type="range" min="3" max="10" step="0.5" />

          <div class="orientation-field">
            <span class="field-label">主通道走向</span>
            <div class="segmented">
              <button
                type="button"
                :class="{ active: draft.orientation === 'length' }"
                :aria-pressed="draft.orientation === 'length'"
                @click="draft.orientation = 'length'"
              >
                沿场地长轴
              </button>
              <button
                type="button"
                :class="{ active: draft.orientation === 'width' }"
                :aria-pressed="draft.orientation === 'width'"
                @click="draft.orientation = 'width'"
              >
                沿场地短轴
              </button>
            </div>
          </div>
        </section>

        <section class="card-section">
          <h2>2. 各类物件数量档位</h2>
          <p class="section-tip">每类均为五档；档位越高，铺开数量越多。</p>

          <div v-for="type in TYPE_ORDER" :key="type" class="tier-block">
            <div class="tier-head">
              <span class="type-name">
                <i class="color-dot" :style="{ background: TYPE_CONFIG[type].color }"></i>
                {{ TYPE_CONFIG[type].label }}
              </span>
              <span class="count-badge">{{ countFor(type, draft.tiers[type]) }} {{ TYPE_CONFIG[type].unit }}</span>
            </div>
            <div class="tier-buttons" role="group" :aria-label="`${TYPE_CONFIG[type].label}数量档位`">
              <button
                v-for="tier in 5"
                :key="tier"
                type="button"
                :class="{ active: draft.tiers[type] === tier }"
                :aria-pressed="draft.tiers[type] === tier"
                :title="TIER_LABELS[tier - 1]"
                @click="draft.tiers[type] = tier"
              >
                {{ tier }}
              </button>
            </div>
            <div class="tier-scale"><span>少量</span><span>{{ TIER_LABELS[draft.tiers[type] - 1] }}</span><span>密集</span></div>
          </div>
        </section>

        <section class="card-section seed-section">
          <h2>3. 生成与复现</h2>
          <label class="field seed-field">
            <span class="field-label">种子编号</span>
            <div class="seed-input-row">
              <input
                id="seed-input"
                v-model="seedInput"
                type="text"
                inputmode="numeric"
                placeholder="输入同一个种子数"
                aria-label="种子输入框"
                @keydown.enter="reproduceSeed"
              />
              <button class="btn btn-icon" type="button" title="随机种子" aria-label="随机种子" @click="rollSeed">⟳</button>
            </div>
          </label>
          <button class="btn btn-primary btn-block generate-btn" type="button" @click="generateLayoutClick">
            生成布置
          </button>
          <button class="btn btn-outline btn-block" type="button" @click="reproduceSeed">
            按种子复现完整布局
          </button>
          <p class="rule-tip">
            重新生成会保留已拖过的物件；拖到通道或空位冲突处会自动弹回最近空位。相同种子可恢复该次参数、物件位置和手动调整。
          </p>
        </section>
      </aside>

      <section class="viewport" aria-label="三维场地视图">
        <div ref="sceneContainer" class="scene-container"></div>

        <div class="viewport-topbar">
          <div class="view-title">
            <b>三维布点视图</b>
            <span>左键拖物件 · 空白处拖动旋转视角 · 滚轮缩放</span>
          </div>
          <div class="view-buttons">
            <button class="btn btn-soft" type="button" @click="fitView">视角复位</button>
            <button class="btn btn-soft" type="button" :disabled="!objects.length" @click="planOpen = true">
              布置图 / 导出
            </button>
          </div>
        </div>

        <div v-if="!objects.length" class="empty-overlay">
          <div class="empty-card">
            <div class="empty-icon">⛺</div>
            <h2>先在左侧设定场地与档位</h2>
            <p>选完后点击“生成布置”，场地、通道和四类物件会按间距规则铺开。</p>
          </div>
        </div>

        <transition name="toast">
          <div v-if="notice" class="notice-toast" :class="{ error: noticeTone === 'error', success: noticeTone === 'success' }">
            {{ notice }}
          </div>
        </transition>

        <div v-if="dragHint" class="drag-hint" :class="{ invalid: !dragHint.valid }">
          <b>{{ dragHint.valid ? '位置可用' : '此处不能放置' }}</b>
          <span v-if="dragHint.reasons.length">{{ dragHint.reasons.join('；') }}</span>
          <span v-else>松开后放置</span>
        </div>
      </section>

      <aside class="panel right-panel" aria-label="物件调整与手动清单">
        <section class="card-section object-picker">
          <h2>选择物件调整</h2>
          <label class="picker-field">
            <span class="field-label">场地物件</span>
            <select v-model="selectedId" aria-label="选择要旋转或修改尺寸的物件" :disabled="!objects.length">
              <option :value="null" disabled>{{ objects.length ? '请选择物件…' : '请先生成布置' }}</option>
              <optgroup v-for="type in TYPE_ORDER" :key="type" :label="TYPE_CONFIG[type].label">
                <option v-for="o in objectsByType(type)" :key="o.id" :value="o.id">
                  {{ o.label }}{{ isManual(o) ? '（已手动）' : '' }}
                </option>
              </optgroup>
            </select>
          </label>
        </section>

        <section v-if="selectedObject" class="card-section inspector">
          <div class="section-title-row">
            <h2>物件调整</h2>
            <button class="text-btn" type="button" @click="selectedId = null">取消选择</button>
          </div>
          <div class="selected-name">
            <i class="color-dot" :style="{ background: TYPE_CONFIG[selectedObject.type].color }"></i>
            <b>{{ selectedObject.label }}</b>
            <span v-if="isManual(selectedObject)" class="manual-tag">已手动调整</span>
          </div>

          <label class="control-field">
            <span class="field-label">旋转角度：{{ Math.round(selectedObject.rotation) }}°</span>
            <input v-model.number="selectedObject.rotation" type="range" min="0" max="359" step="1" @input="markRotation" @change="repairSelected" />
          </label>
          <div class="rotate-buttons">
            <button class="btn btn-soft" type="button" @click="rotateSelected(-90)">↺ 左转 90°</button>
            <button class="btn btn-soft" type="button" @click="rotateSelected(90)">右转 90° ↻</button>
          </div>

          <label class="control-field">
            <span class="field-label">尺寸比例：{{ Number(selectedObject.scale).toFixed(2) }}×</span>
            <input v-model.number="selectedObject.scale" type="range" min="0.7" max="1.6" step="0.05" @input="markScale" @change="repairSelected" />
            <span class="dimension-text">
              占地约 {{ (TYPE_CONFIG[selectedObject.type].size.w * selectedObject.scale).toFixed(1) }}
              × {{ (TYPE_CONFIG[selectedObject.type].size.d * selectedObject.scale).toFixed(1) }} m
            </span>
          </label>

          <div v-if="selectedValidation && !selectedValidation.valid" class="validation-box">
            {{ selectedValidation.reasons.join('；') }}。释放调整后将尝试移到最近空位。
          </div>

          <div class="inspector-actions">
            <button class="btn btn-outline btn-block" type="button" @click="restorePosition(selectedObject.id)">
              恢复自动位置
            </button>
            <button class="btn btn-ghost btn-block" type="button" @click="resetObjectAll(selectedObject.id)">
              位置 / 旋转 / 尺寸全部复位
            </button>
          </div>
        </section>

        <section class="card-section manual-section">
          <div class="section-title-row">
            <h2>手动调整清单</h2>
            <span class="count-badge amber">{{ manualObjects.length }} 项</span>
          </div>
          <p class="section-tip">点击清单项可在场地中高亮对应物件。</p>

          <div v-if="manualObjects.length" class="manual-list">
            <div
              v-for="o in manualObjects"
              :key="o.id"
              class="manual-item"
              :class="{ active: selectedId === o.id }"
              role="button"
              tabindex="0"
              @click="focusObject(o.id)"
              @keydown.enter="focusObject(o.id)"
            >
              <div class="manual-item-main">
                <i class="color-dot" :style="{ background: TYPE_CONFIG[o.type].color }"></i>
                <div>
                  <b>{{ o.label }}</b>
                  <span class="manual-fields">{{ manualFields(o).join(' · ') }}</span>
                </div>
              </div>
              <button class="restore-mini" type="button" title="恢复成自动位置" @click.stop="restorePosition(o.id)">
                恢复自动位置
              </button>
            </div>
          </div>
          <div v-else class="empty-list">还没有手动调整过的物件。拖动、旋转或缩放后会列在这里。</div>

          <button v-if="manualObjects.length" class="btn btn-ghost btn-block reset-all" type="button" @click="resetAllManual">
            全部恢复为自动布局
          </button>
        </section>

        <section class="card-section legend-section">
          <h2>图例与数量</h2>
          <div v-for="type in TYPE_ORDER" :key="`legend-${type}`" class="legend-row">
            <span><i class="color-dot" :style="{ background: TYPE_CONFIG[type].color }"></i>{{ TYPE_CONFIG[type].label }}</span>
            <b>{{ countObjects(type) }} {{ TYPE_CONFIG[type].unit }}</b>
          </div>
          <div class="legend-row manual-legend">
            <span><i class="manual-dot">调</i>手动调整记号</span>
            <b>间距 {{ TYPE_CONFIG.tent.gap.toFixed(1) }}–{{ TYPE_CONFIG.assembly.gap.toFixed(1) }}m</b>
          </div>
        </section>
      </aside>
    </main>

    <PlanDialog
      :open="planOpen"
      :params="appliedParams"
      :objects="objects"
      :seed="currentSeed || seedInput"
      :selected-id="selectedId"
      @close="planOpen = false"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import PlanDialog from './components/PlanDialog.vue'
import { SceneManager } from './three/SceneManager.js'
import {
  TYPE_CONFIG,
  TYPE_ORDER,
  TIER_LABELS,
  defaultParams,
  normalizeParams,
  countFor,
  generateLayout,
  isManual,
  manualFields,
  validatePlacement,
  findNearestValidPosition,
  randomSeed
} from './layout/engine.js'
import { loadSeedSnapshot, saveSeedSnapshot, hasSeedSnapshot, createUniqueSeed } from './layout/seedStore.js'

const sceneContainer = ref(null)
const planOpen = ref(false)
const draft = reactive(defaultParams())
const appliedParams = ref(normalizeParams(defaultParams()))
const objects = ref([])
const selectedId = ref(null)
const seedInput = ref(String(randomSeed()))
const currentSeed = ref(null)
const dragHint = ref(null)
const notice = ref('')
const noticeTone = ref('')

let sceneManager = null
let noticeTimer = null

const selectedObject = computed(() => objects.value.find((o) => o.id === selectedId.value) || null)
const manualObjects = computed(() =>
  objects.value
    .filter(isManual)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.index - b.index)
)
const selectedValidation = computed(() => {
  const o = selectedObject.value
  if (!o) return null
  return validatePlacement(o, objects.value, appliedParams.value)
})

onMounted(() => {
  sceneManager = new SceneManager(sceneContainer.value, {
    onSelect: (id) => {
      selectedId.value = id
    },
    onCommit: (id, transform) => {
      const obj = objects.value.find((o) => o.id === id)
      if (!obj) return
      obj.x = Math.round(transform.x * 1000) / 1000
      obj.z = Math.round(transform.z * 1000) / 1000
      obj.positionManual = true
      selectedId.value = id
      showNotice(transform.bounced ? '落点压到通道或空位冲突，已弹回最近的合法空位。' : '物件位置已保留，重新生成时不会被冲掉。', 'success')
    },
    onDragHint: (hint) => {
      dragHint.value = hint
    }
  })
  sceneManager.sync(objects.value, appliedParams.value)
  if (import.meta.env.DEV) {
    window.__sceneManager = sceneManager
  }
})

onBeforeUnmount(() => {
  sceneManager?.dispose()
  sceneManager = null
  if (noticeTimer) window.clearTimeout(noticeTimer)
})

watch(selectedId, (id) => {
  sceneManager?.setSelected(id)
})

watch(
  objects,
  () => {
    sceneManager?.sync(objects.value, appliedParams.value)
    persistSnapshot()
  },
  { deep: true }
)

watch(appliedParams, (params) => {
  sceneManager?.sync(objects.value, params)
})

function showNotice(message, tone = '') {
  notice.value = message
  noticeTone.value = tone
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = ''
    noticeTone.value = ''
  }, 4200)
}

function rollSeed() {
  seedInput.value = String(randomSeed())
}

function readSeedInput() {
  const digits = String(seedInput.value || '').replace(/\D/g, '')
  const seed = Number(digits)
  if (!digits || !Number.isFinite(seed) || seed <= 0) {
    const next = randomSeed()
    seedInput.value = String(next)
    return next
  }
  seedInput.value = String(seed)
  return seed
}

function syncDraftFromParams(params) {
  const normalized = normalizeParams(params)
  draft.length = normalized.length
  draft.width = normalized.width
  draft.passageWidth = normalized.passageWidth
  draft.orientation = normalized.orientation
  draft.tiers = { ...normalized.tiers }
}

function generateLayoutClick() {
  const params = normalizeParams(draft)
  syncDraftFromParams(params)

  const requestedSeed = readSeedInput()
  let seed = requestedSeed
  if (hasSeedSnapshot(seed)) {
    seed = createUniqueSeed(seed)
    seedInput.value = String(seed)
    showNotice(`种子 ${requestedSeed} 的完整快照已保留；本次新布局使用种子 ${seed}。`, '')
  }

  const result = generateLayout({ params, seed, previous: objects.value })
  appliedParams.value = params
  currentSeed.value = seed
  objects.value = result.objects
  selectedId.value = null

  saveSeedSnapshot(seed, {
    params,
    seed,
    objects: result.objects,
    counts: result.counts,
    createdAt: new Date().toISOString()
  })

  nextTick(() => sceneManager?.fitCamera(params))
  if (result.violations.length) {
    showNotice(`场地偏小或档位过密：${result.violations.length} 个物件无法同时满足全部间距/通道规则，已放到最近可用位置；建议增大场地或降低档位。`, 'error')
  } else if (result.protectedManual) {
    showNotice(`已生成；${result.protectedManual} 个手动调整物件按要求保留。`, 'success')
  } else {
    showNotice('布置已生成：同类间距和通道禁占规则已应用。', 'success')
  }
}

function reproduceSeed() {
  const seed = readSeedInput()
  const snapshot = loadSeedSnapshot(seed)
  if (!snapshot || !snapshot.params || !Array.isArray(snapshot.objects)) {
    showNotice(`未找到种子 ${seed} 的本地完整快照。请在当前浏览器中先生成并使用该种子。`, 'error')
    return
  }

  const params = normalizeParams(snapshot.params)
  syncDraftFromParams(params)
  appliedParams.value = params
  objects.value = JSON.parse(JSON.stringify(snapshot.objects))
  currentSeed.value = seed
  seedInput.value = String(seed)
  selectedId.value = null

  nextTick(() => {
    sceneManager?.sync(objects.value, params)
    sceneManager?.fitCamera(params)
  })
  showNotice(`已按种子 ${seed} 恢复该次生成的完整布局。`, 'success')
}

function persistSnapshot() {
  if (!currentSeed.value || !objects.value.length || !appliedParams.value) return
  saveSeedSnapshot(currentSeed.value, {
    params: appliedParams.value,
    seed: currentSeed.value,
    objects: objects.value,
    updatedAt: new Date().toISOString()
  })
}

function focusObject(id) {
  selectedId.value = id
  nextTick(() => sceneManager?.setSelected(id))
}

function markRotation() {
  const o = selectedObject.value
  if (!o) return
  o.rotationManual = true
}

function markScale() {
  const o = selectedObject.value
  if (!o) return
  o.scaleManual = true
}

function rotateSelected(delta) {
  const o = selectedObject.value
  if (!o) return
  let next = (Number(o.rotation) || 0) + delta
  next = ((next % 360) + 360) % 360
  o.rotation = next
  o.rotationManual = true
  repairSelected()
}

function repairSelected() {
  const o = selectedObject.value
  if (!o || !appliedParams.value) return
  const result = validatePlacement(o, objects.value, appliedParams.value)
  if (result.valid) return
  const nearest = findNearestValidPosition(o, objects.value, appliedParams.value)
  if (nearest) {
    o.x = Math.round(nearest.x * 1000) / 1000
    o.z = Math.round(nearest.z * 1000) / 1000
    o.positionManual = true
    showNotice('新尺寸/角度与通道或邻物冲突，已移到最近空位。', '')
  } else {
    showNotice('当前尺寸/角度在场地内找不到合法位置，请调小尺寸。', 'error')
  }
}

function restorePosition(id) {
  const target = objects.value.find((o) => o.id === id)
  if (!target) return
  const seed = currentSeed.value || Number(seedInput.value) || 1
  const previous = objects.value.map((o) =>
    o.id === id ? { ...JSON.parse(JSON.stringify(o)), positionManual: false } : o
  )
  const result = generateLayout({
    params: appliedParams.value,
    seed,
    previous
  })
  appliedParams.value = result.params
  objects.value = result.objects
  selectedId.value = id
  currentSeed.value = seed
  nextTick(() => sceneManager?.setSelected(id))
  showNotice('已恢复该物件的自动位置；旋转和尺寸若手动修改过会保留。', 'success')
}

function resetObjectAll(id) {
  const seed = currentSeed.value || Number(seedInput.value) || 1
  const previous = objects.value.map((o) =>
    o.id === id
      ? { ...JSON.parse(JSON.stringify(o)), positionManual: false, rotationManual: false, scaleManual: false, rotation: 0, scale: 1 }
      : o
  )
  const result = generateLayout({ params: appliedParams.value, seed, previous })
  objects.value = result.objects
  selectedId.value = id
  nextTick(() => sceneManager?.setSelected(id))
  showNotice('该物件已完全恢复为自动排布状态。', 'success')
}

function resetAllManual() {
  const seed = currentSeed.value || Number(seedInput.value) || 1
  const previous = objects.value.map((o) => ({
    ...JSON.parse(JSON.stringify(o)),
    positionManual: false,
    rotationManual: false,
    scaleManual: false,
    rotation: 0,
    scale: 1
  }))
  const result = generateLayout({ params: appliedParams.value, seed, previous, protectManual: false })
  objects.value = result.objects
  selectedId.value = null
  nextTick(() => sceneManager?.fitCamera(appliedParams.value))
  showNotice('已清除全部手动调整并恢复自动布局。', 'success')
}

function fitView() {
  sceneManager?.fitCamera(appliedParams.value)
}

function countObjects(type) {
  return objects.value.filter((o) => o.type === type).length
}

function objectsByType(type) {
  return objects.value
    .filter((o) => o.type === type)
    .sort((a, b) => a.index - b.index)
}
</script>
