import {
  resolveSeedanceCall,
  type VideoClient,
  type VideoRequest,
  type VideoResult,
  type VideoTaskProvider,
} from './VideoProvider'
import { resolveExplicit } from './seedanceResolution'
import { maskSeedanceContentInput } from './faceMaskTool'

/**
 * HostGatewayVideoProvider —— 把视频生成委托给宿主 forgeax-server 的 litellm
 * 视频网关（`/__ce-api__/generate-video` + `/video-status`），而不是浏览器直连
 * 火山方舟 / 本地 Flask 后端。
 *
 * 为什么（作者 2026-06 · 全部走 litellm）：
 *   · 视频统一经 litellm `/v1/videos`（Volcengine Seedance 2.0），并发与计费由
 *     代理侧统一管理。
 *   · **安全**：LITELLM_PROXY_KEY 全程留在 server .env，浏览器只发同源
 *     `/__ce-api__/*`，key 永不进前端 bundle / 日志。
 *
 * 异步契约（与 LocalSeedanceProvider 同形，可直接复用 videoTaskStore / 队列）：
 *   POST /generate-video → { success, taskId }
 *   GET  /video-status?taskId= → { success, status, videoUrl?, error? }
 *
 * 参数透传（2026-06）：litellm `/v1/videos` 顶层只稳吃 `prompt/seconds/size/
 *   input_reference`（单图）。Seedance 原生 knobs（resolution / ratio /
 *   image_with_roles 首尾帧或多图参考 / reference_video / reference_audio /
 *   generate_audio / watermark）改走宿主 shim 的 `extra_body` 逐字透传 ——
 *   能否真正生效取决于代理侧 Volcengine 适配器；`input_reference` 仍保留为
 *   首图，作为适配器至少认得的兜底。
 */

interface GenerateVideoResp {
  success?: boolean
  taskId?: string
  error?: string
}
interface VideoStatusResp {
  success?: boolean
  status?: 'queued' | 'in_progress' | 'completed' | 'failed' | string
  videoUrl?: string
  error?: string
}

/** dataUrl 原样返回；其余（blob:/相对资产/https）fetch 后转成 base64 data URL。 */
async function toDataUrl(src: string): Promise<string | undefined> {
  if (!src) return undefined
  if (src.startsWith('data:')) return src
  try {
    const resp = await fetch(src)
    if (!resp.ok) return undefined
    const blob = await resp.blob()
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
    const mime = blob.type || 'image/png'
    return `data:${mime};base64,${btoa(bin)}`
  } catch {
    return undefined
  }
}

function pickPrimaryReference(req: VideoRequest): string | undefined {
  return (
    req.startFrameImageUrl ||
    req.referenceImageDataUrl ||
    req.referenceImageUrls?.find((u) => !!u) ||
    undefined
  )
}

export class HostGatewayVideoProvider implements VideoTaskProvider {
  private readonly base: string
  private readonly defaultDuration: number

  constructor(opts: { base?: string; durationSec?: number } = {}) {
    this.base = (opts.base ?? '/__ce-api__').replace(/\/$/, '')
    this.defaultDuration = opts.durationSec ?? 5
  }

  getProviderName(): string {
    return 'HostGatewayVideo'
  }
  getModel(): string {
    return 'seedance@litellm-host'
  }
  getProviderKind(): 'local' {
    // 复用 'local' 分支：上层据此走 createTask + pollTask 异步流程。
    return 'local'
  }

