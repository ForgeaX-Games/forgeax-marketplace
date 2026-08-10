/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import type { ConfigEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { createViteWorkbenchPlugin } from '@forgeax/workbench-host/vite'
import { createDevWorkbenchHost } from './server/dev-host'
import { resolveViteDevPort } from './scripts/vite-dev-port'

export { resolveViteDevPort } from './scripts/vite-dev-port'

export default defineConfig(({ command }: ConfigEnv) => ({
  base: process.env.VITE_PLUGIN_BASE
    ?? (process.env.WB_GAME_VIDEO_PLUGIN_BUILD === '1' ? '/extensions/wb-game-video/' : './'),
  plugins: [
    react(),
    // Vitest loads this config with command=serve; skip the local games-root
    // mkdir (can resolve outside the checkout, e.g. /Users/you/games).
    ...(command === 'serve' && !process.env.VITEST
      ? [createViteWorkbenchPlugin(createDevWorkbenchHost())]
      : []),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
  server: {
    host: true,
    port: resolveViteDevPort(),
    strictPort: true,
    allowedHosts: true as const,
    // Asset CRUD still uses extension-owned `/api/*` routes in standalone dev.
    // Video generation itself goes through the Workbench Host handshake/tool endpoint.
    proxy: {
      '/api': process.env.FORGEAX_SERVER_URL
        ?? `http://localhost:${process.env.FORGEAX_SERVER_PORT ?? process.env.PORT_SERVER ?? 18900}`,
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.RS_NO_SOURCEMAP === '1' ? false : true,
  },
}))
