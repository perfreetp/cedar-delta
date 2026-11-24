# 木偶走位编排工具

基于 **TypeScript + React + PixiJS 8 + pixi-viewport** 的俯视戏台木偶走位编排器。在可缩放平移的戏台图上放置木偶、拖画移动轨迹、标注关键帧时刻/朝向/停留，并按时间轴播放、导出走位文件。

## 启动

```bash
npm install
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建
npm run test       # 单元测试（29 个，覆盖样条/时间轴/拾取/仓库）
```

## 四个功能模块

| 模块 | 能力 |
| --- | --- |
| **戏台** | 上传俯视戏台图（或用内置网格）；滚轮缩放、拖拽/右键平移；点击空白放置木偶起点并显示偶图标 |
| **路径** | 点击追加经过点、按住拖画连续轨迹；经过点可拖动调整；**双击轨迹插入经过点**；右键/Delete 删除点 |
| **关键帧** | 点击经过点加帧；拖白色箭头改朝向、拖黄色圆钮改停留时长；侧栏可精确编辑时刻/停留/朝向；右键/Delete 删帧 |
| **播放** | 时间轴播放/暂停/拖拽定位/倍速/循环；偶沿轨迹移动并按切线平滑转向；导出/导入 JSON 走位文件 |

## 关键设计

### 平滑性：centripetal Catmull-Rom 样条（`src/core/spline.ts`）

- 严格穿过全部经过点，且 **C1 连续**——删除/插入/拖动经过点后整体重建，接头处切线一致，不会出现折角突变。
- 向心参数化（α=0.5）抑制尖点与自相交过冲。
- 内部按 ~10px 间距预采样，建立**弧长查找表**（`Float32Array`），位置/切线查询均为二分 O(log n)，播放匀速且切线角用最短弧插值，跨 ±π 无跳变。

### 时间轴（`src/core/timeline.ts`）

- 相邻关键帧间沿弧长匀速移动，关键帧处按 `dwellSec` 停留（位置与朝向保持）。
- 无显式朝向的关键帧跟随该点切线；显式朝向在区间两端用 smoothstep 与切线混合，拐弯处朝向沿切线平滑过渡。
- 显式朝向与切线混合区间为每段前后 30%，保证朝向不跳变。

### 大规模流畅性（数千经过点）

- 渲染层每个木偶仅 4 个 `Graphics` 对象（轨迹/经过点/关键帧/偶图标），数千图元批量绘制，每轮数据变更只重绘对应图层，draw call 数与点数无关。
- 拾取不依赖 Pixi 命中测试，使用**均匀网格空间哈希**（`src/core/spatial-hash.ts`），命中检测均摊 O(1)；命中半径按当前缩放反向换算，任意缩放下手感一致。
- 样条采样表与哈希均为类型化数组/Map，3000 点构建在测试中 < 200ms，千次查询 < 50ms。工具栏「压测 3000 点」可直接验证。

### 重叠轨迹的准确选中

- 先经空间哈希收集半径内全部候选，再按「真实距离最近 → 同距优先当前已选木偶 → 再按稳定次序」解析，多个木偶轨迹在同一位置重叠时选中结果确定且可预期。

### 交互冲突处理

- 视图平移与元素拖动共享左键：命中元素时立即暂停 viewport 拖动插件；空白处自由拖画越过点击阈值后才接管指针，未越阈仍可平移；抬手统一恢复插件。

## 数据格式（导出文件）

```jsonc
{
  "format": "puppet-choreography",
  "version": 1,
  "exportedAt": "ISO-8601",
  "durationSec": 12.3,
  "stage": { "imageUrl": "data:image/... 或 null", "worldWidth": 2400, "worldHeight": 1600 },
  "puppets": [
    {
      "id": "...", "name": "偶 1", "color": 15154496, "visible": true,
      "waypoints": [{ "id": "...", "pos": { "x": 100, "y": 200 } }],
      "keyframes": [{
        "id": "...", "waypointId": "...",
        "timeSec": 0, "dwellSec": 0.5,
        "headingDeg": null,          // null = 跟随切线
        "headingOverride": false
      }]
    }
  ]
}
```

## 目录结构

```
src/
├── core/
│   ├── vec.ts            # 向量/角度（含最短弧角度插值）
│   ├── spline.ts         # Catmull-Rom 样条 + 弧长表 + 拾取
│   ├── spatial-hash.ts   # 网格空间哈希 + 选中仲裁
│   └── timeline.ts       # 时间轴采样器（匀速/停留/朝向混合）
├── pixi/
│   ├── StageEngine.ts    # Pixi 应用、viewport、渲染与指针交互
│   └── graphics-factory.ts
├── components/           # React UI（工具栏/侧栏/时间轴/画布宿主）
├── io/file-io.ts         # 导出/导入/校验
├── store.ts              # Zustand 数据仓库与全部编辑操作
└── types.ts
```
