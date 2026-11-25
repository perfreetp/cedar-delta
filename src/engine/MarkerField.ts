/**
 * 牙位标记点云：几千个菱形标记用一次硬件实例化渲染（单个 draw call）。
 * 逐实例颜色在 CPU 侧只生成一次；距离淡出完全在 shader 中按相机距离计算，
 * 视角转动时不需要回写缓冲。
 */
import * as pc from 'playcanvas';
import type { DentalArch } from '../core/arch';
import { diamond } from '../core/geometry';
import {
  createInstanceBuffer,
  createPcMesh,
  GuideMaterial,
  writeForwardDrawUniforms,
  type InstanceItem,
} from './shaders';

export interface MarkerFieldOptions {
  count: number;
  fadeNear: number;
  fadeFar: number;
}

export class MarkerField {
  readonly meshInstance: pc.MeshInstance;
  readonly host: pc.Entity;
  private readonly buffer: pc.VertexBuffer;
  private readonly items: InstanceItem[];

  constructor(
    device: pc.GraphicsDevice,
    arch: DentalArch,
    options: MarkerFieldOptions,
  ) {
    const points = arch.sampleBonePoints(options.count);
    const mesh = createPcMesh(device, diamond(0.5));

    this.items = points.map((p, i) => {
      // 沿牙弓位置给轻微色相变化，便于看出牙位排布
      const u = -1 + (2 * i) / points.length;
      const matrix = new pc.Mat4().setTRS(
        new pc.Vec3(p[0], p[1], p[2]),
        pc.Quat.IDENTITY.clone(),
        pc.Vec3.ONE.clone(),
      );
      const warm = 0.5 + 0.5 * Math.sin(u * Math.PI);
      const color: [number, number, number, number] = [
        0.35 + 0.35 * warm,
        0.55 - 0.15 * warm,
        0.85 - 0.25 * warm,
        1,
      ];
      return { matrix, color };
    });

    this.buffer = createInstanceBuffer(device, this.items);
    const material = new GuideMaterial(
      device,
      new pc.Color(0.4, 0.6, 0.9),
      true, // instanced
    );
    material.fadeNear = options.fadeNear;
    material.fadeFar = options.fadeFar;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.update();

    // 实例化 MI 必须挂在场景节点上（引擎排序/剔除要读 node 世界变换）
    this.host = new pc.Entity('marker-field');
    this.meshInstance = new pc.MeshInstance(mesh, material, this.host);
    writeForwardDrawUniforms(this.meshInstance, material);
    this.meshInstance.setInstancing(this.buffer, true);
    // 透明实例按距离排序交给引擎，关闭视锥剔除避免整体被误剔
    this.meshInstance.cull = false;
  }
}
