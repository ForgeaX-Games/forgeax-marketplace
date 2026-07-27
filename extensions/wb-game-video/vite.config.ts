/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { existsSync, createReadStream, statSync } from 'fs'
import type { ServerResponse, IncomingMessage } from 'http'
import { assetsDir, listAssets, getAsset, getStyleAxes, setStyleAxes, resolveAssetFilePath, mimeForPath } from './server/asset-registry'
import {
  createVideoUploadProxyHandler,
  parseAllowedExtraHosts,
  VIDEO_UPLOAD_PROXY_ROUTE_PREFIX,
} from './server/video-upload-proxy'
import { generateKeyframe, generateVideo, type OrchestrateCtx } from './server/generation/orchestrate'
import { importCharacterRefs, importSceneRefs } from './server/intake'
import type { MediaKind } from './src/editor/assets/registry-types'

/**
 * 视频游戏工坊 · dev/build 配置。
 *
 *   - React 插件
 *   - `/__gva__` 素材层读端点（D9 本地媒体兜底 + 生成编排；上传稳定 URL 就绪后删）
 *
 * 蓝图/项目/版本的**落盘与打版本已上收到 forgeax 宿主 `/api/game-host`**
 * （见 docs/superpowers/specs/2026-07-22-game-host-api-design.md）；扩展不再自建
 * `/__graph__` 写盘端点。dev 下 `/api/*` 经下方 server.proxy 转发到 forgeax server。
 */

/** forgeax server 源（game-host `/api/*` 落点）；默认 :18900，可用 env 覆盖。 */
const FORGEAX_SERVER =
  process.env.FORGEAX_SERVER_URL ??
  `http://localhost:${process.env.FORGEAX_SERVER_PORT ?? process.env.PORT_SERVER ?? 18900}`

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * 从某个起点目录向上找出含 `.forgeax/games` 的工程根。
 * 插件 vite `config.root` 是插件包目录，工程根在更上层，故向上探。
 * 找不到时返回 null（无盘落点；读回空、写拒绝——权威只在 `.forgeax/games/<slug>/game-video/`）。
 */
function findProjectRootWithForgeax(start: string): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, '.forgeax', 'games'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

function readGraphReqJson(req: { on: (ev: string, cb: (arg?: unknown) => void) => void }): Promise<Record<string, unknown>> {
  return new Promise((res, rej) => {
    let d = ''
    req.on('data', (c) => { d += String(c) })
    req.on('end', () => {
      try {
        res(d ? (JSON.parse(d) as Record<string, unknown>) : {})
      } catch (e) {
        rej(e)
      }
    })
    req.on('error', rej)
  })
}

// ─── Dev-only signed upload reverse proxy (port 15185) ───────────────────
function videoUploadProxyPlugin(): Plugin {
  return {
    name: 'gamevideo-video-upload-proxy',
    configureServer(server) {
      const allowedExtraHosts = parseAllowedExtraHosts(process.env.VIDEO_UPLOAD_PROXY_ALLOWED_HOSTS)
      server.middlewares.use(
        VIDEO_UPLOAD_PROXY_ROUTE_PREFIX,
        createVideoUploadProxyHandler({ allowedExtraHosts }),
      )
    },
  }
}

// ─── 游戏级共享素材层端点 ─────────────────────────────────────────────────
const GVA_ROUTE_PREFIX = '/__gva__'

/**
 * 素材层读端点（磁盘权威 = `.forgeax/games/<slug>/assets/`，写方=服务端 gen:* 工具）：
 *   GET /__gva__/assets?game=slug[&kind=video|image]   → { assets: MediaAsset[] }
 *   GET /__gva__/media/<id>?game=slug                   → 流式回二进制（支持 Range，便于视频拖播）
 * 无 `.forgeax/games` 工程根或无 slug 时 assets 返回空、media 404。
 */
