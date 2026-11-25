import { describe, expect, it } from 'vitest';
import {
  easingForward,
  easingInverse,
  inverseSmoothstep,
  locateSegment,
  smoothstep,
} from '../src/core/easing';
import { globalTimeOfLocal, localTimeAt, evaluateTimeline, trackChain } from '../src/core/evaluator';
import { TimelineStore, validateDocument, createDefaultDocument } from '../src/core/store';
import type { GroupTrack, LeafTrack, TimelineDocument, Track } from '../src/core/model';
import { makeId, MAX_DEPTH } from '../src/core/model';

describe('缓动正反函数', () => {
  it('smoothstep 端点与单调性', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    for (const x of [0.1, 0.33, 0.7, 0.95]) {
      expect(inverseSmoothstep(smoothstep(x))).toBeCloseTo(x, 10);
    }
  });

  it('三种缓动的正反映射互逆（step 为离散映射）', () => {
    for (const x of [0, 0.2, 0.5, 0.8, 1]) {
      expect(easingInverse('linear', easingForward('linear', x))).toBeCloseTo(x, 10);
      expect(easingInverse('ease', easingForward('ease', x))).toBeCloseTo(x, 10);
    }
    expect(easingForward('step', 0.2)).toBe(0);
    expect(easingForward('step', 0.7)).toBe(1);
    expect(easingInverse('step', 0)).toBe(0.25);
    expect(easingInverse('step', 1)).toBe(0.75);
  });
});

describe('关键帧段定位', () => {
  it('二分定位与端点钳制', () => {
    const frames = [{ time: 0 }, { time: 0.4 }, { time: 1 }];
    expect(locateSegment(frames, -1).prev).toBe(0);
    expect(locateSegment(frames, 2).prev).toBe(2);
    const mid = locateSegment(frames, 0.7);
    expect(mid.prev).toBe(1);
    expect(mid.next).toBe(2);
    expect(mid.t).toBeCloseTo(0.5);
  });
});

/** 构造三层嵌套文档：root group -> sub group -> leaf */
function nestedDoc(groupEasing: 'linear' | 'ease' | 'step' = 'ease'): TimelineDocument {
  const leaf: LeafTrack = {
    id: 'leaf',
    name: 'leaf',
    kind: 'crater',
    start: 2,
    duration: 6,
    easing: 'linear',
    muted: false,
    keyframes: [
      { id: 'k1', time: 0, radius: 1, depth: 1, rimHeight: 1 },
      { id: 'k2', time: 1, radius: 9, depth: 3, rimHeight: 2 },
    ],
  };
  const sub: GroupTrack = {
    id: 'sub',
    name: 'sub',
    kind: 'group',
    start: 2,
    duration: 8,
    easing: 'linear',
    muted: false,
    children: [leaf],
  };
  const root: GroupTrack = {
    id: 'root',
    name: 'root',
    kind: 'group',
    start: 0,
    duration: 20,
    easing: groupEasing,
    muted: false,
    children: [sub],
  };
  return { version: 1, duration: 20, tracks: [root] };
}

describe('嵌套时间映射', () => {
  it('正反映射互逆（linear）', () => {
    const doc = nestedDoc('linear');
    const chain = trackChain(doc, 'leaf')!;
    expect(chain.length).toBe(3);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const g = globalTimeOfLocal(chain, u);
      expect(localTimeAt(chain, g)).toBeCloseTo(u, 9);
    }
  });

  it('正反映射互逆（ease，三层）', () => {
    const doc = nestedDoc('ease');
    const chain = trackChain(doc, 'leaf')!;
    for (const u of [0.05, 0.3, 0.5, 0.72, 0.98]) {
      const g = globalTimeOfLocal(chain, u);
      expect(localTimeAt(chain, g)).toBeCloseTo(u, 9);
    }
  });

  it('未激活区间返回 null', () => {
    const doc = nestedDoc('linear');
    const chain = trackChain(doc, 'leaf')!;
    // leaf 全局占用 [4,10]
    expect(localTimeAt(chain, 1)).toBeNull();
    expect(localTimeAt(chain, 15)).toBeNull();
    expect(localTimeAt(chain, 7)).not.toBeNull();
  });

  it('改父分组缓动后子关键帧全局位置重排、局部数据不变', () => {
    const doc = nestedDoc('linear');
    const chain = trackChain(doc, 'leaf')!;
    const linearPos = globalTimeOfLocal(chain, 0.5);

    const root = doc.tracks[0] as GroupTrack;
    root.easing = 'ease';
    // 线性时中点恰在区间中央；ease(smoothstep) 中点仍 0.5，取 0.25 验证偏移
    const p25Linear = (() => {
      root.easing = 'linear';
      return globalTimeOfLocal(chain, 0.25);
    })();
    root.easing = 'ease';
    const p25Eased = globalTimeOfLocal(chain, 0.25);

    expect(p25Eased).not.toBeCloseTo(p25Linear, 6);
    expect(linearPos).toBeGreaterThan(0);
    // 局部关键帧 time 字段保持 0/1 不变
    const leaf = chain[2] as LeafTrack;
    expect(leaf.keyframes.map((k) => k.time)).toEqual([0, 1]);
    // ease 在前段推进更快：0.25 比例对应的全局位置应更早
    expect(p25Eased).toBeLessThan(p25Linear);
  });
});

