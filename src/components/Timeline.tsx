import React, { useMemo, useRef, useState } from 'react';
import { useTimeline } from '../timeline/store';
import {
  findNode,
  globalToLocal,
  isGroup,
  localDuration,
  moveGroup,
  moveKey,
  scaleGroup,
  ungroup,
} from '../timeline/model';
import type { TimelineNode, TrackNode } from '../timeline/types';

const LABEL_W = 200;
const ROW_H = 34;

interface Row {
  node: TimelineNode;
  depth: number;
  chain: TimelineNode[]; // 根 -> 该节点
}

function flatten(nodes: TimelineNode[], depth: number, chain: TimelineNode[], out: Row[]) {
  for (const n of nodes) {
    const c = [...chain, n];
    out.push({ node: n, depth, chain: c });
    if (isGroup(n)) flatten(n.children, depth + 1, c, out);
  }
}

/** 链上把本地时间映射到全局时间(从叶到根逐层 start+scale*t) */
function toGlobal(chain: TimelineNode[], t: number): number {
  let v = t;
  for (let i = chain.length - 1; i >= 0; i--) v = chain[i].start + chain[i].scale * v;
  return v;
}

function chainScale(chain: TimelineNode[]): number {
  return chain.reduce((s, n) => s * n.scale, 1);
}

type Drag =
  | { kind: 'playhead' }
  | { kind: 'key'; trackId: string; keyId: string; moved: boolean }
  | {
      kind: 'group';
      id: string;
      mode: 'move' | 'scale';
      startGTime: number;
      origStart: number;
      origScale: number;
      ancScale: number;
      localDur: number;
    };

