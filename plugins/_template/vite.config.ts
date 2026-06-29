import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Resolve src/ without pulling in @types/node (avoids node: imports here).
// No trailing slash: @rollup/plugin-alias matches a string key only when the
// importee is exactly the key or is followed by `/`. A `@/` key never matches
// `@/lib/...` (the char after `@/` is `l`, not `/`), so build resolution fails.
const SRC_DIR = new URL('./src', import.meta.url).pathname;

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': SRC_DIR,
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
