import {
  PointKind,
  type AreaLayerData,
  type Dataset,
  type FloorInfo,
  type PathLayerData,
  type PointLayerData,
} from '../types';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORLD = 24000;
const PLAZA = { x: 12000, y: 12000, r: 2700 };

/* 楼层平面:每栋楼 2×2 摆 4 层,便于在平铺视图里对照 */
const PLATE = 1680;
const PLATE_GAP = 90;
const BLD_PAD = 90;
const BLD_W = PLATE * 2 + PLATE_GAP + BLD_PAD * 2;

const BUILDINGS = [
  { id: 'A', name: 'A 栋 · 综合办公', x: 2600, y: 2600, toward: 'br' },
  { id: 'B', name: 'B 栋 · 研发中心', x: WORLD - 2600 - BLD_W, y: 2600, toward: 'bl' },
  { id: 'C', name: 'C 栋 · 生产车间', x: 2600, y: WORLD - 2600 - BLD_W, toward: 'tr' },
  { id: 'D', name: 'D 栋 · 仓储物流', x: WORLD - 2600 - BLD_W, y: WORLD - 2600 - BLD_W, toward: 'tl' },
  { id: 'E', name: 'E 栋 · 生活服务', x: PLAZA.x - BLD_W / 2, y: 19900, toward: 't' },
] as const;

export const FLOOR_LABELS = ['1F', '2F', '3F', '4F'];

/** 楼层在楼栋内的排列:左上、右上、左下、右下 */
const FLOOR_SLOTS: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
/** 让 1F 落在靠广场那一角 */
const FIRST_FLOOR_SLOT: Record<string, number> = { br: 3, bl: 2, tr: 1, tl: 0, t: 0 };

type Poly = number[];

