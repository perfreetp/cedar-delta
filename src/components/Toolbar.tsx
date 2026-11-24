import { useRef, type ReactElement } from 'react';
import { useEditorStore } from '../store';
import type { ToolMode } from '../types';
import { getEngine } from './StageCanvas';
import { downloadJson, exportChoreography, readFileAsText, readImageAsDataURL, validateFile } from '../io/file-io';

const TOOLS: { id: ToolMode; label: string; hint: string }[] = [
  { id: 'stage', label: '戏台', hint: '点击空白放置偶；可拖动起点' },
  { id: 'path', label: '路径', hint: '点击/拖画追加经过点，拖动调整，双击插入，右键删除' },
  { id: 'keyframe', label: '关键帧', hint: '点经过点加帧；拖箭头改朝向，拖黄钮改停留，右键删帧' },
  { id: 'playback', label: '播放', hint: '沿时间轴播放走位' },
];

export function Toolbar(): ReactElement {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const setStage = useEditorStore((s) => s.setStage);
  const loadFile = useEditorStore((s) => s.loadFile);
  const reset = useEditorStore((s) => s.reset);
  const addStressPuppet = useEditorStore((s) => s.addStressPuppet);
  const puppetCount = useEditorStore((s) => s.puppets.length);
  const importRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const onImport = async (file: File): Promise<void> => {
    try {
      const text = await readFileAsText(file);
      const raw = JSON.parse(text);
      const result = validateFile(raw);
      if (!result.ok) {
        window.alert(`导入失败：${result.error}`);
        return;
      }
      loadFile(result.file);
      getEngine()?.fitView();
    } catch (err) {
      window.alert(`导入失败：${(err as Error).message}`);
    }
  };

  return (
    <header className="toolbar">
      <div className="brand">木偶走位编排</div>
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${tool === t.id ? 'active' : ''}`}
            title={t.hint}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tool-actions">
        <button className="action-btn" title="上传俯视戏台图" onClick={() => imageRef.current?.click()}>
          戏台图
        </button>
        <button
          className="action-btn"
          title="复位视图"
          onClick={() => getEngine()?.fitView()}
        >
          复位视图
        </button>
        <button
          className="action-btn primary"
          disabled={puppetCount === 0}
          onClick={() => downloadJson(exportChoreography())}
        >
          导出走位
        </button>
        <button className="action-btn" onClick={() => importRef.current?.click()}>
          导入
        </button>
        <button
          className="action-btn danger"
          onClick={() => {
            if (window.confirm('确定清空全部编排数据？')) reset();
          }}
        >
          清空
        </button>
        <button
          className="action-btn"
          title="生成 3000 个经过点的长轨迹，验证大规模流畅性"
          onClick={() => addStressPuppet(3000)}
        >
          压测 3000 点
        </button>
      </div>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImport(f);
          e.target.value = '';
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setStage({ imageUrl: await readImageAsDataURL(f) });
          e.target.value = '';
        }}
      />
    </header>
  );
}
