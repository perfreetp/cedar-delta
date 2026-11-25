import { Show, For } from 'solid-js';
import BeatCanvas from './BeatCanvas';
import {
  seed, setSeed,
  params, setParam,
  edits,
  selectedId, resetEdit, clearEdits,
  layout, totalBars, maxDepthCm, groupGap,
  randomizeSeed, resetAll,
} from './store';

const TIERS = [1, 2, 3, 4, 5];

export default function App() {
  const selBar = () => layout().bars.find((b) => b.id === selectedId()) || null;
  const editCount = () => Object.keys(edits).length;
  const hl = () => (selectedId() ? 'hl' : '');

  return (
    <div class="app">
      <aside class="panel">
        <h1>胸外按压节拍生成器</h1>
        <p class="sub">训练方案 · 按压节拍整版排版</p>

        <div class="ctrl">
          <div class="ctrl-head">
            <span>按压频率档位</span>
            <em>≈{100 + (params.rateTier - 1) * 5} 次/分 · 本版 {totalBars()} 次</em>
          </div>
          <div class="seg">
            <For each={TIERS}>
              {(t) => (
                <button
                  classList={{ on: params.rateTier === t }}
                  onClick={() => setParam('rateTier', t)}
                >
                  {t}档
                </button>
              )}
            </For>
          </div>
        </div>

        <div class={`ctrl ${hl()}`}>
          <div class="ctrl-head">
            <span>按压深度档位</span>
            <em>量程 ≤ {maxDepthCm()} cm</em>
          </div>
          <div class="seg">
            <For each={TIERS}>
              {(t) => (
                <button
                  classList={{ on: params.depthTier === t }}
                  onClick={() => setParam('depthTier', t)}
                >
                  {3 + t}cm
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="ctrl">
          <div class="ctrl-head">
            <span>手位偏移</span>
            <em>
              {params.handOffset > 0 ? '+' : ''}
              {params.handOffset} · 组距 {groupGap()}px
            </em>
          </div>
          <input
            type="range"
            min="-2"
            max="2"
            step="1"
            value={params.handOffset}
            onInput={(e) => setParam('handOffset', +e.currentTarget.value)}
          />
          <div class="ticks"><span>-2</span><span>-1</span><span>0</span><span>+1</span><span>+2</span></div>
        </div>

        <div class={`ctrl ${hl()}`}>
          <div class="ctrl-head">
            <span>节拍分组数</span>
            <em>每组 {params.groupSize} 拍</em>
          </div>
          <input
            type="range"
            min="2"
            max="8"
            step="1"
            value={params.groupSize}
            onInput={(e) => setParam('groupSize', +e.currentTarget.value)}
          />
          <div class="ticks"><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span></div>
        </div>

        <div class="ctrl">
          <div class="ctrl-head"><span>随机种子</span><em>同种子同版面</em></div>
          <div class="seed-row">
            <input
              type="text"
              value={seed()}
              onInput={(e) => setSeed(e.currentTarget.value)}
              spellcheck={false}
            />
            <button class="btn" onClick={randomizeSeed}>换一版</button>
          </div>
        </div>

        <Show
          when={selBar()}
          fallback={
            <div class="card muted">
              在画布上<b>点击</b>竖条查看详情;<b>上下拖</b>改深度、<b>左右拖</b>挪位置,拖过即标记为手改。
            </div>
          }
        >
          {(b) => (
            <div class="card">
              <div class="card-title">
                #{b().index + 1} 号按压
                <Show when={b().manual}>
                  <span class="tag">手改</span>
                </Show>
              </div>
              <div class="row"><span>深度</span><b>{b().depthCm.toFixed(1)} cm</b></div>
              <div class="row"><span>位置</span><b>第 {b().group} 组 · 第 {b().beatInGroup} 拍</b></div>
              <div class="row"><span>状态</span><b>{b().manual ? '手动调整(不随参数重排)' : '自动生成'}</b></div>
              <Show when={b().manual}>
                <button class="btn ghost" onClick={() => resetEdit(b().id)}>复位此条</button>
              </Show>
            </div>
          )}
        </Show>

        <div class="actions">
          <button class="btn ghost" disabled={editCount() === 0} onClick={clearEdits}>
            清除全部手改({editCount()})
          </button>
          <button class="btn ghost" onClick={resetAll}>恢复默认</button>
        </div>

        <p class="save-note">种子与手改记录已自动保存,下次打开回到同一版。</p>
      </aside>

      <main class="stage">
        <BeatCanvas />
        <div class="legend">
          <span><i class="sw auto" />自动生成</span>
          <span><i class="sw manual" />手改(不随参数重排)</span>
          <span><i class="sw sel" />选中</span>
          <span class="hint">拖动竖条:上下 = 深度(受深度档位限制),左右 = 位置</span>
        </div>
      </main>
    </div>
  );
}
