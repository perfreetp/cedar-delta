/**
 * 播放控制器
 *
 * 关键设计：无论是 requestAnimationFrame 驱动的正式播放，还是拖动播放头，
 * 最终都调用同一个 renderAt(time) -> evaluateTimeline() 纯函数，
 * 因此「拖动预览」与「点播放的回放结果」逐帧一致。
 *
 * 支持：播放/暂停（暂停后可继续编辑，再播放从当前播放头继续）、
 * 独奏（只回放指定叶子轨）、静音过滤。
 */
import type { CraterScene } from '../scene/scene';
import {
  type CameraState,
  type CraterState,
  type EjectaState,
  evaluateTimeline,
} from './evaluator';
import type { TimelineStore } from './store';

export class PlaybackController {
  private store: TimelineStore;
  private scene: CraterScene;
  private rafId: number | null = null;
  private lastWallMs = 0;
  /** 已渲染的最后时间，用于避免拖动时重复求值 */
  private lastRenderedTime = -1;

  constructor(store: TimelineStore, scene: CraterScene) {
    this.store = store;
    this.scene = scene;
    // 初次渲染静止画面
    this.renderAt(store.currentTime);
  }

  /** 正式播放：墙钟时间累加，到达时间线末尾自动停止 */
  play() {
    if (this.rafId !== null) return;
    if (this.store.currentTime >= this.store.doc.duration - 1e-6) {
      this.store.setTime(0);
    }
    this.store.setPlaying(true);
    this.lastWallMs = performance.now();
    const tick = (now: number) => {
      if (!this.store.playing) {
        this.rafId = null;
        return;
      }
      const dt = (now - this.lastWallMs) / 1000;
      this.lastWallMs = now;
      const next = this.store.currentTime + dt;
      if (next >= this.store.doc.duration) {
        this.store.setTime(this.store.doc.duration);
        this.store.setPlaying(false);
        this.rafId = null;
        return;
      }
      this.store.setTime(next);
      this.renderAt(next);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  pause() {
    this.store.setPlaying(false);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  togglePlay() {
    if (this.store.playing) this.pause();
    else this.play();
  }

  /** 拖动播放头 / 程序化跳转：与播放共用同一条渲染路径；强制即时反映 */
  scrub(time: number) {
    this.pause();
    this.store.setTime(time);
    this.renderAt(time, true);
  }

  /** 文档变更后由 UI 调用，立即按当前播放头重渲染（编辑时所见即所得） */
  refresh() {
    this.renderAt(this.store.currentTime, true);
  }

  private renderAt(time: number, force = false) {
    // force 用于文档变更后的重渲染与显式 scrub；普通播放帧仍走时间去重
    if (!force && Math.abs(time - this.lastRenderedTime) < 1e-7) return;
    this.lastRenderedTime = time;

    const evalResult = evaluateTimeline(this.store.doc, time);
    const solo = this.store.soloTrackId;

    // 同类轨道取「最后一个有效样本」，符合多条同类型轨叠加时后轨优先的直觉
    let camera: CameraState | undefined;
    let crater: CraterState | undefined;
    let ejecta: EjectaState | undefined;

    for (const s of evalResult.samples) {
      const muted =
        s.muted || (solo !== null && s.trackId !== solo);
      if (muted || !s.active) continue;
      if (s.kind === 'camera' && s.camera) camera = s.camera;
      if (s.kind === 'crater' && s.crater) crater = s.crater;
      if (s.kind === 'ejecta' && s.ejecta) ejecta = s.ejecta;
    }

    if (camera) this.scene.updateCamera(camera);
    if (crater) this.scene.applyCrater(crater);
    if (ejecta) {
      this.scene.updateEjecta(ejecta, time);
      this.scene.updateDust(ejecta);
    } else {
      this.scene.idle();
    }
  }

  dispose() {
    this.pause();
  }
}