function gameVideoAssetsPlugin(): Plugin {
  let projectRoot: string | null = null
  return {
    name: 'gamevideo-shared-assets',
    configResolved(config) {
      projectRoot = findProjectRootWithForgeax(config.root)
    },
    configureServer(server) {
      server.middlewares.use(GVA_ROUTE_PREFIX, (req: IncomingMessage, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const path = url.pathname.replace(/\/+$/, '') || '/'
          const method = (req.method ?? 'GET').toUpperCase()
          const slug = (url.searchParams.get('game') ?? '').trim() || null
          const dir = assetsDir(projectRoot, slug)

          if (path === '/assets' && method === 'GET') {
            if (!dir) return sendJson(res, 200, { assets: [] })
            const kindParam = url.searchParams.get('kind')
            const kind = kindParam === 'video' || kindParam === 'image' ? (kindParam as MediaKind) : undefined
            return sendJson(res, 200, { assets: listAssets(dir, kind ? { kind } : undefined) })
          }

          if (path.startsWith('/asset/') && method === 'GET') {
            if (!dir) return sendJson(res, 200, { asset: null })
            const id = decodeURIComponent(path.slice('/asset/'.length))
            return sendJson(res, 200, { asset: getAsset(dir, id) })
          }

          // 游戏级风格三轴（P3）：GET 读 manifest.styleAxes；POST 浅合并写回。
          if (path === '/style-axes' && method === 'GET') {
            if (!dir) return sendJson(res, 200, { styleAxes: null })
            return sendJson(res, 200, { styleAxes: getStyleAxes(dir) ?? null })
          }
          if (path === '/style-axes' && method === 'POST') {
            if (!dir) return sendJson(res, 400, { styleAxes: null, error: 'no assets dir / invalid slug' })
            readGraphReqJson(req)
              .then((body) => sendJson(res, 200, { styleAxes: setStyleAxes(dir, (body ?? {}) as Parameters<typeof setStyleAxes>[1]) }))
              .catch((e) => sendJson(res, 200, { styleAxes: null, error: (e as Error).message }))
            return
          }

          // 服务端 headless 生成（编辑器「重新生成」直触，dev 中间件内跑）：
          //   POST /__gva__/generate-video     body: VideoGenInput（缺 character/scene ref 硬闸报错）
          //   POST /__gva__/generate-keyframe  body: KeyframeInput
          if (path === '/generate-video' && method === 'POST') {
            if (!dir) return sendJson(res, 400, { asset: null, error: 'no assets dir / invalid slug' })
            const octx: OrchestrateCtx = { dir, gameId: slug!, env: process.env }
            readGraphReqJson(req)
              .then((body) => generateVideo(octx, body as unknown as Parameters<typeof generateVideo>[1]))
              .then((asset) => sendJson(res, 200, { asset }))
              .catch((e) => sendJson(res, 200, { asset: null, error: (e as Error).message }))
            return
          }
          if (path === '/generate-keyframe' && method === 'POST') {
            if (!dir) return sendJson(res, 400, { asset: null, error: 'no assets dir / invalid slug' })
            const octx: OrchestrateCtx = { dir, gameId: slug!, env: process.env }
            readGraphReqJson(req)
              .then((body) => generateKeyframe(octx, body as unknown as Parameters<typeof generateKeyframe>[1]))
              .then((asset) => sendJson(res, 200, { asset }))
              .catch((e) => sendJson(res, 200, { asset: null, error: (e as Error).message }))
            return
          }

          // 跨模块只读拿料（编辑器「导入参考图」直触）：
          //   POST /__gva__/import-character-refs  → 扫 characters/ 登记 character_ref
          //   POST /__gva__/import-scene-refs      → 扫 textures/ 登记 scene_ref
          if (path === '/import-character-refs' && method === 'POST') {
            if (!dir) return sendJson(res, 400, { refs: [], error: 'no assets dir / invalid slug' })
            try {
              const charactersDir = resolve(dir, '..', 'characters')
              return sendJson(res, 200, { refs: importCharacterRefs({ assetsDir: dir, charactersDir }) })
            } catch (e) {
              return sendJson(res, 200, { refs: [], error: (e as Error).message })
            }
          }
          if (path === '/import-scene-refs' && method === 'POST') {
            if (!dir) return sendJson(res, 400, { refs: [], error: 'no assets dir / invalid slug' })
            try {
              const texturesDir = resolve(dir, '..', 'textures')
              return sendJson(res, 200, { refs: importSceneRefs({ assetsDir: dir, texturesDir }) })
            } catch (e) {
              return sendJson(res, 200, { refs: [], error: (e as Error).message })
            }
          }

          if (path.startsWith('/media/') && (method === 'GET' || method === 'HEAD')) {
            if (!dir) return sendJson(res, 404, { error: 'no assets dir' })
            const id = decodeURIComponent(path.slice('/media/'.length))
            const asset = getAsset(dir, id)
            const file = asset ? resolveAssetFilePath(dir, asset) : null
            if (!asset || !file || !existsSync(file)) return sendJson(res, 404, { error: 'not found' })
            const size = statSync(file).size
            const mime = asset.mime ?? mimeForPath(file)
            res.setHeader('content-type', mime)
            res.setHeader('accept-ranges', 'bytes')
            res.setHeader('cache-control', 'no-store')
            const range = req.headers.range
            if (range) {
              const m = /bytes=(\d*)-(\d*)/.exec(range)
              const start = m && m[1] ? Number(m[1]) : 0
              const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
              if (start >= size || start > end) {
                res.statusCode = 416
                res.setHeader('content-range', `bytes */${size}`)
                return res.end()
              }
              res.statusCode = 206
              res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
              res.setHeader('content-length', String(end - start + 1))
              if (method === 'HEAD') return res.end()
              return createReadStream(file, { start, end }).pipe(res)
            }
            res.statusCode = 200
            res.setHeader('content-length', String(size))
            if (method === 'HEAD') return res.end()
            return createReadStream(file).pipe(res)
          }
          next()
        } catch (e) {
          sendJson(res, 500, { error: String(e) })
        }
      })
    },
  }
}

