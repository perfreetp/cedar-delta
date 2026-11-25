/**
 * 程序化网格生成（纯数据，不依赖引擎），输出位置/法线/索引，
 * 由引擎层上传为 pc.Mesh。
 */
import type { DentalArch } from './arch';
import { v3, type Vec3Tuple } from './math';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * 旋转体：把 (radius, y) 闭合剖面绕 Y 轴旋转。
 * 闭合剖面依次沿"外壁向上 → 顶环 → 内壁向下 → 底环"行走，
 * 一次生成水密的空心件，内壁真实存在（剖切可见）。
 */
export function lathe(profile: Array<readonly [number, number]>, segments: number): MeshData {
  const rings = profile.length;
  const positions: number[] = [];
  const normals: number[] = [];

  // 剖面各点的外向法线（相邻边法线平均）
  const profileNormal: Array<[number, number]> = [];
  for (let j = 0; j < rings; j++) {
    const p0 = profile[(j - 1 + rings) % rings];
    const p1 = profile[j];
    const p2 = profile[(j + 1) % rings];
    const e1: [number, number] = [p1[0] - p0[0], p1[1] - p0[1]];
    const e2: [number, number] = [p2[0] - p1[0], p2[1] - p1[1]];
    const n1 = normalize2([e1[1], -e1[0]]);
    const n2 = normalize2([e2[1], -e2[0]]);
    profileNormal.push(normalize2([n1[0] + n2[0], n1[1] + n2[1]]));
  }

  for (let i = 0; i <= segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let j = 0; j < rings; j++) {
      const [r, y] = profile[j];
      positions.push(r * cos, y, r * sin);
      const [nr, ny] = profileNormal[j];
      normals.push(nr * cos, ny, nr * sin);
    }
  }

  const indices: number[] = [];
  const ringStart = (i: number, j: number) => i * rings + j;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rings; j++) {
      const j2 = (j + 1) % rings;
      const a = ringStart(i, j);
      const b = ringStart(i, j2);
      const c = ringStart(i + 1, j);
      const d = ringStart(i + 1, j2);
      indices.push(a, b, c, c, b, d);
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}

/** 带肩台的空心种植导板套管剖面 */
export function sleeveProfile(
  height = 10,
  outerR = 2.4,
  innerR = 1.3,
): Array<[number, number]> {
  const h = height;
  const collarR = outerR * 1.28;
  const collarH = h * 0.22;
  // 从底面外角开始，外壁上行、肩台、内壁下行，底面闭合
  return [
    [outerR, -h / 2],
    [outerR, h / 2 - collarH],
    [collarR, h / 2 - collarH],
    [collarR, h / 2],
    [innerR, h / 2],
    [innerR, -h / 2],
  ];
}

/** 圆环（旋转手柄用） */
export function torus(majorR: number, minorR: number, segU = 40, segV = 12): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = (2 * Math.PI * i) / segU;
    for (let j = 0; j <= segV; j++) {
      const v = (2 * Math.PI * j) / segV;
      const x = (majorR + minorR * Math.cos(v)) * Math.cos(u);
      const y = minorR * Math.sin(v);
      const z = (majorR + minorR * Math.cos(v)) * Math.sin(u);
      positions.push(x, y, z);
      normals.push(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u));
    }
  }
  const indices: number[] = [];
  const row = segV + 1;
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}

/** 八面体小菱形（牙位标记点实例） */
export function diamond(size = 0.55): MeshData {
  const s = size;
  const positions = Float32Array.of(
    0, s, 0, 0, 0, s, s, 0, 0,
    0, s, 0, s, 0, 0, 0, 0, -s,
    0, s, 0, 0, 0, -s, -s, 0, 0,
    0, s, 0, -s, 0, 0, 0, 0, s,
    0, -s, 0, s, 0, 0, 0, 0, s,
    0, -s, 0, 0, 0, -s, s, 0, 0,
    0, -s, 0, -s, 0, 0, 0, 0, -s,
    0, -s, 0, 0, 0, s, -s, 0, 0,
  );
  const normals: number[] = [];
  const at = (base: number, offset: number): Vec3Tuple => [
    positions[base + offset],
    positions[base + offset + 1],
    positions[base + offset + 2],
  ];
  for (let t = 0; t < 8; t++) {
    const base = t * 9;
    const a = at(base, 0);
    const b = at(base, 3);
    const c = at(base, 6);
    const n = v3.normalize(v3.cross(v3.sub(b, a), v3.sub(c, a)));
    for (let k = 0; k < 3; k++) normals.push(...n);
  }
  const indices = Uint32Array.from({ length: 24 }, (_, i) => i);
  return { positions, normals: Float32Array.from(normals), indices };
}

