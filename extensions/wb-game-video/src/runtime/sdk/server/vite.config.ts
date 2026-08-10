import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { gameMediaPlugin } from './game-media-middleware'
import { resolveViteDevPort } from '../../../../scripts/vite-dev-port'

const configDir = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(configDir, '..', '..', '..', '..')
const standaloneRoot = resolve(configDir, '..', 'standalone')
const standaloneEntry = 'wb-game-video.html'
const forgeaxServer = process.env.FORGEAX_SERVER_URL
  ?? `http://localhost:${process.env.FORGEAX_SERVER_PORT ?? process.env.PORT_SERVER ?? 18900}`

const proxy = {
  '/api/v1/kino': {
    target: `http://127.0.0.1:${process.env.FORGEAX_SERVER_PORT ?? 18900}`,
    changeOrigin: true,
  },
  '/api': { target: forgeaxServer, changeOrigin: true },
}

export default {
  root: standaloneRoot,
  base: './',
  plugins: [react(), gameMediaPlugin({ gameHostOrigin: forgeaxServer })],
  resolve: {
    alias: { '@': resolve(extensionRoot, 'src') },
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
  server: {
    host: true,
    port: resolveViteDevPort(),
    strictPort: true,
    allowedHosts: true,
    proxy,
  },
  preview: {
    host: true,
    port: resolveViteDevPort(),
    strictPort: true,
    allowedHosts: true,
    proxy,
  },
  build: {
    outDir: resolve(extensionRoot, 'dist', 'standalone'),
    emptyOutDir: true,
    sourcemap: process.env.RS_NO_SOURCEMAP === '1' ? false : true,
    rollupOptions: {
      input: {
        'wb-game-video': resolve(standaloneRoot, standaloneEntry),
      },
    },
  },
}
