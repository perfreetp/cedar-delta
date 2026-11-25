import { TimelineStore } from './core/store';
import { setStore } from './core/registry';
import { evaluateTimeline } from './core/evaluator';

// 必须先建仓库并注入 registry，再导入会注册自定义元素的 cr-app ——
// 元素升级/连接时各组件即可拿到 store。
const store = new TimelineStore();
setStore(store);

// 调试/自动化测试句柄（在导入组件前挂好，供组件连接阶段使用）
const w = window as unknown as {
  __store: TimelineStore;
  __evaluate: typeof evaluateTimeline;
};
w.__store = store;
w.__evaluate = evaluateTimeline;

await import('./ui/cr-app');
