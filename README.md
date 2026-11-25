# 晶状体剖切测量系统

一个零前端框架的医学三维交互演示：**原生 TypeScript + Web Components + Babylon.js**。眼球与数千个解剖微结构均为程序化生成，不需要外部模型或贴图资源。

## 运行

```bash
npm install
npm run dev
```

打开终端输出的本地地址（默认 http://127.0.0.1:5173 ）。

生产构建：

```bash
npm run build
npm run preview
```

纯几何单元测试：

```bash
npm test
```

## 功能与操作对照

| 需求 | 实现 |
| --- | --- |
| 点选晶状体 / 角膜 | 在 `eye-workbench` Shadow DOM 画布中射线拾取；选中后 `HighlightLayer` 高亮，并弹出跟随三维锚点的操作手柄卡片。 |
| 移动 / 旋转 / 缩放晶状体 | Babylon `GizmoManager` 位置、旋转、缩放手柄；变换提交到撤销栈。平移靠近角膜后表面时按椭球支撑半径与角膜曲率球求内切吸附，按住 `Shift` 临时自由。 |
| 轴向剖切 | 初始即为包含视轴（Z 轴）的纵向剖切面，移除法线正侧半眼，露出晶状体轴向断面；琥珀色填充是椭球-平面求交生成的真实截面多边形。 |
| 前房深度 / 晶状体厚度 | 两个独立两点工具；点击时自动磁吸到角膜前/后极或晶状体前/后极，因此数值为真实的 3.86 / 4.10 mm 量级，并且锚点会随晶状体变换继续更新。 |
| 角膜曲率半径 | 三点定义空间圆，使用外接圆圆心/半径公式计算；每个点都有 SVG 拖拽手柄，放错后可直接拖到角膜其他位置重算。 |
| 标注朝向屏幕 | SVG 负责线和可拖点，HTML 负责数值卡片；每帧用 `Vector3.Project` 投影，所以旋转视角时标注始终贴合模型且文字始终面向屏幕。 |
| 几千个微结构 | `ThinInstance` 一次绘制 4200 个脉络膜细胞、悬韧带和虹膜/睫状突实例；总开关会 `setEnabled(false)` 且 `isPickable=false`，拾取谓词也只接受显式 `selectable` 对象。 |
| 撤销 / 重做 | 全状态快照栈覆盖：测量加点、拖点、删除/清空、晶状体变换、剖切偏移/旋转、吸附开关和剖切开关。`Ctrl/Cmd+Z`、`Ctrl+Y` 或 `Ctrl+Shift+Z`。 |
| 实时剖切与吸附约束 | 剖切工具下拖动青色球/切面实时更新断面；接近视轴、晶状体中心/赤道/切线、角膜缘、巩膜壁时磁吸并提示。橙色球水平拖动改变方向，相对视轴偏转超过 14° 会被夹住；`S` 在吸附/自由模式间切换。 |

## 快捷键

- `W`：移动手柄
- `E`：旋转手柄
- `R`：缩放手柄
- `S`：剖切吸附 / 自由模式切换
- `Shift`：拖动晶状体时临时禁用角膜吸附
- `Esc`：回到选择工具
- `Ctrl/Cmd + Z`：撤销
- `Ctrl + Y` / `Ctrl + Shift + Z`：重做

鼠标左键旋转视角，滚轮缩放，右键平移。

## 代码结构

```text
src/
├─ main.ts                         # 挂载 <eye-workbench>
├─ styles.css                      # 全屏布局
├─ components/
│  ├─ eye-workbench.ts              # Web Component、Shadow DOM UI、快捷键
│  └─ annotation-overlay.ts         # SVG/HTML 投影标注与测量点拖拽
└─ core/
   ├─ types.ts                      # 可序列化状态
   ├─ math.ts                       # 空间圆、射线/平面、椭球截面等纯数学
   ├─ history.ts                    # 快照撤销重做
   ├─ model.ts                      # 程序化眼球与 4200 个 ThinInstance
   └─ EyeLab.ts                     # Babylon 场景、拾取、手柄、剖切、吸附
```

## 验证

- `npm run build` 通过 TypeScript strict 检查和 Vite 打包。
- `npm test` 验证曲率圆、射线/平面和椭球截面数学。
- `tests/browser-check.mjs` 与 `tests/interaction-check.mjs` 是可选的 Puppeteer/Chrome 冒烟脚本；运行前先启动 `npm run preview`，并按实际端口调整 `URL`。

> 模型单位按毫米缩放，用于交互演示；解剖外形做了程序化简化，不作为医疗器械测量依据。
