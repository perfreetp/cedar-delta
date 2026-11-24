import type { Glyph } from 'opentype.js';

export type Pt = [number, number];

export interface CleanContours {
  /** 外轮廓（逆时针） */
  outers: Pt[][];
  /** 孔洞（顺时针），已挂到所属外轮廓：holes[i] 属于 outers[outerOfHole[i]] */
  holes: Pt[][];
  outerOfHole: number[];
  warnings: string[];
}

const glyphContourCache = new WeakMap<Glyph, CleanContours>();

export function getGlyphContours(glyph: Glyph, scale: number): CleanContours {
  const cached = glyphContourCache.get(glyph);
  if (cached) return cached;
  const result = extractContours(glyph, scale);
  glyphContourCache.set(glyph, result);
  return result;
}

/** 把 opentype 字形路径摊平成多边形，并做去重/去共线/去尖刺/自交检测/环绕方向修正 */
function extractContours(glyph: Glyph, scale: number): CleanContours {
  const warnings: string[] = [];
  const raw: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const push = (x: number, y: number) => {
    cur.push([x * scale, y * scale]);
  };

  const cmds = glyph.path?.commands ?? [];
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        if (cur.length >= 3) raw.push(cur);
        cur = [];
        cx = sx = c.x;
        cy = sy = c.y;
        push(c.x, c.y);
        break;
      case 'L':
        cx = c.x;
        cy = c.y;
        push(c.x, c.y);
        break;
      case 'Q': {
        const x0 = cx, y0 = cy;
        const x1 = c.x, y1 = c.y, xc = c.x1, yc = c.y1;
        const n = curveSamples(
          Math.hypot(xc - x0, yc - y0) + Math.hypot(x1 - xc, y1 - yc),
          scale,
        );
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          push(
            u * u * x0 + 2 * u * t * xc + t * t * x1,
            u * u * y0 + 2 * u * t * yc + t * t * y1,
          );
        }
        cx = x1; cy = y1;
        break;
      }
      case 'C': {
        const x0 = cx, y0 = cy;
        const x1 = c.x, y1 = c.y;
        const xa = c.x1, ya = c.y1, xb = c.x2, yb = c.y2;
        const n = curveSamples(
          Math.hypot(xa - x0, ya - y0) +
            Math.hypot(xb - xa, yb - ya) +
            Math.hypot(x1 - xb, y1 - yb),
          scale,
        );
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          push(
            u * u * u * x0 + 3 * u * u * t * xa + 3 * u * t * t * xb + t * t * t * x1,
            u * u * u * y0 + 3 * u * u * t * ya + 3 * u * t * t * yb + t * t * t * y1,
          );
        }
        cx = x1; cy = y1;
        break;
      }
      case 'Z': {
        // 闭合：去掉与起点重复的末点
        if (cur.length > 1) {
          const [fx, fy] = cur[0];
          const [lx, ly] = cur[cur.length - 1];
          if (Math.hypot(fx - lx, fy - ly) < 1e-9) cur.pop();
        }
        if (cur.length >= 3) raw.push(cur);
        cur = [];
        cx = sx; cy = sy;
        break;
      }
    }
  }
  if (cur.length >= 3) raw.push(cur);

  // ---- 清理：去重、去共线、去尖刺 ----
  const eps = Math.max(1e-6, 1e-4 * scale * 1000 * 0.001); // 相对场景单位的容差
  let cleaned = raw
    .map((poly) => cleanPolygon(poly, eps))
    .filter((p): p is Pt[] => p !== null && p.length >= 3);

  // 丢弃退化（面积近零）轮廓
  const minArea = eps * eps;
  const before = cleaned.length;
  cleaned = cleaned.filter((p) => Math.abs(signedArea(p)) > minArea);
  if (cleaned.length < before) {
    warnings.push(`丢弃 ${before - cleaned.length} 条退化轮廓`);
  }

  // ---- 自交检测（O(n²)，轮廓规模小可接受）----
  let selfIntersecting = 0;
  for (const poly of cleaned) {
    if (countSelfIntersections(poly) > 0) selfIntersecting++;
  }
  if (selfIntersecting > 0) {
    warnings.push(
      `${selfIntersecting} 条轮廓存在自交，已按奇偶规则三角化（three.js ShapeUtils 容错处理）`,
    );
  }

  // ---- 孔洞归属：按包含深度分类，偶数层为外轮廓，奇数层为孔 ----
  const depthOf = cleaned.map((poly, i) => {
    let d = 0;
    for (let j = 0; j < cleaned.length; j++) {
      if (i !== j && pointInPolygon(poly[0], cleaned[j])) d++;
    }
    return d;
  });

  const outers: Pt[][] = [];
  const holes: Pt[][] = [];
  const outerOfHole: number[] = [];
  const outerIndex = new Map<number, number>();

  cleaned.forEach((poly, i) => {
    if (depthOf[i] % 2 === 0) {
      outerIndex.set(i, outers.length);
      outers.push(signedArea(poly) > 0 ? poly : [...poly].reverse());
    }
  });
  cleaned.forEach((poly, i) => {
    if (depthOf[i] % 2 === 1) {
      // 找包含它的最小外轮廓
      let best = -1;
      let bestArea = Infinity;
      cleaned.forEach((other, j) => {
        if (depthOf[j] % 2 === 0 && pointInPolygon(poly[0], other)) {
          const a = Math.abs(signedArea(other));
          if (a < bestArea) {
            bestArea = a;
            best = outerIndex.get(j)!;
          }
        }
      });
      if (best >= 0) {
        holes.push(signedArea(poly) < 0 ? poly : [...poly].reverse());
        outerOfHole.push(best);
      } else {
        warnings.push('1 个孔洞找不到所属外轮廓，已忽略');
      }
    }
  });

  return { outers, holes, outerOfHole, warnings };
}

