import { defineConfig } from 'vite'
import { apiProxyPlugin } from './server/api-plugin'

export default defineConfig({
  base: './',
  plugins: [apiProxyPlugin()],
  server: {
    port: 7821,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
})
