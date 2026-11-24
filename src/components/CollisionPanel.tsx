import { createMemo, For, Show } from 'solid-js';
import { formatVolume } from '../lib/obstacleMath';
import { requestCollisionRun } from '../state/collisionController';
import { projectStore } from '../state/projectStore';
import { PanelSection, SliderRow, Toggle } from './controls';

export default function CollisionPanel() {
  const report = () => projectStore.collisionReport();
  const settings = () => projectStore.doc.detection;

  const obstacleMap = createMemo(() => new Map(projectStore.doc.obstacles.map((o) => [o.id, o])));

  const laneRows = createMemo(() =>
    Object.entries(report().laneVolumes)
      .map(([id, volume]) => ({ id, volume, obstacle: obstacleMap().get(id) }))
      .filter((row): row is { id: string; volume: number; obstacle: NonNullable<typeof row.obstacle> } => Boolean(row.obstacle))
      .sort((a, b) => b.volume - a.volume),
  );

  const occupiedRows = createMemo(() => laneRows().filter((row) => row.volume > settings().laneThreshold));
  const reefRows = createMemo(() => projectStore.doc.obstacles.filter((o) => o.exposure <= settings().reefThreshold));
  const pairRows = createMemo(() =>
    [...report().pairs].sort((a, b) => b.volume - a.volume).filter((p) => p.volume > settings().pairThreshold),
  );

  const selectPair = (a: string, b: string) => projectStore.setSelectedIds([a, b]);

  return (
    <div>
      <PanelSection title="检测状态">
        <div class="stat-grid">
          <div class={`stat-tile ${occupiedRows().length ? 'danger' : 'good'}`}>
            <div class="stat-value">{occupiedRows().length}</div>
            <div class="stat-label">占道超阈值</div>
          </div>
          <div class={`stat-tile ${pairRows().length ? 'purple' : 'good'}`}>
            <div class="stat-value">{pairRows().length}</div>
            <div class="stat-label">障碍穿插</div>
          </div>
          <div class={`stat-tile ${reefRows().length ? 'warn' : 'good'}`}>
            <div class="stat-value">{reefRows().length}</div>
            <div class="stat-label">暗礁 / 低露出</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value">{report().durationMs ? report().durationMs.toFixed(0) : '—'}</div>
            <div class="stat-label">Manifold ms / {report().solidCount} 实体</div>
          </div>
        </div>
        <Show when={report().error}>
          <p class="help-text" style={{ color: '#fda4af' }}>碰撞引擎错误：{report().error}</p>
        </Show>
        <button class="btn block" style={{ 'margin-top': '11px' }} onClick={requestCollisionRun}>
          ⟳ 立即重新布尔求交
        </button>
      </PanelSection>

      <PanelSection title="阈值与显示">
        <SliderRow
          label="占道重叠体积阈值"
          value={settings().laneThreshold}
          min={0.1}
          max={15}
          step={0.1}
          unit="m³"
          onLive={(v) => projectStore.setDetection({ laneThreshold: v })}
        />
        <SliderRow
          label="穿插体积阈值"
          value={settings().pairThreshold}
          min={0.01}
          max={1}
          step={0.01}
          unit="m³"
          onLive={(v) => projectStore.setDetection({ pairThreshold: v })}
        />
        <SliderRow
          label="暗礁露出高度阈值"
          value={settings().reefThreshold}
          min={0.05}
          max={1.2}
          step={0.01}
          unit="m"
          onLive={(v) => projectStore.setDetection({ reefThreshold: v })}
        />
        <div style={{ 'margin-top': '8px' }}>
          <Toggle
            label="显示包围实体"
            checked={settings().showColliders}
            onChange={(showColliders) => projectStore.setDetection({ showColliders })}
          />
          <Toggle
            label="显示航道可用区域"
            checked={settings().showChannel}
            onChange={(showChannel) => projectStore.setDetection({ showChannel })}
          />
          <Toggle
            label="显示风险文字标记"
            checked={settings().showLabels}
            onChange={(showLabels) => projectStore.setDetection({ showLabels })}
          />
        </div>
      </PanelSection>

      <PanelSection title="航道布尔求交" count={occupiedRows().length}>
        <div class="collision-list">
          <For each={laneRows().slice(0, 30)}>
            {(row) => {
              const over = () => row.volume > settings().laneThreshold;
              return (
                <div class={`collision-row ${over() ? 'danger' : ''}`} onClick={() => projectStore.setSelectedIds([row.id])}>
                  <div class="collision-row-head">
                    <span>{row.obstacle.name}</span>
                    <span class="volume">{formatVolume(row.volume)} m³</span>
                  </div>
                  <div class="collision-meta">
                    {over() ? `超过阈值 ${settings().laneThreshold.toFixed(1)} m³，已高亮提示占道` : '低于占道阈值'}
                  </div>
                </div>
              );
            }}
          </For>
        </div>
        <Show when={laneRows().length === 0}>
          <div class="empty-state">Manifold 正在生成包围实体…</div>
        </Show>
      </PanelSection>

      <PanelSection title="障碍之间穿插" count={pairRows().length}>
        <div class="collision-list">
          <For each={pairRows()}>
            {(pair) => {
              const a = obstacleMap().get(pair.aId);
              const b = obstacleMap().get(pair.bId);
              return (
                <div class="collision-row purple" onClick={() => selectPair(pair.aId, pair.bId)}>
                  <div class="collision-row-head">
                    <span>{a?.name ?? pair.aId} × {b?.name ?? pair.bId}</span>
                    <span class="volume" style={{ color: '#e9d5ff' }}>{formatVolume(pair.volume)} m³</span>
                  </div>
                  <div class="collision-meta">包围实体布尔交集体积超过 {settings().pairThreshold.toFixed(2)} m³</div>
                </div>
              );
            }}
          </For>
        </div>
        <Show when={pairRows().length === 0}>
          <p class="help-text">当前未检测到超过阈值的障碍穿插。拖动障碍时会实时重新求交。</p>
        </Show>
      </PanelSection>

      <PanelSection title="暗礁清单" count={reefRows().length}>
        <div class="collision-list">
          <For each={reefRows()}>
            {(obstacle) => (
              <div class="collision-row warn" onClick={() => projectStore.setSelectedIds([obstacle.id])}>
                <div class="collision-row-head">
                  <span>{obstacle.name}</span>
                  <span class="volume" style={{ color: '#7dd3fc' }}>{obstacle.exposure.toFixed(2)} m</span>
                </div>
                <div class="collision-meta">低于暗礁阈值 {settings().reefThreshold.toFixed(2)} m，视口已标记“暗礁”</div>
              </div>
            )}
          </For>
        </div>
      </PanelSection>
    </div>
  );
}
