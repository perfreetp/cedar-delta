<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">🎢</span>
        <div>
          <h1>过山车轨道布局要素总览图</h1>
          <p>Vue 3 + MapLibre GL JS · 矢量分层 · 视口裁剪 · 三视图联动</p>
        </div>
      </div>

      <div class="toolbar">
        <button
          class="tool-btn"
          :class="{ active: state.boxMode }"
          @click="setBoxMode(!state.boxMode)"
        >
          <span class="tool-icon">▱</span>
          {{ state.boxMode ? '退出框选' : '框选模式' }}
        </button>
        <button class="tool-btn" @click="clearSelection">清除选中</button>
        <div class="tool-stats">
          <span v-for="d in stats" :key="d.key" class="stat-pill">
            <i :style="{ background: d.color }"></i>{{ d.label }} {{ d.value }}
          </span>
        </div>
      </div>
    </header>

    <main class="app-main">
      <section class="map-area">
        <div class="main-map-wrap">
          <LayerPanel class="floating-layers" />
          <MapView
            view-id="main"
            title="主视图"
            variant="main"
          />
        </div>

        <div class="mini-row">
          <MapView
            view-id="mini-1"
            title="小视图 A(全局)"
            variant="mini"
            :focus-zoom-cap="13.5"
          />
          <MapView
            view-id="mini-2"
            title="小视图 B(全局)"
            variant="mini"
            :focus-zoom-cap="13.5"
          />
        </div>
      </section>

      <SidePanel />
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import MapView from './components/MapView.vue'
import SidePanel from './components/SidePanel.vue'
import LayerPanel from './components/LayerPanel.vue'
import { useStore } from './store/useStore.js'

const { state, setBoxMode, clearSelection } = useStore()

const stats = computed(() => {
  const c = state.dataset.counts
  return [
    { key: 'line', label: '中心线', value: c.line, color: '#38bdf8' },
    { key: 'column', label: '立柱', value: c.column, color: '#fbbf24' },
    { key: 'weld', label: '焊缝', value: c.weld, color: '#f472b6' },
    { key: 'clearance', label: '限界', value: c.clearance, color: '#a78bfa' }
  ]
})
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #020617;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 18px;
  background: #0b1220;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  flex-wrap: wrap;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-mark {
  font-size: 26px;
}
.app-header h1 {
  margin: 0;
  font-size: 16px;
  color: #f8fafc;
}
.app-header p {
  margin: 2px 0 0;
  font-size: 11px;
  color: #64748b;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.tool-btn {
  background: #1e293b;
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #cbd5e1;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s;
}
.tool-btn:hover {
  border-color: #38bdf8;
  color: #e0f2fe;
}
.tool-btn.active {
  background: rgba(56, 189, 248, 0.18);
  border-color: #38bdf8;
  color: #7dd3fc;
}
.tool-icon {
  margin-right: 4px;
}
.tool-stats {
  display: flex;
  gap: 8px;
}
.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #94a3b8;
  background: #111c30;
  padding: 5px 9px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.stat-pill i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.app-main {
  flex: 1;
  display: flex;
  min-height: 0;
}
.map-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  min-width: 0;
}
.main-map-wrap {
  position: relative;
  flex: 2.1;
  min-height: 0;
}
.floating-layers {
  position: absolute;
  top: 52px;
  left: 12px;
  z-index: 8;
}
.mini-row {
  flex: 1;
  display: flex;
  gap: 10px;
  min-height: 0;
}
.mini-row > * {
  flex: 1;
  min-width: 0;
}
</style>