// ─── 游戏专属组件「源码免构建」dev 端点 ──────────────────────────────────────
const GAME_COMPONENTS_PREFIX = '/@game-components'

/**
 * dev 下把游戏仓 `components/index.tsx` **源码**经 vite 现场编译成浏览器 ESM 返回，
 * 供运行时 `component-host.loadGameComponents` 动态 import——**无需 `bun build` 产 dist**。
 *   GET /@game-components/<slug>/index.js → transform(.forgeax/games/<slug>/components/index.tsx)
 * 无源码 / 无工程根 → 404（loader 回落构建产物或平台内建集）。仅 serve 生效。
 */
function gameComponentsDevPlugin(): Plugin {
  let projectRoot: string | null = null
  return {
    name: 'gamevideo-game-components-dev',
    apply: 'serve',
    configResolved(config) {
      projectRoot = findProjectRootWithForgeax(config.root)
    },
    configureServer(server) {
      server.middlewares.use(GAME_COMPONENTS_PREFIX, async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const slug = /^\/([a-z0-9][a-z0-9-]{1,40})(?:\/|$)/.exec(url.pathname)?.[1] ?? null
          if (!projectRoot || !slug) return next()
          const dir = resolve(projectRoot, '.forgeax', 'games', slug, 'components')
          const tsx = resolve(dir, 'index.tsx')
          const ts = resolve(dir, 'index.ts')
          const abs = existsSync(tsx) ? tsx : existsSync(ts) ? ts : null
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          if (!abs) {
            res.statusCode = 404
            return res.end('// no game components source')
          }
          const result = await server.transformRequest('/@fs/' + abs)
          if (!result) {
            res.statusCode = 404
            return res.end('// transform failed')
          }
          res.statusCode = 200
          return res.end(result.code)
        } catch (e) {
          res.statusCode = 500
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          return res.end('// ' + String(e))
        }
      })
    },
  }
}

// 注：组件快照（平台 component-host/components → 游戏仓 components/）不是 per-save 数据，
// 属 seed/构建步骤，走 CLI `scripts/sync-components-to-game.mjs`，不在 vite / 保存链里做。
// 存储/打版本一律走 game-host 服务（/api/game-host）。

export default defineConfig(() => {
  // 作为 forgeax-studio 插件 build 时，host 把产物挂在 `/extensions/wb-game-video/`
  // 子路径下，需要绝对 base；独立 dev/preview/standalone 用相对 './'。
  const pluginBase =
    process.env.VITE_PLUGIN_BASE
    ?? (process.env.WB_GAMEVIDEO_PLUGIN_BUILD === '1' ? '/extensions/wb-game-video/' : './')

  return {
    base: pluginBase,
    plugins: [react(), videoUploadProxyPlugin(), gameVideoAssetsPlugin(), gameComponentsDevPlugin()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
      // tsc -b 可能在源码目录 emit stale .js；把 .ts/.tsx 放最前，避免 import 命中旧产物。
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    },
    server: {
      host: true,
      port: process.env.VITE_DEV_PORT ? Number(process.env.VITE_DEV_PORT) : 15185,
      strictPort: true,
      allowedHosts: true as const,
      // 允许 /@fs 读到 forgeax 仓根（游戏仓 .forgeax/games/<slug>/components 源码在扩展目录之外）——
      // gameComponentsDevPlugin 免构建现场编译游戏组件源码需要。
      fs: { allow: [resolve(__dirname, '..', '..', '..', '..')] },
      hmr: {
        clientPort: process.env.VITE_PLUGIN_HMR_CLIENT_PORT
          ? Number(process.env.VITE_PLUGIN_HMR_CLIENT_PORT)
          : process.env.HMR_CLIENT_PORT
            ? Number(process.env.HMR_CLIENT_PORT)
            : process.env.PORT_GAMEVIDEO_STUDIO
              ? Number(process.env.PORT_GAMEVIDEO_STUDIO)
              : undefined,
        ...(process.env.VITE_PLUGIN_HMR_PATH ? { path: process.env.VITE_PLUGIN_HMR_PATH } : {}),
      },
      // 落盘/打版本上收到宿主后，扩展 dev iframe 的 `/api/*`（含 game-host）转发到
      // forgeax server；prod 由 server 同源静态托管，无需代理。
      proxy: {
        // kino 走独立 127.0.0.1 落点（更具体的前缀排在通配 /api 之前）。
        '/api/v1/kino': {
          target: `http://127.0.0.1:${process.env.FORGEAX_SERVER_PORT ?? 18900}`,
          changeOrigin: true,
        },
        '/api': { target: FORGEAX_SERVER, changeOrigin: true },
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      // happy-dom 20.9.0 的 localStorage 在 vitest 下方法取不到 → setup 里补内存版兜底
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    },
    build: {
      outDir: 'dist',
      sourcemap: process.env.RS_NO_SOURCEMAP === '1' ? false : true,
    },
  }
})
