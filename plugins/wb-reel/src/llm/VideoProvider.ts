import type { VideoConfig, VisualStyle } from '../scenario/types'
import {
  HostGatewayVideoProvider,
  shouldUseHostVideoGateway,
} from './HostGatewayVideoProvider'
import {
  buildSeedanceContent,
  type SeedanceMode,
  type BuildSeedanceContentInput,
} from './seedanceContent'
import {
  resolveSeedanceResolution,
  DEFAULT_VIDEO_SIZE,
  type VideoSize,
  type SeedanceRatio,
  type SeedanceResolutionTier,
} from './seedanceResolution'
import {
  computeBackoffMs,
  shouldRetryError,
  shouldRetryHttp,
} from './retryPolicy'
import { maskSeedanceContentInput } from './faceMaskTool'

/**
 * Video provider 抽象 —— 主要喂豆包 Seedance 2.0（火山方舟），
 * 同形态兼容 OpenAI Sora、Kling、Runway、字节即梦 jimeng-video 等。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 火山方舟 Seedance 2.0 异步任务 API（2026-05 官方样例对齐）
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1) 创建任务
 *      POST  ${apiBase}/contents/generations/tasks
 *      headers: Authorization: Bearer <api_key>
 *      body:
 *        {
 *          model:            '<model-id 或 ep-xxx endpoint id>',
 *          content:          [text + reference_image/_video/_audio ...],
 *          ratio:            '16:9' | '9:16' | '1:1',
 *          duration:         <sec>,
 *          generate_audio:   boolean,
 *          watermark:        boolean,
 *        }
 *      → { id: 'task-...' }
 *
 *   2) 轮询状态
 *      GET   ${apiBase}/contents/generations/tasks/{task_id}
 *      → { status: 'queued' | 'running' | 'succeeded' | 'failed', content: { video_url } }
 *
 *   **不存在** `resolution` 这个 API 字段 —— 档位（1080p/720p）由 `model` /
 *   endpoint 的注册配置决定。换档位 = 换 endpoint。
 *
 *   `content[]` 支持的 role：
 *     reference_image  最多 2 张（第 1=首帧 A、第 2=尾帧 B）
 *     reference_video  1 段（运镜/动作参考）
 *     reference_audio  1 段（BGM/氛围参考）
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 我们的接口约定
 * ─────────────────────────────────────────────────────────────────────────────
 *   - 一次 generate() = "提交 + 轮询完成"——上层只关心最终视频 URL
 *   - 轮询间隔 / 总超时由 generate() 内部封装；onProgress 可选
 *   - 失败分类：[CONFIG] / [HTTP n] / [TIMEOUT] / [TASK_FAILED] / [NET]
 */

