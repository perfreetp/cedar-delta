import * as BABYLON from 'babylonjs';
import type { Vec3 } from './types';

export const EYE = {
  globeRadius: 12,
  corneaCenter: new BABYLON.Vector3(0, 0, 6.62),
  corneaOuterRadius: 7.82,
  corneaInnerRadius: 7.34,
  lensPosition: new BABYLON.Vector3(0, 0, 8.05),
  lensRadii: new BABYLON.Vector3(4.6, 4.6, 2.05),
  microCount: 4200,
};

export interface EyeModel {
  root: BABYLON.TransformNode;
  lens: BABYLON.Mesh;
  cornea: BABYLON.Mesh;
  sclera: BABYLON.Mesh;
  micro: BABYLON.Mesh;
  clipMaterials: BABYLON.Material[];
}

/** Revolve an r/z profile around the Z axis. */
function createRevolvedProfile(
  name: string,
  profile: Array<{ r: number; z: number }>,
  segments: number,
  scene: BABYLON.Scene,
): BABYLON.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const rows = profile.length;

  for (let i = 0; i < rows; i += 1) {
    const { r, z } = profile[i];
    for (let j = 0; j <= segments; j += 1) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(r * Math.cos(a), r * Math.sin(a), z);
      uvs.push(j / segments, i / Math.max(1, rows - 1));
    }
  }

  const stride = segments + 1;
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  const mesh = new BABYLON.Mesh(name, scene);
  const vertexData = new BABYLON.VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.uvs = uvs;
  const normals: number[] = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.material = new BABYLON.StandardMaterial(`${name}-mat`, scene);
  (mesh.material as BABYLON.StandardMaterial).sideOrientation = BABYLON.Mesh.DOUBLESIDE;
  return mesh;
}

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createMicroStructures(scene: BABYLON.Scene, parent: BABYLON.TransformNode): BABYLON.Mesh {
  const micro = BABYLON.MeshBuilder.CreateSphere(
    'micro-anatomical-structures',
    { diameter: 0.22, segments: 6 },
    scene,
  );
  micro.parent = parent;
  micro.metadata = { category: 'micro' };
  micro.isPickable = true;

  const mat = new BABYLON.StandardMaterial('micro-mat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.95, 0.48, 0.32);
  mat.emissiveColor = new BABYLON.Color3(0.16, 0.035, 0.02);
  mat.specularColor = new BABYLON.Color3(0.25, 0.12, 0.08);
  micro.material = mat;

  const rand = seededRandom(1000328);
  const matrices = new Float32Array(EYE.microCount * 16);
  const position = new BABYLON.Vector3();
  const scale = new BABYLON.Vector3();
  const quaternion = BABYLON.Quaternion.Identity();
  const matrix = new BABYLON.Matrix();

  let index = 0;
  const write = (
    p: BABYLON.Vector3,
    s: BABYLON.Vector3,
    q: BABYLON.Quaternion = BABYLON.Quaternion.Identity(),
  ) => {
    BABYLON.Matrix.ComposeToRef(s, q, p, matrix);
    matrix.toArray(matrices, index * 16);
    index += 1;
  };

  // Choroid/retinal cell clusters on the posterior inner wall.
  for (let i = 0; i < 2600; i += 1) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const radial = Math.sqrt(1 - u * u);
    const radius = 11.45 + (rand() - 0.5) * 0.35;
    position.set(
      radius * radial * Math.cos(theta),
      radius * radial * Math.sin(theta),
      radius * u - 0.8,
    );
    // Keep them behind the anterior chamber.
    if (position.z > 6.5) position.z = 6.5 - rand() * 4;
    const s = 0.65 + rand() * 1.35;
    scale.set(s, s * (0.7 + rand() * 0.6), s);
    write(position, scale);
  }

  // Zonular fibres stretched between lens equator and ciliary body.
  for (let i = 0; i < 1000; i += 1) {
    const a = (i / 1000) * Math.PI * 2 + (rand() - 0.5) * 0.025;
    const lensR = 4.55;
    const ciliaryR = 6.35 + rand() * 0.45;
    const p1 = new BABYLON.Vector3(lensR * Math.cos(a), lensR * Math.sin(a), 8.0 + (rand() - 0.5) * 0.8);
    const p2 = new BABYLON.Vector3(
      ciliaryR * Math.cos(a),
      ciliaryR * Math.sin(a),
      8.9 + (rand() - 0.5) * 0.9,
    );
    const mid = p1.add(p2).scale(0.5);
    const dir = p2.subtract(p1);
    const len = dir.length();
    dir.normalize();
    BABYLON.Quaternion.FromUnitVectorsToRef(new BABYLON.Vector3(0, 0, 1), dir, quaternion);
    position.copyFrom(mid);
    scale.set(0.42 + rand() * 0.25, 0.42 + rand() * 0.25, Math.max(0.8, len / 0.22));
    write(position, scale, quaternion);
  }

  // Iris crypts and ciliary processes.
  for (let i = 0; i < 600; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 4.9 + rand() * 1.55;
    position.set(r * Math.cos(a), r * Math.sin(a), 9.45 + (rand() - 0.5) * 0.75);
    const s = 0.8 + rand() * 1.8;
    scale.set(s * 0.8, s * 0.55, s * 1.25);
    BABYLON.Quaternion.RotationYawPitchRollToRef(a, rand() * 0.4, rand() * 0.3, quaternion);
    write(position, scale, quaternion);
  }

  micro.thinInstanceSetBuffer('matrix', matrices, 16);
  micro.thinInstanceRefreshBoundingInfo(true);
  micro.setEnabled(true);
  return micro;
}

