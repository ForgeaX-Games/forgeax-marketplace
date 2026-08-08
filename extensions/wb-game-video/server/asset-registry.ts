/**
 * asset-registry —— 游戏级共享素材层中 wb-game-video 资产域的服务端 CRUD。
 *
 * 文件开头保留旧式 node:fs helper；Workbench 路径从下方
 * `createHostAssetRegistry()` 开始，只使用宿主注入的 bounded files/media capability。
 * 旧式 helper 的磁盘布局（`.forgeax/games/<slug>/assets/`）：
 *   - `manifest.json`       = { version:2, assets: AssetRecord[] }
 *   - `media/<id>.<ext>`    = wb-game-video 自产的图/视频二进制
 *
 * 被两处共享（SSOT）：
 *   - `server/tool-handlers.ts` 的 wb-game-video:* 工具 + `server/generation/*` 编排（写）
 *
 * Workbench intake 对人设图/场景图的源目录保持只读，并把字节副本交给 host media
 * capability 持久化；不会把宿主媒体 URL 当作权威身份。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  MediaAsset as HostMediaAsset,
  MediaBody,
  MediaReference,
  MediaWriteInput,
} from '@forgeax/workbench-host/contracts'
import type {
  BoundedGameFiles,
  WorkbenchExtensionContext,
} from '@forgeax/workbench-host/node'
import type {
  AssetManifest,
  DocumentRecord,
  DocumentSelection,
  DocumentType,
  MediaAsset,
  MediaKind,
  MediaProductionType,
  StyleAxes,
} from '../src/editor/assets/registry-types'

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

function isDocumentType(value: unknown): value is DocumentType {
  return value === 'proposal' || value === 'outline' || value === 'script'
}

/**
 * 文档只允许位于 assets/documents 下，且不可通过 manifest 引用任意游戏文件。
 * 文件名保留常规 Markdown 字符，路径结构固定为 documents/<name>.md。
 */
function isDocumentPath(value: unknown): value is string {
  return typeof value === 'string'
    && /^documents\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/i.test(value)
}

export function isDocumentRecord(value: unknown): value is DocumentRecord {
  if (!isRecord(value) || value.kind !== 'document') return false
  return (
    typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && value.name.length > 0
    && value.status === 'ready'
    && value.mimeType === 'text/markdown'
    && isRecord(value.provider)
    && value.provider.kind === 'local'
    && isDocumentPath(value.provider.ref)
    && typeof value.createdAt === 'number'
    && typeof value.updatedAt === 'number'
    && isRecord(value.meta)
    && isDocumentType(value.meta.documentType)
  )
}

function isMediaAsset(value: unknown): value is MediaAsset {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'image' || value.kind === 'video') &&
    // Shared provider-backed uploads predate the editor-only productionType
    // field. They are still valid media records and must remain visible in the
    // library rather than being silently dropped during normalization.
    (typeof value.productionType === 'string' || isProviderBacked(value))
  )
}

function isProviderBacked(value: unknown): boolean {
  return isRecord(value) && isRecord(value.provider)
}

function normalizeMediaAsset(value: unknown): MediaAsset | null {
  if (!isMediaAsset(value)) return null
  const source = value as MediaAsset & { name?: unknown; mimeType?: unknown }
  const providerBacked = isProviderBacked(source)
  return {
    ...source,
    productionType: source.productionType
      ?? (source.kind === 'video' ? 'video_clip' : 'shot_image'),
    label: source.label ?? (typeof source.name === 'string' ? source.name : undefined),
    mime: source.mime ?? (typeof source.mimeType === 'string' ? source.mimeType : undefined),
    meta: providerBacked ? { ...(source.meta ?? {}), upload: true } : source.meta,
  }
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
  let out = readManifest(dir).assets
    .map(normalizeMediaAsset)
    .filter((asset): asset is MediaAsset => asset !== null)
  if (filter?.kind) out = out.filter((a) => a.kind === filter.kind)
  if (filter?.productionType) out = out.filter((a) => a.productionType === filter.productionType)
  if (filter?.sceneNodeId) out = out.filter((a) => a.sceneNodeId === filter.sceneNodeId)
  return out
}

export function getAsset(dir: string, id: string): MediaAsset | null {
  const asset = readManifest(dir).assets.find((a) => isRecord(a) && a.id === id)
  return normalizeMediaAsset(asset)
}

