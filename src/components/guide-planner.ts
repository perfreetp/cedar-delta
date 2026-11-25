/**
 * <guide-planner> 自定义元素：封装画布、工具栏、状态栏与框选覆盖层。
 * 纯原生 Web Component（Custom Elements + Shadow DOM），无框架依赖。
 */
import { ViewerApp } from '../engine/ViewerApp';
import type { ClipState } from '../core/types';

const STYLES = /* css */ `
:host {
  display: block;
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #0d1015;
  color: #e6ebf2;
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  --accent: #4ea1ff;
}
.viewport { position: absolute; inset: 0; }
.viewport canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
.viewport canvas:active { cursor: grabbing; }

.toolbar {
  position: absolute; top: 12px; left: 12px;
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 8px;
  background: rgba(18, 23, 32, 0.82);
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 10px;
  backdrop-filter: blur(8px);
  max-width: calc(100% - 48px);
  z-index: 5;
}
.group { display: flex; gap: 4px; align-items: center; padding: 0 6px; border-right: 1px solid rgba(255,255,255,0.12); }
.group:last-child { border-right: none; }
button {
  appearance: none; border: 1px solid rgba(140,170,220,0.3);
  background: rgba(60, 78, 105, 0.6); color: #e6ebf2;
  padding: 6px 10px; border-radius: 7px; font-size: 13px; cursor: pointer;
  transition: background .15s, border-color .15s; white-space: nowrap;
}
button:hover:not(:disabled) { background: rgba(86, 120, 165, 0.85); border-color: var(--accent); }
button.active { background: var(--accent); border-color: var(--accent); color: #06101f; font-weight: 600; }
button:disabled { opacity: .38; cursor: not-allowed; }
label.title { font-size: 12px; color: #9fb4d0; margin-right: 2px; }

.statusbar {
  position: absolute; left: 12px; right: 12px; bottom: 12px;
  display: flex; gap: 18px; flex-wrap: wrap;
  padding: 8px 14px;
  background: rgba(18, 23, 32, 0.82);
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 10px;
  font-size: 12.5px; z-index: 5;
  backdrop-filter: blur(8px);
}
.statusbar .item b { color: var(--accent); font-weight: 600; }
.statusbar .hint { color: #a9bdd6; flex: 1; min-width: 200px; }

.help {
  position: absolute; right: 12px; top: 12px; z-index: 5;
  background: rgba(18,23,32,.82); border: 1px solid rgba(120,160,220,.25);
  border-radius: 10px; padding: 10px 12px; font-size: 11.5px; line-height: 1.7;
  color: #9fb4d0; max-width: 230px;
}
.help b { color: #dbe6f5; }

.marquee {
  position: absolute; border: 1.5px solid var(--accent);
  background: rgba(78, 161, 255, 0.14);
  pointer-events: none; z-index: 4; border-radius: 2px;
}
.badge {
  position: absolute; z-index: 5; padding: 4px 10px; border-radius: 20px;
  background: rgba(78,161,255,.9); color: #06101f; font-size: 12px; font-weight: 600;
  opacity: 0; transform: translateY(8px); transition: opacity .2s, transform .2s;
  pointer-events: none;
}
.badge.show { opacity: 1; transform: translateY(0); }
`;

export class GuidePlannerElement extends HTMLElement {
  /** 只读访问器：供自动化验证与外部集成使用 */
  get api(): ViewerApp | null {
    return this.viewer;
  }

  private viewer: ViewerApp | null = null;
  private marquee: HTMLDivElement | null = null;
  private btnUndo!: HTMLButtonElement;
  private btnRedo!: HTMLButtonElement;
  private modeButtons: HTMLButtonElement[] = [];