describe('评测引擎：拖动与播放同源', () => {
  it('同一时间点重复评测结果完全相同（纯函数）', () => {
    const doc = createDefaultDocument();
    const a = evaluateTimeline(doc, 7.3);
    const b = evaluateTimeline(doc, 7.3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('三种插值产生不同的段内值', () => {
    const mk = (easing: 'linear' | 'ease' | 'step'): TimelineDocument => ({
      version: 1,
      duration: 10,
      tracks: [
        {
          id: 'c',
          name: 'c',
          kind: 'crater',
          start: 0,
          duration: 10,
          easing,
          muted: false,
          keyframes: [
            { id: 'a', time: 0, radius: 0, depth: 1, rimHeight: 1 },
            { id: 'b', time: 1, radius: 10, depth: 1, rimHeight: 1 },
          ],
        },
      ],
    });
    const t = 5; // 段内 50%
    const lin = evaluateTimeline(mk('linear'), t).samples[0].crater!;
    const ease = evaluateTimeline(mk('ease'), t).samples[0].crater!;
    expect(lin.radius).toBeCloseTo(5, 6);
    expect(ease.radius).toBeCloseTo(5, 6); // smoothstep(0.5)=0.5
    const t2 = 2.5; // 段内 25%
    expect(evaluateTimeline(mk('ease'), t2).samples[0].crater!.radius).toBeCloseTo(10 * smoothstep(0.25), 6);
    expect(evaluateTimeline(mk('step'), t2).samples[0].crater!.radius).toBeCloseTo(0, 6);
  });

  it('静音轨不出现在 activeTrackIds，独奏时只有该轨激活', () => {
    const doc = createDefaultDocument();
    const store = new TimelineStore(doc);
    const leafId = doc.tracks[0].id; // camera
    store.toggleMute(leafId);
    const ev = evaluateTimeline(doc, 5);
    expect(ev.activeTrackIds).not.toContain(leafId);
    expect(ev.mutedTrackIds).toContain(leafId);

    const other = ev.samples.find((s) => s.trackId !== leafId)!;
    store.setSolo(other.trackId);
    // 评测结果本身仍包含所有样本，独奏过滤在播放控制器；这里验证 store 状态
    expect(store.soloTrackId).toBe(other.trackId);
    expect(store.isEffectivelyMuted(leafId)).toBe(true);
    expect(store.isEffectivelyMuted(other.trackId)).toBe(false);
  });
});

describe('Store 操作', () => {
  it('嵌套深度限制为三层', () => {
    const store = new TimelineStore({ version: 1, duration: 10, tracks: [] });
    const g1 = store.addTrack('group') as GroupTrack;
    const g2 = store.addTrack('group', g1.id) as GroupTrack;
    const g3 = store.addTrack('group', g2.id);
    expect(g3).toBeDefined();
    // 第 4 层应抛错
    expect(() => store.addTrack('camera', g3.id)).toThrow(MAX_DEPTH.toString() as unknown as string);
  });

  it('编组与解散保持时间区间', () => {
    const store = new TimelineStore({ version: 1, duration: 20, tracks: [] });
    const a = store.addTrack('crater');
    store.updateTrack(a.id, { start: 2, duration: 6 });
    const b = store.addTrack('ejecta');
    store.updateTrack(b.id, { start: 8, duration: 8 });
    const group = store.groupTracks([a.id, b.id]);
    expect(group.start).toBeCloseTo(2);
    expect(group.duration).toBeCloseTo(14);
    const children = group.children;
    expect(children[0].start).toBeCloseTo(0);
    store.ungroupTrack(group.id);
    const restored = store.doc.tracks.find((t) => t.id === a.id)!;
    expect(restored.start).toBeCloseTo(2);
    expect(restored.duration).toBeCloseTo(6);
  });

  it('多选（Ctrl 式累加）后一次性编组多条同级轨道', () => {
    const store = new TimelineStore({ version: 1, duration: 20, tracks: [] });
    const a = store.addTrack('crater');
    const b = store.addTrack('ejecta');
    const c = store.addTrack('camera');
    store.select(a.id);
    store.select(b.id, true);
    expect(store.effectiveSelection().sort()).toEqual([a.id, b.id].sort());
    const group = store.groupTracks(store.effectiveSelection());
    expect(group.children.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    // c 仍在根层
    expect(store.doc.tracks.map((t) => t.id)).toContain(c.id);
  });

  it('关键帧复制到指定时间点生成新 id 且保留数值', () => {
    const store = new TimelineStore({ version: 1, duration: 10, tracks: [] });
    const track = store.addTrack('crater') as LeafTrack;
    const kf = track.keyframes[0];
    const copy = store.copyKeyframeAt(track.id, kf.id, 5);
    expect(copy.id).not.toBe(kf.id);
    expect((copy as { radius: number }).radius).toBe((kf as { radius: number }).radius);
    expect(track.keyframes).toHaveLength(4);
  });

  it('时间线长度拉伸并钳制轨道', () => {
    const store = new TimelineStore({ version: 1, duration: 10, tracks: [] });
    const t = store.addTrack('camera');
    store.setDuration(40);
    expect(store.doc.duration).toBe(40);
    expect(t.duration).toBeLessThanOrEqual(40);
    store.setDuration(2);
    expect(t.duration).toBeLessThanOrEqual(2);
  });
});

describe('JSON 导入导出还原', () => {
  it('导出再导入：层级、关键帧时间、插值曲线完全还原', () => {
    const doc = createDefaultDocument();
    const store1 = new TimelineStore(doc);
    const json = store1.exportJSON();
    const store2 = new TimelineStore();
    store2.loadJSON(json);
    expect(JSON.stringify(store2.doc)).toBe(JSON.stringify(doc));

    // 评测结果在若干时间点一致
    for (const t of [0, 1.5, 5, 9.9, 13, 19.99]) {
      expect(JSON.stringify(evaluateTimeline(store2.doc, t))).toBe(
        JSON.stringify(evaluateTimeline(doc, t)),
      );
    }
  });

  it('非法文档被拒绝', () => {
    expect(() => validateDocument({})).toThrow();
    expect(() => validateDocument({ version: 2, duration: 5, tracks: [] })).toThrow();
    const bad: unknown = {
      version: 1,
      duration: 5,
      tracks: [{ id: 'x', name: 'x', kind: 'camera', start: 0, duration: 99, easing: 'linear', muted: false, keyframes: [] }],
    };
    expect(() => validateDocument(bad)).toThrow();
    const badEasing: unknown = {
      version: 1,
      duration: 5,
      tracks: [{ id: 'x', name: 'x', kind: 'camera', start: 0, duration: 5, easing: 'bounce', muted: false, keyframes: [] }],
    };
    expect(() => validateDocument(badEasing)).toThrow();
  });
});

describe('相机弧线与朝向约束', () => {
  it('相机位置由球面坐标换算并带目标点', () => {
    const doc: TimelineDocument = {
      version: 1,
      duration: 10,
      tracks: [
        {
          id: 'cam',
          name: 'cam',
          kind: 'camera',
          start: 0,
          duration: 10,
          easing: 'linear',
          muted: false,
          keyframes: [
            { id: 'a', time: 0, radius: 20, azimuth: 0, elevation: 0, target: [0, 0, 0] },
            { id: 'b', time: 1, radius: 20, azimuth: Math.PI / 2, elevation: Math.PI / 4, target: [0, 2, 0] },
          ],
        },
      ],
    };
    const ev = evaluateTimeline(doc, 5);
    const cam = ev.samples[0].camera!;
    // 半程：方位角 PI/4，俯仰 PI/8，半径 20
    expect(cam.azimuth).toBeCloseTo(Math.PI / 4, 6);
    expect(cam.elevation).toBeCloseTo(Math.PI / 8, 6);
    expect(cam.target[1]).toBeCloseTo(1, 6);
    expect(cam.position[0] ** 2 + cam.position[1] ** 2 + cam.position[2] ** 2).toBeCloseTo(400, 6);
  });
});

describe('默认文档结构', () => {
  it('包含三类叶子轨且最深为三层', () => {
    const doc = createDefaultDocument();
    const kinds = new Set<string>();
    let maxDepth = 0;
    const walk = (tracks: Track[], d: number) => {
      maxDepth = Math.max(maxDepth, d);
      for (const t of tracks) {
        if (t.kind !== 'group') kinds.add(t.kind);
        if ('children' in t) walk(t.children ?? [], d + 1);
      }
    };
    walk(doc.tracks ?? [], 1);
    expect(kinds).toEqual(new Set(['camera', 'crater', 'ejecta']));
    expect(maxDepth).toBe(MAX_DEPTH);
    expect(makeId('x')).not.toBe(makeId('x'));
  });
});
