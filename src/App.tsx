import { useEffect, useState } from 'react';
import { store, useAppState } from './state/store';
import { FontImportPanel } from './components/FontImportPanel';
import { ExtrudePanel } from './components/ExtrudePanel';
import { LayoutPanel } from './components/LayoutPanel';
import { ExportPanel } from './components/ExportPanel';
import { Viewport } from './components/Viewport';
import { useSyncExternalStore } from 'react';

const TABS = ['字体导入台', '单字立体化', '排布台', '成品台'] as const;

export default function App() {
  const [tab, setTab] = useState(0);
  useAppState(); // 订阅状态变化以刷新撤销按钮
  const canUndo = useSyncExternalStore(store.subscribe, store.canUndo);
  const canRedo = useSyncExternalStore(store.subscribe, store.canRedo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <header>
        <h1>婚礼迎宾区 · 立体字排版工具</h1>
        <nav>
          {TABS.map((t, i) => (
            <button key={t} className={tab === i ? 'active' : ''} onClick={() => setTab(i)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="history-btns">
          <button disabled={!canUndo} onClick={() => store.undo()} title="Ctrl+Z">↩ 撤销</button>
          <button disabled={!canRedo} onClick={() => store.redo()} title="Ctrl+Y">↪ 重做</button>
        </div>
      </header>
      <main>
        <aside>
          {tab === 0 && <FontImportPanel />}
          {tab === 1 && <ExtrudePanel />}
          {tab === 2 && <LayoutPanel />}
          {tab === 3 && <ExportPanel />}
        </aside>
        <Viewport />
      </main>
    </div>
  );
}
