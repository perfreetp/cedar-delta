import { parse, Font, Glyph } from 'opentype.js';
import { useSyncExternalStore } from 'react';

export interface GlyphInfo {
  index: number;
  char: string; // 可显示字符，无则为空
  name: string;
  advanceWidth: number; // 归一化后
  empty: boolean;
}

type Listener = () => void;

/**
 * 字体管理：解析本地字体文件、维护字形清单。
 * 字体本体不进 undo 历史（体积大且不可变）。
 */
class FontManager {
  font: Font | null = null;
  fileName = '';
  error = '';
  private listeners = new Set<Listener>();
  private glyphCache = new Map<number, GlyphInfo>();

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.font;
  getError = () => this.error;
  getFileName = () => this.fileName;

  private emit() {
    this.listeners.forEach((l) => l());
  }

  async loadFile(file: File): Promise<boolean> {
    try {
      const buf = await file.arrayBuffer();
      const font = parse(buf);
      this.font = font;
      this.fileName = file.name;
      this.error = '';
      this.glyphCache.clear();
      this.emit();
      return true;
    } catch (e) {
      this.error = `字体解析失败: ${e instanceof Error ? e.message : String(e)}`;
      this.emit();
      return false;
    }
  }

  get unitsPerEm(): number {
    return this.font?.unitsPerEm ?? 1000;
  }

  /** 归一化比例：1 场景单位 ≈ 1 em */
  get scale(): number {
    return 1 / this.unitsPerEm;
  }

  getGlyph(index: number): Glyph | null {
    if (!this.font) return null;
    try {
      return this.font.glyphs.get(index);
    } catch {
      return null;
    }
  }

  charToGlyphIndex(ch: string): number {
    if (!this.font) return 0;
    return this.font.charToGlyphIndex(ch);
  }

  glyphInfo(index: number): GlyphInfo | null {
    const cached = this.glyphCache.get(index);
    if (cached) return cached;
    const g = this.getGlyph(index);
    if (!g || !this.font) return null;
    let char = '';
    if (g.unicode !== undefined && g.unicode >= 32) {
      char = String.fromCodePoint(g.unicode);
    }
    const info: GlyphInfo = {
      index,
      char,
      name: g.name || `glyph${index}`,
      advanceWidth: (g.advanceWidth ?? this.unitsPerEm) * this.scale,
      empty: !g.path || g.path.commands.length === 0,
    };
    this.glyphCache.set(index, info);
    return info;
  }

  /** 列出全部可用字形（含空字形标记，供过滤） */
  listGlyphs(): GlyphInfo[] {
    if (!this.font) return [];
    const n = this.font.glyphs.length;
    const out: GlyphInfo[] = [];
    for (let i = 0; i < n; i++) {
      const info = this.glyphInfo(i);
      if (info) out.push(info);
    }
    return out;
  }
}

export const fontManager = new FontManager();

export function useFont(): Font | null {
  return useSyncExternalStore(fontManager.subscribe, fontManager.get);
}
