import { useEditorStore } from '../store';
import { getEngine } from '../engineRegistry';
import { ActionButton } from './Controls';

const MODULES: Array<{ id: 'sculpt' | 'profile' | 'gate' | 'export'; label: string; icon: string }> = [
  { id: 'sculpt', label: '地形雕刻', icon: '⛰' },
  { id: 'profile', label: '坡度剖面', icon: '📉' },
  { id: 'gate', label: '闸门布置', icon: '🚩' },
  { id: 'export', label: '赛道导出', icon: '📦' },
];

export function TopBar(): JSX.Element {
  const activeModule = useEditorStore((s) => s.activeModule);
  const setModule = useEditorStore((s) => s.setModule);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const trackName = useEditorStore((s) => s.trackName);
  const setTrackName = useEditorStore((s) => s.setTrackName);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">🌊</span>
        <span>激流赛道河床编辑器</span>
      </div>
      <nav className="modules">
        {MODULES.map((m) => (
          <button
            key={m.id}
            className={`module-tab ${activeModule === m.id ? 'active' : ''}`}
            onClick={() => setModule(m.id)}
          >
            <span className="module-icon">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <input
          className="track-name"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          placeholder="赛道名称"
        />
        <div className="history-btns">
          <ActionButton variant="ghost" disabled={!canUndo} onClick={() => getEngine()?.undo()}>
            ↶ 撤销
          </ActionButton>
          <ActionButton variant="ghost" disabled={!canRedo} onClick={() => getEngine()?.redo()}>
            ↷ 重做
          </ActionButton>
        </div>
      </div>
    </header>
  );
}
