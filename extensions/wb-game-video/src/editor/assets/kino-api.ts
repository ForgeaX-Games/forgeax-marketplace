/**
 * Browser-safe Kino video resource API client.
 * Standalone DTOs — must not import server/private packages.
 */

export interface KinoEnvelope<T> {
  code: number
  message: string
  data: T
  error_code?: string
}

export type KinoMediaType = 'image' | 'video'

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
  game_id: string
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
}

export interface DirectUploadResponse {
  upload: DirectUploadInstruction
  object_url: string
  upload_token: string
}

export interface PrepareUploadInput {
  game_id: string
  file_name?: string
  mime_type: 'video/mp4' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  extension?: string
  client_resource_id?: string
  replace_existing?: boolean
}

export interface CreateKinoResourceInput {
  game_id: string
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
  game_id: string
  media_type: KinoMediaType
  url: string
  name?: string
  type?: KinoResourceType
  remark?: string
  source?: string
  source_meta?: KinoResourceSourceMeta
}

export interface BatchCreateKinoResourcesInput {
  game_id: string
  resources: Array<Omit<CreateKinoResourceInput, 'game_id'>>
}

export interface BatchCreateKinoResourcesResult {
  created_count: number
  skipped_count: number
  items: KinoResourceDTO[]
}

export interface ListKinoResourcesQuery {
  game_id: string
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
  get(resourceId: string, gameId: string, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  create(input: CreateKinoResourceInput, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  batch(input: BatchCreateKinoResourcesInput, options?: KinoRequestOptions): Promise<BatchCreateKinoResourcesResult>
  update(resourceId: string, input: UpdateKinoResourceInput, options?: KinoRequestOptions): Promise<KinoResourceDTO>
  delete(resourceId: string, gameId: string, options?: KinoRequestOptions): Promise<void>
  playbackUrl(resourceId: string, gameId: string): string
}

export interface CreateKinoVideoClientOptions {
  fetch?: typeof fetch
  baseUrl?: string
}

const DEFAULT_BASE_URL = '/api/v1/kino'
const MAX_ERROR_MESSAGE_LENGTH = 512

/** Kino `/resources` 服务端分页协议的单页上限。 */
export const MAX_KINO_RESOURCE_PAGE_SIZE = 100

function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? DEFAULT_BASE_URL).trim()
  if (trimmed.length === 0) {
    return DEFAULT_BASE_URL
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
  const text = await response.text()
  if (!text.trim()) {
    throw new KinoClientError('Upstream returned an empty response', 502, 'upstream_unavailable')
  }
  try {
    return JSON.parse(text) as unknown
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

function resourcePath(resourceId: string, gameId: string, suffix = ''): string {
  return appendQuery(
    `/resources/${encodeURIComponent(resourceId)}${suffix}`,
    { game_id: gameId },
  )
}

export function createKinoVideoClient(
  options: CreateKinoVideoClientOptions = {},
): KinoVideoClient {
  const fetchImpl = options.fetch ?? fetch.bind(globalThis)
  const baseUrl = normalizeBaseUrl(options.baseUrl)

  return {
    async prepareUpload(input, options) {
      return requestJson<DirectUploadResponse>(fetchImpl, baseUrl, '/image-assets/upload', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options?.signal,
      })
    },

    async list(query, options) {
      return requestJson<KinoResourcePage>(
        fetchImpl,
        baseUrl,
        appendQuery('/resources', {
          game_id: query.game_id,
          media_type: query.media_type ?? 'video',
          page: query.page,
          page_size: query.page_size,
          type: query.type,
        }),
        { signal: options?.signal },
      )
    },

    async get(resourceId, gameId, options) {
      return requestJson<KinoResourceDTO>(
        fetchImpl,
        baseUrl,
        resourcePath(resourceId, gameId),
        { signal: options?.signal },
      )
    },

    async create(input, options) {
      return requestJson<KinoResourceDTO>(fetchImpl, baseUrl, '/resources', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options?.signal,
      })
    },

    async batch(input, options) {
      return requestJson<BatchCreateKinoResourcesResult>(fetchImpl, baseUrl, '/resources/batch', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options?.signal,
      })
    },

    async update(resourceId, input, options) {
      return requestJson<KinoResourceDTO>(
        fetchImpl,
        baseUrl,
        resourcePath(resourceId, input.game_id),
        {
          method: 'PUT',
          body: JSON.stringify(input),
          signal: options?.signal,
        },
      )
    },

    async delete(resourceId, gameId, options) {
      await requestJson<null>(fetchImpl, baseUrl, resourcePath(resourceId, gameId), {
        method: 'DELETE',
        signal: options?.signal,
      })
    },

    playbackUrl(resourceId, gameId) {
      return `${baseUrl}${resourcePath(resourceId, gameId, '/content')}`
    },
  }
}
