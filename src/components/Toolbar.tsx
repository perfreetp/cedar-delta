import React, { useRef } from 'react';
import { sceneApiRef, useTimeline } from '../timeline/store';
import { deleteKey, findNode, groupNodes, isGroup } from '../timeline/model';
import type { TrackNode } from '../timeline/types';

export function Toolbar() {
  const { state, dispatch, save, exportJson, importJson, reset } = useTimeline();
  const fileRef = useRef<HTMLInputElement>(null);

  const selKey = state.selectedKey;
  let selKeyInfo: { trackName: string; index: number; count: number; time: number } | null = null;
  if (selKey) {
    const n = findNode(state.doc.nodes, selKey.trackId);
    if (n && !isGroup(n)) {
      const t = n as TrackNode;
      const idx = t.keys.findIndex((k) => k.id === selKey.keyId);
      if (idx >= 0) selKeyInfo = { trackName: t.name, index: idx, count: t.keys.length, time: t.keys[idx].time };
    }
  }

  return (
    <div className="toolbar">
      <button className="btn primary" onClick={() => dispatch({ type: 'togglePlay' })}>
        {state.playing ? '⏸ 暂停' : '▶ 播放'}
      </button>
      <span className="time-display">
        {state.time.toFixed(2)}s / {state.doc.duration}s
      </span>
      <label className="check">
        <input type="checkbox" checked={state.loop} onChange={() => dispatch({ type: 'toggleLoop' })} />
        循环
      </label>
      <label className="check" title="移动关键帧时,其后的关键帧按相同位移自动重排">
        <input type="checkbox" checked={state.ripple} onChange={() => dispatch({ type: 'toggleRipple' })} />
        涟漪重排
      </label>
      <label className="check" title="相机由相机轨道驱动;关闭后可自由环绕视角">
        <input
          type="checkbox"
          checked={state.cameraDriven}
          onChange={() => dispatch({ type: 'toggleCameraDriven' })}
        />
        相机轨道
      </label>

      <span className="sep" />

      <label className="check">
        操作手柄
        <select
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value as '' | 'instrument' | 'guidewire';
            sceneApiRef.current?.setGizmoTarget(v === '' ? null : v);
          }}
        >
          <option value="">关闭</option>
          <option value="instrument">移动器械</option>
          <option value="guidewire">移动导针</option>
        </select>
      </label>

      <button
        className="btn"
        disabled={state.selectedNodeIds.length < 2}
        title="把勾选的轨道/组收进一个新组(需同一层级)"
        onClick={() =>
          dispatch({ type: 'mutate', fn: (doc) => groupNodes(doc, state.selectedNodeIds) })
        }
      >
        编组({state.selectedNodeIds.length})
      </button>

      <span className="sep" />

      {selKeyInfo ? (
        <>
          <span className="hint">
            已选:{selKeyInfo.trackName} 第 {selKeyInfo.index + 1}/{selKeyInfo.count} 帧 @
            {selKeyInfo.time.toFixed(2)}s
          </span>
          <button
            className="btn"
            disabled={selKeyInfo.index >= selKeyInfo.count - 1}
            title="编辑该帧到下一段的缓动曲线"
            onClick={() => selKey && dispatch({ type: 'setCurveEdit', target: selKey })}
          >
            调曲线
          </button>
          <button
            className="btn danger"
            onClick={() => {
              dispatch({
                type: 'mutate',
                fn: (doc) => {
                  const t = findNode(doc.nodes, selKey!.trackId);
                  if (t && !isGroup(t)) deleteKey(t as TrackNode, selKey!.keyId);
                },
              });
              dispatch({ type: 'clearKeySelection' });
            }}
          >
            删帧
          </button>
        </>
      ) : (
        <span className="hint">单击关键帧选中,双击调曲线;轨道上的 ● 在播放头处记帧</span>
      )}

      <span className="sep" />

      <label className="check">
        总时长
        <input
          className="dur-input"
          type="number"
          min={1}
          step={1}
          value={state.doc.duration}
          onChange={(e) => {
            const d = Math.max(1, parseFloat(e.target.value) || 1);
            dispatch({ type: 'mutate', fn: (doc) => void (doc.duration = d) });
          }}
        />
        s
      </label>

      <button className="btn" onClick={save} title="保存到浏览器本地存储">
        保存{state.savedAt ? ' ✓' : ''}
      </button>
      <button className="btn" onClick={exportJson}>
        导出
      </button>
      <button className="btn" onClick={() => fileRef.current?.click()}>
        导入
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f && !importJson(await f.text())) window.alert('导入失败:文件格式不正确');
          e.target.value = '';
        }}
      />
      <button
        className="btn danger"
        onClick={() => {
          if (window.confirm('恢复默认演示时间轴?当前修改将丢失。')) reset();
        }}
      >
        重置
      </button>
    </div>
  );
}
