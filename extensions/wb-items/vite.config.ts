import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const SRC_DIR = fileURLToPath(new URL('./src', import.meta.url));
const SHARED_DIR = fileURLToPath(new URL('./shared', import.meta.url));
const devPort = Number(process.env.VITE_DEV_PORT ?? 15177);
const serverOrigin = process.env.FORGEAX_SERVER_ORIGIN ?? 'http://localhost:18900';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': SRC_DIR,
      '@shared': SHARED_DIR,
    },
  },
  server: {
    port: devPort,
    host: true,
    strictPort: true,
    proxy: {
      '/api': { target: serverOrigin, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
