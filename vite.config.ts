import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  assetsInclude: ['**/*.wasm'],
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      ignored: ['**/.smoke/**', '**/dist/**'],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
});
