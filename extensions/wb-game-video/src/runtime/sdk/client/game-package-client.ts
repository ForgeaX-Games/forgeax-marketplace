import type { GraphLibraryDocument } from '../../schema/graph-schema'

export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/

export interface RuntimeAsset {
  id: string
  kind?: string
  mimeType?: string
  url?: string
  file?: string
  externalPath?: string
  provider?: {
    kind?: string
    ref?: string
  }
}

export interface RuntimeAssetManifest {
  version: number
  assets: RuntimeAsset[]
}

export interface RuntimeGamePackage {
  project: unknown | null
  blueprint: GraphLibraryDocument
  assetsManifest: RuntimeAssetManifest
}

export class GamePackageError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GamePackageError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBlueprint(value: unknown): value is GraphLibraryDocument {
  if (!isObject(value) || !isObject(value.graph) || !isObject(value.manifest)) return false
  const graph = value.graph
  const manifest = value.manifest
  return Array.isArray(graph.nodes)
    && Array.isArray(graph.edges)
    && typeof manifest.mainPackId === 'string'
    && isObject(manifest.packs)
}

function parseAssetManifest(value: unknown): RuntimeAssetManifest | null {
  if (!isObject(value) || typeof value.version !== 'number' || !Array.isArray(value.assets)) return null
  const assets: RuntimeAsset[] = []
  for (const candidate of value.assets) {
    if (!isObject(candidate) || typeof candidate.id !== 'string') return null
    assets.push(candidate as unknown as RuntimeAsset)
  }
  return { version: value.version, assets }
}

export function readGameId(search = window.location.search): string {
  const gameId = new URLSearchParams(search).get('gameId')?.trim() ?? ''
  if (!gameId) throw new GamePackageError('Missing required gameId parameter')
  if (!GAME_ID_PATTERN.test(gameId)) throw new GamePackageError('Invalid gameId parameter')
  return gameId
}

export async function fetchGamePackage(gameId: string, signal?: AbortSignal): Promise<RuntimeGamePackage> {
  if (!GAME_ID_PATTERN.test(gameId)) throw new GamePackageError('Invalid gameId parameter')

  const response = await fetch(`/api/game-host/games/${encodeURIComponent(gameId)}/package`, {
    headers: { accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new GamePackageError(`Failed to load game package (HTTP ${response.status})`, response.status)
  }

  const body: unknown = await response.json()
  if (!isObject(body) || !isBlueprint(body.blueprint)) {
    throw new GamePackageError('Game package has no valid blueprint.json')
  }
  const assetsManifest = parseAssetManifest(body.assetsManifest)
  if (!assetsManifest) {
    throw new GamePackageError('Game package has no valid assets/manifest.json')
  }

  return {
    project: body.project ?? null,
    blueprint: body.blueprint,
    assetsManifest,
  }
}
