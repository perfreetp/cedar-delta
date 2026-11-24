<script setup lang="ts">
import { PRESET_OPTIONS } from '../arch/config'
import type { BooleanStatus, PresetId, Vec3Tuple } from '../types'

defineProps<{
  preset: PresetId
  points: Vec3Tuple[]
  status: BooleanStatus
}>()

const emit = defineEmits<{
  (e: 'select-preset', preset: PresetId): void
}>()
</script>

<template>
  <aside class="panel panel-left">
    <section class="panel-section">
      <div class="section-heading">
        <span class="section-kicker">01 · Skeleton</span>
        <h2>骨架预设形状</h2>
        <p>切换预设后，6 个控制点会重置为推荐造型。</p>
      </div>

      <div class="preset-list">
        <button
          v-for="option in PRESET_OPTIONS"
          :key="option.id"
          type="button"
          class="preset-card"
          :class="{ active: preset === option.id }"
          @click="emit('select-preset', option.id)"
        >
          <span class="preset-glyph" aria-hidden="true">
            <svg viewBox="0 0 72 54" fill="none">
              <template v-if="option.id === 'semicircle'">
                <path d="M10 46C10 22.8 21.6 8 36 8s26 14.8 26 38" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                <path d="M10 46v-5M62 46v-5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                <circle cx="10" cy="41" r="2.6" fill="#e35d83"/><circle cx="22" cy="17" r="2.6" fill="#e35d83"/><circle cx="36" cy="8" r="2.6" fill="#e35d83"/><circle cx="50" cy="17" r="2.6" fill="#e35d83"/><circle cx="62" cy="41" r="2.6" fill="#e35d83"/><circle cx="10" cy="46" r="2.6" fill="#c28b46"/><circle cx="62" cy="46" r="2.6" fill="#c28b46"/>
              </template>
              <template v-else-if="option.id === 'pointed'">
                <path d="M10 46 18 27 31 10h10l13 17 8 19" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="10" cy="46" r="2.5" fill="#c28b46"/><circle cx="19" cy="28" r="2.5" fill="#e35d83"/><circle cx="31" cy="11" r="2.5" fill="#e35d83"/><circle cx="41" cy="11" r="2.5" fill="#e35d83"/><circle cx="53" cy="28" r="2.5" fill="#e35d83"/><circle cx="62" cy="46" r="2.5" fill="#c28b46"/>
              </template>
              <template v-else>
                <path d="M9 45C14 28 20 22 29 25c8 2.7 8-14 19-13 10 .9 13 17 15 33" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                <circle cx="9" cy="45" r="2.5" fill="#c28b46"/><circle cx="18" cy="31" r="2.5" fill="#e35d83"/><circle cx="29" cy="25" r="2.5" fill="#e35d83"/><circle cx="43" cy="14" r="2.5" fill="#e35d83"/><circle cx="53" cy="18" r="2.5" fill="#e35d83"/><circle cx="63" cy="45" r="2.5" fill="#c28b46"/>
              </template>
            </svg>
          </span>
          <span class="preset-copy">
            <strong>{{ option.label }}</strong>
            <small>{{ option.english }}</small>
            <em>{{ option.description }}</em>
          </span>
          <span class="preset-check" v-if="preset === option.id">✓</span>
        </button>
      </div>
    </section>

    <section class="panel-section compact">
      <div class="section-heading">
        <span class="section-kicker">Structure</span>
        <h2>骨架构成</h2>
      </div>
      <div class="structure-grid">
        <div><b>1</b><span>主弧线</span></div>
        <div><b>6</b><span>控制点</span></div>
        <div><b>2</b><span>立柱</span></div>
        <div><b>2</b><span>金属底座</span></div>
      </div>
    </section>

    <section class="panel-section compact">
      <div class="section-heading">
        <span class="section-kicker">Manifold Boolean</span>
        <h2>底座布尔合并</h2>
      </div>
      <div class="boolean-card" :data-state="status.state">
        <div class="boolean-line">
          <span class="status-dot"></span>
          <strong>{{ status.state === 'ready' ? '已合并为单一水密实体' : status.state === 'working' ? '正在执行并集…' : status.state === 'error' ? '已回退实时网格' : '等待合并' }}</strong>
        </div>
        <p>{{ status.message }}</p>
        <div v-if="status.state === 'ready'" class="boolean-metrics">
          <span>{{ ((status.volume ?? 0) * 1000).toFixed(1) }} L 体积</span>
          <span>{{ status.elapsedMs?.toFixed(0) }} ms</span>
        </div>
      </div>
    </section>

    <section class="panel-section coordinates">
      <div class="section-heading">
        <span class="section-kicker">Control Points</span>
        <h2>控制点坐标</h2>
      </div>
      <div class="coordinate-list">
        <div v-for="(point, index) in points" :key="index" class="coordinate-row">
          <i>{{ index + 1 }}</i>
          <span>X <b>{{ point[0].toFixed(2) }}</b></span>
          <span>Y <b>{{ point[1].toFixed(2) }}</b></span>
        </div>
      </div>
    </section>
  </aside>
</template>
