# 陨石坑撞击展陈 · 时间轴编排工具

基于 **原生 TypeScript + Web Components + Babylon.js** 的陨石撞击展陈动画时间轴编排工具。
无前端框架，UI 全部由 Custom Elements + Shadow DOM 构成；3D 场景与相机动画由 Babylon.js 驱动。

## 快速开始

```bash
npm install
npm run dev        # 启动开发服务器（默认 http://127.0.0.1:5173）
npm run build      # 类型检查 + 生产构建到 dist/
npm test           # 单元测试（18 项，纯逻辑：缓动/嵌套映射/序列化）
npm run e2e        # 端到端冒烟测试（Playwright + headless Chromium，15 项）
```

> e2e 需要先 `npm run dev` 启动 dev server，可用 `BASE_URL` 环境变量指定地址。

## 需求与实现对照

| 需求 | 实现位置 |
| --- | --- |
| 原生 TS + Web Components 界面 | `src/ui/*`（`cr-app`/`cr-toolbar`/`cr-timeline`/`cr-ruler`/`cr-inspector`） |
| Babylon.js 场景与相机动画 | `src/scene/scene.ts` |
| 可调半径与深度的陨石坑 + 环形山脊 | `CraterScene.rebuildCraterGeometry()`，径向剖面程序化网格，半径/深度/山脊高度三参数 |
| 相机路径 / 陨石坑生长 / 喷出物扩散三类轨道 | `core/model.ts` 的 `camera` / `crater` / `ejecta` 三类叶子轨 |
| 每轨关键帧 + 线性/缓动/阶跃三种插值 | `core/easing.ts`，关键帧可单独覆盖轨道默认插值 |
| 轨道编组为父轨并嵌套子轨，最多三层 | `MAX_DEPTH=3`，`store.groupTracks()` 与 `validateDocument()` 双重约束 |
| 拖播放头时各轨按嵌套关系同步预览 | `evaluator.evaluateTimeline()` 纯函数，scrub 与播放共用 |
| 改父轨缓动后子关键帧按新曲线重排时间位置 | 关键帧存局部比例 [0,1]，全局位置经各级父分组缓动正映射实时计算（`globalTimeOfLocal`），改曲线即重排，局部数据不变 |
| 相机沿弧线运动并带朝向约束 | 球面坐标（半径/方位角/俯仰角）插值换算位置，`target` 目标点独立插值做朝向约束 |
| 拖动预览与点播放回放结果一致 | 两条路径都调用同一个 `evaluateTimeline()` 纯函数，e2e 断言相机半径/方位角严格相等（误差 0） |
| 轨道静音与单独回放（独奏） | 叶子轨 `muted` 标志 + `store.soloTrackId`，控制器统一过滤 |
| 时间线长度以秒为单位可拉伸 | 头部「时间线长度」输入，`store.setDuration()` 钳制轨道 |
| 关键帧复制到指定时间点 | `store.copyKeyframeAt(trackId, kfId, globalTime)`，检查器可输入目标秒数 |
| 整条时间线导出/导入 JSON，层级/时间/插值完全还原 | `store.exportJSON()` / `loadJSON()` + `validateDocument()` 全量校验，单测与 e2e 均断言往返一致 |
| 拖动时显示当前时间与各轨激活状态 | 时间轴底部状态栏：当前时间、激活轨名称列表、静音/独奏状态 |
| 回放中可暂停并继续编辑 | `PlaybackController.pause()` 后所有编辑操作可用，文档变更立即按当前播放头重渲染 |

## 核心架构

```
src/
├── core/                 纯逻辑层（不依赖 DOM/Babylon，可单测）
│   ├── model.ts          数据模型：文档/轨道/关键帧、三层嵌套约束
│   ├── easing.ts         三种插值 + smoothstep 数值反函数 + 段定位
│   ├── evaluator.ts      evaluateTimeline() 纯函数：嵌套时间映射与状态求值
│   ├── store.ts          状态仓库：所有变更操作、编组、序列化、导入校验
│   ├── playback.ts       播放控制器：rAF 播放/scrub，与评测引擎同源
│   └── registry.ts       组件单例注册表（处理自定义元素连接时序）
├── scene/
│   └── scene.ts          Babylon 场景：陨石坑网格、环形山脊、thin instance 喷出物、粒子粉尘、相机
└── ui/                   Web Components（Shadow DOM 样式隔离）
    ├── cr-app.ts         外壳，装配 store/scene/playback
    ├── cr-toolbar.ts     导入导出、新建、独奏指示
    ├── cr-timeline.ts    轨道树 + 泳道 + 播放头 + 关键帧拖拽
    ├── cr-ruler.ts       canvas 刻度尺，自适应刻度，点击/拖动 scrub
    └── cr-inspector.ts   轨道与关键帧参数编辑
```

### 嵌套时间映射（三层）

关键帧时间存为所属轨道的**局部比例** `u ∈ [0,1]`，而非全局秒。

- 正向（局部→全局）：每级把内部比例经父分组缓动 `f` 映射后向上折算
  `globalTimeOfLocal()`
- 逆向（全局→局部）：每级用 `f⁻¹` 反解
  `localTimeAt()`
- 因此修改父分组的缓动曲线，子关键帧的全局位置自动按新曲线重排，而局部关键帧数据保持不变。
- `smoothstep` 的反函数用 40 次二分实现（误差 < 2⁻⁴⁰），保证正反映射严格互逆。

### 「所见即所播」的保证

`PlaybackController` 只有一个渲染入口 `renderAt(time)`：

- 正式播放：rAF 累加墙钟时间 → `setTime` → `renderAt`
- 拖动预览：`scrub` → `renderAt(force)`
- 暂停编辑：文档变更事件 → `refresh()` → `renderAt(force)`

三者最终都调用 `evaluateTimeline(doc, time)` 这个纯函数，场景只是该函数输出的渲染器，
所以任意时间点的画面与播放经过该点时逐帧一致。

## 交互说明

- **刻度尺/播放头**：点击或拖动刻度尺任意位置即跳转（scrub）
- **关键帧**：双击泳道空白处添加；双击关键帧复制到当前播放头；拖动关键帧移动（自动经父级缓动逆映射换算）；检查器中可精确编辑
- **轨道**：点击选中，双击名称重命名；「静」静音、「独」独奏、「删」删除
- **编组**：选中轨道后点「编组选中」，分组缓动曲线即作用于其下所有子轨的时间重映射
- **空格**：播放/暂停
- **3D 视口**：左键旋转、右键平移、滚轮缩放；时间轴驱动相机时自动接管，手动控制可经 `enableUserCameraControl()` 交还

## JSON 文档格式

```jsonc
{
  "version": 1,
  "duration": 20,              // 时间线总长度（秒）
  "tracks": [                  // 第 1 层
    {
      "id": "...", "name": "撞击序列", "kind": "group",
      "start": 0, "duration": 20, "easing": "ease", "muted": false,
      "children": [ /* 第 2 层，可再含 group 到第 3 层 */ ]
    }
  ]
}
```

叶子轨的 `keyframes[].time` 为局部比例 [0,1]，`easing` 可选（缺省继承轨道默认值）。
导入时 `validateDocument()` 校验版本、枚举、时间区间、id 唯一性与嵌套深度，非法即拒绝。