export function createEyeModel(scene: BABYLON.Scene): EyeModel {
  const root = new BABYLON.TransformNode('eye-root', scene);

  // Posterior five-sixths of the scleral sphere, ending at the limbus.
  const scleraProfile: Array<{ r: number; z: number }> = [];
  const limbusZ = 9.55;
  for (let i = 0; i <= 48; i += 1) {
    const t = i / 48;
    const z = -EYE.globeRadius + t * (limbusZ + EYE.globeRadius);
    const r = Math.sqrt(Math.max(0, EYE.globeRadius ** 2 - z ** 2));
    scleraProfile.push({ r, z });
  }
  const sclera = createRevolvedProfile('sclera', scleraProfile, 96, scene);
  sclera.parent = root;
  const scleraMat = sclera.material as BABYLON.StandardMaterial;
  scleraMat.diffuseColor = new BABYLON.Color3(0.91, 0.9, 0.84);
  scleraMat.specularColor = new BABYLON.Color3(0.18, 0.18, 0.16);
  scleraMat.backFaceCulling = false;
  sclera.metadata = { category: 'sclera' };
  sclera.isPickable = false;

  // Choroid/retina inner shell.
  const retinaProfile: Array<{ r: number; z: number }> = [];
  for (let i = 0; i <= 42; i += 1) {
    const t = i / 42;
    const z = -11.55 + t * 17.2;
    const r = Math.sqrt(Math.max(0, 11.55 ** 2 - z ** 2));
    retinaProfile.push({ r: Math.max(0, r - 0.18), z });
  }
  const retina = createRevolvedProfile('choroid-retina', retinaProfile, 96, scene);
  retina.parent = root;
  const retinaMat = retina.material as BABYLON.StandardMaterial;
  retinaMat.diffuseColor = new BABYLON.Color3(0.55, 0.16, 0.12);
  retinaMat.emissiveColor = new BABYLON.Color3(0.12, 0.025, 0.018);
  retinaMat.alpha = 0.72;
  retinaMat.backFaceCulling = false;
  retina.isPickable = false;

  // Cornea: protruding spherical cap.
  const corneaProfile: Array<{ r: number; z: number }> = [];
  const cStartZ = 9.55;
  const cEndZ = EYE.corneaCenter.z + EYE.corneaOuterRadius;
  for (let i = 0; i <= 36; i += 1) {
    const t = i / 36;
    const z = cStartZ + t * (cEndZ - cStartZ);
    const dz = z - EYE.corneaCenter.z;
    const r = Math.sqrt(Math.max(0, EYE.corneaOuterRadius ** 2 - dz ** 2));
    corneaProfile.push({ r, z });
  }
  const cornea = createRevolvedProfile('cornea', corneaProfile, 96, scene);
  cornea.parent = root;
  const corneaMat = new BABYLON.StandardMaterial('cornea-mat', scene);
  corneaMat.diffuseColor = new BABYLON.Color3(0.55, 0.86, 1.0);
  corneaMat.specularColor = new BABYLON.Color3(1, 1, 1);
  corneaMat.specularPower = 128;
  corneaMat.alpha = 0.34;
  corneaMat.backFaceCulling = false;
  cornea.material = corneaMat;
  cornea.metadata = { category: 'cornea', selectable: true };
  cornea.isPickable = true;

  // Iris annulus and pupil opening.
  const iris = createRevolvedProfile(
    'iris',
    [
      { r: 2.15, z: 10.02 },
      { r: 3.4, z: 9.82 },
      { r: 5.75, z: 9.55 },
    ],
    96,
    scene,
  );
  iris.parent = root;
  const irisMat = iris.material as BABYLON.StandardMaterial;
  irisMat.diffuseColor = new BABYLON.Color3(0.24, 0.43, 0.34);
  irisMat.specularColor = new BABYLON.Color3(0.12, 0.1, 0.06);
  iris.isPickable = false;

  const pupil = BABYLON.MeshBuilder.CreateDisc('pupil', { radius: 2.05, tessellation: 64 }, scene);
  pupil.parent = root;
  pupil.position.z = 10.04;
  const pupilMat = new BABYLON.StandardMaterial('pupil-mat', scene);
  pupilMat.diffuseColor = BABYLON.Color3.Black();
  pupilMat.emissiveColor = new BABYLON.Color3(0.01, 0.012, 0.018);
  pupil.material = pupilMat;
  pupil.isPickable = false;

  // Biconvex lens approximated by a strongly oblate ellipsoid.
  const lens = BABYLON.MeshBuilder.CreateSphere(
    'lens',
    {
      segments: 64,
      diameterX: EYE.lensRadii.x * 2,
      diameterY: EYE.lensRadii.y * 2,
      diameterZ: EYE.lensRadii.z * 2,
    },
    scene,
  );
  lens.parent = root;
  lens.position.copyFrom(EYE.lensPosition);
  const lensMat = new BABYLON.StandardMaterial('lens-mat', scene);
  lensMat.diffuseColor = new BABYLON.Color3(0.68, 0.86, 1.0);
  lensMat.emissiveColor = new BABYLON.Color3(0.08, 0.16, 0.24);
  lensMat.specularColor = new BABYLON.Color3(0.9, 0.95, 1);
  lensMat.specularPower = 96;
  lensMat.alpha = 0.58;
  lensMat.backFaceCulling = false;
  lens.material = lensMat;
  lens.metadata = { category: 'lens', selectable: true };
  lens.isPickable = true;

  const ciliary = BABYLON.MeshBuilder.CreateTorus(
    'ciliary-body',
    { diameter: 12.8, thickness: 0.72, tessellation: 96 },
    scene,
  );
  ciliary.parent = root;
  ciliary.position.z = 8.85;
  const ciliaryMat = new BABYLON.StandardMaterial('ciliary-mat', scene);
  ciliaryMat.diffuseColor = new BABYLON.Color3(0.34, 0.12, 0.1);
  ciliaryMat.emissiveColor = new BABYLON.Color3(0.08, 0.02, 0.015);
  ciliary.material = ciliaryMat;
  ciliary.isPickable = false;

  const nerve = BABYLON.MeshBuilder.CreateCylinder(
    'optic-nerve',
    { height: 7, diameterTop: 2.2, diameterBottom: 3.4, tessellation: 32 },
    scene,
  );
  nerve.parent = root;
  nerve.rotation.x = Math.PI / 2;
  nerve.position.set(0, 0, -14.7);
  const nerveMat = new BABYLON.StandardMaterial('nerve-mat', scene);
  nerveMat.diffuseColor = new BABYLON.Color3(0.86, 0.72, 0.52);
  nerve.material = nerveMat;
  nerve.isPickable = false;

  const micro = createMicroStructures(scene, root);

  const clipMaterials: BABYLON.Material[] = [];
  root.getChildMeshes().forEach((mesh) => {
    if (mesh.material && !clipMaterials.includes(mesh.material)) clipMaterials.push(mesh.material);
  });

  return { root, lens, cornea, sclera, micro, clipMaterials };
}

export function defaultLensTransform() {
  return {
    position: [EYE.lensPosition.x, EYE.lensPosition.y, EYE.lensPosition.z] as Vec3,
    rotation: [0, 0, 0] as Vec3,
    scaling: [1, 1, 1] as Vec3,
    snappedToCornea: false,
  };
}
