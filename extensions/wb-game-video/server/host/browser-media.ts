import { createHash, randomUUID } from 'node:crypto'
import type {
  MediaBody,
} from '@forgeax/workbench-host/contracts'
import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'
import { WbServiceInputError } from './wb-service'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type BrowserMediaType = 'audio' | 'image' | 'video' | 'font'

type BrowserMediaRecord = {
  readonly resource_id: string
  host_id?: string
  upload_id?: string
  readonly media_type: BrowserMediaType
  name: string
  type?: string
  remark?: string
  source?: string
  source_meta?: Record<string, unknown>
  readonly created_at: number
  updated_at: number
  deleted: boolean
  reclaim_ids?: string[]
}

type UploadSession = {
  readonly version: 1
  readonly id: string
  readonly fileName: string
  readonly mediaType: BrowserMediaType
  readonly contentType: string
  readonly totalSize: number
  readonly chunkSize: number
  readonly chunkCount: number
  readonly createdAt: number
  readonly expiresAt: number
  readonly clientResourceId?: string
  readonly replaceExisting?: boolean
  nextIndex: number
  status: 'open' | 'finalizing' | 'finalized' | 'expired'
  resourceId?: string
}

type KinoCreateInput = {
  media_type: BrowserMediaType
  url: string
  name?: string
  type?: string
  remark?: string
  source?: string
  source_meta?: Record<string, unknown>
}

const BROWSER_MEDIA_INDEX_PATH = 'assets/wb-game-video-media.json'
const UPLOAD_ROOT = 'assets/.wb-game-video-uploads'
const UPLOAD_CHUNK_BYTES = 512 * 1024
const MAX_UPLOAD_CHUNKS = 200
const MAX_ACTIVE_UPLOADS = 16
const MAX_ACTIVE_UPLOAD_BYTES = 256 * 1024 * 1024
const UPLOAD_ID_PATTERN = /^[0-9a-f]{32}$/
const UPLOAD_REFERENCE_PATTERN = /^workbench-upload:([0-9a-f]{32})$/
const HOST_FILENAME_PREFIX = 'wb-game-video-host-'
const RESOURCE_ID_PREFIX = 'wb-game-video-resource-'
const UPLOAD_ALLOCATION_LOCK = 'wb-game-video-browser-media-allocation'
const BROWSER_MEDIA_INDEX_LOCK = 'wb-game-video-browser-media-index'

const MEDIA_POLICIES: Readonly<Record<BrowserMediaType, {
  readonly maxBytes: number
  readonly mimeTypes: readonly string[]
}>> = {
  image: {
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  video: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: ['video/mp4'],
  },
  audio: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac'],
  },
  font: {
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'],
  },
}

export class UploadConflictError extends Error {}

function exactObject(
  value: unknown,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WbServiceInputError(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new WbServiceInputError(`${label} contains unsupported key: ${key}`)
    }
  }
  return record
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WbServiceInputError(`${label} must be a non-empty string`)
  }
  return value
}

function safeFileName(value: unknown): string {
  const name = nonEmptyString(value, 'file_name')
  if (
    name.length > 255
    || /[/\\\u0000-\u001f\u007f]/.test(name)
    || name === '.'
    || name === '..'
  ) {
    throw new WbServiceInputError('file_name is invalid')
  }
  return name
}

export function browserMediaType(value: string | undefined): BrowserMediaType {
  if (value === 'audio' || value === 'image' || value === 'video' || value === 'font') return value
  throw new WbServiceInputError('x-workbench-media-type is invalid')
}

function mediaTypeForContentType(value: string): BrowserMediaType {
  for (const [type, policy] of Object.entries(MEDIA_POLICIES) as Array<
    [BrowserMediaType, typeof MEDIA_POLICIES[BrowserMediaType]]
  >) {
    if (policy.mimeTypes.includes(value)) return type
  }
  throw new WbServiceInputError('mime_type is invalid')
}

function resource(record: BrowserMediaRecord, url: string) {
  return {
    resource_id: record.resource_id,
    media_type: record.media_type,
    name: record.name,
    ...(record.type === undefined ? {} : { type: record.type }),
    ...(record.remark === undefined ? {} : { remark: record.remark }),
    ...(record.source === undefined ? {} : { source: record.source }),
    ...(record.source_meta === undefined ? {} : { source_meta: record.source_meta }),
    url,
    created_at: record.created_at,
    updated_at: record.updated_at,
  }
}

