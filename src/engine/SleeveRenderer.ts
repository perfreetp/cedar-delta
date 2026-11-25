/**
 * 套管场景渲染管理：
 *  - 每个套管一个 Entity（forward 层）+ 一个拾取 MeshInstance（pick 层），
 *    两者共享同一节点树，拾取 ID 直接用领域 SleeveState.id，身份永远不错层；
 *  - 选中态通过材质 selected 开关高亮；
 *  - 旋转环/箭头等手柄不进拾取层，只有套管能被点选。
 */
import * as pc from 'playcanvas';
import { lathe, sleeveProfile } from '../core/geometry';
import { SLEEVE_HEIGHT, type SleeveState } from '../core/types';
import {
  createPcMesh,
  GuideMaterial,
  writeForwardDrawUniforms,
  writePickDrawUniforms,
} from './shaders';

const SLEEVE_COLOR = new pc.Color(0.78, 0.82, 0.86);
const SNAPPED_COLOR = new pc.Color(0.62, 0.82, 0.95);

interface SleeveVisual {
  id: number;
  entity: pc.Entity;
  material: GuideMaterial;
  pickMaterial: GuideMaterial;
  pickMeshInstance: pc.MeshInstance;
}

export class SleeveRenderer {
  private visuals = new Map<number, SleeveVisual>();
  private sharedMesh: pc.Mesh;

  constructor(
    private readonly app: pc.Application,
    private readonly worldLayer: pc.Layer,
    private readonly pickLayer: pc.Layer,
  ) {
    const data = lathe(sleeveProfile(SLEEVE_HEIGHT), 40);
    this.sharedMesh = createPcMesh(app.graphicsDevice, data);
  }

  add(state: SleeveState): void {
    if (this.visuals.has(state.id)) return;
    const device = this.app.graphicsDevice;

    const material = new GuideMaterial(device, SLEEVE_COLOR, false);
    const entity = new pc.Entity(`sleeve-${state.id}`);
    const forwardMI = new pc.MeshInstance(this.sharedMesh, material);
    entity.addComponent('render', {
      meshInstances: [forwardMI],
    });
    this.applyTransform(entity, state);
    this.app.root.addChild(entity);
    writeForwardDrawUniforms(forwardMI, material);
    for (const mi of entity.render!.meshInstances) this.worldLayer.addMeshInstances([mi]);

    // 拾取通道：独立材质（编码 ID），节点用同一个 entity 保证姿态同步
    const pickMaterial = new GuideMaterial(device, new pc.Color(0, 0, 0), false, state.id);
    const pickMeshInstance = new pc.MeshInstance(this.sharedMesh, pickMaterial, entity);
    pickMeshInstance.pick = true;
    writePickDrawUniforms(pickMeshInstance, state.id);
    this.pickLayer.addMeshInstances([pickMeshInstance]);

    this.visuals.set(state.id, {
      id: state.id,
      entity,
      material,
      pickMaterial,
      pickMeshInstance,
    });
  }

  sync(state: SleeveState): void {
    const v = this.visuals.get(state.id);
    if (!v) return;
    this.applyTransform(v.entity, state);
    v.material.baseColor = state.snapped ? SNAPPED_COLOR : SLEEVE_COLOR;
    v.material.update();
    writeForwardDrawUniforms(v.entity.render!.meshInstances[0], v.material);
  }

  syncAll(states: SleeveState[]): void {
    for (const s of states) this.sync(s);
  }

  setSelected(ids: ReadonlySet<number>): void {
    for (const v of this.visuals.values()) {
      const on = ids.has(v.id) ? 1 : 0;
      if (v.material.selected !== on) {
        v.material.selected = on;
        v.material.update();
        writeForwardDrawUniforms(v.entity.render!.meshInstances[0], v.material);
      }
    }
  }

  setVisible(id: number, visible: boolean): void {
    const v = this.visuals.get(id);
    if (!v) return;
    v.entity.enabled = visible;
    v.pickMeshInstance.visible = visible;
  }

  getEntity(id: number): pc.Entity | null {
    return this.visuals.get(id)?.entity ?? null;
  }

  getWorldPosition(id: number): pc.Vec3 | null {
    const v = this.visuals.get(id);
    return v ? v.entity.getPosition() : null;
  }

  destroyAll(): void {
    for (const v of this.visuals.values()) {
      this.pickLayer.removeMeshInstances([v.pickMeshInstance]);
      for (const mi of v.entity.render!.meshInstances) this.worldLayer.removeMeshInstances([mi]);
      v.entity.destroy();
      v.material.destroy();
      v.pickMaterial.destroy();
    }
    this.visuals.clear();
  }

  private applyTransform(entity: pc.Entity, s: SleeveState): void {
    entity.setPosition(s.position[0], s.position[1], s.position[2]);
    entity.setRotation(
      s.quaternion[0],
      s.quaternion[1],
      s.quaternion[2],
      s.quaternion[3],
    );
  }
}
