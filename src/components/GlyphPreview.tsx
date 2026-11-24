import { useEffect, useRef } from 'react';
import { fontManager } from '../font/fontManager';
import { getGlyphContours } from '../geometry/contours';

/** 2D 轮廓预览：外轮廓填充，孔洞按奇偶规则镂空 */
export function GlyphPreview({ glyphIndex, size = 160 }: { glyphIndex: number; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const glyph = fontManager.getGlyph(glyphIndex);
    if (!glyph) return;
    const contours = getGlyphContours(glyph, fontManager.scale);
    if (contours.outers.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '12px sans-serif';
      ctx.fillText('空字形', 8, size / 2);
      return;
    }

    // 求包围盒做适配（场景坐标 y 向上，画布 y 向下）
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const all = [...contours.outers, ...contours.holes];
    for (const poly of all) {
      for (const [x, y] of poly) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const pad = 8;
    const k = Math.min((size - pad * 2) / (maxX - minX || 1), (size - pad * 2) / (maxY - minY || 1));
    const ox = pad + ((size - pad * 2) - (maxX - minX) * k) / 2;
    const oy = pad + ((size - pad * 2) - (maxY - minY) * k) / 2;
    const tx = (x: number) => ox + (x - minX) * k;
    const ty = (y: number) => oy + (maxY - y) * k;

    ctx.beginPath();
    for (const poly of all) {
      poly.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(tx(x), ty(y));
        else ctx.lineTo(tx(x), ty(y));
      });
      ctx.closePath();
    }
    ctx.fillStyle = '#f2c9c0';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#8a5a3b';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [glyphIndex, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} className="glyph-preview" />;
}
