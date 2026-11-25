/**
 * MapLibre style 工厂:把数据集装配成带完整分层/聚类/层级阈值的 style spec。
 *
 * 设计约定:
 *  - 每类要素一个 GeoJSON source(promoteId 保证 feature.id 稳定);
 *  - 立柱/焊缝 source 开 cluster,缩小后重叠点合并为带数字的圆点;
 *  - 渲染顺序(自下而上):clearance -> line -> column -> weld -> labels;
 *  - 所有可见性由图层 visibility 控制(框选 queryRenderedFeatures 时
 *    隐藏图层天然不会被查到);
 *  - symbol 标注全部走 GL 文本 + 碰撞检测,rotation 下 text-rotation-alignment=viewport
 *    保证文字始终正向、不叠字;
 *  - 字形本地化(public/glyphs),不依赖在线字体服务。
 */

export const GLYPHS_URL = '/glyphs/{fontstack}/{range}.pbf'
// 字体栈名同时用于字形 URL 的 {fontstack} 段,因此用无空格短名,
// 避免空格被百分号编码后静态服务器回退到 SPA index.html
export const FONT_STACK = 'noto-cjk'

export const ROUTE_COLORS = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#a78bfa',
  '#f97316',
  '#22d3ee',
  '#a3e635'
]

const ROUTE_IDS = ['RC-1', 'RC-2', 'RC-3', 'RC-4', 'RC-5', 'RC-6', 'RC-7', 'RC-8']

// 按 routeId 匹配线路配色,未命中时回退到首色
const routeColorExpr = [
  'match',
  ['get', 'routeId'],
  ...ROUTE_IDS.flatMap((id, i) => [id, ROUTE_COLORS[i]]),
  ROUTE_COLORS[0]
]

// 各类型的缩放层级阈值
export const ZOOM = {
  column: 13.6, // 立柱点从这一级开始逐个出现
  weld: 15.2, // 焊缝再放大才出现
  clearance: 16.2, // 放大到单段轨道时才画限界框
  segmentLabel: 12.5,
  columnLabel: 15.6,
  weldLabel: 16.8
}

/**
 * 最小启动样式:只含背景层与字形配置。
 * 数据 source 和业务图层在 map load 之后通过 addSource/addLayer 挂载,
 * 规避 MapLibre 4.7.1 内联大 GeoJSON 随样式初始化时的 worker 竞态
 * (现象:点 source 报 "Unimplemented type: 4" / "Invalid array length")。
 */
export function buildBaseStyle() {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {},
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': '#0b1220' }
      }
    ]
  }
}

/**
 * 业务 source 定义(load 后挂载);selection 为空集合,运行时 setData。
 *
 * 两个关键点:
 *  1. 每个地图实例的 source 名都带 instanceId 前缀。MapLibre 多个 Map 共享全局
 *     worker 池,worker 端按 source 名缓存 GeoJSON 处理状态;若三个地图使用同名
 *     source,并发的 vt-pbf 序列化会相互污染(报 "Unimplemented type: 4"),
 *     被污染的 source 永久静默失败。唯一前缀让各地图的 worker 状态互不干扰。
 *  2. 数据用 JSON 序列化克隆,既剥离 Vue reactive 代理(structuredClone 无法
 *     克隆 Proxy),又保证每个实例持有独立数据对象。
 */
export function sourceName(instanceId, base) {
  return `${instanceId}__${base}`
}

export function buildSourceSpecs(dataset, instanceId = 'main') {
  const fc = dataset.featureCollections
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const name = (base) => sourceName(instanceId, base)
  return {
    [name('line')]: {
      type: 'geojson',
      data: clone(fc.line),
      promoteId: 'id'
    },
    [name('column')]: {
      type: 'geojson',
      data: clone(fc.column),
      promoteId: 'id',
      cluster: true,
      clusterRadius: 48,
      // 聚类只在 Z13 及以下生效;Z13.6 起(超过 clusterMaxZoom)展开为独立立柱点,
      // 与 column-point 图层的 minzoom=13.6 配合,实现"缩小看聚类、放大看点"
      clusterMaxZoom: 13
    },
    [name('weld')]: {
      type: 'geojson',
      data: clone(fc.weld),
      promoteId: 'id',
      cluster: true,
      clusterRadius: 44,
      // 整数约束:supercluster 内部用 new Array(maxZoom+1),小数会抛 RangeError。
      // Z15.2 起展开为独立焊缝点(与 weld-point 图层 minzoom 配合)
      clusterMaxZoom: 15
    },
    [name('clearance')]: {
      type: 'geojson',
      data: clone(fc.clearance),
      promoteId: 'id'
    },
    [name('label')]: {
      type: 'geojson',
      data: clone(fc.label),
      promoteId: 'id'
    },
    [name('selection')]: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    }
  }
}