function browserMediaRecord(value: unknown): BrowserMediaRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid persisted browser media record')
  }
  const record = value as Partial<BrowserMediaRecord>
  if (
    typeof record.resource_id !== 'string'
    || !record.resource_id
    || (record.host_id !== undefined && typeof record.host_id !== 'string')
    || (record.upload_id !== undefined && !UPLOAD_ID_PATTERN.test(record.upload_id))
    || (record.media_type !== 'audio' && record.media_type !== 'image' && record.media_type !== 'video' && record.media_type !== 'font')
    || typeof record.name !== 'string'
    || (record.type !== undefined && typeof record.type !== 'string')
    || (record.remark !== undefined && typeof record.remark !== 'string')
    || (record.source !== undefined && typeof record.source !== 'string')
    || (record.source_meta !== undefined && (
      !record.source_meta
      || typeof record.source_meta !== 'object'
      || Array.isArray(record.source_meta)
    ))
    || !Number.isSafeInteger(record.created_at)
    || !Number.isSafeInteger(record.updated_at)
    || typeof record.deleted !== 'boolean'
    || (record.reclaim_ids !== undefined && (
      !Array.isArray(record.reclaim_ids)
      || record.reclaim_ids.some((id) => typeof id !== 'string' || !id)
      || new Set(record.reclaim_ids).size !== record.reclaim_ids.length
    ))
  ) {
    throw new Error('Invalid persisted browser media record')
  }
  return record as BrowserMediaRecord
}

async function readBrowserMedia(context: WorkbenchExtensionContext): Promise<BrowserMediaRecord[]> {
  const bytes = await context.files.read(BROWSER_MEDIA_INDEX_PATH)
  if (!bytes) return []
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new Error('Invalid persisted browser media index')
  }
  if (!Array.isArray(value)) throw new Error('Invalid persisted browser media index')
  const records = value.map(browserMediaRecord)
  assertBrowserMediaIdentities(records)
  return records
}

function assertBrowserMediaIdentities(records: readonly BrowserMediaRecord[]): void {
  const resourceOwners = new Map<string, number>()
  const liveResourceOwners = new Map<string, number>()
  const hostOwners = new Map<string, number>()
  const liveHostOwners = new Set<string>()
  const uploadOwners = new Set<string>()
  for (const [index, record] of records.entries()) {
    if (
      resourceOwners.has(record.resource_id)
      || (record.upload_id !== undefined && uploadOwners.has(record.upload_id))
    ) {
      throw new Error('Invalid persisted browser media index')
    }
    resourceOwners.set(record.resource_id, index)
    if (!record.deleted) {
      const hostId = hostMediaId(record)
      if (hostOwners.has(hostId)) {
        throw new Error('Invalid persisted browser media index')
      }
      liveResourceOwners.set(record.resource_id, index)
      hostOwners.set(hostId, index)
      liveHostOwners.add(hostId)
    }
    if (record.upload_id !== undefined) uploadOwners.add(record.upload_id)
  }
  for (const [resourceId, resourceOwner] of liveResourceOwners) {
    const hostOwner = hostOwners.get(resourceId)
    if (hostOwner !== undefined && hostOwner !== resourceOwner) {
      throw new Error('Invalid persisted browser media index')
    }
  }
  for (const record of records) {
    if (record.reclaim_ids?.some((assetId) => liveHostOwners.has(assetId))) {
      throw new Error('Invalid persisted browser media index')
    }
  }
}

async function writeBrowserMedia(
  context: WorkbenchExtensionContext,
  records: readonly BrowserMediaRecord[],
): Promise<void> {
  assertBrowserMediaIdentities(records)
  await context.files.write(BROWSER_MEDIA_INDEX_PATH, encoder.encode(JSON.stringify(records)))
}

async function browserMediaLocators(
  context: WorkbenchExtensionContext,
): Promise<Map<string, string>> {
  return new Map((await context.media.list(context.gameId)).map((asset) => [asset.id, asset.url]))
}

function hostMediaId(record: BrowserMediaRecord): string {
  return record.host_id ?? record.resource_id
}

function appendReclaims(
  record: BrowserMediaRecord,
  ids: readonly (string | undefined)[],
): void {
  const currentHostId = record.deleted ? undefined : hostMediaId(record)
  const reclaimIds = new Set(record.reclaim_ids ?? [])
  for (const id of ids) {
    if (id && id !== currentHostId) reclaimIds.add(id)
  }
  if (reclaimIds.size > 0) record.reclaim_ids = [...reclaimIds].sort()
  else delete record.reclaim_ids
}

async function reclaimPendingMedia(
  context: WorkbenchExtensionContext,
  records: BrowserMediaRecord[],
  record: BrowserMediaRecord,
): Promise<void> {
  const pending = record.reclaim_ids ?? []
  if (pending.length === 0) return
  const hostedAssets = new Map(
    (await context.media.list(context.gameId)).map((asset) => [asset.id, asset]),
  )
  const reclaimedCurrentHost = record.deleted
    && record.host_id !== undefined
    && pending.includes(record.host_id)
  for (const assetId of pending) {
    const hosted = hostedAssets.get(assetId)
    if (hosted && hosted.metadata?.source !== 'wb-game-video-browser') {
      throw new Error('Refusing to reclaim media not owned by wb-game-video')
    }
    await context.media.delete(context.gameId, assetId)
  }
  delete record.reclaim_ids
  if (reclaimedCurrentHost) delete record.host_id
  await writeBrowserMedia(context, records)
}

