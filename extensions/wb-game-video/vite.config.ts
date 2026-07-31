/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import type { ConfigEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { createViteWorkbenchPlugin } from '@forgeax/workbench-host/vite'
import { createDevWorkbenchHost } from './server/dev-host'

export default defineConfig(({ command }: ConfigEnv) => ({
  base: process.env.VITE_PLUGIN_BASE
    ?? (process.env.WB_GAME_VIDEO_PLUGIN_BUILD === '1' ? '/extensions/wb-game-video/' : './'),
  plugins: [
    react(),
    ...(command === 'serve'
      ? [createViteWorkbenchPlugin(createDevWorkbenchHost())]
      : []),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
  server: {
    host: true,
    port: 15185,
    strictPort: true,
    allowedHosts: true as const,
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
