/**
 * Babylon.js 场景层
 *
 * - 陨石坑：程序化径向网格，半径/深度/环形山脊高度均可由时间轴驱动
 * - 环形山脊：与坑体同一剖面生成，保证参数联动
 * - 喷出物：thin instances 实例化岩块，按扩散半径与进度推进
 * - 相机：球面坐标沿弧线运动，朝向约束始终锁定目标点
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  Scalar,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import type { CameraState, CraterState, EjectaState } from '../core/evaluator';

const MAX_EJECTA = 260;
const TERRAIN_SIZE = 90;

export class CraterScene {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  private craterMesh!: Mesh;
  private rimMesh!: Mesh;
  private ground!: Mesh;
  private ejectaMesh!: Mesh;
  private ejectaMatrices: Float32Array = new Float32Array(MAX_EJECTA * 16);
  private ejectaData: { angle: number; tilt: number; speed: number; spin: number; scale: number }[] = [];
  private dustSystem!: ParticleSystem;
  private rafHandle = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.03, 0.06, 1);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 3, 36, new Vector3(0, 1, 0), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 8;
    this.camera.upperRadiusLimit = 70;
    this.camera.upperBetaLimit = Math.PI / 2.05;
    this.camera.wheelDeltaPercentage = 0.01;
    this.camera.minZ = 0.1;

    this.buildLights();
    this.buildGround();
    this.buildCrater();
    this.buildEjecta();
    this.buildDust();
    this.buildLabels();

    this.engine.runRenderLoop(() => {
      if (!this.disposed) this.scene.render();
    });
    this.rafHandle = 0;
  }

  private buildLights() {
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.3), this.scene);
    hemi.intensity = 0.55;
    hemi.diffuse = new Color3(0.85, 0.9, 1);
    hemi.groundColor = new Color3(0.25, 0.18, 0.12);

    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), this.scene);
    sun.position = new Vector3(28, 40, -18);
    sun.intensity = 1.25;
    sun.diffuse = new Color3(1, 0.92, 0.8);
  }

  private buildGround() {
    this.ground = MeshBuilder.CreateGround(
      'ground',
      { width: TERRAIN_SIZE, height: TERRAIN_SIZE, subdivisions: 90, updatable: true },
      this.scene,
    );
    const mat = new StandardMaterial('groundMat', this.scene);
    mat.specularColor = new Color3(0.08, 0.06, 0.05);
    mat.diffuseColor = new Color3(0.32, 0.25, 0.18);
    this.ground.material = mat;
    // 轻微地表起伏
    const positions = this.ground.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      positions[i + 1] =
        0.28 * Math.sin(x * 0.22) * Math.cos(z * 0.18) +
        0.12 * Math.sin(x * 0.7 + z * 0.5);
    }
    this.ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  }

  /**
   * 陨石坑径向剖面（rn 为归一化半径 0..1.6R）：
   *   rn < 0.62  ：抛物面碗状凹陷，最深 depth
   *   0.62..1.0 ：抬升到环形山脊顶 rimHeight
   *   1.0..1.6  ：山脊回落并融入地表
   */
  private craterHeight(rn: number, depth: number, rimHeight: number): number {
    if (rn < 0.62) {
      const u = rn / 0.62; // 0 中心 -> 1 碗沿
      return -depth * (1 - u * u);
    }
    if (rn < 1) {
      const u = (rn - 0.62) / 0.38;
      return Scalar.Lerp(0, rimHeight, smooth(u));
    }
    const u = Math.min(1, (rn - 1) / 0.6);
    return rimHeight * (1 - smooth(u));
  }

  private buildCrater() {
    this.craterMesh = new Mesh('crater', this.scene);
    const mat = new StandardMaterial('craterMat', this.scene);
    mat.diffuseColor = new Color3(0.42, 0.33, 0.24);
    mat.specularColor = new Color3(0.05, 0.04, 0.03);
    this.craterMesh.material = mat;
    this.rimMesh = new Mesh('rim', this.scene);
    this.rimMesh.material = mat;
    this.rebuildCraterGeometry(8, 3, 1.4);
  }

  /** 按参数重建陨石坑顶点（半径/深度/山脊高度），段数恒定所以直接替换 VertexData */
  rebuildCraterGeometry(radius: number, depth: number, rimHeight: number) {
    const radialSeg = 48;
    const ringSeg = 96;
    const maxR = radius * 1.6;
    const positions: number[] = [];
    const indices: number[] = [];

    // 中心点
    positions.push(0, this.craterHeight(0, depth, rimHeight), 0);
    for (let ring = 1; ring <= radialSeg; ring++) {
      const rn = ring / radialSeg;
      const r = rn * maxR;
      const y = this.craterHeight(rn, depth, rimHeight);
      for (let s = 0; s < ringSeg; s++) {
        const a = (s / ringSeg) * Math.PI * 2;
        positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    for (let s = 0; s < ringSeg; s++) {
      const cur = 1 + s;
      const nxt = 1 + ((s + 1) % ringSeg);
      indices.push(0, nxt, cur);
    }
    for (let ring = 1; ring < radialSeg; ring++) {
      const inner = 1 + (ring - 1) * ringSeg;
      const outer = 1 + ring * ringSeg;
      for (let s = 0; s < ringSeg; s++) {
        const a = inner + s;
        const b = inner + ((s + 1) % ringSeg);
        const c = outer + s;
        const d = outer + ((s + 1) % ringSeg);
        indices.push(a, b, c, b, d, c);
      }
    }

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vertexData.normals = normals;
    vertexData.applyToMesh(this.craterMesh, true);

    // 环形山脊：沿 r≈R 的管状环
    const tubeR = radius * 1.02;
    const tubePts: Vector3[] = [];
    const tubeSeg = 64;
    for (let s = 0; s < tubeSeg; s++) {
      const a = (s / tubeSeg) * Math.PI * 2;
      tubePts.push(new Vector3(Math.cos(a) * tubeR, rimHeight * 0.55, Math.sin(a) * tubeR));
    }
    this.rimMesh.dispose();
    this.rimMesh = MeshBuilder.CreateTube(
      'rim',
      { path: tubePts, radius: Math.max(0.12, radius * 0.07), tessellation: 10 },
      this.scene,
    );
    const rimMat = new StandardMaterial('rimMat', this.scene);
    rimMat.diffuseColor = new Color3(0.5, 0.4, 0.29);
    rimMat.specularColor = new Color3(0.06, 0.05, 0.04);
    this.rimMesh.material = rimMat;
  }

  private buildEjecta() {
    this.ejectaMesh = MeshBuilder.CreateBox(
      'ejecta',
      { size: 0.7, updatable: false },
      this.scene,
    );
    const mat = new StandardMaterial('ejectaMat', this.scene);
    mat.diffuseColor = new Color3(0.36, 0.27, 0.19);
    mat.specularColor = new Color3(0.1, 0.08, 0.06);
    this.ejectaMesh.material = mat;
    this.ejectaMesh.isVisible = false;
    // 预生成每块岩块的弹道参数（确定性随机，避免逐帧抖动）
    let seed = 20261126;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < MAX_EJECTA; i++) {
      this.ejectaData.push({
        angle: rand() * Math.PI * 2,
        tilt: 0.25 + rand() * 0.9,
        speed: 0.6 + rand() * 0.8,
        spin: rand() * Math.PI * 2,
        scale: 0.35 + rand() * 0.9,
      });
      Matrix.Identity().copyToArray(this.ejectaMatrices, i * 16);
    }
    this.ejectaMesh.thinInstanceSetBuffer('matrix', this.ejectaMatrices, 16, false);
  }

  /** 按喷出物状态更新 thin instances；visibleCount 控制实际数量 */
  updateEjecta(state: EjectaState, time: number) {
    const count = Math.min(
      MAX_EJECTA,
      Math.round((state.emissionRate / 700) * MAX_EJECTA * (state.progress < 1 ? 1 : 0.25)),
    );
    this.ejectaMesh.isVisible = count > 0 && state.spread > 0.1;
    this.ejectaMesh.thinInstanceCount = count;
    const quat = new Quaternion();
    const scaleV = new Vector3();
    const posV = new Vector3();
    const m = new Matrix();
    for (let i = 0; i < MAX_EJECTA; i++) {
      const d = this.ejectaData[i];
      if (i >= count) {
        Matrix.ScalingToRef(0, 0, 0, m);
        m.copyToArray(this.ejectaMatrices, i * 16);
        continue;
      }
      // 每条岩块在扩散进度区间内按自身速度相位做弹道推进
      const phase = (d.speed * state.progress + i / MAX_EJECTA) % 1;
      const dist = state.spread * phase;
      const arcHeight = Math.sin(phase * Math.PI) * (state.spread * 0.45 * d.tilt);
      const x = Math.cos(d.angle) * dist;
      const z = Math.sin(d.angle) * dist;
      const y = Math.max(0.1, arcHeight);
      const s = d.scale * Scalar.Lerp(1.1, 0.7, phase);
      Quaternion.FromEulerAnglesToRef(
        d.spin * time,
        d.angle + d.spin * time * 0.6,
        d.tilt * time,
        quat,
      );
      scaleV.set(s, s, s);
      posV.set(x, y, z);
      Matrix.ComposeToRef(scaleV, quat, posV, m);
      m.copyToArray(this.ejectaMatrices, i * 16);
    }
    this.ejectaMesh.thinInstanceSetBuffer('matrix', this.ejectaMatrices, 16, false);
  }

  private buildDust() {
    this.dustSystem = new ParticleSystem('dust', 600, this.scene);
    const tex = this.makeParticleTexture();
    this.dustSystem.particleTexture = tex;
    this.dustSystem.emitter = new Vector3(0, 0.5, 0);
    this.dustSystem.color1 = new Color4(0.55, 0.45, 0.35, 0.8);
    this.dustSystem.color2 = new Color4(0.3, 0.24, 0.18, 0.3);
    this.dustSystem.minSize = 0.4;
    this.dustSystem.maxSize = 1.4;
    this.dustSystem.minLifeTime = 1.2;
    this.dustSystem.maxLifeTime = 3;
    this.dustSystem.emitRate = 0;
    this.dustSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.dustSystem.direction1 = new Vector3(-6, 8, -6);
    this.dustSystem.direction2 = new Vector3(6, 14, 6);
    this.dustSystem.gravity = new Vector3(0, -3, 0);
    this.dustSystem.start();
  }

  private makeParticleTexture(): Texture {
    const size = 64;
    const dt = new DynamicTexture('dustTex', size, this.scene, false);
    const ctx = dt.getContext() as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    dt.update();
    return dt;
  }

  updateDust(state: EjectaState) {
    this.dustSystem.emitRate = state.emissionRate * 0.35;
    this.dustSystem.minEmitPower = state.spread * 0.3;
    this.dustSystem.maxEmitPower = state.spread * 0.7;
  }

  /**
   * 相机沿弧线运动 + 朝向约束（目标点）。
   * 时间轴驱动期间移除用户输入，避免 ArcRotateCamera 输入管理器的内部状态
   * 在 checkInputs() 中覆盖脚本设置的 radius/alpha/beta。
   */
  updateCamera(state: CameraState) {
    // 时间轴驱动期间移除用户输入，避免输入管理器 checkInputs() 覆盖脚本值
    if (this.camera.inputs.attachedToElement) {
      this.camera.detachControl();
    }
    // 先设目标，再设球面参数 —— setTarget 会触发视图矩阵重算，
    // 把 radius/alpha/beta 放在最后赋值可确保时间轴值不被覆盖
    this.camera.setTarget(new Vector3(...state.target));
    this.camera.radius = state.radius;
    this.camera.alpha = state.azimuth;
    this.camera.beta = Math.PI / 2 - state.elevation;
  }

  /** 交还用户手动轨道相机控制（检查器/按钮可调用） */
  enableUserCameraControl() {
    const canvas = this.engine.getRenderingCanvas();
    if (canvas && !this.camera.inputs.attachedToElement) {
      this.camera.attachControl(canvas, true);
    }
  }

  applyCrater(state: CraterState) {
    this.rebuildCraterGeometry(
      Math.max(0.2, state.radius),
      Math.max(0.05, state.depth),
      Math.max(0.02, state.rimHeight),
    );
  }

  /** 无激活轨道时的静止占位（隐藏喷出物、停粉尘） */
  idle() {
    this.ejectaMesh.isVisible = false;
    this.ejectaMesh.thinInstanceCount = 0;
    this.dustSystem.emitRate = 0;
  }

  private buildLabels() {
    // 场景标识牌：通过 DynamicTexture 绘制标题
    const plane = MeshBuilder.CreatePlane('title', { width: 9, height: 2.2 }, this.scene);
    plane.position = new Vector3(0, 9, -14);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const dt = new DynamicTexture('titleTex', { width: 512, height: 128 }, this.scene, false);
    const ctx = dt.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = 'rgba(8,12,22,0.72)';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = 'rgba(120,180,255,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#cfe2ff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('陨石撞击展陈', 256, 52);
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#8fb4e8';
    ctx.fillText('Crater Impact Timeline Studio', 256, 96);
    dt.update();
    const mat = new StandardMaterial('titleMat', this.scene);
    mat.diffuseTexture = dt;
    mat.emissiveTexture = dt;
    mat.useAlphaFromDiffuseTexture = true;
    plane.material = mat;
  }

  resize() {
    this.engine.resize();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}
