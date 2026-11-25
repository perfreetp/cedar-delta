<script>
  import { onMount } from 'svelte'
  import StreetScene from './lib/StreetScene.svelte'
  import {
    params, overrides, selectedId, sceneData,
    setBuildingOverride, clearBuildingOverride, resetOverrides,
    schemeNames, refreshSchemes, saveScheme, loadScheme, deleteScheme
  } from './lib/store.js'
  import { ROOF_STYLES, ROOF_LABELS } from './lib/generate.js'

  let seedInput = 1
  let schemeName = ''
  let schemePick = ''
  let notice = ''

  onMount(() => {
    seedInput = $params.seed
    refreshSchemes()
  })

  // 功能点 7:输入种子,一键回到该种子的初始街景,手改记录清空
  function resetToSeed() {
    const s = Number(seedInput)
    if (!Number.isFinite(s)) return
    params.update((p) => ({ ...p, seed: s }))
    resetOverrides()
    selectedId.set(null)
    flash(`已回到种子 ${s} 的初始街景,手改记录已清空`)
  }

  function flash(msg) {
    notice = msg
    setTimeout(() => (notice = ''), 2500)
  }

  function doSave() {
    const name = schemeName.trim()
    if (!name) return
    saveScheme(name)
    schemePick = name
    flash(`方案「${name}」已保存`)
  }

  function doLoad() {
    if (schemePick && loadScheme(schemePick)) flash(`已载入方案「${schemePick}」`)
  }

  function doDelete() {
    if (!schemePick) return
    deleteScheme(schemePick)
    flash(`方案「${schemePick}」已删除`)
    schemePick = ''
  }

  $: selectedBuilding = $sceneData.buildings.find((b) => b.id === $selectedId) || null
  $: manualCount = Object.keys($overrides.buildings).length + Object.keys($overrides.lamps).length
</script>

