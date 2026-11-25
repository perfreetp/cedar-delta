import { createApp } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import App from './App.vue'

// MapLibre 多个 Map 实例共享全局 worker 池。显式用单 worker 可让所有 GeoJSON
// 任务在同一 worker 内严格排队处理,避免多 worker 间的 PBF 缓冲区竞争
// (并发时会抛 "Unimplemented type: 4" 导致点 source 静默失败)。
maplibregl.setWorkerCount(1)
maplibregl.prewarm()

createApp(App).mount('#app')
