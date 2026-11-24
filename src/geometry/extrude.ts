import * as THREE from 'three';
import type { ExtrudeParams } from '../state/store';
import { getGlyphContours, type CleanContours, type Pt } from './contours';
import { fontManager } from '../font/fontManager';

export interface BlockGeometry {
  body: THREE.ExtrudeGeometry;
  relief: THREE.ExtrudeGeometry | null;
  /** 前脸平面 z 坐标（含倒角） */
  frontZ: number;
  /** 字形包围盒（归一化场景单位） */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  warnings: string[];
}

const MAX_CACHE = 256;
const cache = new Map<string, BlockGeometry>();

export function getBlockGeometry(glyphIndex: number, p: ExtrudeParams): BlockGeometry | null {
  const key = `${glyphIndex}|${p.depth}|${p.bevelSize}|${p.bevelThickness}|${p.bevelSegments}|${p.reliefScale}|${p.reliefDepth}`;
  const hit = cache.get(key);
  if (hit) {
    // LRU：移到末尾
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const glyph = fontManager.getGlyph(glyphIndex);
  if (!glyph) return null;
  const contours = getGlyphContours(glyph, fontManager.scale);
  if (contours.outers.length === 0) return null;
  const built = buildGeometry(contours, p);
  cache.set(key, built);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value!;
    const old = cache.get(oldest)!;
    old.body.dispose();
    old.relief?.dispose();
    cache.delete(oldest);
  }
  return built;
}

function toShape(outer: Pt[], holes: Pt[][]): THREE.Shape {
  const shape = new THREE.Shape();
  outer.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    hole.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

function buildGeometry(contours: CleanContours, p: ExtrudeParams): BlockGeometry {
  // 每个外轮廓一个 Shape，孔洞挂到所属 Shape；ExtrudeGeometry 支持 Shape[]
  const shapes: THREE.Shape[] = contours.outers.map((outer, i) => {
    const myHoles: Pt[][] = [];
    contours.outerOfHole.forEach((oi, hi) => {
      if (oi === i) myHoles.push(contours.holes[hi]);
    });
    return toShape(outer, myHoles);
  });

  const body = new THREE.ExtrudeGeometry(shapes, {
    depth: p.depth,
    bevelEnabled: p.bevelSize > 0 || p.bevelThickness > 0,
    bevelThickness: p.bevelThickness,
    bevelSize: p.bevelSize,
    bevelSegments: p.bevelSegments,
    curveSegments: 4, // 轮廓已摊平，这里只需少量
    steps: 1,
  });

  // 前脸内凹浮雕：轮廓按质心缩放，生成薄壳嵌片（视觉内凹镶嵌）
  let relief: THREE.ExtrudeGeometry | null = null;
  if (p.reliefDepth > 0 && p.reliefScale > 0.05 && p.reliefScale < 1) {
    const reliefShapes = shapes.map((s) => scaleShape(s, p.reliefScale));
    relief = new THREE.ExtrudeGeometry(reliefShapes, {
      depth: Math.max(0.005, p.reliefDepth),
      bevelEnabled: true,
      bevelThickness: Math.min(0.01, p.reliefDepth * 0.3),
      bevelSize: Math.min(0.01, p.reliefDepth * 0.3),
      bevelSegments: 2,
      curveSegments: 4,
      steps: 1,
    });
  }

  body.computeBoundingBox();
  const bb = body.boundingBox!;
  return {
    body,
    relief,
    frontZ: p.depth + p.bevelThickness,
    bounds: { minX: bb.min.x, maxX: bb.max.x, minY: bb.min.y, maxY: bb.max.y },
    warnings: contours.warnings,
  };
}

function scaleShape(shape: THREE.Shape, k: number): THREE.Shape {
  const pts = shape.getPoints(8);
  let cx = 0, cy = 0;
  pts.forEach((pt) => { cx += pt.x; cy += pt.y; });
  cx /= pts.length; cy /= pts.length;
  const out = new THREE.Shape();
  pts.forEach((pt, i) => {
    const x = cx + (pt.x - cx) * k;
    const y = cy + (pt.y - cy) * k;
    if (i === 0) out.moveTo(x, y); else out.lineTo(x, y);
  });
  out.closePath();
  for (const hole of shape.holes) {
    const hp = hole.getPoints(8);
    const h = new THREE.Path();
    hp.forEach((pt, i) => {
      const x = cx + (pt.x - cx) * k;
      const y = cy + (pt.y - cy) * k;
      if (i === 0) h.moveTo(x, y); else h.lineTo(x, y);
    });
    h.closePath();
    out.holes.push(h);
  }
  return out;
}

/** 字形排版宽度（含两侧留白），供排布台使用 */
export function glyphAdvance(glyphIndex: number): number {
  const info = fontManager.glyphInfo(glyphIndex);
  return info ? info.advanceWidth : 1;
}