export function Timeline() {
  const { state, dispatch, recordKey } = useTimeline();
  const [pxPerSec, setPxPerSec] = useState(64);
  const areaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    flatten(state.doc.nodes, 0, [], out);
    return out;
  }, [state.doc]);

  const contentW = LABEL_W + state.doc.duration * pxPerSec + 120;

  const xToTime = (clientX: number): number => {
    const el = areaRef.current!;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - LABEL_W;
    return Math.max(0, Math.min(state.doc.duration, x / pxPerSec));
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const g = xToTime(ev.clientX);
    if (drag.kind === 'playhead') {
      dispatch({ type: 'setTime', time: g });
    } else if (drag.kind === 'key') {
      drag.moved = true;
      const local = globalToLocal(state.doc, drag.trackId, g);
      dispatch({
        type: 'mutate',
        fn: (doc) => {
          const t = findNode(doc.nodes, drag.trackId);
          if (t && !isGroup(t)) moveKey(t as TrackNode, drag.keyId, local, state.ripple);
        },
      });
    } else {
      const deltaParent = (g - drag.startGTime) / drag.ancScale;
      dispatch({
        type: 'mutate',
        fn: (doc) => {
          if (drag.mode === 'move') moveGroup(doc, drag.id, drag.origStart + deltaParent);
          else {
            const w = drag.origScale * drag.localDur + deltaParent;
            scaleGroup(doc, drag.id, drag.localDur > 1e-6 ? w / drag.localDur : drag.origScale);
          }
        },
      });
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const playheadX = LABEL_W + state.time * pxPerSec;

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= state.doc.duration + 1e-6; t += 0.5) out.push(t);
    return out;
  }, [state.doc.duration]);

  return (
    <div className="timeline" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
      <div className="timeline-toolbar">
        <span className="tl-label">时间轴</span>
        <button className="btn small" onClick={() => setPxPerSec((v) => Math.max(24, v / 1.25))}>
          缩小
        </button>
        <button className="btn small" onClick={() => setPxPerSec((v) => Math.min(240, v * 1.25))}>
          放大
        </button>
        <span className="hint">拖动标尺移动播放头 · 双击关键帧调曲线 · 拖动组条整体平移,拖右缘改时长</span>
      </div>
      <div className="timeline-scroll" ref={areaRef}>
        <div className="timeline-inner" style={{ width: contentW }}>
          {/* 标尺 */}
          <div
            className="ruler"
            onPointerDown={(ev) => {
              dragRef.current = { kind: 'playhead' };
              dispatch({ type: 'setTime', time: xToTime(ev.clientX) });
            }}
          >
            <div className="ruler-label">轨道 / 秒</div>
            {ticks.map((t) => (
              <div
                key={t}
                className={`tick ${Number.isInteger(t) ? 'major' : 'minor'}`}
                style={{ left: LABEL_W + t * pxPerSec }}
              >
                {Number.isInteger(t) && <span>{t}s</span>}
              </div>
            ))}
          </div>

          {/* 轨道行 */}
          {rows.map(({ node, depth, chain }) => {
            const anc = chain.slice(0, -1);
            if (isGroup(node)) {
              const gStart = toGlobal(anc, node.start);
              const gEnd = toGlobal(anc, node.start + node.scale * localDuration(node));
              const selected = state.selectedNodeIds.includes(node.id);
              return (
                <div className="row group-row" key={node.id}>
                  <div className="row-label" style={{ paddingLeft: 8 + depth * 16 }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => dispatch({ type: 'toggleNode', id: node.id })}
                      title="选中以编组"
                    />
                    <span className="group-name">📁 {node.name}</span>
                    <button
                      className="btn tiny"
                      title="解除编组(子节点按当前时间映射释放)"
                      onClick={() => dispatch({ type: 'mutate', fn: (doc) => ungroup(doc, node.id) })}
                    >
                      解组
                    </button>
                  </div>
                  <div
                    className={`group-bar ${selected ? 'selected' : ''}`}
                    style={{ left: LABEL_W + gStart * pxPerSec, width: Math.max(8, (gEnd - gStart) * pxPerSec) }}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      dragRef.current = {
                        kind: 'group',
                        id: node.id,
                        mode: 'move',
                        startGTime: xToTime(ev.clientX),
                        origStart: node.start,
                        origScale: node.scale,
                        ancScale: chainScale(anc),
                        localDur: localDuration(node),
                      };
                    }}
                  >
                    <span className="group-bar-title">{node.name}</span>
                    <div
                      className="group-resize"
                      onPointerDown={(ev) => {
                        ev.stopPropagation();
                        dragRef.current = {
                          kind: 'group',
                          id: node.id,
                          mode: 'scale',
                          startGTime: xToTime(ev.clientX),
                          origStart: node.start,
                          origScale: node.scale,
                          ancScale: chainScale(anc),
                          localDur: localDuration(node),
                        };
                      }}
                    />
                  </div>
                </div>
              );
            }

            const track = node as TrackNode;
            const selected = state.selectedNodeIds.includes(track.id);
            return (
              <div className="row track-row" key={track.id}>
                <div className="row-label" style={{ paddingLeft: 8 + depth * 16 }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => dispatch({ type: 'toggleNode', id: track.id })}
                    title="选中以编组"
                  />
                  <span className={`target-badge ${track.target}`}>
                    {{ instrument: '器械', guidewire: '导针', camera: '相机' }[track.target]}
                  </span>
                  <span className="track-name">{track.name}</span>
                  <button
                    className="btn tiny record"
                    title="在播放头处记录关键帧(取当前 3D 姿态)"
                    onClick={() => recordKey(track.id)}
                  >
                    ●
                  </button>
                </div>
                <div className="track-lane">
                  {track.keys.map((k, i) => {
                    const gx = LABEL_W + toGlobal(chain, k.time) * pxPerSec;
                    const isSel = state.selectedKey?.keyId === k.id;
                    return (
                      <div
                        key={k.id}
                        className={`key ${isSel ? 'selected' : ''}`}
                        style={{ left: gx }}
                        title={`t=${k.time.toFixed(2)}s · 双击调缓动曲线`}
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          dragRef.current = { kind: 'key', trackId: track.id, keyId: k.id, moved: false };
                        }}
                        onPointerUp={() => {
                          const d = dragRef.current;
                          if (d && d.kind === 'key' && !d.moved) {
                            dispatch({ type: 'selectKey', trackId: track.id, keyId: k.id });
                          }
                        }}
                        onDoubleClick={() => {
                          if (i < track.keys.length - 1) {
                            dispatch({ type: 'setCurveEdit', target: { trackId: track.id, keyId: k.id } });
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* 播放头 */}
          <div className="playhead" style={{ left: playheadX }}>
            <div className="playhead-cap" />
          </div>
        </div>
      </div>
    </div>
  );
}
