/**
 * 自有着色器与材质工厂。
 *
 * 一套 GLSL 源码按用途产出四个变体：
 *  - forward：Lambert + 半球环境光，支持剖切 uniform、逐实例颜色
 *  - pick：输出逐套管 30bit ID，剖切 discard 与 forward 完全一致（保证不错层）
 *
 * 剖切判定在世界空间进行：dot(worldPos, uClipNormal) - uClipDistance > 0 的片段丢弃。
 * 拾取通道复用同一判定，被切掉的部分不会写入 ID，露出的内部面仍写入自己的 ID。
 */
import * as pc from 'playcanvas';
import type { MeshData } from '../core/geometry';

export interface ClipUniforms {
  enabled: boolean;
  normal: [number, number, number];
  distance: number;
}

const COMMON_VERTEX = /* glsl */ `
attribute vec3 vertex_position;
attribute vec3 vertex_normal;
#ifdef USE_INSTANCING
attribute vec4 instance_line1;
attribute vec4 instance_line2;
attribute vec4 instance_line3;
attribute vec4 instance_line4;
attribute vec4 instance_color;
varying vec4 vInstanceColor;
#endif
uniform mat4 matrix_viewProjection;
uniform mat4 matrix_model;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

mat4 getModelMatrix(void) {
#ifdef USE_INSTANCING
    // 与引擎原生 instancing 约定一致：四个行向量按列构造
    return mat4(instance_line1.x, instance_line1.y, instance_line1.z, instance_line1.w,
                instance_line2.x, instance_line2.y, instance_line2.z, instance_line2.w,
                instance_line3.x, instance_line3.y, instance_line3.z, instance_line3.w,
                instance_line4.x, instance_line4.y, instance_line4.z, instance_line4.w);
#else
    return matrix_model;
#endif
}

void main(void) {
    mat4 model = getModelMatrix();
    vec4 world = model * vec4(vertex_position, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = mat3(model) * vertex_normal;
#ifdef USE_INSTANCING
    vInstanceColor = instance_color;
#endif
    gl_Position = matrix_viewProjection * world;
}
`;

const CLIP_GLSL = /* glsl */ `
uniform vec4 uClipPlane; // xyz = normal, w = distance
uniform float uClipEnabled;
bool clipped(vec3 worldPos) {
    return uClipEnabled > 0.5 && dot(worldPos, uClipPlane.xyz) - uClipPlane.w > 0.0;
}
`;

const FORWARD_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#ifdef USE_INSTANCING
varying vec4 vInstanceColor;
uniform float uFadeNear;
uniform float uFadeFar;
#endif
uniform vec3 uBaseColor;
uniform vec3 uLightDir;
uniform vec3 uCameraPos;
uniform float uSelected;
${CLIP_GLSL}

void main(void) {
    if (clipped(vWorldPos)) discard;
    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uLightDir);
    float ndl = max(dot(N, L), 0.0);
    // 半球环境光，避免背面全黑
    float hemi = mix(0.28, 0.62, N.y * 0.5 + 0.5);
    vec3 base =
#ifdef USE_INSTANCING
        vInstanceColor.rgb;
#else
        uBaseColor;
#endif
    vec3 color = base * (hemi + ndl * 0.55);
    // 简单高光
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 H = normalize(L + V);
    color += vec3(0.35) * pow(max(dot(N, H), 0.0), 48.0);
    // 选中描边色叠加
    color = mix(color, vec3(1.0, 0.78, 0.18), uSelected * 0.55);
    float alpha = 1.0;
#ifdef USE_INSTANCING
    // 远距离自动变淡（近处不透明，远端衰减到 8%）
    float camDist = length(uCameraPos - vWorldPos);
    float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, camDist);
    alpha = mix(0.08, 1.0, fade) * vInstanceColor.a;
#endif
    gl_FragColor = vec4(color, alpha);
}
`;

const PICK_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
${CLIP_GLSL}
uniform vec3 uPickId; // 归一化到 [0,1] 的 ID 分量
void main(void) {
    if (clipped(vWorldPos)) discard;
    gl_FragColor = vec4(uPickId, 1.0);
}
`;

export type ShaderKind = 'forward' | 'pick';

function buildShader(
  device: pc.GraphicsDevice,
  kind: ShaderKind,
  instanced: boolean,
): pc.Shader {
  const defines = instanced ? '#define USE_INSTANCING 1\n' : '';
  // 非实例化变体绝不能声明 instance_* attribute，否则会与 position 抢占 location 0
  const attributes: Record<string, string> = {
    vertex_position: pc.SEMANTIC_POSITION,
    vertex_normal: pc.SEMANTIC_NORMAL,
  };
  if (instanced) {
    // 与引擎原生 instancing 一致使用 ATTR12-15（location 12-15），
    // 避开 position(0)/normal(1)；颜色用空闲的 ATTR8
    Object.assign(attributes, {
      instance_line1: pc.SEMANTIC_ATTR12,
      instance_line2: pc.SEMANTIC_ATTR13,
      instance_line3: pc.SEMANTIC_ATTR14,
      instance_line4: pc.SEMANTIC_ATTR15,
      instance_color: pc.SEMANTIC_ATTR8,
    });
  }
  return new pc.Shader(device, {
    name: `guide-${kind}${instanced ? '-inst' : ''}`,
    attributes,
    vshader: defines + COMMON_VERTEX,
    fshader:
      defines + (kind === 'pick' ? PICK_FRAGMENT : FORWARD_FRAGMENT),
  });
}

