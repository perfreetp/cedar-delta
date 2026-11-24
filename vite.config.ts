import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules')) {
            if (id.includes('three') || id.includes('three-mesh-bvh') || id.includes('three-stdlib')) {
              return 'three';
            }
            if (id.includes('react') || id.includes('zustand')) {
              return 'react';
            }
          }
          return undefined;
        },
      },
    },
  },
});
