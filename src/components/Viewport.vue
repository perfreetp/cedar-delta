<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArchScene } from '../arch/ArchScene'
import { buildMergedSkeleton } from '../arch/manifoldUnion'
import type { BooleanStatus, DragMetrics, FlowerPlan, FlowerTypeId, Vec3Tuple } from '../types'

const props = defineProps<{
  points: Vec3Tuple[]
  plan: FlowerPlan
  flowerType: FlowerTypeId
  flowerScale: number
}>()

const emit = defineEmits<{
  (e: 'point-begin', index: number): void
  (e: 'point-change', index: number, point: Vec3Tuple): void
  (e: 'point-end'): void
  (e: 'boolean-status', status: BooleanStatus): void
}>()

const host = ref<HTMLDivElement | null>(null)
const metrics = ref<DragMetrics | null>(null)
let scene: ArchScene | null = null
let booleanRun = 0

onMounted(() => {
  if (!host.value) return
  scene = new ArchScene(host.value, props.points, {
    onPointBegin: (index) => emit('point-begin', index),
    onPointChange: (index, point) => emit('point-change', index, point),
    onPointEnd: () => emit('point-end'),
    onMetrics: (value) => {
      metrics.value = value
    }
  })
  scene.updateFlowers(props.plan, props.flowerType, props.flowerScale)
  if (import.meta.env.DEV) {
    ;(window as unknown as { __archScene?: ArchScene }).__archScene = scene
  }
})

watch(
  () => props.points,
  (points) => scene?.setPoints(points),
  { deep: true }
)

watch(
  () => props.plan,
  (plan) => scene?.updateFlowers(plan, props.flowerType, props.flowerScale)
)

watch(
  () => props.flowerType,
  (type) => scene?.updateFlowers(props.plan, type, props.flowerScale)
)

watch(
  () => props.flowerScale,
  (scale) => scene?.setFlowerScale(scale)
)

async function refreshBoolean(): Promise<void> {
  if (!scene) return
  const run = ++booleanRun
  emit('boolean-status', { state: 'working', message: 'manifold-3d 正在合并骨架与底座…' })
  try {
    const result = await buildMergedSkeleton(props.points)
    if (run !== booleanRun) {
      result.geometry.dispose()
      return
    }
    scene.applyMergedGeometry(result.geometry)
    emit('boolean-status', {
      state: 'ready',
      message: `布尔合并完成 · ${result.triangles.toLocaleString()} 三角面`,
      volume: result.volume,
      triangles: result.triangles,
      elapsedMs: result.elapsedMs
    })
  } catch (error) {
    console.error(error)
    if (run !== booleanRun) return
    scene.showRealtimeSkeleton()
    emit('boolean-status', {
      state: 'error',
      message: `Manifold 合并失败，已使用实时骨架：${error instanceof Error ? error.message : '未知错误'}`
    })
  }
}

const tooltipPosition = (metrics: DragMetrics): Record<string, string> => ({
  left: `${Math.min(metrics.x + 16, window.innerWidth - 232)}px`,
  top: `${Math.min(metrics.y + 16, window.innerHeight - 154)}px`
})

defineExpose({ refreshBoolean })

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})
</script>

<template>
  <div class="viewport-shell">
    <div ref="host" class="viewport-host"></div>

    <div class="viewport-badge viewport-badge-top">
      <span class="status-dot"></span>
      Three.js 实时视口
      <span class="badge-separator">/</span>
      6 控制点
    </div>

    <div v-if="metrics" class="drag-tooltip" :style="tooltipPosition(metrics)">
      <div class="tooltip-title">控制点 {{ metrics.index + 1 }}</div>
      <div class="tooltip-row">
        <span>当前弧长</span>
        <strong>{{ metrics.arcLength.toFixed(2) }} m</strong>
      </div>
      <div class="tooltip-row">
        <span>弧上位置</span>
        <strong>{{ metrics.positionOnArc.toFixed(2) }} m</strong>
      </div>
      <div class="tooltip-row">
        <span>曲率 κ</span>
        <strong>{{ metrics.curvature.toFixed(2) }} m⁻¹</strong>
      </div>
      <div class="tooltip-row">
        <span>曲率半径</span>
        <strong>{{ Number.isFinite(metrics.radius) ? `${metrics.radius.toFixed(2)} m` : '∞ 直线段' }}</strong>
      </div>
    </div>

    <div class="viewport-hint">
      <span><b>拖动金白圆点</b>编辑弧线</span>
      <i></i>
      <span>空白拖动旋转</span>
      <i></i>
      <span>滚轮缩放</span>
    </div>
  </div>
</template>
