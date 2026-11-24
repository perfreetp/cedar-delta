import { createMemo, createSignal, For, Show } from 'solid-js';
import { projectStore } from '../state/projectStore';
import type { ObGroup, Obstacle, Vec3Tuple } from '../types';
import { verticalPositionForExposure } from '../lib/obstacleMath';
import { clamp } from '../lib/utils';
import { NumberInput, PanelSection, SliderRow, VectorInput } from './controls';

export default function TransformPanel() {
  const selected = createMemo<Obstacle[]>(() =>
    projectStore
      .selectedIds()
      .map((id) => projectStore.doc.obstacles.find((o) => o.id === id))
      .filter((o): o is Obstacle => Boolean(o)),
  );
  const primary = createMemo(() => selected()[0] ?? null);

  const activeBatchGroup = createMemo<ObGroup | null>(() => {
    const selectedGroupId = primary()?.groupId;
    const fromSelection = projectStore.doc.groups.find(
      (g) => g.id === selectedGroupId && Boolean(g.batch),
    );
    if (fromSelection?.batch) return fromSelection;
    return projectStore.doc.groups.find((g) => g.batch) ?? null;
  });

  const [rowCount, setRowCount] = createSignal(8);
  const [rowSpacing, setRowSpacing] = createSignal(4);

  const commitVec = (key: 'position' | 'rotation', value: Vec3Tuple) => {
    const o = primary();
    if (!o || selected().length > 1) return;
    projectStore.updateObstacle(o.id, { [key]: value }, key === 'position' ? '数值移动' : '数值旋转');
  };

  const commitScale = (value: Vec3Tuple) => {
    const o = primary();
    if (!o) return;
    const safe = value.map((v) => clamp(Number.isFinite(v) ? Math.abs(v) : 0.1, 0.05, 8)) as Vec3Tuple;
    projectStore.updateObstacle(o.id, { scale: safe }, '轴向缩放');
  };

  return (
    <div>
      <PanelSection
        title="选中变换"
        count={selected().length}
        action={
          <Show when={selected().length > 0}>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button class="icon-button" title="复制" onClick={projectStore.duplicateSelected}>⧉</button>
              <button class="icon-button danger" title="删除 Delete" onClick={projectStore.deleteSelected}>⌫</button>
            </div>
          </Show>
        }
      >
        <Show
          when={primary()}
          fallback={
            <div class="empty-state" style={{ padding: '14px 4px' }}>
              <span class="big">✥</span>
              尚未选择障碍。可在视口点击，或从下方场景列表选择。
            </div>
          }
        >
          {(o) => (
            <div class="form-grid">
              <div>
                <div class="inspector-kicker">{o().category} / {o().kind}</div>
                <h2 class="inspector-title" style={{ 'font-size': '15px' }}>{o().name}</h2>
                <Show when={selected().length > 1}>
                  <p class="help-text">已选 {selected().length} 个对象；视口手柄会绕共同质心整体平移、旋转。数值区编辑主选中对象。</p>
                </Show>
              </div>

              <div class="form-row">
                <span class="form-label">位置 X / Y / Z（m）</span>
                <VectorInput value={o().position} labels={['X', 'Y', 'Z']} onCommit={(v) => commitVec('position', v)} />
              </div>

              <div class="form-row">
                <span class="form-label">旋转俯仰 / 艏向 / 翻滚（°）</span>
                <VectorInput value={o().rotation} labels={['X', 'Y', 'Z']} step={1} onCommit={(v) => commitVec('rotation', v)} />
              </div>

              <div class="form-row">
                <span class="form-label">轴向缩放 X / Y / Z</span>
                <VectorInput value={o().scale} labels={['X', 'Y', 'Z']} step={0.05} onCommit={commitScale} />
              </div>

              <SliderRow
                label="X 轴缩放变形"
                value={o().scale[0]}
                min={0.2}
                max={4}
                step={0.01}
                format={(v) => `${v.toFixed(2)}×`}
                onGestureStart={() => projectStore.beginGesture('X 轴缩放')}
                onLive={(v) => projectStore.updateObstacleLive(o().id, { scale: [v, o().scale[1], o().scale[2]] })}
                onGestureEnd={projectStore.endGesture}
              />
              <SliderRow
                label="Y 轴高度缩放"
                value={o().scale[1]}
                min={0.2}
                max={4}
                step={0.01}
                format={(v) => `${v.toFixed(2)}×`}
                onGestureStart={() => projectStore.beginGesture('Y 轴缩放')}
                onLive={(v) => projectStore.updateObstacleLive(o().id, { scale: [o().scale[0], v, o().scale[2]] })}
                onGestureEnd={projectStore.endGesture}
              />
              <SliderRow
                label="Z 轴长度缩放"
                value={o().scale[2]}
                min={0.2}
                max={4}
                step={0.01}
                format={(v) => `${v.toFixed(2)}×`}
                onGestureStart={() => projectStore.beginGesture('Z 轴缩放')}
                onLive={(v) => projectStore.updateObstacleLive(o().id, { scale: [o().scale[0], o().scale[1], v] })}
                onGestureEnd={projectStore.endGesture}
              />
              <button
                class="btn small ghost"
                onClick={() => projectStore.updateObstacle(o().id, { scale: [1, 1, 1] }, '重置缩放')}
              >
                重置轴向缩放
              </button>

              <SliderRow
                label="露出水面高度"
                value={o().exposure}
                min={0}
                max={4}
                step={0.01}
                unit="m"
                onGestureStart={() => projectStore.beginGesture('调整露出高度')}
                onLive={(v) => {
                  const current = o();
                  projectStore.updateObstacleLive(current.id, {
                    exposure: v,
                    position: [current.position[0], verticalPositionForExposure(current, v), current.position[2]],
                  });
                }}
                onGestureEnd={projectStore.endGesture}
              />

              <Show when={o().kind === 'buoy'}>
                <SliderRow
                  label="悬挂高度 / 中心距水面"
                  value={o().suspension}
                  min={-1.2}
                  max={2.8}
                  step={0.01}
                  unit="m"
                  onGestureStart={() => projectStore.beginGesture('调整浮标悬挂高度')}
                  onLive={(v) => {
                    const current = o();
                    projectStore.updateObstacleLive(current.id, {
                      suspension: v,
                      position: [current.position[0], v, current.position[2]],
                    });
                  }}
                  onGestureEnd={projectStore.endGesture}
                />
              </Show>

              <div class="summary-line">
                <span>暗礁判定阈值</span>
                <strong style={{ color: o().exposure <= projectStore.doc.detection.reefThreshold ? '#38bdf8' : undefined }}>
                  {o().exposure <= projectStore.doc.detection.reefThreshold ? '标记为暗礁' : '正常露出'}
                </strong>
              </div>
            </div>
          )}
        </Show>
      </PanelSection>

      <PanelSection title="沿河道批量浮标列">
        <div class="batch-box">
          <div class="form-grid">
            <div class="form-grid" style={{ 'grid-template-columns': '1fr 1fr', gap: '9px' }}>
              <label class="form-row">
                <span class="form-label">数量</span>
                <NumberInput value={rowCount()} min={2} max={40} step={1} onCommit={setRowCount} />
              </label>
              <label class="form-row">
                <span class="form-label">初始间距 m</span>
                <NumberInput value={rowSpacing()} min={1} max={20} step={0.1} onCommit={setRowSpacing} />
              </label>
            </div>
            <button class="btn primary block" onClick={() => projectStore.createBuoyRow(rowCount(), rowSpacing())}>
              ＋ 从选中浮标生成等距列
            </button>
            <p class="help-text">若已选中浮标，将以它的河道里程和横向偏移为起点；未选中时使用红色门标模板。生成后自动成组。</p>

            <Show when={activeBatchGroup()}>
              {(batchGroup) => (
                <>
                  <div class="summary-line">
                    <span>当前批量组</span>
                    <strong>{batchGroup().name}</strong>
                  </div>
                  <SliderRow
                    label="等间距调整"
                    value={batchGroup().batch!.spacing}
                    min={1}
                    max={16}
                    step={0.1}
                    unit="m"
                    onGestureStart={() => projectStore.beginGesture('调整浮标列间距')}
                    onLive={(v) => projectStore.layoutBatch(batchGroup().id, v)}
                    onGestureEnd={projectStore.endGesture}
                  />
                  <button class="btn small" onClick={() => projectStore.selectGroupMembers(batchGroup().id)}>
                    选中整列（{batchGroup().batch!.memberIds.length}）
                  </button>
                </>
              )}
            </Show>
          </div>
        </div>
      </PanelSection>

      <PanelSection
        title="障碍分组"
        count={projectStore.doc.groups.length}
        action={
          <button class="btn small" onClick={() => projectStore.createGroupFromSelection()}>
            编组选中
          </button>
        }
      >
        <div class="group-list">
          <For each={projectStore.doc.groups}>
            {(group) => <GroupRow group={group} active={primary()?.groupId === group.id} />}
          </For>
        </div>
        <Show when={projectStore.doc.groups.length === 0}>
          <p class="help-text">暂无分组。选择多个障碍后点击“编组选中”，同组对象会一起平移和旋转。</p>
        </Show>
      </PanelSection>

      <PanelSection title="场景列表" count={projectStore.doc.obstacles.length}>
        <div class="collision-list" style={{ 'max-height': '260px', 'overflow-y': 'auto' }}>
          <For each={projectStore.doc.obstacles}>
            {(obstacle) => (
              <div
                class={`collision-row ${projectStore.selectedIds().includes(obstacle.id) ? 'danger' : ''}`}
                style={projectStore.selectedIds().includes(obstacle.id) ? { 'border-color': 'rgba(34,211,238,.6)', background: 'rgba(8,145,178,.16)' } : {}}
                onClick={(e) => projectStore.selectObstacle(obstacle.id, e.shiftKey)}
              >
                <div class="collision-row-head">
                  <span><span style={{ color: obstacle.color }}>●</span> {obstacle.name}</span>
                  <span class="collision-meta">{obstacle.category}</span>
                </div>
                <div class="collision-meta">
                  ({obstacle.position[0].toFixed(1)}, {obstacle.position[1].toFixed(1)}, {obstacle.position[2].toFixed(1)})
                  <Show when={obstacle.groupId}> · 已分组</Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </PanelSection>
    </div>
  );
}

function GroupRow(props: { group: ObGroup; active: boolean }) {
  const [name, setName] = createSignal(props.group.name);
  const count = createMemo(
    () => projectStore.doc.obstacles.filter((o) => o.groupId === props.group.id).length,
  );

  const commitName = () => {
    const next = name().trim();
    if (next && next !== props.group.name) projectStore.renameGroup(props.group.id, next);
    else setName(props.group.name);
  };

  return (
    <div class={`group-row ${props.active ? 'active' : ''}`}>
      <span class="group-swatch" style={{ '--group-color': props.group.color }}>
        <input
          type="color"
          value={props.group.color}
          aria-label="分组颜色"
          style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          onChange={(e) => projectStore.setGroupColor(props.group.id, e.currentTarget.value)}
        />
      </span>
      <div class="group-main" onClick={() => projectStore.selectGroupMembers(props.group.id)}>
        <input
          class="input"
          value={name()}
          style={{ 'min-height': '28px', padding: '3px 7px', 'font-weight': 800, background: 'transparent', 'border-color': 'transparent' }}
          onInput={(e) => setName(e.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div class="group-meta">{count()} 个障碍{props.group.batch ? ` · 等距 ${props.group.batch.spacing.toFixed(1)}m` : ''}</div>
      </div>
      <button class="icon-button" title="选中整组" onClick={() => projectStore.selectGroupMembers(props.group.id)}>◎</button>
      <button class="icon-button" title="解散分组" onClick={() => projectStore.dissolveGroup(props.group.id)}>⊘</button>
      <button class="icon-button danger" title="删除整组" onClick={() => projectStore.deleteGroup(props.group.id)}>⌫</button>
    </div>
  );
}
