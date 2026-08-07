/**
 * 资产库的本地展示元数据。
 *
 * Kino resource DTO 没有 folder/tag 字段；这里刻意只以 resource id 为键保存 UI
 * 分类，不把本地状态伪装成服务端资源的一部分。
 */

export const VIDEO_LIBRARY_METADATA_VERSION = 1
export const VIDEO_LIBRARY_METADATA_MAX_FOLDER_NAME_LENGTH = 32

const STORAGE_KEY_PREFIX = `wb-game-video:video-library-metadata:v${VIDEO_LIBRARY_METADATA_VERSION}:`

export interface VideoLibraryMetadata {
  /** 仅存有分类的条目；没有键即表示 root / 未分类。 */
  tagsByEntryId: Record<string, string>
  /** Empty folders are kept separately so creating a folder survives reload. */
  folderNames: string[]
}

/** Creates an empty local folder without changing any Kino resource. */
export function writeVideoLibraryFolderName(
  gameId: string,
  folderName: string,
  storage?: VideoLibraryMetadataStorage,
): VideoLibraryMetadataWriteResult {
  assertGameId(gameId)
  const normalized = normalizeVideoLibraryFolderName(folderName)
  if (!normalized) throw new RangeError('folderName must not be empty')

  const storageKey = videoLibraryMetadataStorageKey(gameId)
  const resolved = resolveStorage('write', storage)
  if ('status' in resolved) return resolved

  let current: VideoLibraryMetadata
  try {
    current = parsePersistedMetadata(resolved.storage.getItem(storageKey))
  } catch (error) {
    return unavailable('storage-unavailable', 'read', error)
  }
  const nextMetadata: VideoLibraryMetadata = {
    tagsByEntryId: { ...current.tagsByEntryId },
    folderNames: [...new Set([...current.folderNames, normalized])]
      .sort((left, right) => left.localeCompare(right)),
  }
  try {
    resolved.storage.setItem(storageKey, serializeMetadata(nextMetadata))
    return { status: 'written', storageKey, ...nextMetadata }
  } catch (error) {
    return unavailable('storage-unavailable', 'write', error)
  }
}

export interface VideoLibraryMetadataStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type VideoLibraryMetadataUnavailableReason = 'server' | 'storage-unavailable'

export interface VideoLibraryMetadataUnavailable {
  status: 'unavailable'
  reason: VideoLibraryMetadataUnavailableReason
  operation: 'read' | 'write'
  /** Storage API 抛出的原始错误；SSR 时没有错误对象。 */
  error?: unknown
}

export interface VideoLibraryMetadataReady extends VideoLibraryMetadata {
  status: 'ready'
  storageKey: string
}

export type VideoLibraryMetadataReadResult = VideoLibraryMetadataReady | VideoLibraryMetadataUnavailable

export interface VideoLibraryMetadataWritten extends VideoLibraryMetadata {
  status: 'written'
  storageKey: string
}

export type VideoLibraryMetadataWriteResult = VideoLibraryMetadataWritten | VideoLibraryMetadataUnavailable

interface PersistedVideoLibraryMetadataV1 {
  version: typeof VIDEO_LIBRARY_METADATA_VERSION
  tagsByEntryId: Record<string, string>
  folderNames?: unknown
}

interface StorageAvailable {
  storage: VideoLibraryMetadataStorage
}

type StorageResolution = StorageAvailable | VideoLibraryMetadataUnavailable

function assertGameId(gameId: string): void {
  if (typeof gameId !== 'string' || gameId.trim().length === 0) {
    throw new TypeError('gameId must be a non-empty string')
  }
}

function assertEntryId(entryId: string): void {
  if (typeof entryId !== 'string' || entryId.length === 0) {
    throw new TypeError('entryId must be a non-empty string')
  }
}

function hasStorageShape(value: unknown): value is VideoLibraryMetadataStorage {
  if (value == null || typeof value !== 'object') {
    return false
  }
  const storage = value as Partial<VideoLibraryMetadataStorage>
  return typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function'
}

function unavailable(
  reason: VideoLibraryMetadataUnavailableReason,
  operation: 'read' | 'write',
  error?: unknown,
): VideoLibraryMetadataUnavailable {
  return error === undefined
    ? { status: 'unavailable', reason, operation }
    : { status: 'unavailable', reason, operation, error }
}

function resolveStorage(
  operation: 'read' | 'write',
  storage?: VideoLibraryMetadataStorage,
): StorageResolution {
  if (storage !== undefined) {
    return hasStorageShape(storage)
      ? { storage }
      : unavailable('storage-unavailable', operation)
  }
  if (typeof window === 'undefined') {
    return unavailable('server', operation)
  }
  try {
    const browserStorage = window.localStorage
    return hasStorageShape(browserStorage)
      ? { storage: browserStorage }
      : unavailable('storage-unavailable', operation)
  } catch (error) {
    return unavailable('storage-unavailable', operation, error)
  }
}

