# 宴屿 · 婚礼宴会桌花布置编辑器

一个使用 **TypeScript + React + Three.js + three-mesh-bvh** 实现的圆桌桌花排布编辑器。每桌最多支持 **3000 个花材实例**，玫瑰、绣球和尤加利叶均通过 `InstancedMesh` 合批渲染，几何体会构建 BVH 加速结构用于拾取。

## 启动

```bash
npm install
npm run dev
```

浏览器打开终端输出的地址（默认 `http://127.0.0.1:5173`）。

生产构建：

```bash
npm run build
npm run preview
```

## 核心能力

- **三类程序化花材几何**：玫瑰、绣球、尤加利叶，合并顶点色几何体并按类型实例化。
- **3000 实例上限**：每类各有一个动态 `InstancedMesh`，总共不超过 3000 个业务实例。
- **实例数据**：每个实例包含 `position`、`rotation`、`scale`、独立 `vaseHeight` 花器高度偏移和所属组。
- **左侧花材面板**：按全部 / 玫瑰 / 绣球 / 尤加利叶筛选；点击花材卡片即在桌面中心添加。
- **框选与成组**：视口空白处左键拖拽框选；`Shift/Ctrl + 点击/框选` 加减选；`Ctrl/Cmd + G` 成组，`Ctrl/Cmd + Shift + G` 取消组。
- **整体变换**：选中多个实例后会出现同一个 TransformControls，可整体移动、旋转、缩放。
- **15° 吸附**：旋转手柄固定 `Math.PI / 12` 吸附。
- **桌面贴合与避障**：拖动时锁定桌面高度方向，并通过空间哈希对非选中花球的圆形占据区和圆桌边缘做推出/滑动解算。
- **视角切换**：俯视、侧视、自由视角；自由视角下右键拖拽旋转，滚轮缩放。
- **高亮**：选中实例使用 OutlinePass 描边、金色包围盒和独立高亮实例代理。
- **实时提示**：拖动时在指针附近显示坐标、位移、吸附和避障状态。
- **右侧属性面板**：选中数量、组名、组中心、整体宽高深、类型统计、精确 XYZ 中心/偏移、花器高度、倍乘缩放和固定角度旋转。
- **历史记录**：添加、移动、旋转、缩放、成组、取消组、镜像、阵列、属性修改等均进入撤销/重做栈，最多保留 50 步；快捷键 `Ctrl/Cmd + Z`、`Ctrl/Cmd + Shift + Z` 或 `Ctrl + Y`。
- **排布工具**：
  - 水平镜像：以选中组中心执行 X 方向镜像。
  - 镜像复制：保留原件并生成镜像副本。
  - 环形阵列：按 8 或 12 等分，将当前选中组复制为完整圆环（当前组作为第一份，新增 `n - 1` 份）。
- **本地持久化**：方案自动保存到 `localStorage`。
- **JSON 分享**：顶部可导出带时间戳的 JSON 文件，也可导入之前的方案；导入时会清洗并限制到 3000 个实例。

## 操作速查

| 操作 | 方式 |
| --- | --- |
| 添加花材 | 左侧卡片点击“+ 添加” |
| 点选 | 左键点击实例；点击已分组实例会选中整组 |
| 框选 | 视口空白处左键拖拽 |
| 加减选 | `Shift` / `Ctrl` + 点击或框选 |
| 移动 / 旋转 / 缩放工具 | 底部工具栏或 `W` / `E` / `R` |
| 旋转吸附 | 手柄默认 15° |
| 视角旋转 | 自由视角下右键拖拽 |
| 缩放视角 | 滚轮 |
| 成组 | `Ctrl/Cmd + G` 或右侧“成组” |
| 删除 | `Delete` / `Backspace` |
| 撤销 / 重做 | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |

## JSON 数据结构

```ts
interface DesignDocument {
  app: 'banquet-floral-editor';
  version: 1;
  tableRadius: number;
  instances: Array<{
    id: string;
    type: 'rose' | 'hydrangea' | 'eucalyptus';
    name: string;
    position: [number, number, number];
    rotation: [number, number, number]; // Euler XYZ，弧度
    scale: [number, number, number];
    vaseHeight: number;
    groupId: string | null;
  }>;
  groups: Array<{
    id: string;
    name: string;
    memberIds: string[];
  }>;
}
```

## 主要代码结构

```text
src/
├─ App.tsx                         # 布局与全局快捷键
├─ styles.css                      # 编辑器界面样式
├─ components/
│  ├─ TopBar.tsx                   # 撤销重做、导入导出
│  ├─ LeftPanel.tsx                # 类别筛选与花材卡片
│  ├─ Viewport.tsx                 # Three.js 容器与视角切换
│  ├─ RightPanel.tsx               # 选中信息和精确属性
│  └─ BottomToolbar.tsx            # 变换、镜像、环形阵列
└─ editor/
   ├─ types.ts                     # 数据模型、常量和花材元数据
   ├─ EditorController.ts          # 文档、选择、历史、命令、持久化
   ├─ SceneEditor.ts               # Three.js/InstancedMesh/拾取/碰撞/描边
   ├─ geometry.ts                  # 程序化花材几何与 BVH
   ├─ transformMath.ts             # TRS、花器高度和碰撞半径
   ├─ seed.ts                      # 首次打开的示例主桌花
   └─ utils.ts                     # ID、校验、localStorage、JSON 下载
```

## 验证脚本

仓库附带两个基于 Puppeteer Core 的本地冒烟脚本，会调用本机 Chrome：

```bash
npm run build
npm run preview
node scripts/smoke.mjs       # 添加、框选、成组、阵列、撤销重做、拖拽、导出
node scripts/perf.mjs        # 填充 3000 实例并输出重建/帧率信息
```

> 性能脚本在强制 SwiftShader 软件渲染时帧率会很低；请以支持 WebGL 硬件加速的 Chrome/Edge 实际体验为准。