function hostFilename(uploadId: string): string {
  return `${HOST_FILENAME_PREFIX}${uploadId}`
}

function uniqueResourceId(records: readonly BrowserMediaRecord[]): string {
  let id: string
  do {
    id = `${RESOURCE_ID_PREFIX}${randomUUID().replaceAll('-', '')}`
  } while (records.some((record) =>
    record.resource_id === id || (!record.deleted && hostMediaId(record) === id)))
  return id
}

function uniqueUploadId(records: readonly BrowserMediaRecord[]): string {
  let id: string
  do {
    id = randomUUID().replaceAll('-', '')
  } while (records.some((record) => record.upload_id === id))
  return id
}

function framedSha256(parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    hash.update(String(bytes.byteLength))
    hash.update(':')
    hash.update(bytes)
  }
  return hash.digest('hex')
}

function uploadSessionPath(id: string): string {
  return `${UPLOAD_ROOT}/slots/${uploadSlot(id)}/session.json`
}

function uploadChunkPath(id: string, index: number): string {
  return `${UPLOAD_ROOT}/slots/${uploadSlot(id)}/chunks/${index}.bin`
}

function uploadSlot(id: string): number {
  if (!UPLOAD_ID_PATTERN.test(id)) throw new WbServiceInputError('Upload id is invalid')
  return Number.parseInt(id.slice(0, 2), 16) % MAX_ACTIVE_UPLOADS
}

async function readUploadSlot(
  context: WorkbenchExtensionContext,
  slot: number,
): Promise<UploadSession | null> {
  const bytes = await context.files.read(`${UPLOAD_ROOT}/slots/${slot}/session.json`)
  if (!bytes) return null
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new Error('Invalid persisted upload session')
  }
  const id = (value as { id?: unknown })?.id
  if (typeof id !== 'string') throw new Error('Invalid persisted upload session')
  return uploadSession(value, id)
}

function withUploadSlotLock<T>(
  context: WorkbenchExtensionContext,
  slot: number,
  operation: () => Promise<T>,
): Promise<T> {
  return context.files.withLocks(
    [`wb-game-video-browser-media-slot-${slot}`],
    operation,
  )
}

function withUploadAllocationLock<T>(
  context: WorkbenchExtensionContext,
  operation: () => Promise<T>,
): Promise<T> {
  return context.files.withLocks([UPLOAD_ALLOCATION_LOCK], operation)
}

async function withBrowserIndexLock<T>(
  context: WorkbenchExtensionContext,
  operation: () => Promise<T>,
): Promise<T> {
  return context.files.withLocks([BROWSER_MEDIA_INDEX_LOCK], operation)
}

function uploadSession(value: unknown, expectedId: string): UploadSession {
  const session = exactObject(value, [
    'version', 'id', 'fileName', 'mediaType', 'contentType', 'totalSize',
    'chunkSize', 'chunkCount', 'createdAt', 'expiresAt', 'clientResourceId',
    'replaceExisting', 'nextIndex', 'status', 'resourceId',
  ], 'upload session') as Partial<UploadSession>
  if (
    session.version !== 1
    || session.id !== expectedId
    || !UPLOAD_ID_PATTERN.test(expectedId)
    || typeof session.fileName !== 'string'
    || browserMediaType(session.mediaType) !== session.mediaType
    || typeof session.contentType !== 'string'
    || !MEDIA_POLICIES[session.mediaType].mimeTypes.includes(session.contentType)
    || !Number.isSafeInteger(session.totalSize)
    || session.totalSize! <= 0
    || session.totalSize! > MEDIA_POLICIES[session.mediaType].maxBytes
    || session.chunkSize !== UPLOAD_CHUNK_BYTES
    || !Number.isSafeInteger(session.chunkCount)
    || session.chunkCount! <= 0
    || session.chunkCount! > MAX_UPLOAD_CHUNKS
    || session.chunkCount !== Math.ceil(session.totalSize! / session.chunkSize)
    || !Number.isSafeInteger(session.createdAt)
    || !Number.isSafeInteger(session.expiresAt)
    || (session.clientResourceId !== undefined && typeof session.clientResourceId !== 'string')
    || (session.replaceExisting !== undefined && typeof session.replaceExisting !== 'boolean')
    || !Number.isSafeInteger(session.nextIndex)
    || session.nextIndex! < 0
    || session.nextIndex! > session.chunkCount!
    || (
      session.status !== 'open'
      && session.status !== 'finalizing'
      && session.status !== 'finalized'
      && session.status !== 'expired'
    )
    || (session.resourceId !== undefined && typeof session.resourceId !== 'string')
    || (session.status === 'finalizing' && (
      !session.resourceId
      || session.nextIndex !== session.chunkCount
    ))
  ) {
    throw new Error('Invalid persisted upload session')
  }
  return session as UploadSession
}

