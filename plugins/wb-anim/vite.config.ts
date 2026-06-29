import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import { apiProxyPlugin } from './server/api-plugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)
  return {
    base: './',
    publicDir: 'public',
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'src/core'),
        '@pipelines': resolve(__dirname, 'src/pipelines'),
        '@shared': resolve(__dirname, 'src/shared'),
        // Required so server/src imports resolve during vitest
        '@forgeax/types': resolve(__dirname, '../../../types/src/index.ts'),
        '@forgeax/agent-runtime': resolve(__dirname, '../../../agent-runtime/src/index.ts'),
      },
    },
    plugins: [apiProxyPlugin()],
    optimizeDeps: {
      include: ['jszip'],
    },
    server: {
      host: true,
      port: 15174,
      strictPort: true,
      allowedHosts: true,
      hmr: {
        clientPort: Number(process.env.HMR_CLIENT_PORT || process.env.PORT_ANIM_EDITOR || 10021),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  }
})
