import { Application, Container, Graphics, Sprite, Texture, Assets } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Puppet, Vec2 } from '../types';
import { buildSpline, useEditorStore, waypointIndexResolver } from '../store';
import { Spline } from '../core/spline';
import { SpatialHash, resolvePick, type HashEntry, type PickCandidate } from '../core/spatial-hash';
import { TimelineSampler } from '../core/timeline';
import {
  BASE_HIT_RADIUS,
  CLICK_THRESHOLD,
  COLORS,
  KEYFRAME_HIT_RADIUS,
  PATH_HIT_BAND,
  drawDwellRing,
  drawHeadingHandle,
  drawKeyframeDiamond,
  drawPuppetIcon,
  drawWaypointMarker,
  dwellRadius,
  type HitResult,
  type KeyframeHit,
} from './graphics-factory';

interface PuppetRuntime {
  puppetId: string;
  spline: Spline;
  sampler: TimelineSampler;
  wpHash: SpatialHash<string>;
  kfHash: SpatialHash<string>;
  pathG: Graphics;
  markerG: Graphics;
  kfG: Graphics;
  actor: Container;
  /** 渲染时记录的经过点坐标，供空间哈希重建 */
  wpEntries: HashEntry<string>[];
  kfEntries: HashEntry<string>[];
}

type DragState =
  | {
      kind: 'waypoint' | 'heading' | 'dwell';
      puppetId: string;
      targetId: string;
      pointerId: number;
      startScreen: Vec2;
      dragging: boolean;
    }
  | {
      kind: 'freeDraw';
      puppetId: string;
      pointerId: number;
      startScreen: Vec2;
      moved: boolean;
    };

const WAYPOINT_RADIUS = 6;
const KEYFRAME_SIZE = 8;
const HEADING_LEN = 46;
const FREE_DRAW_SPACING = 26;
const DBL_CLICK_MS = 320;
const DBL_CLICK_PX = 9;

export class StageEngine {
  private app!: Application;
  private viewport!: Viewport;
  private bgLayer!: Container;
  private gridG!: Graphics;
  private bgSprite: Sprite | null = null;
  private pathLayer!: Container;
  private markerLayer!: Container;
  private kfLayer!: Container;
  private actorLayer!: Container;
  private overlayG!: Graphics;

