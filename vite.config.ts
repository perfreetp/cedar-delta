import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    // ECharts 约 1MB,单页应用无需拆包;提高告警阈值避免噪音
    chunkSizeWarningLimit: 1400,
  },
});
