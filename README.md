# 婚礼场地布置建模工具

基于 **SolidJS + three.js + three-mesh-bvh** 的浏览器端 3D 婚礼场地布置工具。
纯前端运行，数据保存在浏览器 localStorage，通过导出/导入 JSON 文件分享与协作。

## 功能一览

| 模块 | 能力 |
| --- | --- |
| 场地平面 | 矩形 / 多边形区域绘制，区域尺寸与旋转可精确编辑 |
| 物体摆放 | 16 种预设物体（桌椅、舞台、装饰、设施），真实尺寸，可旋转/缩放 |
| 吸附对齐 | 网格吸附 + 物体边缘/中心线吸附，阈值可调，Alt 临时关闭，实时辅助线 |
| 碰撞检测 | 空间哈希宽相 + SAT 精确检测，重叠与越界放置自动阻止 |
| 场景预览 | 透视 / 俯视一键切换，按类别隐藏图层，框选多选整体变换 |
| 撤销重做 | 命令栈（100 步），覆盖增删、移动旋转、吸附调整，拖动合并为单条历史 |
| 性能 | InstancedMesh 实例化渲染 + BVH 射线加速，2500 物体流畅操作 |
| 数据 | localStorage 自动保存，`.wvp.json` 文件导出分享、导入续编 |

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
```

### 自动化验证

```bash
node scripts/e2e-check.mjs         # 13 项端到端交互测试（需先 npm run dev）
node scripts/make-screenshots.mjs  # 生成演示场景截图
```

## 操作指南

| 操作 | 方式 |
| --- | --- |
| 绘制区域 | 顶部选择「矩形区域」拖拽，或「多边形区域」左键加点、双击/右键闭合 |
| 放置物体 | 左侧物体库点击物体，在场地内点击放置（连续放置），`R` 旋转 90°，Esc 退出 |
| 移动 | 左键拖动物体；方向键微调 0.1m |
| 旋转 | Shift + 拖动，或 Shift + 方向键（15° 步进） |
| 框选 | 选择模式下在空白处按住左键拖拽 |
| 视角 | 右键旋转、中键平移、滚轮缩放；顶部按钮切换俯视/透视 |
| 吸附 | 拖动时自动吸附；按住 Alt 临时关闭；右侧面板调间距与阈值 |
| 删除 | Delete / Backspace，或属性面板删除按钮 |
| 撤销重做 | Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z 同为重做） |

## 架构

```
src/
├── types.ts              # 领域模型与项目文件格式
├── catalog.ts            # 物体库（16 种预设，真实米制尺寸）
├── lib/
│   ├── math2d.ts         # OBB/圆、SAT 碰撞、多边形包含
│   ├── collision.ts      # 空间哈希宽相 + 批量移动校验 + 区域约束
│   ├── snap.ts           # 网格/物体边缘/角度吸附引擎与辅助线
│   ├── geometry.ts       # 程序化建模，按材质合并几何体
│   ├── history.ts        # 撤销重做命令栈
│   └── storage.ts        # localStorage 持久化与文件导入导出/校验
├── store/store.ts        # SolidJS store 中枢（状态、选择、碰撞、历史、自动保存）
├── three/
│   ├── ground.ts         # 区域 Shape 合并 + MeshBVH 地面拾取
│   ├── instanced.ts      # 按 catalog 分 InstancedMesh，矩阵/颜色增量更新
│   ├── engine.ts         # 渲染器、相机、OrbitControls、辅助对象
│   └── controller.ts     # 指针/键盘交互状态机
└── components/           # SolidJS UI（工具栏、物体库、右侧面板、视口）
```

### 关键设计

- **渲染性能**：同类物体共享合并几何体，每材质槽一个 `InstancedMesh`，
  数千物体仅数十个 draw call；拖动只更新实例矩阵，不重建场景。
- **拾取性能**：区域地面用 `three-mesh-bvh` 构建 BVH，射线查询为对数复杂度；
  另有不可见基底平面保证未绘制区域时也能拾取地面。
- **碰撞正确性**：均匀网格宽相只检测相邻格内物体，窄相用 SAT（OBB-OBB）、
  最近点（OBB-圆）与距离（圆-圆）；批量变换按组互斥、组外禁重处理。
- **吸附**：对 AABB 的两条边缘与中心线生成候选对齐线，在阈值内取最小修正，
  输出蓝（网格）/红（物体）辅助线；碰撞校验失败时逐级回退直至放弃本帧。
- **数据可移植**：导出文件带 `magic: "WVP"` 与版本号，导入时结构校验并兜底修复。

## 项目文件格式（`.wvp.json`）

```json
{
  "magic": "WVP",
  "version": 1,
  "name": "我的婚礼",
  "regions": [{ "type": "rect", "id": "...", "x": 0, "z": 0, "width": 30, "depth": 20, "rotation": 0, "color": "#9fc3e8" }],
  "objects": [{ "id": "...", "catalogId": "round-table", "x": 1, "z": 2, "rotation": 0, "scale": 1, "visible": true, "...": "..." }],
  "snap": { "gridEnabled": true, "objectEnabled": true, "gridSize": 1, "threshold": 0.35 }
}
```

## 技术栈

SolidJS 1.9 · three.js 0.172 · three-mesh-bvh 0.8 · TypeScript 5.7 · Vite 6
