<template>
  <Teleport to="body">
    <div v-if="open" class="plan-modal-overlay" @click.self="$emit('close')">
      <div class="plan-modal" role="dialog" aria-modal="true" aria-label="应急演练布置图">
        <header class="plan-modal-header">
          <div>
            <h2>场地布置图</h2>
            <p>包含通道宽度、同类净距标注、分区和手动调整清单，可导出后交给现场负责人。</p>
          </div>
          <div class="plan-modal-actions">
            <button class="btn btn-secondary" type="button" @click="downloadSvg">下载 SVG</button>
            <button class="btn btn-primary" type="button" @click="downloadPng">下载 PNG</button>
            <button class="btn btn-secondary" type="button" @click="printPlan">打印</button>
            <button class="icon-close" type="button" aria-label="关闭布置图" @click="$emit('close')">×</button>
          </div>
        </header>

        <div class="plan-summary">
          <span><b>通道宽度</b>{{ Number(params.passageWidth).toFixed(1) }} m</span>
          <span v-for="type in TYPE_ORDER" :key="type">
            <b>{{ TYPE_CONFIG[type].label }}间距</b>{{ TYPE_CONFIG[type].gap.toFixed(1) }} m
          </span>
        </div>

        <div ref="svgWrap" class="plan-svg-wrap" v-html="svgMarkup"></div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref } from 'vue'
import { buildPlanSvg } from '../layout/planSvg.js'
import { TYPE_CONFIG, TYPE_ORDER } from '../layout/engine.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  params: { type: Object, required: true },
  objects: { type: Array, default: () => [] },
  seed: { type: [String, Number], default: '' },
  selectedId: { type: String, default: null }
})
defineEmits(['close'])

const svgWrap = ref(null)
const createdAt = new Date().toLocaleString('zh-CN', { hour12: false })

const svgMarkup = computed(() => buildPlanSvg({
  params: props.params,
  objects: props.objects,
  seed: props.seed,
  selectedId: props.selectedId,
  createdAt
}))

function getSvgElement() {
  return svgWrap.value?.querySelector('svg')
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function serializeSvg() {
  const svg = getSvgElement()
  if (!svg) return ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
}

function downloadSvg() {
  const xml = serializeSvg()
  if (!xml) return
  downloadBlob(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), `应急演练布置图-种子${props.seed}.svg`)
}

function downloadPng() {
  const svg = getSvgElement()
  const xml = serializeSvg()
  if (!svg || !xml) return
  const vb = svg.viewBox.baseVal
  const sourceWidth = vb?.width || 1280
  const sourceHeight = vb?.height || 860
  const scale = 2
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sourceWidth * scale)
    canvas.height = Math.round(sourceHeight * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob((pngBlob) => {
      if (pngBlob) downloadBlob(pngBlob, `应急演练布置图-种子${props.seed}.png`)
    }, 'image/png')
  }
  img.onerror = () => URL.revokeObjectURL(url)
  img.src = url
}

function printPlan() {
  const xml = serializeSvg()
  if (!xml) return
  const win = window.open('', '_blank', 'width=1200,height=900')
  if (!win) return
  win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>应急演练布置图</title><style>body{margin:0;background:#f8fafc;font-family:"Microsoft YaHei",sans-serif}svg{width:100%;height:auto;display:block}@media print{body{background:#fff}}</style></head><body>${xml}<script>window.onload=()=>{setTimeout(()=>window.print(),300)}<\/script></body></html>`)
  win.document.close()
}
</script>
