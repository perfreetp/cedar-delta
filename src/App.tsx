import React from 'react';
import { TimelineProvider } from './timeline/store';
import { Viewport } from './components/Viewport';
import { Toolbar } from './components/Toolbar';
import { Timeline } from './components/Timeline';
import { CurveEditor } from './components/CurveEditor';

export default function App() {
  return (
    <TimelineProvider>
      <div className="app">
        <header className="app-header">
          <h1>术中植入路径动画时间轴</h1>
        </header>
        <Toolbar />
        <div className="main">
          <Viewport />
          <CurveEditor />
        </div>
        <Timeline />
      </div>
    </TimelineProvider>
  );
}