export interface VideoRequest {
  prompt: string
  /**
   * **首帧 / A 帧**参考图 URL（公网 https 或 base64 dataUrl 或 /uploads/...）。
   *
   * 新名 `startFrameImageUrl` 语义清晰；旧名 `referenceImageDataUrl` 继续接受，
   * 语义相同（= 首帧）。两者同时传时以 `startFrameImageUrl` 为准。
   *
   * v4（2026-05-07）：走本地视频服务（LocalSeedanceProvider）时，data:base64
   * URL 和 /uploads/... 都会被后端正确处理；老路径 SeedanceProvider 直连
   * Seedance API 时，data:base64 仍会被 buildSeedanceContent 跳过 —— 这是为
   * 什么 reel-studio 默认走 local backend。
   */
  startFrameImageUrl?: string
  /** @deprecated 用 startFrameImageUrl；保留以兼容旧调用点 */
  referenceImageDataUrl?: string
  /**
   * 尾帧 / B 帧参考图 URL —— 走 LocalSeedanceProvider 时会被并入 referenceImageUrls。
   */
  endFrameImageUrl?: string
  /**
   * v4 · 完整的参考图序列（最多 9 张，seedanceContent.SEEDANCE_MAX_REF_IMAGES）。
   * 建议由 buildVideoReferenceSet 生成，已含"首位=当前 shot keyframe"的强制顺序。
   * 如果同时传了 startFrameImageUrl / endFrameImageUrl，Provider 会把它们拼到
   * 这个数组的前后（start 在最前、end 在最后）。
   */
  referenceImageUrls?: string[]
  /** 运镜 / 动作参考视频 URL（公网 https），喂 reference_video role */
  referenceVideoUrl?: string
  /** BGM / 氛围参考音频 URL（公网 https），喂 reference_audio role */
  referenceAudioUrl?: string
  /** 视频时长（秒），默认 5 */
  durationSec?: number
  /**
   * 生成模式（官方互斥语义）：
   *   · 'frames'    首尾帧模式 —— firstFrame(=startFrameImageUrl) + 可选 lastFrame(=endFrameImageUrl)
   *   · 'reference' 多模态参考模式 —— referenceImageUrls + 参考视频/音频
   * 不传时由 provider 推断（有尾帧→frames；有多锚点→reference；仅单图→frames）。
   */
  mode?: SeedanceMode
  /**
   * 分辨率档位（真字段，下发 body.resolution）。默认 1080p。
   * 1080p 仅部分模型支持，换不支持的模型会被服务端回退/报错。
   */
  resolution?: SeedanceResolutionTier
  /** 比例（真字段，下发 body.ratio）。默认 16:9。'adaptive' = 模型自适应。 */
  ratio?: SeedanceRatio
  /**
   * @deprecated 旧的 size 档位（tier+ratio 合一）。新代码用 resolution + ratio。
   * 仍接受以兼容已持久化 scenario；当 resolution/ratio 缺省时回落由它推导。
   */
  size?: VideoSize
  /**
   * 让 Seedance 直接生成带音轨的视频（body.generate_audio）。
   * 缺省走 VideoConfig.generateAudio（默认 true）。
   */
  generateAudio?: boolean
  /**
   * 是否在视频右下角加 Seedance 水印（body.watermark）。
   * 缺省走 VideoConfig.watermark（默认 false）。
   */
  watermark?: boolean
  /** 进度回调（轮询时触发） */
  onProgress?: (msg: string, elapsedMs: number) => void
  /**
   * 全局视觉风格 —— 仅用于「上传给视频模型前的人脸打码」gate：
   * 只有写实（photoreal / 缺省）才走打码；非写实风格跳过。不影响生成本身。
   */
  visualStyle?: VisualStyle
}

export interface VideoResult {
  /** 直链 URL（火山方舟返回的 https url） */
  url: string
  prompt: string
  taskId: string
  durationSec: number
  latencyMs: number
  /**
   * 非致命提示 —— 比如"尾帧参考图是 base64 dataURL，已跳过"。
   * UI 层应把它显示给作者，但不阻断流程。
   */
  warnings?: string[]
}

export interface VideoClient {
  generate(req: VideoRequest): Promise<VideoResult>
  ping(): Promise<{ ok: boolean; error?: string }>
  getProviderName(): string
  getModel(): string
}

// ============================================================================
// Seedance（火山方舟 Doubao Seedance 2.0） —— 真实实现
// ============================================================================

interface SeedanceTaskCreateResp {
  id?: string
  error?: { code?: string; message?: string }
}

interface SeedanceTaskStatusResp {
  id?: string
  status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  content?: {
    video_url?: string
  }
  error?: { code?: string; message?: string }
}

const DEFAULT_GENERATE_AUDIO = true
const DEFAULT_WATERMARK = false

/**
 * v6（P3-C）· Seedance 原生 status → videoTaskStore status 的映射。
 *
 * Seedance 的 enum：queued | running | succeeded | failed | cancelled
 * store 的 enum：   queued | generating | downloading | completed | failed | interrupted
 *
 * 对齐策略：
 *   · queued → queued（排队未开跑）
 *   · running → generating（跑起来了；Seedance 没有 download 阶段 —— 视频直接拿 URL）
 *   · 其它终态不在 onUpdate 里出现（pollTask 在终态直接 return）
 */
