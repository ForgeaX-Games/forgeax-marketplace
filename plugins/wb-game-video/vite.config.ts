/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import type { ServerResponse } from 'http'

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
 * 找不到时返回 null（回退到包内 `.gamevideo-scenarios/games/<slug>`）。
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

function graphDirForSlug(projectRoot: string | null, baseRoot: string, slug: string | null): string {
  if (slug && GAME_SLUG_RE.test(slug)) {
    return projectRoot
      ? resolve(projectRoot, '.forgeax', 'games', slug, 'game-video')
      : resolve(baseRoot, 'games', slug)
  }
  return baseRoot
}

/**
 * 图存储端点（磁盘为已保存版本的权威）：
 *   GET  /__graph__/store?game=slug          → { scenario(最新已保存), versions:[{id,savedAt}] }
 *   PUT  /__graph__/store?game=slug {scenario,id?,title?} → 写 scenarios.graph.json + 版本快照(留10) → { versions }
 *   GET  /__graph__/version?game=slug&id=vid → { scenario }
 * 草稿不落盘（走客户端 localStorage）。
 */
function graphStorePlugin(): Plugin {
  let baseRoot = ''
  let projectRoot: string | null = null
  return {
    name: 'gamevideo-graph-store',
    configResolved(config) {
      baseRoot = resolve(config.root, '.gamevideo-scenarios')
      projectRoot = findProjectRootWithForgeax(config.root)
    },
    configureServer(server) {
      server.middlewares.use(GRAPH_ROUTE_PREFIX, async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const path = url.pathname.replace(/\/+$/, '') || '/'
          const method = (req.method ?? 'GET').toUpperCase()
          const slug = (url.searchParams.get('game') ?? '').trim() || null
          const dir = graphDirForSlug(projectRoot, baseRoot, slug)
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          const canonical = resolve(dir, 'scenarios.graph.json')
          const vDir = resolve(dir, 'scenarios.graph.versions')
          const indexPath = resolve(vDir, 'index.json')
          const readJson = (p: string): unknown => {
            try {
              return JSON.parse(readFileSync(p, 'utf-8'))
            } catch {
              return null
            }
          }
          if (path === '/store' && method === 'GET') {
            const container = readJson(canonical) as { items?: { scenario?: unknown }[] } | null
            const scenario = container?.items?.[0]?.scenario ?? null
            return sendJson(res, 200, { scenario, versions: readJson(indexPath) ?? [] })
          }
          if (path === '/store' && method === 'PUT') {
            const body = await readGraphReqJson(req)
            const scenario = body.scenario as { id?: string } | undefined
            if (!scenario) return sendJson(res, 400, { error: 'no scenario' })
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
            const vid = url.searchParams.get('id') ?? ''
            const scenario = readJson(resolve(vDir, `${vid}.json`))
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

export default defineConfig(() => {
  // 作为 forgeax-studio 插件 build 时，host 把产物挂在 `/plugins/wb-game-video/`
  // 子路径下，需要绝对 base；独立 dev/preview/standalone 用相对 './'。
  const pluginBase =
    process.env.WB_GAMEVIDEO_PLUGIN_BUILD === '1' ? '/plugins/wb-game-video/' : './'

  return {
    base: pluginBase,
    plugins: [react(), graphStorePlugin()],
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
        clientPort: process.env.HMR_CLIENT_PORT
          ? Number(process.env.HMR_CLIENT_PORT)
          : process.env.PORT_GAMEVIDEO_STUDIO
          ? Number(process.env.PORT_GAMEVIDEO_STUDIO)
          : undefined,
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
