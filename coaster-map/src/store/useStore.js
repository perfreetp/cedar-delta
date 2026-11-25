import { reactive, computed, readonly } from 'vue'
import { buildDataset } from '../data/generator.js'

/**
 * 全局共享状态:三个地图实例(主视图 + 两个小视图)与右侧列表
 * 都读写这一个 reactive store,实现选中/框选/图层开关联动。
 */

const dataset = buildDataset()

const LAYER_DEFS = [
  { key: 'line', label: '轨道中心线', color: '#38bdf8', minzoom: 0 },
  { key: 'column', label: '立柱点', color: '#fbbf24', minzoom: 13.6 },
  { key: 'weld', label: '焊缝标记', color: '#f472b6', minzoom: 15.2 },
  { key: 'clearance', label: '限界框', color: '#a78bfa', minzoom: 16.2 },
  { key: 'label', label: '标注', color: '#e2e8f0', minzoom: 0 }
]

const state = reactive({
  dataset,
  // 图层开关(标注层随几何层联动在 map 组件内处理)
  layers: Object.fromEntries(LAYER_DEFS.map((d) => [d.key, true])),
  // 当前选中的单个要素 id(列表点击 / 地图点击)
  selectedId: null,
  // 框选命中的要素 id 集合
  boxSelectionIds: [],
  // 最近一次框选发生在哪个视图(避免回环广播)
  boxOrigin: null,
  // 定位请求:{ nonce, coord, zoom, sourceView } 视图监听后飞行定位
  focusRequest: null,
  // 框选模式(工具栏切换;也可按住 Shift 临时框选)
  boxMode: false,
  // 各视图就绪计数
  readyViews: 0
})

export function useStore() {
  const rows = dataset.rows
  const index = dataset.index

  const selectedRow = computed(() => (state.selectedId ? index.get(state.selectedId) || null : null))

  function toggleLayer(key) {
    state.layers[key] = !state.layers[key]
  }

  function setLayer(key, on) {
    state.layers[key] = on
  }

  function selectFeature(id, sourceView = null) {
    state.selectedId = id
    if (id) {
      const row = index.get(id)
      if (row) {
        state.focusRequest = {
          nonce: (state.focusRequest?.nonce || 0) + 1,
          id,
          coord: row.coord,
          zoom: row.zoom,
          sourceView
        }
      }
    }
  }

  function setBoxSelection(ids, sourceView) {
    state.boxSelectionIds = ids
    state.boxOrigin = sourceView
    if (ids.length === 1) {
      state.selectedId = ids[0]
    } else if (ids.length === 0) {
      // 清空框选时不强制清除单选
    }
  }

  function clearSelection() {
    state.selectedId = null
    state.boxSelectionIds = []
    state.boxOrigin = null
  }

  function setBoxMode(on) {
    state.boxMode = on
  }

  /** 列表里展示的行:框选非空时只显示框选结果,否则显示全部(虚拟滚动兜底)。 */
  const visibleRows = computed(() =>
    state.boxSelectionIds.length ? state.boxSelectionIds.map((id) => index.get(id)).filter(Boolean) : rows
  )

  const boxSelectionSet = computed(() => new Set(state.boxSelectionIds))

  // 调试/自动化测试钩子
  if (typeof window !== 'undefined') {
    window.__store = { state, selectFeature, setBoxSelection }
  }

  return {
    state: readonly(state),
    rawState: state,
    layerDefs: LAYER_DEFS,
    selectedRow,
    visibleRows,
    boxSelectionSet,
    toggleLayer,
    setLayer,
    selectFeature,
    setBoxSelection,
    clearSelection,
    setBoxMode
  }
}