  private runtimes = new Map<string, PuppetRuntime>();
  private drag: DragState | null = null;
  private hover: HitResult | null = null;
  private hoverKf: KeyframeHit | null = null;
  private lastClick: { t: number; screen: Vec2; world: Vec2 } | null = null;
  /** 延迟执行的单击追加（等待双击判定窗口） */
  private pendingClickTimer: number | null = null;
  private viewportPanned = false;
  /** stage 模式空白按下的待放置位置（pointerup 时确认） */
  private pendingStagePlacement: Vec2 | null = null;
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubStore: (() => void) | null = null;
  private disposed = false;
  private stageTextureToken = 0;

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    this.app = new Application();
    await this.app.init({
      background: '#eef1f5',
      antialias: true,
      resizeTo: host,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    host.appendChild(this.app.canvas);

    const state = useEditorStore.getState();
    this.viewport = new Viewport({
      screenWidth: host.clientWidth,
      screenHeight: host.clientHeight,
      worldWidth: state.stage.worldWidth,
      worldHeight: state.stage.worldHeight,
      events: this.app.renderer.events,
    });
    this.viewport.eventMode = 'static';
    this.viewport
      // 左键/中键平移（右键保留给上下文删除）；标记拖动期间会被 pause，避免与元素拖动冲突
      .drag({ mouseButtons: 'left-middle' })
      .wheel({ percent: 0.18 })
      .pinch()
      .decelerate({ friction: 0.88 })
      .clamp({ direction: 'all', underflow: 'center' });
    this.app.stage.addChild(this.viewport);

    this.bgLayer = new Container();
    this.gridG = new Graphics();
    this.bgLayer.addChild(this.gridG);
    this.pathLayer = new Container();
    this.markerLayer = new Container();
    this.kfLayer = new Container();
    this.actorLayer = new Container();
    this.overlayG = new Graphics();
    this.overlayG.eventMode = 'none';
    this.viewport.addChild(this.bgLayer, this.pathLayer, this.markerLayer, this.kfLayer, this.actorLayer, this.overlayG);

    this.bindPointerEvents();
    this.bindKeyboard();
    this.viewport.on('rightclick', (ev: FederatedPointerEvent) => {
      (ev.nativeEvent as Event | undefined)?.preventDefault();
    });
    // 视图发生平移时置标记，阻止“按下后拖动视图”被误判为点击放置/追加
    this.viewport.on('moved', (data: { type?: string }) => {
      if (data.type === 'drag') this.viewportPanned = true;
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(host);

    this.unsubStore = useEditorStore.subscribe((s, prev) => this.onStoreChange(s, prev));
    this.rebuildAll();
    this.app.ticker.add(this.onTick);
  }

  destroy(): void {
    this.disposed = true;
    this.unsubStore?.();
    this.resizeObserver?.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.pendingClickTimer !== null) {
      clearTimeout(this.pendingClickTimer);
      this.pendingClickTimer = null;
    }
    this.viewport?.destroy({ children: true });
    this.app?.destroy(false, { children: true });
    this.runtimes.clear();
  }

  // ---------------------------------------------------------------- 生命周期

  private handleResize(): void {
    if (!this.host || this.disposed) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.app.renderer.resize(w, h);
    this.viewport.resize(w, h);
  }

  private onStoreChange = (
    s: ReturnType<typeof useEditorStore.getState>,
    prev: ReturnType<typeof useEditorStore.getState>,
  ): void => {
    if (s.stage !== prev.stage) {
      this.viewport.worldWidth = s.stage.worldWidth;
      this.viewport.worldHeight = s.stage.worldHeight;
      this.drawGrid();
      this.loadBackground(s.stage.imageUrl);
    }
    if (s.puppets !== prev.puppets) {
      this.syncRuntimes(s.puppets);
      return;
    }
    // 工具或选中态变化不改变数据，只需要刷新标记高亮/显隐
    if (
      s.tool !== prev.tool ||
      s.selectedWaypointId !== prev.selectedWaypointId ||
      s.selectedKeyframeId !== prev.selectedKeyframeId
    ) {
      this.refreshVisualState();
    }
  };

  private rebuildAll(): void {
    const s = useEditorStore.getState();
    this.viewport.worldWidth = s.stage.worldWidth;
    this.viewport.worldHeight = s.stage.worldHeight;
    this.drawGrid();
    void this.loadBackground(s.stage.imageUrl);
    this.syncRuntimes(s.puppets);
  }

  private syncRuntimes(puppets: Puppet[]): void {
    const live = new Set(puppets.map((p) => p.id));
    for (const [id, rt] of this.runtimes) {
      if (!live.has(id)) {
        rt.pathG.destroy();
        rt.markerG.destroy();
        rt.kfG.destroy();
        rt.actor.destroy({ children: true });
        this.runtimes.delete(id);
      }
    }

    for (const puppet of puppets) {
      const existing = this.runtimes.get(puppet.id);
      if (!existing) {
        const rt = this.createRuntime(puppet);
        this.runtimes.set(puppet.id, rt);
      } else {
        this.updateRuntime(existing, puppet);
      }
      const rt = this.runtimes.get(puppet.id)!;
      rt.pathG.visible = puppet.visible;
      rt.markerG.visible = puppet.visible;
      rt.kfG.visible = puppet.visible;
      rt.actor.visible = puppet.visible;
    }
  }

  private createRuntime(puppet: Puppet): PuppetRuntime {
    const pathG = new Graphics();
    const markerG = new Graphics();
    const kfG = new Graphics();
    const actor = new Container();
    drawPuppetIcon(actor, puppet.color);
    this.pathLayer.addChild(pathG);
    this.markerLayer.addChild(markerG);
    this.kfLayer.addChild(kfG);
    this.actorLayer.addChild(actor);

    const spline = buildSpline(puppet);
    const sampler = new TimelineSampler(spline, puppet.keyframes, waypointIndexResolver(puppet));
    const rt: PuppetRuntime = {
      puppetId: puppet.id,
      spline,
      sampler,
      wpHash: new SpatialHash<string>(),
      kfHash: new SpatialHash<string>(),
      pathG,
      markerG,
      kfG,
      actor,
      wpEntries: [],
      kfEntries: [],
    };
    this.redrawPuppet(rt, puppet);
    return rt;
  }

  private updateRuntime(rt: PuppetRuntime, puppet: Puppet): void {
    rt.spline = buildSpline(puppet);
    rt.sampler = new TimelineSampler(rt.spline, puppet.keyframes, waypointIndexResolver(puppet));
    this.redrawPuppet(rt, puppet);
  }

  // ---------------------------------------------------------------- 渲染

  private drawGrid(): void {
    const { worldWidth: w, worldHeight: h } = useEditorStore.getState().stage;
    const g = this.gridG;
    g.clear();
    g.rect(0, 0, w, h).fill({ color: 0xf7f9fb });
    const minor = 50;
    const major = 250;
    for (let x = 0; x <= w; x += minor) {
      g.moveTo(x, 0).lineTo(x, h).stroke({ width: 1, color: x % major === 0 ? COLORS.gridMajor : COLORS.gridMinor, alpha: 0.7 });
    }
    for (let y = 0; y <= h; y += minor) {
      g.moveTo(0, y).lineTo(w, y).stroke({ width: 1, color: y % major === 0 ? COLORS.gridMajor : COLORS.gridMinor, alpha: 0.7 });
    }
    g.rect(0, 0, w, h).stroke({ width: 3, color: COLORS.worldFrame });
  }

  private async loadBackground(url: string | null): Promise<void> {
    const token = ++this.stageTextureToken;
    if (this.bgSprite) {
      this.bgLayer.removeChild(this.bgSprite);
      this.bgSprite.destroy();
      this.bgSprite = null;
    }
    if (!url) return;
    try {
      const texture: Texture = await Assets.load(url);
      if (token !== this.stageTextureToken || this.disposed) return;
      const sprite = new Sprite(texture);
      const { worldWidth, worldHeight } = useEditorStore.getState().stage;
      sprite.width = worldWidth;
      sprite.height = worldHeight;
      sprite.alpha = 0.9;
      this.bgLayer.addChild(sprite);
      this.bgSprite = sprite;
    } catch {
      // 图片加载失败时保留网格背景
    }
  }

  /** 重绘单个偶的全部图层（批量图元，数千点也只产生一次 draw call/层） */
  private redrawPuppet(rt: PuppetRuntime, puppet: Puppet): void {
    const { tool, selectedWaypointId, selectedKeyframeId } = useEditorStore.getState();
    const color = puppet.color;

    // 轨迹折线
    rt.pathG.clear();
    const n = rt.spline.sampleCount;
    if (n > 1) {
      rt.pathG.moveTo(rt.spline.xArr[0], rt.spline.yArr[0]);
      for (let i = 1; i < n; i++) {
        rt.pathG.lineTo(rt.spline.xArr[i], rt.spline.yArr[i]);
      }
      rt.pathG.stroke({ width: 3, color, alpha: 0.85 });
    }

    // 经过点
    rt.markerG.clear();
    rt.wpEntries = [];
    const showMarkers = tool === 'stage' || tool === 'path';
    for (const wp of puppet.waypoints) {
      rt.wpEntries.push({ x: wp.pos.x, y: wp.pos.y, ref: wp.id });
      if (showMarkers) {
        drawWaypointMarker(rt.markerG, wp.pos.x, wp.pos.y, color, WAYPOINT_RADIUS, wp.id === selectedWaypointId);
      }
    }
    rt.wpHash.rebuild(rt.wpEntries);

    // 关键帧
    rt.kfG.clear();
    rt.kfEntries = [];
    const kfByWp = new Map(puppet.keyframes.map((k) => [k.waypointId, k]));
    if (tool === 'keyframe') {
      for (const wp of puppet.waypoints) {
        const kf = kfByWp.get(wp.id);
        if (!kf) continue;
        drawDwellRing(rt.kfG, wp.pos.x, wp.pos.y, kf.dwellSec);
        const angleRad = this.keyframeAngle(puppet, wp.id, rt.spline);
        drawHeadingHandle(rt.kfG, wp.pos.x, wp.pos.y, angleRad, HEADING_LEN);
        // 停留时长手柄：环上 0 度位置的小圆钮
        const dr = dwellRadius(kf.dwellSec);
        rt.kfG
          .circle(wp.pos.x + dr, wp.pos.y, 5)
          .fill({ color: COLORS.dwell })
          .stroke({ width: 1.5, color: 0x8d6e00 });
        drawKeyframeDiamond(rt.kfG, wp.pos.x, wp.pos.y, KEYFRAME_SIZE, kf.id === selectedKeyframeId);
        rt.kfEntries.push({ x: wp.pos.x, y: wp.pos.y, ref: kf.id });
      }
    }
    rt.kfHash.rebuild(rt.kfEntries);

    // 编辑态偶图标位于起点
    const start = puppet.waypoints[0]?.pos ?? { x: 0, y: 0 };
    rt.actor.position.set(start.x, start.y);
    rt.actor.rotation = rt.spline.sampleCount > 1 ? rt.spline.tangentAngleAtS(0) : 0;
  }

  private keyframeAngle(puppet: Puppet, waypointId: string, spline: Spline): number {
    const kf = puppet.keyframes.find((k) => k.waypointId === waypointId);
    if (kf?.headingOverride && kf.headingDeg !== null) {
      return (kf.headingDeg * Math.PI) / 180;
    }
    const idx = puppet.waypoints.findIndex((w) => w.id === waypointId);
    return spline.tangentAngleAtS(spline.waypointArcLength(Math.max(0, idx)));
  }

  // 便于外部（UI 工具切换/选中变化）刷新标记层高亮
  refreshVisualState(): void {
    const s = useEditorStore.getState();
    for (const puppet of s.puppets) {
      const rt = this.runtimes.get(puppet.id);
      if (rt) this.redrawPuppet(rt, puppet);
    }
  }

  // ---------------------------------------------------------------- 播放

  private onTick = (): void => {
    const s = useEditorStore.getState();
    if (s.playback.isPlaying) {
      const duration = this.getDuration();
      s.tickPlayback(this.app.ticker.deltaMS / 1000, duration);
    }
    const time = useEditorStore.getState().playback.currentTime;
    const playbackMode = useEditorStore.getState().tool === 'playback';

    for (const puppet of useEditorStore.getState().puppets) {
      const rt = this.runtimes.get(puppet.id);
      if (!rt) continue;
      if (playbackMode) {
        const pose = rt.sampler.sampleAt(time);
        rt.actor.position.set(pose.x, pose.y);
        rt.actor.rotation = pose.angleRad;
      } else {
        const start = puppet.waypoints[0]?.pos ?? { x: 0, y: 0 };
        rt.actor.position.set(start.x, start.y);
        rt.actor.rotation = rt.spline.sampleCount > 1 ? rt.spline.tangentAngleAtS(0) : 0;
      }
    }
  };

  getDuration(): number {
    let d = 0;
    for (const rt of this.runtimes.values()) d = Math.max(d, rt.sampler.durationSec);
    return d;
  }

  // ---------------------------------------------------------------- 拾取

  private worldFromEvent(e: FederatedPointerEvent): Vec2 {
    const p = this.viewport.toWorld(e.global);
    return { x: p.x, y: p.y };
  }

  private screenFromEvent(e: FederatedPointerEvent): Vec2 {
    return { x: e.global.x, y: e.global.y };
  }

  private hitWaypoint(world: Vec2): HitResult | null {
    const radius = BASE_HIT_RADIUS / this.viewport.scale.x;
    const s = useEditorStore.getState();
    const candidates: PickCandidate<HitResult>[] = [];
    let order = 0;
    for (const puppet of s.puppets) {
      if (!puppet.visible) continue;
      const rt = this.runtimes.get(puppet.id);
      if (!rt) continue;
      for (const c of rt.wpHash.queryRadius(world, radius)) {
        const dist = Math.hypot(c.x - world.x, c.y - world.y);
        if (dist <= radius) {
          const hit: HitResult = { puppetId: puppet.id, waypointId: c.ref, dist, order };
          candidates.push({ ref: hit, dist, tieOrder: order++ });
        }
      }
    }
    const preferred = (h: HitResult): boolean => h.puppetId === s.selectedPuppetId;
    return resolvePick<HitResult>(candidates, preferred);
  }

  private hitKeyframe(world: Vec2): KeyframeHit | null {
    const radius = KEYFRAME_HIT_RADIUS / this.viewport.scale.x;
    const s = useEditorStore.getState();
    let best: KeyframeHit | null = null;
    for (const puppet of s.puppets) {
      if (!puppet.visible) continue;
      const rt = this.runtimes.get(puppet.id);
      if (!rt) continue;
      for (const c of rt.kfHash.queryRadius(world, radius)) {
        const dist = Math.hypot(c.x - world.x, c.y - world.y);
        if (dist <= radius && (!best || dist < best.dist)) {
          best = { puppetId: puppet.id, keyframeId: c.ref, waypointId: this.waypointIdOfKf(puppet, c.ref), dist };
        }
      }
    }
    return best;
  }

  private waypointIdOfKf(puppet: Puppet, keyframeId: string): string {
    return puppet.keyframes.find((k) => k.id === keyframeId)?.waypointId ?? '';
  }

  private hitPath(world: Vec2): { puppetId: string; segmentIndex: number; point: Vec2 } | null {
    const band = PATH_HIT_BAND / this.viewport.scale.x;
    const s = useEditorStore.getState();
    let best: { puppetId: string; segmentIndex: number; point: Vec2; dist: number } | null = null;
    // 优先当前选中偶，避免重叠轨迹时误选别的偶
    const ordered = [...s.puppets].sort((a, b) => (a.id === s.selectedPuppetId ? -1 : b.id === s.selectedPuppetId ? 1 : 0));
    for (const puppet of ordered) {
      if (!puppet.visible || puppet.waypoints.length < 2) continue;
      const rt = this.runtimes.get(puppet.id);
      if (!rt) continue;
      const near = rt.spline.nearestPoint(world);
      if (near && near.dist <= band && (!best || near.dist < best.dist)) {
        best = { puppetId: puppet.id, segmentIndex: near.segmentIndex, point: near.point, dist: near.dist };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- 指针交互（见 engine-interactions.ts）

  bindPointerEvents(): void {
    this.viewport.on('pointerdown', this.onPointerDown);
    this.viewport.on('pointermove', this.onPointerMove);
    this.viewport.on('pointerup', this.onPointerUp);
    this.viewport.on('pointerupoutside', this.onPointerUp);
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', this.onKeyDown);
  }

  onPointerDown = (e: FederatedPointerEvent): void => {
    if (e.button === 2) {
      this.handleRightClick(e);
      return;
    }
    if (e.button !== 0) return;
    const s = useEditorStore.getState();
    const world = this.worldFromEvent(e);
    const screen = this.screenFromEvent(e);
    this.viewportPanned = false;

    if (s.tool === 'playback') {
      const hit = this.hitWaypoint(world);
      if (hit) s.selectPuppet(hit.puppetId);
      return;
    }

    if (s.tool === 'keyframe') {
      const kfHit = this.hitKeyframe(world);
      if (kfHit) {
        // 命中关键帧：立即暂停视图平移，避免点选/拖箭头时误拖视图
        this.viewport.plugins.pause('drag');
        s.selectPuppet(kfHit.puppetId);
        s.selectKeyframe(kfHit.keyframeId);
        const puppet = s.puppets.find((p) => p.id === kfHit.puppetId)!;
        const kf = puppet.keyframes.find((k) => k.id === kfHit.keyframeId)!;
        const wp = puppet.waypoints.find((w) => w.id === kfHit.waypointId)!;
        const knobDist = Math.hypot(world.x - (wp.pos.x + dwellRadius(kf.dwellSec)), world.y - wp.pos.y);
        const isDwellKnob = knobDist <= 12 / this.viewport.scale.x;
        this.drag = isDwellKnob
          ? { kind: 'dwell', puppetId: kfHit.puppetId, targetId: kfHit.keyframeId, pointerId: e.pointerId, startScreen: screen, dragging: false }
          : { kind: 'heading', puppetId: kfHit.puppetId, targetId: kfHit.keyframeId, pointerId: e.pointerId, startScreen: screen, dragging: false };
        return;
      }
      // 点击经过点且无关键帧 -> 新建关键帧
      const wpHit = this.hitWaypoint(world);
      if (wpHit) {
        s.addKeyframe(wpHit.puppetId, wpHit.waypointId);
        return;
      }
      return;
    }

    if (s.tool === 'path' || s.tool === 'stage') {
      const hit = this.hitWaypoint(world);
      if (hit) {
        // 命中经过点：立即暂停视图平移，保证点击选中不会触发平移
        this.viewport.plugins.pause('drag');
        s.selectWaypoint(hit.puppetId, hit.waypointId);
        this.drag = { kind: 'waypoint', puppetId: hit.puppetId, targetId: hit.waypointId, pointerId: e.pointerId, startScreen: screen, dragging: false };
        return;
      }
      // stage 模式空白处：放置意图延迟到 pointerup，避免按下后平移视图也放置木偶
      if (s.tool === 'stage') {
        this.pendingStagePlacement = this.clampToStage(world);
        return;
      }
      // path 模式空白处：自由拖画 / 点击追加
      if (s.selectedPuppetId) {
        this.drag = { kind: 'freeDraw', puppetId: s.selectedPuppetId, pointerId: e.pointerId, startScreen: screen, moved: false };
      }
    }
  };

  onPointerMove = (e: FederatedPointerEvent): void => {
    const s = useEditorStore.getState();
    const world = this.worldFromEvent(e);
    const screen = this.screenFromEvent(e);

    if (this.drag) {
      this.handleDragMove(world, screen);
      return;
    }

    // 悬停反馈 + 光标
    if (s.tool === 'keyframe') {
      this.hoverKf = this.hitKeyframe(world);
      this.hover = null;
    } else {
      this.hover = this.hitWaypoint(world);
      this.hoverKf = null;
    }
    this.viewport.cursor = this.hover || this.hoverKf ? 'pointer' : s.tool === 'path' ? 'crosshair' : 'grab';
    this.drawOverlay(world);
  };

  onPointerUp = (e: FederatedPointerEvent): void => {
    const s = useEditorStore.getState();
    const world = this.worldFromEvent(e);
    const screen = this.screenFromEvent(e);

    // stage 模式空白点击的放置确认：发生过视图平移则取消
    if (this.pendingStagePlacement) {
      const placement = this.pendingStagePlacement;
      this.pendingStagePlacement = null;
      if (!this.viewportPanned) {
        s.createPuppet(placement);
        this.lastClick = { t: performance.now(), screen, world };
      }
      this.viewport.plugins.resume('drag');
      return;
    }

    // 没有属于本指针的拖动（例如纯视图平移后的抬手）：恢复插件并做双击检测
    if (!this.drag || this.drag.pointerId !== e.pointerId) {
      this.viewport.plugins.resume('drag');
      this.detectDoubleClick(screen, world);
      return;
    }

    const drag = this.drag;
    this.drag = null;
    this.viewport.plugins.resume('drag');

    if (drag.kind === 'freeDraw' && !drag.moved) {
      // 按下后若发生了视图平移，则不是点击，不追加经过点
      if (this.viewportPanned) {
        this.lastClick = { t: performance.now(), screen, world };
        return;
      }
      // path 模式空白单击：延迟追加，若判定为双击则改为在轨迹上插入
      this.schedulePathClick(drag.puppetId, screen, world);
      return;
    }
    // 其余拖动（经过点/朝向/停留、自由拖画）松手即完成
    this.lastClick = { t: performance.now(), screen, world };
    this.drawOverlay(world);
    void s;
  };

  private schedulePathClick(puppetId: string, screen: Vec2, world: Vec2): void {
    if (this.pendingClickTimer !== null) {
      clearTimeout(this.pendingClickTimer);
      this.pendingClickTimer = null;
    }
    this.pendingClickTimer = window.setTimeout(() => {
      this.pendingClickTimer = null;
      useEditorStore.getState().addWaypoint(puppetId, world);
    }, DBL_CLICK_MS);
    this.lastClick = { t: performance.now(), screen, world };
  }

  private detectDoubleClick(screen: Vec2, world: Vec2): void {
    const s = useEditorStore.getState();
    if (s.tool !== 'path' || !this.lastClick) {
      this.lastClick = { t: performance.now(), screen, world };
      return;
    }
    const dt = performance.now() - this.lastClick.t;
    const ds = Math.hypot(screen.x - this.lastClick.screen.x, screen.y - this.lastClick.screen.y);
    this.lastClick = { t: performance.now(), screen, world };
    if (dt > DBL_CLICK_MS || ds > DBL_CLICK_PX) return;

    // 双击成立：取消待执行的单击追加，改为轨迹上插入经过点
    if (this.pendingClickTimer !== null) {
      clearTimeout(this.pendingClickTimer);
      this.pendingClickTimer = null;
    }
    const hit = this.hitPath(world);
    if (hit) s.insertWaypointAt(hit.puppetId, hit.segmentIndex, hit.point);
  }

  private handleDragMove(world: Vec2, screen: Vec2): void {
    const s = useEditorStore.getState();
    const d = this.drag!;
    const movedDist = Math.hypot(screen.x - d.startScreen.x, screen.y - d.startScreen.y);

    if (d.kind === 'freeDraw') {
      if (movedDist > CLICK_THRESHOLD && !d.moved) {
        // 越过点击阈值才接管指针：此前小幅移动仍允许视图平移
        d.moved = true;
        this.viewport.plugins.pause('drag');
      }
      if (d.moved) {
        const puppet = s.puppets.find((p) => p.id === d.puppetId);
        const last = puppet?.waypoints[puppet.waypoints.length - 1];
        if (!last || Math.hypot(world.x - last.pos.x, world.y - last.pos.y) >= FREE_DRAW_SPACING) {
          s.addWaypoint(d.puppetId, world);
        }
      }
      return;
    }

    if (!d.dragging && movedDist > CLICK_THRESHOLD) {
      d.dragging = true;
    }
    if (!d.dragging) return;

    if (d.kind === 'waypoint') {
      s.moveWaypoint(d.puppetId, d.targetId, this.clampToStage(world));
    } else if (d.kind === 'heading') {
      const puppet = s.puppets.find((p) => p.id === d.puppetId);
      const kf = puppet?.keyframes.find((k) => k.id === d.targetId);
      const wp = puppet?.waypoints.find((w) => w.id === kf?.waypointId);
      if (puppet && kf && wp) {
        const angleDeg = (Math.atan2(world.y - wp.pos.y, world.x - wp.pos.x) * 180) / Math.PI;
        s.updateKeyframe(d.puppetId, d.targetId, { headingDeg: angleDeg, headingOverride: true });
      }
    } else if (d.kind === 'dwell') {
      const puppet = s.puppets.find((p) => p.id === d.puppetId);
      const kf = puppet?.keyframes.find((k) => k.id === d.targetId);
      const wp = puppet?.waypoints.find((w) => w.id === kf?.waypointId);
      if (kf && wp) {
        const radial = Math.hypot(world.x - wp.pos.x, world.y - wp.pos.y);
        const dwell = Math.max(0, Math.min(5, (radial - 12) / 18));
        s.updateKeyframe(d.puppetId, d.targetId, { dwellSec: Math.round(dwell * 10) / 10 });
      }
    }
  }

  private handleRightClick(e: FederatedPointerEvent): void {
    const s = useEditorStore.getState();
    const world = this.worldFromEvent(e);
    if (s.tool === 'keyframe') {
      const kf = this.hitKeyframe(world);
      if (kf) {
        s.removeKeyframe(kf.puppetId, kf.keyframeId);
        e.stopPropagation();
      }
      return;
    }
    if (s.tool === 'path' || s.tool === 'stage') {
      const wp = this.hitWaypoint(world);
      if (wp) {
        s.removeWaypoint(wp.puppetId, wp.waypointId);
        e.stopPropagation();
      }
    }
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const s = useEditorStore.getState();
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (s.tool === 'keyframe' && s.selectedKeyframeId && s.selectedPuppetId) {
        s.removeKeyframe(s.selectedPuppetId, s.selectedKeyframeId);
        ev.preventDefault();
      } else if ((s.tool === 'path' || s.tool === 'stage') && s.selectedWaypointId && s.selectedPuppetId) {
        s.removeWaypoint(s.selectedPuppetId, s.selectedWaypointId);
        ev.preventDefault();
      }
    } else if (ev.key === 'Escape') {
      s.selectWaypoint(null, null);
      s.selectKeyframe(null);
    } else if (ev.key === ' ' && s.tool === 'playback') {
      s.setPlayback({ isPlaying: !s.playback.isPlaying });
      ev.preventDefault();
    }
  };

  private clampToStage(p: Vec2): Vec2 {
    const { worldWidth, worldHeight } = useEditorStore.getState().stage;
    return { x: Math.max(0, Math.min(worldWidth, p.x)), y: Math.max(0, Math.min(worldHeight, p.y)) };
  }

  private drawOverlay(pointerWorld: Vec2): void {
    const g = this.overlayG;
    g.clear();
    const s = useEditorStore.getState();

    // 悬停高亮
    if (this.hover) {
      const puppet = s.puppets.find((p) => p.id === this.hover!.puppetId);
      const wp = puppet?.waypoints.find((w) => w.id === this.hover!.waypointId);
      if (wp) {
        g.circle(wp.pos.x, wp.pos.y, WAYPOINT_RADIUS + 5).stroke({ width: 2, color: COLORS.selectRing, alpha: 0.8 });
      }
    }
    if (this.hoverKf) {
      const puppet = s.puppets.find((p) => p.id === this.hoverKf!.puppetId);
      const wp = puppet?.waypoints.find((w) => w.id === this.hoverKf!.waypointId);
      if (wp) drawKeyframeDiamond(g, wp.pos.x, wp.pos.y, KEYFRAME_SIZE + 3, true);
    }

    // path 模式：从最后一个经过点到指针的橡皮筋（手绘虚线）
    if (s.tool === 'path' && s.selectedPuppetId && !this.drag) {
      const puppet = s.puppets.find((p) => p.id === s.selectedPuppetId);
      const last = puppet?.waypoints[puppet.waypoints.length - 1];
      if (last) {
        this.drawDashedLine(g, last.pos.x, last.pos.y, pointerWorld.x, pointerWorld.y, 8, 6);
      }
    }
  }

  private drawDashedLine(g: Graphics, x0: number, y0: number, x1: number, y1: number, dash: number, gap: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const total = Math.hypot(dx, dy);
    if (total < 1e-6) return;
    const ux = dx / total;
    const uy = dy / total;
    let travelled = 0;
    let drawing = true;
    let cx = x0;
    let cy = y0;
    while (travelled < total) {
      const seg = drawing ? Math.min(dash, total - travelled) : Math.min(gap, total - travelled);
      const nx = cx + ux * seg;
      const ny = cy + uy * seg;
      if (drawing) g.moveTo(cx, cy).lineTo(nx, ny);
      cx = nx;
      cy = ny;
      travelled += seg;
      drawing = !drawing;
    }
    g.stroke({ width: 2, color: COLORS.rubber, alpha: 0.9 });
  }

  /** 供 UI 按钮调用：视图复位 */
  fitView(): void {
    const { worldWidth, worldHeight } = useEditorStore.getState().stage;
    this.viewport.fit();
    this.viewport.moveCenter(worldWidth / 2, worldHeight / 2);
  }
}