/** Versioned and game-scoped localStorage key. */
export function videoLibraryMetadataStorageKey(gameId: string): string {
  assertGameId(gameId)
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(gameId)}`
}

/**
 * Normalizes a persisted folder value. `null` means root / 未分类.
 * Invalid persisted values intentionally disappear instead of entering UI state.
 */
export function normalizeVideoLibraryFolderName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const folderName = value.trim()
  return folderName.length > 0 && folderName.length <= VIDEO_LIBRARY_METADATA_MAX_FOLDER_NAME_LENGTH
    ? folderName
    : null
}

function parsePersistedMetadata(raw: string | null): VideoLibraryMetadata {
  if (raw == null) {
    return { tagsByEntryId: {}, folderNames: [] }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { tagsByEntryId: {}, folderNames: [] }
    }
    const candidate = parsed as Partial<PersistedVideoLibraryMetadataV1>
    if (candidate.version !== VIDEO_LIBRARY_METADATA_VERSION
      || candidate.tagsByEntryId == null
      || typeof candidate.tagsByEntryId !== 'object'
      || Array.isArray(candidate.tagsByEntryId)) {
      return { tagsByEntryId: {}, folderNames: [] }
    }

    const tagsByEntryId: Record<string, string> = {}
    for (const [entryId, value] of Object.entries(candidate.tagsByEntryId)) {
      if (entryId.length === 0) {
        continue
      }
      const folderName = normalizeVideoLibraryFolderName(value)
      if (folderName !== null) {
        tagsByEntryId[entryId] = folderName
      }
    }
    const folderNames = Array.isArray(candidate.folderNames)
      ? [...new Set(candidate.folderNames
        .map(normalizeVideoLibraryFolderName)
        .filter((folderName): folderName is string => folderName !== null))]
      : []
    return { tagsByEntryId, folderNames }
  } catch {
    return { tagsByEntryId: {}, folderNames: [] }
  }
}

function serializeMetadata(metadata: VideoLibraryMetadata): string {
  const persisted: PersistedVideoLibraryMetadataV1 = {
    version: VIDEO_LIBRARY_METADATA_VERSION,
    tagsByEntryId: metadata.tagsByEntryId,
    folderNames: metadata.folderNames,
  }
  return JSON.stringify(persisted)
}

/**
 * Reads only local display metadata. On SSR or when the browser denies storage,
 * callers get an explicit state rather than a fabricated empty persisted state.
 */
export function readVideoLibraryMetadata(
  gameId: string,
  storage?: VideoLibraryMetadataStorage,
): VideoLibraryMetadataReadResult {
  assertGameId(gameId)
  const storageKey = videoLibraryMetadataStorageKey(gameId)
  const resolved = resolveStorage('read', storage)
  if ('status' in resolved) {
    return resolved
  }
  try {
    return {
      status: 'ready',
      storageKey,
      ...parsePersistedMetadata(resolved.storage.getItem(storageKey)),
    }
  } catch (error) {
    return unavailable('storage-unavailable', 'read', error)
  }
}

/** Returns a tag by entry id; `null` is the root / 未分类 bucket. */
export function resolveVideoLibraryEntryTag(
  entryId: string,
  metadata: VideoLibraryMetadata,
): string | null {
  assertEntryId(entryId)
  return normalizeVideoLibraryFolderName(metadata.tagsByEntryId[entryId])
}

/** Lists distinct folder names in deterministic display order. */
export function listVideoLibraryFolderNames(metadata: VideoLibraryMetadata): string[] {
  return [...new Set([...metadata.folderNames, ...Object.values(metadata.tagsByEntryId)]
    .map(normalizeVideoLibraryFolderName)
    .filter((folderName): folderName is string => folderName !== null))]
   .sort((left, right) => left.localeCompare(right))
}

/**
 * Assigns a local folder tag. Empty strings, whitespace, `null`, and `undefined`
 * remove the assignment and therefore place the entry in root / 未分类.
 *
 * A too-long tag is a caller error, not a deletion request, so it is surfaced as
 * RangeError before any storage mutation.
 */
export function writeVideoLibraryEntryTag(
  gameId: string,
  entryId: string,
  tag: string | null | undefined,
  storage?: VideoLibraryMetadataStorage,
): VideoLibraryMetadataWriteResult {
  assertGameId(gameId)
  assertEntryId(entryId)
  if (tag != null && typeof tag !== 'string') {
    throw new TypeError('tag must be a string, null, or undefined')
  }
  if (typeof tag === 'string' && tag.trim().length > VIDEO_LIBRARY_METADATA_MAX_FOLDER_NAME_LENGTH) {
    throw new RangeError(`tag must be at most ${VIDEO_LIBRARY_METADATA_MAX_FOLDER_NAME_LENGTH} characters`)
  }

  const storageKey = videoLibraryMetadataStorageKey(gameId)
  const resolved = resolveStorage('write', storage)
  if ('status' in resolved) {
    return resolved
  }

  let current: VideoLibraryMetadata
  try {
    current = parsePersistedMetadata(resolved.storage.getItem(storageKey))
  } catch (error) {
    return unavailable('storage-unavailable', 'read', error)
  }

  const tagsByEntryId = { ...current.tagsByEntryId }
  const folderName = normalizeVideoLibraryFolderName(tag)
  if (folderName === null) {
    delete tagsByEntryId[entryId]
  } else {
    tagsByEntryId[entryId] = folderName
  }

  const nextMetadata: VideoLibraryMetadata = {
    tagsByEntryId,
    folderNames: current.folderNames,
  }

  try {
    if (Object.keys(tagsByEntryId).length === 0 && nextMetadata.folderNames.length === 0) {
      resolved.storage.removeItem(storageKey)
    } else {
      resolved.storage.setItem(storageKey, serializeMetadata(nextMetadata))
    }
    return { status: 'written', storageKey, ...nextMetadata }
  } catch (error) {
    return unavailable('storage-unavailable', 'write', error)
  }
}
