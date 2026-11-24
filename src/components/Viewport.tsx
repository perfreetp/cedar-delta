/**
 * 3D 视口：装配 SceneEngine + InteractionController，
 * 订阅 store 的场景变更，自动重建地面/实例层并维护拾取反查表。
 */
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { SceneEngine } from '../three/engine';
import { InteractionController } from '../three/controller';
import { planner } from '../store/store';
import { registerController } from '../App';

export function Viewport() {
  let container: HTMLDivElement | undefined;
  let engine: SceneEngine | undefined;
  let controller: InteractionController | undefined;
  const [status, setStatus] = createSignal('');

  onMount(() => {
    if (!container) return;
    engine = new SceneEngine(container);
    controller = new InteractionController(engine, planner);
    registerController(controller);

    const onView = (e: Event) => {
      const mode = (e as CustomEvent<'perspective' | 'top'>).detail;
      engine?.setViewMode(mode);
    };
    window.addEventListener('wvp:view', onView);

    const syncAll = () => {
      engine!.rebuildGround(planner.regions);
      engine!.rebuildInstances(planner.objects, planner.selectedIds[0](), null);
      controller!.syncFromStore();
      setStatus(`${planner.objects.length} 个物体 · ${planner.regions.length} 个区域`);
    };
    syncAll();

    // 结构变更（增删/显隐/区域/导入/撤销重做）→ 全量重建
    const offScene = planner.onSceneChange(syncAll);

    // 选择集变化 → 仅高亮
    createEffect(() => {
      const ids = planner.selectedIds[0]();
      engine?.updateHighlights(ids, null);
    });

    // 网格间距变化 → 重建 GridHelper
    createEffect(() => {
      const size = planner.snapSettings.gridSize;
      engine?.setGridSize(size);
    });

    onCleanup(() => {
      window.removeEventListener('wvp:view', onView);
      offScene();
      controller?.dispose();
      engine?.dispose();
    });
  });

  return (
    <div class="viewport-wrap">
      <div ref={container} class="viewport" />
      <div class="viewport-help">
        左键拖动物体移动 · Shift+拖动旋转 · 空白处拖拽框选
        <br />
        右键旋转视角 · Alt 临时关闭吸附 · Delete 删除 · Ctrl+Z/Y 撤销重做
      </div>
      <div class="viewport-status">{status()}</div>
    </div>
  );
}
