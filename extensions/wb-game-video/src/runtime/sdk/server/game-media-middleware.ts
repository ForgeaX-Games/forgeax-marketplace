import type { IncomingMessage, ServerResponse } from 'node:http'
import { GAME_ID_PATTERN, type RuntimeAsset } from '../client/game-package-client'

type Next = () => void
type Middleware = (req: IncomingMessage, res: ServerResponse, next: Next) => void | Promise<void>
interface MiddlewareStack {
  use(route: string, handler: Middleware): void
}
interface ViteLikeServer {
  middlewares: MiddlewareStack
}

interface GameMediaPluginOptions {
  gameHostOrigin: string
}

interface CachedAssets {
  expiresAt: number
  value: Promise<RuntimeAsset[]>
}

const PACKAGE_CACHE_MS = 5_000

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function apiUrl(origin: string, path: string): string {
  return new URL(path, origin.endsWith('/') ? origin : `${origin}/`).toString()
}

function packageUrl(origin: string, gameId: string): string {
  return apiUrl(origin, `/api/game-host/games/${encodeURIComponent(gameId)}/package`)
}

function componentsUrl(origin: string, gameId: string): string {
  return apiUrl(origin, `/api/game-host/games/${encodeURIComponent(gameId)}/components/index.js`)
}

export function assetPlaybackLocation(asset: RuntimeAsset, gameId: string): string {
  if (asset.url && /^https?:\/\//.test(asset.url)) return asset.url
  return `/api/v1/kino/resources/${encodeURIComponent(asset.id)}/content?game_id=${encodeURIComponent(gameId)}`
}

function createPackageAssetsLoader(gameHostOrigin: string) {
  const cache = new Map<string, CachedAssets>()

  return async (gameId: string): Promise<RuntimeAsset[]> => {
    const cached = cache.get(gameId)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const value = (async () => {
      const response = await fetch(packageUrl(gameHostOrigin, gameId), {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`game-host package returned HTTP ${response.status}`)
      const body = await response.json() as { assetsManifest?: { assets?: RuntimeAsset[] } }
      if (!Array.isArray(body.assetsManifest?.assets)) throw new Error('game-host package has no asset manifest')
      return body.assetsManifest.assets
    })()

    cache.set(gameId, { expiresAt: Date.now() + PACKAGE_CACHE_MS, value })
    try {
      return await value
    } catch (error) {
      cache.delete(gameId)
      throw error
    }
  }
}

function createHandler(gameHostOrigin: string): Middleware {
  const loadAssets = createPackageAssetsLoader(gameHostOrigin)

  return async (req, res, next) => {
    const method = (req.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return next()

    const url = new URL(req.url ?? '/', 'http://localhost')
    const gameId = url.searchParams.get('game')?.trim() ?? ''
    if (!GAME_ID_PATTERN.test(gameId)) return sendJson(res, 404, { error: 'invalid game' })

    if (url.pathname === '/components-status') {
      try {
        const response = await fetch(componentsUrl(gameHostOrigin, gameId), { method: 'HEAD' })
        return sendJson(res, 200, { available: response.ok })
      } catch {
        return sendJson(res, 200, { available: false })
      }
    }

    const match = /^\/media\/([^/]+)$/.exec(url.pathname)
    if (!match) return next()

    try {
      const assetId = decodeURIComponent(match[1]!)
      const assets = await loadAssets(gameId)
      const asset = assets.find((candidate) => candidate.id === assetId)
      if (!asset) return sendJson(res, 404, { error: 'asset not found' })

      const location = assetPlaybackLocation(asset, gameId)
      res.statusCode = 307
      res.setHeader('location', location)
      res.setHeader('cache-control', 'no-store')
      res.end()
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : 'failed to resolve asset' })
    }
  }
}

export function gameMediaPlugin(options: GameMediaPluginOptions) {
  const mount = (middlewares: MiddlewareStack) => {
    middlewares.use('/__gva__', createHandler(options.gameHostOrigin))
  }
  return {
    name: 'wb-game-video-sdk-media',
    configureServer(server: ViteLikeServer) {
      mount(server.middlewares)
    },
    configurePreviewServer(server: ViteLikeServer) {
      mount(server.middlewares)
    },
  }
}
