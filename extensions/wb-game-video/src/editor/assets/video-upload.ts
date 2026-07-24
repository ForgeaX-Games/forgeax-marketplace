import type {
  CreateKinoResourceInput,
  DirectUploadInstruction,
  DirectUploadResponse,
  KinoResourceDTO,
  KinoVideoClient,
} from './kino-api'
import { KinoClientError } from './kino-api'

export const MAX_VIDEO_UPLOAD_BYTES = 104_857_600
export const VIDEO_UPLOAD_MIME = 'video/mp4' as const

const FORBIDDEN_UPLOAD_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'cookie',
  'cookie2',
  'authorization',
  'proxy-authorization',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'content-length',
  'origin',
  'permissions-policy',
  'referer',
  'transfer-encoding',
  'connection',
  'te',
  'trailer',
  'upgrade',
  'via',
])
const MAX_UPLOAD_ERROR_BODY_LENGTH = 512
const DEFAULT_VIDEO_UPLOAD_DEV_PROXY_PORT = '15185'
const VIDEO_UPLOAD_PROXY_PATH = '/__video-upload-proxy'
const inFlightUploads = new Set<string>()

export interface UploadTransportLocation {
  origin: string
}

function devProxyPortFromOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin)
    if (parsed.port) {
      return parsed.port
    }
    return parsed.protocol === 'https:' ? '443' : '80'
  } catch {
    return null
  }
}

function configuredDevProxyPort(): string {
  return import.meta.env.VITE_DEV_PORT || DEFAULT_VIDEO_UPLOAD_DEV_PROXY_PORT
}

function isCrossOriginHttpUrl(instructionUrl: string, origin: string): boolean {
  try {
    const target = new URL(instructionUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return false
    }
    return target.origin !== origin
  } catch {
    return false
  }
}

function localEaPortFromUrl(url: URL): string {
  if (url.port) {
    return url.port
  }
  return url.protocol === 'https:' ? '443' : '80'
}

/** Keep direct uploads to the local ForgeaX API dev server on the vite proxy path. */
function isLocalEaUploadUrl(instructionUrl: string): boolean {
  try {
    const target = new URL(instructionUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return false
    }
    const host = target.hostname.toLowerCase()
    const port = localEaPortFromUrl(target)
    return (host === '127.0.0.1' || host === 'localhost') && port === '18900'
  } catch {
    return false
  }
}

/** Rewrite cross-origin signed upload URLs through the active Vite dev server. */
export function resolveUploadTransportUrl(
  instructionUrl: string,
  location: UploadTransportLocation = globalThis.location,
): string {
  const origin = location.origin
  if (
    !import.meta.env.DEV
    || devProxyPortFromOrigin(origin) !== configuredDevProxyPort()
  ) {
    return instructionUrl
  }
  if (isLocalEaUploadUrl(instructionUrl)) {
    return instructionUrl
  }
  if (!isCrossOriginHttpUrl(instructionUrl, origin)) {
    return instructionUrl
  }
  const proxyUrl = new URL(VIDEO_UPLOAD_PROXY_PATH, origin)
  proxyUrl.searchParams.set('url', instructionUrl)
  return proxyUrl.toString()
}

export interface UploadTransport {
  put(
    file: File,
    instruction: DirectUploadInstruction,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<void>
}

export interface VideoFileIdentity {
  name: string
  size: number
  type: string
  lastModified: number
}

export interface PreparedVideoCreateInput {
  name: string
  durationMs?: number
  type?: CreateKinoResourceInput['type']
  remark?: string
  source?: string
  source_meta?: CreateKinoResourceInput['source_meta']
}

export interface PreparedVideoUpload {
  gameId: string
  replacementResourceId?: string
  fileIdentity: VideoFileIdentity
  response: DirectUploadResponse
  objectUrl: string
  uploadToken: string
  uploaded: boolean
  createInput: PreparedVideoCreateInput
}

export type VideoUploadErrorCode =
  | 'invalid_file_name'
  | 'invalid_media_type'
  | 'invalid_upload_size'
  | 'invalid_upload_instruction'
  | 'unsafe_upload_headers'
  | 'upload_in_progress'
  | 'upload_failed'
  | 'upload_aborted'
  | 'upload_network_error'
  | 'complete_failed'
  | 'invalid_upload_state'

export class VideoUploadError extends Error {
  readonly code: VideoUploadErrorCode
  readonly retryState?: PreparedVideoUpload

