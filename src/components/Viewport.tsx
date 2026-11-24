import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { unwrap } from 'solid-js/store';
import InspectorCard from './InspectorCard';
import { CollisionEngine } from '../geometry/CollisionEngine';
import { collisionRunNonce } from '../state/collisionController';
import { projectStore } from '../state/projectStore';
import { RiverSceneManager } from '../three/RiverSceneManager';
import type { TransformMode, Vec3Tuple } from '../types';

export default function Viewport() {
  let host!: HTMLDivElement;
  let manager: RiverSceneManager | undefined;
  const engine = new CollisionEngine();
  const [mode, setModeSignal] = createSignal<TransformMode>('translate');
  const [dragOver, setDragOver] = createSignal(false);
  const [sceneError, setSceneError] = createSignal('');

  let lastRunAt = 0;
  let scheduledTimer: number | undefined;
  let runSerial = 0;
  let riverKey = JSON.stringify(projectStore.doc.river);

  const ensureEngine = async () => {
    projectStore.setCollisionReport((current) => ({ ...current, computing: true }));
    await engine.init(unwrap(projectStore.doc).river);
    projectStore.setCollisionReport((current) => ({ ...current, ready: true }));
  };

  const runCollision = async () => {
    const serial = ++runSerial;
    try {
      if (!engine.ready) await ensureEngine();
      const result = engine.detect(unwrap(projectStore.doc).obstacles);
      if (serial !== runSerial) return;
      lastRunAt = performance.now();
      projectStore.setCollisionReport({
        ready: true,
        computing: false,
        laneVolumes: result.laneVolumes,
        pairs: result.pairs,
        durationMs: result.durationMs,
        obstacleCount: result.solidCount,
        solidCount: result.solidCount,
      });
    } catch (error) {
      if (serial !== runSerial) return;
      const message = error instanceof Error ? error.message : String(error);
      projectStore.setCollisionReport((current) => ({ ...current, ready: false, computing: false, error: message }));
    }
  };

  const scheduleCollision = () => {
    window.clearTimeout(scheduledTimer);
    const elapsed = performance.now() - lastRunAt;
    const wait = Math.max(0, 110 - elapsed);
    scheduledTimer = window.setTimeout(() => void runCollision(), wait);
  };

  const createScene = () => {
    if (!host) return;
    manager = new RiverSceneManager(host, projectStore.doc, {
      onSelect: (id, additive) => projectStore.selectObstacle(id, additive),
      onTransformStart: () => projectStore.beginGesture('手柄平移/旋转'),
      onTransformChange: (updates) => projectStore.applyTransformGesture(updates),
      onTransformEnd: () => projectStore.endGesture(),
    });
    manager.setMode(mode());
    manager.sync(projectStore.doc.obstacles, projectStore.selectedIds(), projectStore.doc.detection);
  };

  onMount(() => {
    try {
      createScene();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSceneError(`三维视口初始化失败：${message}。请确认浏览器已启用 WebGL / 硬件加速。`);
      return;
    }

    void ensureEngine().then(() => runCollision());

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (event.key === 'w' || event.key === 'W') setMode('translate');
      if (event.key === 'e' || event.key === 'E') setMode('rotate');
      if (event.key === 'f' || event.key === 'F') manager?.focusSelection();
    };
    window.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(scheduledTimer);
      manager?.dispose();
      engine.dispose();
    });
  });

  createEffect(() => {
    const obstacles = projectStore.doc.obstacles;
    const ids = projectStore.selectedIds();
    const detection = projectStore.doc.detection;
    manager?.sync(obstacles, ids, detection);
  });

  createEffect(() => {
    const nextRiver = projectStore.doc.river;
    const nextKey = JSON.stringify(nextRiver);
    if (nextKey === riverKey) return;
    riverKey = nextKey;

    void engine
      .init(unwrap(projectStore.doc).river)
      .then(() => runCollision())
      .catch((error) => {
        projectStore.setCollisionReport((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }));
      });

    if (manager) {
      manager.dispose();
      try {
        createScene();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSceneError(`三维河道重建失败：${message}`);
      }
    }
  });

  createEffect(() => {
    const serialized = JSON.stringify(projectStore.doc.obstacles);
    void serialized;
    scheduleCollision();
  });

  createEffect(() => {
    collisionRunNonce();
    if (engine.ready) void runCollision();
  });

  createEffect(() => {
    const report = projectStore.collisionReport();
    const detection = projectStore.doc.detection;
    const lane = new Set<string>();
    const pair = new Set<string>();
    const reef = new Set<string>();
    for (const [id, volume] of Object.entries(report.laneVolumes)) {
      if (volume > detection.laneThreshold) lane.add(id);
    }
    for (const collision of report.pairs) {
      if (collision.volume > detection.pairThreshold) {
        pair.add(collision.aId);
        pair.add(collision.bId);
      }
    }
    for (const obstacle of projectStore.doc.obstacles) {
      if (obstacle.exposure <= detection.reefThreshold) reef.add(obstacle.id);
    }
    manager?.setHighlights({ lane, pair, reef, selected: new Set(projectStore.selectedIds()) });
  });

  const setMode = (next: TransformMode) => {
    setModeSignal(next);
    manager?.setMode(next);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const libraryId =
      event.dataTransfer?.getData('application/x-river-library') || event.dataTransfer?.getData('text/plain');
    if (!libraryId) return;
    let point: Vec3Tuple | undefined;
    if (manager) {
      const p = manager.screenToWaterPoint(event.clientX, event.clientY);
      if (p) point = p;
    }
    projectStore.addLibraryItem(libraryId, point);
  };

  const enginePillClass = () => {
    const report = projectStore.collisionReport();
    if (report.error) return 'error';
    return report.ready ? 'ready' : '';
  };
  const engineText = () => {
    const report = projectStore.collisionReport();
    if (report.error) return '碰撞引擎异常';
    if (!report.ready) return '正在加载 Manifold WASM…';
    if (report.computing) return 'Manifold 实时布尔求交…';
    return `Manifold 就绪 · 上次 ${report.durationMs.toFixed(0)}ms`;
  };

  return (
    <main class="viewport-column">
      <div
        ref={host}
        class={`viewport ${dragOver() ? 'drag-over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <div class="viewport-toolbar" role="toolbar" aria-label="变换工具">
          <button class={`tool-button ${mode() === 'translate' ? 'active' : ''}`} title="平移 W" onClick={() => setMode('translate')}>
            ✥
          </button>
          <button class={`tool-button ${mode() === 'rotate' ? 'active' : ''}`} title="旋转 E" onClick={() => setMode('rotate')}>
            ⟳
          </button>
          <div class="tool-divider" />
          <button class="tool-button" title="聚焦选中 F" onClick={() => manager?.focusSelection()}>
            ◎
          </button>
          <button class="tool-button" title="取消选择 Esc" onClick={() => projectStore.setSelectedIds([])}>
            ×
          </button>
        </div>

        <div class="engine-pill">
          <span class={`status-dot ${enginePillClass()}`} />
          {engineText()}
        </div>

        <Show when={sceneError()}>
          <div
            style={{
              position: 'absolute',
              inset: '70px 20px 60px',
              'z-index': 20,
              display: 'grid',
              'place-items': 'center',
              padding: '30px',
              'border-radius': '18px',
              border: '1px solid rgba(251,77,109,.5)',
              background: 'rgba(30,8,18,.88)',
              color: '#ffe4e6',
              'text-align': 'center',
              'font-weight': 750,
            }}
          >
            {sceneError()}
          </div>
        </Show>

        <InspectorCard />

        <div class="viewport-hint">
          左键选择 / 拖拽手柄 · <span class="kbd">W</span> 平移 · <span class="kbd">E</span> 旋转 · 右键平移视角 · 滚轮缩放
        </div>
      </div>
    </main>
  );
}
