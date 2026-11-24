import type { ReactElement } from 'react';
import { Toolbar } from './components/Toolbar';
import { StageCanvas } from './components/StageCanvas';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';

export function App(): ReactElement {
  return (
    <div className="app-shell">
      <Toolbar />
      <div className="workspace">
        <StageCanvas />
        <Sidebar />
      </div>
      <Timeline />
    </div>
  );
}
