// 引擎实例注册表:React 组件通过它访问 three.js 编排引擎
import type { EditorEngine } from './three/EditorEngineInteractive';

let current: EditorEngine | null = null;

export function setEngine(engine: EditorEngine | null): void {
  current = engine;
}

export function getEngine(): EditorEngine | null {
  return current;
}
