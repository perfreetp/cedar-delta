/**
 * 场地地面：将所有区域 Shape 合并为一块带 three-mesh-bvh 加速的地面网格，
 * 用于：
 * 1) 射线快速拾取地面坐标（拖放、绘制多边形、框选）
 * 2) 区域着色显示与边界线
 *
 * 另有一块不可见的大基底平面（无 BVH 时回退到普通 raycast），
 * 保证在尚未绘制任何区域时也能拾取地面完成首次绘制。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  MeshBVH,
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';
import type { Region } from '../types';
import { regionOutline } from '../lib/math2d';

// 为 three.js 注入 BVH 加速能力（无 boundsTree 的网格自动回退普通 raycast）
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface GroundPickable {
  raycastGround(raycaster: THREE.Raycaster): THREE.Vector3 | null;
  update(regions: Region[]): void;
  dispose(): void;
}

const BASE_PLANE_SIZE = 400;

export function createGround(): GroundPickable & { group: THREE.Group } {
  const group = new THREE.Group();

  // —— 不可见基底平面：仅用于射线拾取，不参与渲染 ——
  const baseMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  baseMat.colorWrite = false;
  const basePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(BASE_PLANE_SIZE, BASE_PLANE_SIZE),
    baseMat,
  );
  basePlane.rotation.x = -Math.PI / 2;
  basePlane.name = 'base-pick-plane';
  group.add(basePlane);

  // —— 区域地面（可见、带 BVH） ——
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });
  const mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> = new THREE.Mesh(
    new THREE.BufferGeometry(),
    material,
  );
  mesh.name = 'venue-ground';
  group.add(mesh);

  const edgesGroup = new THREE.Group();
  edgesGroup.name = 'region-edges';
  group.add(edgesGroup);

  /**
   * 区域轮廓 (x, z) -> THREE.Shape 坐标 (x, -z)，
   * 因为几何随后 rotateX(-PI/2)：(x, y) -> (x, 0, -y)，取负后世界坐标恰好为 (x, z)。
   */
  function buildShape(region: Region): THREE.Shape {
    const outline = regionOutline(region);
    const shape = new THREE.Shape();
    shape.moveTo(outline[0].x, -outline[0].z);
    for (let i = 1; i < outline.length; i++) {
      shape.lineTo(outline[i].x, -outline[i].z);
    }
    shape.closePath();
    return shape;
  }

  function addEdge(points: { x: number; z: number }[], color: number): void {
    const pts3 = points.map((p) => new THREE.Vector3(p.x, 0.02, p.z));
    pts3.push(pts3[0].clone());
    const geo = new THREE.BufferGeometry().setFromPoints(pts3);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    edgesGroup.add(line);
  }

  function clearEdges(): void {
    for (const child of [...edgesGroup.children]) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      edgesGroup.remove(line);
    }
  }

  return {
    group,

    raycastGround(raycaster: THREE.Raycaster): THREE.Vector3 | null {
      // 优先命中区域地面（BVH 加速），未命中则回退到基底平面
      const regionHit = raycaster.intersectObject(mesh, false);
      if (regionHit.length > 0) return regionHit[0].point.clone();
      const baseHit = raycaster.intersectObject(basePlane, false);
      if (baseHit.length > 0) return baseHit[0].point.clone();
      return null;
    },

    update(regions: Region[]): void {
      if (mesh.geometry.boundsTree) mesh.geometry.disposeBoundsTree();
      mesh.geometry.dispose();
      clearEdges();

      if (regions.length === 0) {
        mesh.geometry = new THREE.BufferGeometry();
        material.vertexColors = false;
        return;
      }

      const geos: THREE.BufferGeometry[] = [];
      regions.forEach((region) => {
        const geo = new THREE.ShapeGeometry(buildShape(region), 8);
        const color = new THREE.Color(region.color);
        const count = geo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geos.push(geo);
        addEdge(regionOutline(region), 0x3a5a7a);
      });

      const merged = mergeGeometries(geos, false) ?? new THREE.BufferGeometry();
      merged.rotateX(-Math.PI / 2);
      merged.computeVertexNormals();
      merged.boundsTree = new MeshBVH(merged);
      mesh.geometry = merged; // 几何已预旋转，mesh 自身保持无旋转
      material.vertexColors = true;
      geos.forEach((g) => g.dispose());
    },

    dispose() {
      if (mesh.geometry.boundsTree) mesh.geometry.disposeBoundsTree();
      mesh.geometry.dispose();
      material.dispose();
      basePlane.geometry.dispose();
      baseMat.dispose();
      clearEdges();
    },
  };
}
