import { sharedCss } from './styles';
import type { EasingType, LeafTrack } from '../core/model';
import { isGroup } from '../core/model';
import { getStore, whenStoreReady } from '../core/registry';
import { EASING_LABELS } from '../core/easing';

/**
 * 检查器：编辑选中轨道与选中关键帧的参数。
 * 轨道级：名称、时间区间、默认插值、静音；
 * 关键帧级：各类型专属数值 + 关键帧单独插值（可覆盖轨道默认值）。
 */
export class CrInspector extends HTMLElement {
  private root: ShadowRoot;
  private body: HTMLDivElement;
  private selectedKf: string | null = null;
  private subscribed = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${sharedCss}
      :host { display:block; height:100%; overflow-y:auto; background:var(--bg-1); }
      .panel { padding:12px; display:flex; flex-direction:column; gap:14px; }
      h3 { margin:0; font-size:13px; color:var(--text-1); text-transform:uppercase; letter-spacing:.08em; }
      .field { display:flex; flex-direction:column; gap:4px; }
      .field label { font-size:11px; color:var(--text-2); }
      .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .kf-list { display:flex; flex-direction:column; gap:4px; }
      .kf-item { display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border:1px solid var(--line); border-radius:6px; cursor:pointer; background:var(--bg-2); }
      .kf-item.sel { border-color:var(--accent); }
      .empty { color:var(--text-2); font-size:12px; padding:20px 4px; text-align:center; }
      hr { border:none; border-top:1px solid var(--line); margin:2px 0; }
    </style>`;
    this.body = document.createElement('div');
    this.body.className = 'panel';
    this.root.appendChild(this.body);

    this.addEventListener('keyframe-select', ((e: CustomEvent) => {
      this.selectedKf = e.detail.keyframeId;
      this.render();
    }) as EventListener);
  }

  connectedCallback() {
    whenStoreReady((store) => {
      if (!this.subscribed) {
        this.subscribed = true;
        store.subscribe((ev) => {
          if (ev === 'doc-change' || ev === 'selection-change') this.render();
        });
      }
      this.render();
    });
  }

  private field(label: string, input: HTMLElement): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = label;
    wrap.append(lab, input);
    return wrap;
  }

  private numInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = String(step);
    inp.value = String(+value.toFixed(3));
    inp.addEventListener('change', () => onChange(Number(inp.value)));
    return inp;
  }

  private easingSelect(current: EasingType, onChange: (e: EasingType) => void): HTMLSelectElement {
    const sel = document.createElement('select');
    for (const key of ['linear', 'ease', 'step'] as EasingType[]) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = EASING_LABELS[key];
      if (key === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value as EasingType));
    return sel;
  }

  render() {
    const store = getStore();
    this.body.innerHTML = '';
    const trackId = store.selectedTrackId;
    if (!trackId) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '选择一条轨道以编辑参数';
      this.body.appendChild(empty);
      return;
    }
    const track = store.findTrackOrThrow(trackId);

    // ---- 轨道通用属性 ----
    const trackHead = document.createElement('h3');
    trackHead.textContent = '轨道属性';
    this.body.appendChild(trackHead);

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = track.name;
    nameInp.addEventListener('change', () => store.updateTrack(track.id, { name: nameInp.value }));
    this.body.appendChild(this.field('名称', nameInp));

    const timeGrid = document.createElement('div');
    timeGrid.className = 'grid2';
    timeGrid.appendChild(
      this.field('起始 (秒)', this.numInput(track.start, 0.1, (v) => store.updateTrack(track.id, { start: v }))),
    );
    timeGrid.appendChild(
      this.field('时长 (秒)', this.numInput(track.duration, 0.1, (v) => store.updateTrack(track.id, { duration: v }))),
    );
    this.body.appendChild(timeGrid);

    this.body.appendChild(this.field('默认插值（分组轨：作用于子轨时间重映射）', this.easingSelect(track.easing, (e) => store.updateTrack(track.id, { easing: e }))));

    const muteBtn = document.createElement('button');
    muteBtn.textContent = track.muted ? '取消静音' : '静音';
    if (track.muted) muteBtn.classList.add('active');
    muteBtn.addEventListener('click', () => store.toggleMute(track.id));
    this.body.appendChild(muteBtn);

    if (isGroup(track)) {
      const hint = document.createElement('div');
      hint.className = 'empty';
      hint.textContent = `分组轨，含 ${track.children.length} 条子轨。修改上方插值后，子轨关键帧的全局时间位置立即按新曲线重排。`;
      this.body.append(document.createElement('hr'), hint);
      return;
    }

    const leaf = track as LeafTrack;
    this.body.appendChild(document.createElement('hr'));

    // ---- 关键帧列表 ----
    const kfHead = document.createElement('h3');
    kfHead.textContent = `关键帧（${leaf.keyframes.length}）`;
    this.body.appendChild(kfHead);

    const addBtn = document.createElement('button');
    addBtn.textContent = '＋ 在播放头位置添加关键帧';
    addBtn.addEventListener('click', () => {
      const kf = store.addKeyframe(track.id, store.currentTime);
      this.selectedKf = kf.id;
      this.render();
    });
    this.body.appendChild(addBtn);

    const list = document.createElement('div');
    list.className = 'kf-list';
    const sorted = [...leaf.keyframes].sort((a, b) => a.time - b.time);
    for (const kf of sorted) {
      const item = document.createElement('div');
      item.className = 'kf-item' + (this.selectedKf === kf.id ? ' sel' : '');
      const info = document.createElement('span');
      const globalT = store.localToGlobal(track.id, kf.time);
      info.textContent = `局部 ${(kf.time * 100).toFixed(1)}% · ${globalT.toFixed(2)}s`;
      const actions = document.createElement('span');
      actions.className = 'row';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'icon';
      copyBtn.textContent = '复制';
      copyBtn.title = '复制到指定时间点（秒），默认当前播放头';
      copyBtn.addEventListener('click', () => {
        const answer = prompt('复制到哪个全局时间点（秒）？', store.currentTime.toFixed(2));
        if (answer === null) return;
        const t = Number(answer);
        if (Number.isFinite(t)) store.copyKeyframeAt(track.id, kf.id, t);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'icon';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => {
        store.deleteKeyframe(track.id, kf.id);
        if (this.selectedKf === kf.id) this.selectedKf = null;
      });
      actions.append(copyBtn, delBtn);
      item.append(info, actions);
      item.addEventListener('click', () => {
        this.selectedKf = kf.id;
        this.render();
      });
      list.appendChild(item);
    }
    this.body.appendChild(list);

    // ---- 选中关键帧详情 ----
    const kf = leaf.keyframes.find((k) => k.id === this.selectedKf);
    if (kf) {
      this.body.appendChild(document.createElement('hr'));
      const detailHead = document.createElement('h3');
      detailHead.textContent = '关键帧参数';
      this.body.appendChild(detailHead);

      const kfEasing = kf.easing ?? leaf.easing;
      const easingWrap = this.field(
        '插值（覆盖轨道默认）',
        this.easingSelect(kfEasing, (e) => store.updateKeyframe(track.id, kf.id, { easing: e })),
      );
      this.body.appendChild(easingWrap);
      const clearEaseBtn = document.createElement('button');
      clearEaseBtn.textContent = '恢复为轨道默认插值';
      clearEaseBtn.disabled = kf.easing === undefined;
      clearEaseBtn.addEventListener('click', () => {
        // 传 undefined 需绕过 Record<string, number>，直接操作
        delete kf.easing;
        store.updateKeyframe(track.id, kf.id, {});
      });
      this.body.appendChild(clearEaseBtn);

      const num = (label: string, key: string, value: number, step = 0.1) =>
        this.field(label, this.numInput(value, step, (v) => store.updateKeyframe(track.id, kf.id, { [key]: v })));

      const grid = document.createElement('div');
      grid.className = 'grid2';
      if (leaf.kind === 'camera') {
        const camKf = kf as import('../core/model').CameraKeyframe;
        grid.appendChild(num('半径', 'radius', camKf.radius, 0.5));
        grid.appendChild(num('方位角(rad)', 'azimuth', camKf.azimuth, 0.05));
        grid.appendChild(num('俯仰角(rad)', 'elevation', camKf.elevation, 0.05));
        const targetAxis = (axis: 0 | 1 | 2, label: string) =>
          this.field(label, this.numInput(camKf.target[axis], 0.1, (v) => {
            camKf.target[axis] = v;
            store.updateKeyframe(track.id, camKf.id, {});
          }));
        grid.appendChild(targetAxis(0, '目标 X'));
        grid.appendChild(targetAxis(1, '目标 Y'));
        grid.appendChild(targetAxis(2, '目标 Z'));
      } else if (leaf.kind === 'crater') {
        const crKf = kf as import('../core/model').CraterKeyframe;
        grid.appendChild(num('陨石坑半径', 'radius', crKf.radius, 0.2));
        grid.appendChild(num('深度', 'depth', crKf.depth, 0.1));
        grid.appendChild(num('环形山脊高度', 'rimHeight', crKf.rimHeight, 0.1));
      } else {
        const ejKf = kf as import('../core/model').EjectaKeyframe;
        grid.appendChild(num('扩散半径', 'spread', ejKf.spread, 0.2));
        grid.appendChild(num('发射速率', 'emissionRate', ejKf.emissionRate, 10));
        grid.appendChild(num('粒子生命(s)', 'life', ejKf.life, 0.1));
        grid.appendChild(num('扩散进度 0-1', 'progress', ejKf.progress, 0.05));
      }
      this.body.appendChild(grid);
    }
  }
}

customElements.define('cr-inspector', CrInspector);
