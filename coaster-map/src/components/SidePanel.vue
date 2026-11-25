<template>
  <aside class="side-panel">
    <header class="panel-header">
      <h2>要素列表</h2>
      <div class="panel-stats">
        <span>总数 {{ state.dataset.counts.total.toLocaleString() }}</span>
        <span v-if="state.boxSelectionIds.length" class="stat-box">
          框选 {{ state.boxSelectionIds.length }}
        </span>
      </div>
    </header>

    <!-- 类型筛选 -->
    <div class="filter-row">
      <button
        v-for="k in kindFilters"
        :key="k.key"
        class="chip"
        :class="{ active: activeKind === k.key, off: !state.layers[k.key] }"
        @click="activeKind = activeKind === k.key ? '' : k.key"
      >
        <i class="dot" :style="{ background: k.color }"></i>
        {{ k.label }}
        <em>{{ state.dataset.counts[k.key] ?? 0 }}</em>
      </button>
    </div>

    <!-- 线路筛选 -->
    <div class="filter-row routes">
      <button
        v-for="(rid, i) in routeIds"
        :key="rid"
        class="chip route"
        :class="{ active: activeRoute === rid }"
        :style="{ '--rc': routeColors[i] }"
        @click="activeRoute = activeRoute === rid ? '' : rid"
      >
        {{ rid }}
      </button>
    </div>

    <div v-if="state.boxSelectionIds.length" class="box-banner">
      <span>框选命中 <b>{{ state.boxSelectionIds.length }}</b> 个要素</span>
      <button class="link-btn" @click="clearSelection">退出框选</button>
    </div>

    <!-- 虚拟滚动列表 -->
    <div ref="scrollEl" class="list-viewport" @scroll="onScroll">
      <div class="list-spacer" :style="{ height: filteredRows.length * ROW_H + 'px' }">
        <div
          v-for="row in visibleWindow"
          :key="row.id"
          class="list-row"
          :class="rowClass(row)"
          :style="{ transform: `translateY(${row.top}px)` }"
          @click="selectFeature(row.id, null)"
        >
          <i class="row-dot" :style="{ background: kindColor(row.kind) }"></i>
          <div class="row-text">
            <div class="row-name">{{ row.name }}</div>
            <div class="row-detail">{{ row.routeId }} · {{ row.detail }}</div>
          </div>
          <span class="row-kind">{{ row.kindLabel }}</span>
        </div>
      </div>
      <div v-if="!filteredRows.length" class="empty">无匹配要素</div>
    </div>

    <footer class="panel-footer">
      <span v-if="selected">定位中:{{ selected.name }}</span>
      <span v-else>点击列表项地图联动定位</span>
    </footer>
  </aside>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useStore } from '../store/useStore.js'
import { ROUTE_COLORS } from '../map/styleFactory.js'

const store = useStore()
const { state } = store
const { selectFeature, clearSelection, boxSelectionSet } = store

const ROW_H = 52
const OVERSCAN = 6

const kindFilters = [
  { key: 'line', label: '中心线', color: '#38bdf8' },
  { key: 'column', label: '立柱', color: '#fbbf24' },
  { key: 'weld', label: '焊缝', color: '#f472b6' },
  { key: 'clearance', label: '限界框', color: '#a78bfa' }
]
const kindColorMap = Object.fromEntries(kindFilters.map((k) => [k.key, k.color]))
const kindColor = (k) => kindColorMap[k] || '#94a3b8'

const routeIds = ['RC-1', 'RC-2', 'RC-3', 'RC-4', 'RC-5', 'RC-6', 'RC-7', 'RC-8']
const routeColors = ROUTE_COLORS

const activeKind = ref('')
const activeRoute = ref('')
const scrollEl = ref(null)
const scrollTop = ref(0)
const viewH = ref(600)

const boxSet = boxSelectionSet

function rowClass(row) {
  return {
    selected: row.id === state.selectedId,
    boxed: boxSet.value.has(row.id)
  }
}

const selected = computed(() =>
  state.selectedId ? state.dataset.index.get(state.selectedId) : null
)

