/**
 * Browser-safe Kino video resource API client.
 * Standalone DTOs — must not import server/private packages.
 */
import { getWorkbenchHost } from '../../lib/workbench-host'

export interface KinoEnvelope<T> {
  code: number
  message: string
  data: T
  error_code?: string
}

export type KinoMediaType = 'image' | 'video' | 'audio' | 'font'

export type KinoResourceType =
  | 'KEYFRAME'
  | 'SHOT_VIDEO'
  | 'CHARACTER_IMAGE'
  | 'CHARACTER_TURNAROUND'
  | 'LOCATION_IMAGE'
  | 'PROJECT_COVER_IMAGE'
  | 'UPLOAD'
  | 'OTHER'
  | 'GENERATION'

export interface KinoResourceSourceMeta {
  task_id?: string
  prompt?: string
  model?: string
  seed?: number
  width?: number
  height?: number
  duration_ms?: number
  mime_type?: string
  extra?: Record<string, unknown>
}

export interface KinoResourceDTO {
  resource_id: string
  media_type: KinoMediaType
  name?: string
  type?: KinoResourceType
  url: string
  remark?: string
  source?: string
  source_meta?: KinoResourceSourceMeta
  created_at: number
  updated_at: number
}

export interface KinoResourcePage {
  items: KinoResourceDTO[]
  total: number
  page: number
  page_size: number
}

export interface DirectUploadInstruction {
  method: 'PUT'
  url: string
  headers: Record<string, string>
  expires_at: string
  chunk_size?: number
  chunk_count?: number
}

export interface DirectUploadResponse {
  upload: DirectUploadInstruction
  object_url: string
  upload_token: string
}

export interface PrepareUploadInput {
  file_name?: string
  mime_type:
    | 'video/mp4'
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp'
    | 'image/gif'
    | 'audio/mpeg'
    | 'audio/wav'
    | 'audio/ogg'
    | 'audio/mp4'
    | 'audio/aac'
    | 'font/woff2'
    | 'font/woff'
    | 'font/ttf'
    | 'font/otf'
  bytes: number
  extension?: string
  client_resource_id?: string
  replace_existing?: boolean
}

export interface CreateKinoResourceInput {
  media_type: KinoMediaType
  url: string
  name?: string
  type?: KinoResourceType
  remark?: string
  source?: string
  source_meta?: KinoResourceSourceMeta
}

export interface UpdateKinoResourceInput {
  resource_id: string
  media_type: KinoMediaType
  url: string
  name?: string
  type?: KinoResourceType
  remark?: string
  source?: string
  source_meta?: KinoResourceSourceMeta
}

export interface BatchCreateKinoResourcesInput {
  resources: CreateKinoResourceInput[]
}

export interface BatchCreateKinoResourcesResult {
  created_count: number
  skipped_count: number
  items: KinoResourceDTO[]
}

export interface ListKinoResourcesQuery {
  media_type?: KinoMediaType
  page?: number
  page_size?: number
  type?: KinoResourceType
}

export class KinoClientError extends Error {
  readonly status: number
  readonly errorCode?: string

  constructor(message: string, status: number, errorCode?: string) {
    super(message)
    this.name = 'KinoClientError'
    this.status = status
    this.errorCode = errorCode
  }
}

export interface KinoRequestOptions {
  signal?: AbortSignal
}

