import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { BottomToolbar } from './components/BottomToolbar';
import { Viewport } from './components/Viewport';
import { useEditor } from './editor/useEditor';

export default function App() {
  const editor = useEditor();

  useEffect(() => {
    Object.defineProperty(window, '__FLORAL_EDITOR__', {
      value: editor,
      configurable: true,
      writable: false,
    });
  }, [editor]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (isEditable(event.target)) return;

      if (mod && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) editor.ungroupSelected();
        else editor.groupSelected();
        return;
      }
      if (event.key === 'Escape') editor.clearSelection();
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editor.deleteSelected();
      }
      if (event.key.toLowerCase() === 'w') editor.setTransformMode('translate');
      if (event.key.toLowerCase() === 'e') editor.setTransformMode('rotate');
      if (event.key.toLowerCase() === 'r') editor.setTransformMode('scale');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor]);

  return (
    <div className="app-shell">
      <TopBar editor={editor} />
      <LeftPanel editor={editor} />
      <Viewport editor={editor} />
      <RightPanel editor={editor} />
      <BottomToolbar editor={editor} />
      {editor.toast ? (
        <div key={editor.toast.id} className={`toast toast-${editor.toast.kind}`} role="status">
          {editor.toast.text}
        </div>
      ) : null}
    </div>
  );
}
