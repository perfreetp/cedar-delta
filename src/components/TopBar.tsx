import { useRef } from 'react';
import { EditorController } from '../editor/EditorController';

interface Props {
  editor: EditorController;
}

export function TopBar({ editor }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    editor.importJsonText(text);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <h1>宴屿 · 桌花排布台</h1>
          <p>Wedding Banquet Floral Layout Editor</p>
        </div>
      </div>

      <div className="history-actions" aria-label="撤销重做">
        <button
          type="button"
          className="icon-button"
          onClick={() => editor.undo()}
          disabled={!editor.canUndo}
          title={editor.past.at(-1) ? `撤销：${editor.past.at(-1)?.label}（Ctrl+Z）` : '没有可撤销操作'}
        >
          <span className="button-icon">↶</span>
          撤销
        </button>
        <span className="history-count">{editor.past.length}/50</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => editor.redo()}
          disabled={!editor.canRedo}
          title={editor.future.at(-1) ? `重做：${editor.future.at(-1)?.label}（Ctrl+Shift+Z）` : '没有可重做操作'}
        >
          <span className="button-icon">↷</span>
          重做
        </button>
      </div>

      <div className="top-actions">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <button type="button" className="ghost-button" onClick={() => fileRef.current?.click()}>
          导入 JSON
        </button>
        <button type="button" className="primary-button" onClick={() => editor.exportJson()}>
          导出方案 JSON
        </button>
      </div>
    </header>
  );
}
