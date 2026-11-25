# 种植导板布置与剖切查看系统

原生 **TypeScript + Web Components + PlayCanvas 1.77** 实现的牙科种植导板交互式布置系统。
无前端框架，纯逻辑层与渲染层解耦，核心算法可在 Node 下独立单测。

## 启动

```bash
npm install
npm run dev        # 开发服务器（自动打开浏览器）
npm run build      # 类型检查 + 生产构建
npm run test       # 核心领域逻辑单测（Node，无需浏览器）
npm run test:e2e   # 全部测试（需先 npm run dev）
```

端到端测试用系统 Chrome（SwiftShader WebGL）驱动真实页面，覆盖渲染、拾取、剖切、框选、
拖拽吸附、旋转、对齐、撤销等完整交互链路。

## 八项需求与实现落点

| # | 需求 | 实现 |
|---|------|------|
| 1 | 点选套管高亮、三轴手柄移动/旋转、松手就位 | 颜色 ID 拾取（`Picking.ts`）+ 自研 `Gizmo.ts`（箭头轴/旋转环/中心块，解析射线求交）|
| 2 | 靠近牙槽嵴自动吸附、偏离弹回、手柄随牙面转向 | `core/snap.ts` 双阈值（吸附 4.5mm / 弹回 9mm）+ 参数曲面最近点 `arch.closestPoint`，吸附后四元数对齐曲面标架 |
| 3 | 剖切面切过下颌、露出套管内部和骨面、可沿轴推拉 | 空心旋转体网格（内壁真实存在）+ shader `discard` 剖切（`ClipPlane.ts`），法向轴手柄推拉 |
| 4 | 剖切状态下点选内部套管、身份不错层 | forward 与 pick 两套 shader **共用同一剖切 discard 与同一稳定 ID**，离屏颜色拾取解码 |
| 5 | 多选对齐、按首件方向摆正、等间距 | `core/align.ts`：基准姿态统一 + 沿牙弓**等弧长**分布（含脱离件边界回收）|
| 6 | 一次撤销还原布置、吸附关系、剖切位置 | `core/commands.ts` Command 栈，每条命令带含套管（snapU/V）与剖切的完整前后快照 |
| 7 | 数千标记点 + 套管同屏、跟手、远点变淡 | 标记点单次硬件实例化（1 draw call）+ shader 内按相机距离 `smoothstep` 淡出 |
| 8 | 框选整体平移、相邻件自动让开不重叠 | 屏幕框选 + `core/collision.ts` Gauss-Seidel 软碰撞迭代推挤，被推件重新贴回牙面 |

## 架构

```
src/
├─ core/            纯 TS 领域层（零引擎依赖，可 Node 单测）
│  ├─ math.ts       Vec3/Quat/射线/圆柱求交
│  ├─ arch.ts       参数化下颌牙弓与牙槽嵴曲面（吸附目标）
│  ├─ geometry.ts   空心套管旋转体、下颌骨体、标记点网格
│  ├─ snap.ts       吸附/弹回引擎
│  ├─ align.ts      对齐与等弧长分布
│  ├─ collision.ts  软碰撞避让
│  ├─ selection.ts  有序多选模型
│  ├─ commands.ts   撤销/重做快照栈
│  └─ types.ts      SleeveState / ClipState
├─ engine/          PlayCanvas 渲染与交互层
│  ├─ ViewerApp.ts     总装配与交互状态机
│  ├─ shaders.ts      自有 GLSL（forward/pick 变体、instancing、clip、淡出）
│  ├─ Picking.ts      颜色 ID 离屏拾取
│  ├─ Gizmo.ts        三轴变换手柄
│  ├─ ClipPlane.ts    剖切面与推拉手柄
│  ├─ MarkerField.ts  实例化标记点云
│  ├─ SleeveRenderer.ts 套管渲染/高亮
│  └─ OrbitCamera.ts  轨道相机
└─ components/
   └─ guide-planner.ts  <guide-planner> 自定义元素（Shadow DOM 工具栏/状态栏/框选）
```

## 关键技术决策

- **颜色 ID 拾取而非射线 mesh 求交**：剖切后能精确选中露出的内壁，且 ID 是领域稳定主键，
  剖切前后天然是同一个套管，杜绝错层。
- **逐 drawcall uniform（`MeshInstance.setParameter`）而非全局 scope**：PlayCanvas 两阶段渲染
  会先跑完全部材质再统一 draw，全局 uniform 会被最后一个材质覆盖；拾取 ID 还必须显式带
  `SHADER_PICK` 的 pass 位，否则被默认 passFlags 过滤。
- **实例化 attribute 用 ATTR12–15**：避开 position/normal 占用的 location 0/1，与引擎原生
  instancing 约定一致。
- **撤销以快照而非反向操作**：吸附关系和剖切距离都是状态的一部分，整快照回滚最简单可靠。

## 操作

- 左键点套管：选中（Shift/Ctrl 追加）；左键拖空白：框选
- 拖彩色轴：平移；切「旋转」后拖彩色环：旋转；拖中心块：视图平面自由移动
- 靠近牙面自动吸附，小偏离松手弹回，大偏离回退到拖动前
- 右键 / Alt+拖动：转视角；Shift+拖动：平移；滚轮：缩放
- `Ctrl+Z` 撤销、`Ctrl+Y` 重做、`Q/W` 切换平移/旋转、`Esc` 清除选择
