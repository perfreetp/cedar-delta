import { useEffect, useRef } from 'react';
import { EditorEngine } from '../three/EditorEngineInteractive';
import { setEngine } from '../engineRegistry';
import { useEditorStore } from '../store';

export function Viewport(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const toolMode = useEditorStore((s) => s.toolMode);

  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new EditorEngine(containerRef.current);
    engineRef.current = engine;
    setEngine(engine);
    return () => {
      engine.dispose();
      setEngine(null);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setToolMode(toolMode);
  }, [toolMode]);

  return <div ref={containerRef} className="viewport" />;
}
