# 激流赛道障碍布置工作室

基于 **TypeScript + SolidJS + Three.js + manifold-3d** 的三维激流赛道障碍布置工具。设计师可以从障碍库拖入岩石、浮标和人工障碍，使用手柄和平移/旋转数值面板布置赛道，并通过 Manifold 布尔运算检查航道占道、障碍穿插与暗礁风险。

## 启动

```bash
npm install
npm run dev
```

浏览器打开 Vite 输出的地址（默认 `http://127.0.0.1:5173`）。

生产构建：

```bash
npm run build
npm run preview
```

`manifold-3d` 的 WASM 通过 Vite 的 `?url` 资源方式加载，构建时会自动输出到 `dist/assets/`。

## 已实现能力

### 01 · 障碍库

- 10 个参数化模板：花岗岩孤石、扁平片岩、潜伏暗礁、红色门标浮筒、黄色警示浮球、双筒悬挂浮标、混凝土障碍墩、回转门架、桥墩、斜向导流坎。
- 支持搜索、分类筛选。
- 卡片可直接拖入三维河道，落点通过水面射线求交得到；也可点击卡片直接添加。
- 所有障碍均带 Three.js 可视化和对应的 Manifold 包围实体描述（盒体、圆柱体或复合实体）。

### 02 · 摆放变换

- 选中后显示 Three.js `TransformControls`：
  - `W`：平移手柄；
  - `E`：旋转手柄；
  - `F`：聚焦选中；
  - `Esc`：取消选择。
- 支持位置 X/Y/Z、旋转 X/Y/Z 数值输入。
- 岩石和所有障碍支持 X/Y/Z 轴向缩放，拖动滑杆时实时变形。
- 浮标支持“悬挂高度 / 中心距水面”调整，并在选中时显示水面到浮标的测量虚线。
- 每个障碍可设置露出水面高度；低于暗礁阈值时，视口和检测面板会标记“暗礁”。
- 支持多选、`Shift` 点选、`Ctrl/⌘+D` 复制、`Delete` 删除。
- 分组后点击组内任意对象会选中整组；手柄绕整组质心变换，同组障碍一起移动、旋转。
- 支持编组、命名、颜色、选中整组、解散分组、删除整组。
- 可从选中浮标或默认门标模板沿真实河道曲线生成等距列，数量 2–40；生成后自动建组，之后可拖动“等间距”滑杆重新分布。

### 03 · 碰撞检测

碰撞引擎位于 `src/geometry/CollisionEngine.ts`：

1. 根据河道曲线生成若干倾斜盒段，并用 Manifold `add()` 合并为航道可用区域实体。
2. 按每个障碍的 `ColliderSpec` 创建盒、圆柱或复合 Manifold。
3. 使用 Three.js 矩阵生成世界坐标包围实体。
4. 调用 `channel.intersect(obstacle)` 计算与航道区域的交集体积。
5. 对障碍做包围球宽相筛选，再调用 `a.intersect(b)` 计算两两穿插体积。
6. 拖动、缩放、改参数、撤销重做或批量重排后，以节流方式自动重新求交。

可调整：

- 占道重叠体积阈值；
- 障碍穿插体积阈值；
- 暗礁露出高度阈值；
- 包围实体、航道可用区域、风险标签显示开关。

超阈值占道显示红色包围盒和“占道”标记，穿插显示紫色“穿插”标记，暗礁显示蓝色“暗礁”标记。

### 04 · 方案导出

- 导出 `.rros.json`（标准 JSON）方案文件，包含：
  - 方案名称和格式版本；
  - 河道参数；
  - 检测阈值和显示设置；
  - 全部障碍的位置、旋转、缩放、露出高度、悬挂高度、颜色和碰撞体；
  - 分组及批量等距列配置。
- 支持下载文件、复制 JSON、重新导入分享文件。
- 导入会进入撤销历史。

## 撤销 / 重做

历史中心在 `src/state/projectStore.ts`，保存完整 `ProjectDocument` 快照：

- 放置障碍；
- 手柄变换；
- 数值变换和轴向缩放；
- 删除、复制；
- 编组、解散、整组删除；
- 批量生成和间距调整；
- 导入方案。

快捷键：

- `Ctrl/⌘ + Z`：撤销；
- `Ctrl/⌘ + Shift + Z` 或 `Ctrl + Y`：重做。

连续滑杆和手柄拖动通过 `beginGesture()` / `endGesture()` 合并为一条历史记录。

## 代码结构

```text
src/
├─ App.tsx                         # 应用外壳、快捷键、模块切换
├─ main.tsx
├─ styles.css
├─ types.ts                        # 文档、障碍、分组、碰撞类型
├─ river.ts                        # 河道曲线、里程/横向偏移、带状几何
├─ data/library.ts                 # 障碍库模板与碰撞体参数
├─ geometry/CollisionEngine.ts     # manifold-3d 布尔求交
├─ state/projectStore.ts           # Solid store、历史、分组、批量逻辑
├─ state/collisionController.ts
├─ lib/scheme.ts                   # 方案序列化、解析和兼容校验
├─ lib/obstacleMath.ts
├─ three/RiverSceneManager.ts      # Three.js 场景、视角、手柄、高亮
├─ three/obstacleFactory.ts        # 参数化障碍外观和包围线框
└─ components/
   ├─ LibraryPanel.tsx
   ├─ TransformPanel.tsx
   ├─ CollisionPanel.tsx
   ├─ ExportPanel.tsx
   ├─ InspectorCard.tsx
   ├─ TopBar.tsx
   ├─ Viewport.tsx
   └─ controls.tsx
```

## 验证说明

已执行：

```bash
npm run build
```

TypeScript 严格检查和 Vite 生产构建均通过。另可用本机 Chrome/Edge 进行 WebGL 冒烟检查；`scripts/smoke-test.mjs` 是开发环境使用的 CDP 冒烟脚本，不会参与应用运行。