  connectedCallback(): void {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLES}</style>${this.template()}`;
    const canvas = root.querySelector('canvas')!;
    this.marquee = root.querySelector('.marquee');
    this.marquee!.style.display = 'none';

    this.viewer = new ViewerApp(canvas, {
      onSelectionChange: (ids) => this.updateSelection(ids),
      onHistoryChange: (canUndo, canRedo) => this.updateHistory(canUndo, canRedo),
      onSnapChange: (n) => this.setText('snap', `吸附套管 <b>${n}</b>`),
      onClipChange: (clip) => this.updateClip(clip),
      onMarquee: (rect) => this.updateMarquee(rect),
      onStatus: (text) => this.flashHint(text),
    });

    this.wireControls(root);
    this.bindKeys();
    this.updateHistory(false, false);
    this.updateClip({ enabled: false, normal: [1, 0, 0], distance: 0 });
  }

  disconnectedCallback(): void {
    this.viewer?.destroy();
    this.viewer = null;
    window.removeEventListener('keydown', this.onKey);
  }

  private template(): string {
    return `
      <div class="viewport"><canvas></canvas></div>
      <div class="toolbar">
        <div class="group">
          <label class="title">手柄</label>
          <button data-act="mode-translate" class="active">平移</button>
          <button data-act="mode-rotate">旋转</button>
        </div>
        <div class="group">
          <button data-act="align">对齐·等距</button>
          <button data-act="frame">聚焦</button>
        </div>
        <div class="group">
          <label class="title">剖切</label>
          <button data-act="clip-toggle">开启剖切</button>
          <button data-act="clip-sagittal" class="active">矢状</button>
          <button data-act="clip-coronal">冠状</button>
          <button data-act="clip-axial">水平</button>
          <button data-act="clip-minus">−</button>
          <button data-act="clip-plus">＋</button>
        </div>
        <div class="group">
          <button data-act="undo" disabled>撤销</button>
          <button data-act="redo" disabled>重做</button>
        </div>
      </div>
      <div class="help">
        <b>操作指引</b><br/>
        左键拖空白：框选套管<br/>
        点套管：选中（Shift 追加）<br/>
        拖彩色轴/环：移动/旋转<br/>
        靠近牙面：自动吸附·弹回<br/>
        右键/Alt+拖：转视角 · 滚轮缩放<br/>
        Ctrl+Z 撤销 · Ctrl+Y 重做
      </div>
      <div class="statusbar">
        <span class="item" data-k="sel">选中 <b>0</b></span>
        <span class="item" data-k="snap">吸附套管 <b>0</b></span>
        <span class="item" data-k="clip">剖切 <b>关</b></span>
        <span class="hint" data-k="hint">就绪：点选或框选套管开始布置</span>
      </div>
      <div class="marquee"></div>
      <div class="badge" data-k="badge"></div>
    `;
  }

  private wireControls(root: ShadowRoot): void {
    this.btnUndo = root.querySelector('[data-act="undo"]')!;
    this.btnRedo = root.querySelector('[data-act="redo"]')!;
    this.modeButtons = [
      root.querySelector('[data-act="mode-translate"]')!,
      root.querySelector('[data-act="mode-rotate"]')!,
    ];
    root.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => this.onAction((btn as HTMLElement).dataset.act!));
    });
  }

  private onAction(act: string): void {
    const v = this.viewer!;
    switch (act) {
      case 'mode-translate':
        v.setGizmoMode('translate');
        this.setActiveMode(0);
        break;
      case 'mode-rotate':
        v.setGizmoMode('rotate');
        this.setActiveMode(1);
        break;
      case 'align':
        v.alignSelected();
        break;
      case 'frame':
        v.frameSelection();
        break;
      case 'clip-toggle':
        this.toggleClip();
        break;
      case 'clip-sagittal':
        v.setClipPreset('sagittal');
        this.setActiveClipPreset(act);
        break;
      case 'clip-coronal':
        v.setClipPreset('coronal');
        this.setActiveClipPreset(act);
        break;
      case 'clip-axial':
        v.setClipPreset('axial');
        this.setActiveClipPreset(act);
        break;
      case 'clip-minus':
        v.nudgeClip(-4);
        break;
      case 'clip-plus':
        v.nudgeClip(4);
        break;
      case 'undo':
        v.undo();
        break;
      case 'redo':
        v.redo();
        break;
    }
  }

  private toggleClip(): void {
    const btn = this.shadowRoot!.querySelector('[data-act="clip-toggle"]') as HTMLButtonElement;
    const turningOn = btn.textContent === '开启剖切';
    this.viewer!.setClipEnabled(turningOn);
    btn.textContent = turningOn ? '关闭剖切' : '开启剖切';
    btn.classList.toggle('active', turningOn);
  }

  private setActiveMode(index: number): void {
    this.modeButtons.forEach((b, i) => b.classList.toggle('active', i === index));
  }

  private setActiveClipPreset(act: string): void {
    this.shadowRoot!.querySelectorAll('[data-act^="clip-"]').forEach((b) => {
      const el = b as HTMLElement;
      if (['clip-sagittal', 'clip-coronal', 'clip-axial'].includes(el.dataset.act!)) {
        el.classList.toggle('active', el.dataset.act === act);
      }
    });
  }

  private bindKeys(): void {
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    const v = this.viewer;
    if (!v) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      v.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      v.redo();
    } else if (e.key === 'q') {
      v.setGizmoMode('translate');
      this.setActiveMode(0);
    } else if (e.key === 'w') {
      v.setGizmoMode('rotate');
      this.setActiveMode(1);
    } else if (e.key === 'Escape') {
      v.clearSelection();
    }
  };

  private updateSelection(ids: number[]): void {
    this.setText('sel', `选中 <b>${ids.length}</b>`);
    if (ids.length > 0) this.flashHint(`已选 ${ids.length} 颗套管（ID: ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? '…' : ''}）`);
  }

  private updateHistory(canUndo: boolean, canRedo: boolean): void {
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;
  }

  private updateClip(clip: ClipState): void {
    const label = clip.enabled
      ? `剖切 <b>开</b> · d=${clip.distance.toFixed(1)}mm`
      : '剖切 <b>关</b>';
    this.setText('clip', label);
  }

  private updateMarquee(rect: { x: number; y: number; w: number; h: number } | null): void {
    if (!rect) {
      this.marquee!.style.display = 'none';
      return;
    }
    const m = this.marquee!;
    m.style.display = 'block';
    m.style.left = `${rect.x}px`;
    m.style.top = `${rect.y}px`;
    m.style.width = `${rect.w}px`;
    m.style.height = `${rect.h}px`;
  }

  private setText(key: string, html: string): void {
    const el = this.shadowRoot?.querySelector(`[data-k="${key}"]`);
    if (el) el.innerHTML = html;
  }

  private flashHint(text: string): void {
    this.setText('hint', text);
    const badge = this.shadowRoot?.querySelector('[data-k="badge"]') as HTMLElement | null;
    if (badge) {
      badge.textContent = text;
      badge.style.left = '50%';
      badge.style.top = '64px';
      badge.style.transform = 'translateX(-50%) translateY(0)';
      badge.classList.add('show');
      window.setTimeout(() => badge.classList.remove('show'), 1600);
    }
  }
}