function curveSamples(controlLen: number, scale: number): number {
  const sceneLen = controlLen * scale;
  return Math.min(48, Math.max(6, Math.ceil(sceneLen / 0.02)));
}

/** 去重点、去共线点、去 A-B-A 尖刺；返回 null 表示退化 */
function cleanPolygon(poly: Pt[], eps: number): Pt[] | null {
  const eps2 = eps * eps;
  // 1) 去连续重点
  const pts: Pt[] = [];
  for (const p of poly) {
    const last = pts[pts.length - 1];
    if (!last || dist2(p, last) > eps2) pts.push(p);
  }
  if (pts.length > 1 && dist2(pts[0], pts[pts.length - 1]) <= eps2) pts.pop();
  if (pts.length < 3) return null;

  // 2) 迭代去共线点与尖刺（一次扫描可能产生新的共线，做有限轮）
  let changed = true;
  let rounds = 0;
  while (changed && rounds < 8 && pts.length >= 3) {
    changed = false;
    rounds++;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      // 尖刺：prev ≈ next
      if (dist2(prev, next) <= eps2) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      // 共线：|cross| 很小且 cur 在 prev-next 之间
      const ax = cur[0] - prev[0], ay = cur[1] - prev[1];
      const bx = next[0] - cur[0], by = next[1] - cur[1];
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      if (Math.abs(cross) < eps * Math.hypot(ax, ay + 1e-12) && dot > 0) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts.length >= 3 ? pts : null;
}

function dist2(a: Pt, b: Pt): number {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** 统计多边形自交次数（跳过相邻边） */
function countSelfIntersections(poly: Pt[]): number {
  const n = poly.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i], a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // 首尾边相邻
      const b1 = poly[j], b2 = poly[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) count++;
    }
  }
  return count;
}

function segmentsIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d;
  const u = ((b1[0] - a1[0]) * (a2[1] - a1[1]) - (b1[1] - a1[1]) * (a2[0] - a1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}
