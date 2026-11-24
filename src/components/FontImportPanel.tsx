import { useMemo, useRef, useState } from 'react';
import { fontManager, useFont } from '../font/fontManager';
import { store, nextId } from '../state/store';
import { GlyphPreview } from './GlyphPreview';

/** 模块一：字体导入台 —— 读取本地字体、解析字形、列出可用字形并预览轮廓 */
export function FontImportPanel() {
  const font = useFont();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  const glyphs = useMemo(() => {
    if (!font) return [];
    const list = fontManager.listGlyphs();
    return list.filter((g) => {
      if (!showEmpty && g.empty) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return g.char.includes(query) || g.name.toLowerCase().includes(q);
    });
  }, [font, query, showEmpty]);

  const error = fontManager.getError();
  const fileName = fontManager.getFileName();

  const addToStage = (glyphIndex: number, char: string) => {
    store.commit((s) => ({
      ...s,
      blocks: [...s.blocks, { id: nextId(), glyphIndex, char: char || `#${glyphIndex}` }],
    }));
  };

  return (
    <div className="panel">
      <h2>① 字体导入台</h2>
      <div className="row">
        <button onClick={() => fileRef.current?.click()}>选择字体文件…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              await fontManager.loadFile(f);
              forceTick((t) => t + 1);
            }
            e.target.value = '';
          }}
        />
        {fileName && <span className="dim">{fileName}</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {font && (
        <>
          <div className="row">
            <input
              type="search"
              placeholder="搜索字符或字形名…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="grow"
            />
            <label className="dim">
              <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
              含空字形
            </label>
          </div>
          <div className="dim small">共 {glyphs.length} 个字形（点击加入排布台）</div>
          <div className="glyph-grid">
            {glyphs.slice(0, 400).map((g) => (
              <button
                key={g.index}
                className={`glyph-cell ${selected === g.index ? 'active' : ''}`}
                title={`${g.name} (#${g.index})`}
                onClick={() => setSelected(g.index)}
                onDoubleClick={() => addToStage(g.index, g.char)}
              >
                {g.empty ? '·' : g.char || '□'}
              </button>
            ))}
          </div>
          {selected !== null && (
            <div className="row preview-row">
              <GlyphPreview glyphIndex={selected} />
              <div>
                <div>字形 #{selected}</div>
                <div className="dim small">{fontManager.glyphInfo(selected)?.name}</div>
                <button
                  onClick={() => {
                    const info = fontManager.glyphInfo(selected);
                    if (info) addToStage(selected, info.char);
                  }}
                >
                  加入排布台 →
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {!font && <p className="dim">支持 .ttf / .otf / .woff，全部在浏览器本地解析，不上传。</p>}
    </div>
  );
}
