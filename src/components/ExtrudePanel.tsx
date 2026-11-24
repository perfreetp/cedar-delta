import { useMemo } from 'react';
import { store, useAppState } from '../state/store';
import { fontManager, useFont } from '../font/fontManager';
import { getBlockGeometry } from '../geometry/extrude';
import { GlyphPreview } from './GlyphPreview';
import { Slider } from './Slider';

/** 模块二：单字立体化面板 —— 挤出厚度、前脸内凹浮雕、侧边斜切倒角 */
export function ExtrudePanel() {
  const state = useAppState();
  const font = useFont();
  const { extrude } = state;

  const selectedBlock = state.blocks.find((b) => b.id === state.selectedId) ?? state.blocks[0] ?? null;

  const warnings = useMemo(() => {
    if (!font || !selectedBlock) return [];
    const geo = getBlockGeometry(selectedBlock.glyphIndex, extrude);
    return geo?.warnings ?? [];
  }, [font, selectedBlock, extrude]);

  const set = (patch: Partial<typeof extrude>, transient = false) => {
    const fn = (s: typeof state) => ({ ...s, extrude: { ...s.extrude, ...patch } });
    if (transient) store.setTransient(fn);
    else store.commit(fn);
  };

  if (!font) return <div className="panel"><h2>② 单字立体化</h2><p className="dim">请先在字体导入台加载字体。</p></div>;
  if (state.blocks.length === 0)
    return <div className="panel"><h2>② 单字立体化</h2><p className="dim">排布台还没有字块，请先在字体导入台加入字形。</p></div>;

  return (
    <div className="panel">
      <h2>② 单字立体化</h2>
      {selectedBlock && (
        <div className="row preview-row">
          <GlyphPreview glyphIndex={selectedBlock.glyphIndex} size={120} />
          <div>
            <div>当前字块：{selectedBlock.char}</div>
            <div className="dim small">
              {fontManager.glyphInfo(selectedBlock.glyphIndex)?.name} · 参数全局生效
            </div>
          </div>
        </div>
      )}
      <Slider label="挤出厚度" min={0.05} max={1.5} step={0.01} value={extrude.depth}
        onChange={(v) => set({ depth: v }, true)} />
      <Slider label="倒角宽度" min={0} max={0.15} step={0.005} value={extrude.bevelSize}
        onChange={(v) => set({ bevelSize: v }, true)} format={(v) => v.toFixed(3)} />
      <Slider label="倒角厚度" min={0} max={0.15} step={0.005} value={extrude.bevelThickness}
        onChange={(v) => set({ bevelThickness: v }, true)} format={(v) => v.toFixed(3)} />
      <Slider label="倒角分段" min={1} max={8} step={1} value={extrude.bevelSegments}
        onChange={(v) => set({ bevelSegments: v }, true)} format={(v) => `${v}`} />
      <Slider label="浮雕缩放" min={0.3} max={0.95} step={0.01} value={extrude.reliefScale}
        onChange={(v) => set({ reliefScale: v }, true)} />
      <Slider label="浮雕深度" min={0} max={0.2} step={0.005} value={extrude.reliefDepth}
        onChange={(v) => set({ reliefDepth: v }, true)} format={(v) => v.toFixed(3)} />
      {warnings.length > 0 && (
        <div className="warn">
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
      <p className="dim small">孔洞与自交轮廓已在解析时自动清理；内凹浮雕以镶嵌方式贴于前脸。</p>
    </div>
  );
}