async function readUploadSession(
  context: WorkbenchExtensionContext,
  id: string,
): Promise<UploadSession | null> {
  if (!UPLOAD_ID_PATTERN.test(id)) return null
  const bytes = await context.files.read(uploadSessionPath(id))
  if (!bytes) return null
  try {
    const value = JSON.parse(decoder.decode(bytes)) as unknown
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof (value as { id?: unknown }).id === 'string'
      && (value as { id: string }).id !== id
    ) {
      return null
    }
    return uploadSession(value, id)
  } catch (error) {
    if (error instanceof WbServiceInputError) throw new Error('Invalid persisted upload session')
    throw error
  }
}

async function writeUploadSession(
  context: WorkbenchExtensionContext,
  session: UploadSession,
): Promise<void> {
  await context.files.write(uploadSessionPath(session.id), encoder.encode(JSON.stringify(session)))
}

async function clearUploadChunks(
  context: WorkbenchExtensionContext,
  session: UploadSession,
): Promise<void> {
  for (let index = 0; index < session.chunkCount; index += 1) {
    await context.files.write(uploadChunkPath(session.id, index), new Uint8Array())
  }
}

async function requireActiveUploadSession(
  context: WorkbenchExtensionContext,
  session: UploadSession,
): Promise<void> {
  if (session.status === 'expired' || (session.status === 'open' && Date.now() >= session.expiresAt)) {
    await clearUploadChunks(context, session)
    if (session.status !== 'expired') {
      session.status = 'expired'
      await writeUploadSession(context, session)
    }
    throw new UploadConflictError('Upload session is expired')
  }
}

async function cleanupExpiredUploads(context: WorkbenchExtensionContext): Promise<void> {
  for (let slot = 0; slot < MAX_ACTIVE_UPLOADS; slot += 1) {
    await withUploadSlotLock(context, slot, async () => {
      const session = await readUploadSlot(context, slot)
      if (!session) return
      if (session.status === 'finalized' || session.status === 'expired') {
        return
      }
      if (session.status === 'finalizing') {
        const committed = await withBrowserIndexLock(context, async () => {
          const records = await readBrowserMedia(context)
          const record = records.find((record) =>
            !record.deleted
            && record.resource_id === session.resourceId
            && record.upload_id === session.id)
          if (!record) return false
          await reclaimPendingMedia(context, records, record)
          return true
        })
        if (committed) {
          await clearUploadChunks(context, session)
          session.status = 'finalized'
          await writeUploadSession(context, session)
          return
        }
        // A finalizing session may already have a durable host-media receipt.
        // Keep its chunks available so an idempotent retry can reconcile the
        // browser index instead of orphaning the hosted object.
        return
      }
      if (Date.now() < session.expiresAt) return
      try {
        await requireActiveUploadSession(context, session)
      } catch (error) {
        if (!(error instanceof UploadConflictError)) throw error
      }
    })
  }
}

