# 过山车轨道布局要素总览图

基于 **Vue 3 + MapLibre GL JS** 的多视图 GIS 应用,对一个主题公园内 8 条过山车线路的
轨道要素(中心线、立柱、焊缝、限界框、标注)进行分层渲染、框选联动与三视图同步。

## 运行

```bash
npm install
npm run dev        # 开发服务器(默认 http://localhost:5173)
npm run build      # 生产构建到 dist/
npm run preview    # 预览生产构建
```

冒烟测试(无头 Chromium,覆盖 25 项功能断言):

```bash
npm run preview &     # 先起预览服务器
node scripts/smoke.mjs
```

数据校验:`node scripts/verify-data.mjs`

## 数据规模

合成数据由 `src/data/generator.js` 确定性生成(局部米制坐标转经纬度),共约 **2.7 万个要素**:

| 要素类型 | 数量(约) | 说明 |
| --- | --- | --- |
| 中心线分段 | 500+ | 每 100m 一段,LineString |
| 立柱点 | 1 万+ | 沿线路每 5m 一个 |
| 焊缝点 | 1.6 万+ | 双轨,每 6m 一道 |
| 限界框 | 130+ | 每 4 个分段一个,Polygon |
| 标注 | 500+ | 车站大标注 + 分段小标注 |

## 分层与缩放规则

每个要素类型一个独立 GeoJSON source,图层可见性可单独开关:

- **Z ≤ 13**:仅骨架中心线 + 车站大标注;立柱/焊缝以聚类圆点 + 数字呈现
- **Z 13.6+**:立柱点逐个显示(聚类 `clusterMaxZoom=13`)
- **Z 15.2+**:焊缝点逐个显示
- **Z 16.2+**:限界框按段绘制
- 低缩放重叠点通过 supercluster 自动合并为带 `point_count` 的聚类

## 核心交互

- **缩放/平移/旋转**:滚轮缩放、拖拽平移、右键旋转;视口外要素由 MapLibre 自动裁剪
- **框选**:工具栏开启框选模式,或按住 `Shift` 拖拽;聚类会展开为叶子要素
- **图层开关**:关闭的图层不参与 `queryRenderedFeatures`,因此框选不会命中隐藏层
- **右侧列表**:虚拟滚动(2.7 万行不卡顿),支持类型/线路筛选;点击列表项地图飞行定位
- **三视图联动**:主视图 + 两个小视图共享同一个 Vuex 风格 store,任一视图框选/选中,
  另外两个视图同步高亮同一批要素
- **标注避让**:所有 symbol 层使用 `text-rotation-alignment: viewport`,旋转视角下文字始终正向,
  配合碰撞检测(`text-allow-overlap: false`)自动让位

## 关键工程决策

### 1. 数据 source 实例前缀 + 统一挂载协调器

三个 Map 实例共享 MapLibre 的全局 Web Worker 池。若在各自 `load` 回调里并发挂载同名
大体积 GeoJSON source,worker 端会出现状态竞争。方案:

- 每个地图的 source/图层 id 都带实例前缀(`main__line`、`mini-1__column` …),
  由 `styleFactory.js` 的 `sourceName` / `resolveLayerForInstance` 统一生成
- `map/initQueue.js` 作为全局屏障:等三个地图都 `idle` 并静置后,逐地图、逐 source
  串行挂载,每个 source 等其就绪再挂下一个

### 2. supercluster 的 clusterMaxZoom 必须为整数

supercluster 内部用 `new Array(maxZoom + 1)` 分配缩放层级数组,小数(如 `16.4`)会抛
`RangeError: Invalid array length`,导致整个 source 静默失败。

### 3. 字形本地化 + 无空格字体栈名

中文字形 PBF 放在 `public/glyphs/noto-cjk/`,完全离线。字体栈名用无空格短名,
避免空格被百分号编码后静态文件服务器回退到 SPA 的 `index.html`(返回 HTML 而非 PBF)。

### 4. MapLibre 版本

使用 MapLibre GL JS **v5**。v4 在 symbol 图层作用于 cluster source 时存在 worker 端
PBF 处理缺陷(字形区间加载异常会使整个点 source 静默失效);v5 改为字形缺失时本地
降级渲染,不再影响 source 数据通路。

## 目录结构

```
src/
├── data/generator.js        # 确定性合成数据(8 条线路、2.7 万要素)
├── map/
│   ├── styleFactory.js      # source/layer 样式规格、实例前缀映射、缩放阈值
│   └── initQueue.js         # 跨地图的数据挂载屏障与串行队列
├── store/useStore.js        # 全局响应式状态(选中、框选、图层开关)
├── components/
│   ├── MapView.vue          # 单地图实例(框选、拾取、高亮、定位跟随)
│   ├── SidePanel.vue        # 虚拟滚动要素列表 + 筛选
│   └── LayerPanel.vue       # 图层开关与缩放规则说明
└── App.vue                  # 主视图 + 两小视图 + 侧栏布局
```
