import { sharedCss } from './styles';
import { CraterScene } from '../scene/scene';
import { getStore, setPlayback, setScene, whenStoreReady } from '../core/registry';
import { PlaybackController } from '../core/playback';
import './cr-toolbar';
import './cr-timeline';
import './cr-inspector';

/**
 * 应用外壳：左 3D 视口、右检查器、底部时间轴。
 * 负责装配 Babylon 场景、仓库、播放控制器三者，并处理窗口缩放与文档变更后的即时重渲染。
 */
export class CrApp extends HTMLElement {
  private root: ShadowRoot;
  private canvas!: HTMLCanvasElement;
  private scene!: CraterScene;
  private playback!: PlaybackController;
  private resizeObs!: ResizeObserver;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${sharedCss}
      :host { display:block; width:100vw; height:100vh; background:var(--bg-0); }
      .layout { display:grid; grid-template-rows:auto 1fr 320px; height:100%; }
      .mid { display:grid; grid-template-columns:1fr 320px; min-height:0; }
      .viewport { position:relative; min-width:0; background:#05080f; }
      canvas { width:100%; height:100%; display:block; outline:none; }
      .viewport .badge {
        position:absolute; left:12px; bottom:10px; background:rgba(10,16,30,.72);
        border:1px solid var(--line); border-radius:8px; padding:6px 10px; color:var(--text-1); font-size:12px;
      }
      cr-inspector { border-left:1px solid var(--line); min-height:0; }
      cr-timeline { min-height:0; }
    </style>`;
    const layout = document.createElement('div');
    layout.className = 'layout';
    layout.innerHTML = `
      <cr-toolbar></cr-toolbar>
      <div class="mid">
        <div class="viewport" data-role="vp">
          <canvas data-role="canvas"></canvas>
          <div class="badge">鼠标左键旋转 · 右键平移 · 滚轮缩放（相机动画播放时仍以时间轴关键帧为准）</div>
        </div>
        <cr-inspector></cr-inspector>
      </div>
      <cr-timeline></cr-timeline>`;
    this.root.appendChild(layout);
  }

  connectedCallback() {
    whenStoreReady(() => this.bootstrap());
  }

  private bootstrap() {
    if (this.playback) return; // 防止重复初始化
    this.canvas = this.root.querySelector('[data-role=canvas]')!;
    // registry 由 main.ts 注入 store；此处补建场景与播放控制器
    this.scene = new CraterScene(this.canvas);
    setScene(this.scene);
    this.playback = new PlaybackController(getStore(), this.scene);
    setPlayback(this.playback);

    // 调试/自动化测试句柄
    const w = window as unknown as { __scene: CraterScene; __playback: PlaybackController };
    w.__scene = this.scene;
    w.__playback = this.playback;

    // 文档任何变更（编辑关键帧、改父轨缓动、静音等）都立即按当前播放头重渲染，
    // 保证暂停编辑时所见即所得，且与再次播放的结果走同一评测函数。
    const store = getStore();
    store.subscribe((ev) => {
      if (ev === 'doc-change') this.playback.refresh();
    });

    const vp = this.root.querySelector('[data-role=vp]')!;
    this.resizeObs = new ResizeObserver(() => this.scene.resize());
    this.resizeObs.observe(vp);

    // 空格键播放/暂停
    window.addEventListener('keydown', this.onKey);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.onKey);
    this.resizeObs?.disconnect();
    this.playback?.dispose();
    this.scene?.dispose();
  }

  private onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.playback.togglePlay();
    }
  };
}

customElements.define('cr-app', CrApp);