async function activeUploadUsage(context: WorkbenchExtensionContext): Promise<{
  count: number
  bytes: number
}> {
  let count = 0
  let bytes = 0
  for (let slot = 0; slot < MAX_ACTIVE_UPLOADS; slot += 1) {
    const session = await withUploadSlotLock(
      context,
      slot,
      () => readUploadSlot(context, slot),
    )
    if (!session || (session.status !== 'open' && session.status !== 'finalizing')) continue
    if (session.status === 'open' && Date.now() >= session.expiresAt) continue
    count += 1
    bytes += session.totalSize
  }
  return { count, bytes }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function kinoCreateInput(
  value: unknown,
): KinoCreateInput {
  const input = exactObject(value, [
    'media_type', 'url', 'name', 'type', 'remark', 'source', 'source_meta',
  ], 'resource')
  const mediaType = browserMediaType(
    typeof input.media_type === 'string' ? input.media_type : undefined,
  )
  const url = nonEmptyString(input.url, 'url')
  for (const key of ['name', 'type', 'remark', 'source'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'string') {
      throw new WbServiceInputError(`${key} must be a string`)
    }
  }
  if (input.source_meta !== undefined && (
    !input.source_meta
    || typeof input.source_meta !== 'object'
    || Array.isArray(input.source_meta)
  )) {
    throw new WbServiceInputError('source_meta must be an object')
  }
  return {
    media_type: mediaType,
    url,
    ...(input.name === undefined ? {} : { name: input.name as string }),
    ...(input.type === undefined ? {} : { type: input.type as string }),
    ...(input.remark === undefined ? {} : { remark: input.remark as string }),
    ...(input.source === undefined ? {} : { source: input.source as string }),
    ...(input.source_meta === undefined ? {} : {
      source_meta: input.source_meta as Record<string, unknown>,
    }),
  }
}

async function finalizeBrowserUpload(
  context: WorkbenchExtensionContext,
  input: KinoCreateInput,
): Promise<ReturnType<typeof resource>> {
  const match = UPLOAD_REFERENCE_PATTERN.exec(input.url)
  if (!match) throw new WbServiceInputError('url is not a prepared workbench upload')
  const id = match[1]!
  return withUploadSlotLock(context, uploadSlot(id), async () => {
    const session = await readUploadSession(context, id)
    if (!session) throw new WbServiceInputError('Prepared upload was not found')
    await requireActiveUploadSession(context, session)
    if (session.mediaType !== input.media_type) {
      throw new WbServiceInputError('media_type does not match the prepared upload')
    }
    if (session.status === 'finalized') {
      if (!session.resourceId) throw new Error('Invalid finalized upload session')
      await clearUploadChunks(context, session)
      return withBrowserIndexLock(context, async () => {
        const records = await readBrowserMedia(context)
        const record = records.find((item) =>
          item.resource_id === session.resourceId && !item.deleted)
        if (!record) throw new Error('Finalized upload resource is unavailable')
        await reclaimPendingMedia(context, records, record)
        const locator = (await browserMediaLocators(context)).get(hostMediaId(record))
        if (!locator) throw new Error('Finalized upload resource is unavailable')
        return resource(record, locator)
      })
    }
    if (session.nextIndex !== session.chunkCount) {
      throw new WbServiceInputError('Prepared upload is incomplete')
    }
    return withBrowserIndexLock(context, async () => {
      const records = await readBrowserMedia(context)
      const committed = session.status === 'finalizing' && session.resourceId
        ? records.find((record) =>
          !record.deleted
          && record.resource_id === session.resourceId
          && record.upload_id === session.id)
        : undefined
      if (committed) {
        await reclaimPendingMedia(context, records, committed)
        await clearUploadChunks(context, session)
        session.status = 'finalized'
        await writeUploadSession(context, session)
        const locator = (await browserMediaLocators(context)).get(hostMediaId(committed))
        if (!locator) throw new Error('Finalized upload resource is unavailable')
        return resource(committed, locator)
      }
      const replacementIndex = session.replaceExisting && session.clientResourceId
        ? records.findIndex((item) =>
          item.resource_id === session.clientResourceId
          && !item.deleted
          && item.media_type === session.mediaType)
        : -1
      if (session.replaceExisting && replacementIndex < 0) {
        throw new WbServiceInputError('Replacement resource was not found')
      }
      const current = replacementIndex >= 0 ? records[replacementIndex]! : undefined
      const resourceId = session.resourceId ?? current?.resource_id ?? uniqueResourceId(records)
      if (records.some((record, index) =>
        index !== replacementIndex
        && (
          record.resource_id === resourceId
          || (!record.deleted && hostMediaId(record) === resourceId)
        )
      )) {
        throw new Error('Browser resource id aliases another host media id')
      }
      if (session.status === 'open') {
        session.resourceId = resourceId
        session.status = 'finalizing'
        await writeUploadSession(context, session)
      }
      const combined = new Uint8Array(session.totalSize)
      let offset = 0
      for (let index = 0; index < session.chunkCount; index += 1) {
        const chunk = await context.files.read(uploadChunkPath(id, index))
        const expected = index === session.chunkCount - 1
          ? session.totalSize - session.chunkSize * index
          : session.chunkSize
        if (!chunk || chunk.byteLength !== expected) {
          throw new WbServiceInputError('Prepared upload is incomplete')
        }
        combined.set(chunk, offset)
        offset += chunk.byteLength
      }
      if (offset !== session.totalSize) {
        throw new WbServiceInputError('Prepared upload is incomplete')
      }
      const hosted = await context.media.put(context.gameId, {
        filename: hostFilename(session.id),
        contentType: session.contentType,
        bytes: combined,
        idempotencyKey: `wb-game-video:browser-upload:${session.id}`,
        metadata: { source: 'wb-game-video-browser', uploadId: session.id },
      })
      const now = Date.now()
      const record: BrowserMediaRecord = {
        resource_id: resourceId,
        host_id: hosted.id,
        upload_id: session.id,
        media_type: session.mediaType,
        name: input.name ?? session.fileName,
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.remark === undefined ? {} : { remark: input.remark }),
        ...(input.source === undefined ? {} : { source: input.source }),
        source_meta: {
          ...(input.source_meta ?? {}),
          mime_type: session.contentType,
          extra: {
            ...(
              input.source_meta?.extra
              && typeof input.source_meta.extra === 'object'
              && !Array.isArray(input.source_meta.extra)
                ? input.source_meta.extra as Record<string, unknown>
                : {}
            ),
            bytes: session.totalSize,
          },
        },
        created_at: current?.created_at ?? now,
        updated_at: now,
        deleted: false,
      }
      if (current) {
        appendReclaims(record, [
          ...(current.reclaim_ids ?? []),
          hostMediaId(current),
        ])
      }
      if (records.some((item, index) =>
        index !== replacementIndex
        && (
          item.resource_id === record.resource_id
          || (
            !item.deleted
            && (
              hostMediaId(item) === record.resource_id
              || item.resource_id === hosted.id
              || hostMediaId(item) === hosted.id
            )
          )
        )
      )) {
        throw new Error('Host media id already exists in the browser media index')
      }
      if (replacementIndex >= 0) records[replacementIndex] = record
      else records.push(record)
      await writeBrowserMedia(context, records)
      await reclaimPendingMedia(context, records, record)
      await clearUploadChunks(context, session)
      session.status = 'finalized'
      await writeUploadSession(context, session)
      return resource(record, hosted.url)
    })
  })
}