function mapSeedanceStatus(s: string | undefined): string {
  if (s === 'queued') return 'queued'
  if (s === 'running') return 'generating'
  return s ?? 'queued'
}

/**
 * v6（P3-C）· 统一的"可 resume 任务型" Provider 契约。
 *
 * LocalSeedanceProvider 和 SeedanceProvider 都实现这个 —— 上游（PromptTabs /
 * videoTaskResume）通过 duck typing (`'createTask' in provider`) 决定是否
 * 走"先 upsert store 再 poll"的流程。Mock 不实现，走原 generate 路径。
 */
export interface VideoTaskProvider extends VideoClient {
  createTask(
    req: VideoRequest,
  ): Promise<{ taskId: string; remoteTaskId?: string; apiStatus?: string; warnings?: string[] }>
  pollTask(
    taskId: string,
    opts?: {
      onUpdate?: (task: {
        status: string
        api_status?: string
        filename?: string
        error?: string
        remote_video_url?: string
      }) => void
      signal?: AbortSignal
      pollIntervalMs?: number
      timeoutMs?: number
    },
  ): Promise<{
    status: 'completed' | 'failed' | 'interrupted'
    videoUrl?: string
    error?: string
  }>
  getProviderKind(): 'local' | 'seedance'
}

export function isVideoTaskProvider(p: VideoClient): p is VideoTaskProvider {
  return (
    typeof (p as Partial<VideoTaskProvider>).createTask === 'function' &&
    typeof (p as Partial<VideoTaskProvider>).pollTask === 'function' &&
    typeof (p as Partial<VideoTaskProvider>).getProviderKind === 'function'
  )
}

/**
 * 把 VideoRequest 归一成 Seedance 调用所需的「模式 + content + 分辨率/比例」。
 *
 * 模式推断（未显式 req.mode 时）——官方首尾帧/多模态参考互斥，必须二选一：
 *   1) 有尾帧（endFrameImageUrl）              → frames（首+尾）
 *   2) 有多模态参考（referenceImageUrls 非空） → reference（首帧折叠为第一张参考图）
 *   3) 仅单首帧                                → frames（单 first_frame，即图生视频）
 *   4) 纯文生                                  → reference（无图）
 *
 * 同时解析 resolution/ratio：优先 req.resolution/req.ratio；否则回落 size 档位推导。
 */
export function resolveSeedanceCall(
  req: VideoRequest,
  defaults: { size: VideoSize; resolution?: SeedanceResolutionTier; ratio?: SeedanceRatio },
): {
  contentInput: BuildSeedanceContentInput
  resolution: SeedanceResolutionTier
  ratio: SeedanceRatio
} {
  const startFrame = req.startFrameImageUrl ?? req.referenceImageDataUrl
  const refs = (req.referenceImageUrls ?? []).filter(
    (u) => u && u !== startFrame && u !== req.endFrameImageUrl,
  )
  const hasEnd = !!req.endFrameImageUrl
  const hasRefs = refs.length > 0

  const mode: SeedanceMode =
    req.mode ?? (hasEnd ? 'frames' : hasRefs ? 'reference' : startFrame ? 'frames' : 'reference')

  let contentInput: BuildSeedanceContentInput
  if (mode === 'frames') {
    contentInput = {
      composedText: req.prompt,
      mode: 'frames',
      firstFrameUrl: startFrame,
      lastFrameUrl: req.endFrameImageUrl,
    }
  } else {
    // reference：首帧（若有）作为第一张参考图，保持镜头主体在最前
    const seq = startFrame ? [startFrame, ...refs] : refs
    contentInput = {
      composedText: req.prompt,
      mode: 'reference',
      referenceImageUrls: seq,
      referenceVideoUrl: req.referenceVideoUrl,
      referenceAudioUrl: req.referenceAudioUrl,
    }
  }

  // 分辨率/比例：显式优先；否则用 size 档位推导（兼容旧持久化）
  let resolution = req.resolution ?? defaults.resolution
  let ratio = req.ratio ?? defaults.ratio
  if (!resolution || !ratio) {
    const spec = resolveSeedanceResolution((req.size ?? defaults.size) as VideoSize)
    resolution = resolution ?? spec.resolution
    ratio = ratio ?? spec.ratio
  }
  return { contentInput, resolution, ratio }
}

