<template>
  <div class="layer-panel">
    <div class="panel-title">
      <span>图层控制</span>
      <span class="panel-sub">按类型分层 · 独立开关</span>
    </div>
    <label
      v-for="def in layerDefs"
      :key="def.key"
      class="layer-item"
      :class="{ off: !state.layers[def.key] }"
    >
      <input
        type="checkbox"
        :checked="state.layers[def.key]"
        @change="toggleLayer(def.key)"
      />
      <i class="swatch" :style="{ background: def.color }"></i>
      <span class="layer-label">{{ def.label }}</span>
      <span class="layer-count">{{ state.dataset.counts[def.key] ?? 0 }}</span>
    </label>
    <div class="zoom-legend">
      <div>缩放层级规则</div>
      <ul>
        <li><b>≤ Z13</b> 仅骨架中心线 + 车站大标注</li>
        <li><b>Z13.6+</b> 立柱点逐个显示</li>
        <li><b>Z15.2+</b> 焊缝标记显示</li>
        <li><b>Z16.2+</b> 限界框按段绘制</li>
        <li>低缩放重叠点自动聚类为数字</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { useStore } from '../store/useStore.js'

const { state, layerDefs, toggleLayer } = useStore()
</script>

<style scoped>
.layer-panel {
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 10px;
  padding: 12px 14px;
  backdrop-filter: blur(6px);
  min-width: 196px;
}
.panel-title {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.panel-title span:first-child {
  font-size: 13px;
  font-weight: 700;
  color: #f1f5f9;
}
.panel-sub {
  font-size: 10.5px;
  color: #64748b;
  margin-top: 2px;
}
.layer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 2px;
  font-size: 12.5px;
  color: #cbd5e1;
  cursor: pointer;
  user-select: none;
}
.layer-item.off {
  opacity: 0.45;
}
.layer-item input {
  accent-color: #38bdf8;
  cursor: pointer;
}
.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
}
.layer-label {
  flex: 1;
}
.layer-count {
  font-size: 11px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
.zoom-legend {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  font-size: 10.5px;
  color: #7d8ca3;
  line-height: 1.7;
}
.zoom-legend div {
  color: #94a3b8;
  font-weight: 600;
  margin-bottom: 2px;
}
.zoom-legend ul {
  margin: 0;
  padding-left: 14px;
}
.zoom-legend b {
  color: #7dd3fc;
}
</style>