export function createBrowserMediaService(context: WorkbenchExtensionContext) {
  return {
    async list(type?: BrowserMediaType, resourceType?: string) {
      const locators = await browserMediaLocators(context)
      return (await readBrowserMedia(context))
        .filter((record) =>
          !record.deleted
          && (!type || record.media_type === type)
          && (!resourceType || record.type === resourceType),
        )
        .flatMap((record) => {
          const locator = locators.get(hostMediaId(record))
          return locator ? [resource(record, locator)] : []
        })
    },

    async prepareUpload(value: unknown) {
      const input = exactObject(value, [
        'file_name', 'mime_type', 'bytes', 'extension',
        'client_resource_id', 'replace_existing',
      ], 'upload preparation')
      const fileName = safeFileName(input.file_name)
      const contentType = nonEmptyString(input.mime_type, 'mime_type')
      const mediaType = mediaTypeForContentType(contentType)
      const totalSize = input.bytes
      if (
        !Number.isSafeInteger(totalSize)
        || (totalSize as number) <= 0
        || (totalSize as number) > MEDIA_POLICIES[mediaType].maxBytes
      ) {
        throw new WbServiceInputError('bytes exceeds the media upload limit')
      }
      if (input.extension !== undefined && (
        typeof input.extension !== 'string'
        || !/^[A-Za-z0-9]{1,10}$/.test(input.extension)
      )) {
        throw new WbServiceInputError('extension is invalid')
      }
      if (input.client_resource_id !== undefined && (
        typeof input.client_resource_id !== 'string'
        || !input.client_resource_id
      )) {
        throw new WbServiceInputError('client_resource_id is invalid')
      }
      if (input.replace_existing !== undefined && typeof input.replace_existing !== 'boolean') {
        throw new WbServiceInputError('replace_existing is invalid')
      }
      if (input.replace_existing === true && input.client_resource_id === undefined) {
        throw new WbServiceInputError('replace_existing requires client_resource_id')
      }
      if (input.client_resource_id !== undefined && input.replace_existing !== true) {
        throw new WbServiceInputError('client_resource_id requires replace_existing')
      }
      const chunkCount = Math.ceil((totalSize as number) / UPLOAD_CHUNK_BYTES)
      if (chunkCount <= 0 || chunkCount > MAX_UPLOAD_CHUNKS) {
        throw new WbServiceInputError('bytes requires too many upload chunks')
      }
      return withUploadAllocationLock(context, async () => {
        await cleanupExpiredUploads(context)
        const usage = await activeUploadUsage(context)
        if (
          usage.count >= MAX_ACTIVE_UPLOADS
          || usage.bytes + (totalSize as number) > MAX_ACTIVE_UPLOAD_BYTES
        ) {
          throw new WbServiceInputError('Too many active uploads for this game')
        }
        for (let slot = 0; slot < MAX_ACTIVE_UPLOADS; slot += 1) {
          const prepared = await withUploadSlotLock(context, slot, async () => {
            const occupant = await readUploadSlot(context, slot)
            if (
              occupant
              && occupant.status !== 'finalized'
              && occupant.status !== 'expired'
            ) {
              return null
            }
            return withBrowserIndexLock(context, async () => {
              const records = await readBrowserMedia(context)
              if (input.replace_existing === true) {
                const existing = records.find((item) =>
                  item.resource_id === input.client_resource_id && !item.deleted)
                if (!existing || existing.media_type !== mediaType) {
                  throw new WbServiceInputError('Replacement resource was not found')
                }
              }
              let id: string
              do {
                id = uniqueUploadId(records)
              } while (uploadSlot(id) !== slot)
              const now = Date.now()
              const expiresAt = now + 60 * 60 * 1000
              const session: UploadSession = {
                version: 1,
                id,
                fileName,
                mediaType,
                contentType,
                totalSize: totalSize as number,
                chunkSize: UPLOAD_CHUNK_BYTES,
                chunkCount,
                createdAt: now,
                expiresAt,
                ...(input.client_resource_id === undefined ? {} : {
                  clientResourceId: input.client_resource_id as string,
                  replaceExisting: true,
                }),
                nextIndex: 0,
                status: 'open',
              }
              await writeUploadSession(context, session)
              return {
                upload: {
                  method: 'PUT',
                  url: `media/uploads/${id}`,
                  headers: { 'content-type': contentType },
                  expires_at: new Date(expiresAt).toISOString(),
                  chunk_size: UPLOAD_CHUNK_BYTES,
                  chunk_count: chunkCount,
                },
                object_url: `workbench-upload:${id}`,
                upload_token: id,
              }
            })
          })
          if (prepared) return prepared
        }
        throw new WbServiceInputError('Too many active uploads for this game')
      })
    },

    async putChunk(
      id: string,
      chunkIndex: number,
      chunkCount: number,
      contentType: string | undefined,
      body: Uint8Array,
    ): Promise<'written' | 'duplicate' | 'missing'> {
      return withUploadSlotLock(context, uploadSlot(id), async () => {
        const session = await readUploadSession(context, id)
        if (!session) return 'missing'
        await requireActiveUploadSession(context, session)
        if (session.status !== 'open') throw new UploadConflictError('Upload session is finalized')
        if (chunkCount !== session.chunkCount) {
          throw new WbServiceInputError('chunk_count does not match the upload session')
        }
        if (chunkIndex >= session.chunkCount) {
          throw new WbServiceInputError('chunk_index exceeds the upload session')
        }
        if (contentType !== session.contentType) {
          throw new WbServiceInputError('Chunk content type does not match the upload session')
        }
        const expectedSize = chunkIndex === session.chunkCount - 1
          ? session.totalSize - session.chunkSize * chunkIndex
          : session.chunkSize
        if (body.byteLength !== expectedSize || body.byteLength >= 1024 * 1024) {
          throw new WbServiceInputError('Chunk size does not match the upload session')
        }
        if (chunkIndex < session.nextIndex) {
          const existing = await context.files.read(uploadChunkPath(id, chunkIndex))
          if (existing && bytesEqual(existing, body)) return 'duplicate'
          throw new UploadConflictError('Upload chunk conflicts with persisted bytes')
        }
        if (chunkIndex > session.nextIndex) {
          throw new WbServiceInputError('Upload chunks must be sent in order')
        }
        await context.files.write(uploadChunkPath(id, chunkIndex), body)
        session.nextIndex += 1
        await writeUploadSession(context, session)
        return 'written'
      })
    },

    async create(value: unknown) {
      return finalizeBrowserUpload(context, kinoCreateInput(value))
    },

    async batch(value: unknown) {
      const input = exactObject(value, ['resources'], 'resource batch')
      if (!Array.isArray(input.resources) || input.resources.length === 0 || input.resources.length > 100) {
        throw new WbServiceInputError('resources must contain between 1 and 100 items')
      }
      const items = []
      let skippedCount = 0
      const seenUploads = new Set<string>()
      for (const value of input.resources) {
        const resourceInput = kinoCreateInput({
          ...exactObject(value, [
            'media_type', 'url', 'name', 'type', 'remark', 'source', 'source_meta',
          ], 'batch resource'),
        })
        if (seenUploads.has(resourceInput.url)) {
          skippedCount += 1
          continue
        }
        seenUploads.add(resourceInput.url)
        items.push(await finalizeBrowserUpload(context, resourceInput))
      }
      return { created_count: items.length, skipped_count: skippedCount, items }
    },

    async directUpload(
      name: string,
      type: BrowserMediaType,
      contentType: string,
      body: Uint8Array,
      idempotencyKey?: string,
    ) {
      const fileName = safeFileName(name)
      if (
        !idempotencyKey
        || idempotencyKey.length > 200
        || /[\u0000-\u001f\u007f]/.test(idempotencyKey)
      ) {
        throw new WbServiceInputError('A valid x-workbench-idempotency-key is required')
      }
      if (
        !MEDIA_POLICIES[type].mimeTypes.includes(contentType)
        || body.byteLength <= 0
        || body.byteLength > MEDIA_POLICIES[type].maxBytes
      ) {
        throw new WbServiceInputError('Media upload does not match its declared type')
      }
      return withBrowserIndexLock(context, async () => {
        const records = await readBrowserMedia(context)
        const durableKey = framedSha256(['caller-key', idempotencyKey])
        const uploadId = durableKey.slice(0, 32)
        if (records.some((record) =>
          record.deleted && record.upload_id === uploadId)) {
          throw new WbServiceInputError(
            'x-workbench-idempotency-key belongs to a deleted resource',
          )
        }
        const resourceId = uniqueResourceId(records)
        const hosted = await context.media.put(context.gameId, {
          filename: hostFilename(uploadId),
          contentType,
          bytes: body,
          idempotencyKey: `wb-game-video:browser-direct:${durableKey}`,
          metadata: {
            source: 'wb-game-video-browser',
            uploadId,
            originalName: fileName,
            mediaType: type,
          },
        })
        const committed = records.find((item) =>
          !item.deleted && item.upload_id === uploadId)
        if (committed) {
          if (hostMediaId(committed) !== hosted.id) {
            throw new Error('Direct upload receipt conflicts with browser media index')
          }
          return resource(committed, hosted.url)
        }
        const now = Date.now()
        const record: BrowserMediaRecord = {
          resource_id: resourceId,
          host_id: hosted.id,
          upload_id: uploadId,
          media_type: type,
          name: fileName,
          created_at: now,
          updated_at: now,
          deleted: false,
        }
        if (records.some((item) =>
          item.resource_id === record.resource_id
          || (
            !item.deleted
            && (
              hostMediaId(item) === record.resource_id
              || item.resource_id === hosted.id
              || hostMediaId(item) === hosted.id
            )
          )
        )) {
          throw new Error('Host media id already exists in the browser media index')
        }
        await writeBrowserMedia(context, [...records, record])
        return resource(record, hosted.url)
      })
    },

    async get(id: string) {
      const record = (await readBrowserMedia(context))
        .find((item) => item.resource_id === id && !item.deleted)
      if (!record) return null
      const locator = (await browserMediaLocators(context)).get(hostMediaId(record))
      return locator ? resource(record, locator) : null
    },

    async update(id: string, value: unknown) {
      return withBrowserIndexLock(context, async () => {
        const records = await readBrowserMedia(context)
        const index = records.findIndex((item) => item.resource_id === id)
        const record = index < 0 ? undefined : records[index]
        if (!record || record.deleted) return null
        const input = exactObject(value, [
          'resource_id', 'media_type', 'url', 'name',
          'type', 'remark', 'source', 'source_meta',
        ], 'resource update')
        if (typeof input.name !== 'string') {
          throw new WbServiceInputError('Media rename requires name')
        }
        if (input.resource_id !== undefined && input.resource_id !== record.resource_id) {
          throw new WbServiceInputError('resource_id does not match the route')
        }
        if (input.media_type !== undefined && input.media_type !== record.media_type) {
          throw new WbServiceInputError('media_type cannot be changed')
        }
        if (input.source_meta !== undefined && (
          !input.source_meta
          || typeof input.source_meta !== 'object'
          || Array.isArray(input.source_meta)
        )) {
          throw new WbServiceInputError('source_meta must be an object')
        }
        for (const key of ['type', 'remark', 'source'] as const) {
          if (input[key] !== undefined && typeof input[key] !== 'string') {
            throw new WbServiceInputError(`${key} must be a string`)
          }
        }
        record.name = input.name
        if (input.type !== undefined) record.type = input.type as string
        if (input.remark !== undefined) record.remark = input.remark as string
        if (input.source !== undefined) record.source = input.source as string
        if (input.source_meta !== undefined) {
          record.source_meta = input.source_meta as Record<string, unknown>
        }
        record.updated_at = Date.now()
        records[index] = record
        await writeBrowserMedia(context, records)
        const locator = (await browserMediaLocators(context)).get(hostMediaId(record))
        return locator ? resource(record, locator) : null
      })
    },

    async remove(id: string) {
      return withBrowserIndexLock(context, async () => {
        const records = await readBrowserMedia(context)
        const index = records.findIndex((item) => item.resource_id === id)
        const record = index < 0 ? undefined : records[index]
        if (!record) return false
        if (!record.deleted) {
          record.deleted = true
          appendReclaims(record, [hostMediaId(record)])
          records[index] = record
          await writeBrowserMedia(context, records)
        }
        await reclaimPendingMedia(context, records, record)
        return true
      })
    },

    async content(id: string): Promise<MediaBody | null> {
      const record = (await readBrowserMedia(context))
        .find((item) => item.resource_id === id && !item.deleted)
      if (!record) return null
      return context.media.read(context.gameId, hostMediaId(record))
    },
  }
}
