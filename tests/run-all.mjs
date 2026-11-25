/**
 * 统一测试入口：核心单测（Node）→ 三组浏览器端到端（依赖 Vite dev server）。
 * 用法：先启动 dev server（npm run dev），再 node tests/run-all.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const run = (cmd, args, label) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
    p.on('close', (code) => {
      console.log(`\n[${label}] exit=${code}`);
      resolve(code);
    });
  });

let failed = 0;
failed += await run('npx', ['tsx', 'tests/smoke.test.ts'], 'unit');
for (const suite of ['e2e.mjs', 'e2e-interaction.mjs', 'e2e-align.mjs']) {
  failed += await run('node', [`tests/${suite}`], suite);
}
if (failed) {
  console.error(`\n${failed} 个测试步骤失败`);
  process.exit(1);
}
console.log('\n全部测试通过 ✔');
