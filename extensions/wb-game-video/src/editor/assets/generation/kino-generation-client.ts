/**
 * Same-origin Kino video generation transport.
 *
 * 生成任务直接请求产品同源 Kino API `/api/v1/kino/generations`。浏览器沿用
 * 产品登录态，长期登录 key 不进浏览器；需要换 transport 的宿主在 mount 时
 * 注入 rewrite 规则，不在共享扩展里猜 hostname、端口或环境。
 *
 * 为什么不走 Workbench Host tool：Host 链路把成片字节搬进宿主 media
 * projection，浏览器只拿到 Host 投影地址；同源代理回传 Kino 的 `result_url`，
 * `<video>` 可以直接播放。
 */

import { getActiveRewriteRules, rewriteUrlWithRules } from '../../../lib/forgeax-http'
import { KinoClientError, requestKinoEnvelope, type KinoRequestOptions } from '../kino-api'
import type {
  KinoVideoResolution,
  KinoVideoSize,
  VideoGenerationStatus,
  VideoGenerationTask,
} from './generation-api'

export const KINO_GENERATIONS_ROUTE = '/api/v1/kino/generations'

const GENERATION_STATUSES = new Set<string>([
  'pending',
  'submitting',
  'polling',
  'succeeded',
  'failed',
  'cancelled',
])

/** 任务仍在推进（需要继续轮询）的状态。 */
const ACTIVE_STATUSES = new Set<VideoGenerationStatus>([
  'pending',
  'submitting',
  'polling',
])

export interface CreateKinoGenerationInput {
  /** 当前 Workbench handshake 提供的 gameId。 */
  gameSlug: string
  prompt: string
  durationSeconds: number
  generateAudio: boolean
  size?: KinoVideoSize
  resolution?: KinoVideoResolution
  model?: string
  visualStyleKey?: string
  /** Kino resource id（非宿主 registry asset id）。 */
  firstFrameResourceId?: string
  lastFrameResourceId?: string
  referenceImageResourceIds?: string[]
}

export function isActiveGenerationStatus(status: VideoGenerationStatus): boolean {
  return ACTIVE_STATUSES.has(status)
}

/**
 * 同源请求：先套用宿主注入的 rewrite 规则，再用全局 fetch。
 * 不能用 `pluginFetch` —— 它把路径当 extension-relative 交给 Host router。
 */
function sameOriginFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(rewriteUrlWithRules(input, getActiveRewriteRules()), init)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidTask(): KinoClientError {
  return new KinoClientError(
    'Kino generation service returned an invalid task',
    502,
    'upstream_unavailable',
  )
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseGenerationTask(value: unknown): VideoGenerationTask {
  if (!isRecord(value)) throw invalidTask()
  const generationId = optionalString(value.generation_id)
  const status = value.status
  if (!generationId) throw invalidTask()
  if (typeof status !== 'string' || !GENERATION_STATUSES.has(status)) throw invalidTask()

  const createdAt = value.created_at
  const prompt = optionalString(value.prompt_text)
  const model = optionalString(value.model)
  const providerTaskId = optionalString(value.provider_task_id)
  const errorCode = optionalString(value.error_code)
  const errorMessage = optionalString(value.error_message)
  const resource = value.resource
  const resourceId = isRecord(resource) ? optionalString(resource.resource_id) : undefined
  const resourceUrl = isRecord(resource) ? optionalString(resource.url) : undefined
  const resultUrl = optionalString(value.result_url) ?? resourceUrl

  return {
    generationId,
    status: status as VideoGenerationStatus,
    ...(typeof createdAt === 'number' && Number.isFinite(createdAt) ? { createdAt } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(providerTaskId !== undefined ? { providerTaskId } : {}),
    ...(resultUrl !== undefined ? { resultUrl } : {}),
    ...(resourceId !== undefined ? { resourceId } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  }
}

/** 提交生成任务。视频任务通常回 `polling`，需由调用方继续轮询。 */
export async function createKinoGeneration(
  input: CreateKinoGenerationInput,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask> {
  if (!input.gameSlug.trim()) {
    throw new KinoClientError('Missing gameSlug', 400, 'missing_game_slug')
  }
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: input.prompt },
    ...(input.firstFrameResourceId
      ? [{ type: 'resource', resource_id: input.firstFrameResourceId, frame_position: 'first' }]
      : []),
    ...(input.lastFrameResourceId
      ? [{ type: 'resource', resource_id: input.lastFrameResourceId, frame_position: 'last' }]
      : []),
    ...(input.referenceImageResourceIds ?? []).map((resourceId) => ({
      type: 'resource',
      resource_id: resourceId,
    })),
  ]
  return parseGenerationTask(await requestKinoEnvelope<unknown>(KINO_GENERATIONS_ROUTE, {
    method: 'POST',
    json: {
      game_id: input.gameSlug,
      media_type: 'video',
      duration_sec: input.durationSeconds,
      add_to_resource: true,
      content,
      extra: {
        generate_audio: input.generateAudio,
        ...(input.resolution ? { resolution: input.resolution } : {}),
      },
      ...(input.size ? { size: input.size } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.visualStyleKey ? { visual_style_key: input.visualStyleKey } : {}),
    },
    fetch: sameOriginFetch,
    ...(options.signal ? { signal: options.signal } : {}),
  }))
}

/** 轮询单个任务。 */
export async function getKinoGeneration(
  generationId: string,
  gameSlug: string,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask> {
  if (!generationId.trim()) {
    throw new KinoClientError('Missing generation id', 400, 'kino_invalid_parameter')
  }
  if (!gameSlug.trim()) {
    throw new KinoClientError('Missing gameSlug', 400, 'missing_game_slug')
  }
  const path = `${KINO_GENERATIONS_ROUTE}/${encodeURIComponent(generationId)}`
  return parseGenerationTask(await requestKinoEnvelope<unknown>(path, {
    fetch: sameOriginFetch,
    ...(options.signal ? { signal: options.signal } : {}),
  }))
}

/** 列出仍在推进的任务，用于刷新/重进后恢复进度。 */
export async function listActiveKinoGenerations(
  gameSlug: string,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask[]> {
  if (!gameSlug.trim()) {
    throw new KinoClientError('Missing gameSlug', 400, 'missing_game_slug')
  }
  const page = await requestKinoEnvelope<unknown>(KINO_GENERATIONS_ROUTE, {
    query: {
      game_id: gameSlug,
      media_type: 'video',
      page: 1,
      page_size: 100,
    },
    fetch: sameOriginFetch,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!isRecord(page) || !Array.isArray(page.items)) throw invalidTask()
  return page.items.map(parseGenerationTask)
}