/**
 * 下颌牙槽嵴实体：牙弓曲面为顶，向下拉伸成带厚度的 U 形骨体。
 */
export function jawRidge(
  arch: DentalArch,
  nu = 120,
  nv = 24,
  thickness = 16,
): MeshData {
  const halfW = arch.params.ridgeHalfWidth + 4;
  const positions: number[] = [];
  const normals: number[] = [];
  const topIdx = (i: number, j: number) => i * (nv + 1) + j;
  const bottomOffset = (nu + 1) * (nv + 1);
  const botIdx = (i: number, j: number) => bottomOffset + topIdx(i, j);

  const uvAt = (i: number, j: number): [number, number] => [
    -1 + (2 * i) / nu,
    -halfW + (2 * halfW * j) / nv,
  ];

  // 顶面（含平滑法线）
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const [u, v] = uvAt(i, j);
      const p = arch.surface(u, v);
      const f = arch.frame(u, v);
      positions.push(...p);
      normals.push(...f.normal);
    }
  }
  // 底面
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const [u, v] = uvAt(i, j);
      const p = arch.surface(u, v);
      positions.push(p[0], p[1] - thickness, p[2]);
      normals.push(0, -1, 0);
    }
  }

  const indices: number[] = [];
  // 顶
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = topIdx(i, j), b = topIdx(i + 1, j), c = topIdx(i, j + 1), d = topIdx(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  // 底（反向）
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = botIdx(i, j), b = botIdx(i + 1, j), c = botIdx(i, j + 1), d = botIdx(i + 1, j + 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  // 四周侧壁
  const side = (edge: Array<[number, number]>) => {
    for (let k = 0; k < edge.length - 1; k++) {
      const [i1, j1] = edge[k];
      const [i2, j2] = edge[k + 1];
      const t1 = topIdx(i1, j1), t2 = topIdx(i2, j2);
      const b1 = botIdx(i1, j1), b2 = botIdx(i2, j2);
      indices.push(t1, b1, t2, t2, b1, b2);
    }
  };
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i <= nu; i++) {
    left.push([i, 0]);
    right.push([i, nv]);
  }
  side(left);
  side(right);
  const front: Array<[number, number]> = [];
  const back: Array<[number, number]> = [];
  for (let j = 0; j <= nv; j++) {
    front.push([0, j]);
    back.push([nu, j]);
  }
  side(front);
  side(back);

  const mesh: MeshData = {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
  return orientOutward(mesh);
}

/** 校验并修正三角形朝向，使首个三角形朝向其法线锥外侧 */
function orientOutward(mesh: MeshData): MeshData {
  const { positions, indices } = mesh;
  const ia = indices[0] * 3;
  const a: Vec3Tuple = [positions[ia], positions[ia + 1], positions[ia + 2]];
  const ib = indices[1] * 3;
  const b: Vec3Tuple = [positions[ib], positions[ib + 1], positions[ib + 2]];
  const ic = indices[2] * 3;
  const c: Vec3Tuple = [positions[ic], positions[ic + 1], positions[ic + 2]];
  const faceN = v3.normalize(v3.cross(v3.sub(b, a), v3.sub(c, a)));
  const storedN = v3.normalize([mesh.normals[ia], mesh.normals[ia + 1], mesh.normals[ia + 2]]);
  if (v3.dot(faceN, storedN) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  return mesh;
}

function normalize2(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]);
  return l > 1e-12 ? [v[0] / l, v[1] / l] : [0, 0];
}
