import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve src/ without pulling in @types/node (avoids node: imports here).
const SRC_DIR = new URL('./src/', import.meta.url).pathname;

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@/': SRC_DIR,
    },
  },
  server: {
    port: 7820,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
