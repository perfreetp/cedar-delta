import { sharedCss } from './styles';
import { getStore, whenStoreReady } from '../core/registry';

/**
 * 顶部工具栏：JSON 导入/导出、独奏状态显示、时间线长度、新建空白文档。
 * 导出文件包含完整层级与关键帧数据；导入经 validateDocument 校验后完全还原。
 */
export class CrToolbar extends HTMLElement {
  private root: ShadowRoot;
  private fileInput: HTMLInputElement;
  private soloLabel: HTMLSpanElement;
  private subscribed = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${sharedCss}
      :host { display:block; background:var(--bg-1); border-bottom:1px solid var(--line); }
      .bar { display:flex; align-items:center; gap:10px; padding:8px 14px; }
      .brand { font-weight:700; letter-spacing:.05em; color:var(--text-0); display:flex; align-items:center; gap:8px; }
      .dot { width:10px; height:10px; border-radius:50%; background:linear-gradient(135deg,var(--accent),var(--accent-2)); }
      .spacer { flex:1; }
      .solo { color:var(--ok); font-size:12px; }
      input[type=file] { display:none; }
    </style>`;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `
      <div class="brand"><span class="dot"></span>陨石撞击展陈 · 时间轴编排</div>
      <span class="spacer"></span>
      <span class="solo" data-role="solo"></span>
      <button data-act="new">新建空白</button>
      <button data-act="export" class="primary">导出 JSON</button>
      <button data-act="import">导入 JSON</button>`;
    this.root.appendChild(bar);
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.root.appendChild(this.fileInput);
    this.soloLabel = bar.querySelector('[data-role=solo]')!;

    bar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
      if (!btn) return;
      if (btn.dataset.act === 'export') this.exportFile();
      if (btn.dataset.act === 'import') this.fileInput.click();
      if (btn.dataset.act === 'new') this.newDoc();
    });
    this.fileInput.addEventListener('change', () => this.importFile());
  }

  connectedCallback() {
    whenStoreReady((store) => {
      if (!this.subscribed) {
        this.subscribed = true;
        store.subscribe((ev) => {
          if (ev === 'doc-change') this.refreshSolo();
        });
      }
      this.refreshSolo();
    });
  }

  private refreshSolo() {
    const store = getStore();
    this.soloLabel.textContent = store.soloTrackId
      ? `独奏中：${store.findTrackOrThrow(store.soloTrackId).name}（点击「独」按钮可取消）`
      : '';
  }

  private exportFile() {
    const store = getStore();
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crater-timeline-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async importFile() {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      getStore().loadJSON(text);
      alert('导入成功：轨道层级、关键帧时间与插值曲线已完全还原');
    } catch (err) {
      alert(`导入失败：${(err as Error).message}`);
    }
  }

  private newDoc() {
    if (!confirm('新建空白时间线？当前未导出的修改将丢失。')) return;
    getStore().loadJSON(JSON.stringify({ version: 1, duration: 10, tracks: [] }));
  }
}

customElements.define('cr-toolbar', CrToolbar);
