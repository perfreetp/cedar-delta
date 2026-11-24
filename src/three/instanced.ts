/**
 * 实例化物体层：
 * 同一 catalog 条目共享几何体，按材质槽各建一个 InstancedMesh，
 * 数千物体仅产生少量 draw call。
 * - 结构变化（增删/显隐）→ rebuild
 * - 姿态变化（移动/旋转/缩放）→ 仅更新实例矩阵
 * - 选中/悬停高亮通过 instanceColor 实现
 */
import * as THREE from 'three';
import type { PlacedObject } from '../types';
import { buildGeometry } from '../lib/geometry';
import { CATALOG } from '../catalog';
import { obbCorners } from '../lib/math2d';

interface Slot {
  catalogId: string;
  slot: number;
}

const SELECT_COLOR = new THREE.Color(0xffc93c);
const HOVER_COLOR = new THREE.Color(0x7fd1ff);
const DEFAULT_COLOR = new THREE.Color(0xffffff);

export class InstanceLayer {
  readonly group = new THREE.Group();
  /** catalogId -> 每个材质槽一个 InstancedMesh */
  private meshes = new Map<string, THREE.InstancedMesh[]>();
  /** 物体 id -> 实例位置 */
  private index = new Map<string, Slot>();
  private objects: PlacedObject[] = [];
  private selected = new Set<string>();
  private hoverId: string | null = null;
  private tmpMatrix = new THREE.Matrix4();
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpScale = new THREE.Vector3();

  rebuild(objects: PlacedObject[], selected: Set<string>, hoverId: string | null): void {
    this.disposeMeshes();
    this.index.clear();
    this.objects = objects.filter((o) => o.visible);
    this.selected = new Set(selected);
    this.hoverId = hoverId;

    // 按 catalog 分组并记录实例槽位
    const byCatalog = new Map<string, PlacedObject[]>();
    for (const o of this.objects) {
      let list = byCatalog.get(o.catalogId);
      if (!list) {
        list = [];
        byCatalog.set(o.catalogId, list);
      }
      this.index.set(o.id, { catalogId: o.catalogId, slot: list.length });
      list.push(o);
    }

    for (const item of CATALOG) {
      const list = byCatalog.get(item.id);
      if (!list) continue;
      const built = buildGeometry(item);
      const meshList: THREE.InstancedMesh[] = [];
      built.geometries.forEach((geo, mi) => {
        const mesh = new THREE.InstancedMesh(geo, built.materials[mi], list.length);
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.name = `inst-${item.id}-${mi}`;
        this.group.add(mesh);
        meshList.push(mesh);
      });
      this.meshes.set(item.id, meshList);
    }
    this.updateAllMatrices();
    this.applyColors();
  }

  /** 仅刷新矩阵（拖动等高频场景） */
  updateAllMatrices(): void {
    for (const o of this.objects) {
      const info = this.index.get(o.id);
      if (!info) continue;
      this.compose(o);
      for (const mesh of this.meshes.get(info.catalogId) ?? []) {
        mesh.setMatrixAt(info.slot, this.tmpMatrix);
      }
    }
    for (const list of this.meshes.values()) {
      for (const mesh of list) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private compose(o: PlacedObject): void {
    this.tmpPos.set(o.x, 0, o.z);
    this.tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rotation);
    this.tmpScale.set(o.scale, o.scale, o.scale);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
  }

  /** 高亮状态变化（不重建几何） */
  updateHighlights(selected: Set<string>, hoverId: string | null): void {
    this.selected = new Set(selected);
    this.hoverId = hoverId;
    this.applyColors();
  }

  private applyColors(): void {
    for (const o of this.objects) {
      const info = this.index.get(o.id);
      if (!info) continue;
      let color = DEFAULT_COLOR;
      if (this.selected.has(o.id)) color = SELECT_COLOR;
      else if (this.hoverId === o.id) color = HOVER_COLOR;
      for (const mesh of this.meshes.get(info.catalogId) ?? []) {
        mesh.setColorAt(info.slot, color);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** 选中物体的占地轮廓线（OBB 角点 / 圆），供引擎创建 Line 对象 */
  selectionOutlines(ids: Set<string>): { id: string; points: THREE.Vector3[]; circle: boolean }[] {
    const result: { id: string; points: THREE.Vector3[]; circle: boolean }[] = [];
    for (const o of this.objects) {
      if (!ids.has(o.id)) continue;
      const s = o.scale;
      if (o.catalogId === 'round-table') {
        const r = (o.width * s) / 2;
        const pts: THREE.Vector3[] = [];
        const seg = 40;
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          pts.push(new THREE.Vector3(o.x + Math.cos(a) * r, 0.05, o.z + Math.sin(a) * r));
        }
        result.push({ id: o.id, points: pts, circle: true });
      } else {
        const corners = obbCorners({
          x: o.x,
          z: o.z,
          hw: (o.width * s) / 2,
          hd: (o.depth * s) / 2,
          rotation: o.rotation,
        });
        const pts = corners.map((c) => new THREE.Vector3(c.x, 0.05, c.z));
        pts.push(pts[0].clone());
        result.push({ id: o.id, points: pts, circle: false });
      }
    }
    return result;
  }

  private disposeMeshes(): void {
    for (const list of this.meshes.values()) {
      for (const mesh of list) {
        this.group.remove(mesh);
        mesh.dispose();
      }
    }
    this.meshes.clear();
  }

  dispose(): void {
    this.disposeMeshes();
  }
}
