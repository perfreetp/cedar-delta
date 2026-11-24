import { useEffect, useRef, type ReactElement } from 'react';
import { StageEngine } from '../pixi/StageEngine';

let engineRef: StageEngine | null = null;

export function getEngine(): StageEngine | null {
  return engineRef;
}

export function StageCanvas(): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const engine = new StageEngine();
    engineRef = engine;
    let cancelled = false;
    engine
      .init(hostRef.current!)
      .then(() => {
        if (cancelled) engine.destroy();
        else engine.fitView();
      })
      .catch((err) => console.error('Pixi 初始化失败', err));
    return () => {
      cancelled = true;
      engine.destroy();
      engineRef = null;
    };
  }, []);

  return <div ref={hostRef} className="stage-canvas" aria-label="戏台画布" />;
}
