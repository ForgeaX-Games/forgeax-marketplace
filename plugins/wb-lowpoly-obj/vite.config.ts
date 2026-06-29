import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 15174,
    host: true,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
