# 机关木偶骨架绑定工具

基于 **TypeScript + Svelte 4 + three.js** 的 3D 木偶骨架绑定与动作编辑工具。

## 运行

```bash
npm install
npm run dev        # 开发服务器（默认 http://127.0.0.1:5173）
npm run build      # 生产构建到 dist/
npm run preview    # 预览生产构建
npm run check      # svelte-check 类型检查
npm test           # 核心算法冒烟测试（18 项）
```

## 功能与对应实现

| 需求 | 实现 |
| --- | --- |
| 预设骨架（颈/肩/肘/腕/髋/膝/踝等球体关节） | `src/lib/preset.ts`，17 个关节的人形层级 |
| 拖动球体调整关节位置、骨骼长度随之变化 | 编辑模式下射线拾取 + 相机平面拖拽，写回 `localOffset`（`RigView.ts` + `stores/rig.ts`） |
| 每个关节三轴活动角度上下限 | `InspectorPanel.svelte` 逐轴启用/下限/上限，`clampAngles` 统一钳制 |
| 拖末端肢体驱动，超范围关节约束在边界并高亮 | FABRIK 定位 + 角度空间 CCD 的混合 IK（`math.ts#solveIK`），触界关节在视口中红色高亮 |
| 牵引杆按比例驱动一组关节、比例可调 | 视口金色 3D 旋钮 + 右侧面板滑杆；`RodPanel.svelte` 配置绑定关节与每轴比例 |
| 录制动作并按时间轴回放，回放同样受约束 | `Timeline.svelte`：录制每 100ms 采样关键帧，线性插值采样后再过当前约束钳制 |
| 修改骨架/约束后已录动作自动重算、保留关键帧 | `animation.ts#recomputeKeyframesForConstraints`：关键帧不删，角度按新约束钳制 |
| 骨架层级增删关节，删除时子关节重新挂接 | `hierarchy.ts#addJoint/removeJoint`，孙节点本地偏移平移继承，世界位置尽量保持 |
| 几十个关节拖动流畅 | 球体/骨骼均为 `InstancedMesh`（单次 draw call 级），rAF 渲染、射线按实例拾取 |
| 撤销/重做 | `lib/history.ts` 文档+姿态快照栈，Ctrl+Z / Ctrl+Shift+Z，拖动与录制按事务合并为一条历史 |
| 导出/导入单个文件继续编辑 | `lib/io.ts`：带 magic 标识的单个 JSON（骨架+约束+关键帧+牵引杆），导入时结构校验 |

## 两种模式

- **骨架编辑**：拖球体改绑定位置；左侧层级面板增删/重命名关节；右侧面板设置角度上下限与球体半径。
- **动作动画**：拖任意关节球做 IK 末端驱动（自动选择最近的三级链根）；右侧出现牵引杆；底部时间轴录制、打点、回放。

## 目录结构

```
src/
  types.ts                 文档/关节/关键帧数据结构
  lib/
    preset.ts              预设骨架与默认文档
    math.ts                FK、约束钳制、FABRIK+CCD 逆运动学
    animation.ts           关键帧插值、约束重算、回放采样
    hierarchy.ts           关节增删与重挂接
    history.ts             撤销/重做（快照 + 事务）
    io.ts                  单文件导入导出与校验
  stores/rig.ts            全局状态与全部编辑动作
  three/RigView.ts         three.js 视口（实例化渲染、拾取、拖拽、牵引杆）
  components/              Svelte UI（工具栏/层级/检查器/牵引杆/时间轴/视口）
```

## 关键设计说明

- **约束模型**：每个关节三个欧拉轴（XYZ 顺序）独立设置启用/下限/上限，单位为度。铰链类关节（肘、膝）默认只放开一个轴。
- **IK 与约束**：先 FABRIK 求关节世界位置（目标超出链长时链被拉直），再转本地欧拉角并逐轴钳制，最后 CCD 精修；求解器返回 `clamped` 集合驱动红色高亮，因此结果永远在约束内。
- **动作重算**：关键帧保存的是原始本地欧拉角。约束或骨架变化时仅对现存关节通道重新钳制，删除关节的通道被移除，关键帧本身与时间点全部保留。
- **撤销粒度**：连续拖拽、整段录制通过事务（begin/transact/commit）合并为单条撤销记录，不会刷爆历史栈。
