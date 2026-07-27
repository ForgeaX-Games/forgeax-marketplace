/**
 * asset-registry —— 游戏级共享素材层中 wb-game-video 资产域的**服务端 CRUD**（node:fs）。
 *
 * 磁盘布局（`.forgeax/games/<slug>/assets/`，与 game-video/ 平级、独立于任何插件）：
 *   - `manifest.json`       = { version:2, assets: AssetRecord[] }
 *   - `media/<id>.<ext>`    = wb-game-video 自产的图/视频二进制
 *
 * 被两处共享（SSOT）：
 *   - `server/tool-handlers.ts` 的 gen:* 工具 + `server/generation/*` 编排（写）
 *   - `vite.config.ts` 的 `/__gva__` 端点（读 + 流式回文件）
 *
 * 跨模块产物（人设图/场景图）**只读**：不落进本 registry 的 media/，仅以 externalPath
 * 指回对方目录（见 server/intake/*）。本 registry 只写带 productionType 的记录，并
 * 原样保留视频服务等其它资产域拥有的记录。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync, renameSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import type { AssetManifest, MediaAsset, MediaKind, MediaProductionType, StyleAxes } from '../src/editor/assets/registry-types'

const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

/** 从起点目录向上找含 `.forgeax/games` 的工程根（与 tool-handlers / vite 同一约定）。 */
export function findProjectRoot(start: string): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, '.forgeax', 'games'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 素材层根目录：`<root>/.forgeax/games/<slug>/assets`；缺工程根或非法 slug 则 null。 */
export function assetsDir(projectRoot: string | null, slug: string | null): string | null {
  if (!projectRoot || !slug || !GAME_SLUG_RE.test(slug)) return null
  return resolve(projectRoot, '.forgeax', 'games', slug, 'assets')
}

function manifestPath(dir: string): string {
  return resolve(dir, 'manifest.json')
}

function mediaDir(dir: string): string {
  return resolve(dir, 'media')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMediaAsset(value: unknown): value is MediaAsset {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'image' || value.kind === 'video') &&
    typeof value.productionType === 'string'
  )
}

function validateAssetRecords(assets: unknown[]): void {
  const ids = new Set<string>()
  for (const asset of assets) {
    if (!isRecord(asset)) throw new Error('Invalid shared asset manifest record')
    if (
      typeof asset.id !== 'string' ||
      asset.id.length === 0 ||
      typeof asset.kind !== 'string' ||
      asset.kind.length === 0 ||
      ids.has(asset.id)
    ) {
      throw new Error('Invalid or duplicate shared asset id')
    }
    ids.add(asset.id)
  }
}

/** 读共享 manifest；其它资产域的记录原样保留，损坏时 fail loud。 */
export function readManifest(dir: string): AssetManifest {
  const path = manifestPath(dir)
  if (!existsSync(path)) return { version: 2, assets: [] }
  let parsed: Partial<AssetManifest>
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AssetManifest>
  } catch (error) {
    throw new Error(`Invalid shared asset manifest JSON: ${path}`, { cause: error })
  }
  if (parsed.version !== 2 || !Array.isArray(parsed.assets)) {
    throw new Error(`Unsupported shared asset manifest: ${path}`)
  }
  validateAssetRecords(parsed.assets)
  return { ...parsed, version: 2, assets: parsed.assets } as AssetManifest
}

