import * as THREE from 'three';
import type { ColliderSpec, Obstacle } from '../types';

export interface ObstacleVisual {
  root: THREE.Group;
  bodyMaterials: THREE.MeshStandardMaterial[];
  colliderMaterials: THREE.MeshBasicMaterial[];
  lineMaterials: THREE.LineBasicMaterial[];
  badge: StatusBadge;
  measureLine?: THREE.Line;
  waterRing?: THREE.Mesh;
  topLocal: number;
}

export class StatusBadge {
  readonly sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 192;
    this.context = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(2.15, 0.81, 1);
    this.sprite.renderOrder = 99;
    this.sprite.visible = false;
  }

  set(text: string, background: string, foreground = '#ffffff') {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const gradient = ctx.createLinearGradient(0, 24, 0, 168);
    gradient.addColorStop(0, background);
    gradient.addColorStop(1, shade(background, -28));
    roundedRect(ctx, 28, 34, 456, 124, 62);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,.82)';
    ctx.stroke();
    ctx.font = '800 72px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = foreground;
    ctx.fillText(text, 256, 100);
    this.texture.needsUpdate = true;
    this.sprite.visible = true;
  }

  hide() {
    this.sprite.visible = false;
  }
}

function shade(hex: string, amount: number): string {
  const color = new THREE.Color(hex);
  color.offsetHSL(0, 0, amount / 100);
  return `#${color.getHexString()}`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function enableShadows(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function applyObstacleId(root: THREE.Object3D, id: string) {
  root.traverse((child) => {
    child.userData.obstacleId = id;
  });
}

function makeColliderPreview(spec: ColliderSpec): {
  group: THREE.Group;
  fillMaterials: THREE.MeshBasicMaterial[];
  lineMaterials: THREE.LineBasicMaterial[];
  top: number;
} {
  const group = new THREE.Group();
  const fillMaterials: THREE.MeshBasicMaterial[] = [];
  const lineMaterials: THREE.LineBasicMaterial[] = [];
  let top = 0.5;

  const addPrimitive = (
    geometry: THREE.BufferGeometry,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
  ) => {
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.055,
      depthWrite: false,
    });
    fillMaterials.push(fillMaterial);
    const fill = new THREE.Mesh(geometry, fillMaterial);
    fill.position.set(...position);
    fill.rotation.set(...rotation);
    group.add(fill);

    const edgeGeometry = new THREE.EdgesGeometry(geometry, 18);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: '#7dd3fc',
      transparent: true,
      opacity: 0.72,
      depthTest: false,
    });
    lineMaterials.push(lineMaterial);
    const edges = new THREE.LineSegments(edgeGeometry, lineMaterial);
    edges.position.copy(fill.position);
    edges.rotation.copy(fill.rotation);
    edges.renderOrder = 50;
    group.add(edges);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) {
      const euler = new THREE.Euler(...rotation);
      const corners = [
        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z),
      ];
      for (const corner of corners) {
        corner.applyEuler(euler).add(new THREE.Vector3(...position));
        top = Math.max(top, corner.y);
      }
    }
  };

  if (spec.kind === 'box') {
    addPrimitive(new THREE.BoxGeometry(...spec.size));
    top = spec.size[1] / 2;
  } else if (spec.kind === 'cylinder') {
    addPrimitive(new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, spec.segments ?? 20, 1));
    top = spec.height / 2;
  } else {
    for (const part of spec.parts) {
      if (part.collider.kind === 'box') {
        addPrimitive(
          new THREE.BoxGeometry(...part.collider.size),
          part.position,
          part.rotation?.map(THREE.MathUtils.degToRad) as [number, number, number] | undefined,
        );
      } else if (part.collider.kind === 'cylinder') {
        addPrimitive(
          new THREE.CylinderGeometry(
            part.collider.radius,
            part.collider.radius,
            part.collider.height,
            part.collider.segments ?? 18,
          ),
          part.position,
          part.rotation?.map(THREE.MathUtils.degToRad) as [number, number, number] | undefined,
        );
      }
    }
    top = Math.max(...spec.parts.map((p) => (p.position?.[1] ?? 0) + primitiveHalfHeight(p.collider)));
  }

  return { group, fillMaterials, lineMaterials, top };
}

