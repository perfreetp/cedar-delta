import { sharedCss } from './styles';
import { getStore, getPlayback, whenStoreReady } from '../core/registry';

/**
 * 时间刻度尺：
 * - pxPerSec 可调（时间轴横向拉伸/压缩）
 * - 拖动/点击刻度尺即 scrub，与播放共用 evaluateTimeline，结果一致
 * - 刻度间隔随缩放自适应
 */
export class CrRuler extends HTMLElement {
  private root: ShadowRoot;
  private canvas: HTMLCanvasElement;
  private dragging = false;
  private pxPerSec = 12;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${sharedCss}</style>`;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;height:40px;overflow:hidden;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:40px;cursor:pointer;background:var(--bg-1);';
    wrap.appendChild(this.canvas);
    this.root.appendChild(wrap);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.scrubTo(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.scrubTo(e);
    });
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    this.canvas.addEventListener('pointercancel', () => (this.dragging = false));
  }

  setScale(pxPerSec: number) {
    this.pxPerSec = pxPerSec;
    whenStoreReady(() => this.render());
  }

  private scrubTo(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const time = x / this.pxPerSec;
    getPlayback().scrub(Math.min(time, getStore().doc.duration));
  }

  render() {
    const store = getStore();
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth || 600;
    const cssH = 40;
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // 自适应刻度间隔，保证最小间距 ~70px
    const target = 70 / this.pxPerSec;
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];
    const step = nice.find((n) => n >= target) ?? 60;
    ctx.strokeStyle = '#2b3a5c';
    ctx.fillStyle = '#8fa3c8';
    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;
    const total = store.doc.duration;
    for (let t = 0; t <= total + 1e-9; t += step) {
      const x = t * this.pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x, 30);
      ctx.stroke();
      ctx.fillText(`${+t.toFixed(2)}s`, x + 4, 12);
    }
    // 半秒小刻度
    const sub = step / 2;
    ctx.strokeStyle = '#1d2942';
    for (let t = 0; t <= total + 1e-9; t += sub) {
      const x = t * this.pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x, 30);
      ctx.stroke();
    }
    // 底线
    ctx.strokeStyle = '#2b3a5c';
    ctx.beginPath();
    ctx.moveTo(0, 39.5);
    ctx.lineTo(cssW, 39.5);
    ctx.stroke();
  }
}

customElements.define('cr-ruler', CrRuler);
