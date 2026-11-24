import { useMemo, useRef, type ReactElement } from 'react';
import { useEditorStore, buildSpline, waypointIndexResolver } from '../store';
import { TimelineSampler } from '../core/timeline';

function formatTime(t: number): string {
  return `${t.toFixed(1)}s`;
}

export function Timeline(): ReactElement | null {
  const tool = useEditorStore((s) => s.tool);
  const puppets = useEditorStore((s) => s.puppets);
  const playback = useEditorStore((s) => s.playback);
  const setPlayback = useEditorStore((s) => s.setPlayback);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const durations = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    for (const p of puppets) {
      const spline = buildSpline(p);
      const sampler = new TimelineSampler(spline, p.keyframes, waypointIndexResolver(p));
      map.set(p.id, sampler.durationSec);
      total = Math.max(total, sampler.durationSec);
    }
    return { map, total };
  }, [puppets]);

  if (tool !== 'playback') return null;
  const total = Math.max(durations.total, 0.1);

  const seekFromEvent = (clientX: number): void => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setPlayback({ currentTime: ratio * total });
  };

  const color = (id: string): string => {
    const c = puppets.find((p) => p.id === id)?.color ?? 0x888888;
    return `#${c.toString(16).padStart(6, '0')}`;
  };

  return (
    <footer className="timeline">
      <div className="timeline-controls">
        <button
          className="action-btn primary"
          onClick={() => {
            if (playback.currentTime >= total - 0.01) setPlayback({ currentTime: 0 });
            setPlayback({ isPlaying: !playback.isPlaying });
          }}
        >
          {playback.isPlaying ? '暂停' : '播放'}
        </button>
        <button className="action-btn" onClick={() => setPlayback({ currentTime: 0, isPlaying: false })}>
          回到起点
        </button>
        <label className="speed-field">
          速度
          <select value={playback.speed} onChange={(e) => setPlayback({ speed: Number(e.target.value) })}>
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        <label className="speed-field">
          <input
            type="checkbox"
            checked={playback.loop}
            onChange={(e) => setPlayback({ loop: e.target.checked })}
          />
          循环
        </label>
        <span className="time-readout">
          {formatTime(playback.currentTime)} / {formatTime(total)}
        </span>
      </div>

      <div
        className="timeline-track"
        ref={trackRef}
        onPointerDown={(e) => {
          scrubbing.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) seekFromEvent(e.clientX);
        }}
        onPointerUp={() => {
          scrubbing.current = false;
        }}
      >
        {puppets.map((p) => {
          const dur = durations.map.get(p.id) ?? 0;
          return (
            <div className="tl-row" key={p.id}>
              <div className="tl-label" title={p.name}>
                <span className="color-dot" style={{ background: color(p.id) }} />
                {p.name}
              </div>
              <div className="tl-lane">
                <div className="tl-lane-bg" style={{ width: `${(dur / total) * 100}%`, background: color(p.id), opacity: 0.18 }} />
                {[...p.keyframes]
                  .sort((a, b) => a.timeSec - b.timeSec)
                  .map((k) => (
                    <div
                      key={k.id}
                      className="tl-kf"
                      title={`${k.timeSec.toFixed(1)}s，停留 ${k.dwellSec.toFixed(1)}s`}
                      style={{ left: `${(k.timeSec / total) * 100}%`, borderColor: color(p.id) }}
                    />
                  ))}
              </div>
            </div>
          );
        })}
        <div className="tl-playhead" style={{ left: `${(playback.currentTime / total) * 100}%` }} />
      </div>
    </footer>
  );
}
