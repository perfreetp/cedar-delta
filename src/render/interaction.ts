import type { Camera } from '../types';
import type { Viewport } from '../core/camera';
import { zoomAt } from '../core/camera';

export type DragMode = 'none' | 'pan' | 'rotate' | 'select';

export interface InteractionCallbacks {
  getCamera: () => Camera;
  setCamera: (c: Camera, opts?: { interacting?: boolean; transient?: boolean }) => void;
  getViewport: () => Viewport;
  onClick: (sx: number, sy: number, mods: { shift: boolean; alt: boolean }) => void;
  /** additive=true 表示按住 Shift 框选,应当并入现有选择而不是替换 */
  onBoxSelect: (rect: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) => void;
  /** 拖拽框选的视觉反馈 */
  onBoxUpdate: (rect: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  /** 用户是否处于框选模式(工具栏切换) */
  isBoxMode: () => boolean;
  onWheelZoom?: () => void;
  /** Esc:退出框选模式并清空选择 */
  onEscape?: () => void;
}

const MIN_ZOOM = 0.006;
const MAX_ZOOM = 6;

/**
 * 相机交互:平移、滚轮缩放(指针为锚)、右键/Alt 旋转、Shift 拖拽框选。
 * 全部自己处理原生事件,不经 ECharts 的 roam,以便完全控制变换与降级。
 */
export class InteractionController {
  private mode: DragMode = 'none';
  private startX = 0;
  private startY = 0;
  private startRotation = 0;
  private boxStart: { x: number; y: number } | null = null;
  private moved = false;
  private lastPointer = { x: 0, y: 0 };
  private cleanup: (() => void)[] = [];
  private wheelRaf = 0;
  private pendingWheel: { sx: number; sy: number; delta: number } | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly cb: InteractionCallbacks,
  ) {
    this.bind();
  }

  private localXY(e: PointerEvent | MouseEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bind() {
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      const p = this.localXY(e);
      this.startX = p.x;
      this.startY = p.y;
      this.lastPointer = p;
      this.moved = false;

      const wantRotate = e.button === 2 || e.altKey;
      const wantSelect = (e.shiftKey || this.cb.isBoxMode()) && e.button === 0 && !wantRotate;

      if (wantRotate) {
        this.mode = 'rotate';
        this.startRotation = Math.atan2(p.y - this.cb.getViewport().height / 2, p.x - this.cb.getViewport().width / 2);
      } else if (wantSelect) {
        this.mode = 'select';
        this.boxStart = { x: p.x, y: p.y };
      } else {
        this.mode = 'pan';
      }

      this.el.setPointerCapture?.(e.pointerId);
      this.el.style.cursor = this.mode === 'rotate' ? 'grabbing' : this.mode === 'select' ? 'crosshair' : 'grabbing';
      e.preventDefault();
      e.stopPropagation();
    };

    const move = (e: PointerEvent) => {
      if (this.mode === 'none') return;
      const p = this.localXY(e);
      const dx = p.x - this.lastPointer.x;
      const dy = p.y - this.lastPointer.y;
      this.lastPointer = p;
      if (Math.abs(p.x - this.startX) > 3 || Math.abs(p.y - this.startY) > 3) this.moved = true;

      const cam = this.cb.getCamera();
      const vp = this.cb.getViewport();

      if (this.mode === 'pan') {
        // 屏幕位移 → 世界位移(考虑旋转)
        const cos = Math.cos(cam.rotation);
        const sin = Math.sin(cam.rotation);
        const wx = (-dx * cos - dy * sin) / cam.zoom;
        const wy = (dx * sin - dy * cos) / cam.zoom;
        this.cb.setCamera({ ...cam, x: cam.x + wx, y: cam.y + wy }, { interacting: true });
      } else if (this.mode === 'rotate') {
        const ang = Math.atan2(p.y - vp.height / 2, p.x - vp.width / 2);
        let next = cam.rotation + (ang - this.startRotation);
        this.startRotation = ang;
        if (e.shiftKey) {
          const snap = Math.PI / 12; // 15°
          next = Math.round(next / snap) * snap;
        }
        this.cb.setCamera({ ...cam, rotation: next }, { interacting: true });
      } else if (this.mode === 'select' && this.boxStart) {
        this.cb.onBoxUpdate({
          x0: this.boxStart.x,
          y0: this.boxStart.y,
          x1: p.x,
          y1: p.y,
        });
      }
    };

    const up = (e: PointerEvent) => {
      if (this.mode === 'none') return;
      const p = this.localXY(e);
      const wasMode = this.mode;
      this.mode = 'none';
      this.el.style.cursor = this.cb.isBoxMode() ? 'crosshair' : 'grab';

      if (wasMode === 'select' && this.boxStart) {
        const rect = { x0: this.boxStart.x, y0: this.boxStart.y, x1: p.x, y1: p.y };
        this.boxStart = null;
        this.cb.onBoxUpdate(null);
        if (Math.abs(rect.x1 - rect.x0) > 4 && Math.abs(rect.y1 - rect.y0) > 4) {
          this.cb.onBoxSelect(rect, e.shiftKey);
        } else if (!this.moved) {
          this.cb.onClick(p.x, p.y, { shift: e.shiftKey, alt: e.altKey });
        }
        return;
      }

      if (wasMode === 'pan' && !this.moved) {
        this.cb.onClick(p.x, p.y, { shift: e.shiftKey, alt: e.altKey });
      }
      // 拖拽结束 → 通知补全(通过一次非交互 setCamera)
      if (this.moved) {
        this.cb.setCamera(this.cb.getCamera(), { interacting: false });
      }
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = this.localXY(e);
      const factor = Math.exp(-e.deltaY * 0.0016);
      this.pendingWheel = { sx: p.x, sy: p.y, delta: factor };
      if (this.wheelRaf) return;
      this.wheelRaf = requestAnimationFrame(() => {
        this.wheelRaf = 0;
        const w = this.pendingWheel;
        this.pendingWheel = null;
        if (!w) return;
        const cam = this.cb.getCamera();
        const vp = this.cb.getViewport();
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * w.delta));
        const next = zoomAt(cam, vp, w.sx, w.sy, nextZoom);
        this.cb.setCamera(next, { interacting: true });
        this.cb.onWheelZoom?.();
      });
    };

    const ctx = (e: Event) => e.preventDefault();

    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.cb.onEscape?.();
      }
    };

    const onEnter = () => {
      if (this.mode === 'none') this.el.style.cursor = this.cb.isBoxMode() ? 'crosshair' : 'grab';
    };

    this.el.addEventListener('pointerdown', down);
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
    this.el.addEventListener('wheel', wheel, { passive: false });
    this.el.addEventListener('contextmenu', ctx);
    this.el.addEventListener('pointerenter', onEnter);
    window.addEventListener('keydown', key);

    this.cleanup.push(() => {
      this.el.removeEventListener('pointerdown', down);
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.el.removeEventListener('wheel', wheel);
      this.el.removeEventListener('contextmenu', ctx);
      this.el.removeEventListener('pointerenter', onEnter);
      window.removeEventListener('keydown', key);
      if (this.wheelRaf) cancelAnimationFrame(this.wheelRaf);
    });
  }

  get isDragging() {
    return this.mode !== 'none';
  }

  dispose() {
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }
}
