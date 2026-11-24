<script setup lang="ts">
import { DENSITY_OPTIONS, FLOWER_OPTIONS } from '../arch/config'
import type { DensityId, FlowerPlan, FlowerTypeId } from '../types'

defineProps<{
  density: DensityId
  flowerType: FlowerTypeId
  flowerScale: number
  plan: FlowerPlan
}>()

const emit = defineEmits<{
  (e: 'update:density', density: DensityId): void
  (e: 'update:flowerType', type: FlowerTypeId): void
  (e: 'update:flowerScale', scale: number): void
  (e: 'gesture-start'): void
  (e: 'gesture-end', label: string): void
}>()

function onScaleKeydown(event: KeyboardEvent): void {
  if (event.key.startsWith('Arrow')) emit('gesture-start')
}
</script>

<template>
  <aside class="panel panel-right">
    <section class="panel-section">
      <div class="section-heading">
        <span class="section-kicker">02 · Flowers</span>
        <h2>花材密度档位</h2>
        <p>每档定义沿路径间距与每个节点的花材数量。</p>
      </div>

      <div class="density-list">
        <button
          v-for="option in DENSITY_OPTIONS"
          :key="option.id"
          type="button"
          class="density-card"
          :class="{ active: density === option.id }"
          @click="emit('update:density', option.id)"
        >
          <div class="density-top">
            <strong>{{ option.label }}</strong>
            <span class="density-level" :data-level="option.id"></span>
          </div>
          <small>{{ option.caption }}</small>
          <div class="density-meta">
            <span><b>{{ option.spacing.toFixed(2) }}</b> m 间距</span>
            <span><b>{{ option.perNode }}</b> 朵 / 节点</span>
          </div>
        </button>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-heading">
        <span class="section-kicker">Species</span>
        <h2>花材类型</h2>
        <p>切换类型后会使用该类型的簇半径重新分布。</p>
      </div>

      <div class="flower-grid">
        <button
          v-for="flower in FLOWER_OPTIONS"
          :key="flower.id"
          type="button"
          class="flower-card"
          :class="{ active: flowerType === flower.id }"
          @click="emit('update:flowerType', flower.id)"
        >
          <span class="flower-swatch" :style="{ '--flower-color': flower.color }">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <g v-if="flower.id === 'eucalyptus'">
                <path d="M24 42V10" stroke="#4f7f4c" stroke-width="2" stroke-linecap="round"/>
                <ellipse cx="17" cy="18" rx="6" ry="3.4" fill="#78a978" transform="rotate(-32 17 18)"/>
                <ellipse cx="31" cy="24" rx="6" ry="3.4" fill="#86b783" transform="rotate(32 31 24)"/>
                <ellipse cx="17" cy="30" rx="6" ry="3.4" fill="#5f9564" transform="rotate(-28 17 30)"/>
              </g>
              <g v-else>
                <circle v-for="n in 6" :key="n" cx="24" cy="13" r="6.2" :fill="flower.color" :opacity="0.72 + (n % 2) * 0.2" :transform="`rotate(${(n - 1) * 60} 24 24)`"/>
                <circle cx="24" cy="24" r="6.5" :fill="flower.color"/>
                <circle cx="24" cy="24" r="3.2" fill="#fff3b0" opacity="0.95"/>
              </g>
            </svg>
          </span>
          <strong>{{ flower.label }}</strong>
          <small>{{ flower.english }}</small>
        </button>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-heading compact-heading">
        <div>
          <span class="section-kicker">Scale</span>
          <h2>整体缩放</h2>
        </div>
        <output class="scale-value">{{ flowerScale.toFixed(2) }}×</output>
      </div>
      <input
        class="scale-slider"
        type="range"
        min="0.6"
        max="1.7"
        step="0.05"
        :value="flowerScale"
        :style="{ '--range-fill': `${((flowerScale - 0.6) / (1.7 - 0.6)) * 100}%` }"
        @pointerdown="emit('gesture-start')"
        @keydown="onScaleKeydown"
        @input="emit('update:flowerScale', Number(($event.target as HTMLInputElement).value))"
        @change="emit('gesture-end', '调整花材整体缩放')"
      />
      <div class="slider-labels"><span>0.60×</span><span>1.15×</span><span>1.70×</span></div>
    </section>

    <section class="panel-section stats-section">
      <div class="section-heading">
        <span class="section-kicker">Path Statistics</span>
        <h2>分布结果</h2>
      </div>
      <div class="stats-grid">
        <div><b>{{ plan.instances.length }}</b><span>花材总数</span></div>
        <div><b>{{ plan.nodeCount }}</b><span>路径节点</span></div>
        <div><b>{{ plan.totalLength.toFixed(2) }}m</b><span>弧长</span></div>
        <div><b>{{ plan.avoidedCount }}</b><span>避让判定</span></div>
      </div>
      <p class="avoid-note">
        <span class="status-dot success"></span>
        已启用空间哈希最小距离避让；缩放时同步放大花型与避让半径，花朵中心仍贴合弧线路径。
      </p>
    </section>
  </aside>
</template>
