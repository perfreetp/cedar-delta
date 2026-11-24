import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['manifold-3d']
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600
  },
  server: {
    host: '127.0.0.1'
  }
})
