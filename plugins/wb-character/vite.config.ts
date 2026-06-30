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
      '@ui': resolve(__dirname, 'src/ui'),
      '@pipelines': resolve(__dirname, 'src/pipelines'),
    },
  },
  plugins: [apiProxyPlugin()],
  optimizeDeps: {
    // 让 vite 启动时一次性预打包,避免大依赖在 dev 第一次请求时被反复 esbuild。
    include: ['three', 'three/addons/controls/OrbitControls.js', 'jszip'],
  },
  server: {
    host: true,
    port: 15173,
    strictPort: true,
    allowedHosts: true,
    // 容器内 Vite 监听 15173，但浏览器走宿主机 PORT_CHAR_EDITOR（默认 10020）。
    // 不设 clientPort 时 Vite 会让浏览器连 15173，触发 ERR_CONNECTION_REFUSED，
    // HMR/热更新全废。从 env 读出宿主端口下发给浏览器。
    hmr: {
      clientPort: Number(process.env.HMR_CLIENT_PORT || process.env.PORT_CHAR_EDITOR || 10020),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}
})
