/**
 * 颜色 ID 离屏拾取。
 *
 * 每个套管对应一个稳定的领域 ID（SleeveState.id），拾取材质把 ID 编码进颜色；
 * 拾取渲染与主渲染共用同一套剖切 uniform（ClipUniformSync），因此：
 *  - 被剖掉的片段在拾取通道同样 discard，不会误选；
 *  - 剖切后露出的内壁仍写自己的 ID，与未剖切时是同一个套管，不会错层。
 *
 * 按需渲染：点击/框选时才离屏渲染一次，再 readPixels 解码，平时零开销。
 */
import * as pc from 'playcanvas';
import { decodePickId } from './shaders';

export class ColorPicker {
  private renderTarget: pc.RenderTarget | null = null;
  private width = 0;
  private height = 0;

  constructor(
    private readonly app: pc.Application,
    private readonly pickLayer: pc.Layer,
  ) {}

  private ensureTarget(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (this.renderTarget && this.width === w && this.height === h) return;
    this.release();
    const colorBuffer = new pc.Texture(this.app.graphicsDevice, {
      format: pc.PIXELFORMAT_RGBA8,
      width: w,
      height: h,
      mipmaps: false,
      minFilter: pc.FILTER_NEAREST,
      magFilter: pc.FILTER_NEAREST,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      name: 'guide-pick',
    });
    this.renderTarget = new pc.RenderTarget({ colorBuffer, depth: true });
    this.width = w;
    this.height = h;
  }

  /**
   * 渲染拾取通道并返回指定屏幕矩形内的 sleeve ID 集合。
   * 矩形以 CSS 像素左上角原点给出，内部翻转 Y。
   */
  async query(
    camera: pc.CameraComponent,
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<number[]> {
    const device = this.app.graphicsDevice as unknown as GlGraphicsDevice;
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const cssW = canvas.clientWidth || 2;
    const cssH = canvas.clientHeight || 2;
    this.ensureTarget(cssW, cssH);
    const rt = this.renderTarget!;

    const renderer = (this.app as unknown as { renderer: RendererWithForward }).renderer;

    // 1. 离屏渲染拾取层（相机姿态与主相机一致）；背景清成黑色 = ID 0
    const cam = camera.camera as unknown as { clearColor: pc.Color };
    const savedClear = cam.clearColor;
    cam.clearColor = new pc.Color(0, 0, 0, 1);
    device.setRenderTarget(rt);
    device.updateBegin();
    renderer.clear(camera.camera, true, true, true);
    renderer.setCameraUniforms(camera.camera, rt);
    const instances = this.pickLayer.meshInstances.filter((mi) => mi.visible);
    const emptyLights: never[][] = [[], [], []];
    renderer.renderForward(camera.camera, instances, emptyLights, pc.SHADER_PICK, undefined);
    device.updateEnd();
    device.setRenderTarget(null);
    cam.clearColor = savedClear;

    // 2. 回读矩形像素
    const rx = Math.max(0, Math.floor(rect.x));
    const rw = Math.min(this.width - rx, Math.ceil(rect.w));
    const flipYTop = this.height - (rect.y + rect.h);
    const ry = Math.max(0, Math.floor(flipYTop));
    const rh = Math.min(this.height - ry, Math.ceil(rect.h));
    if (rw <= 0 || rh <= 0) return [];

    const pixels = new Uint8Array(4 * rw * rh);
    // readPixels 需要在 begin/end 段内
    device.setRenderTarget(rt);
    device.updateBegin();
    device.readPixels(rx, ry, rw, rh, pixels);
    device.updateEnd();
    device.setRenderTarget(null);

    const ids = new Set<number>();
    for (let i = 0; i < rw * rh; i++) {
      const id = decodePickId(pixels[i * 4] / 255, pixels[i * 4 + 1] / 255, pixels[i * 4 + 2] / 255);
      if (id !== null) ids.add(id);
    }
    return [...ids];
  }

  release(): void {
    if (this.renderTarget) {
      this.renderTarget.destroyTextureBuffers();
      this.renderTarget.destroy();
      this.renderTarget = null;
    }
  }
}

interface RendererWithForward {
  clear(camera: unknown, color: boolean, depth: boolean, stencil: boolean): void;
  setCameraUniforms(camera: unknown, rt: pc.RenderTarget): unknown;
  renderForward(
    camera: unknown,
    drawCalls: pc.MeshInstance[],
    lights: never[][],
    pass: number,
    drawCallback?: undefined,
  ): void;
}

/** GraphicsDevice 的 WebGL 能力在 d.ts 中被收窄，这里按运行时接口声明 */
interface GlGraphicsDevice {
  setRenderTarget(rt: pc.RenderTarget | null): void;
  updateBegin(): void;
  updateEnd(): void;
  readPixels(x: number, y: number, w: number, h: number, pixels: Uint8Array): void;
  canvas: HTMLCanvasElement;
}
