/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, createReadStream, statSync } from 'fs'
import type { ServerResponse, IncomingMessage } from 'http'
import { assetsDir, listAssets, getAsset, getStyleAxes, setStyleAxes, resolveAssetFilePath, mimeForPath } from './server/asset-registry'
import { generateKeyframe, generateVideo, type OrchestrateCtx } from './server/generation/orchestrate'
import { importCharacterRefs, importSceneRefs } from './server/intake'
import type { MediaKind } from './src/editor/assets/registry-types'

/**
 * 视频游戏工坊 · dev/build 配置（graph-only）。
 *
 * 只保留新引擎 GameGraph 需要的东西：
 *   - React 插件
 *   - `/__graph__` 存储端点（把「主动保存的版本」落盘到
 *     `.forgeax/games/<slug>/game-video/scenarios.graph.json` + 版本快照，草稿走
 *     客户端 localStorage 不落盘）
 *
 * 旧 FMV 那套（LLM/图像/视频/TTS/音乐 的 key 注入与反代、`/__reel__/*` 素材/剧本/
 * 生成队列中间件、reel-minigames）已随 FMV 一并删除。
 */

const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

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

// ─── 新 graph 模型持久化端点 ────────────────────────────────────────────────
const GRAPH_ROUTE_PREFIX = '/__graph__'

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

/** 仅 `.forgeax/games/<slug>/game-video/`；缺工程根或 slug 则 null。 */
function graphDirForSlug(projectRoot: string | null, slug: string | null): string | null {
  if (!projectRoot || !slug || !GAME_SLUG_RE.test(slug)) return null
  return resolve(projectRoot, '.forgeax', 'games', slug, 'game-video')
}

/**
 * 图存储端点（磁盘为已保存版本的权威）：
 *   GET  /__graph__/store?game=slug          → { scenario(最新已保存), versions:[{id,savedAt}] }
 *   PUT  /__graph__/store?game=slug {scenario,id?,title?} → 写 scenarios.graph.json + 版本快照(留10) → { versions }
 *   GET  /__graph__/version?game=slug&id=vid → { scenario }
 * 草稿不落盘（走客户端 localStorage）。无 `.forgeax` 工程根时 GET 空、PUT 400。
 */
function graphStorePlugin(): Plugin {
  let projectRoot: string | null = null
  return {
    name: 'gamevideo-graph-store',
    configResolved(config) {
      projectRoot = findProjectRootWithForgeax(config.root)
    },
    configureServer(server) {
      server.middlewares.use(GRAPH_ROUTE_PREFIX, async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const path = url.pathname.replace(/\/+$/, '') || '/'
          const method = (req.method ?? 'GET').toUpperCase()
          const slug = (url.searchParams.get('game') ?? '').trim() || null
          const dir = graphDirForSlug(projectRoot, slug)
          const readJson = (p: string): unknown => {
            try {
              return JSON.parse(readFileSync(p, 'utf-8'))
            } catch {
              return null
            }
          }
          if (path === '/store' && method === 'GET') {
            if (!dir) return sendJson(res, 200, { scenario: null, versions: [] })
            const canonical = resolve(dir, 'scenarios.graph.json')
            const indexPath = resolve(dir, 'scenarios.graph.versions', 'index.json')
            const container = readJson(canonical) as { items?: { scenario?: unknown }[] } | null
            const scenario = container?.items?.[0]?.scenario ?? null
            return sendJson(res, 200, { scenario, versions: readJson(indexPath) ?? [] })
          }
          if (path === '/store' && method === 'PUT') {
            if (!dir) return sendJson(res, 400, { error: 'no .forgeax/games root or invalid game slug' })
            const body = await readGraphReqJson(req)
            const scenario = body.scenario as { id?: string } | undefined
            if (!scenario) return sendJson(res, 400, { error: 'no scenario' })
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            const canonical = resolve(dir, 'scenarios.graph.json')
            const vDir = resolve(dir, 'scenarios.graph.versions')
            const indexPath = resolve(vDir, 'index.json')
            const id = (body.id as string) ?? scenario.id ?? 'graph'
            const title = (body.title as string) ?? 'graph'
            writeFileSync(canonical, JSON.stringify({ version: 1, activeId: id, items: [{ id, title, scenario }] }, null, 2))
            if (!existsSync(vDir)) mkdirSync(vDir, { recursive: true })
            const vid = `v-${Date.now().toString(36)}`
            writeFileSync(resolve(vDir, `${vid}.json`), JSON.stringify(scenario))
            const index = [{ id: vid, savedAt: Date.now() }, ...(((readJson(indexPath) as { id: string; savedAt: number }[]) ?? []))].slice(0, 10)
            writeFileSync(indexPath, JSON.stringify(index))
            return sendJson(res, 200, { versions: index })
          }
          if (path === '/version' && method === 'GET') {
            if (!dir) return sendJson(res, 404, { scenario: null })
            const vid = url.searchParams.get('id') ?? ''
            const scenario = readJson(resolve(dir, 'scenarios.graph.versions', `${vid}.json`))
            return sendJson(res, scenario ? 200 : 404, { scenario })
          }
          next()
        } catch (e) {
          sendJson(res, 500, { error: String(e) })
        }
      })
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
            const octx: OrchestrateCtx = { dir, env: process.env }
            readGraphReqJson(req)
              .then((body) => generateVideo(octx, body as unknown as Parameters<typeof generateVideo>[1]))
              .then((asset) => sendJson(res, 200, { asset }))
              .catch((e) => sendJson(res, 200, { asset: null, error: (e as Error).message }))
            return
          }
          if (path === '/generate-keyframe' && method === 'POST') {
            if (!dir) return sendJson(res, 400, { asset: null, error: 'no assets dir / invalid slug' })
            const octx: OrchestrateCtx = { dir, env: process.env }
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

export default defineConfig(() => {
  // 作为 forgeax-studio 插件 build 时，host 把产物挂在 `/extensions/wb-game-video/`
  // 子路径下，需要绝对 base；独立 dev/preview/standalone 用相对 './'。
  const pluginBase =
    process.env.VITE_PLUGIN_BASE
      ?? (process.env.WB_GAMEVIDEO_PLUGIN_BUILD === '1' ? '/extensions/wb-game-video/' : './')

  return {
    base: pluginBase,
    plugins: [react(), graphStorePlugin(), gameVideoAssetsPlugin()],
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
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      // happy-dom 20.9.0 的 localStorage 在 vitest 下方法取不到 → setup 里补内存版兜底
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    },
    build: {
      outDir: 'dist',
      sourcemap: process.env.RS_NO_SOURCEMAP === '1' ? false : true,
    },
  }
})