/** 业务图层定义(load 后按数组顺序 addLayer,顺序即渲染自下而上顺序)。
 * 内部使用逻辑 source 名(line/column/...),挂载时由 MapView 通过
 * resolveLayerForInstance 映射到带实例前缀的真实 source 名与图层 id。 */
export function buildLayerSpecs() {
  const layers = []

  // ---------- 限界框(fill + outline)----------
  layers.push({
    id: 'clearance-fill',
    type: 'fill',
    source: 'clearance',
    minzoom: ZOOM.clearance,
    paint: {
      'fill-color': '#a78bfa',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 16.2, 0.06, 17, 0.18]
    }
  })
  layers.push({
    id: 'clearance-outline',
    type: 'line',
    source: 'clearance',
    minzoom: ZOOM.clearance,
    paint: {
      'line-color': '#a78bfa',
      'line-width': ['interpolate', ['linear'], ['zoom'], 16.2, 1, 18, 2.4],
      'line-opacity': 0.85
    }
  })

  // ---------- 轨道中心线(骨架)----------
  layers.push({
    id: 'line-casing',
    type: 'line',
    source: 'line',
    paint: {
      'line-color': 'rgba(2, 6, 23, 0.9)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2.5, 12, 4, 16, 7]
    }
  })
  layers.push({
    id: 'line-track',
    type: 'line',
    source: 'line',
    paint: {
      'line-color': routeColorExpr,
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 12, 2.2, 16, 3.6],
      'line-opacity': 0.95
    }
  })

  // ---------- 立柱点(circle + cluster + 标签)----------
  layers.push({
    id: 'column-cluster',
    type: 'circle',
    source: 'column',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#b45309',
      'circle-stroke-color': '#fbbf24',
      'circle-stroke-width': 1.5,
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        11,
        20, 14,
        100, 18,
        500, 23
      ],
      'circle-opacity': 0.9
    }
  })
  layers.push({
    id: 'column-cluster-count',
    type: 'symbol',
    source: 'column',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['concat', ['to-string', ['get', 'point_count']], ''],
      'text-font': [FONT_STACK],
      'text-size': 11,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport'
    },
    paint: {
      'text-color': '#fff7ed',
      'text-halo-color': '#78350f',
      'text-halo-width': 1.2
    }
  })
  layers.push({
    id: 'column-point',
    type: 'circle',
    source: 'column',
    filter: ['!', ['has', 'point_count']],
    minzoom: ZOOM.column,
    paint: {
      'circle-color': '#fbbf24',
      'circle-stroke-color': '#78350f',
      'circle-stroke-width': 1,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13.6, 2.6, 17, 5],
      'circle-opacity': 0.95
    }
  })
  layers.push({
    id: 'column-label',
    type: 'symbol',
    source: 'column',
    filter: ['!', ['has', 'point_count']],
    minzoom: ZOOM.columnLabel,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': [FONT_STACK],
      'text-size': 10.5,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
      'text-allow-overlap': false,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport'
    },
    paint: {
      'text-color': '#fde68a',
      'text-halo-color': '#1c1917',
      'text-halo-width': 1.4
    }
  })

  // ---------- 焊缝标记 ----------
  layers.push({
    id: 'weld-cluster',
    type: 'circle',
    source: 'weld',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#9d174d',
      'circle-stroke-color': '#f472b6',
      'circle-stroke-width': 1.5,
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        10,
        20, 13,
        100, 17,
        500, 22
      ],
      'circle-opacity': 0.9
    }
  })
  layers.push({
    id: 'weld-cluster-count',
    type: 'symbol',
    source: 'weld',
    filter: ['has', 'point_count'],
    layout:
      // 合并后显示数量(>=1000 缩写为 Nk)
      {
        'text-field': [
          'step',
          ['get', 'point_count'],
          ['to-string', ['get', 'point_count']],
          1000,
          ['concat', ['to-string', ['floor', ['/', ['get', 'point_count'], 1000]]], 'k']
        ],
        'text-font': [FONT_STACK],
        'text-size': 10.5,
        'text-rotation-alignment': 'viewport',
        'text-pitch-alignment': 'viewport'
      },
    paint: {
      'text-color': '#fce7f3',
      'text-halo-color': '#831843',
      'text-halo-width': 1.2
    }
  })
  layers.push({
    id: 'weld-point',
    type: 'circle',
    source: 'weld',
    filter: ['!', ['has', 'point_count']],
    minzoom: ZOOM.weld,
    paint: {
      'circle-color': '#f472b6',
      'circle-stroke-color': '#831843',
      'circle-stroke-width': 1,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.2, 2.2, 18, 4.2],
      'circle-opacity': 0.95
    }
  })
  layers.push({
    id: 'weld-label',
    type: 'symbol',
    source: 'weld',
    filter: ['!', ['has', 'point_count']],
    minzoom: ZOOM.weldLabel,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': [FONT_STACK],
      'text-size': 10,
      'text-offset': [0, -1.1],
      'text-anchor': 'bottom',
      'text-optional': true,
      'text-allow-overlap': false,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport'
    },
    paint: {
      'text-color': '#fbcfe8',
      'text-halo-color': '#1c1917',
      'text-halo-width': 1.4
    }
  })

  // ---------- 标注层(车站大标注 + 分段小标注)----------
  layers.push({
    id: 'label-station',
    type: 'symbol',
    source: 'label',
    filter: ['==', ['get', 'kind'], 'station-label'],
    layout: {
      'text-field': ['get', 'text'],
      'text-font': [FONT_STACK],
      'text-size': ['interpolate', ['linear'], ['zoom'], 0, 13, 12, 16],
      'text-optional': false,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 8,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport'
    },
    paint: {
      'text-color': '#f8fafc',
      'text-halo-color': '#0f172a',
      'text-halo-width': 2
    }
  })
  layers.push({
    id: 'label-segment',
    type: 'symbol',
    source: 'label',
    filter: ['==', ['get', 'kind'], 'segment-label'],
    minzoom: ZOOM.segmentLabel,
    layout: {
      'text-field': ['get', 'text'],
      'text-font': [FONT_STACK],
      'text-size': 11,
      'text-optional': true,
      'text-allow-overlap': false,
      'text-padding': 6,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport'
    },
    paint: {
      'text-color': '#cbd5e1',
      'text-halo-color': '#0f172a',
      'text-halo-width': 1.4
    }
  })

  // ---------- 联动高亮层(最上层)----------
  layers.push({
    id: 'sel-line',
    type: 'line',
    source: 'selection',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': '#fde047',
      'line-width': 5,
      'line-opacity': 0.95
    }
  })
  layers.push({
    id: 'sel-fill',
    type: 'fill',
    source: 'selection',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#fde047', 'fill-opacity': 0.22 }
  })
  layers.push({
    id: 'sel-fill-outline',
    type: 'line',
    source: 'selection',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'line-color': '#fde047', 'line-width': 2.5, 'line-opacity': 0.95 }
  })
  layers.push({
    id: 'sel-point',
    type: 'circle',
    source: 'selection',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 9,
      'circle-color': '#fde047',
      'circle-stroke-color': '#713f12',
      'circle-stroke-width': 2,
      'circle-opacity': 0.95
    }
  })

  return layers
}