function primitiveHalfHeight(spec: ColliderSpec): number {
  if (spec.kind === 'box') return spec.size[1] / 2;
  if (spec.kind === 'cylinder') return spec.height / 2;
  return 0.5;
}

function createRock(o: Obstacle): { group: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const position = geometry.attributes.position;
  const v = new THREE.Vector3();
  const seed = hashString(o.id);
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const n = v.clone().normalize();
    const noise =
      1 +
      0.13 * Math.sin(n.x * 8.1 + seed) * Math.cos(n.y * 6.7 - seed * 0.4) +
      0.08 * Math.sin(n.z * 13.2 + seed * 1.7);
    v.multiplyScalar(noise);
    position.setXYZ(i, v.x, v.y * 0.92, v.z);
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.color),
    roughness: 0.94,
    metalness: 0.02,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(o.collider.kind === 'box' ? o.collider.size[0] / 2 : 1.2, o.collider.kind === 'box' ? o.collider.size[1] / 2 : 0.85, o.collider.kind === 'box' ? o.collider.size[2] / 2 : 1.1);
  group.add(mesh);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 34),
    new THREE.LineBasicMaterial({ color: '#1f2937', transparent: true, opacity: 0.22 }),
  );
  edges.scale.copy(mesh.scale).multiplyScalar(1.003);
  group.add(edges);

  return { group, materials: [material] };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % 1000;
}

function createBuoy(o: Obstacle): { group: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const mainColor = new THREE.Color(o.color);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: mainColor, roughness: 0.42, metalness: 0.05 });
  const whiteMaterial = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.38 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.55 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.28, metalness: 0.65 });

  if (o.libraryId === 'buoy-twin' || o.name.includes('双筒')) {
    for (const x of [-0.38, 0.38]) {
      const pontoon = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.78, 24), bodyMaterial);
      pontoon.rotation.z = Math.PI / 2;
      pontoon.position.set(x, -0.05, 0);
      group.add(pontoon);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.276, 0.276, 0.16, 24), whiteMaterial);
      band.rotation.z = Math.PI / 2;
      band.position.set(x, -0.05, 0);
      group.add(band);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.12, 0.2), metalMaterial);
    bar.position.y = 0.38;
    group.add(bar);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 12), metalMaterial);
    mast.position.y = 0.72;
    group.add(mast);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), bodyMaterial);
    lamp.position.y = 1.03;
    group.add(lamp);
  } else if (o.libraryId === 'buoy-yellow' || o.name.includes('球')) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.52, 28, 18), bodyMaterial);
    sphere.scale.y = 0.86;
    sphere.position.y = -0.05;
    group.add(sphere);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.535, 0.535, 0.16, 28), darkMaterial);
    band.position.y = -0.05;
    group.add(band);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 12), metalMaterial);
    mast.position.y = 0.48;
    group.add(mast);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), bodyMaterial);
    top.position.y = 0.72;
    group.add(top);
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.66, 28), bodyMaterial);
    body.position.y = -0.16;
    group.add(body);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.397, 0.421, 0.18, 28), whiteMaterial);
    stripe.position.y = -0.16;
    group.add(stripe);
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 0.24, 28), bodyMaterial);
    shoulder.position.y = 0.29;
    group.add(shoulder);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.46, 12), metalMaterial);
    mast.position.y = 0.58;
    group.add(mast);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 12), o.libraryId === 'buoy-red' ? whiteMaterial : bodyMaterial);
    lamp.position.y = 0.85;
    group.add(lamp);
  }

  return { group, materials: [bodyMaterial, whiteMaterial, darkMaterial, metalMaterial] };
}

