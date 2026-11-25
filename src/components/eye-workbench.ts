import { AnnotationOverlay } from './annotation-overlay';
import { EyeLab } from '../core/EyeLab';
import { formatMm, resolvePoint } from '../core/math';
import type { Measurement, ToolId, TransformMode } from '../core/types';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
<style>
  :host {
    display: block;
    width: 100%;
    height: 100%;
    color: #e5f0ff;
    font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    background:
      radial-gradient(circle at 58% 35%, rgba(14, 116, 144, .22), transparent 34%),
      radial-gradient(circle at 78% 78%, rgba(109, 40, 217, .18), transparent 30%),
      #07111f;
    overflow: hidden;
  }
  * { box-sizing: border-box; }
  button, input { font: inherit; }
  .app {
    display: grid;
    grid-template-columns: 286px minmax(0, 1fr) 318px;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .panel {
    min-height: 0;
    overflow: auto;
    padding: 18px;
    background: linear-gradient(180deg, rgba(8, 20, 38, .96), rgba(7, 17, 31, .9));
    border-color: rgba(125, 211, 252, .14);
    scrollbar-width: thin;
    scrollbar-color: #24435f transparent;
  }
  .panel--left { border-right: 1px solid rgba(125, 211, 252, .14); }
  .panel--right { border-left: 1px solid rgba(125, 211, 252, .14); }
  .brand { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; }
  .brand-mark {
    width: 42px; height: 42px; border-radius: 14px;
    background: radial-gradient(circle at 35% 30%, #a5f3fc, #0891b2 48%, #1e1b4b 100%);
    box-shadow: 0 0 28px rgba(34, 211, 238, .35);
    flex: 0 0 auto;
  }
  h1 { font-size: 17px; line-height: 1.25; margin: 0; letter-spacing: .02em; }
  .subtitle { margin: 4px 0 0; color: #8aa8c4; font-size: 12px; line-height: 1.45; }
  h2 {
    margin: 20px 0 10px;
    color: #8ed8ff;
    font-size: 12px;
    letter-spacing: .14em;
    text-transform: uppercase;
  }
  .tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .tool-grid .wide { grid-column: 1 / -1; }
  .btn {
    appearance: none;
    border: 1px solid rgba(148, 197, 255, .18);
    background: rgba(15, 32, 56, .86);
    color: #dbeafe;
    border-radius: 11px;
    padding: 10px 10px;
    min-height: 40px;
    cursor: pointer;
    transition: transform .12s ease, border-color .12s ease, background .12s ease, box-shadow .12s ease;
    text-align: left;
    font-size: 13px;
  }
  .btn:hover { border-color: rgba(103, 232, 249, .55); background: rgba(14, 42, 72, .95); transform: translateY(-1px); }
  .btn:active { transform: translateY(0); }
  .btn.active {
    border-color: #22d3ee;
    background: linear-gradient(180deg, rgba(8, 145, 178, .55), rgba(14, 116, 144, .32));
    box-shadow: inset 0 0 0 1px rgba(34, 211, 238, .18), 0 8px 24px rgba(8, 145, 178, .16);
    color: #ecfeff;
  }
  .btn.primary { border-color: rgba(34, 211, 238, .5); background: rgba(8, 145, 178, .28); }
  .btn.danger:hover { border-color: #fb7185; color: #fecdd3; }
  .btn:disabled { opacity: .42; cursor: not-allowed; transform: none; }
  .btn small { display: block; margin-top: 3px; color: #8aa8c4; font-size: 11px; }
  .btn.active small { color: #bff6ff; }
  .row { display: flex; gap: 8px; }
  .row .btn { flex: 1; text-align: center; }
  .mode-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .mode-grid .btn { text-align: center; padding: 9px 4px; }
  .switch {
    display: flex; align-items: center; gap: 10px;
    padding: 11px 12px; border: 1px solid rgba(148, 197, 255, .16);
    border-radius: 12px; background: rgba(15, 32, 56, .7);
    cursor: pointer; user-select: none; font-size: 13px;
  }
  .switch input { accent-color: #22d3ee; width: 16px; height: 16px; }
  .switch strong { display: block; font-size: 13px; }
  .switch span { display: block; color: #8aa8c4; font-size: 11px; margin-top: 2px; }
  .hint-list { margin: 0; padding-left: 18px; color: #9db8d2; font-size: 12px; line-height: 1.7; }
  kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 20px; padding: 1px 5px; border-radius: 5px;
    border: 1px solid rgba(148, 197, 255, .28); border-bottom-width: 2px;
    background: #10233d; color: #cffafe; font-size: 11px;
  }
  .stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #07111f; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; touch-action: none; }
  #annoSvg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3; overflow: visible; }
  #labelLayer { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
  .anno-label {
    position: absolute; top: 0; left: 0;
    display: grid; gap: 1px;
    min-width: 126px; max-width: 190px;
    padding: 7px 9px;
    border: 1px solid rgba(103, 232, 249, .4);
    border-left-width: 3px;
    border-radius: 10px;
    background: rgba(4, 13, 27, .86);
    box-shadow: 0 10px 30px rgba(0, 0, 0, .34);
    backdrop-filter: blur(8px);
    color: #eaffff;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
  }
  .anno-label strong { color: #cffafe; font-size: 11px; font-weight: 700; }
  .anno-label b { font-size: 15px; color: #fff; }
  .anno-label span { color: #8aa8c4; font-size: 10px; }
  .context-handle {
    position: absolute; z-index: 6; top: 0; left: 0;
    display: none;
    transform: translate(-50%, -100%);
    padding: 7px;
    border-radius: 14px;
    border: 1px solid rgba(103, 232, 249, .35);
    background: rgba(4, 13, 27, .88);
    box-shadow: 0 16px 42px rgba(0, 0, 0, .42), 0 0 24px rgba(34, 211, 238, .12);
    backdrop-filter: blur(10px);
    pointer-events: auto;
    white-space: nowrap;
  }
  .context-handle.visible { display: block; }
  .context-title { padding: 2px 7px 7px; font-size: 12px; font-weight: 700; color: #a5f3fc; }
  .context-actions { display: flex; gap: 5px; }
  .context-actions .btn { min-height: 30px; padding: 5px 9px; font-size: 12px; border-radius: 8px; }
  .clip-badge {
    position: absolute; z-index: 5; left: 50%; bottom: 18px;
    transform: translateX(-50%);
    display: flex; gap: 10px; align-items: center;
    max-width: calc(100% - 32px);
    padding: 9px 13px;
    border-radius: 999px;
    border: 1px solid rgba(103, 232, 249, .24);
    background: rgba(4, 13, 27, .78);
    color: #cffafe; font-size: 12px;
    backdrop-filter: blur(10px);
    pointer-events: none;
  }
  .clip-badge .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 12px #22c55e; }
  .clip-badge.warning { border-color: rgba(251, 191, 36, .55); color: #fde68a; }
  .clip-badge.warning .status-dot { background: #f59e0b; box-shadow: 0 0 12px #f59e0b; }
  .toast {
    position: absolute; z-index: 10; top: 18px; left: 50%;
    width: min(460px, calc(100% - 32px));
    transform: translate(-50%, -12px);
    opacity: 0; pointer-events: none;
    padding: 11px 14px;
    border-radius: 13px;
    border: 1px solid rgba(103, 232, 249, .28);
    background: rgba(4, 13, 27, .92);
    box-shadow: 0 18px 50px rgba(0, 0, 0, .45);
    color: #e0f2fe; font-size: 13px; line-height: 1.45;
    transition: opacity .18s ease, transform .18s ease;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .toast.success { border-color: rgba(34, 197, 94, .45); }
  .toast.warning { border-color: rgba(245, 158, 11, .55); color: #fef3c7; }
  .measure-list { display: grid; gap: 8px; }
  .measure-empty {
    padding: 16px 12px; border: 1px dashed rgba(148, 197, 255, .22);
    border-radius: 12px; color: #7895b2; font-size: 12px; line-height: 1.6; text-align: center;
  }
  .measure-item {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center;
    padding: 10px; border-radius: 12px;
    border: 1px solid rgba(148, 197, 255, .15);
    background: rgba(15, 32, 56, .66);
  }
  .measure-main { min-width: 0; }
  .measure-title { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #bcd7ef; }
  .measure-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
  .measure-value { display: block; margin-top: 4px; font-size: 16px; font-weight: 800; color: #fff; }
  .measure-meta { display: block; margin-top: 2px; color: #7895b2; font-size: 11px; }
  .icon-btn {
    width: 30px; height: 30px; border-radius: 9px; padding: 0; text-align: center;
    border: 1px solid rgba(251, 113, 133, .28); background: rgba(136, 19, 55, .18); color: #fda4af;
    cursor: pointer;
  }
  .icon-btn:hover { background: rgba(190, 18, 60, .35); }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .stat { padding: 10px; border-radius: 12px; background: rgba(15, 32, 56, .68); border: 1px solid rgba(148, 197, 255, .13); }
  .stat b { display: block; font-size: 18px; color: #67e8f9; }
  .stat span { color: #8aa8c4; font-size: 11px; }
  .footer-note { margin-top: 16px; padding: 11px; border-radius: 12px; background: rgba(8, 47, 73, .35); color: #9cc7df; font-size: 11px; line-height: 1.6; }
  @media (max-width: 1180px) {
    .app { grid-template-columns: 250px minmax(0, 1fr); }
    .panel--right { grid-column: 1 / -1; max-height: 220px; border-left: 0; border-top: 1px solid rgba(125, 211, 252, .14); }
  }
  @media (max-width: 760px) {
    .app { display: block; overflow: auto; }
    .stage { height: 62vh; }
    .panel { overflow: visible; }
    .panel--right { max-height: none; }
  }
</style>
<div class="app">
  <aside class="panel panel--left">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true"></div>
      <div>
        <h1>晶状体剖切测量系统</h1>
        <p class="subtitle">Native TypeScript · Web Components · Babylon.js</p>
      </div>
    </div>

    <h2>交互工具</h2>
    <div class="tool-grid">
      <button class="btn active" data-tool="select">选择 / 手柄<small>点晶状体、角膜</small></button>
      <button class="btn" data-tool="clip">剖切拖动<small>实时断面与吸附</small></button>
      <button class="btn" data-tool="acd">前房深度<small>截面点 2 点</small></button>
      <button class="btn" data-tool="lensThickness">晶状体厚度<small>前后极 2 点</small></button>
      <button class="btn wide" data-tool="curvature">角膜曲率半径（3 点）<small>点后可拖回重放</small></button>
    </div>

    <h2>晶状体变换</h2>
    <div class="mode-grid">
      <button class="btn active" data-mode="position"><kbd>W</kbd><br>平移</button>
      <button class="btn" data-mode="rotation"><kbd>E</kbd><br>旋转</button>
      <button class="btn" data-mode="scaling"><kbd>R</kbd><br>缩放</button>
    </div>

    <h2>剖切与吸附</h2>
    <div class="tool-grid">
      <button class="btn primary" id="clipToggle">隐藏剖切面</button>
      <button class="btn primary active" id="snapToggle"><kbd>S</kbd> 吸附：开</button>
    </div>

    <h2>场景层</h2>
    <label class="switch" style="margin-top:8px">
      <input type="checkbox" id="microToggle" checked>
      <span><strong>解剖微结构整体开关</strong><span id="microCount">4200 个实例 · 关闭后不可拾取</span></span>
    </label>

    <h2>历史 / 视图</h2>
    <div class="row">
      <button class="btn" id="undoBtn">↶ 撤销</button>
      <button class="btn" id="redoBtn">↷ 重做</button>
      <button class="btn" id="resetViewBtn">视角复位</button>
    </div>

    <h2>操作要点</h2>
    <ul class="hint-list">
      <li>左键拖动旋转视角，滚轮缩放，右键平移。</li>
      <li>选中结构后高亮；晶状体显示 Babylon 变换手柄。</li>
      <li>平移晶状体靠近角膜会吸到后表面，按住 <kbd>Shift</kbd> 临时自由。</li>
      <li>剖切工具中拖动青色球移动切面，橙色球旋转方向。</li>
      <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销，<kbd>Ctrl</kbd>+<kbd>Y</kbd> 或 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 重做。</li>
    </ul>
  </aside>

  <main class="stage" id="stage">
    <canvas id="babylonCanvas" aria-label="眼球三维剖切测量场景"></canvas>
    <svg id="annoSvg"></svg>
    <div id="labelLayer"></div>

    <div class="context-handle" id="contextHandle">
      <div class="context-title" id="contextTitle">已选择</div>
      <div class="context-actions" id="contextActions"></div>
    </div>

    <div class="clip-badge" id="clipBadge">
      <span class="status-dot"></span>
      <span id="clipBadgeText">轴向纵切面 x = 0.0 mm</span>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </main>

  <aside class="panel panel--right">
    <h2>测量标注</h2>
    <div class="measure-list" id="measureList"></div>
    <div class="row" style="margin-top:10px">
      <button class="btn danger" id="clearMeasuresBtn">清空测量</button>
    </div>

    <h2>当前场景</h2>
    <div class="stat-grid">
      <div class="stat"><b id="statMeasureCount">0</b><span>测量记录</span></div>
      <div class="stat"><b id="statMicroCount">4200</b><span>微结构实例</span></div>
      <div class="stat"><b id="statClipOffset">0.0</b><span>切面偏移 mm</span></div>
      <div class="stat"><b id="statClipYaw">0.0°</b><span>相对主轴偏转</span></div>
    </div>

    <h2>实现说明</h2>
    <div class="footer-note">
      模型为程序化眼球：巩膜开窗、角膜球冠、双凸椭球晶状体、虹膜/睫状体和 <b>4200</b> 个 ThinInstance 微结构。
      断面琥珀色填充由椭球-平面求交实时生成；标注为 SVG/HTML 投影，因此旋转视角时数字始终面向屏幕。
    </div>
  </aside>
</template>`;

export class EyeWorkbenchElement extends HTMLElement {
  private lab: EyeLab | null = null;
  private overlay: AnnotationOverlay | null = null;
  private toastTimer: number | null = null;
  private frameId = 0;
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.lab) return;
    this.lab.setShiftPressed(event.shiftKey);
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      this.lab.undo();
    } else if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
      event.preventDefault();
      this.lab.redo();
    } else if (!event.ctrlKey && !event.metaKey && key === 'w') {
      this.lab.setTransformMode('position');
    } else if (!event.ctrlKey && !event.metaKey && key === 'e') {
      this.lab.setTransformMode('rotation');
    } else if (!event.ctrlKey && !event.metaKey && key === 'r') {
      this.lab.setTransformMode('scaling');
    } else if (!event.ctrlKey && !event.metaKey && key === 's') {
      event.preventDefault();
      this.lab.toggleClipSnap();
    } else if (key === 'escape') {
      this.lab.setTool('select');
    }
  };
  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.lab?.setShiftPressed(event.shiftKey);
  };
  private readonly handleWindowBlur = (): void => {
    this.lab?.setShiftPressed(false);
  };

  connectedCallback(): void {
    if (this.shadowRoot) return;
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.appendChild(TEMPLATE.content.cloneNode(true));

    const canvas = this.querySelectorShadow<HTMLCanvasElement>('#babylonCanvas');
    const svg = this.querySelectorShadow<SVGSVGElement>('#annoSvg');
    const labelLayer = this.querySelectorShadow<HTMLElement>('#labelLayer');

    this.lab = new EyeLab(canvas, {
      onHint: (hint) => this.showToast(hint.text, hint.tone),
      onSelectionChange: () => this.syncUi(),
    });
    this.overlay = new AnnotationOverlay(this.lab, svg, labelLayer);
    (window as unknown as { __eyeLab?: EyeLab }).__eyeLab = this.lab;
    this.lab.subscribe(() => this.syncUi());

    this.bindControls();
    this.bindKeyboard();
    this.syncUi();
    this.startFrameLoop();
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.overlay?.dispose();
    this.lab?.dispose();
    this.lab = null;
  }

  private querySelectorShadow<T extends Element>(selector: string): T {
    const element = this.shadowRoot?.querySelector<T>(selector);
    if (!element) throw new Error(`Missing required element: ${selector}`);
    return element;
  }

  private bindControls(): void {
    const root = this.shadowRoot;
    if (!root || !this.lab) return;

    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => this.lab?.setTool(button.dataset.tool as ToolId));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.lab?.setTransformMode(button.dataset.mode as TransformMode));
    });

    this.querySelectorShadow<HTMLButtonElement>('#undoBtn').addEventListener('click', () => this.lab?.undo());
    this.querySelectorShadow<HTMLButtonElement>('#redoBtn').addEventListener('click', () => this.lab?.redo());
    this.querySelectorShadow<HTMLButtonElement>('#resetViewBtn').addEventListener('click', () => this.lab?.resetView());
    this.querySelectorShadow<HTMLButtonElement>('#snapToggle').addEventListener('click', () => this.lab?.toggleClipSnap());
    this.querySelectorShadow<HTMLButtonElement>('#clipToggle').addEventListener('click', () => {
      if (!this.lab) return;
      this.lab.setClipEnabled(!this.lab.state.clip.enabled);
    });
    this.querySelectorShadow<HTMLButtonElement>('#clearMeasuresBtn').addEventListener('click', () => this.lab?.clearMeasurements());
    this.querySelectorShadow<HTMLInputElement>('#microToggle').addEventListener('change', (event) => {
      this.lab?.setMicroVisible((event.target as HTMLInputElement).checked);
    });

    this.querySelectorShadow<HTMLElement>('#measureList').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete]');
      const id = button?.dataset.delete;
      if (id) this.lab?.deleteMeasurement(id);
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  private startFrameLoop(): void {
    const context = this.querySelectorShadow<HTMLElement>('#contextHandle');
    const update = () => {
      this.updateContextHandle(context);
      this.updateClipBadge();
      this.frameId = requestAnimationFrame(update);
    };
    this.frameId = requestAnimationFrame(update);
  }

  private updateContextHandle(handle: HTMLElement): void {
    if (!this.lab) return;
    const visible = this.lab.tool === 'select' && this.lab.selection !== null;
    handle.classList.toggle('visible', visible);
    if (!visible) return;

    const anchor = this.lab.getSelectionAnchor();
    const p = this.lab.project(anchor);
    handle.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    handle.style.opacity = p.visible ? '1' : '0';
    handle.style.pointerEvents = p.visible ? 'auto' : 'none';

    const title = this.querySelectorShadow<HTMLElement>('#contextTitle');
    const actions = this.querySelectorShadow<HTMLElement>('#contextActions');
    if (this.lab.selection === 'lens') {
      title.textContent = '晶状体已选中 · 拖手柄变换';
      if (actions.dataset.kind !== 'lens') {
        actions.dataset.kind = 'lens';
        actions.innerHTML = `
          <button class="btn" data-context-mode="position">移动</button>
          <button class="btn" data-context-mode="rotation">旋转</button>
          <button class="btn" data-context-mode="scaling">缩放</button>`;
        actions.querySelectorAll('[data-context-mode]').forEach((button) => {
          button.addEventListener('click', () => {
            this.lab?.setTransformMode((button as HTMLElement).dataset.contextMode as TransformMode);
          });
        });
      }
    } else {
      title.textContent = '角膜已选中 · 可测曲率';
      if (actions.dataset.kind !== 'cornea') {
        actions.dataset.kind = 'cornea';
        actions.innerHTML = `<button class="btn primary" id="contextCurvature">三点测曲率</button>`;
        actions.querySelector('#contextCurvature')?.addEventListener('click', () => this.lab?.startCurvatureFromSelection());
      }
    }
  }

  private updateClipBadge(): void {
    if (!this.lab) return;
    const clip = this.lab.state.clip;
    const badge = this.querySelectorShadow<HTMLElement>('#clipBadge');
    const text = this.querySelectorShadow<HTMLElement>('#clipBadgeText');
    const drift = Math.abs((clip.yaw - Math.PI / 2) * 180 / Math.PI);
    badge.classList.toggle('warning', drift > 13.2);
    if (!clip.enabled) {
      text.textContent = '剖切面已隐藏';
    } else {
      const snap = clip.snap ? (clip.snappedKey ? ` · 🧲 ${clip.snappedKey}` : ' · 吸附待命') : ' · 自由模式';
      text.textContent = `轴向纵切面 x/n = ${clip.offset.toFixed(1)} mm · 偏转 ${drift.toFixed(1)}°${snap}`;
    }
  }

  private showToast(text: string, tone: 'info' | 'success' | 'warning'): void {
    const toast = this.querySelectorShadow<HTMLElement>('#toast');
    toast.textContent = text;
    toast.className = `toast show ${tone}`;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.classList.remove('show');
    }, 2600);
  }

  private syncUi(): void {
    if (!this.lab || !this.shadowRoot) return;
    const info = this.lab.getUiInfo();
    const state = this.lab.state;
    const root = this.shadowRoot;

    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === info.tool);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === info.transformMode);
    });

    const undo = this.querySelectorShadow<HTMLButtonElement>('#undoBtn');
    const redo = this.querySelectorShadow<HTMLButtonElement>('#redoBtn');
    undo.disabled = !info.canUndo;
    redo.disabled = !info.canRedo;
    undo.title = info.undoLabel ? `撤销：${info.undoLabel}` : '没有可撤销操作';
    redo.title = info.redoLabel ? `重做：${info.redoLabel}` : '没有可重做操作';

    const snap = this.querySelectorShadow<HTMLButtonElement>('#snapToggle');
    snap.classList.toggle('active', state.clip.snap);
    snap.textContent = state.clip.snap ? '吸附：开 (S)' : '自由模式 (S)';

    const clipToggle = this.querySelectorShadow<HTMLButtonElement>('#clipToggle');
    clipToggle.classList.toggle('active', state.clip.enabled);
    clipToggle.textContent = state.clip.enabled ? '隐藏剖切面' : '显示剖切面';

    const micro = this.querySelectorShadow<HTMLInputElement>('#microToggle');
    micro.checked = state.microVisible;

    this.querySelectorShadow<HTMLElement>('#statMeasureCount').textContent = String(state.measurements.length);
    this.querySelectorShadow<HTMLElement>('#statMicroCount').textContent = '4200';
    this.querySelectorShadow<HTMLElement>('#statClipOffset').textContent = state.clip.offset.toFixed(1);
    const drift = Math.abs((state.clip.yaw - Math.PI / 2) * 180 / Math.PI);
    this.querySelectorShadow<HTMLElement>('#statClipYaw').textContent = `${drift.toFixed(1)}°`;

    this.renderMeasurements(state.measurements);
  }

  private renderMeasurements(measurements: Measurement[]): void {
    const list = this.querySelectorShadow<HTMLElement>('#measureList');
    if (!measurements.length) {
      list.innerHTML = `<div class="measure-empty">还没有测量。<br>选择左侧“前房深度 / 晶状体厚度 / 角膜曲率”开始。截面点和曲率点之后都可以直接拖动。</div>`;
      return;
    }

    list.innerHTML = measurements
      .map((m) => {
        const color = m.kind === 'acd' ? '#67e8f9' : m.kind === 'lensThickness' ? '#fbbf24' : '#c4b5fd';
        const title = m.kind === 'acd' ? '前房深度' : m.kind === 'lensThickness' ? '晶状体厚度' : '角膜曲率半径';
        let value = '进行中…';
        let meta = `${m.points.length}/${m.kind === 'curvature' ? 3 : 2} 点`;
        if (m.kind === 'curvature' && m.points.length === 3) {
          const pts = m.points.map((p) => resolvePoint(p, this.lab!.state));
          const circle = m.radius ? { radius: m.radius } : null;
          value = circle ? `R ${formatMm(m.radius)}` : '三点近共线';
          meta = circle ? `直径 ${formatMm((m.radius ?? 0) * 2)}` : '请拖动一点';
        } else if (m.kind !== 'curvature' && m.points.length >= 2) {
          const pts = m.points.map((p) => resolvePoint(p, this.lab!.state));
          const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
          value = formatMm(d);
          meta = '两点距离 · 锚点随模型';
        }
        return `
          <div class="measure-item">
            <div class="measure-main">
              <div class="measure-title"><span class="measure-dot" style="background:${color};box-shadow:0 0 10px ${color}"></span>${title}</div>
              <span class="measure-value">${value}</span>
              <span class="measure-meta">${meta}</span>
            </div>
            <button class="icon-btn" data-delete="${m.id}" title="删除此测量" aria-label="删除测量">✕</button>
          </div>`;
      })
      .join('');
  }
}

if (!customElements.get('eye-workbench')) {
  customElements.define('eye-workbench', EyeWorkbenchElement);
}