export interface KinoVideoClient {
  prepareUpload(input: PrepareUploadInput, options?: KinoRequestOptions): Promise<DirectUploadResponse>
  list(query: ListKinoResourcesQuery, options?: KinoRequestOptions): Promise<KinoResourcePage>
  get(resourceId: string, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  create(input: CreateKinoResourceInput, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  batch(input: BatchCreateKinoResourcesInput, options?: KinoRequestOptions): Promise<BatchCreateKinoResourcesResult>
  update(resourceId: string, input: UpdateKinoResourceInput, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  delete(resourceId: string, options?: KinoRequestOptions): Promise<void>
  playbackUrl(resourceId: string): string
}

/** Legacy provider DTOs are isolated from the handshake-bound Workbench client. */
export interface ExternalKinoResourceDTO extends KinoResourceDTO {
  game_id: string
}

export interface ExternalKinoVideoClient {
  prepareUpload(input: PrepareUploadInput & { game_id: string }, options?: KinoRequestOptions): Promise<DirectUploadResponse>
  list(query: ListKinoResourcesQuery & { game_id: string }, options?: KinoRequestOptions): Promise<{
    items: ExternalKinoResourceDTO[]
    total: number
    page: number
    page_size: number
  }>
  get(resourceId: string, gameId: string, options?: KinoRequestOptions): Promise<ExternalKinoResourceDTO>
  create(input: CreateKinoResourceInput & { game_id: string }, options?: KinoRequestOptions): Promise<ExternalKinoResourceDTO>
  batch(
    input: BatchCreateKinoResourcesInput & { game_id: string },
    options?: KinoRequestOptions,
  ): Promise<BatchCreateKinoResourcesResult>
  update(
    resourceId: string,
    input: UpdateKinoResourceInput & { game_id: string },
    options?: KinoRequestOptions,
  ): Promise<ExternalKinoResourceDTO>
  delete(resourceId: string, gameId: string, options?: KinoRequestOptions): Promise<void>
  playbackUrl(resourceId: string, gameId: string): string
}

export interface CreateKinoVideoClientOptions {
  fetch?: typeof fetch
  baseUrl?: string
  url?: (path: string) => string
}

const MAX_ERROR_MESSAGE_LENGTH = 512

/** Kino `/resources` 服务端分页协议的单页上限。 */
export const MAX_KINO_RESOURCE_PAGE_SIZE = 100

function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? 'media').trim()
  if (trimmed.length === 0) {
    return 'media'
  }
  return trimmed.replace(/\/+$/, '')
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message
  }
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function appendQuery(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  const query = parts.join('&')
  return query.length > 0 ? `${path}?${query}` : path
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw new KinoClientError('Upstream returned a non-JSON response', 502, 'upstream_unavailable')
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new KinoClientError('Upstream returned malformed JSON', 502, 'upstream_unavailable')
  }
}

function resolveBusinessStatus(envelope: Partial<KinoEnvelope<unknown>>): number {
  if (typeof envelope.code === 'number' && envelope.code >= 400 && envelope.code < 600) {
    return envelope.code
  }
  return 502
}

function parseEnvelope<T>(response: Response, payload: unknown): T {
  if (response.status === 401) {
    const envelope = payload as Partial<KinoEnvelope<T>>
    throw new KinoClientError(
      truncateMessage(
        typeof envelope.message === 'string' && envelope.message.length > 0
          ? envelope.message
          : 'Unauthorized',
      ),
      401,
      typeof envelope.error_code === 'string' ? envelope.error_code : 'unauthorized',
    )
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new KinoClientError('Upstream returned malformed JSON', 502, 'upstream_unavailable')
  }

  const envelope = payload as KinoEnvelope<T>
  if (typeof envelope.code !== 'number') {
    throw new KinoClientError('Upstream returned malformed JSON', 502, 'upstream_unavailable')
  }

  if (!response.ok || envelope.code !== 0) {
    throw new KinoClientError(
      truncateMessage(
        typeof envelope.message === 'string' && envelope.message.length > 0
          ? envelope.message
          : response.ok
            ? 'Upstream business error'
            : `Upstream HTTP ${response.status}`,
      ),
      response.ok ? resolveBusinessStatus(envelope) : response.status >= 400 && response.status < 600
        ? response.status
        : resolveBusinessStatus(envelope),
      typeof envelope.error_code === 'string' ? envelope.error_code : 'upstream_unavailable',
    )
  }

  return envelope.data
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  options?: Pick<RequestInit, 'method' | 'body' | 'signal'>,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch {
    throw new KinoClientError('Network request failed', 502, 'network_error')
  }

  const payload = await readJsonPayload(response)
  return parseEnvelope<T>(response, payload)
}

