import { sharedCss } from './styles';
import {
  type Track,
  type GroupTrack,
  type LeafTrack,
  isGroup,
  walkTracks,
} from '../core/model';
import { getStore, getPlayback, whenStoreReady } from '../core/registry';
import { evaluateTimeline, globalTimeOfLocal, keyframeGlobalTimes, trackChain } from '../core/evaluator';
import { EASING_LABELS } from '../core/easing';
import './cr-ruler';

/** cr-ruler 的最小接口（避免跨模块导入类造成循环依赖 TDZ） */
interface RulerLike extends HTMLElement {
  setScale(px: number): void;
  render(): void;
}

const KIND_LABEL: Record<string, string> = {
  camera: '相机',
  crater: '陨石坑',
  ejecta: '喷出物',
  group: '分组',
};

/**
 * 时间轴主组件：
 * 左为轨道树（名称/类型/静音/独奏/编组操作，缩进体现嵌套），
 * 右为时间轴泳道（全局秒坐标，关键帧标记按嵌套缓动重排后的全局位置渲染），
 * 顶部播放头贯穿所有泳道；拖动播放头时各轨按嵌套关系同步预览。
 */
export class CrTimeline extends HTMLElement {
  private root: ShadowRoot;
  private trackList!: HTMLDivElement;
  private laneWrap!: HTMLDivElement;
  private playhead!: HTMLDivElement;
  private timeLabel!: HTMLSpanElement;
  private statusLabel!: HTMLSpanElement;
  private rulerEl!: RulerLike;
  private subscribed = false;
  pxPerSec = 12;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${sharedCss}
      .shell { display:flex; flex-direction:column; height:100%; background:var(--bg-0); }
      .head { display:flex; align-items:center; gap:10px; padding:8px 10px; border-bottom:1px solid var(--line); background:var(--bg-1); flex-wrap:wrap; }
      .body { flex:1; display:flex; min-height:0; }
      .left { width:300px; min-width:220px; border-right:1px solid var(--line); overflow-y:auto; background:var(--bg-1); }
      .right { flex:1; overflow:auto; position:relative; }
      .ruler-slot { position:sticky; top:0; z-index:5; background:var(--bg-1); }
      .row { display:flex; align-items:center; height:44px; border-bottom:1px solid rgba(43,58,92,.5); }
      .left .row { padding-right:8px; }
      .lane-row { position:relative; height:44px; border-bottom:1px solid rgba(43,58,92,.5); min-width:100%; }
      .lane-row.group { background:repeating-linear-gradient(45deg, rgba(201,166,255,.05) 0 8px, transparent 8px 16px); }
      .lane-row.active-leaf { background-color:rgba(91,157,255,.07); }
      .track-item { display:flex; align-items:center; gap:6px; width:100%; padding:0 8px; }
      .name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
      .name.selected { color:var(--accent); font-weight:600; }
      .mini-btn { padding:2px 6px; font-size:11px; border-radius:4px; }
      .mini-btn.on { background:var(--danger); border-color:var(--danger); color:#1a0609; }
      .mini-btn.solo-on { background:var(--ok); border-color:var(--ok); color:#061a0e; }
      .kf {
        position:absolute; top:50%; width:14px; height:14px; transform:translate(-50%,-50%) rotate(45deg);
        background:var(--bg-3); border:2px solid var(--accent); border-radius:3px; cursor:grab; z-index:2;
      }
      .kf.camera { border-color:var(--camera); }
      .kf.crater { border-color:var(--crater); }
      .kf.ejecta { border-color:var(--ejecta); }
      .kf.step { border-style:dashed; }
      .kf.ease { border-radius:50%; }
      .kf:active { cursor:grabbing; }
      .span-rect { position:absolute; top:6px; bottom:6px; border-radius:5px; opacity:.25; border:1px solid currentColor; }
      .span-rect.group { background:rgba(201,166,255,.12); color:var(--group); }
      .span-rect.leaf { color:var(--accent); }
      .playhead {
        position:absolute; top:0; bottom:0; width:2px; background:var(--accent); z-index:8; pointer-events:none;
      }
      .playhead::before {
        content:''; position:absolute; top:0; left:-6px; border-left:7px solid transparent;
        border-right:7px solid transparent; border-top:9px solid var(--accent);
      }
      .footer { display:flex; gap:14px; align-items:center; padding:6px 10px; border-top:1px solid var(--line); background:var(--bg-1); font-size:12px; color:var(--text-1); }
      .depth-badge { font-size:10px; color:var(--text-2); border:1px solid var(--line); border-radius:8px; padding:0 5px; }
      .hint { color:var(--text-2); font-size:11px; }
    </style>`;

    const shell = document.createElement('div');
    shell.className = 'shell';
    shell.innerHTML = `
      <div class="head">
        <button class="primary" data-act="play">▶ 播放</button>
        <button data-act="pause">⏸ 暂停</button>
        <button data-act="to-start">⏮ 起点</button>
        <span style="width:1px;height:22px;background:var(--line)"></span>
        <button data-act="add-camera">＋ 相机路径轨</button>
        <button data-act="add-crater">＋ 陨石坑生长轨</button>
        <button data-act="add-ejecta">＋ 喷出物扩散轨</button>
        <button data-act="add-group">＋ 分组轨</button>
        <button data-act="group">编组选中</button>
        <button data-act="ungroup">解散分组</button>
        <span style="flex:1"></span>
        <label>时间线长度
          <input type="number" min="0.5" step="0.5" style="width:70px" data-role="duration" /> 秒
        </label>
        <label>缩放
          <input type="range" min="6" max="60" value="12" data-role="scale" style="width:110px" />
        </label>
      </div>
      <div class="body">
        <div class="left" data-role="left"></div>
        <div class="right" data-role="right">
          <div class="ruler-slot" data-role="ruler-slot" style="height:40px"></div>
          <div data-role="lanes" style="position:relative"></div>
          <div class="playhead" data-role="playhead"></div>
        </div>
      </div>
      <div class="footer">
        <span>当前时间 <strong data-role="time">0.00s</strong></span>
        <span data-role="status"></span>
        <span style="flex:1"></span>
        <span class="hint">双击泳道空白处加关键帧 · 双击关键帧复制到当前播放头 · 拖动关键帧移动</span>
      </div>`;
    this.root.appendChild(shell);

    this.trackList = shell.querySelector('[data-role=left]')!;
    this.laneWrap = shell.querySelector('[data-role=lanes]')!;
    this.playhead = shell.querySelector('[data-role=playhead]')!;
    this.timeLabel = shell.querySelector('[data-role=time]')!;
    this.statusLabel = shell.querySelector('[data-role=status]')!;

    const right = shell.querySelector('.right') as HTMLDivElement;
    const rulerSlot = shell.querySelector('[data-role=ruler-slot]') as HTMLDivElement;
    const ruler = document.createElement('cr-ruler') as RulerLike;
    rulerSlot.appendChild(ruler);
    this.rulerEl = ruler;
    // 左右纵向滚动联动；右侧横向滚动同步刻度尺
    const left = shell.querySelector('.left') as HTMLDivElement;
    right.addEventListener('scroll', () => {
      left.scrollTop = right.scrollTop;
      rulerSlot.style.transform = `translateX(${-right.scrollLeft}px)`;
    });
    left.addEventListener('scroll', () => {
      right.scrollTop = left.scrollTop;
    });

    shell.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
      if (btn) this.onAction(btn.dataset.act!);
    });
    const scaleInput = shell.querySelector('[data-role=scale]') as HTMLInputElement;
    scaleInput.addEventListener('input', () => {
      this.setScale(Number(scaleInput.value));
    });
    const durInput = shell.querySelector('[data-role=duration]') as HTMLInputElement;
    durInput.addEventListener('change', () => getStore().setDuration(Number(durInput.value)));
  }

  connectedCallback() {
    // registry 在 main.ts 中注入，元素构造时可能尚未就绪，等待就绪后再订阅/渲染
    whenStoreReady((store) => {
      if (!this.subscribed) {
        this.subscribed = true;
        store.subscribe((ev) => {
          if (ev === 'doc-change' || ev === 'selection-change') this.render();
          if (ev === 'time-change') this.updatePlayhead();
        });
      }
      this.setScale(this.pxPerSec);
      this.render();
    });
  }

  setScale(px: number) {
    this.pxPerSec = px;
    this.rulerEl.setScale(px);
    this.render();
  }

  private onAction(act: string) {
    const store = getStore();
    const pb = getPlayback();
    const selected = store.selectedTrackId;
    try {
      switch (act) {
        case 'play': pb.play(); break;
        case 'pause': pb.pause(); break;
        case 'to-start': pb.scrub(0); break;
        case 'add-camera': store.addTrack('camera', selected && isGroup(store.findTrackOrThrow(selected)) ? selected : null); break;
        case 'add-crater': store.addTrack('crater', selected && isGroup(store.findTrackOrThrow(selected)) ? selected : null); break;
        case 'add-ejecta': store.addTrack('ejecta', selected && isGroup(store.findTrackOrThrow(selected)) ? selected : null); break;
        case 'add-group': store.addTrack('group', selected && isGroup(store.findTrackOrThrow(selected)) ? selected : null); break;
        case 'group': {
          const ids = store.effectiveSelection();
          if (ids.length === 0) return alert('请先选择一条或多条同级轨道（Ctrl/⌘+点击多选）');
          store.groupTracks(ids);
          break;
        }
        case 'ungroup':
          if (selected) store.ungroupTrack(selected);
          break;
      }
    } catch (err) {
      alert((err as Error).message);
    }
  }

  render() {
    const store = getStore();
    // 头部长度输入
    const durInput = this.root.querySelector('[data-role=duration]') as HTMLInputElement;
    if (document.activeElement !== durInput) durInput.value = String(store.doc.duration);

    this.trackList.innerHTML = '';
    this.laneWrap.innerHTML = '';
    const widthPx = Math.max(
      this.laneWrap.clientWidth || 600,
      store.doc.duration * this.pxPerSec + 40,
    );

    const rows: { track: Track; depth: number }[] = [];
    walkTracks(store.doc.tracks, (track, _p, depth) => {
      rows.push({ track, depth });
    });

    for (const { track, depth } of rows) {
      this.trackList.appendChild(this.buildLeftRow(track, depth));
      this.laneWrap.appendChild(this.buildLaneRow(track, widthPx));
    }
    this.rulerEl.render();
    this.updatePlayhead();
  }

  private buildLeftRow(track: Track, depth: number): HTMLDivElement {
    const store = getStore();
    const row = document.createElement('div');
    row.className = 'row';
    const item = document.createElement('div');
    item.className = 'track-item';
    item.style.paddingLeft = `${8 + (depth - 1) * 16}px`;

    const depthBadge = document.createElement('span');
    depthBadge.className = 'depth-badge';
    depthBadge.textContent = `L${depth}`;

    const tag = document.createElement('span');
    tag.className = `tag ${track.kind}`;
    tag.textContent = KIND_LABEL[track.kind];

    const name = document.createElement('span');
    const isSelected = store.selectedTrackIds.includes(track.id);
    name.className = 'name' + (isSelected ? ' selected' : '');
    name.textContent = track.name + (isGroup(track) ? ` (${track.children.length})` : '');
    name.title = `${track.name} · ${EASING_LABELS[track.easing]}`;
    name.addEventListener('click', (e) => store.select(track.id, e.ctrlKey || e.metaKey));
    name.addEventListener('dblclick', () => {
      const renamed = prompt('轨道名称', track.name);
      if (renamed) store.updateTrack(track.id, { name: renamed });
    });

    const muteBtn = document.createElement('button');
    muteBtn.className = 'mini-btn' + (track.muted ? ' on' : '');
    muteBtn.textContent = '静';
    muteBtn.title = '静音';
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isGroup(track)) {
        // 分组静音级联到所有叶子
        walkTracks((track as GroupTrack).children, (c) => store.updateTrack(c.id, { muted: !track.muted }));
        store.updateTrack(track.id, { muted: !track.muted });
      } else {
        store.toggleMute(track.id);
      }
    });

    item.append(depthBadge, tag, name, muteBtn);

    if (!isGroup(track)) {
      const soloBtn = document.createElement('button');
      const isSolo = store.soloTrackId === track.id;
      soloBtn.className = 'mini-btn' + (isSolo ? ' solo-on' : '');
      soloBtn.textContent = '独';
      soloBtn.title = '单独回放（独奏）';
      soloBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.setSolo(isSolo ? null : track.id);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'mini-btn';
      delBtn.textContent = '删';
      delBtn.title = '删除轨道';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`删除轨道「${track.name}」？`)) store.deleteTrack(track.id);
      });
      item.append(soloBtn, delBtn);
    } else {
      const delBtn = document.createElement('button');
      delBtn.className = 'mini-btn';
      delBtn.textContent = '删';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`删除分组「${track.name}」及其全部子轨？`)) store.deleteTrack(track.id);
      });
      item.append(delBtn);
    }

    row.appendChild(item);
    return row;
  }

  private buildLaneRow(track: Track, widthPx: number): HTMLDivElement {
    const store = getStore();
    const row = document.createElement('div');
    row.className = `lane-row ${track.kind}`;
    row.style.width = `${widthPx}px`;
    row.dataset.trackId = track.id;

    // 轨道占用的时间区间矩形（分组显示其子内容的容器带）
    const span = document.createElement('div');
    span.className = `span-rect ${isGroup(track) ? 'group' : 'leaf'}`;
    const chain = trackChain(store.doc, track.id)!;
    // 分组/子轨在全局上的区间：用局部 0 和 1 经嵌套缓动正映射得到
    const gStart = globalTimeOfLocal(chain, 0);
    const gEnd = globalTimeOfLocal(chain, 1);
    span.style.left = `${gStart * this.pxPerSec}px`;
    span.style.width = `${Math.max(2, (gEnd - gStart) * this.pxPerSec)}px`;
    row.appendChild(span);

    if (isGroup(track)) {
      row.title = `分组 · ${EASING_LABELS[track.easing]} 曲线作用于子轨时间重映射`;
      row.addEventListener('dblclick', () => store.select(track.id));
      return row;
    }

    const leaf = track as LeafTrack;
    // 关键帧标记：位置 = 经嵌套缓动重排后的全局时间
    const globals = keyframeGlobalTimes(chain);
    for (const g of globals) {
      const kf = leaf.keyframes.find((k) => k.id === g.id)!;
      const marker = document.createElement('div');
      const easing = kf.easing ?? leaf.easing;
      marker.className = `kf ${leaf.kind} ${easing}`;
      marker.style.left = `${g.globalTime * this.pxPerSec}px`;
      marker.title = `局部 ${(g.localTime * 100).toFixed(1)}% · 全局 ${g.globalTime.toFixed(2)}s · ${EASING_LABELS[easing]}`;
      marker.dataset.kfId = kf.id;

      marker.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        marker.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const rect = row.getBoundingClientRect();
          const x = Math.max(0, ev.clientX - rect.left + (this.laneWrap.parentElement!.scrollLeft || 0));
          const gt = x / this.pxPerSec;
          store.moveKeyframeToGlobalTime(track.id, kf.id, gt);
        };
        const up = () => {
          marker.removeEventListener('pointermove', move);
          marker.removeEventListener('pointerup', up);
        };
        marker.addEventListener('pointermove', move);
        marker.addEventListener('pointerup', up);
      });
      // 双击关键帧：复制到当前播放头时间点
      marker.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        store.copyKeyframeAt(track.id, kf.id, store.currentTime);
      });
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        store.select(track.id);
        this.dispatchEvent(
          new CustomEvent('keyframe-select', { detail: { trackId: track.id, keyframeId: kf.id }, bubbles: true, composed: true }),
        );
      });
      row.appendChild(marker);
    }

    // 双击泳道空白：在该全局时间点新增关键帧
    row.addEventListener('dblclick', (e) => {
      const rect = row.getBoundingClientRect();
      const x = e.clientX - rect.left + (this.laneWrap.parentElement!.scrollLeft || 0);
      const gt = x / this.pxPerSec;
      store.addKeyframe(track.id, gt);
    });
    row.addEventListener('click', (e) => store.select(track.id, e.ctrlKey || e.metaKey));
    return row;
  }

  updatePlayhead() {
    const store = getStore();
    const x = store.currentTime * this.pxPerSec;
    this.playhead.style.left = `${x}px`;
    this.timeLabel.textContent = `${store.currentTime.toFixed(2)}s / ${store.doc.duration.toFixed(1)}s`;

    // 激活状态：哪些轨在当前时间生效（考虑静音/独奏）
    const ev = evaluateTimeline(store.doc, store.currentTime);
    const active = new Set(ev.activeTrackIds);
    const mutedNow = new Set(ev.mutedTrackIds);
    const solo = store.soloTrackId;
    const rows = this.laneWrap.querySelectorAll('.lane-row');
    rows.forEach((r) => {
      const id = (r as HTMLElement).dataset.trackId!;
      r.classList.toggle('active-leaf', active.has(id));
    });
    const parts: string[] = [];
    if (store.playing) parts.push('▶ 播放中');
    if (solo) parts.push(`独奏：${store.findTrackOrThrow(solo).name}`);
    const activeNames = ev.samples.filter((s) => active.has(s.trackId)).map((s) => s.name);
    parts.push(`激活轨 ${active.size} 个：${activeNames.join('、') || '无'}`);
    if (mutedNow.size) parts.push(`静音 ${mutedNow.size} 个`);
    this.statusLabel.textContent = parts.join(' ｜ ');
    this.rulerEl.render();
  }
}

customElements.define('cr-timeline', CrTimeline);