  async ping(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true }
  }

  async createTask(
    req: VideoRequest,
  ): Promise<{ taskId: string; warnings?: string[] }> {
    const warnings: string[] = []

    // 按官方互斥语义解析模式 + 分辨率/比例
    const { contentInput: rawContentInput, resolution, ratio } = resolveSeedanceCall(req, {
      size: '1080p',
    })
    // 上传给 Seedance 前，写实风格的图片(首帧/尾帧/参考图)统一过一遍打码工具（非写实跳过）。
    const contentInput = await maskSeedanceContentInput(rawContentInput, {
      visualStyle: req.visualStyle,
    })
    const frames = contentInput.mode === 'frames'

    // 组装 image_with_roles（首尾帧 XOR 多图参考），逐张转 data URL
    type RoleImg = { role: 'first_frame' | 'last_frame' | 'reference_image'; url: string }
    const roleSrc: RoleImg[] = []
    if (frames) {
      if (contentInput.firstFrameUrl) roleSrc.push({ role: 'first_frame', url: contentInput.firstFrameUrl })
      if (contentInput.firstFrameUrl && contentInput.lastFrameUrl) {
        roleSrc.push({ role: 'last_frame', url: contentInput.lastFrameUrl })
      }
    } else {
      for (const u of contentInput.referenceImageUrls ?? []) {
        roleSrc.push({ role: 'reference_image', url: u })
      }
    }
    const imageWithRoles: RoleImg[] = []
    for (const r of roleSrc) {
      const d = await toDataUrl(r.url)
      if (d) imageWithRoles.push({ role: r.role, url: d })
    }
    // input_reference 兜底 = 第一张（首帧 / 首张参考图）
    const inputReferenceDataUrl =
      imageWithRoles[0]?.url ?? (await toDataUrl(pickPrimaryReference(req) ?? ''))

    // 顶层 size（Sora 风格 WxH）—— 非 adaptive 时由 resolution×ratio 推导
    const sizeStr =
      ratio === 'adaptive'
        ? undefined
        : (() => {
            const s = resolveExplicit(resolution, ratio)
            return `${s.pxWidth}x${s.pxHeight}`
          })()

    // reference_video / reference_audio（仅多模态参考模式）转 data URL。
    //
    // 2026-06：宿主视频网关已改为直连火山方舟 doubao-seedance-2-0（R2V 多模态参考），
    // 原生支持 reference_image(1–9) + reference_video(≤3) + reference_audio(≤3) 联合控制，
    // 音频只需搭配至少一张参考图/一段参考视频即可。所以这里照常下发音/视频参考。
    const referenceVideoDataUrl =
      !frames && req.referenceVideoUrl ? await toDataUrl(req.referenceVideoUrl) : undefined
    const referenceAudioDataUrl =
      !frames && req.referenceAudioUrl ? await toDataUrl(req.referenceAudioUrl) : undefined

    const resp = await fetch(`${this.base}/generate-video`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: req.prompt,
        seconds: req.durationSec ?? this.defaultDuration,
        size: sizeStr,
        inputReferenceDataUrl,
        generateAudio: req.generateAudio,
        // Seedance 原生 knobs —— shim 放进 litellm extra_body 逐字透传
        mode: contentInput.mode,
        resolution,
        ratio,
        imageWithRoles: imageWithRoles.length > 0 ? imageWithRoles : undefined,
        referenceVideoDataUrl,
        referenceAudioDataUrl,
        watermark: req.watermark,
      }),
    })
    const raw = await resp.text()
    if (!resp.ok) {
      throw new Error(`[HTTP ${resp.status}] host video gateway · ${raw.slice(0, 200)}`)
    }
    let data: GenerateVideoResp
    try {
      data = JSON.parse(raw) as GenerateVideoResp
    } catch {
      throw new Error(`[PARSE] host video gateway non-JSON · ${raw.slice(0, 200)}`)
    }
    if (!data.success || !data.taskId) {
      throw new Error(data.error || '宿主视频网关创建任务失败')
    }
    return { taskId: data.taskId, warnings: warnings.length ? warnings : undefined }
  }

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
    const interval = opts.pollIntervalMs ?? 5000
    const timeout = opts.timeoutMs ?? 10 * 60 * 1000
    const t0 = Date.now()
    let consecutiveFail = 0
    const MAX_CONSEC_FAIL = 8

    while (true) {
      if (opts.signal?.aborted) {
        const e = new Error('[ABORT] poll aborted')
        ;(e as Error & { name: string }).name = 'AbortError'
        throw e
      }
      if (Date.now() - t0 > timeout) {
        return { status: 'failed', error: `[TIMEOUT] > ${timeout}ms` }
      }
      await sleep(interval, opts.signal)
      let resp: Response
      try {
        resp = await fetch(
          `${this.base}/video-status?taskId=${encodeURIComponent(taskId)}`,
          { signal: opts.signal },
        )
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        consecutiveFail++
        if (consecutiveFail >= MAX_CONSEC_FAIL) {
          return { status: 'failed', error: `[NET] ${consecutiveFail}× · ${(e as Error).message}` }
        }
        continue
      }
      if (!resp.ok) {
        consecutiveFail++
        if (consecutiveFail >= MAX_CONSEC_FAIL) {
          return { status: 'failed', error: `[HTTP ${resp.status}]` }
        }
        continue
      }
      consecutiveFail = 0
      let data: VideoStatusResp
      try {
        data = (await resp.json()) as VideoStatusResp
      } catch {
        consecutiveFail++
        continue
      }
      if (!data.success) {
        return { status: 'failed', error: data.error || '视频状态查询失败' }
      }
      opts.onUpdate?.({
        status: data.status === 'in_progress' ? 'generating' : data.status ?? 'queued',
        api_status: data.status,
        remote_video_url: data.videoUrl,
      })
      if (data.status === 'completed' && data.videoUrl) {
        return { status: 'completed', videoUrl: data.videoUrl }
      }
      if (data.status === 'failed') {
        return { status: 'failed', error: data.error || '视频任务失败' }
      }
      // queued / in_progress → 继续轮询
    }
  }

  async generate(req: VideoRequest): Promise<VideoResult> {
    const t0 = Date.now()
    req.onProgress?.('提交宿主视频网关…', 0)
    const created = await this.createTask(req)
    for (const w of created.warnings ?? []) req.onProgress?.(w, 0)
    req.onProgress?.(`任务已创建 ${created.taskId}`, Date.now() - t0)
    const result = await this.pollTask(created.taskId, {
      onUpdate: (t) => req.onProgress?.(`${t.status}${t.api_status ? ` · ${t.api_status}` : ''}`, Date.now() - t0),
      signal: undefined,
    })
    if (result.status !== 'completed' || !result.videoUrl) {
      throw new Error(`[TASK_FAILED] ${result.status} · ${result.error ?? '(no detail)'}`)
    }
    return {
      url: result.videoUrl,
      prompt: req.prompt,
      taskId: created.taskId,
      durationSec: req.durationSec ?? this.defaultDuration,
      latencyMs: Date.now() - t0,
      warnings: created.warnings,
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

/**
 * 是否走宿主视频网关（litellm）。
 *   - 嵌入宿主（path 含 /plugins/wb-reel）→ 默认开
 *   - localStorage `reel-studio.videoProvider`：'host' 强制开 / 'direct' 强制关
 */
export function shouldUseHostVideoGateway(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const override = window.localStorage.getItem('reel-studio.videoProvider')
    if (override === 'host') return true
    if (override === 'direct') return false
  } catch {
    /* ignore */
  }
  // 同 HostGatewayImageProvider：独立插件 dev 把 wb-reel iframe 到自己端口
  // （路径 '/'），仍经宿主 /__ce-api__ 反代到 forgeax-server → litellm。
  // 「被 iframe 嵌入」即默认走宿主网关；真正独立打开才回落直连。
  if (window.location.pathname.includes('/plugins/wb-reel')) return true
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
