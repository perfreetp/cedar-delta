import type { TimelineStore } from './store';
import type { PlaybackController } from './playback';
import type { CraterScene } from '../scene/scene';

/**
 * 组件共享注册表。Web Components 之间不做复杂依赖注入，
 * 由根组件 cr-app 在启动时注册单例，子组件通过 getStore() 获取。
 */
interface Registry {
  store: TimelineStore | null;
  playback: PlaybackController | null;
  scene: CraterScene | null;
}

const registry: Registry = { store: null, playback: null, scene: null };

export function setStore(store: TimelineStore) {
  registry.store = store;
}
export function getStore(): TimelineStore {
  if (!registry.store) throw new Error('TimelineStore 尚未初始化');
  return registry.store;
}

/**
 * 组件连接时 store 可能尚未注入（自定义元素在父元素构造期就会同步触发
 * 子元素的 connectedCallback）。轮询等待 store 就绪后再执行初始化。
 */
export function whenStoreReady(fn: (store: TimelineStore) => void): void {
  if (registry.store) {
    fn(registry.store);
    return;
  }
  const timer = setInterval(() => {
    if (registry.store) {
      clearInterval(timer);
      fn(registry.store);
    }
  }, 16);
}
export function setPlayback(pb: PlaybackController) {
  registry.playback = pb;
}
export function getPlayback(): PlaybackController {
  if (!registry.playback) throw new Error('PlaybackController 尚未初始化');
  return registry.playback;
}
export function setScene(scene: CraterScene) {
  registry.scene = scene;
}
export function getScene(): CraterScene | null {
  return registry.scene;
}