function writeManifest(dir: string, manifest: AssetManifest): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const target = manifestPath(dir)
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify({ ...manifest, version: 2 }, null, 2)}\n`)
  renameSync(temp, target)
}

export interface AssetFilter {
  kind?: MediaKind
  productionType?: MediaProductionType
  sceneNodeId?: string
}

/** 列资产（可选过滤）。 */
export function listAssets(dir: string, filter?: AssetFilter): MediaAsset[] {
  let out = readManifest(dir).assets.filter(isMediaAsset)
  if (filter?.kind) out = out.filter((a) => a.kind === filter.kind)
  if (filter?.productionType) out = out.filter((a) => a.productionType === filter.productionType)
  if (filter?.sceneNodeId) out = out.filter((a) => a.sceneNodeId === filter.sceneNodeId)
  return out
}

export function getAsset(dir: string, id: string): MediaAsset | null {
  return readManifest(dir).assets.find((a): a is MediaAsset => isMediaAsset(a) && a.id === id) ?? null
}

/** upsert 一条资产（按 id 覆盖或追加），返回落盘后的资产。 */
export function upsertAsset(dir: string, asset: MediaAsset): MediaAsset {
  const m = readManifest(dir)
  const idx = m.assets.findIndex((a) => a.id === asset.id)
  if (idx >= 0 && !isMediaAsset(m.assets[idx])) {
    throw new Error(`Asset id is owned by another asset domain: ${asset.id}`)
  }
  const now = Date.now()
  const next: MediaAsset = { ...asset, updatedAt: now, createdAt: asset.createdAt || now }
  if (idx >= 0) m.assets[idx] = next
  else m.assets.push(next)
  writeManifest(dir, m)
  return next
}

/** patch 一条资产（浅合并）；不存在返回 null。 */
export function updateAsset(dir: string, id: string, patch: Partial<MediaAsset>): MediaAsset | null {
  const m = readManifest(dir)
  const idx = m.assets.findIndex((a) => isMediaAsset(a) && a.id === id)
  if (idx < 0) return null
  const merged: MediaAsset = { ...m.assets[idx], ...patch, id, updatedAt: Date.now() } as MediaAsset
  m.assets[idx] = merged
  writeManifest(dir, m)
  return merged
}

export function deleteAsset(dir: string, id: string): boolean {
  const m = readManifest(dir)
  const next = m.assets.filter((a) => !isMediaAsset(a) || a.id !== id)
  if (next.length === m.assets.length) return false
  writeManifest(dir, { ...m, assets: next })
  return true
}

/** 读游戏级风格三轴（manifest.styleAxes）；缺省 undefined。 */
export function getStyleAxes(dir: string): StyleAxes | undefined {
  return readManifest(dir).styleAxes
}

/** 写/合并游戏级风格三轴（浅合并，传 undefined 字段不清空已存值）。 */
export function setStyleAxes(dir: string, axes: StyleAxes): StyleAxes {
  const m = readManifest(dir)
  const merged: StyleAxes = { ...(m.styleAxes ?? {}), ...axes }
  writeManifest(dir, { ...m, styleAxes: merged })
  return merged
}

/**
 * 写一份自产媒体二进制到 `media/<id>.<ext>`，返回相对 `assets/` 根的 file 路径。
 * ext 不含点（如 'mp4' / 'png'）。
 */
export function writeMediaFile(dir: string, id: string, ext: string, bytes: Uint8Array): string {
  const md = mediaDir(dir)
  if (!existsSync(md)) mkdirSync(md, { recursive: true })
  const cleanExt = ext.replace(/^\./, '').toLowerCase() || 'bin'
  const rel = `media/${id}.${cleanExt}`
  writeFileSync(resolve(dir, rel), bytes)
  return rel
}

/** 解析一条资产的绝对磁盘文件路径（自产 file 优先，其次跨模块 externalPath）。 */
export function resolveAssetFilePath(dir: string, asset: MediaAsset): string | null {
  if (asset.file) return resolve(dir, asset.file)
  if (asset.externalPath) return asset.externalPath
  return null
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export function mimeForPath(p: string): string {
  return MIME_BY_EXT[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

/** 便捷：读文件流 + 大小 + mime（供 `/__gva__/media/:id` 端点）。 */
export function openAssetFile(dir: string, id: string): { stream: ReturnType<typeof createReadStream>; size: number; mime: string } | null {
  const asset = getAsset(dir, id)
  if (!asset) return null
  const p = resolveAssetFilePath(dir, asset)
  if (!p || !existsSync(p)) return null
  try {
    const size = statSync(p).size
    return { stream: createReadStream(p), size, mime: asset.mime ?? mimeForPath(p) }
  } catch {
    return null
  }
}
