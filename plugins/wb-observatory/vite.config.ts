import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built and consumed as a workbench plugin mounted at /plugins/wb-observatory/.
// `base` makes Vite emit asset URLs prefixed with that path so dist/ works behind
// the host serveStatic. Dev port 5176 keeps it clear of other plugin dev servers;
// the proxy lets `bun run dev` developers hit the running forgeax-server
// (default http://localhost:18900) without iframing through the studio.
export default defineConfig({
  base: '/plugins/wb-observatory/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
  server: {
    port: 5176,
    proxy: {
      '/api/observatory': {
        target: process.env.VITE_API_TARGET || 'http://localhost:18900',
        changeOrigin: true,
      },
    },
  },
});