function createArtificial(o: Obstacle): { group: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.78, metalness: 0.04 });
  const lightMaterial = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.5 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.7 });
  const materials = [material, lightMaterial, darkMaterial];

  const addSpec = (spec: ColliderSpec, position?: [number, number, number], rotation?: [number, number, number]) => {
    if (spec.kind === 'box') {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...spec.size), material);
      if (position) mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: '#1c1917', transparent: true, opacity: 0.28 }),
      );
      mesh.add(edges);
      group.add(mesh);
      return mesh;
    }
    if (spec.kind === 'cylinder') {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, 24), material);
      if (position) mesh.position.set(...position);
      group.add(mesh);
      return mesh;
    }
    for (const part of spec.parts) addSpec(part.collider, part.position, part.rotation);
  };

  addSpec(o.collider);

  if (o.libraryId === 'art-gate') {
    for (const x of [-1.7, 1.7]) {
      for (let y = -1.4; y <= 1.4; y += 0.42) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.16, 0.205), y > 0 ? lightMaterial : darkMaterial);
        band.position.set(x, y, 0);
        group.add(band);
      }
    }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.06), lightMaterial);
    sign.position.set(0, 1.53, 0.13);
    group.add(sign);
  }

  if (o.libraryId === 'art-pier') {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(o.collider.kind === 'box' ? o.collider.size[0] + 0.35 : 2, 0.28, o.collider.kind === 'box' ? o.collider.size[2] + 0.35 : 2.5), lightMaterial);
    cap.position.y = (o.collider.kind === 'box' ? o.collider.size[1] / 2 : 2.15) + 0.08;
    group.add(cap);
  }

  return { group, materials };
}

export function createObstacleVisual(o: Obstacle): ObstacleVisual {
  const root = new THREE.Group();
  let bodyMaterials: THREE.MeshStandardMaterial[] = [];

  if (o.kind === 'rock') {
    const rock = createRock(o);
    root.add(rock.group);
    bodyMaterials = rock.materials;
  } else if (o.kind === 'buoy') {
    const buoy = createBuoy(o);
    root.add(buoy.group);
    bodyMaterials = buoy.materials;
  } else {
    const artificial = createArtificial(o);
    root.add(artificial.group);
    bodyMaterials = artificial.materials;
  }

  const preview = makeColliderPreview(o.collider);
  root.add(preview.group);

  const badge = new StatusBadge();
  root.add(badge.sprite);
  badge.sprite.position.y = preview.top + 0.72;

  const waterRing = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.82, 56),
    new THREE.MeshBasicMaterial({ color: '#bae6fd', transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
  );
  waterRing.rotation.x = -Math.PI / 2;
  root.add(waterRing);

  const measureGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.95, 0, 0),
    new THREE.Vector3(0.95, 1, 0),
  ]);
  const measureLine = new THREE.Line(
    measureGeometry,
    new THREE.LineDashedMaterial({ color: '#e0f2fe', dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.9, depthTest: false }),
  );
  measureLine.computeLineDistances();
  measureLine.renderOrder = 60;
  root.add(measureLine);

  root.position.set(...o.position);
  root.rotation.set(...o.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
  root.scale.set(...o.scale);
  applyObstacleId(root, o.id);
  enableShadows(root);

  return {
    root,
    bodyMaterials,
    colliderMaterials: preview.fillMaterials,
    lineMaterials: preview.lineMaterials,
    badge,
    measureLine,
    waterRing,
    topLocal: preview.top,
  };
}

export function disposeObject3D(object: THREE.Object3D) {
  const disposeMaterial = (material: THREE.Material) => {
    const textured = material as THREE.MeshStandardMaterial;
    textured.map?.dispose();
    material.dispose();
  };

  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
      if ('geometry' in child && child.geometry instanceof THREE.BufferGeometry) child.geometry.dispose();
      const material = child.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach(disposeMaterial);
      else if (material) disposeMaterial(material);
    }
  });
}