<div class="app">
  <header>
    <span class="logo">🏙️ 街景方案生成器</span>

    <label>种子
      <input type="number" bind:value={seedInput} class="seed" />
    </label>
    <button on:click={resetToSeed}>回到种子初始街景</button>

    <span class="sep"></span>

    <input type="text" placeholder="方案名称" bind:value={schemeName} />
    <button on:click={doSave}>保存方案</button>
    <select bind:value={schemePick}>
      <option value="">选择方案…</option>
      {#each $schemeNames as n}
        <option value={n}>{n}</option>
      {/each}
    </select>
    <button on:click={doLoad} disabled={!schemePick}>载入</button>
    <button on:click={doDelete} disabled={!schemePick}>删除</button>

    {#if notice}<span class="notice">{notice}</span>{/if}
  </header>

  <div class="main">
    <aside>
      <section>
        <h3>街区参数</h3>
        <label>街区长度 <b>{$params.length} m</b>
          <input type="range" min="60" max="300" step="10" bind:value={$params.length} />
        </label>
        <label>层高 <b>{$params.floorHeight.toFixed(1)} m</b>
          <input type="range" min="2.4" max="4.5" step="0.1" bind:value={$params.floorHeight} />
        </label>
        <label>楼栋密度 <b>{Math.round($params.density * 100)}%</b>
          <input type="range" min="0.2" max="1" step="0.05" bind:value={$params.density} />
        </label>
        <p class="hint">手改项 {manualCount} 处 · 调参数时手改过的楼和路灯保持不变</p>
      </section>

      <section>
        {#if selectedBuilding}
          <h3>楼栋 {selectedBuilding.id}
            {#if selectedBuilding.manual}<span class="badge">手改</span>{/if}
          </h3>
          <label>高度 <b>{selectedBuilding.height.toFixed(0)} m</b>
            <input type="range" min="6" max="60" step="1" value={selectedBuilding.height}
              on:input={(e) => setBuildingOverride(selectedBuilding.id, { height: +e.target.value })} />
          </label>
          <label>屋顶样式
            <select value={selectedBuilding.roof}
              on:change={(e) => setBuildingOverride(selectedBuilding.id, { roof: e.target.value })}>
              {#each ROOF_STYLES as r}
                <option value={r}>{ROOF_LABELS[r]}</option>
              {/each}
            </select>
          </label>
          <label>窗户列数 <b>{selectedBuilding.cols}</b>
            <input type="range" min="2" max="8" step="1" value={selectedBuilding.cols}
              on:input={(e) => setBuildingOverride(selectedBuilding.id, { windows: { cols: +e.target.value, rows: selectedBuilding.rows } })} />
          </label>
          <label>窗户行数 <b>{selectedBuilding.rows}</b>
            <input type="range" min="1" max="20" step="1" value={selectedBuilding.rows}
              on:input={(e) => setBuildingOverride(selectedBuilding.id, { windows: { cols: selectedBuilding.cols, rows: +e.target.value } })} />
          </label>
          <p class="hint">窗户行数默认随「高度 ÷ 层高」自动变化;手动改过后不再被覆盖</p>
          <button on:click={() => clearBuildingOverride(selectedBuilding.id)}>恢复自动(清除该楼手改)</button>
        {:else}
          <h3>楼栋编辑</h3>
          <p class="hint">点击画布中的一栋楼进行选择,可修改高度、屋顶和窗户排布</p>
        {/if}
      </section>

      <section>
        <h3>操作说明</h3>
        <ul class="help">
          <li>拖动画布:环绕街区旋转视角</li>
          <li>滚轮:缩放</li>
          <li>点击楼体:选中并编辑</li>
          <li>拖动路灯:沿街调整与路对面的对齐位置</li>
        </ul>
      </section>
    </aside>

    <div class="viewport">
      <StreetScene />
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    background: #1e2228;
    color: #e4e8ec;
  }
  .app { display: flex; flex-direction: column; height: 100vh; }

  header {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 8px 14px; background: #262b33; border-bottom: 1px solid #343a44;
    font-size: 13px;
  }
  .logo { font-weight: 600; margin-right: 10px; }
  .sep { width: 1px; height: 20px; background: #3a414c; margin: 0 6px; }
  .notice { color: #7bd88a; margin-left: 8px; }

  input[type='number'], input[type='text'], select {
    background: #1a1e24; color: #e4e8ec; border: 1px solid #3a414c;
    border-radius: 4px; padding: 4px 8px; font-size: 13px;
  }
  .seed { width: 80px; }
  button {
    background: #2f6db3; color: #fff; border: none; border-radius: 4px;
    padding: 5px 12px; font-size: 13px; cursor: pointer;
  }
  button:hover { background: #3a7cc4; }
  button:disabled { background: #3a414c; cursor: default; }

  .main { display: flex; flex: 1; min-height: 0; }

  aside {
    width: 250px; flex-shrink: 0; overflow-y: auto;
    background: #262b33; border-right: 1px solid #343a44; padding: 12px;
  }
  section { margin-bottom: 18px; }
  h3 { font-size: 13px; margin: 0 0 10px; color: #9fb4cc; text-transform: uppercase; letter-spacing: 0.5px; }
  label { display: block; font-size: 13px; margin-bottom: 12px; }
  label b { float: right; color: #7ec8ff; font-weight: 600; }
  input[type='range'] { width: 100%; margin-top: 4px; accent-color: #2f6db3; }
  select { width: 100%; margin-top: 4px; }
  .badge {
    background: #b3782f; color: #fff; font-size: 11px; border-radius: 3px;
    padding: 1px 6px; margin-left: 6px; vertical-align: middle;
  }
  .hint { font-size: 12px; color: #8a94a0; line-height: 1.5; }
  .help { font-size: 12px; color: #8a94a0; padding-left: 16px; line-height: 1.8; margin: 0; }

  .viewport { flex: 1; min-width: 0; }
</style>
