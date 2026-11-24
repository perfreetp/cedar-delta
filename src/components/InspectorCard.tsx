import { Show } from 'solid-js';
import { verticalPositionForExposure } from '../lib/obstacleMath';
import { projectStore } from '../state/projectStore';
import type { Vec3Tuple } from '../types';
import { NumberInput, SliderRow } from './controls';

export default function InspectorCard() {
  const selected = () =>
    projectStore
      .selectedIds()
      .map((id) => projectStore.doc.obstacles.find((o) => o.id === id))
      .filter(Boolean);
  const obstacle = () => selected()[0] ?? null;

  const commitVector = (key: 'position' | 'rotation' | 'scale', value: Vec3Tuple) => {
    const o = obstacle();
    if (!o) return;
    projectStore.updateObstacle(o.id, { [key]: value }, key === 'scale' ? '轴向缩放' : '变换');
  };

  return (
    <aside class={`inspector-card ${obstacle() ? '' : 'empty'}`}>
      <Show
        when={obstacle()}
        fallback={
          <>
            <div style={{ 'font-size': '38px' }}>◈</div>
            <strong>选择一个障碍</strong>
            <p class="help-text" style={{ 'max-width': '220px' }}>
              单击三维障碍进行选择。使用左上工具栏或快捷键 <span class="kbd">W</span> / <span class="kbd">E</span> 切换平移、旋转手柄。
            </p>
          </>
        }
      >
        {(o) => (
          <>
            <div class="inspector-kicker">快速检查器 · {selected().length > 1 ? `已选 ${selected().length} 个` : o().category}</div>
            <h2 class="inspector-title">
              <span style={{ color: o().color }}>●</span>
              {o().name}
            </h2>

            <div class="form-grid" style={{ 'margin-top': '14px' }}>
              <div class="form-row">
                <span class="form-label">位置</span>
                <div class="vec3-grid">
                  {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                    <div class={`vec-axis axis-${axis.toLowerCase()}`}>
                      <span>{axis}</span>
                      <NumberInput
                        value={o().position[index]}
                        step={0.1}
                        onCommit={(v) => {
                          const next = [...o().position] as Vec3Tuple;
                          next[index] = v;
                          commitVector('position', next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div class="form-row">
                <span class="form-label">旋转 °</span>
                <div class="vec3-grid">
                  {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                    <div class={`vec-axis axis-${axis.toLowerCase()}`}>
                      <span>{axis}</span>
                      <NumberInput
                        value={o().rotation[index]}
                        step={1}
                        onCommit={(v) => {
                          const next = [...o().rotation] as Vec3Tuple;
                          next[index] = v;
                          commitVector('rotation', next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div class="form-row">
                <span class="form-label">轴向缩放</span>
                <div class="vec3-grid">
                  {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                    <div class={`vec-axis axis-${axis.toLowerCase()}`}>
                      <span>{axis}</span>
                      <NumberInput
                        value={o().scale[index]}
                        step={0.05}
                        min={0.1}
                        onCommit={(v) => {
                          const next = [...o().scale] as Vec3Tuple;
                          next[index] = Math.max(0.05, Math.abs(v) || 0.05);
                          commitVector('scale', next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <SliderRow
                label="露出高度"
                value={o().exposure}
                min={0}
                max={4}
                step={0.01}
                unit="m"
                onGestureStart={() => projectStore.beginGesture('调整露出高度')}
                onLive={(v) =>
                  projectStore.updateObstacleLive(o().id, {
                    exposure: v,
                    position: [o().position[0], verticalPositionForExposure(o(), v), o().position[2]],
                  })
                }
                onGestureEnd={projectStore.endGesture}
              />

              {o().kind === 'buoy' && (
                <SliderRow
                  label="悬挂高度"
                  value={o().suspension}
                  min={-1.2}
                  max={2.8}
                  step={0.01}
                  unit="m"
                  onGestureStart={() => projectStore.beginGesture('调整悬挂高度')}
                  onLive={(v) =>
                    projectStore.updateObstacleLive(o().id, {
                      suspension: v,
                      position: [o().position[0], v, o().position[2]],
                    })
                  }
                  onGestureEnd={projectStore.endGesture}
                />
              )}

              <div style={{ display: 'flex', gap: '7px' }}>
                <button class="btn small block" onClick={projectStore.duplicateSelected}>复制</button>
                <button class="btn small danger block" onClick={projectStore.deleteSelected}>删除</button>
              </div>
              <button class="btn small ghost block" onClick={() => projectStore.setActiveModule('transform')}>
                打开分组 / 批量 / 高级变换
              </button>
            </div>
          </>
        )}
      </Show>
    </aside>
  );
}
