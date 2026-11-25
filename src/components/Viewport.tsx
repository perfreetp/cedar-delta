import React, { useEffect, useRef } from 'react';
import { Color3 } from '@babylonjs/core';
import { createScene, type SceneHandle } from '../scene/createScene';
import { sceneApiRef, useTimeline } from '../timeline/store';
import { allTracks } from '../timeline/model';

const PATH_COLORS: Record<string, Color3> = {
  instrument: new Color3(0.4, 0.7, 1),
  guidewire: new Color3(1, 0.8, 0.2),
  camera: new Color3(0.4, 1, 0.6),
};

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const { state } = useTimeline();

  // 初始化场景(一次)
  useEffect(() => {
    const handle = createScene(canvasRef.current!);
    handleRef.current = handle;
    sceneApiRef.current = {
      getPose: (t) => handle.getPose(t),
      applyPoses: (p) => handle.applyPoses(p),
      refreshHelpers: () => {},
      setGizmoTarget: (t) => handle.setGizmoTarget(t),
    };
    return () => {
      sceneApiRef.current = null;
      handle.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 相机是否由时间轴驱动
  useEffect(() => {
    handleRef.current?.setCameraDriven(state.cameraDriven);
  }, [state.cameraDriven]);

  // 文档变化 -> 重画关键帧路径
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    const byTarget = new Map<string, [number, number, number][]>();
    for (const tr of allTracks(state.doc.nodes)) {
      const pts = byTarget.get(tr.target) ?? [];
      for (const k of tr.keys) pts.push(k.position);
      byTarget.set(tr.target, pts);
    }
    h.drawPaths(
      [...byTarget.entries()].map(([target, points]) => ({
        points,
        color: PATH_COLORS[target] ?? new Color3(1, 1, 1),
      })),
    );
  }, [state.doc]);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      <div className="viewport-hint">
        {state.cameraDriven
          ? '相机由时间轴驱动 · 关闭右上角「相机轨道」可自由环绕'
          : '自由视角:拖拽环绕 / 滚轮缩放 · 打开「相机轨道」回到时间轴相机'}
      </div>
    </div>
  );
}