const filteredRows = computed(() => {
  let rows = store.visibleRows.value
  if (activeKind.value) rows = rows.filter((r) => r.kind === activeKind.value)
  if (activeRoute.value) rows = rows.filter((r) => r.routeId === activeRoute.value)
  return rows
})

const visibleWindow = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN)
  const end = Math.min(
    filteredRows.value.length,
    start + Math.ceil(viewH.value / ROW_H) + OVERSCAN * 2
  )
  const out = []
  for (let i = start; i < end; i++) {
    out.push({ ...filteredRows.value[i], top: i * ROW_H })
  }
  return out
})

function onScroll(e) {
  scrollTop.value = e.target.scrollTop
}

const ro = new ResizeObserver((entries) => {
  viewH.value = entries[0].contentRect.height
})
watch(
  scrollEl,
  (el) => {
    if (el) ro.observe(el)
  },
  { immediate: true }
)

// 框选结果变化时回到顶部
watch(
  () => state.boxSelectionIds.length,
  () => {
    scrollTop.value = 0
    if (scrollEl.value) scrollEl.value.scrollTop = 0
  }
)

// 单选变化时滚动到对应行
watch(
  () => state.selectedId,
  async (id) => {
    if (!id) return
    await nextTick()
    const idx = filteredRows.value.findIndex((r) => r.id === id)
    if (idx < 0 || !scrollEl.value) return
    const top = idx * ROW_H
    const bottom = top + ROW_H
    if (top < scrollEl.value.scrollTop) scrollEl.value.scrollTop = top
    else if (bottom > scrollEl.value.scrollTop + viewH.value)
      scrollEl.value.scrollTop = bottom - viewH.value
  }
)
</script>

<style scoped>
.side-panel {
  width: 340px;
  min-width: 340px;
  height: 100%;
  background: #0f172a;
  border-left: 1px solid rgba(148, 163, 184, 0.18);
  display: flex;
  flex-direction: column;
  color: #e2e8f0;
}
.panel-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}
.panel-header h2 {
  margin: 0 0 6px;
  font-size: 15px;
}
.panel-stats {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: #94a3b8;
}
.stat-box {
  color: #fde047;
  font-weight: 600;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px 4px;
}
.filter-row.routes {
  padding-top: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #1e293b;
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #cbd5e1;
  font-size: 11.5px;
  padding: 4px 9px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
}
.chip em {
  font-style: normal;
  color: #64748b;
  font-size: 10.5px;
}
.chip.active {
  border-color: #38bdf8;
  color: #e0f2fe;
  background: rgba(56, 189, 248, 0.12);
}
.chip.off {
  opacity: 0.42;
}
.chip.route.active {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--rc);
  color: var(--rc);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.box-banner {
  margin: 8px 14px 2px;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(253, 224, 71, 0.1);
  border: 1px solid rgba(253, 224, 71, 0.35);
  font-size: 12px;
  color: #fef08a;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.link-btn {
  background: none;
  border: none;
  color: #7dd3fc;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.list-viewport {
  position: relative;
  flex: 1;
  overflow-y: auto;
  margin-top: 8px;
}
.list-spacer {
  position: relative;
}
.list-row {
  position: absolute;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  cursor: pointer;
  border-left: 3px solid transparent;
  box-sizing: border-box;
}
.list-row:hover {
  background: rgba(148, 163, 184, 0.08);
}
.list-row.selected {
  background: rgba(56, 189, 248, 0.14);
  border-left-color: #38bdf8;
}
.list-row.boxed {
  box-shadow: inset 0 0 0 1px rgba(253, 224, 71, 0.35);
  border-radius: 6px;
}
.row-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.row-text {
  flex: 1;
  min-width: 0;
}
.row-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-detail {
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.row-kind {
  font-size: 10.5px;
  color: #94a3b8;
  background: #1e293b;
  padding: 2px 7px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.empty {
  padding: 40px 0;
  text-align: center;
  color: #64748b;
  font-size: 13px;
}
.panel-footer {
  padding: 9px 14px;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  font-size: 11.5px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
