// 导入/导出与文档往返测试：npx tsx src/lib/__tests__/io.test.ts
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultDocument } from '../preset';
import { exportDocument, importDocument, validateDocument } from '../io';

let passed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) {
    console.error(`✗ ${name} ${detail}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`✓ ${name}`);
  }
}

// 直接构造 envelope 走导入校验（exportDocument 依赖 DOM，这里模拟其输出）
const doc = createDefaultDocument();
doc.keyframes.push({
  id: 'kf_test',
  time: 1.5,
  pose: { elbow_l: [0, 0, 30] },
});

const dir = mkdtempSync(join(tmpdir(), 'rig-'));
const file = join(dir, 'test.rig.json');
const envelope = {
  magic: 'PUPPET_RIG_DOC',
  version: 1,
  exportedAt: new Date().toISOString(),
  document: doc,
};
writeFileSync(file, JSON.stringify(envelope));

const imported = await importDocument(new File([readFileSync(file)], 'test.rig.json', { type: 'application/json' }));
check('导入保留全部关节', imported.joints.length === doc.joints.length);
check('导入保留关键帧', imported.keyframes.length === 1 && imported.keyframes[0].id === 'kf_test');
check('导入保留牵引杆绑定', imported.rod.bindings.length === doc.rod.bindings.length);
check('导入保留时长', imported.duration === doc.duration);

// 损坏文件应被拒绝
try {
  validateDocument({} as never);
  check('非法文档被拒绝', false);
} catch {
  check('非法文档被拒绝', true);
}

try {
  const bad = { ...doc, joints: doc.joints.map((j) => (j.id === 'neck' ? { ...j, parentId: 'ghost' } : j)) };
  validateDocument(bad);
  check('悬空父关节引用被拒绝', false);
} catch {
  check('悬空父关节引用被拒绝', true);
}

try {
  await importDocument(new File([JSON.stringify({ hello: 'world' })], 'x.json', { type: 'application/json' }));
  check('缺少 magic 标识被拒绝', false);
} catch {
  check('缺少 magic 标识被拒绝', true);
}

// exportDocument 仅做 DOM 存在性检查（jsdom 环境外不应抛在导入阶段）
check('exportDocument 是函数', typeof exportDocument === 'function');

console.log(`\n${passed} 项通过`);
