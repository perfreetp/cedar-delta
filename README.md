# 人流疏散方案 · 分层要素视图

把一个园区的人流疏散要素(点位 / 路径段 / 区域面)按图层和缩放档位分层展开,
两个视图联动,支持框选、标注避让与方案存档。技术栈:**SolidJS + ECharts**。

要素规模约 **4.2 万**(4 万普通点位、1 240 条路径、34 个区域面、160 出口、200 楼梯、180 危险源、12 集合点),
平移 / 缩放 / 旋转时逐帧渲染开销 **p95 ≤ 8 ms**(预算 16.7 ms ≈ 60fps)。

---

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 生产构建到 dist/
npm run typecheck  # tsc --noEmit
```

验收脚本(需要先 `npm run build`,脚本会自己起静态服务):

```bash
node verify/acceptance.mjs   # 45 项需求逐条验收
node verify/perf.mjs         # 帧耗时门禁
node verify/gallery.mjs      # 生成分层截图到 verify/screens/
```

---

## 为什么这样渲染

需求是「几万个点位 + 路径 + 面」在一个画布里跟着鼠标动。我先用真实数据量做了三轮基准:

| 方案 | 4.2 万要素单帧 | 结论 |
|---|---|---|
| ECharts `custom` series(每要素一个 item) | p50 29 ms **@ 仅 2 000 要素** | 不可用,量级上升就崩 |
| 每个要素一个 zrender Displayable | p50 37 ms / p90 152 ms | 遍历与对象开销过大 |
| **相机变换 + 网格裁剪 + 单个 Path 批量承载同类图元** | **p50 1–6 ms @ 4.2 万** | 采用 |

所以架构是:ECharts 实例持有画布与 zrender 引擎(`chart.getZr()` 是官方公开 API),
要素由 `FeatureRenderer` 直接以**少量批量 Path** 画到 zrender 上 —— 一次 `buildPath` 画上万个点,
遍历成本与图元数量解耦。ECharts 仍负责画布、DPR、resize 与统计图表。

`src/render/batch-shapes.ts` 里每种符号都是一个批量图元:普通点位(方块)、危险源(三角)、
出口(箭头)、楼梯(阶梯)、集合点(圆环)、路径(折线)、区域(多边形)、选中光晕。

---

## 需求实现对照

| 需求 | 实现位置 |
|---|---|
| 出口 / 楼梯 / 集合点 / 危险源 分图层,可单独开关 | `src/ui/LayerPanel.tsx` + `FeatureRenderer` 每层一条绘制通道 |
| 关掉面层只剩路径线 | 图层互相独立,验收脚本中有对应用例 |
| 全局只画区域轮廓 + 汇总点 | `src/core/lod.ts` 档位 0:`areaMode='outline'`、`pointMode='summary'` |
| 楼栋级展开每个出口与每段路径 | 档位 1:`pointMode='individual'`、`pathMode='full'` |
| 楼层级出每个点位标注 | 档位 2/3,标注受预算与避让裁剪 |
| 平移缩放跟得上 | 画布坐标批量 + 交互期采样降级(`MapView.markInteracting`) |
| 标注互相让位,挤时优先留出口与危险源 | `src/render/LabelEngine.ts`(优先级 + 屏幕空间哈希) |
| 转角度标注不叠成一团 | 标注始终水平、在旋转后的屏幕坐标上做轴对齐矩形判定 |
| 拖框选一批,两视图同步高亮 | `src/render/picking.ts` + 共享 `selection` |
| 点一个要素另一个视图滚过去 | `store.requestFollow()` → `MapView` 里的定位请求 |
| 图层拖拽重排,危险源压最上 | `LayerPanel` 原生拖拽 + `Alt+↑/↓`;`normalizeLayerOrder()` 固定危险源置顶 |
| 缩放档位分级,每级可配图层 | `src/ui/LodPanel.tsx` |
| 方案能存,下次还原缩放与图层状态 | `src/core/persist.ts`(localStorage 自动保存 + 命名预设 + JSON 导入导出) |

---

## 目录

```
src/
  types.ts                 数据模型(SoA:并行数组而非对象数组)
  data/generate.ts         确定性生成约 4.2 万要素(固定种子,刷新后一致)
  data/grid-index.ts       均匀网格空间索引(带版本戳去重,零分配查询)
  core/camera.ts           世界↔屏幕变换、视野包围盒、相机缓动
  core/lod.ts              档位定义与「本帧渲染决策表」
  core/persist.ts          状态校验/修补、localStorage、预设
  core/store.ts            应用状态与选中集
  render/batch-shapes.ts   批量图元(一次 buildPath 画 N 个符号)
  render/FeatureRenderer.ts 裁剪、采样、高亮、图层绘制
  render/LabelEngine.ts    标签订位与碰撞避让
  render/picking.ts        点选与框选命中
  render/interaction.ts    平移 / 缩放 / 旋转 / 框选的原生事件处理
  render/EChartHost.tsx    ECharts 实例宿主(resize / DPR)
  ui/                      双地图、图层、档位、工具栏、详情、统计图
```

---

## 操作

- **平移**:左键拖动
- **缩放**:滚轮(以指针为锚点)
- **旋转**:右键拖动,或 `Alt` + 左键拖动;按住 `Shift` 吸附 15°
- **多选**:按住 `Shift` 拖框,或点工具栏「框选」后拖框
- **加选 / 取消**:单击时按住 `Shift`
- **清空选择**:`Esc`
- **图层排序**:拖拽图层行,或聚焦后 `Alt+↑/↓`(危险源固定置顶)

---

## 已知取舍

- **档位阈值按「每世界单位像素数」判定**,不随画布宽高变化。窄屏下 fit-all 的 zoom 更小,
  因此更容易落在全局档;宽屏则更容易进楼栋档 —— 需要时可在「缩放档位」面板直接改阈值。
- **交互期普通点位会采样**(4 万点里取 1 400 个),但出口 / 楼梯 / 危险源 / 集合点全量绘制,
  松手 150 ms 后自动补全精度并重排标注。
- **标注数量受档位预算约束**,放不下的普通点位标注直接收起,不会压到别的标注上。
- 本版不含时间推进的疏散播放(架构上已预留:要素模型是纯数据,可外挂时间序列)。