export class SeedanceProvider implements VideoTaskProvider {
  private readonly apiKey: string
  private readonly apiBase: string
  private readonly model: string
  private readonly defaultDuration: number
  private readonly defaultSize: VideoSize
  private readonly defaultGenerateAudio: boolean
  private readonly defaultWatermark: boolean

  constructor(cfg: VideoConfig) {
    if (!cfg.apiKey) throw new Error('SeedanceProvider: missing apiKey')
    this.apiKey = cfg.apiKey
    this.apiBase = (cfg.apiBase ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '')
    this.model = cfg.model ?? 'doubao-seedance-2-0-260128'
    this.defaultDuration = cfg.durationSec ?? 5
    this.defaultSize = (cfg.size ?? DEFAULT_VIDEO_SIZE) as VideoSize
    this.defaultGenerateAudio = cfg.generateAudio ?? DEFAULT_GENERATE_AUDIO
    this.defaultWatermark = cfg.watermark ?? DEFAULT_WATERMARK
  }

  getProviderName(): string {
    return 'Seedance'
  }
  getModel(): string {
    return this.model
  }
  getProviderKind(): 'seedance' {
    return 'seedance'
  }

  async generate(req: VideoRequest): Promise<VideoResult> {
    const t0 = performance.now()
    const created = await this.createTask(req)
    req.onProgress?.(
      `已创建任务 ${created.taskId}`,
      Math.round(performance.now() - t0),
    )
    for (const w of created.warnings) req.onProgress?.(w, 0)

    const poll = await this.pollUntilDone(created.taskId, req)
    const url = poll.content?.video_url
    if (!url) {
      throw new Error('[EMPTY] task succeeded but no video_url')
    }
    return {
      url,
      prompt: req.prompt,
      taskId: created.taskId,
      durationSec: req.durationSec ?? this.defaultDuration,
      latencyMs: Math.round(performance.now() - t0),
      warnings: created.warnings.length ? created.warnings : undefined,
    }
  }

