/**
 * 顶部工具栏：工具模式、视角、吸附总开关、撤销重做、项目导入导出
 */
import { createSignal, onMount } from 'solid-js';
import { planner } from '../store/store';
import { importProjectFile } from '../lib/storage';
import type { InteractionController } from '../three/controller';

export function Toolbar(props: { controller: () => InteractionController | undefined }) {
  const [tool, setTool] = createSignal<'select' | 'rect' | 'polygon'>('select');
  const [view, setView] = createSignal<'perspective' | 'top'>('perspective');
  const [snapOff, setSnapOff] = createSignal(false);
  const [canUndo] = planner.history.canUndo;
  const [canRedo] = planner.history.canRedo;
  let fileInput: HTMLInputElement | undefined;

  const pickTool = (t: 'select' | 'rect' | 'polygon') => {
    setTool(t);
    const c = props.controller();
    if (!c) return;
    if (t === 'select') c.setSelectMode();
    if (t === 'rect') c.setDrawRectMode();
    if (t === 'polygon') c.setDrawPolygonMode();
  };

  const toggleView = () => {
    const next = view() === 'perspective' ? 'top' : 'perspective';
    setView(next);
    window.dispatchEvent(new CustomEvent('wvp:view', { detail: next }));
  };

  const toggleSnap = () => {
    const next = !snapOff();
    setSnapOff(next);
    planner.snapTemporarilyOff[1](next);
  };

  const onImport = async (file: File) => {
    try {
      const data = await importProjectFile(file);
      planner.replaceProject(data);
      props.controller()?.syncFromStore();
      setTool('select');
      props.controller()?.setSelectMode();
    } catch (err) {
      alert(err instanceof Error ? err.message : '导入失败');
    }
  };

  // 控制器内部 Esc/右键退出绘制时同步按钮态
  onMount(() => {
    const sync = () => {
      const kind = props.controller()?.getModeKind();
      if (kind === 'draw-rect') setTool('rect');
      else if (kind === 'draw-polygon') setTool('polygon');
      else if (kind === 'select' || kind === 'place') setTool('select');
    };
    const c = props.controller();
    if (c) c.onModeChange(sync);
  });

  return (
    <header class="toolbar">
      <div class="brand">💍 婚礼场地布置</div>
      <div class="tool-group">
        <button
          classList={{ active: tool() === 'select' }}
          onClick={() => pickTool('select')}
          title="选择/移动 (Esc)"
        >
          🖱️ 选择
        </button>
        <button
          classList={{ active: tool() === 'rect' }}
          onClick={() => pickTool('rect')}
          title="在地面拖拽绘制矩形区域"
        >
      ▭ 矩形区域
        </button>
        <button
          classList={{ active: tool() === 'polygon' }}
          onClick={() => pickTool('polygon')}
          title="左键加点，双击/右键完成"
        >
          ⬡ 多边形区域
        </button>
      </div>

      <div class="tool-group">
        <button onClick={toggleView} title="切换俯视 / 透视视角">
          {view() === 'perspective' ? '🧭 透视' : '🗺️ 俯视'}
        </button>
        <button
          classList={{ active: !snapOff(), 'toggle-off': snapOff() }}
          onClick={toggleSnap}
          title="临时关闭吸附 (按住 Alt 同样有效)"
        >
          🧲 吸附 {snapOff() ? '关' : '开'}
        </button>
      </div>

      <div class="tool-group">
        <button
          disabled={!canUndo()}
          onClick={() => {
            planner.history.undo();
            props.controller()?.syncFromStore();
          }}
          title="Ctrl+Z"
        >
          ↶ 撤销
        </button>
        <button
          disabled={!canRedo()}
          onClick={() => {
            planner.history.redo();
            props.controller()?.syncFromStore();
          }}
          title="Ctrl+Y / Ctrl+Shift+Z"
        >
          ↷ 重做
        </button>
      </div>

      <div class="tool-group">
        <button
          onClick={() => {
            if (confirm('新建项目将清空当前场地（可先导出备份），确定？')) {
              planner.newProject();
              props.controller()?.syncFromStore();
            }
          }}
        >
          📄 新建
        </button>
        <button onClick={() => fileInput?.click()}>📂 导入</button>
        <button class="primary" onClick={() => planner.exportFile()}>
          💾 导出
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) onImport(f);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </header>
  );
}
