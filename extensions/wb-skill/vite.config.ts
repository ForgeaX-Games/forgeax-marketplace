import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'

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
        '@types': resolve(__dirname, 'src/types'),
        // Required so server/src imports resolve during vitest
        '@forgeax/types': resolve(__dirname, '../../../types/src/index.ts'),
        '@forgeax/agent-runtime': resolve(__dirname, '../../../agent-runtime/src/index.ts'),
      },
    },
    optimizeDeps: {
      include: ['three', 'jszip'],
    },
    server: {
      host: true,
      port: 15175,
      strictPort: true,
      allowedHosts: true,
      hmr: {
        clientPort: Number(process.env.HMR_CLIENT_PORT || process.env.PORT_SKILL_EDITOR || 10022),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  }
})