  async ping(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) return { ok: false, error: 'no api key' }
    return { ok: true }
  }

  /**
   * v6（P3-C）· 对齐 LocalSeedanceProvider 的 pollTask 契约 ——
   *
   * 组件拿 taskId 后立刻写 videoTaskStore，再用这个方法异步监听。
   *   · 正常结束 resolve `{ status: 'completed', videoUrl }`
   *   · 失败     resolve `{ status: 'failed', error }`
   *   · 超时     resolve `{ status: 'failed', error: '[TIMEOUT]...' }`
   *   · 被 AbortSignal 触发 → throw AbortError（不 resolve，让调用方自己决定怎么写回 store）
   *
   * onUpdate 每次 poll 成功都会带上 Seedance 原始 status 字段，方便 UI
   * 显示"status=running · 38s"这类细节。
   */
  async pollTask(
    taskId: string,
    opts: {
      onUpdate?: (task: {
        status: string
        api_status?: string
        filename?: string
        error?: string
        remote_video_url?: string
      }) => void
      signal?: AbortSignal
      pollIntervalMs?: number
      timeoutMs?: number
    } = {},
  ): Promise<{
    status: 'completed' | 'failed' | 'interrupted'
    videoUrl?: string
    error?: string
  }> {
    const interval = opts.pollIntervalMs ?? 4000
    const timeout = opts.timeoutMs ?? 10 * 60 * 1000
    const url = `${this.apiBase}/contents/generations/tasks/${taskId}`
    const t0 = performance.now()
    let consecutiveFail = 0
    const MAX_CONSEC_FAIL = 8

    while (true) {
      if (opts.signal?.aborted) {
        const e = new Error('[ABORT] poll aborted')
        ;(e as Error & { name: string }).name = 'AbortError'
        throw e
      }
      if (performance.now() - t0 > timeout) {
        return { status: 'failed', error: `[TIMEOUT] > ${timeout}ms` }
      }
      await sleep(interval, opts.signal)
      let resp: Response
      try {
        resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: opts.signal,
        })
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        consecutiveFail++
        if (consecutiveFail >= MAX_CONSEC_FAIL) {
          return {
            status: 'failed',
            error: `[NET] poll failed ${consecutiveFail}× · ${(e as Error).message}`,
          }
        }
        continue
      }
      const raw = await resp.text()
      if (!resp.ok) {
        if (shouldRetryHttp(resp.status)) {
          consecutiveFail++
          if (consecutiveFail >= MAX_CONSEC_FAIL) {
            return {
              status: 'failed',
              error: `[HTTP ${resp.status}] poll failed ${consecutiveFail}× · ${raw.slice(0, 200)}`,
            }
          }
          const extra = computeBackoffMs(
            consecutiveFail - 1,
            resp.headers.get('retry-after'),
          )
          await sleep(Math.min(extra, 15_000), opts.signal)
          continue
        }
        return {
          status: 'failed',
          error: `[HTTP ${resp.status}] poll · ${raw.slice(0, 200)}`,
        }
      }
      consecutiveFail = 0
      let data: SeedanceTaskStatusResp
      try {
        data = JSON.parse(raw) as SeedanceTaskStatusResp
      } catch {
        return { status: 'failed', error: `[PARSE] poll non-JSON · ${raw.slice(0, 180)}` }
      }
      opts.onUpdate?.({
        status: mapSeedanceStatus(data.status),
        api_status: data.status,
        remote_video_url: data.content?.video_url,
      })
      if (data.status === 'succeeded') {
        const videoUrl = data.content?.video_url
        if (!videoUrl) {
          return { status: 'failed', error: '[EMPTY] succeeded but no video_url' }
        }
        return { status: 'completed', videoUrl }
      }
      if (data.status === 'failed' || data.status === 'cancelled') {
        return {
          status: 'failed',
          error: `[TASK_FAILED] ${data.status} · ${data.error?.message ?? '(no detail)'}`,
        }
      }
    }
  }

  async createTask(
    req: VideoRequest,
  ): Promise<{ taskId: string; warnings: string[] }> {
    const url = `${this.apiBase}/contents/generations/tasks`

    // 按官方互斥语义解析模式 + 构建 content + 解析 resolution/ratio
    const { contentInput: rawContentInput, resolution, ratio } = resolveSeedanceCall(req, {
      size: this.defaultSize,
    })
    // 上传给 Seedance 前，写实风格的图片(首帧/尾帧/参考图)统一过一遍打码工具（非写实跳过）。
    const contentInput = await maskSeedanceContentInput(rawContentInput, {
      visualStyle: req.visualStyle,
    })
    const { content, warnings } = buildSeedanceContent(contentInput)

    const body = {
      model: this.model,
      content,
      resolution,
      ratio,
      duration: req.durationSec ?? this.defaultDuration,
      generate_audio: req.generateAudio ?? this.defaultGenerateAudio,
      watermark: req.watermark ?? this.defaultWatermark,
    }

    let resp: Response
    let raw = ''
    const MAX_ATTEMPTS = 5
    // createTask 遇到 429/5xx/网络错 → 退避重试；4xx 业务错（参数不合法/鉴权失败）
    // 直接抛出去。重试次数封顶 5，每次指数退避 ~1s/2s/4s/8s（+ jitter），
    // 服务端给的 Retry-After 优先。
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        })
        raw = await resp.text()
      } catch (e) {
        lastErr = e
        if (!shouldRetryError(e) || attempt === MAX_ATTEMPTS - 1) {
          throw new Error(`[NET] seedance create failed: ${(e as Error).message}`)
        }
        const wait = computeBackoffMs(attempt)
        console.warn(
          `[SeedanceProvider] createTask net err: ${(e as Error).message} · ` +
            `attempt ${attempt + 1}/${MAX_ATTEMPTS}, wait ${wait}ms`,
        )
        await sleep(wait)
        continue
      }
      if (resp.ok) break
      if (!shouldRetryHttp(resp.status) || attempt === MAX_ATTEMPTS - 1) {
        throw new Error(
          `[HTTP ${resp.status}] ${resp.statusText} · ${raw.slice(0, 240)}`,
        )
      }
      const wait = computeBackoffMs(attempt, resp.headers.get('retry-after'))
      console.warn(
        `[SeedanceProvider] createTask HTTP ${resp.status} · ` +
          `attempt ${attempt + 1}/${MAX_ATTEMPTS}, wait ${wait}ms`,
      )
      await sleep(wait)
    }
    if (!resp!) {
      throw new Error(
        `[RETRY] seedance create exhausted: ${(lastErr as Error)?.message ?? '?'}`,
      )
    }
    let data: SeedanceTaskCreateResp
    try {
      data = JSON.parse(raw) as SeedanceTaskCreateResp
    } catch {
      throw new Error(`[PARSE] non-JSON · head=${raw.slice(0, 200)}`)
    }
    if (data.error || !data.id) {
      throw new Error(
        `[API] ${data.error?.code ?? '?'} · ${data.error?.message ?? raw.slice(0, 200)}`,
      )
    }
    return { taskId: data.id, warnings }
  }

  private async pollUntilDone(
    taskId: string,
    req: VideoRequest,
  ): Promise<SeedanceTaskStatusResp> {
    const start = performance.now()
    const url = `${this.apiBase}/contents/generations/tasks/${taskId}`
    const intervalMs = 4000
    const timeoutMs = 6 * 60 * 1000 // 6 分钟硬上限
    // 轮询 500/网络抖动是常态：允许连续 8 次失败不 kill 整个任务
    // 单次失败等 min(nextBackoff, intervalMs) 再试
    const MAX_CONSEC_FAIL = 8
    let consecutiveFail = 0

    while (true) {
      if (performance.now() - start > timeoutMs) {
        throw new Error(`[TIMEOUT] task ${taskId} > ${timeoutMs}ms`)
      }
      await sleep(intervalMs)
      let resp: Response
      try {
        resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        })
      } catch (e) {
        consecutiveFail++
        if (consecutiveFail >= MAX_CONSEC_FAIL) {
          throw new Error(
            `[NET] poll failed ${consecutiveFail}× in a row: ${(e as Error).message}`,
          )
        }
        console.warn(
          `[SeedanceProvider] poll ${taskId} net err ${consecutiveFail}/${MAX_CONSEC_FAIL}: ` +
            `${(e as Error).message}`,
        )
        continue
      }
      const raw = await resp.text()
      if (!resp.ok) {
        // 429/5xx：服务端抖动，不算真失败；累到 MAX_CONSEC_FAIL 再放弃
        if (shouldRetryHttp(resp.status)) {
          consecutiveFail++
          if (consecutiveFail >= MAX_CONSEC_FAIL) {
            throw new Error(
              `[HTTP ${resp.status}] poll failed ${consecutiveFail}× · ${raw.slice(0, 240)}`,
            )
          }
          console.warn(
            `[SeedanceProvider] poll ${taskId} HTTP ${resp.status} ` +
              `${consecutiveFail}/${MAX_CONSEC_FAIL}: ${raw.slice(0, 180)}`,
          )
          // 根据 Retry-After 延后下一次；无则用额外退避叠在 intervalMs 上
          const extra = computeBackoffMs(
            consecutiveFail - 1,
            resp.headers.get('retry-after'),
          )
          await sleep(Math.min(extra, 15_000))
          continue
        }
        // 4xx 业务错（鉴权、任务不存在等）直接 bubble
        throw new Error(
          `[HTTP ${resp.status}] poll · ${raw.slice(0, 240)}`,
        )
      }
      // 这一次 poll 成功了，重置失败计数
      consecutiveFail = 0
      let data: SeedanceTaskStatusResp
      try {
        data = JSON.parse(raw) as SeedanceTaskStatusResp
      } catch {
        throw new Error(`[PARSE] poll non-JSON · ${raw.slice(0, 200)}`)
      }
      const elapsed = Math.round(performance.now() - start)
      req.onProgress?.(`status=${data.status ?? '?'}`, elapsed)
      if (data.status === 'succeeded') return data
      if (data.status === 'failed' || data.status === 'cancelled') {
        throw new Error(
          `[TASK_FAILED] ${data.status} · ${data.error?.message ?? '(no detail)'}`,
        )
      }
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms))
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const e = new Error('[ABORT] sleep aborted')
      ;(e as Error & { name: string }).name = 'AbortError'
      reject(e)
      return
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      signal.removeEventListener('abort', onAbort)
      const e = new Error('[ABORT] sleep aborted')
      ;(e as Error & { name: string }).name = 'AbortError'
      reject(e)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ============================================================================
