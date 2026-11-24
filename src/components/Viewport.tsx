import { useEffect, useRef } from 'react';
import { EditorController } from '../editor/EditorController';
import { SceneEditor } from '../editor/SceneEditor';
import { ViewMode } from '../editor/types';

interface Props {
  editor: EditorController;
}

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'top', label: '俯视' },
  { key: 'side', label: '侧视' },
  { key: 'free', label: '自由视角' },
];

export function Viewport({ editor }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const scene = new SceneEditor(hostRef.current, editor);
    editor.scene = scene;
    return () => {
      scene.dispose();
      if (editor.scene === scene) editor.scene = null;
    };
  }, [editor]);

  return (
    <main className="viewport-column">
      <div className="viewport" ref={hostRef}>
        <div className="viewport-top-overlay">
          <div className="view-switcher" role="tablist" aria-label="视角切换">
            {VIEWS.map((view) => (
              <button
                key={view.key}
                type="button"
                className={editor.view === view.key ? 'view-button active' : 'view-button'}
                onClick={() => editor.setView(view.key)}
              >
                {view.label}
              </button>
            ))}
          </div>
          <div className="snap-badge">15° 旋转吸附</div>
        </div>

        <div className="viewport-bottom-overlay">
          <span><kbd>左键</kbd> 点选 / 框选</span>
          <span><kbd>Shift</kbd> 加选</span>
          <span><kbd>右键拖拽</kbd> 旋转视角</span>
          <span><kbd>滚轮</kbd> 缩放</span>
          <span><kbd>W</kbd>/<kbd>E</kbd>/<kbd>R</kbd> 变换</span>
        </div>
      </div>
    </main>
  );
}