/** upsert 一条资产（按 id 覆盖或追加），返回落盘后的资产。 */
export function upsertAsset(dir: string, asset: MediaAsset): MediaAsset {
  const m = readManifest(dir)
  const idx = m.assets.findIndex((a) => a.id === asset.id)
  if (idx >= 0 && (!isMediaAsset(m.assets[idx]) || isProviderBacked(m.assets[idx]))) {
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
  const idx = m.assets.findIndex((a) => isMediaAsset(a) && !isProviderBacked(a) && a.id === id)
  if (idx < 0) return null
  const merged: MediaAsset = { ...m.assets[idx], ...patch, id, updatedAt: Date.now() } as MediaAsset
  m.assets[idx] = merged
  writeManifest(dir, m)
  return merged
}

export function deleteAsset(dir: string, id: string): boolean {
  const m = readManifest(dir)
  const next = m.assets.filter((a) => !isMediaAsset(a) || isProviderBacked(a) || a.id !== id)
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
  if (asset.file) {
    const mediaRoot = resolve(dir, 'media')
    const candidate = resolve(dir, asset.file)
    const rel = relative(mediaRoot, candidate)
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? candidate : null
  }
  if (asset.externalPath && isAbsolute(asset.externalPath)) {
    const gameRoot = resolve(dir, '..')
    const candidate = resolve(asset.externalPath)
    const rel = relative(gameRoot, candidate)
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? candidate : null
  }
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

/** 便捷：读文件流 + 大小 + mime（供宿主媒体路由）。 */
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

// ── Workbench host capability-backed registry ────────────────────────────────

const HOST_MANIFEST_PATH = 'assets/manifest.json'
const HOST_MANIFEST_LOCK = 'wb-game-video-assets-manifest'
const HOST_RECLAIM_JOURNAL_KEY = 'wbGameVideoReclaims'
const HOST_MEDIA_INTENT_JOURNAL_KEY = 'wbGameVideoMediaIntents'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type HostPersistedMediaSource =
  | 'wb-game-video-reference'
  | 'wb-game-video-generation'

type HostReclaimSource =
  | HostPersistedMediaSource
  | 'wb-game-video-model-output'

interface HostMediaReclaim {
  readonly registryId: string
  readonly assetId: string
  readonly source: HostReclaimSource
  readonly operationId: string | null
  readonly fingerprint?: string
}

interface HostReclaimJournal {
  readonly version: 1
  readonly entries: readonly HostMediaReclaim[]
}

interface HostMediaIntent {
  readonly registryId: string
  readonly source: HostPersistedMediaSource
  readonly operationId: string
}

interface HostMediaIntentJournal {
  readonly version: 1
  readonly entries: readonly HostMediaIntent[]
}

interface KnownGeneratedSource {
  readonly asset: HostMediaAsset
  readonly body: MediaBody
}

function assertBoundedRelativePath(value: string, label = 'Game file path'): string {
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${label} must be a bounded relative path`)
  }
  return normalized
}

async function readHostManifest(files: BoundedGameFiles): Promise<AssetManifest> {
  const bytes = await files.read(HOST_MANIFEST_PATH)
  if (!bytes) return { version: 2, assets: [] }
  let parsed: Partial<AssetManifest>
  try {
    parsed = JSON.parse(textDecoder.decode(bytes)) as Partial<AssetManifest>
  } catch (error) {
    throw new Error('Invalid shared asset manifest JSON', { cause: error })
  }
  if (parsed.version !== 2 || !Array.isArray(parsed.assets)) {
    throw new Error('Unsupported shared asset manifest')
  }
  validateAssetRecords(parsed.assets)
  const manifest = { ...parsed, version: 2, assets: parsed.assets } as AssetManifest
  hostMediaReclaims(manifest)
  hostMediaIntents(manifest)
  return manifest
}

async function writeHostManifest(
  files: BoundedGameFiles,
  manifest: AssetManifest,
): Promise<void> {
  validateAssetRecords(manifest.assets)
  hostMediaReclaims(manifest)
  hostMediaIntents(manifest)
  await files.write(
    HOST_MANIFEST_PATH,
    textEncoder.encode(`${JSON.stringify({ ...manifest, version: 2 }, null, 2)}\n`),
  )
}

/** 读取 manifest 中登记的项目文档；文档记录损坏时拒绝静默忽略。 */
export async function listHostDocuments(
  context: WorkbenchExtensionContext,
): Promise<DocumentRecord[]> {
  const manifest = await readHostManifest(context.files)
  const documents: DocumentRecord[] = []
  for (const asset of manifest.assets) {
    if (!isRecord(asset) || asset.kind !== 'document') continue
    if (!isDocumentRecord(asset)) {
      throw new Error('Invalid project document manifest record')
    }
    documents.push(asset)
  }
  return documents
}

/** 读取一份已登记的 Markdown 文档；不存在的登记项或正文均返回 null。 */
export async function readHostDocument(
  context: WorkbenchExtensionContext,
  id: string,
): Promise<{ document: DocumentRecord, content: string } | null> {
  const document = (await listHostDocuments(context)).find((entry) => entry.id === id)
  if (!document) return null
  const bytes = await context.files.read(`assets/${document.provider.ref}`)
  if (!bytes) return null
  return { document, content: textDecoder.decode(bytes) }
}

function documentSelection(manifest: AssetManifest): DocumentSelection | null {
  const value = manifest.documentSelection
  if (value === undefined) return null
  if (!isRecord(value) || (value.proposalId !== undefined && typeof value.proposalId !== 'string')) {
    throw new Error('Invalid project document selection')
  }
  return value as DocumentSelection
}

/** 读取已采用策划案；选择指向失效记录时拒绝继续交给后续生成链路。 */
export async function getHostDocumentSelection(
  context: WorkbenchExtensionContext,
): Promise<DocumentSelection | null> {
  const manifest = await readHostManifest(context.files)
  const selection = documentSelection(manifest)
  if (!selection?.proposalId) return selection
  const selected = (await listHostDocuments(context)).find((entry) => entry.id === selection.proposalId)
  if (!selected || selected.meta.documentType !== 'proposal') {
    throw new Error('Selected proposal does not exist')
  }
  return selection
}

/** 原子采用一份已登记策划案；不提供替换/清空入口，避免覆盖已进入生成管线的输入。 */
export async function selectHostProposal(
  context: WorkbenchExtensionContext,
  proposalId: string,
): Promise<DocumentSelection> {
  if (!proposalId) throw new TypeError('Proposal id is required')
  return context.files.withLocks([HOST_MANIFEST_LOCK], async () => {
    const manifest = await readHostManifest(context.files)
    const current = documentSelection(manifest)
    if (current?.proposalId && current.proposalId !== proposalId) {
      throw new Error('A proposal has already been selected')
    }
    const selected = manifest.assets.find((entry) => isDocumentRecord(entry) && entry.id === proposalId)
    if (!isDocumentRecord(selected) || selected.meta.documentType !== 'proposal') {
      throw new Error('Selected document is not a proposal')
    }
    const nextSelection = { proposalId }
    await writeHostManifest(context.files, { ...manifest, documentSelection: nextSelection })
    return nextSelection
  })
}

function isHostReclaimSource(value: unknown): value is HostReclaimSource {
  return (
    value === 'wb-game-video-reference'
    || value === 'wb-game-video-generation'
    || value === 'wb-game-video-model-output'
  )
}

function isHostPersistedMediaSource(
  value: unknown,
): value is HostPersistedMediaSource {
  return (
    value === 'wb-game-video-reference'
    || value === 'wb-game-video-generation'
  )
}

function hostMediaReclaims(manifest: AssetManifest): HostMediaReclaim[] {
  const value = manifest[HOST_RECLAIM_JOURNAL_KEY]
  if (value === undefined) return []
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error('Invalid wb-game-video media reclaim journal')
  }
  const seenAssets = new Set<string>()
  return value.entries.map((entry): HostMediaReclaim => {
    if (
      !isRecord(entry)
      || typeof entry.registryId !== 'string'
      || entry.registryId.length === 0
      || typeof entry.assetId !== 'string'
      || entry.assetId.length === 0
      || !isHostReclaimSource(entry.source)
      || (
        entry.operationId !== null
        && (typeof entry.operationId !== 'string' || entry.operationId.length === 0)
      )
      || (
        entry.source === 'wb-game-video-model-output'
          ? (
              typeof entry.operationId !== 'string'
              || typeof entry.fingerprint !== 'string'
              || !/^sha256:[a-f0-9]{64}$/.test(entry.fingerprint)
            )
          : entry.fingerprint !== undefined
      )
      || seenAssets.has(entry.assetId)
    ) {
      throw new Error('Invalid wb-game-video media reclaim journal')
    }
    seenAssets.add(entry.assetId)
    return {
      registryId: entry.registryId,
      assetId: entry.assetId,
      source: entry.source,
      operationId: entry.operationId,
      ...(typeof entry.fingerprint === 'string'
        ? { fingerprint: entry.fingerprint }
        : {}),
    }
  })
}

function hostMediaIntents(manifest: AssetManifest): HostMediaIntent[] {
  const value = manifest[HOST_MEDIA_INTENT_JOURNAL_KEY]
  if (value === undefined) return []
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error('Invalid wb-game-video media intent journal')
  }
  const seenRegistries = new Set<string>()
  return value.entries.map((entry): HostMediaIntent => {
    if (
      !isRecord(entry)
      || typeof entry.registryId !== 'string'
      || entry.registryId.length === 0
      || !isHostPersistedMediaSource(entry.source)
      || typeof entry.operationId !== 'string'
      || entry.operationId.length === 0
      || seenRegistries.has(`${entry.source}\0${entry.registryId}`)
    ) {
      throw new Error('Invalid wb-game-video media intent journal')
    }
    seenRegistries.add(`${entry.source}\0${entry.registryId}`)
    return {
      registryId: entry.registryId,
      source: entry.source,
      operationId: entry.operationId,
    }
  })
}

function withHostMediaReclaims(
  manifest: AssetManifest,
  entries: readonly HostMediaReclaim[],
): AssetManifest {
  const next: AssetManifest = { ...manifest }
  if (entries.length === 0) {
    delete next[HOST_RECLAIM_JOURNAL_KEY]
  } else {
    const journal: HostReclaimJournal = {
      version: 1,
      entries: entries.map((entry) => ({ ...entry })),
    }
    next[HOST_RECLAIM_JOURNAL_KEY] = journal
  }
  return next
}

function withHostMediaIntents(
  manifest: AssetManifest,
  entries: readonly HostMediaIntent[],
): AssetManifest {
  const next: AssetManifest = { ...manifest }
  if (entries.length === 0) {
    delete next[HOST_MEDIA_INTENT_JOURNAL_KEY]
  } else {
    const journal: HostMediaIntentJournal = {
      version: 1,
      entries: entries.map((entry) => ({ ...entry })),
    }
    next[HOST_MEDIA_INTENT_JOURNAL_KEY] = journal
  }
  return next
}

function declaredHostMediaId(normalized: MediaAsset): string | undefined {
  const hostMedia = isRecord(normalized.meta?.hostMedia)
    ? normalized.meta.hostMedia
    : undefined
  return (
    hostMedia?.provenance === 'workbench-media-capability'
    && typeof hostMedia.assetId === 'string'
    && normalized.provider?.kind === 'local'
    && normalized.provider.ref === hostMedia.assetId
  ) ? hostMedia.assetId : undefined
}

function trustedHostMediaId(
  normalized: MediaAsset,
  trustedMedia: ReadonlyMap<string, HostMediaAsset>,
): string | undefined {
  const hostAssetId = declaredHostMediaId(normalized)
  return hostAssetId && trustedMedia.has(hostAssetId) ? hostAssetId : undefined
}

function reclaimForHostMedia(
  registryId: string,
  asset: HostMediaAsset | undefined,
): HostMediaReclaim | undefined {
  if (!asset || !isRecord(asset.metadata)) return undefined
  const { source, operationId } = asset.metadata
  if (
    asset.metadata.registryId !== registryId
    || (
      !isHostPersistedMediaSource(source)
    )
    || (
      operationId !== undefined
      && (typeof operationId !== 'string' || operationId.length === 0)
    )
  ) {
    return undefined
  }
  return {
    registryId,
    assetId: asset.id,
    source,
    operationId: operationId ?? null,
  }
}

function sameHostMediaIntent(
  left: HostMediaIntent,
  right: HostMediaIntent,
): boolean {
  return (
    left.registryId === right.registryId
    && left.source === right.source
    && left.operationId === right.operationId
  )
}

function matchesHostMediaIntent(
  intent: HostMediaIntent,
  asset: HostMediaAsset,
): boolean {
  return (
    isRecord(asset.metadata)
    && asset.metadata.registryId === intent.registryId
    && asset.metadata.source === intent.source
    && asset.metadata.operationId === intent.operationId
  )
}

function sameHostMediaReclaim(
  left: HostMediaReclaim,
  right: HostMediaReclaim,
): boolean {
  return (
    left.registryId === right.registryId
    && left.assetId === right.assetId
    && left.source === right.source
    && left.operationId === right.operationId
    && left.fingerprint === right.fingerprint
  )
}

function enqueueHostMediaReclaim(
  manifest: AssetManifest,
  reclaim: HostMediaReclaim,
): AssetManifest {
  const entries = hostMediaReclaims(manifest)
  const existing = entries.find((entry) => entry.assetId === reclaim.assetId)
  if (existing) {
    if (!sameHostMediaReclaim(existing, reclaim)) {
      throw new Error('Conflicting wb-game-video media reclaim journal entry')
    }
    return manifest
  }
  return withHostMediaReclaims(manifest, [...entries, reclaim])
}

function publicHostAsset(
  value: unknown,
  trustedMedia: ReadonlyMap<string, HostMediaAsset>,
): MediaAsset | null {
  const normalized = normalizeMediaAsset(value)
  if (!normalized) return null
  const { label, prompt, error, meta } = normalized
  const hostAssetId = trustedHostMediaId(normalized, trustedMedia)
  const authoritativeMedia = hostAssetId ? trustedMedia.get(hostAssetId) : undefined
  const trustedLocator = (
    authoritativeMedia
    && authoritativeMedia.url === normalized.url
  )
    ? safeHostMediaUrl(authoritativeMedia.url)
    : undefined
  const sanitizedMeta = deepSanitizeMeta(
    meta,
    trustedLocator,
    trustedLocator ? hostAssetId : undefined,
  )
  return {
    id: normalized.id,
    kind: normalized.kind,
    productionType: normalized.productionType,
    status: normalized.status,
    ...(label ? { label: sanitizePublicText(label) } : {}),
    ...(prompt ? { prompt: sanitizePublicText(prompt) } : {}),
    ...(normalized.sceneNodeId ? {
      sceneNodeId: sanitizePublicText(normalized.sceneNodeId),
    } : {}),
    ...(normalized.sourceModule ? {
      sourceModule: sanitizePublicText(normalized.sourceModule),
    } : {}),
    ...(normalized.mime ? { mime: normalized.mime } : {}),
    ...(normalized.bytes !== undefined ? { bytes: normalized.bytes } : {}),
    ...(normalized.durationMs !== undefined
      ? { durationMs: normalized.durationMs }
      : {}),
    ...(error ? { error: sanitizePublicText(error) } : {}),
    ...(trustedLocator ? { url: trustedLocator } : {}),
    ...(sanitizedMeta ? { meta: sanitizedMeta } : {}),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  }
}

export function sanitizePublicText(value: string): string {
  return value
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/g, '[redacted]')
    .replace(/\b(?:file|javascript|data|vbscript|blob):\S+/gi, '[redacted]')
    .replace(/\\\\[^\s]+/g, '[redacted]')
    .replace(/[A-Za-z]:[\\/][^\s]+/g, '[redacted]')
    .replace(
      /(^|[^A-Za-z0-9._-])\/[^\s,;)\]}"']+/g,
      (_match, prefix: string) => `${prefix}[redacted]`,
    )
    .slice(0, 4_000)
}

function containsSensitivePublicText(value: string): boolean {
  return sanitizePublicText(value) !== value
}

function deepSanitizeMeta(
  value: unknown,
  trustedLocator?: string,
  trustedAssetId?: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, unknown> = {}
  for (const [childKey, child] of Object.entries(value)) {
    if (/^(?:externalPath|sourceUrl|path|file|providerUrl)$/i.test(childKey)) continue
    if (childKey === 'hostMedia' && isRecord(child)) {
      if (
        child.provenance === 'workbench-media-capability'
        && child.assetId === trustedAssetId
        && typeof trustedLocator === 'string'
      ) {
        out.hostMedia = {
          provenance: child.provenance,
          assetId: trustedAssetId,
          locator: trustedLocator,
        }
      }
      continue
    }
    if (typeof child === 'string') {
      if (
        containsSensitivePublicText(child)
        || /(?:path|url)$/i.test(childKey)
      ) continue
      out[childKey] = child
    } else if (Array.isArray(child)) {
      const items: unknown[] = []
      for (const item of child) {
        if (typeof item === 'string') {
          if (containsSensitivePublicText(item)) continue
          items.push(item)
        } else if (Array.isArray(item)) {
          const nested = deepSanitizeMeta(
            { items: item },
            trustedLocator,
            trustedAssetId,
          )
          if (nested?.items) items.push(nested.items)
        } else if (isRecord(item)) {
          const nested = deepSanitizeMeta(
            item,
            trustedLocator,
            trustedAssetId,
          )
          if (nested && Object.keys(nested).length) items.push(nested)
        } else {
          items.push(item)
        }
      }
      out[childKey] = items
    } else if (isRecord(child)) {
      const nested = deepSanitizeMeta(child, trustedLocator, trustedAssetId)
      if (nested && Object.keys(nested).length) out[childKey] = nested
    } else {
      out[childKey] = child
    }
  }
  return Object.keys(out).length ? out : undefined
}

function safeHostMediaUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return ['file:', 'javascript:', 'data:'].includes(url.protocol)
      ? undefined
      : value
  } catch {
    return undefined
  }
}

function filterAssets(
  manifest: AssetManifest,
  trustedMedia: ReadonlyMap<string, HostMediaAsset>,
  filter?: AssetFilter,
): MediaAsset[] {
  let assets = manifest.assets
    .map((asset) => publicHostAsset(asset, trustedMedia))
    .filter((asset): asset is MediaAsset => asset !== null)
  if (filter?.kind) assets = assets.filter((asset) => asset.kind === filter.kind)
  if (filter?.productionType) {
    assets = assets.filter((asset) => asset.productionType === filter.productionType)
  }
  if (filter?.sceneNodeId) {
    assets = assets.filter((asset) => asset.sceneNodeId === filter.sceneNodeId)
  }
  return assets
}

function mediaFilename(prefix: string, id: string, mime: string): string {
  const safeId = id.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'asset'
  const extension = extForContentType(mime)
  return `${prefix}-${safeId}.${extension}`
}

function mediaIdempotencyKey(
  operation: string,
  parts: readonly (string | Uint8Array)[],
): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    const bytes = typeof part === 'string' ? Buffer.from(part) : part
    hash.update(String(bytes.byteLength))
    hash.update(':')
    hash.update(bytes)
  }
  return `wb-game-video:${operation}:${hash.digest('hex')}`
}

function generatedSourceFingerprint(
  asset: HostMediaAsset,
  body: MediaBody,
): string {
  const hash = createHash('sha256')
  for (const part of [
    asset.id,
    asset.type,
    asset.contentType,
    body.contentType,
    body.bytes,
  ]) {
    const bytes = typeof part === 'string' ? Buffer.from(part) : part
    hash.update(String(bytes.byteLength))
    hash.update(':')
    hash.update(bytes)
  }
  return `sha256:${hash.digest('hex')}`
}

function extForContentType(contentType: string): string {
  switch (contentType.toLowerCase().split(';', 1)[0]) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'video/mp4': return 'mp4'
    case 'video/webm': return 'webm'
    case 'video/quicktime': return 'mov'
    default: return 'png'
  }
}

export interface HostAssetRegistry {
  list(filter?: AssetFilter): Promise<MediaAsset[]>
  get(id: string): Promise<MediaAsset | null>
  upsert(asset: MediaAsset): Promise<MediaAsset>
  update(id: string, patch: Partial<MediaAsset>): Promise<MediaAsset | null>
  getStyleAxes(): Promise<StyleAxes | undefined>
  setStyleAxes(axes: StyleAxes): Promise<StyleAxes>
  importGameFile(input: {
    registryId: string
    relativePath: string
    filename: string
    contentType: string
    productionType: 'character_ref' | 'scene_ref'
    label: string
    sourceModule: string
    meta?: Record<string, unknown>
  }): Promise<MediaAsset>
  mediaReference(id: string): Promise<MediaReference>
  persistGenerated(
    generated: HostMediaAsset,
    input: {
      registryId: string
      filenamePrefix: string
      productionType: 'shot_image' | 'grid_storyboard' | 'video_clip'
      sceneNodeId: string
      label: string
      prompt: string
      durationMs?: number
      meta?: Record<string, unknown>
    },
  ): Promise<MediaAsset>
}

/**
 * Creates the registry used by host-neutral service and router calls. Game data
 * is accessed only through bounded file helpers; binary ingress/egress goes
 * through the host media capability.
 */
export function createHostAssetRegistry(
  context: WorkbenchExtensionContext,
): HostAssetRegistry {
  const withManifestLock = <T>(operation: () => Promise<T>): Promise<T> => (
    context.files.withLocks([HOST_MANIFEST_LOCK], operation)
  )
  const trustedMedia = async (): Promise<Map<string, HostMediaAsset>> => (
    new Map(
      (await context.media.list(context.gameId))
        .map((asset) => [asset.id, asset]),
    )
  )
  const prepareHostMediaOperation = async (
    initialManifest: AssetManifest,
    requested: HostMediaIntent,
  ): Promise<{
    manifest: AssetManifest
    hosted?: HostMediaAsset
  }> => {
    let manifest = initialManifest
    const intents = hostMediaIntents(manifest)
    const hostedAssets = await context.media.list(context.gameId)
    const liveAssetIds = new Set(
      manifest.assets
        .map((asset) => normalizeMediaAsset(asset))
        .filter((asset): asset is MediaAsset => asset !== null)
        .map((asset) => declaredHostMediaId(asset))
        .filter((assetId): assetId is string => assetId !== undefined),
    )
    const remaining: HostMediaIntent[] = []
    let recovered: HostMediaAsset | undefined
    let changed = false

    for (const intent of intents) {
      if (intent.registryId !== requested.registryId) {
        remaining.push(intent)
        continue
      }
      const candidates = hostedAssets.filter((asset) => (
        matchesHostMediaIntent(intent, asset)
      ))
      if (candidates.length > 1) {
        throw new Error(
          `Multiple host media objects match one durable intent: ${intent.registryId}`,
        )
      }
      const candidate = candidates[0]
      if (candidate && liveAssetIds.has(candidate.id)) {
        // The manifest reference is authoritative; a stale intent must never
        // make a committed object eligible for deletion.
        changed = true
        continue
      }
      if (sameHostMediaIntent(intent, requested)) {
        remaining.push(intent)
        recovered = candidate
        continue
      }
      if (candidate) {
        await context.media.delete(context.gameId, candidate.id)
      }
      changed = true
    }

    if (changed) {
      manifest = withHostMediaIntents(manifest, remaining)
      await writeHostManifest(context.files, manifest)
    }
    if (!remaining.some((intent) => sameHostMediaIntent(intent, requested))) {
      manifest = withHostMediaIntents(manifest, [...remaining, requested])
      await writeHostManifest(context.files, manifest)
    }
    return { manifest, ...(recovered ? { hosted: recovered } : {}) }
  }
  const completeHostMediaOperation = (
    manifest: AssetManifest,
    intent: HostMediaIntent,
    hosted: HostMediaAsset,
  ): AssetManifest => {
    if (!matchesHostMediaIntent(intent, hosted)) {
      throw new Error('Host media result does not match its durable operation intent')
    }
    const intents = hostMediaIntents(manifest)
    if (!intents.some((entry) => sameHostMediaIntent(entry, intent))) {
      throw new Error('Host media operation intent disappeared before commit')
    }
    return withHostMediaIntents(
      manifest,
      intents.filter((entry) => !sameHostMediaIntent(entry, intent)),
    )
  }
  const drainHostMediaReclaims = async (
    initialManifest: AssetManifest,
    registryId?: string,
    knownGeneratedSources: ReadonlyMap<string, KnownGeneratedSource> = new Map(),
  ): Promise<AssetManifest> => {
    let manifest = initialManifest
    for (const reclaim of hostMediaReclaims(manifest)) {
      if (registryId !== undefined && reclaim.registryId !== registryId) continue
      const liveAssetIds = new Set(
        manifest.assets
          .map((asset) => normalizeMediaAsset(asset))
          .filter((asset): asset is MediaAsset => asset !== null)
          .map((asset) => declaredHostMediaId(asset))
          .filter((assetId): assetId is string => assetId !== undefined),
      )
      const candidates = (await context.media.list(context.gameId))
        .filter((asset) => asset.id === reclaim.assetId)

      if (reclaim.source === 'wb-game-video-model-output') {
        if (candidates.length > 1) {
          throw new Error(
            `Ambiguous generated source media identity: ${reclaim.assetId}`,
          )
        }
        const known = knownGeneratedSources.get(reclaim.assetId)
        const candidate = candidates[0] ?? known?.asset
        const body = candidates[0]
          ? await context.media.read(context.gameId, reclaim.assetId)
          : known?.body

        if (candidate) {
          if (liveAssetIds.has(reclaim.assetId)) {
            throw new Error(
              `Refusing to reclaim current host media reference: ${reclaim.assetId}`,
            )
          }
          if (
            !body
            || generatedSourceFingerprint(candidate, body) !== reclaim.fingerprint
          ) {
            throw new Error(
              `Refusing to reclaim mismatched generated source provenance: ${reclaim.assetId}`,
            )
          }
          await context.media.delete(context.gameId, reclaim.assetId)
        }
        manifest = withHostMediaReclaims(
          manifest,
          hostMediaReclaims(manifest)
            .filter((entry) => entry.assetId !== reclaim.assetId),
        )
        await writeHostManifest(context.files, manifest)
        continue
      }

      if (candidates.length > 1) {
        throw new Error(
          `Multiple host media objects match one reclaim: ${reclaim.assetId}`,
        )
      }
      const candidate = candidates[0]
      const observed = reclaimForHostMedia(reclaim.registryId, candidate)

      if (
        candidate
        && (!observed || !sameHostMediaReclaim(reclaim, observed))
      ) {
        throw new Error(
          `Refusing to reclaim host media with mismatched provenance: ${reclaim.assetId}`,
        )
      }
      if (
        candidate
        && observed
        && liveAssetIds.has(reclaim.assetId)
      ) {
        throw new Error(
          `Refusing to reclaim current host media reference: ${reclaim.assetId}`,
        )
      }
      if (candidate && observed) {
        await context.media.delete(context.gameId, reclaim.assetId)
      }
      manifest = withHostMediaReclaims(
        manifest,
        hostMediaReclaims(manifest)
          .filter((entry) => entry.assetId !== reclaim.assetId),
      )
      await writeHostManifest(context.files, manifest)
    }
    return manifest
  }
  const persistHostAsset = async (
    manifest: AssetManifest,
    index: number,
    current: MediaAsset | null,
    next: MediaAsset,
    knownGeneratedSources: ReadonlyMap<string, KnownGeneratedSource> = new Map(),
  ): Promise<MediaAsset> => {
    const hostedAssets = await trustedMedia()
    const previousHostId = current
      ? trustedHostMediaId(current, hostedAssets)
      : undefined
    const nextHostId = trustedHostMediaId(next, hostedAssets)

    if (index >= 0) manifest.assets[index] = next
    else manifest.assets.push(next)

    let persistedManifest = manifest
    if (
      previousHostId
      && nextHostId
      && previousHostId !== nextHostId
    ) {
      const reclaim = reclaimForHostMedia(
        next.id,
        hostedAssets.get(previousHostId),
      )
      if (reclaim) {
        persistedManifest = enqueueHostMediaReclaim(
          persistedManifest,
          reclaim,
        )
      }
    }
    await writeHostManifest(context.files, persistedManifest)
    await drainHostMediaReclaims(
      persistedManifest,
      next.id,
      knownGeneratedSources,
    )
    return publicHostAsset(next, await trustedMedia())!
  }
  const upsertInManifest = async (
    manifest: AssetManifest,
    asset: MediaAsset,
    knownGeneratedSources?: ReadonlyMap<string, KnownGeneratedSource>,
  ): Promise<MediaAsset> => {
    const index = manifest.assets.findIndex((entry) => (
      isRecord(entry) && entry.id === asset.id
    ))
    const now = Date.now()
    const next: MediaAsset = {
      ...asset,
      createdAt: asset.createdAt || now,
      updatedAt: now,
    }
    if (index >= 0) {
      const currentRecord = manifest.assets[index]
      if (
        !isMediaAsset(currentRecord)
        || (
          isProviderBacked(currentRecord)
          && currentRecord.sourceModule !== next.sourceModule
        )
      ) {
        throw new Error(`Asset id is owned by another asset domain: ${asset.id}`)
      }
      return persistHostAsset(
        manifest,
        index,
        normalizeMediaAsset(currentRecord),
        next,
        knownGeneratedSources,
      )
    }
    return persistHostAsset(
      manifest,
      index,
      null,
      next,
      knownGeneratedSources,
    )
  }
  const upsert = async (asset: MediaAsset): Promise<MediaAsset> => (
    withManifestLock(async () => {
      const manifest = await drainHostMediaReclaims(
        await readHostManifest(context.files),
        asset.id,
      )
      return upsertInManifest(manifest, asset)
    })
  )

  const getRaw = async (id: string): Promise<MediaAsset | null> => {
    const manifest = await readHostManifest(context.files)
    return normalizeMediaAsset(
      manifest.assets.find((entry) => isRecord(entry) && entry.id === id),
    )
  }
  const get = async (id: string): Promise<MediaAsset | null> => (
    publicHostAsset(await getRaw(id), await trustedMedia())
  )

  const updateInManifest = async (
    manifest: AssetManifest,
    id: string,
    patch: Partial<MediaAsset>,
    knownGeneratedSources?: ReadonlyMap<string, KnownGeneratedSource>,
  ): Promise<MediaAsset | null> => {
    const index = manifest.assets.findIndex((entry) => (
      isRecord(entry) && entry.id === id
    ))
    if (index < 0) return null
    const current = normalizeMediaAsset(manifest.assets[index])
    if (!current) return null
    const next: MediaAsset = {
      ...current,
      ...patch,
      id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    }
    if (
      isProviderBacked(manifest.assets[index])
      && current.sourceModule !== next.sourceModule
    ) {
      throw new Error(`Asset id is owned by another asset domain: ${id}`)
    }
    return persistHostAsset(
      manifest,
      index,
      current,
      next,
      knownGeneratedSources,
    )
  }
  const update = async (
    id: string,
    patch: Partial<MediaAsset>,
  ): Promise<MediaAsset | null> => (
    withManifestLock(async () => {
      const manifest = await drainHostMediaReclaims(
        await readHostManifest(context.files),
        id,
      )
      return updateInManifest(manifest, id, patch)
    })
  )

  return {
    async list(filter) {
      return filterAssets(
        await readHostManifest(context.files),
        await trustedMedia(),
        filter,
      )
    },
    get,
    upsert,
    update,
    async getStyleAxes() {
      return (await readHostManifest(context.files)).styleAxes
    },
    async setStyleAxes(axes) {
      return withManifestLock(async () => {
        const manifest = await readHostManifest(context.files)
        const styleAxes = { ...(manifest.styleAxes ?? {}), ...axes }
        await writeHostManifest(context.files, { ...manifest, styleAxes })
        return styleAxes
      })
    },
    async importGameFile(input) {
      const relativePath = assertBoundedRelativePath(input.relativePath)
      const bytes = await context.files.read(relativePath)
      if (!bytes) throw new Error(`Reference media was not found: ${relativePath}`)
      const operationId = mediaIdempotencyKey('asset-import', [
        input.registryId,
        relativePath,
        input.contentType,
        bytes,
      ])
      const intent: HostMediaIntent = {
        registryId: input.registryId,
        source: 'wb-game-video-reference',
        operationId,
      }
      return withManifestLock(async () => {
        const manifest = await drainHostMediaReclaims(
          await readHostManifest(context.files),
          input.registryId,
        )
        const prepared = await prepareHostMediaOperation(
          manifest,
          intent,
        )
        const hosted = prepared.hosted ?? await context.media.put(context.gameId, {
          filename: input.filename,
          contentType: input.contentType,
          bytes,
          idempotencyKey: operationId,
          metadata: {
            source: intent.source,
            registryId: intent.registryId,
            operationId: intent.operationId,
          },
        })
        return upsertInManifest(
          completeHostMediaOperation(prepared.manifest, intent, hosted),
          {
            id: input.registryId,
            kind: 'image',
            productionType: input.productionType,
            status: 'ready',
            label: input.label,
            sourceModule: input.sourceModule,
            mime: hosted.contentType,
            bytes: hosted.sizeBytes ?? bytes.byteLength,
            url: safeHostMediaUrl(hosted.url),
            provider: { kind: 'local', ref: hosted.id },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            meta: {
              ...(input.meta ?? {}),
              hostMedia: {
                provenance: 'workbench-media-capability',
                assetId: hosted.id,
                locator: safeHostMediaUrl(hosted.url),
              },
            },
          },
        )
      })
    },
    async mediaReference(id) {
      const asset = await getRaw(id)
      if (!asset) throw new Error(`参考图不存在：${id}`)
      if (asset.provider?.ref) {
        const hosted = (await context.media.list(context.gameId))
          .find((candidate) => candidate.id === asset.provider!.ref)
        if (!hosted) {
          throw new Error(`参考图 ${id} 的宿主媒体引用不存在`)
        }
        return { assetId: hosted.id }
      }
      if (!asset.file) throw new Error(`参考图 ${id} 没有可读取的宿主媒体`)
      const relativePath = assertBoundedRelativePath(`assets/${asset.file}`)
      const bytes = await context.files.read(relativePath)
      if (!bytes) throw new Error(`参考图 ${id} 内容不存在`)
      const hosted = await context.media.put(context.gameId, {
        filename: mediaFilename('reference', id, asset.mime ?? 'image/png'),
        contentType: asset.mime ?? 'image/png',
        bytes,
        idempotencyKey: mediaIdempotencyKey('asset-reference', [
          id,
          asset.mime ?? 'image/png',
          bytes,
        ]),
        metadata: { source: 'wb-game-video-registry', registryId: id },
      })
      return { assetId: hosted.id }
    },
    async persistGenerated(generated, input) {
      return withManifestLock(async () => {
        const manifest = await drainHostMediaReclaims(
          await readHostManifest(context.files),
          input.registryId,
        )
        const current = normalizeMediaAsset(
          manifest.assets.find((entry) => (
            isRecord(entry) && entry.id === input.registryId
          )),
        )
        const currentHostId = current
          ? trustedHostMediaId(current, await trustedMedia())
          : undefined
        const body = await context.media.read(context.gameId, generated.id)
        if (!body || body.bytes.byteLength === 0) {
          const hostedAssets = await trustedMedia()
          const hostId = current
            ? trustedHostMediaId(current, hostedAssets)
            : undefined
          const hosted = hostId ? hostedAssets.get(hostId) : undefined
          if (
            current?.status === 'ready'
            && current.productionType === input.productionType
            && current.sceneNodeId === input.sceneNodeId
            && current.label === input.label
            && current.prompt === input.prompt
            && current.durationMs === input.durationMs
            && hosted
            && isRecord(hosted.metadata)
            && hosted.metadata.source === 'wb-game-video-generation'
            && hosted.metadata.registryId === input.registryId
            && hosted.metadata.generatedAssetId === generated.id
          ) {
            return publicHostAsset(current, hostedAssets)!
          }
          throw new Error('Generated media is not readable through the host media capability')
        }
        const operationId = mediaIdempotencyKey('asset-generation', [
          generated.id,
          input.registryId,
          body.contentType,
          body.bytes,
        ])
        const intent: HostMediaIntent = {
          registryId: input.registryId,
          source: 'wb-game-video-generation',
          operationId,
        }
        const prepared = await prepareHostMediaOperation(
          manifest,
          intent,
        )
        const hosted = prepared.hosted ?? await context.media.put(context.gameId, {
          filename: mediaFilename(input.filenamePrefix, input.registryId, body.contentType),
          contentType: body.contentType,
          bytes: body.bytes,
          idempotencyKey: operationId,
          metadata: {
            source: intent.source,
            generatedAssetId: generated.id,
            registryId: intent.registryId,
            operationId: intent.operationId,
          },
        })
        let committedManifest = completeHostMediaOperation(
          prepared.manifest,
          intent,
          hosted,
        )
        const knownGeneratedSources = new Map<string, KnownGeneratedSource>()
        if (
          hosted.id !== generated.id
          && currentHostId !== generated.id
        ) {
          committedManifest = enqueueHostMediaReclaim(
            committedManifest,
            {
              registryId: input.registryId,
              assetId: generated.id,
              source: 'wb-game-video-model-output',
              operationId,
              fingerprint: generatedSourceFingerprint(generated, body),
            },
          )
          knownGeneratedSources.set(generated.id, { asset: generated, body })
        }
        const persisted = await updateInManifest(
          committedManifest,
          input.registryId,
          {
            kind: input.productionType === 'video_clip' ? 'video' : 'image',
            productionType: input.productionType,
            status: 'ready',
            label: input.label,
            prompt: input.prompt,
            sceneNodeId: input.sceneNodeId,
            sourceModule: 'wb-game-video',
            mime: hosted.contentType,
            bytes: hosted.sizeBytes ?? body.bytes.byteLength,
            url: safeHostMediaUrl(hosted.url),
            provider: { kind: 'local', ref: hosted.id },
            durationMs: input.durationMs,
            updatedAt: Date.now(),
            meta: {
              ...(input.meta ?? {}),
              hostMedia: {
                provenance: 'workbench-media-capability',
                assetId: hosted.id,
                locator: safeHostMediaUrl(hosted.url),
              },
            },
          },
          knownGeneratedSources,
        )
        if (!persisted) {
          throw new Error(`Generating asset disappeared: ${input.registryId}`)
        }
        return persisted
      })
    },
  }
}

export async function getHostStyleAxes(
  context: WorkbenchExtensionContext,
): Promise<StyleAxes | undefined> {
  return createHostAssetRegistry(context).getStyleAxes()
}
