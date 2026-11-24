import { useEffect, useRef } from 'react';
import { BRUSH_META } from '../sculpt/brushConfig';
import type { HistorySnapshot, StrokeDetailRow } from '../sculpt/types';
import {
  EyeIcon,
  PlayIcon,
  RedoIcon,
  StopIcon,
  UndoIcon,
} from './Icons';

export interface DetailState {
  id: number;
  rows: StrokeDetailRow[];
}

export function HistoryPanel({
  snapshot,
  playing,
  detail,
  onUndo,
  onRedo,
  onPlayAll,
  onStop,
  onReplayTo,
  onToggleDetail,
}: {
  snapshot: HistorySnapshot;
  playing: boolean;
  detail: DetailState | null;
  onUndo: () => void;
  onRedo: () => void;
  onPlayAll: () => void;
  onStop: () => void;
  onReplayTo: (index: number) => void;
  onToggleDetail: (id: number) => void;
}) {
  const currentRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [snapshot.cursor]);

  return (
    <div className="history-module">
      <div className="history-actions">
        <button
          type="button"
          className="tool-button"
          onClick={onUndo}
          disabled={!snapshot.canUndo || playing}
        >
          <UndoIcon />
          撤销
        </button>
        <button
          type="button"
          className="tool-button"
          onClick={onRedo}
          disabled={!snapshot.canRedo || playing}
        >
          <RedoIcon />
          重做
        </button>
        {playing ? (
          <button type="button" className="tool-button danger" onClick={onStop}>
            <StopIcon />
            停止
          </button>
        ) : (
          <button
            type="button"
            className="tool-button primary"
            onClick={onPlayAll}
            disabled={snapshot.totalStrokes === 0}
          >
            <PlayIcon />
            逐条回放
          </button>
        )}
      </div>

      <div className="timeline-meta">
        <span>
          当前 <strong>{snapshot.cursor}</strong> / {snapshot.totalStrokes} 笔
        </span>
        <span>每笔均保存逐顶点 from/to 与位移</span>
      </div>

      <div className="stroke-list">
        {snapshot.records.length === 0 ? (
          <div className="empty-history">
            <div className="empty-orbit" />
            <strong>还没有落笔记录</strong>
            <p>在模型上按住左键拖动，第一笔会出现在这里。</p>
          </div>
        ) : (
          snapshot.records.map((stroke) => {
            const applied = stroke.index < snapshot.cursor;
            const current = stroke.index === snapshot.cursor - 1;
            const expanded = detail?.id === stroke.id;
            return (
              <div
                key={stroke.id}
                className={`stroke-item ${applied ? 'applied' : 'future'} ${
                  current ? 'current' : ''
                }`}
              >
                <button
                  type="button"
                  ref={current ? currentRef : undefined}
                  className="stroke-main"
                  onClick={() => onReplayTo(stroke.index)}
                  title="从初始网格回放至这一笔"
                >
                  <span className="stroke-number">{stroke.index + 1}</span>
                  <span className="stroke-body">
                    <span className="stroke-title-row">
                      <strong>{BRUSH_META[stroke.brush].name}</strong>
                      {stroke.symmetric ? <em className="mirror-badge">镜像</em> : null}
                      {current ? <em className="current-badge">当前</em> : null}
                    </span>
                    <small>
                      {stroke.affected} 顶点 · 最大 {stroke.maxDisplacement.toFixed(3)} ·{' '}
                      {stroke.createdAtLabel}
                    </small>
                    {stroke.symmetric ? (
                      <small className="side-counts">
                        原始侧 {stroke.pointerCount} · 镜像侧 {stroke.mirrorCount} · 轴{' '}
                        {stroke.axisCount}
                      </small>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  className={`detail-button ${expanded ? 'active' : ''}`}
                  onClick={() => onToggleDetail(stroke.id)}
                  title="查看顶点位移数据"
                >
                  <EyeIcon width={17} height={17} />
                </button>
                {expanded && detail ? (
                  <div className="stroke-detail">
                    <table>
                      <thead>
                        <tr>
                          <th>顶点</th>
                          <th>侧</th>
                          <th>Δx</th>
                          <th>Δy</th>
                          <th>Δz</th>
                          <th>长度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.rows.map((row) => (
                          <tr key={row.index}>
                            <td>#{row.index}</td>
                            <td>{row.side}</td>
                            <td>{row.dx.toFixed(4)}</td>
                            <td>{row.dy.toFixed(4)}</td>
                            <td>{row.dz.toFixed(4)}</td>
                            <td>{row.length.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>仅显示位移最大的前 {detail.rows.length} 个顶点。</p>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
