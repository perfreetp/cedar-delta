/**
 * 应用外壳：工具栏 + 物体库 + 3D 视口 + 右侧面板
 * controller 在 Viewport 内创建，通过信号提升给工具栏/物体库共享。
 */
import { createSignal } from 'solid-js';
import { Toolbar } from './components/Toolbar';
import { ObjectLibrary } from './components/ObjectLibrary';
import { Viewport } from './components/Viewport';
import { RightPanel } from './components/RightPanel';
import type { InteractionController } from './three/controller';

// 控制器实例由 Viewport 挂载后注册，供面板按钮调用
export const [controller, setController] = createSignal<InteractionController>();
export function registerController(c: InteractionController): void {
  setController(c);
}

export function App() {
  return (
    <div class="app">
      <Toolbar controller={controller} />
      <ObjectLibrary controller={controller} />
      <Viewport />
      <RightPanel />
    </div>
  );
}
