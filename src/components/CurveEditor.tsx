import React, { useMemo, useState } from 'react';
import { useTimeline, setEasingOp } from '../timeline/store';
import { findNode, isGroup, moveKey } from '../timeline/model';
import type { TrackNode, Keyframe, Easing } from '../timeline/types';
import { EASING_PRESETS, presetEasing } from '../timeline/easing';
import type { EasingPreset } from '../timeline/types';

const SIZE = 220;
const PAD = 24;

function toXY(x: number, y: number): [number, number] {
  return [PAD + x * (SIZE - 2 * PAD), SIZE - PAD - y * (SIZE - 2 * PAD)];
}

/** 缓动曲线编辑器:拖动两个贝塞尔控制点,或选预设;可改段时长(后续关键帧自动重排) */
export function CurveEditor() {
  const { state, dispatch } = useTimeline();
  const [drag, setDrag] = useState<1 | 2 | null>(null);

  const target = state.curveEdit;
  const data = useMemo(() => {
    if (!target) return null;
    const node = findNode(state.doc.nodes, target.trackId);
    if (!node || isGroup(node)) return null;
    const track = node as TrackNode;
    const idx = track.keys.findIndex((k) => k.id === target.keyId);
    if (idx < 0 || idx >= track.keys.length - 1) return null;
    return { track, idx, a: track.keys[idx], b: track.keys[idx + 1] };
  }, [state.doc, target]);

  if (!target || !data) return null;
  const { track, idx, a, b } = data;
  const e = a.easing;
  const duration = b.time - a.time;

  const setEasing = (ez: Easing) =>
    dispatch({ type: 'mutate', fn: (doc) => setEasingOp(doc, track.id, a.id, ez) });

  const setCtrl = (which: 1 | 2, x: number, y: number) => {
    const nx = Math.max(0, Math.min(1, x));
    const ny = Math.max(-0.6, Math.min(1.6, y));
    setEasing({
      preset: 'custom',
      x1: which === 1 ? nx : e.x1,
      y1: which === 1 ? ny : e.y1,
      x2: which === 2 ? nx : e.x2,
      y2: which === 2 ? ny : e.y2,
    });
  };

  const onPointer = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = (ev.clientX - rect.left - PAD) / (SIZE - 2 * PAD);
    const y = 1 - (ev.clientY - rect.top - PAD) / (SIZE - 2 * PAD);
    setCtrl(drag, x, y);
  };

  const setDuration = (d: number) => {
    if (!(d > 0.01)) return;
    // 改段时长 = 移动下一个关键帧;ripple 开启时后续关键帧按新时长自动重排
    dispatch({
      type: 'mutate',
      fn: (doc) => {
        const t = findNode(doc.nodes, track.id);
        if (t && !isGroup(t)) moveKey(t as TrackNode, b.id, a.time + d, true);
      },
    });
  };

  const [p1x, p1y] = toXY(e.x1, e.y1);
  const [p2x, p2y] = toXY(e.x2, e.y2);
  const [ox, oy] = toXY(0, 0);
  const [ex, ey] = toXY(1, 1);

  return (
    <div className="curve-editor">
      <div className="curve-head">
        <strong>缓动曲线</strong>
        <span className="curve-sub">
          {track.name} · 第 {idx + 1} 段({a.time.toFixed(2)}s → {b.time.toFixed(2)}s)
        </span>
        <button className="btn small" onClick={() => dispatch({ type: 'setCurveEdit', target: null })}>
          关闭
        </button>
      </div>
      <svg
        width={SIZE}
        height={SIZE}
        className="curve-svg"
        onPointerMove={onPointer}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        <rect x={PAD} y={PAD} width={SIZE - 2 * PAD} height={SIZE - 2 * PAD} className="curve-frame" />
        <line x1={ox} y1={oy} x2={ex} y2={ey} className="curve-diag" />
        <line x1={ox} y1={oy} x2={p1x} y2={p1y} className="curve-handle-line" />
        <line x1={ex} y1={ey} x2={p2x} y2={p2y} className="curve-handle-line" />
        <path
          d={`M ${ox} ${oy} C ${p1x} ${p1y}, ${p2x} ${p2y}, ${ex} ${ey}`}
          className="curve-path"
        />
        <circle
          cx={p1x}
          cy={p1y}
          r={7}
          className="curve-handle"
          onPointerDown={(ev) => {
            (ev.target as Element).setPointerCapture?.(ev.pointerId);
            setDrag(1);
          }}
        />
        <circle
          cx={p2x}
          cy={p2y}
          r={7}
          className="curve-handle alt"
          onPointerDown={(ev) => {
            (ev.target as Element).setPointerCapture?.(ev.pointerId);
            setDrag(2);
          }}
        />
      </svg>
      <div className="curve-presets">
        {(Object.keys(EASING_PRESETS) as EasingPreset[]).map((name) => (
          <button
            key={name}
            className={`btn small ${e.preset === name ? 'active' : ''}`}
            onClick={() => setEasing(presetEasing(name))}
          >
            {{ linear: '线性', easeIn: '缓入', easeOut: '缓出', easeInOut: '缓入缓出' }[name]}
          </button>
        ))}
        {e.preset === 'custom' && <span className="tag">自定义</span>}
      </div>
      <div className="curve-duration">
        <label>
          段时长(秒)
          <input
            type="number"
            step={0.1}
            min={0.05}
            value={Number(duration.toFixed(2))}
            onChange={(ev) => setDuration(parseFloat(ev.target.value))}
          />
        </label>
        <div className="hint">改时长后,该轨后续关键帧按新时长自动重排,不会堆叠。</div>
      </div>
      <div className="hint">
        手感参考:进钉道前用「缓出」减速对准,进钉道后用「缓入」加速推进。
      </div>
    </div>
  );
}
