// 核心布局逻辑冒烟测试:种子确定性 / 手改保留 / 分组重算 / 深度夹紧
import { createRoot } from 'solid-js';

const store = await import('./src/store.js');
const {
  layout, setSeed, seed, setParam, params, commitEdit, edits, maxDepthCm,
} = store;

const sig = () => layout().bars.map((b) => `${b.x.toFixed(2)}:${b.depthCm}:${b.group}`).join('|');

// 1) 同种子同版面
const a = sig();
setSeed('OTHER-1');
const b = sig();
console.log('换种子整版重排:', a !== b ? 'OK' : 'FAIL');
setSeed('CPR-2026');
console.log('同种子复原:', sig() === a ? 'OK' : 'FAIL');

// 2) 手改后调频率档位:手改条不动,其余重排
commitEdit('b5', 300, 6.5);
commitEdit('b9', 450, 5.0);
const before = layout().bars;
const m5 = before.find((x) => x.id === 'b5');
const m9 = before.find((x) => x.id === 'b9');
setParam('rateTier', 5);
const after = layout().bars;
const a5 = after.find((x) => x.id === 'b5');
const a9 = after.find((x) => x.id === 'b9');
console.log('手改条位置不动:', a5.x === m5.x && a5.depthCm === m5.depthCm && a9.x === m9.x ? 'OK' : 'FAIL');
console.log('总条数随频率档位变化:', before.length !== after.length ? `OK (${before.length}→${after.length})` : 'FAIL');
const autoMoved = after.some((x) => !x.manual && Math.abs(x.x - (before.find((y) => y.id === x.id) || { x: -1 }).x) > 0.01);
console.log('未手改部分重排:', autoMoved ? 'OK' : 'FAIL');

// 3) 分组编号按 x 重算
const gs = params.groupSize;
const sorted = [...after].sort((p, q) => p.x - q.x);
const groupOk = sorted.every((bar, k) => bar.group === Math.floor(k / gs) + 1);
console.log('分组编号重算正确:', groupOk ? 'OK' : 'FAIL');

// 4) 深度档位夹紧手改深度
setParam('depthTier', 1); // maxDepth = 4
console.log('手改深度被夹到量程内:', edits.b5.depthCm <= 4 ? `OK (${edits.b5.depthCm})` : 'FAIL');
console.log('量程:', maxDepthCm() === 4 ? 'OK' : 'FAIL');

// 5) 手位偏移挤动组距
setParam('depthTier', 3);
const gap0 = layout().gap;
setParam('handOffset', 2);
const gapPos = layout().gap;
setParam('handOffset', -2);
const gapNeg = layout().gap;
console.log('手位偏移挤动组距:', gapPos < gap0 && gap0 < gapNeg ? `OK (${gapNeg}/${gap0}/${gapPos})` : 'FAIL');