/**
 * 自定义材质：一个材质同时缓存 forward / pick 两个 shader 变体。
 * 注意：逐 drawcall 的 uniform（颜色/选中/拾取 ID/淡出）一律走
 * MeshInstance.setParameter，不能写 scope 全局变量——引擎两阶段渲染会让
 * 最后一个材质的值覆盖前面所有材质。全局 uniform（光照/相机/剖切）才写 scope。
 */
export class GuideMaterial extends pc.Material {
  private forward: pc.Shader;
  private pick: pc.Shader;
  baseColor: pc.Color;
  selected = 0;
  /** 实例化材质的距离淡出区间（mm） */
  fadeNear = 60;
  fadeFar = 160;

  constructor(
    device: pc.GraphicsDevice,
    baseColor: pc.Color,
    private readonly instanced = false,
    private readonly pickId: number | null = null,
  ) {
    super();
    this.forward = buildShader(device, 'forward', instanced);
    this.pick = buildShader(device, 'pick', instanced);
    this.baseColor = baseColor;
  }

  get isInstanced(): boolean {
    return this.instanced;
  }

  get encodedPickId(): number | null {
    return this.pickId;
  }

  override getShaderVariant(
    _device: pc.GraphicsDevice,
    _scene: pc.Scene,
    _objDefs: number,
    _unused: number,
    pass: number,
  ): pc.Shader {
    return pass === pc.SHADER_PICK ? this.pick : this.forward;
  }

  /** 逐 drawcall uniform 由 MeshInstance 参数提供，这里不写全局 scope */
  override updateUniforms(): void {}
}

/** 把材质配置推到具体 drawcall（forward 通道，pass bit 0） */
export function writeForwardDrawUniforms(mi: pc.MeshInstance, mat: GuideMaterial): void {
  const forwardFlag = 1 << pc.SHADER_FORWARD;
  mi.setParameter('uBaseColor', [mat.baseColor.r, mat.baseColor.g, mat.baseColor.b], forwardFlag);
  mi.setParameter('uSelected', mat.selected, forwardFlag);
  if (mat.isInstanced) {
    mi.setParameter('uFadeNear', mat.fadeNear, forwardFlag);
    mi.setParameter('uFadeFar', mat.fadeFar, forwardFlag);
  }
}

/** 把稳定领域 ID 编码为拾取颜色，推到拾取通道 drawcall（24bit，0 留给背景） */
export function writePickDrawUniforms(mi: pc.MeshInstance, sleeveId: number): void {
  const id = sleeveId + 1;
  // 默认 passFlags 不包含 SHADER_PICK(bit3)，必须显式带上拾取位，否则该 uniform 被过滤
  const pickFlag = 1 << pc.SHADER_PICK;
  mi.setParameter(
    'uPickId',
    [
      (id & 255) / 255,
      ((id >> 8) & 255) / 255,
      ((id >> 16) & 255) / 255,
    ],
    pickFlag,
  );
}

/** 全局剖切 uniform 同步器：每帧把同一套剖切参数推给所有自定义材质使用的 scope 变量 */
export class ClipUniformSync {
  constructor(private readonly device: pc.GraphicsDevice) {}

  push(clip: ClipUniforms): void {
    const d = this.device;
    d.scope.resolve('uClipEnabled').setValue(clip.enabled ? 1 : 0);
    d.scope
      .resolve('uClipPlane')
      .setValue([clip.normal[0], clip.normal[1], clip.normal[2], clip.distance]);
  }
}

/** MeshData → pc.Mesh */
export function createPcMesh(device: pc.GraphicsDevice, data: MeshData): pc.Mesh {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(data.positions);
  mesh.setNormals(data.normals);
  mesh.setIndices(data.indices);
  mesh.update();
  return mesh;
}

/**
 * 实例化顶点缓冲：四个 vec4 存模型矩阵的四个列（与 pc.Mat4.data 列主序一致），
 * 第五个 vec4 是逐实例颜色（rgb + 保留 a）。
 */
export interface InstanceItem {
  matrix: pc.Mat4;
  color: [number, number, number, number];
}

export function createInstanceBuffer(
  device: pc.GraphicsDevice,
  items: InstanceItem[],
): pc.VertexBuffer {
  const strideFloats = 20;
  const data = new Float32Array(items.length * strideFloats);
  items.forEach((item, i) => {
    const m = item.matrix.data;
    data.set(m, i * strideFloats);
    data.set(item.color, i * strideFloats + 16);
  });
  const format = new pc.VertexFormat(device, [
    { semantic: pc.SEMANTIC_ATTR12, components: 4, type: pc.TYPE_FLOAT32 },
    { semantic: pc.SEMANTIC_ATTR13, components: 4, type: pc.TYPE_FLOAT32 },
    { semantic: pc.SEMANTIC_ATTR14, components: 4, type: pc.TYPE_FLOAT32 },
    { semantic: pc.SEMANTIC_ATTR15, components: 4, type: pc.TYPE_FLOAT32 },
    { semantic: pc.SEMANTIC_ATTR8, components: 4, type: pc.TYPE_FLOAT32 },
  ]);
  return new pc.VertexBuffer(device, format, items.length, {
    data: data.buffer as ArrayBuffer,
    usage: pc.BUFFER_DYNAMIC,
  });
}

/** 从拾取颜色还原 sleeve ID（与 updateUniforms 的 24bit 编码互逆），背景返回 null */
export function decodePickId(r: number, g: number, b: number): number | null {
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  const bi = Math.round(b * 255);
  const id = ri | (gi << 8) | (bi << 16);
  return id === 0 ? null : id - 1;
}
