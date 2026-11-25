<template>
  <div
    ref="containerEl"
    class="map-view"
    :class="{ 'is-mini': variant === 'mini', 'box-cursor': boxMode }"
  >
    <div class="map-canvas" ref="mapEl"></div>

    <!-- 框选矩形 -->
    <div
      v-if="box.active"
      class="box-rect"
      :style="{
        left: box.x + 'px',
        top: box.y + 'px',
        width: box.w + 'px',
        height: box.h + 'px'
      }"
    ></div>

    <div class="map-hud">
      <span class="hud-title">{{ title }}</span>
      <span class="hud-zoom">Z{{ zoom.toFixed(1) }}</span>
    </div>

    <div v-if="variant === 'main'" class="map-hint">
      按住 <kbd>Shift</kbd> 拖拽框选 · 滚轮缩放 · 右键/两指旋转
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import { useStore } from '../store/useStore.js'
import {
  buildBaseStyle,
  buildSourceSpecs,
  buildLayerSpecs,
  resolveLayerForInstance,
  instanceLayerId,
  sourceName,
  LAYER_GROUPS,
  PICK_LAYERS
} from '../map/styleFactory.js'
import {
  setExpectedMapCount,
  registerMap,
  provideMountContext
} from '../map/initQueue.js'

const props = defineProps({
  viewId: { type: String, required: true },
  title: { type: String, default: '地图视图' },
  variant: { type: String, default: 'main' }, // main | mini
  // 小视图定位时允许的最大缩放级别,避免小窗钻进过深层级
  focusZoomCap: { type: Number, default: 99 }
})

const emit = defineEmits(['ready'])

const store = useStore()
const { state, rawState } = store
const { selectFeature, setBoxSelection, clearSelection } = store
const dataset = state.dataset
const mapEl = ref(null)
const containerEl = ref(null)
const zoom = ref(10)
const boxMode = ref(false)
const box = reactive({ active: false, x: 0, y: 0, w: 0, h: 0, x0: 0, y0: 0 })

let map = null
let dragMoved = false
let suppressClick = false
let lastFocusNonce = 0

// 每个地图实例的唯一标识,用于隔离 worker 端按 source 名缓存的状态
const instanceId = props.viewId
const lid = (logicalId) => instanceLayerId(instanceId, logicalId)
const sid = (logicalName) => sourceName(instanceId, logicalName)

/** 当前处于可见状态的可拾取图层 —— 隐藏层不会被框选/点选命中。 */
function visiblePickLayers() {
  const visibleGroups = Object.keys(rawState.layers).filter((k) => rawState.layers[k])
  return PICK_LAYERS.filter((l) => visibleGroups.some((g) => LAYER_GROUPS[g]?.includes(l))).map(lid)
}

function applyVisibility() {
  if (!map) return
  for (const [group, ids] of Object.entries(LAYER_GROUPS)) {
    const on = rawState.layers[group]
    for (const id of ids) {
      const realId = lid(id)
      const layer = map.getLayer(realId)
      if (layer) map.setLayoutProperty(realId, 'visibility', on ? 'visible' : 'none')
    }
  }
  updateSelectionSource()
}

/** 选中态(单选 + 框选)合并写入高亮 source;隐藏层要素不参与高亮。 */
function updateSelectionSource() {
  const source = map?.getSource(sid('selection'))
  if (!source) return
  const ids = new Set()
  if (rawState.selectedId) ids.add(rawState.selectedId)
  for (const id of rawState.boxSelectionIds) ids.add(id)
  const features = []
  for (const id of ids) {
    const f = dataset.featureById.get(id)
    if (f && rawState.layers[f.properties.kind]) features.push(f)
  }
  source.setData({ type: 'FeatureCollection', features })
}

/** 把查询命中的聚类展开成叶子要素 id。 */
async function expandClusters(hits) {
  const ids = []
  const jobs = []
  for (const f of hits) {
    const sourceName = f.source
    if (f.properties?.cluster) {
      const src = map.getSource(sourceName)
      jobs.push(
        src.getClusterLeaves(f.properties.cluster_id, 10000, 0).then((leaves) => {
          for (const leaf of leaves) ids.push(leaf.properties.id)
        })
      )
    } else if (f.properties?.id) {
      ids.push(f.properties.id)
    }
  }
  await Promise.all(jobs)
  return [...new Set(ids)]
}

function onMapClick(e) {
  if (suppressClick) {
    suppressClick = false
    return
  }
  const hits = map.queryRenderedFeatures(e.point, { layers: visiblePickLayers() })
  if (!hits.length) {
    clearSelection()
    return
  }
  const f = hits[0]
  if (f.properties?.cluster) {
    // 点聚类:放大到该聚类的展开层级
    const src = map.getSource(f.source)
    src.getClusterExpansionZoom(f.properties.cluster_id).then((z) => {
      map.easeTo({ center: f.geometry.coordinates, zoom: z, duration: 450 })
    })
    return
  }
  if (f.properties?.id) selectFeature(f.properties.id, props.viewId)
}

