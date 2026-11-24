/**
 * 碰撞检测：均匀网格宽相 + math2d 的 SAT/圆形精确检测
 * 数千物体下单次移动检测仅需检查相邻格子内的少量物体。
 */
import type { PlacedObject, PolygonRegion, RectRegion, Vec2 } from '../types';
import {
  footprintsOverlap,
  objectFootprint,
  pointInAnyRegion,
  pointInCircle,
  pointInOBB,
  regionOutline,
  type Footprint,
} from './math2d';

export interface RegionSet {
  rect: RectRegion[];
  polygon: PolygonRegion[];
}

export class CollisionWorld {
  private cellSize: number;
  private grid = new Map<string, number[]>();
  private footprints: Footprint[] = [];
  private objects: PlacedObject[] = [];

  constructor(cellSize = 4) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private cellsOf(f: Footprint): [number, number, number, number] {
    let minX: number;
    let maxX: number;
    let minZ: number;
    let maxZ: number;
    if (f.kind === 'circle') {
      minX = f.shape.x - f.shape.r;
      maxX = f.shape.x + f.shape.r;
      minZ = f.shape.z - f.shape.r;
      maxZ = f.shape.z + f.shape.r;
    } else {
      const b = f.shape;
      const r = Math.sqrt(b.hw * b.hw + b.hd * b.hd);
      minX = b.x - r;
      maxX = b.x + r;
      minZ = b.z - r;
      maxZ = b.z + r;
    }
    return [
      Math.floor(minX / this.cellSize),
      Math.floor(maxX / this.cellSize),
      Math.floor(minZ / this.cellSize),
      Math.floor(maxZ / this.cellSize),
    ];
  }

  /** 全量重建（导入/撤销重做后调用） */
  rebuild(objects: PlacedObject[]): void {
    this.grid.clear();
    this.objects = objects;
    this.footprints = objects.map((o) => objectFootprint(o));
    for (let i = 0; i < objects.length; i++) {
      const [x0, x1, z0, z1] = this.cellsOf(this.footprints[i]);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = this.key(cx, cz);
          let cell = this.grid.get(k);
          if (!cell) {
            cell = [];
            this.grid.set(k, cell);
          }
          cell.push(i);
        }
      }
    }
  }

  /** 返回与给定占地重叠的物体 id（可排除一组 id） */
  queryOverlap(f: Footprint, exclude: ReadonlySet<string>): PlacedObject[] {
    const [x0, x1, z0, z1] = this.cellsOf(f);
    const seen = new Set<number>();
    const hits: PlacedObject[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.grid.get(this.key(cx, cz));
        if (!cell) continue;
        for (const idx of cell) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const o = this.objects[idx];
          if (exclude.has(o.id) || !o.visible) continue;
          if (footprintsOverlap(f, this.footprints[idx])) hits.push(o);
        }
      }
    }
    return hits;
  }

  /** 单个物体在新姿态下是否与其它物体重叠 */
  canPlace(o: PlacedObject, nx: number, nz: number, nrot: number, nscale: number): boolean {
    const moved: PlacedObject = { ...o, x: nx, z: nz, rotation: nrot, scale: nscale };
    const f = objectFootprint(moved);
    return this.queryOverlap(f, new Set([o.id])).length === 0;
  }

  /**
   * 批量移动/旋转校验（框选整体操作）：
   * candidates 为 {obj, nx, nz, nrot, nscale}，组内互相忽略，组外不得重叠。
   */
  canPlaceBatch(
    moves: { obj: PlacedObject; nx: number; nz: number; nrot: number; nscale: number }[],
  ): boolean {
    const exclude = new Set(moves.map((m) => m.obj.id));
    for (const m of moves) {
      const moved: PlacedObject = {
        ...m.obj,
        x: m.nx,
        z: m.nz,
        rotation: m.nrot,
        scale: m.nscale,
      };
      if (this.queryOverlap(objectFootprint(moved), exclude).length > 0) return false;
    }
    return true;
  }

  /** 点选：返回包含该点的最上层物体（数组靠后 = 后添加 = 上层） */
  pick(p: Vec2, objects: PlacedObject[]): PlacedObject | null {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (!o.visible) continue;
      const f = objectFootprint(o);
      const inside = f.kind === 'obb' ? pointInOBB(p, f.shape) : pointInCircle(p, f.shape);
      if (inside) return o;
    }
    return null;
  }

  /** 物体是否完全位于场地区域内（所有角点/采样点都在某区域内） */
  isInsideRegions(o: PlacedObject, regions: RegionSet): boolean {
    const f = objectFootprint(o);
    const testPts: Vec2[] = [];
    if (f.kind === 'circle') {
      testPts.push({ x: f.shape.x, z: f.shape.z });
      const seg = 12;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        testPts.push({
          x: f.shape.x + Math.cos(a) * f.shape.r,
          z: f.shape.z + Math.sin(a) * f.shape.r,
        });
      }
    } else {
      const b = f.shape;
      const c = Math.cos(b.rotation);
      const s = Math.sin(b.rotation);
      const n = 3;
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const lx = -b.hw + (2 * b.hw * i) / n;
          const lz = -b.hd + (2 * b.hd * j) / n;
          testPts.push({ x: b.x + lx * c - lz * s, z: b.z + lx * s + lz * c });
        }
      }
    }
    return testPts.every((p) => pointInAnyRegion(p, regions));
  }
}

/** 收集所有区域轮廓（BVH 地面与边界绘制用） */
export function allRegionOutlines(regions: RegionSet): Vec2[][] {
  return [...regions.rect, ...regions.polygon].map((r) => regionOutline(r));
}
