import { useMemo, useState } from 'react';
import { store, useAppState, nextId } from '../state/store';
import { fontManager, useFont } from '../font/fontManager';
import { glyphAdvance } from '../geometry/extrude';
import { layoutBlocks } from '../layout/pathLayout';
import { Slider } from './Slider';

/** 模块三：排布台 —— 直线/圆弧路径排字、字间距与弧度、切线朝向、重叠吸附提示 */
export function LayoutPanel() {
  const state = useAppState();
  const font = useFont();
  const { layout } = state;
  const [text, setText] = useState('');

  const result = useMemo(() => {
    if (!font) return null;
    const widths = new Map<string, number>();
    for (const b of state.blocks) widths.set(b.id, glyphAdvance(b.glyphIndex));
    return layoutBlocks(state.blocks, widths, layout);
  }, [font, state.blocks, layout]);

  const set = (patch: Partial<typeof layout>, transient = false) => {
    const fn = (s: typeof state) => ({ ...s, layout: { ...s.layout, ...patch } });
    if (transient) store.setTransient(fn);
    else store.commit(fn);
  };

  const addText = (replace: boolean) => {
    if (!font || !text) return;
    const newBlocks = [...text].map((ch) => ({
      id: nextId(),
      glyphIndex: fontManager.charToGlyphIndex(ch),
      char: ch,
    }));
    store.commit((s) => ({
      ...s,
      blocks: replace ? newBlocks : [...s.blocks, ...newBlocks],
    }));
  };

  const removeBlock = (id: string) => {
    store.commit((s) => ({
      ...s,
      blocks: s.blocks.filter((b) => b.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    store.commit((s) => {
      const i = s.blocks.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.blocks.length) return s;
      const blocks = [...s.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...s, blocks };
    });
  };

  if (!font) return <div className="panel"><h2>③ 排布台</h2><p className="dim">请先加载字体。</p></div>;

  return (
    <div className="panel">
      <h2>③ 排布台</h2>
      <div className="row">
        <input
          className="grow"
          placeholder="输入文字，如：永结同心"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addText(false)}
        />
        <button onClick={() => addText(false)}>追加</button>
        <button onClick={() => addText(true)}>替换</button>
      </div>

      <div className="row">
        <label>
          <input
            type="radio"
            checked={layout.mode === 'line'}
            onChange={() => set({ mode: 'line' })}
          />
          直线
        </label>
        <label>
          <input
            type="radio"
            checked={layout.mode === 'arc'}
            onChange={() => set({ mode: 'arc' })}
          />
          圆弧
        </label>
        {layout.mode === 'arc' && (
          <button onClick={() => set({ arcBulge: layout.arcBulge === 1 ? -1 : 1 })}>
            翻转凸向
          </button>
        )}
      </div>

      <Slider label="字间距" min={-0.2} max={1} step={0.005} value={layout.spacing}
        onChange={(v) => set({ spacing: v }, true)} format={(v) => v.toFixed(3)} />
      {layout.mode === 'arc' && (
        <Slider label="整体弧度" min={10} max={360} step={1} value={layout.arcAngle}
          onChange={(v) => set({ arcAngle: v }, true)} format={(v) => `${v.toFixed(0)}°`} />
      )}

      {result && result.overlaps.length > 0 && (
        <div className="warn">
          ⚠ 检测到 {result.overlaps.length} 处字块重叠
          <button
            className="snap-btn"
            onClick={() => set({ spacing: result.snapSpacing })}
            title={`吸附到字间距 ${result.snapSpacing.toFixed(3)}`}
          >
            吸附对齐（间距 → {result.snapSpacing.toFixed(3)}）
          </button>
        </div>
      )}

      <div className="dim small">{state.blocks.length} 个字块 · 路径全长 {result?.totalLength.toFixed(2) ?? 0}</div>
      <div className="block-list">
        {state.blocks.map((b, i) => (
          <div
            key={b.id}
            className={`block-item ${b.id === state.selectedId ? 'active' : ''}`}
            onClick={() => store.commit((s) => ({ ...s, selectedId: b.id }))}
          >
            <span className="block-char">{b.char}</span>
            <span className="dim small">#{i + 1}</span>
            <button onClick={(e) => { e.stopPropagation(); moveBlock(b.id, -1); }}>←</button>
            <button onClick={(e) => { e.stopPropagation(); moveBlock(b.id, 1); }}>→</button>
            <button onClick={(e) => { e.stopPropagation(); removeBlock(b.id); }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
