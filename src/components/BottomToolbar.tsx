import { EditorController } from '../editor/EditorController';
import { TransformMode } from '../editor/types';

interface Props {
  editor: EditorController;
}

const MODES: { key: TransformMode; label: string; icon: string; shortcut: string }[] = [
  { key: 'translate', label: '移动', icon: '✥', shortcut: 'W' },
  { key: 'rotate', label: '旋转', icon: '⟳', shortcut: 'E' },
  { key: 'scale', label: '缩放', icon: '⤢', shortcut: 'R' },
];

export function BottomToolbar({ editor }: Props) {
  const hasSelection = editor.selection.size > 0;

  return (
    <footer className="bottom-toolbar">
      <div className="toolbar-group transform-group" aria-label="变换工具">
        {MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={editor.mode === mode.key ? 'tool-button active' : 'tool-button'}
            onClick={() => editor.setTransformMode(mode.key)}
            title={`${mode.label}（${mode.shortcut}）`}
          >
            <span className="tool-icon">{mode.icon}</span>
            {mode.label}
            <kbd>{mode.shortcut}</kbd>
          </button>
        ))}
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group layout-group" aria-label="排布工具">
        <button
          type="button"
          className="layout-button"
          disabled={!hasSelection}
          onClick={() => editor.mirrorSelected(false)}
          title="以组中心做水平镜像"
        >
          <span className="tool-icon">◧</span>
          水平镜像
        </button>
        <button
          type="button"
          className="layout-button secondary"
          disabled={!hasSelection}
          onClick={() => editor.mirrorSelected(true)}
          title="保留原件，并在另一侧生成水平镜像副本"
        >
          <span className="tool-icon">⧉</span>
          镜像复制
        </button>

        <div className="toolbar-divider subtle" />

        <span className="array-label">环形阵列</span>
        <button
          type="button"
          className="array-button"
          disabled={!hasSelection}
          onClick={() => editor.circularArray(8)}
          title="保留当前组作为第 1 份，按 8 等分生成完整圆环"
        >
          <strong>8</strong> 等分
        </button>
        <button
          type="button"
          className="array-button"
          disabled={!hasSelection}
          onClick={() => editor.circularArray(12)}
          title="保留当前组作为第 1 份，按 12 等分生成完整圆环"
        >
          <strong>12</strong> 等分
        </button>
      </div>

      <div className="toolbar-hint">
        {hasSelection ? `已选 ${editor.selection.size} 个实例 · 可整体变换` : '框选花材后使用排布工具'}
      </div>
    </footer>
  );
}