function onMouseDown(e) {
  const wantBox = boxMode.value || e.originalEvent.shiftKey
  if (!wantBox) return
  e.originalEvent.preventDefault()
  dragMoved = false
  map.dragPan.disable()
  const p = e.point
  box.active = true
  box.x0 = p.x
  box.y0 = p.y
  box.x = p.x
  box.y = p.y
  box.w = 0
  box.h = 0

  const onMove = (ev) => {
    const q = ev.point
    if (Math.abs(q.x - p.x) + Math.abs(q.y - p.y) > 4) dragMoved = true
    box.x = Math.min(p.x, q.x)
    box.y = Math.min(p.y, q.y)
    box.w = Math.abs(q.x - p.x)
    box.h = Math.abs(q.y - p.y)
  }
  const onUp = async () => {
    map.off('mousemove', onMove)
    map.off('mouseup', onUp)
    map.dragPan.enable()
    box.active = false
    if (dragMoved) {
      suppressClick = true
      const rect = [
        [box.x, box.y],
        [box.x + box.w, box.y + box.h]
      ]
      const hits = map.queryRenderedFeatures(rect, { layers: visiblePickLayers() })
      const ids = await expandClusters(hits)
      setBoxSelection(ids, props.viewId)
    }
  }
  map.on('mousemove', onMove)
  map.on('mouseup', onUp)
}

function onMouseEnter() {
  map.getCanvas().style.cursor = boxMode.value ? 'crosshair' : ''
}

// 应用固定有 3 个地图实例(主视图 + 两个小视图)
setExpectedMapCount(3)

onMounted(() => {
  map = new maplibregl.Map({
    container: mapEl.value,
    style: buildBaseStyle(),
    attributionControl: false,
    antialias: true,
    minZoom: 8,
    maxZoom: 19,
    fitBoundsOptions: { padding: props.variant === 'mini' ? 24 : 48 }
  })
  // 自绘框选,关掉内置 shift 框缩放,避免手势冲突
  map.boxZoom.disable()
  // 调试/自动化测试钩子
  window.__maps = window.__maps || {}
  window.__maps[props.viewId] = map

  map.on('load', () => {
    // 只登记 source/layer 规格,由协调器在所有地图稳定后统一串行挂载,
    // 规避 worker 启动窗口内 addSource 导致的 PBF 缓冲区污染
    const sources = buildSourceSpecs(dataset, instanceId)
    const layers = buildLayerSpecs().map((l) => resolveLayerForInstance(l, instanceId))
    provideMountContext(props.viewId, sources, layers)
    registerMap(props.viewId, map, () => {
      map.fitBounds(
        [
          [dataset.bounds[0], dataset.bounds[1]],
          [dataset.bounds[2], dataset.bounds[3]]
        ],
        { padding: props.variant === 'mini' ? 24 : 48 }
      )
      applyVisibility()
      map.on('zoom', () => (zoom.value = map.getZoom()))
      map.on('mousedown', onMouseDown)
      map.on('click', onMapClick)
      map.on('mouseenter', onMouseEnter)
      if (props.variant === 'main') {
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
        map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')
      }
      emit('ready')
    })
  })

  map.on('error', (e) => console.warn(`[${props.viewId}] map error`, e?.error?.message || e))
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

// 图层开关 -> 可见性 + 高亮刷新
watch(
  () => ({ ...rawState.layers }),
  () => applyVisibility(),
  { deep: true }
)

// 选中/框选变化 -> 高亮
watch(
  () => [rawState.selectedId, rawState.boxSelectionIds.length, rawState.boxSelectionIds.join('|')],
  () => updateSelectionSource()
)

// 框选模式 -> 光标
watch(
  () => state.boxMode,
  (on) => {
    boxMode.value = on
    if (map) map.getCanvas().style.cursor = on ? 'crosshair' : ''
  }
)

// 其他视图发起的定位请求 -> 本视图跟随
watch(
  () => state.focusRequest?.nonce,
  (nonce) => {
    const req = rawState.focusRequest
    if (!req || nonce === lastFocusNonce || req.sourceView === props.viewId) return
    lastFocusNonce = nonce
    const targetZoom = Math.min(req.zoom, props.focusZoomCap)
    map?.easeTo({
      center: req.coord,
      zoom: Math.max(map.getZoom(), targetZoom),
      duration: 650,
      essential: true
    })
  }
)
</script>

<style scoped>
.map-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 10px;
  background: #0b1220;
}
.map-canvas {
  position: absolute;
  inset: 0;
}
.box-cursor :deep(.maplibregl-canvas) {
  cursor: crosshair !important;
}
.box-rect {
  position: absolute;
  border: 1.5px solid #38bdf8;
  background: rgba(56, 189, 248, 0.16);
  pointer-events: none;
  z-index: 6;
  border-radius: 2px;
}
.map-hud {
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 5;
  display: flex;
  gap: 10px;
  align-items: center;
  pointer-events: none;
  font-size: 12px;
}
.hud-title {
  background: rgba(15, 23, 42, 0.82);
  color: #e2e8f0;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  font-weight: 600;
}
.hud-zoom {
  background: rgba(15, 23, 42, 0.82);
  color: #7dd3fc;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  font-variant-numeric: tabular-nums;
}
.map-hint {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  font-size: 11.5px;
  color: #94a3b8;
  background: rgba(15, 23, 42, 0.78);
  padding: 5px 12px;
  border-radius: 999px;
  pointer-events: none;
  white-space: nowrap;
}
kbd {
  background: #1e293b;
  border: 1px solid #475569;
  border-radius: 4px;
  padding: 0 5px;
  font-family: inherit;
  color: #e2e8f0;
}
</style>