async function requestNoContent(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  options?: Pick<RequestInit, 'method' | 'signal'>,
): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    throw new KinoClientError('Network request failed', 502, 'network_error')
  }
  if (response.status === 204) return
  const payload = await readJsonPayload(response)
  parseEnvelope<unknown>(response, payload)
}

function resolveUploadInstruction(
  response: DirectUploadResponse,
  resolveUrl: (path: string) => string,
): DirectUploadResponse {
  if (/^https?:\/\//i.test(response.upload.url)) return response
  return {
    ...response,
    upload: {
      ...response.upload,
      url: resolveUrl(response.upload.url),
    },
  }
}

function resourcePath(resourceId: string, suffix = ''): string {
  return `/resources/${encodeURIComponent(resourceId)}${suffix}`
}

function playbackUrl(
  resourceId: string,
  resolveUrl: (path: string) => string,
): string {
  return resolveUrl(`/media/resources/${encodeURIComponent(resourceId)}/content`)
}

function withoutLegacyGameId<T extends object>(value: T): Omit<T, 'game_id'> {
  const { game_id: _legacyGameId, ...bound } = value as T & { game_id?: unknown }
  return bound
}

export function createKinoVideoClient(
  options: CreateKinoVideoClientOptions = {},
): KinoVideoClient {
  const fetchImpl = options.fetch ?? ((input, init) => getWorkbenchHost().extension.fetch(String(input), init))
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const resolveUrl = options.url
    ?? (options.fetch
      ? (path: string) => new URL(path, 'https://workbench-client.invalid').toString()
      : (path: string) => getWorkbenchHost().extension.url(path))

  return {
    async prepareUpload(input, options) {
      const response = await requestJson<DirectUploadResponse>(fetchImpl, baseUrl, '/image-assets/upload', {
        method: 'POST',
        body: JSON.stringify(withoutLegacyGameId(input)),
        signal: options?.signal,
      })
      return resolveUploadInstruction(response, resolveUrl)
    },

    async list(query, options) {
      return requestJson<KinoResourcePage>(
        fetchImpl,
        baseUrl,
        appendQuery('/resources', {
          media_type: query.media_type ?? 'video',
          page: query.page,
          page_size: query.page_size,
          type: query.type,
        }),
        { signal: options?.signal },
      )
    },

    async get(resourceId, options) {
      return requestJson<KinoResourceDTO>(
        fetchImpl,
        baseUrl,
        resourcePath(resourceId),
        { signal: options?.signal },
      )
    },

    async create(input, options) {
      return requestJson<KinoResourceDTO>(fetchImpl, baseUrl, '/resources', {
        method: 'POST',
        body: JSON.stringify(withoutLegacyGameId(input)),
        signal: options?.signal,
      })
    },

    async batch(input, options) {
      return requestJson<BatchCreateKinoResourcesResult>(fetchImpl, baseUrl, '/resources/batch', {
        method: 'POST',
        body: JSON.stringify({
          ...withoutLegacyGameId(input),
          resources: input.resources.map(withoutLegacyGameId),
        }),
        signal: options?.signal,
      })
    },

    async update(resourceId, input, options) {
      return requestJson<KinoResourceDTO>(
        fetchImpl,
        baseUrl,
        resourcePath(resourceId),
        {
          method: 'PUT',
          body: JSON.stringify(withoutLegacyGameId(input)),
          signal: options?.signal,
        },
      )
    },

    async delete(resourceId, options) {
      await requestNoContent(fetchImpl, baseUrl, resourcePath(resourceId), {
        method: 'DELETE',
        signal: options?.signal,
      })
    },

    playbackUrl(resourceId) {
      return playbackUrl(resourceId, resolveUrl)
    },
  }
}
