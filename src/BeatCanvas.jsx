import { onMount, createEffect } from 'solid-js';
import paper from 'paper';
import { layout, selectedId, setSelectedId, commitEdit, setViewWidth } from './store';

const HEIGHT = 440;
const LERP = 0.22; // 每帧向目标位置靠拢的比例

export default function BeatCanvas() {
  let wrapRef;
  let canvasRef;

  let rulerLayer, barLayer, labelLayer;
  const displayed = new Map(); // id → 当前画在屏上的 {x, depthCm}
  const targets = new Map();   // id → 布局给出的目标 {x, depthCm}
  let animating = false;
  let drag = null;
  let L = null;

  function syncSize() {
    const w = Math.max(320, Math.round(L.W));
    if (canvasRef.width !== w || canvasRef.height !== HEIGHT) {
      canvasRef.width = w;
      canvasRef.height = HEIGHT;
      canvasRef.style.width = w + 'px';
      canvasRef.style.height = HEIGHT + 'px';
      paper.view.viewSize = new paper.Size(w, HEIGHT);
    }
  }

  function drawRuler() {
    rulerLayer.removeChildren();
    rulerLayer.activate();
    const { marginL, baseline, pxPerCm, maxDepthCm } = L;
    const right = L.W - 24;
    for (let cm = 0; cm <= maxDepthCm; cm++) {
      const y = baseline - cm * pxPerCm;
      const line = new paper.Path.Line({
        from: [marginL - 10, y],
        to: [right, y],
        strokeColor: cm === 0 ? '#55607a' : '#2c3345',
        strokeWidth: cm === 0 ? 1.5 : 1,
      });
      if (cm > 0 && cm < maxDepthCm) line.dashArray = [3, 5];
      new paper.PointText({
        point: [marginL - 32, y + 3.5],
        content: String(cm),
        fillColor: '#7c86a0',
        fontSize: 10,
        fontFamily: 'system-ui',
      });
    }
    new paper.PointText({
      point: [marginL - 44, baseline - maxDepthCm * pxPerCm - 12],
      content: '深度/cm',
      fillColor: '#7c86a0',
      fontSize: 10,
      fontFamily: 'system-ui',
    });
  }

  function drawBars() {
    if (!L) return;
    barLayer.removeChildren();
    labelLayer.removeChildren();
    const sel = selectedId();
    const { baseline, pxPerCm, barW } = L;

    barLayer.activate();
    for (const b of L.bars) {
      const d = displayed.get(b.id);
      if (!d) continue;
      const h = Math.max(1.5, d.depthCm * pxPerCm);
      const x = d.x;
      const isSel = b.id === sel;

      const rect = new paper.Path.Rectangle({
        rectangle: new paper.Rectangle(x - barW / 2, baseline - h, barW, h),
        fillColor: b.manual ? '#d98a2b' : isSel ? '#5b9bff' : '#3d6db0',
      });
      if (isSel) {
        rect.strokeColor = '#e8eefc';
        rect.strokeWidth = 1.5;
      }
      // 竖条上的深度刻度:每 1cm 一道
      const ticks = Math.floor(d.depthCm);
      for (let cm = 1; cm <= ticks; cm++) {
        new paper.Path.Line({
          from: [x - barW / 2, baseline - cm * pxPerCm],
          to: [x + barW / 2, baseline - cm * pxPerCm],
          strokeColor: 'rgba(12, 17, 30, 0.5)',
          strokeWidth: 1,
        });
      }
      // 手改标记:条顶小菱形
      if (b.manual) {
        new paper.Path.RegularPolygon({
          center: [x, baseline - h - 8],
          sides: 4,
          radius: 3.5,
          fillColor: '#f0b35c',
        });
      }
      // 组内拍号
      labelLayer.activate();
      new paper.PointText({
        point: [x, baseline + 14],
        content: String(b.beatInGroup),
        fillColor: isSel ? '#cfe0ff' : '#5f6a85',
        fontSize: 8.5,
        justification: 'center',
        fontFamily: 'system-ui',
      });
      barLayer.activate();
    }

    // 分组编号
    labelLayer.activate();
    for (const g of L.groups) {
      new paper.PointText({
        point: [g.x, baseline + 32],
        content: `第${g.num}组`,
        fillColor: '#93a0bd',
        fontSize: 11,
        justification: 'center',
        fontFamily: 'system-ui',
      });
    }
  }

  // 布局变化 → 更新各条目标值,需要动画就打开 onFrame
  function retarget() {
    const ids = new Set();
    for (const b of L.bars) {
      ids.add(b.id);
      targets.set(b.id, { x: b.x, depthCm: b.depthCm });
      if (!displayed.has(b.id)) {
        displayed.set(b.id, { x: b.x, depthCm: 0 }); // 新条从基线长出来
        animating = true;
      }
    }
    for (const id of [...displayed.keys()]) if (!ids.has(id)) displayed.delete(id);
    for (const id of [...targets.keys()]) if (!ids.has(id)) targets.delete(id);
    for (const [id, t] of targets) {
      if (drag && drag.id === id) continue;
      const c = displayed.get(id);
      if (Math.abs(c.x - t.x) > 0.3 || Math.abs(c.depthCm - t.depthCm) > 0.01) animating = true;
    }
  }

  function step() {
    let moving = false;
    for (const [id, t] of targets) {
      if (drag && drag.id === id) continue;
      const c = displayed.get(id);
      if (!c) continue;
      c.x += (t.x - c.x) * LERP;
      c.depthCm += (t.depthCm - c.depthCm) * LERP;
      if (Math.abs(c.x - t.x) > 0.2 || Math.abs(c.depthCm - t.depthCm) > 0.005) {
        moving = true;
      } else {
        c.x = t.x;
        c.depthCm = t.depthCm;
      }
    }
    animating = moving;
    drawBars();
  }

  // ---- 交互:点选 + 拖拽改深度/位置 ----
  function toLocal(e) {
    const r = canvasRef.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hitBar(p) {
    if (!L) return null;
    let best = null;
    let bestDx = Infinity;
    for (const b of L.bars) {
      const d = displayed.get(b.id);
      if (!d) continue;
      const h = d.depthCm * L.pxPerCm;
      const dx = Math.abs(p.x - d.x);
      const tol = Math.max(L.barW / 2 + 4, 8);
      if (dx <= tol && p.y >= L.baseline - h - 14 && p.y <= L.baseline + 8 && dx < bestDx) {
        best = b;
        bestDx = dx;
      }
    }
    return best;
  }

  function onDown(e) {
    const p = toLocal(e);
    const b = hitBar(p);
    if (b) {
      setSelectedId(b.id);
      drag = { id: b.id, moved: false };
      if (canvasRef.setPointerCapture) canvasRef.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      setSelectedId(null);
    }
  }

  function onMove(e) {
    if (!drag || !L) return;
    const p = toLocal(e);
    // 横向挪位置,纵向改深度;深度被深度档位的量程夹住
    const x = Math.min(Math.max(p.x, L.marginL), L.W - 24);
    const depthCm = Math.min(Math.max((L.baseline - p.y) / L.pxPerCm, 0), L.maxDepthCm);
    displayed.set(drag.id, { x, depthCm });
    targets.set(drag.id, { x, depthCm });
    drag.moved = true;
    drawBars();
  }

  function onUp() {
    if (drag && drag.moved) {
      const d = displayed.get(drag.id);
      commitEdit(drag.id, d.x, Math.round(d.depthCm * 10) / 10);
    }
    drag = null;
  }

  onMount(() => {
    paper.setup(canvasRef);
    rulerLayer = new paper.Layer();
    barLayer = new paper.Layer();
    labelLayer = new paper.Layer();

    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setViewWidth(w);
    });
    ro.observe(wrapRef);
    setViewWidth(wrapRef.clientWidth || 960);

    paper.view.onFrame = () => {
      if (animating) step();
    };

    // 布局(参数/种子/手改/画布宽)变化 → 重定目标 + 重画标尺
    createEffect(() => {
      L = layout();
      syncSize();
      drawRuler();
      retarget();
      if (!animating) drawBars();
    });
    // 选中态变化 → 重画高亮
    createEffect(() => {
      selectedId();
      if (!animating) drawBars();
    });

    canvasRef.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  return (
    <div class="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