function rectPoly(x0: number, y0: number, x1: number, y1: number): Poly {
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

function circlePoly(cx: number, cy: number, r: number, n: number): Poly {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

function pushPoly(coords: number[], offsets: number[], poly: Poly) {
  offsets.push(coords.length / 2);
  for (let i = 0; i < poly.length; i++) coords.push(poly[i]);
}

function label(building: string, floorLabel: string, prefix: string, n: number) {
  return `${building} 栋 ${floorLabel} · ${prefix}-${String(n).padStart(4, '0')}`;
}

interface Plate {
  bld: (typeof BUILDINGS)[number];
  /** 楼层序号 0..3 */
  f: number;
  floorIdx: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
}

/** 生成园区数据集(约 4.3 万要素) */
export function generateDataset(seed = 20241126): Dataset {
  const rnd = mulberry32(seed);

  const areaCoords: number[] = [];
  const areaOffsets: number[] = [];
  const areaRank: number[] = [];
  const areaFloor: number[] = [];
  const areaBbox: number[] = [];
  const areaIds: string[] = [];
  const areaNames: string[] = [];

  const addArea = (poly: Poly, rank: number, floor: number, name: string) => {
    pushPoly(areaCoords, areaOffsets, poly);
    areaRank.push(rank);
    areaFloor.push(floor);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      minX = Math.min(minX, poly[i]);
      maxX = Math.max(maxX, poly[i]);
      minY = Math.min(minY, poly[i + 1]);
      maxY = Math.max(maxY, poly[i + 1]);
    }
    areaBbox.push(minX, minY, maxX, maxY);
    areaIds.push(`area:${areaIds.length}`);
    areaNames.push(name);
  };

  /* ---------- rank0:园区分区 ---------- */
  const zones: [Poly, string][] = [
    [circlePoly(PLAZA.x, PLAZA.y, PLAZA.r, 56), '中央集散广场'],
    [rectPoly(6700, 6700, 9000, 11000), '西侧绿化带'],
    [rectPoly(15000, 6700, 17300, 11000), '东侧绿化带'],
    [rectPoly(6700, 13600, 17300, 15600), '南侧环形车道'],
    [rectPoly(6700, 2900, 17300, 4200), '北侧环形车道'],
    [rectPoly(2700, 9500, 4300, 13500), 'A 区停车场'],
    [rectPoly(19700, 9500, 21300, 13500), 'B 区停车场'],
    [rectPoly(6300, 21200, 9600, 23300), '后勤保障区'],
    [rectPoly(14400, 21200, 17700, 23300), '应急物资区'],
  ];
  for (const [poly, name] of zones) addArea(poly, 0, -1, name);

  /* ---------- rank1:楼栋轮廓 ---------- */
  for (const b of BUILDINGS) addArea(rectPoly(b.x, b.y, b.x + BLD_W, b.y + BLD_W), 1, -1, b.name);

  /* ---------- rank2:楼层平面 ---------- */
  const floors: FloorInfo[] = [];
  const plates: Plate[] = [];
  for (const bld of BUILDINGS) {
    const firstSlot = FIRST_FLOOR_SLOT[bld.toward] ?? 0;
    for (let f = 0; f < 4; f++) {
      const slot = FLOOR_SLOTS[(firstSlot + f) % 4];
      const x0 = bld.x + BLD_PAD + slot[0] * (PLATE + PLATE_GAP);
      const y0 = bld.y + BLD_PAD + slot[1] * (PLATE + PLATE_GAP);
      const x1 = x0 + PLATE;
      const y1 = y0 + PLATE;
      const floorIdx = floors.length;
      addArea(rectPoly(x0, y0, x1, y1), 2, floorIdx, `${bld.id} 栋 ${FLOOR_LABELS[f]}`);
      floors.push({
        index: floorIdx,
        building: bld.name,
        label: FLOOR_LABELS[f],
        polygon: rectPoly(x0, y0, x1, y1),
        centerX: (x0 + x1) / 2,
        centerY: (y0 + y1) / 2,
      });
      plates.push({ bld, f, floorIdx, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
    }
  }

  /* ---------- 点族 ---------- */
  const mkPoints = (n: number) => ({
    x: new Array<number>(n), y: new Array<number>(n), size: new Array<number>(n),
    kind: new Array<number>(n), floor: new Array<number>(n),
    ids: new Array<string>(n), names: new Array<string>(n), short: new Array<string>(n),
  });

  const POINTS_PER_PLATE = 2000;
  const EXITS_PER_BUILDING = 32;
  const point = mkPoints(plates.length * POINTS_PER_PLATE);
  const stair = mkPoints(plates.length * 10);
  const exitL = mkPoints(BUILDINGS.length * EXITS_PER_BUILDING);
  const assembly = mkPoints(12);
  const hazard = mkPoints(plates.length * 8 + 24);

  let pi = 0, si = 0, ei = 0, hi = 0;
  const CORRIDOR_HALF = 40;

  for (const p of plates) {
    const fl = FLOOR_LABELS[p.f];

    /* 人员/工位点位:避开中央走道 */
    for (let i = 0; i < POINTS_PER_PLATE; i++) {
      const leftSide = i % 2 === 0;
      const wx = leftSide
        ? p.x0 + 46 + rnd() * (PLATE / 2 - 46 - CORRIDOR_HALF)
        : p.cx + CORRIDOR_HALF + rnd() * (PLATE / 2 - 46 - CORRIDOR_HALF);
      const wy = p.y0 + 46 + rnd() * (PLATE - 92);
      point.x[pi] = wx;
      point.y[pi] = wy;
      point.size[pi] = 3 + rnd() * 4;
      point.kind[pi] = i % 3 === 0 ? PointKind.GLYPH_SQUARE : PointKind.GLYPH_DOT;
      point.floor[pi] = p.floorIdx;
      point.names[pi] = label(p.bld.id, fl, i % 3 === 0 ? '工位' : '人员', i);
      point.short[pi] = `${p.bld.id}${p.f + 1}-${i % 3 === 0 ? '工位' : '人员'}${i}`;
      point.ids[pi] = `point:${pi}`;
      pi++;
    }

    /* 楼梯 */
    for (let i = 0; i < 10; i++) {
      const wy = p.y0 + 80 + (i * (PLATE - 160)) / 9;
      stair.x[si] = i % 2 === 0 ? p.cx - CORRIDOR_HALF - 22 : p.cx + CORRIDOR_HALF + 22;
      stair.y[si] = wy;
      stair.size[si] = 14;
      stair.kind[si] = PointKind.GLYPH_ZIGZAG;
      stair.floor[si] = p.floorIdx;
      stair.names[si] = label(p.bld.id, fl, '疏散楼梯', i + 1);
      stair.short[si] = `${p.bld.id}${p.f + 1}-楼梯${i + 1}`;
      stair.ids[si] = `stair:${si}`;
      si++;
    }

    /* 危险源 */
    for (let i = 0; i < 8; i++) {
      hazard.x[hi] = p.x0 + 64 + rnd() * (PLATE - 128);
      hazard.y[hi] = p.y0 + 64 + rnd() * (PLATE - 128);
      hazard.size[hi] = 18;
      hazard.kind[hi] = PointKind.GLYPH_TRIANGLE;
      hazard.floor[hi] = p.floorIdx;
      hazard.names[hi] = label(p.bld.id, fl, '危险源', i + 1);
      hazard.short[hi] = `${p.bld.id}${p.f + 1}-危险源${i + 1}`;
      hazard.ids[hi] = `hazard:${hi}`;
      hi++;
    }
  }

  /* 室外危险源 */
  for (; hi < hazard.x.length; hi++) {
    const ang = rnd() * Math.PI * 2;
    const rad = 3200 + rnd() * 1700;
    hazard.x[hi] = PLAZA.x + Math.cos(ang) * rad;
    hazard.y[hi] = PLAZA.y + Math.sin(ang) * rad;
    hazard.size[hi] = 18;
    hazard.kind[hi] = PointKind.GLYPH_TRIANGLE;
    hazard.floor[hi] = -1;
    hazard.names[hi] = `室外危险源-${String(hi).padStart(3, '0')}`;
    hazard.short[hi] = `室外危险源${hi}`;
    hazard.ids[hi] = `hazard:${hi}`;
  }

  /* 集合点 */
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
    assembly.x[i] = PLAZA.x + Math.cos(ang) * (PLAZA.r - 620);
    assembly.y[i] = PLAZA.y + Math.sin(ang) * (PLAZA.r - 620);
    assembly.size[i] = 40;
    assembly.kind[i] = PointKind.GLYPH_RING;
    assembly.floor[i] = -1;
    assembly.names[i] = `应急集合点-${String(i + 1).padStart(2, '0')}`;
    assembly.short[i] = `集合点${i + 1}`;
    assembly.ids[i] = `assembly:${i}`;
  }

  const toPointLayer = (l: ReturnType<typeof mkPoints>): PointLayerData => ({
    count: l.x.length,
    x: Float32Array.from(l.x),
    y: Float32Array.from(l.y),
    size: Float32Array.from(l.size),
    kind: Uint8Array.from(l.kind),
    floor: Int32Array.from(l.floor),
    ids: l.ids,
    names: l.names,
    short: l.short,
  });

  /* ---------- 路径 ---------- */
  const pathCoords: number[] = [];
  const pathOffsets: number[] = [];
  const pathWeight: number[] = [];
  const pathFloor: number[] = [];
  const pathIds: string[] = [];
  const pathNames: string[] = [];

  const addPath = (pts: number[], weight: number, floor: number, name: string) => {
    pathOffsets.push(pathCoords.length / 2);
    for (const v of pts) pathCoords.push(v);
    pathWeight.push(weight);
    pathFloor.push(floor);
    pathIds.push(`path:${pathIds.length}`);
    pathNames.push(name);
  };

  /* 楼内:走道主干 + 支路 */
  for (const p of plates) {
    const fl = FLOOR_LABELS[p.f];
    addPath([p.cx, p.y0 + 46, p.cx, p.y1 - 46], 1, p.floorIdx, `${p.bld.id} 栋 ${fl} 疏散主通道`);
    const branchCount = 56;
    for (let i = 0; i < branchCount; i++) {
      const wy = p.y0 + 60 + ((i + 0.5) * (PLATE - 120)) / branchCount;
      const toLeft = i % 2 === 0;
      addPath(
        [p.cx, wy, toLeft ? p.x0 + 40 : p.x1 - 40, wy],
        0.45, p.floorIdx, `${p.bld.id} 栋 ${fl} 支路-${i + 1}`,
      );
    }
  }

  /* 首层出口:沿「朝广场」那条边 */
  for (const b of BUILDINGS) {
    const p = plates.find((pl) => pl.bld.id === b.id && pl.f === 0)!;
    for (let i = 0; i < EXITS_PER_BUILDING; i++) {
      const t = (i + 0.5) / EXITS_PER_BUILDING;
      const { x, y } = perimeterPoint(p, b.toward, t);
      exitL.x[ei] = x;
      exitL.y[ei] = y;
      exitL.size[ei] = 18;
      exitL.kind[ei] = PointKind.GLYPH_CHEVRON;
      exitL.floor[ei] = p.floorIdx;
      exitL.names[ei] = label(b.id, '1F', '安全出口', i + 1);
      exitL.short[ei] = `${b.id}出口${i + 1}`;
      exitL.ids[ei] = `exit:${ei}`;
      ei++;
    }
  }

  /* 室外:出口先汇到楼栋外侧的集散横线,再沿主通道进广场,避免几十条线斜穿糊成一团 */
  const assemblyPts = Array.from({ length: 12 }, (_, i) => {
    const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: PLAZA.x + Math.cos(ang) * (PLAZA.r - 620), y: PLAZA.y + Math.sin(ang) * (PLAZA.r - 620) };
  });

  for (const b of BUILDINGS) {
    const p = plates.find((pl) => pl.bld.id === b.id && pl.f === 0)!;
    const bcx = b.x + BLD_W / 2;
    const bcy = b.y + BLD_W / 2;
    const dx = PLAZA.x - bcx;
    const dy = PLAZA.y - bcy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    // 集散横线:平行于朝广场那条边,向外偏 210
    const spine = spineSegment(p, b.toward, 210);
    addPath([spine.x0, spine.y0, spine.x1, spine.y1], 1.8, -1, `${b.id} 栋 室外集散横线`);

    // 每个出口 → 集散横线上最近点(短接线,不再斜穿全图)
    for (let i = 0; i < EXITS_PER_BUILDING; i += 2) {
      const t = (i + 0.5) / EXITS_PER_BUILDING;
      const start = perimeterPoint(p, b.toward, t);
      const foot = projectToSpine(spine, start);
      addPath([start.x, start.y, foot.x, foot.y], 0.5, -1, `${b.id} 栋 出口接线-${i / 2 + 1}`);
    }

    // 主通道:集散横线中点 → 广场边缘
    const midX = (spine.x0 + spine.x1) / 2;
    const midY = (spine.y0 + spine.y1) / 2;
    const edgeX = PLAZA.x - ux * PLAZA.r;
    const edgeY = PLAZA.y - uy * PLAZA.r;
    addPath([midX, midY, edgeX, edgeY], 2, -1, `${b.id} 栋 进广场主通道`);

    // 广场内:入口点 → 最近集合点(单条,不再画整圈)
    let best = assemblyPts[0];
    let bestD = Infinity;
    for (const a of assemblyPts) {
      const d = Math.hypot(a.x - edgeX, a.y - edgeY);
      if (d < bestD) { bestD = d; best = a; }
    }
    addPath([edgeX, edgeY, best.x, best.y], 1.1, -1, `${b.id} 栋 广场内接驳`);
  }

  /* 环形车道 + 楼栋接广场主线 */
  addPath([6700, 6700, 17300, 6700, 17300, 17300, 6700, 17300, 6700, 6700], 2.2, -1, '园区环形主车道');
  for (const b of BUILDINGS) {
    const cx = b.x + BLD_W / 2;
    const cy = b.y + BLD_W / 2;
    const dx = PLAZA.x - cx;
    const dy = PLAZA.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const edgeX = PLAZA.x - ux * PLAZA.r;
    const edgeY = PLAZA.y - uy * PLAZA.r;
    addPath(
      [cx, cy, cx + ux * (BLD_W / 2 + 260), cy + uy * (BLD_W / 2 + 260), edgeX, edgeY],
      1.9, -1, `${b.id} 栋 集散主线`,
    );
  }

  const path: PathLayerData = {
    count: pathIds.length,
    coords: Float32Array.from(pathCoords),
    offsets: Int32Array.from(pathOffsets),
    weight: Float32Array.from(pathWeight),
    floor: Int32Array.from(pathFloor),
    ids: pathIds,
    names: pathNames,
  };

  const area: AreaLayerData = {
    count: areaIds.length,
    coords: Float32Array.from(areaCoords),
    offsets: Int32Array.from(areaOffsets),
    rank: Uint8Array.from(areaRank),
    floor: Int32Array.from(areaFloor),
    bbox: Float32Array.from(areaBbox),
    ids: areaIds,
    names: areaNames,
  };

  /* ---------- 楼栋汇总点 ---------- */
  const summaryX: number[] = [];
  const summaryY: number[] = [];
  const summaryW: number[] = [];
  for (const b of BUILDINGS) {
    summaryX.push(b.x + BLD_W / 2);
    summaryY.push(b.y + BLD_W / 2);
    summaryW.push(4 * POINTS_PER_PLATE);
  }
  summaryX.push(PLAZA.x);
  summaryY.push(PLAZA.y);
  summaryW.push(assembly.x.length * 60);

  /* 实际内容包围盒:供自动取景,避免把空白边距也框进来 */
  let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
  for (let i = 0; i < areaBbox.length; i += 4) {
    cMinX = Math.min(cMinX, areaBbox[i]);
    cMinY = Math.min(cMinY, areaBbox[i + 1]);
    cMaxX = Math.max(cMaxX, areaBbox[i + 2]);
    cMaxY = Math.max(cMaxY, areaBbox[i + 3]);
  }

  return {
    content: { minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY },
    point: toPointLayer(point),
    exit: toPointLayer(exitL),
    stair: toPointLayer(stair),
    assembly: toPointLayer(assembly),
    hazard: toPointLayer(hazard),
    path,
    area,
    floors,
    bounds: { minX: 0, minY: 0, maxX: WORLD, maxY: WORLD },
    summary: {
      x: Float32Array.from(summaryX),
      y: Float32Array.from(summaryY),
      weight: Float32Array.from(summaryW),
      count: summaryX.length,
    },
  };
}

/** 朝广场方向那条边上的点,t ∈ (0,1) 沿边分布 */
function perimeterPoint(p: Plate, toward: string, t: number) {
  switch (toward) {
    case 'br':
    case 'tr':
      return { x: p.x1 - 24, y: p.y0 + 30 + t * (PLATE - 60) };
    case 'bl':
    case 'tl':
      return { x: p.x0 + 24, y: p.y0 + 30 + t * (PLATE - 60) };
    default:
      return { x: p.x0 + 30 + t * (PLATE - 60), y: p.y1 - 24 };
  }
}

/** 朝广场那条边外侧、与边平行的一条线 */
function spineSegment(p: Plate, toward: string, offset: number) {
  switch (toward) {
    case 'br':
    case 'tr':
      return { x0: p.x1 + offset, y0: p.y0 + 20, x1: p.x1 + offset, y1: p.y1 - 20 };
    case 'bl':
    case 'tl':
      return { x0: p.x0 - offset, y0: p.y0 + 20, x1: p.x0 - offset, y1: p.y1 - 20 };
    default:
      return { x0: p.x0 + 20, y0: p.y1 + offset, x1: p.x1 - 20, y1: p.y1 + offset };
  }
}

function projectToSpine(
  spine: { x0: number; y0: number; x1: number; y1: number },
  pt: { x: number; y: number },
) {
  const dx = spine.x1 - spine.x0;
  const dy = spine.y1 - spine.y0;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((pt.x - spine.x0) * dx + (pt.y - spine.y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: spine.x0 + t * dx, y: spine.y0 + t * dy };
}

export function layerCounts(ds: Dataset) {
  return {
    hazard: ds.hazard.count,
    exit: ds.exit.count,
    stair: ds.stair.count,
    assembly: ds.assembly.count,
    path: ds.path.count,
    point: ds.point.count,
    area: ds.area.count,
  } as const;
}
