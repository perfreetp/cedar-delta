/**
 * 跨 MapView 实例的统一数据挂载协调器。
 *
 * 实测根因(MapLibre GL JS 4.7.1):
 *  多个 Map 共享全局 Web Worker 池,worker 用 PBF 二进制协议通信并按 source
 *  缓存矢量瓦片状态。在地图 load 回调触发的那个时间窗口里直接 addSource 大体积
 *  GeoJSON,worker 端 PBF 缓冲区会被破坏(抛 "Unimplemented type: 4"),
 *  受影响 source 永久静默失败;而在所有地图进入稳定态之后再挂载则完全正常
 *  (post-load 延迟添加 cluster/非 cluster source 均实测零失败)。
 *
 * 策略:
 *  1. 各地图只创建背景样式,load 后通过 registerMap 登记,不立即挂数据;
 *  2. 等所有地图到齐、进入 idle,并额外静置一段固定时长脱离启动窗口;
 *  3. 协调器按地图顺序、逐 source 串行挂载(每挂一个等其就绪),
 *     完成后回调各地图注册的 onReady 做 fitBounds、事件绑定等收尾。
 */

const SETTLE_MS = 1800
const pageStart = performance.now()

const maps = new Map() // viewId -> map
const readyCallbacks = new Map() // viewId -> fn
let expected = 0
let started = false

const raf = () => new Promise((r) => requestAnimationFrame(() => r()))
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

export function setExpectedMapCount(n) {
  expected = n
}

/** 地图 load 后登记;onReady 在该地图数据挂载完成后调用。 */
export function registerMap(viewId, map, onReady) {
  maps.set(viewId, map)
  readyCallbacks.set(viewId, onReady)
  if (!started && maps.size >= expected && expected > 0) {
    started = true
    run()
  }
}

async function whenIdle(map) {
  if (map.loaded()) return
  await new Promise((res) => {
    const done = () => {
      map.off('idle', done)
      res()
    }
    map.on('idle', done)
    setTimeout(done, 5000)
  })
}

async function whenSourceReady(map, sourceId) {
  await new Promise((res) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      map.off('sourcedata', onData)
      map.off('error', onErr)
      res()
    }
    const onData = (e) => {
      if (e.sourceId !== sourceId) return
      const s = map.getSource(sourceId)
      if (s && typeof s.loaded === 'function' && s.loaded()) finish()
    }
    const onErr = (e) => {
      if (e.sourceId === sourceId) finish()
    }
    map.on('sourcedata', onData)
    map.on('error', onErr)
    const s = map.getSource(sourceId)
    if (s && typeof s.loaded === 'function' && s.loaded()) finish()
    setTimeout(finish, 20000)
  })
}

async function run() {
  // 1. 所有地图进入 idle
  await Promise.all([...maps.values()].map(whenIdle))
  // 2. 双 rAF + 静置,彻底脱离 worker 启动窗口
  await raf()
  await raf()
  const remain = Math.max(0, SETTLE_MS - (performance.now() - pageStart))
  await delay(remain)

  // 3. 逐地图、逐 source 串行挂载
  for (const [viewId, map] of maps) {
    const ctx = mountContexts.get(viewId)
    if (!ctx) continue
    const { sources, layers } = ctx
    for (const [sourceId, spec] of Object.entries(sources)) {
      map.addSource(sourceId, spec)
      await whenSourceReady(map, sourceId)
    }
    for (const layer of layers) map.addLayer(layer)
    const cb = readyCallbacks.get(viewId)
    if (cb) cb()
  }
}

// viewId -> { sources, layers }
const mountContexts = new Map()

/** 各地图登记自己的 source/layer 规格,供协调器统一挂载。 */
export function provideMountContext(viewId, sources, layers) {
  mountContexts.set(viewId, { sources, layers })
}
