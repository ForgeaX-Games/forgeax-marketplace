import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)
  return {
    base: './',
    publicDir: 'public',
    resolve: {
      alias: [
        { find: '@core', replacement: resolve(__dirname, 'src/core') },
        { find: '@pipelines', replacement: resolve(__dirname, 'src/pipelines') },
        { find: '@types', replacement: resolve(__dirname, 'src/types') },
        // Cross-repo contracts live under packages/contracts/.
        // Subpath exports (`@forgeax/types/...`) must resolve too — Vitest
        // pulls forgeax-cli which imports those entry points.
        {
          find: /^@forgeax\/types\/(.+)$/,
          replacement: `${resolve(__dirname, '../../../contracts/types/src')}/$1.ts`,
        },
        {
          find: '@forgeax/types',
          replacement: resolve(__dirname, '../../../contracts/types/src/index.ts'),
        },
        {
          find: /^@forgeax\/agent-runtime\/(.+)$/,
          replacement: `${resolve(__dirname, '../../../contracts/agent-runtime/src')}/$1.ts`,
        },
        {
          find: '@forgeax/agent-runtime',
          replacement: resolve(__dirname, '../../../contracts/agent-runtime/src/index.ts'),
        },
      ],
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