// Mock —— 没填 key 时兜底，让 UI 全流程跑通
// ============================================================================

export class MockVideoProvider implements VideoClient {
  getProviderName(): string {
    return 'Mock'
  }
  getModel(): string {
    return 'mock-video'
  }
  async generate(req: VideoRequest): Promise<VideoResult> {
    const t0 = performance.now()
    await sleep(800)
    req.onProgress?.('mock · queued', 0)
    await sleep(800)
    req.onProgress?.('mock · running', 800)
    return {
      url: '',
      prompt: req.prompt,
      taskId: 'mock-' + Math.random().toString(36).slice(2, 8),
      durationSec: req.durationSec ?? 5,
      latencyMs: Math.round(performance.now() - t0),
    }
  }
  async ping(): Promise<{ ok: boolean }> {
    return { ok: true }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createVideoProvider(cfg: VideoConfig | undefined): VideoClient {
  // 视频生成只剩两条**纯 TS** 路径（2026-06 退役本机 Python Flask 后端）：
  //   1) 宿主 litellm 网关（HostGatewayVideoProvider）—— 嵌入态默认；key 留 server。
  //   2) 直连火山方舟（SeedanceProvider）—— 独立打开且显式配了 apiKey 时的后备。
  //
  // 分支逻辑：
  //   · provider === 'mock' 或 undefined            → Mock
  //   · 嵌入宿主（shouldUseHostVideoGateway）        → HostGatewayVideoProvider
  //   · provider === 'seedance'/'jimeng' + apiKey   → 直连 SeedanceProvider
  //   · 其他（含无 apiKey 的直连场景）               → Mock（UI 全流程可跑通）
  if (!cfg) return new MockVideoProvider()
  if (cfg.provider === 'mock') return new MockVideoProvider()
  // 全部走 litellm（作者 2026-06）：嵌入宿主时，视频统一经宿主 litellm 网关，
  // key 留 server。localStorage `reel-studio.videoProvider='direct'` 可强制绕开。
  if (shouldUseHostVideoGateway()) {
    return new HostGatewayVideoProvider({ durationSec: cfg.durationSec })
  }
  if ((cfg.provider === 'seedance' || cfg.provider === 'jimeng') && cfg.apiKey) {
    return new SeedanceProvider(cfg)
  }
  return new MockVideoProvider()
}