/** 每个 source 对应的渲染图层 id(用于可见性开关与框选查询)。 */
export const LAYER_GROUPS = {
  line: ['line-casing', 'line-track'],
  column: ['column-cluster', 'column-cluster-count', 'column-point', 'column-label'],
  weld: ['weld-cluster', 'weld-cluster-count', 'weld-point', 'weld-label'],
  clearance: ['clearance-fill', 'clearance-outline'],
  label: ['label-station', 'label-segment']
}

/** 可被点击/框选命中的几何图层(不含 cluster 计数 symbol 与高亮层)。 */
export const PICK_LAYERS = [
  'line-casing',
  'line-track',
  'column-cluster',
  'column-point',
  'weld-cluster',
  'weld-point',
  'clearance-fill',
  'clearance-outline'
]

/**
 * 把逻辑图层 spec 解析为某个地图实例的真实 spec:
 * 图层 id 与 source 引用都加上 instanceId 前缀,保证三个地图的 worker
 * 状态互不干扰。LAYER_GROUPS / PICK_LAYERS 里仍是逻辑名,通过
 * instanceLayerId 转成真实名后再调用 MapLibre API。
 */
export function instanceLayerId(instanceId, logicalLayerId) {
  return `${instanceId}__${logicalLayerId}`
}

export function resolveLayerForInstance(layer, instanceId) {
  const resolved = { ...layer, id: instanceLayerId(instanceId, layer.id) }
  if (layer.source) resolved.source = sourceName(instanceId, layer.source)
  return resolved
}
