import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { getGlyphContours, signedArea } from '../src/geometry/contours';
import { layoutBlocks } from '../src/layout/pathLayout';

const font = parse(readFileSync('C:/Windows/Fonts/arial.ttf').buffer as ArrayBuffer);
const scale = 1 / font.unitsPerEm;

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) fail++;
};

// '8'：1 外轮廓 + 2 孔洞
const g8 = font.charToGlyph('8');
const c8 = getGlyphContours(g8, scale);
check("'8' 外轮廓数=1", c8.outers.length === 1, `got ${c8.outers.length}`);
check("'8' 孔洞数=2", c8.holes.length === 2, `got ${c8.holes.length}`);
check("'8' 外轮廓逆时针", signedArea(c8.outers[0]) > 0);
check("'8' 孔洞顺时针", c8.holes.every((h) => signedArea(h) < 0));

// 'A'：1 外 + 1 孔
const cA = getGlyphContours(font.charToGlyph('A'), scale);
check("'A' 外轮廓=1 孔洞=1", cA.outers.length === 1 && cA.holes.length === 1,
  `${cA.outers.length}/${cA.holes.length}`);

// 'i'：2 个分离外轮廓（点 + 身）
const ci = getGlyphContours(font.charToGlyph('i'), scale);
check("'i' 外轮廓=2 孔洞=0", ci.outers.length === 2 && ci.holes.length === 0,
  `${ci.outers.length}/${ci.holes.length}`);

// 排布：直线模式无重叠
const blocks = 'WEDDING'.split('').map((ch, i) => ({
  id: `b${i}`, glyphIndex: font.charToGlyphIndex(ch), char: ch,
}));
const widths = new Map(blocks.map((b) => [b.id, 0.7]));
const line = layoutBlocks(blocks, widths, { mode: 'line', spacing: 0.1, arcAngle: 120, arcBulge: 1 });
check('直线 7 块全部放置', line.placements.length === 7);
check('直线间距 0.1 无重叠', line.overlaps.length === 0);
check('直线朝向全为 0', line.placements.every((p) => p.rotY === 0));

// 排布：小半径圆弧应检测出重叠，且吸附间距能消除
const arc = layoutBlocks(blocks, widths, { mode: 'arc', spacing: 0.0, arcAngle: 300, arcBulge: 1 });
check('急弯弧检测出重叠', arc.overlaps.length > 0, `${arc.overlaps.length} 处`);
const fixed = layoutBlocks(blocks, widths, { mode: 'arc', spacing: arc.snapSpacing, arcAngle: 300, arcBulge: 1 });
check('吸附间距消除重叠', fixed.overlaps.length === 0, `snap=${arc.snapSpacing.toFixed(3)}`);
// 弧面法线随曲率联动：两端字块朝向相反
const rots = fixed.placements.map((p) => p.rotY);
check('弧面字块朝向随曲率变化', Math.abs(rots[0] - rots[rots.length - 1]) > 1,
  `首 ${rots[0].toFixed(2)} 末 ${rots[rots.length - 1].toFixed(2)}`);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
