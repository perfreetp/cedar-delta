# 花门骨架造型器 · Arch Atelier

一个使用 **TypeScript + Vue 3 + Three.js + manifold-3d** 构建的婚礼花门骨架与花材路径分布工具。

## 功能

- 一花门 = 一根主弧线骨架 + 左右两根立柱 + 两个底座。
- 主弧线由 **6 个控制点**编辑，使用 centripetal Catmull-Rom 曲线实时重建。
- 点击控制点高亮，拖动时禁用视角旋转；提示当前总弧长、弧上位置、曲率 κ 与曲率半径。
- 切换 **半圆拱 / 尖拱 / 自由曲线** 预设时重置 6 个控制点。
- 使用 `manifold-3d` 将主弧线、立柱与底座焊接后执行布尔并集，输出单一水密网格。
- 花材沿主弧线路径分布：
  - 轻盈：0.46 m 间距，2 朵/节点；
  - 标准：0.30 m 间距，4 朵/节点；
  - 繁密：0.20 m 间距，7 朵/节点。
- 花材朝向根据路径切线和局部 Frenet 标架自动旋转，并加入自然随机倾角。
- 使用空间哈希进行相邻花材最小距离避让；随机尝试失败后使用扩展环布点兜底，保证节点花材数量。
- 支持玫瑰、芍药、尤加利叶、小野花四种程序化花材，切换类型后重新分布。
- 支持整体缩放。
- 顶部工具栏支持 **沿路径均匀分布** 与 **随机抖动**，抖动范围可调。
- 底部支持撤销/重做（`Ctrl/Cmd + Z`、`Ctrl/Cmd + Shift + Z`），记录控制点拖动、预设切换、密度调整、花材切换等操作。
- 方案自动保存到 `localStorage`，可导出 JSON 文件分享，也支持导入 JSON。

## 运行

```bash
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
npm run preview
```

## 主要目录

```text
src/
├── App.vue                    # 全局状态、历史记录、本地保存、JSON 导入导出
├── components/
│   ├── TopToolbar.vue         # 分布模式、抖动范围、导入导出
│   ├── LeftPanel.vue          # 骨架预设、结构与 Manifold 状态
│   ├── RightPanel.vue         # 密度、花材、缩放与统计
│   ├── BottomBar.vue          # 撤销/重做
│   └── Viewport.vue           # Three.js 视口容器与布尔任务调度
└── arch/
    ├── ArchScene.ts           # 场景、地面、网格、控制点拾取与拖动
    ├── config.ts              # 预设、密度与花材配置
    ├── curve.ts               # 曲线、弧长位置与曲率计算
    ├── distribution.ts        # 路径采样、抖动、聚类与距离避让
    ├── flowerGeometry.ts      # 程序化花材 Geometry 与实例化渲染数据
    ├── manifoldUnion.ts       # manifold-3d WASM 初始化与布尔合并
    ├── skeletonParts.ts       # 弧线、立柱、底座几何
    ├── tubeGeometry.ts        # 封口管几何
    └── storage.ts             # localStorage 与 JSON 数据校验
```

## 说明

- 世界单位按“米”建模，因此弧长、间距、抖动范围和曲率均以米制单位显示。
- Three.js 中骨架在拖动时立即重建实时网格；指针释放后再运行 Manifold 布尔并集，避免 WASM 布尔阻塞拖动。
- Manifold 输入前会将仅含位置属性的几何体重合顶点焊接，以满足 oriented 2-manifold 输入要求。