  constructor(
    message: string,
    code: VideoUploadErrorCode,
    retryState?: PreparedVideoUpload,
  ) {
    super(truncateMessage(message))
    this.name = 'VideoUploadError'
    this.code = code
    this.retryState = retryState
  }
}

export interface UploadVideoResourceOptions {
  client: KinoVideoClient
  transport?: UploadTransport
  gameId: string
  file: File
  durationMs?: number
  type?: CreateKinoResourceInput['type']
  remark?: string
  source?: string
  source_meta?: CreateKinoResourceInput['source_meta']
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export interface ReplaceVideoResourceOptions extends UploadVideoResourceOptions {
  resourceId: string
}

export interface CompletePreparedVideoUploadOptions {
  client: KinoVideoClient
  prepared: PreparedVideoUpload
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(100, Math.max(0, value))
}

function createProgressReporter(onProgress?: (percent: number) => void) {
  let last = 0
  return (value: number, forceFinal = false) => {
    const next = forceFinal ? 100 : clampProgress(value)
    const monotonic = Math.max(last, next)
    last = monotonic
    onProgress?.(monotonic)
    return monotonic
  }
}

function assertMp4File(file: File): void {
  const name = file.name.trim()
  if (name.length === 0 || !name.toLowerCase().endsWith('.mp4')) {
    throw new VideoUploadError('Invalid upload file name', 'invalid_file_name')
  }
  if (file.type !== VIDEO_UPLOAD_MIME) {
    throw new VideoUploadError('Invalid upload mime type', 'invalid_media_type')
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new VideoUploadError('Invalid upload size', 'invalid_upload_size')
  }
}

function fileIdentity(file: File): VideoFileIdentity {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  }
}

function uploadKey(gameId: string, file: File, resourceId?: string): string {
  if (resourceId) {
    return JSON.stringify([gameId, 'replace', resourceId])
  }
  const identity = fileIdentity(file)
  return JSON.stringify([
    gameId,
    resourceId,
    identity.name,
    identity.size,
    identity.type,
    identity.lastModified,
  ])
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new VideoUploadError('Upload aborted', 'upload_aborted')
  }
}

function sanitizeInstructionHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const key of Object.keys(headers)) {
    if (!Object.prototype.hasOwnProperty.call(headers, key)) {
      continue
    }
    const normalized = key.trim().toLowerCase()
    const value = headers[key]
    if (
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key) ||
      FORBIDDEN_UPLOAD_HEADERS.has(normalized) ||
      normalized.startsWith('proxy-') ||
      normalized.startsWith('sec-') ||
      typeof value !== 'string' ||
      /[\r\n\0]/.test(value)
    ) {
      throw new VideoUploadError('Unsafe upload instruction headers', 'unsafe_upload_headers')
    }
    safe[key] = value
  }
  return safe
}

function truncateMessage(text: string): string {
  if (text.length <= MAX_UPLOAD_ERROR_BODY_LENGTH) {
    return text
  }
  return text.slice(0, MAX_UPLOAD_ERROR_BODY_LENGTH)
}

function validateUploadInstruction(
  instruction: DirectUploadInstruction,
): Record<string, string> {
  if ((instruction as { method?: unknown }).method !== 'PUT') {
    throw new VideoUploadError('Invalid upload instruction', 'invalid_upload_instruction')
  }
  let url: URL
  try {
    url = new URL(instruction.url)
  } catch {
    throw new VideoUploadError('Invalid upload instruction', 'invalid_upload_instruction')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new VideoUploadError('Invalid upload instruction', 'invalid_upload_instruction')
  }
  if (
    !instruction.headers ||
    typeof instruction.headers !== 'object' ||
    Array.isArray(instruction.headers)
  ) {
    throw new VideoUploadError('Invalid upload instruction', 'invalid_upload_instruction')
  }
  return sanitizeInstructionHeaders(instruction.headers)
}

export function createDefaultXhrUploadTransport(): UploadTransport {
  return {
    async put(file, instruction, onProgress, signal) {
      const headers = validateUploadInstruction(instruction)
      assertNotAborted(signal)
      const report = createProgressReporter(onProgress)

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        let settled = false
        const cleanup = () => {
          signal?.removeEventListener('abort', handleSignalAbort)
        }
        const succeed = () => {
          if (settled) return
          settled = true
          cleanup()
          resolve()
        }
        const fail = (error: VideoUploadError) => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        }
        const handleSignalAbort = () => {
          try {
            xhr.abort()
          } finally {
            fail(new VideoUploadError('Upload aborted', 'upload_aborted'))
          }
        }

        signal?.addEventListener('abort', handleSignalAbort, { once: true })
        if (signal?.aborted) {
          handleSignalAbort()
          return
        }

        xhr.upload.onprogress = (event) => {
          const total = event.lengthComputable && event.total > 0 ? event.total : file.size
          if (total <= 0) {
            return
          }
          report((event.loaded / total) * 99)
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            succeed()
            return
          }
          fail(
            new VideoUploadError(
              xhr.responseText || `Upload failed with HTTP ${xhr.status}`,
              'upload_failed',
            ),
          )
        }

        xhr.onerror = () => {
          fail(new VideoUploadError('Upload network error', 'upload_network_error'))
        }

        xhr.onabort = () => {
          fail(new VideoUploadError('Upload aborted', 'upload_aborted'))
        }

        try {
          const transportUrl = resolveUploadTransportUrl(instruction.url)
          xhr.open(instruction.method, transportUrl, true)
          for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value)
          }
          xhr.send(file)
        } catch (error) {
          fail(
            new VideoUploadError(
              error instanceof Error ? error.message : 'Upload failed',
              'upload_failed',
            ),
          )
        }
      })
    },
  }
}

