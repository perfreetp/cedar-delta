import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  GizmoManager,
  HemisphericLight,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import type { Pose, TrackTarget } from '../timeline/types';
import { BONE, ENTRY, TIP } from '../layout';

export interface SceneHandle {
  getPose: (target: TrackTarget) => Pose | null;
  applyPoses: (poses: Map<string, Pose>) => void;
  setCameraDriven: (on: boolean) => void;
  setGizmoTarget: (target: 'instrument' | 'guidewire' | null) => void;
  /** 根据最新文档重画路径辅助线(关键帧位置点) */
  drawPaths: (paths: { points: [number, number, number][]; color: Color3 }[]) => void;
  dispose: () => void;
}

function mat(scene: Scene, name: string, color: Color3, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.alpha = alpha;
  return m;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const engine = new Engine(canvas, true, { stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.09, 0.1, 0.13, 1);

  const camera = new ArcRotateCamera('cam', -Math.PI / 3, Math.PI / 3.2, 12, Vector3.FromArray(ENTRY), scene);
  camera.attachControl(canvas, true);
  camera.wheelPrecision = 30;
  camera.lowerRadiusLimit = 3;
  camera.upperRadiusLimit = 40;

  const hemi = new HemisphericLight('hemi', new Vector3(0.3, 1, 0.2), scene);
  hemi.intensity = 0.75;
  const dir = new DirectionalLight('dir', new Vector3(-0.5, -1, -0.4), scene);
  dir.intensity = 0.7;

  // 地面网格
  const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 24, subdivisions: 12 }, scene);
  const gm = mat(scene, 'gm', new Color3(0.16, 0.18, 0.22));
  gm.wireframe = true;
  ground.material = gm;
  ground.position.y = -2.2;

  // 骨骼(半透明圆柱,沿 X 轴)
  const bone = MeshBuilder.CreateCylinder('bone', { height: BONE.length, diameter: BONE.radius * 2, tessellation: 48 }, scene);
  bone.rotation.z = Math.PI / 2;
  bone.position = Vector3.FromArray(BONE.center);
  const boneMat = mat(scene, 'boneMat', new Color3(0.92, 0.88, 0.8), 0.35);
  bone.material = boneMat;

  // 钉道(骨内通道,红色半透明管)
  const entry = Vector3.FromArray(ENTRY);
  const tip = Vector3.FromArray(TIP);
  const tunnel = MeshBuilder.CreateTube('tunnel', { path: [entry, tip], radius: 0.09, tessellation: 16 }, scene);
  tunnel.material = mat(scene, 'tunnelMat', new Color3(0.9, 0.25, 0.2), 0.55);
  const entryMark = MeshBuilder.CreateSphere('entryMark', { diameter: 0.22 }, scene);
  entryMark.position = entry.clone();
  entryMark.material = mat(scene, 'entryMat', new Color3(1, 0.5, 0.1));

  // 植入器械:长杆 + 手柄(挂在父节点下,动画驱动父节点)
  const instrument = new TransformNode('instrument', scene);
  const shaft = MeshBuilder.CreateCylinder('shaft', { height: 2.6, diameter: 0.18, tessellation: 24 }, scene);
  shaft.parent = instrument;
  const shaftMat = mat(scene, 'shaftMat', new Color3(0.75, 0.78, 0.85));
  shaft.material = shaftMat;
  const grip = MeshBuilder.CreateBox('grip', { width: 0.5, height: 0.7, depth: 0.3 }, scene);
  grip.parent = instrument;
  grip.position.y = 1.6;
  grip.material = mat(scene, 'gripMat', new Color3(0.2, 0.45, 0.8));

  // 导针:细金色长杆
  const guidewire = new TransformNode('guidewire', scene);
  const wire = MeshBuilder.CreateCylinder('wire', { height: 4.2, diameter: 0.045, tessellation: 12 }, scene);
  wire.parent = guidewire;
  wire.material = mat(scene, 'wireMat', new Color3(1, 0.8, 0.2));

  // 路径辅助线
  let pathMeshes: Mesh[] = [];
  const drawPaths: SceneHandle['drawPaths'] = (paths) => {
    for (const m of pathMeshes) m.dispose();
    pathMeshes = [];
    paths.forEach((p, i) => {
      if (p.points.length < 2) return;
      const line = MeshBuilder.CreateLines(`path${i}`, {
        points: p.points.map((pt) => Vector3.FromArray(pt)),
      }, scene) as LinesMesh;
      line.color = p.color;
      pathMeshes.push(line);
      for (const pt of p.points) {
        const dot = MeshBuilder.CreateSphere(`pathDot${i}`, { diameter: 0.1 }, scene);
        dot.position = Vector3.FromArray(pt);
        dot.material = mat(scene, `pathDotMat${i}${pt.join(',')}`, p.color);
        pathMeshes.push(dot);
      }
    });
  };

  // 操作手柄(移动/旋转器械与导针)
  const gizmo = new GizmoManager(scene);
  gizmo.positionGizmoEnabled = true;
  gizmo.rotationGizmoEnabled = true;
  gizmo.usePointerToAttachGizmos = false;
  gizmo.attachToNode(null);
  const gizmoTargets: Record<string, TransformNode> = { instrument, guidewire };

  let cameraDriven = true;

  const handle: SceneHandle = {
    getPose(target) {
      if (target === 'camera') {
        return {
          position: camera.position.asArray() as Pose['position'],
          // 相机轨道的 rotation 字段复用为观察目标点
          rotation: camera.target.asArray() as Pose['rotation'],
        };
      }
      const node = gizmoTargets[target];
      if (!node) return null;
      return {
        position: node.position.asArray() as Pose['position'],
        rotation: node.rotation.asArray() as Pose['rotation'],
      };
    },
    applyPoses(poses) {
      const ip = poses.get('instrument');
      if (ip) {
        instrument.position.set(ip.position[0], ip.position[1], ip.position[2]);
        instrument.rotation.set(ip.rotation[0], ip.rotation[1], ip.rotation[2]);
      }
      const gp = poses.get('guidewire');
      if (gp) {
        guidewire.position.set(gp.position[0], gp.position[1], gp.position[2]);
        guidewire.rotation.set(gp.rotation[0], gp.rotation[1], gp.rotation[2]);
      }
      const cp = poses.get('camera');
      if (cp && cameraDriven) {
        camera.position.set(cp.position[0], cp.position[1], cp.position[2]);
        camera.setTarget(Vector3.FromArray(cp.rotation));
      }
    },
    setCameraDriven(on) {
      cameraDriven = on;
      if (on) camera.detachControl();
      else camera.attachControl(canvas, true);
    },
    setGizmoTarget(target) {
      gizmo.attachToNode(target ? gizmoTargets[target] : null);
    },
    drawPaths,
    dispose() {
      engine.dispose();
    },
  };

  // 初始让相机轨接管
  camera.detachControl();

  engine.runRenderLoop(() => scene.render());
  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);

  return handle;
}
