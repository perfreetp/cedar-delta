import type { ReactElement } from 'react';
import { useEditorStore } from '../store';
import { buildSpline } from '../store';

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function Sidebar(): ReactElement {
  const s = useEditorStore();
  const puppet = s.puppets.find((p) => p.id === s.selectedPuppetId) ?? null;
  const waypoint = puppet?.waypoints.find((w) => w.id === s.selectedWaypointId) ?? null;
  const keyframe = puppet?.keyframes.find((k) => k.id === s.selectedKeyframeId) ?? null;

  return (
    <aside className="sidebar">
      <section className="panel">
        <h3>偶列表（{s.puppets.length}）</h3>
        {s.puppets.length === 0 && <p className="hint">在「戏台」模式点击空白处放置偶。</p>}
        <ul className="puppet-list">
          {s.puppets.map((p) => (
            <li
              key={p.id}
              className={`puppet-row ${p.id === s.selectedPuppetId ? 'selected' : ''}`}
              onClick={() => s.selectPuppet(p.id)}
            >
              <span className="color-dot" style={{ background: hex(p.color) }} />
              <input
                value={p.name}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => s.renamePuppet(p.id, e.target.value)}
              />
              <span className="count-badge">{p.waypoints.length} 点</span>
              <button
                className="mini-btn"
                title={p.visible ? '隐藏' : '显示'}
                onClick={(e) => {
                  e.stopPropagation();
                  s.togglePuppetVisible(p.id);
                }}
              >
                {p.visible ? '👁' : '—'}
              </button>
              <button
                className="mini-btn danger"
                title="删除偶"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`删除偶「${p.name}」及其轨迹？`)) s.removePuppet(p.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      {s.tool === 'stage' && (
        <section className="panel">
          <h3>戏台设置</h3>
          <label className="field">
            <span>宽（世界像素）</span>
            <input
              type="number"
              min={200}
              value={s.stage.worldWidth}
              onChange={(e) => s.setStage({ worldWidth: Math.max(200, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="field">
            <span>高（世界像素）</span>
            <input
              type="number"
              min={200}
              value={s.stage.worldHeight}
              onChange={(e) => s.setStage({ worldHeight: Math.max(200, Number(e.target.value) || 0) })}
            />
          </label>
          <button className="action-btn" onClick={() => s.setStage({ imageUrl: null })} disabled={!s.stage.imageUrl}>
            移除戏台图（用网格）
          </button>
          <p className="hint">滚轮缩放、拖拽平移、右键拖平移。</p>
        </section>
      )}

      {puppet && (s.tool === 'path' || s.tool === 'stage') && (
        <section className="panel">
          <h3>经过点</h3>
          <p className="hint">
            共 {puppet.waypoints.length} 个；双击轨迹可插入，右键点可删除。
            {puppet.waypoints.length > 1 &&
              ` 轨迹长度 ${Math.round(buildSpline(puppet).totalLength)} px。`}
          </p>
          {waypoint && (
            <div className="coord-grid">
              <label className="field">
                <span>X</span>
                <input
                  type="number"
                  value={Math.round(waypoint.pos.x)}
                  onChange={(e) =>
                    s.moveWaypoint(puppet.id, waypoint.id, { ...waypoint.pos, x: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>Y</span>
                <input
                  type="number"
                  value={Math.round(waypoint.pos.y)}
                  onChange={(e) =>
                    s.moveWaypoint(puppet.id, waypoint.id, { ...waypoint.pos, y: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
        </section>
      )}

      {s.tool === 'keyframe' && puppet && (
        <section className="panel">
          <h3>关键帧</h3>
          <p className="hint">拖白色箭头调朝向，拖黄色圆钮调停留时长；右键删帧（首帧保留）。</p>
          {keyframe ? (
            <>
              <label className="field">
                <span>时刻（秒）</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={keyframe.timeSec}
                  onChange={(e) =>
                    s.updateKeyframe(puppet.id, keyframe.id, { timeSec: Math.max(0, Number(e.target.value)) })
                  }
                />
              </label>
              <label className="field">
                <span>停留（秒）</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={5}
                  value={keyframe.dwellSec}
                  onChange={(e) =>
                    s.updateKeyframe(puppet.id, keyframe.id, { dwellSec: Math.max(0, Number(e.target.value)) })
                  }
                />
              </label>
              <label className="field">
                <span>朝向（度，空=切线）</span>
                <input
                  type="number"
                  value={keyframe.headingDeg ?? ''}
                  placeholder="自动切线"
                  onChange={(e) => {
                    const v = e.target.value;
                    s.updateKeyframe(puppet.id, keyframe.id, {
                      headingDeg: v === '' ? null : Number(v),
                      headingOverride: v !== '',
                    });
                  }}
                />
              </label>
              <button
                className="action-btn"
                onClick={() =>
                  s.updateKeyframe(puppet.id, keyframe.id, { headingDeg: null, headingOverride: false })
                }
              >
                恢复切线朝向
              </button>
              <button
                className="action-btn danger"
                disabled={keyframe.waypointId === puppet.waypoints[0].id}
                onClick={() => s.removeKeyframe(puppet.id, keyframe.id)}
              >
                删除关键帧
              </button>
            </>
          ) : (
            <p className="hint">点击经过点添加关键帧，或在图上点选已有帧。</p>
          )}
          <ul className="kf-list">
            {[...puppet.keyframes]
              .sort((a, b) => a.timeSec - b.timeSec)
              .map((k) => (
                <li
                  key={k.id}
                  className={`kf-row ${k.id === s.selectedKeyframeId ? 'selected' : ''}`}
                  onClick={() => s.selectKeyframe(k.id)}
                >
                  <span>t={k.timeSec.toFixed(1)}s</span>
                  <span>停 {k.dwellSec.toFixed(1)}s</span>
                  <span>{k.headingOverride ? `${Math.round(k.headingDeg ?? 0)}°` : '切线'}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {s.tool === 'playback' && (
        <section className="panel">
          <h3>播放说明</h3>
          <p className="hint">
            偶在拐弯处沿样条切线平滑转向；显式朝向会与切线平滑混合。空格播放/暂停。
          </p>
        </section>
      )}
    </aside>
  );
}