async function prepareVideoUpload(
  client: KinoVideoClient,
  gameId: string,
  file: File,
  createInput: PreparedVideoCreateInput,
  replacementResourceId?: string,
  signal?: AbortSignal,
): Promise<PreparedVideoUpload> {
  const response = await client.prepareUpload({
    game_id: gameId,
    file_name: file.name,
    mime_type: VIDEO_UPLOAD_MIME,
    bytes: file.size,
    ...(replacementResourceId
      ? {
          client_resource_id: replacementResourceId,
          replace_existing: true,
        }
      : {}),
  }, { signal })

  return {
    gameId,
    replacementResourceId,
    fileIdentity: fileIdentity(file),
    response,
    objectUrl: response.object_url,
    uploadToken: response.upload_token,
    uploaded: false,
    createInput,
  }
}

async function transferPreparedVideoUpload(
  prepared: PreparedVideoUpload,
  file: File,
  transport: UploadTransport,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<PreparedVideoUpload> {
  assertNotAborted(signal)
  await transport.put(file, prepared.response.upload, onProgress, signal)
  return { ...prepared, uploaded: true }
}

function buildCreatePayload(prepared: PreparedVideoUpload): CreateKinoResourceInput {
  return {
    game_id: prepared.gameId,
    media_type: 'video',
    url: prepared.objectUrl,
    name: prepared.createInput.name,
    type: prepared.createInput.type ?? 'UPLOAD',
    remark: prepared.createInput.remark,
    source: prepared.createInput.source ?? 'upload',
    source_meta: {
      ...(prepared.createInput.source_meta ?? {}),
      ...(prepared.createInput.durationMs !== undefined
        ? { duration_ms: prepared.createInput.durationMs }
        : {}),
      mime_type: VIDEO_UPLOAD_MIME,
    },
  }
}

async function completePreparedUpload(
  client: KinoVideoClient,
  prepared: PreparedVideoUpload,
  signal?: AbortSignal,
): Promise<KinoResourceDTO> {
  if (!prepared.uploaded) {
    throw new VideoUploadError('Upload transfer is incomplete', 'invalid_upload_state', prepared)
  }

  try {
    return await client.create(buildCreatePayload(prepared), { signal })
  } catch (error) {
    const message =
      error instanceof KinoClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create video resource'
    throw new VideoUploadError(message, 'complete_failed', prepared)
  }
}

export async function completePreparedVideoUpload(
  options: CompletePreparedVideoUploadOptions,
): Promise<KinoResourceDTO> {
  assertNotAborted(options.signal)
  const report = createProgressReporter(options.onProgress)
  const resource = await completePreparedUpload(options.client, options.prepared, options.signal)
  report(100, true)
  return resource
}

async function runVideoResourceUpload(
  options: UploadVideoResourceOptions,
  replacementResourceId?: string,
): Promise<KinoResourceDTO> {
  const transport = options.transport ?? createDefaultXhrUploadTransport()
  const report = createProgressReporter(options.onProgress)

  const createInput: PreparedVideoCreateInput = {
    name: options.file.name,
    durationMs: options.durationMs,
    type: options.type,
    remark: options.remark,
    source: options.source,
    source_meta: options.source_meta,
  }

  const prepared = await prepareVideoUpload(
    options.client,
    options.gameId,
    options.file,
    createInput,
    replacementResourceId,
    options.signal,
  )
  report(0)

  let uploaded: PreparedVideoUpload
  try {
    uploaded = await transferPreparedVideoUpload(
      prepared,
      options.file,
      transport,
      (value) => report(Math.min(value, 99)),
      options.signal,
    )
  } catch (error) {
    if (error instanceof VideoUploadError) {
      throw error
    }
    throw new VideoUploadError(
      error instanceof Error ? error.message : 'Upload failed',
      'upload_failed',
      prepared,
    )
  }

  try {
    assertNotAborted(options.signal)
    const resource = await completePreparedUpload(options.client, uploaded, options.signal)
    report(100, true)
    return resource
  } catch (error) {
    if (error instanceof VideoUploadError) {
      throw error
    }
    throw new VideoUploadError(
      error instanceof Error ? error.message : 'Failed to create video resource',
      'complete_failed',
      uploaded,
    )
  }
}

async function runLockedVideoResourceUpload(
  options: UploadVideoResourceOptions,
  replacementResourceId?: string,
): Promise<KinoResourceDTO> {
  assertMp4File(options.file)
  assertNotAborted(options.signal)
  const key = uploadKey(options.gameId, options.file, replacementResourceId)
  if (inFlightUploads.has(key)) {
    throw new VideoUploadError('Upload already in progress', 'upload_in_progress')
  }
  inFlightUploads.add(key)
  try {
    return await runVideoResourceUpload(options, replacementResourceId)
  } finally {
    inFlightUploads.delete(key)
  }
}

export async function uploadVideoResource(
  options: UploadVideoResourceOptions,
): Promise<KinoResourceDTO> {
  return runLockedVideoResourceUpload(options)
}

export async function replaceVideoResource(
  options: ReplaceVideoResourceOptions,
): Promise<KinoResourceDTO> {
  return runLockedVideoResourceUpload(options, options.resourceId)
}
