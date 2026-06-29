/**
 * videoPipelineRunner —— DAG 执行器（v3.8 新增）
 *
 * 定位：把 videoSchedule 编译出的 DAG 真的跑起来：
 *   - 按拓扑波次执行；每波内并发到 recommendedConcurrency
 *   - 同组前段完成 → 截尾帧 → 作为后段 startFrame
 *   - 失败不阻断整体，只把错落到 segmentResults[].error
 *
 * 副作用边界：
 *   - 调 VideoClient.generate（真的发视频 API）
 *   - 通过注入的 `extractTailFrame` 截尾帧（浏览器端用 HTMLVideoElement+canvas）
 *   - 不写 scenario 持久层（调用方自己负责把结果写回 Shot.videoMediaRef）
 *
 * 注入策略：
 *   - Runner **不知道** DOM —— `extractTailFrame` 从外面传
 *   - Node 测试时传 noop / 假实现
 *   - 浏览器真实跑时传基于 video + canvas 的实现
 */
import type { VideoClient, VideoResult } from './VideoProvider'
import { runWithConcurrency } from './batchImageGen'
import type { VisualStyle } from '../scenario/types'
import type { VideoPlan, VideoSegment } from './videoPlanTypes'
import { buildVideoDag, layerizeDag, type VideoDag } from './videoSchedule'
import { getCapability } from './modelCapabilities'

/**
 * 从视频 URL 截取尾帧（最后一帧）→ dataURL（base64 inline）。
 * 调用方负责实现：浏览器端用 HTMLVideoElement + canvas；Node 测试可 noop。
 *
 * 返回 undefined 表示"截取失败或不支持"——Runner 会 fallback 到 shot-keyframe。
 */
export type ExtractTailFrameFn = (videoUrl: string) => Promise<string | undefined>

/**
 * 拿起手图 —— 根据 segment.startFrameStrategy 返回 dataURL 或 undefined。
 * 调用方提供，因为不同项目媒体存放路径不同（mediaStore / S3 / 本地 blob）。
 */
export type ResolveStartFrameFn = (
  segment: VideoSegment,
  prevResult: VideoResult | undefined,
  extractTailFrame: ExtractTailFrameFn,
) => Promise<string | undefined>

export interface RunVideoPlanArgs {
  plan: VideoPlan
  client: VideoClient
  /** 截尾帧实现（必传）—— 浏览器 DOM 或 Node 假实现由外部注入 */
  extractTailFrame: ExtractTailFrameFn
  /** 起手图解析（必传）—— 处理 shot-keyframe / shot-start-frame / prev-segment-tail */
  resolveStartFrame: ResolveStartFrameFn
  /** 进度回调 */
  onProgress?: (ev: PipelineProgressEvent) => void
  signal?: AbortSignal
  /** 覆盖并发（调试用）；不传取 modelCapabilities.recommendedConcurrency */
  concurrency?: number
  /** 全局视觉风格 —— 透传给上传层打码 gate（写实才打码，非写实跳过） */
  visualStyle?: VisualStyle
}

export type PipelineProgressEvent =
  | { kind: 'wave-start'; waveIndex: number; segments: VideoSegment[] }
  | { kind: 'segment-start'; segment: VideoSegment; startFrameSource: string }
  | { kind: 'segment-ok'; segment: VideoSegment; result: VideoResult }
  | { kind: 'segment-fail'; segment: VideoSegment; error: string }
  | { kind: 'done'; okCount: number; failCount: number }

export interface SegmentRunResult {
  segment: VideoSegment
  ok: boolean
  result?: VideoResult
  /** 截到的尾帧 dataURL（有则用作下一段 startFrame） */
  tailFrameDataUrl?: string
  error?: string
  startedAt: number
  endedAt: number
}

export interface RunVideoPlanResult {
  segmentResults: SegmentRunResult[]
  dag: VideoDag
  okCount: number
  failCount: number
}

/**
 * 主入口：执行完整 VideoPlan。
 *
 * 执行顺序：
 *   波次 0（并行）：所有 waitFor=[] 的 segment
 *   波次 1（并行）：所有在波 0 完成后可启动的 segment
 *   ...
 *
 * 波内并发 = min(recommendedConcurrency, 波大小)。
 * 波间串行等待：同一组的 segment 天然在不同波里。
 *
 * 为什么不用事件驱动（所有 segment 一开始就 listen waitFor）？
 *   - 波次模型更好实现、好测、好看进度
 *   - 性能损失极小：DAG 本来就是按 continuityGroup 切的，同组段是物理串行，
 *     跨组段靠波内并发已经吃满
 */
export async function runVideoPlan(args: RunVideoPlanArgs): Promise<RunVideoPlanResult> {
  const { plan, client, extractTailFrame, resolveStartFrame, onProgress, signal, visualStyle } = args
  const cap = getCapability(plan.modelId)
  const concurrency = Math.max(
    1,
    args.concurrency ?? cap.recommendedConcurrency ?? 2,
  )

  const dag = buildVideoDag(plan, { defaultConcurrency: concurrency })
  const waves = layerizeDag(dag)

  const resultMap = new Map<string, SegmentRunResult>()

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    if (signal?.aborted) break
    const wave = waves[waveIdx]!
    onProgress?.({ kind: 'wave-start', waveIndex: waveIdx, segments: wave })

    await runWithConcurrency<VideoSegment, SegmentRunResult>(
      wave,
      async (seg) => {
        if (signal?.aborted) {
          return makeFailResult(seg, 'aborted')
        }
        const prevResult = seg.dependsOnSegmentId
          ? resultMap.get(seg.dependsOnSegmentId)?.result
          : undefined
        let startFrame: string | undefined
        let startFrameSource: string = seg.startFrameStrategy
        try {
          startFrame = await resolveStartFrame(seg, prevResult, extractTailFrame)
        } catch (e) {
          startFrameSource = `${seg.startFrameStrategy}-fail`
          void e
        }

        onProgress?.({ kind: 'segment-start', segment: seg, startFrameSource })

        const t0 = Date.now()
        try {
          const res = await client.generate({
            prompt: seg.prompt,
            referenceImageDataUrl: startFrame,
            durationSec: seg.durationSec,
            visualStyle,
          })
          const t1 = Date.now()
          let tailFrameDataUrl: string | undefined
          try {
            tailFrameDataUrl = await extractTailFrame(res.url)
          } catch {
            tailFrameDataUrl = undefined
          }
          const ok: SegmentRunResult = {
            segment: seg,
            ok: true,
            result: res,
            tailFrameDataUrl,
            startedAt: t0,
            endedAt: t1,
          }
          onProgress?.({ kind: 'segment-ok', segment: seg, result: res })
          return ok
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          onProgress?.({ kind: 'segment-fail', segment: seg, error: msg })
          return makeFailResult(seg, msg, t0)
        }
      },
      { concurrency },
    ).then((batch) => {
      // 因为 worker 内部已捕获所有异常并返回 SegmentRunResult，batch.failed 应为空；
      // 但保险起见：batch.ok 里的 SegmentRunResult 可能是成功或失败两种形态
      batch.ok.forEach((sr) => {
        resultMap.set(sr.segment.id, sr)
      })
      batch.failed.forEach((f) => {
        // 理论不会走到这里（worker 不抛）；兜底
        resultMap.set(
          f.item.id,
          makeFailResult(f.item, f.error.message),
        )
      })
    })
  }

  const segmentResults: SegmentRunResult[] = plan.segments.map(
    (seg) => resultMap.get(seg.id) ?? makeFailResult(seg, 'not executed'),
  )
  const okCount = segmentResults.filter((r) => r.ok).length
  const failCount = segmentResults.length - okCount
  onProgress?.({ kind: 'done', okCount, failCount })

  return { segmentResults, dag, okCount, failCount }
}

function makeFailResult(seg: VideoSegment, error: string, startedAt?: number): SegmentRunResult {
  const now = Date.now()
  return {
    segment: seg,
    ok: false,
    error,
    startedAt: startedAt ?? now,
    endedAt: now,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 浏览器端尾帧截取实现（可选导入）—— Node 测试绕开
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 浏览器实现：加载视频 → seek 到最后一帧 → canvas.drawImage → dataURL。
 *
 * **只在浏览器环境用**；Node 下会因没有 HTMLVideoElement 而抛。调用方自行判断。
 *
 * 失败原因可能：
 *   - CORS（视频 URL 跨域且未带 crossorigin 头）
 *   - video 元数据加载超时
 *
 * 这些失败都会返回 undefined（而非抛）—— Runner 会 fallback 到 shot 起手图。
 */
export function createBrowserTailFrameExtractor(
  opts: { format?: 'image/jpeg' | 'image/png'; quality?: number; timeoutMs?: number } = {},
): ExtractTailFrameFn {
  const format = opts.format ?? 'image/jpeg'
  const quality = opts.quality ?? 0.85
  const timeoutMs = opts.timeoutMs ?? 10_000

  return async (videoUrl) => {
    if (typeof document === 'undefined') return undefined
    try {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      video.src = videoUrl

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('metadata timeout')), timeoutMs)
        video.addEventListener('loadedmetadata', () => {
          clearTimeout(t)
          resolve()
        }, { once: true })
        video.addEventListener('error', () => {
          clearTimeout(t)
          reject(new Error('video load error'))
        }, { once: true })
      })

      // seek 到 duration - 0.05s（留一点余量避开黑帧）
      const targetT = Math.max(0, (video.duration || 0) - 0.05)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('seek timeout')), timeoutMs)
        video.addEventListener('seeked', () => {
          clearTimeout(t)
          resolve()
        }, { once: true })
        video.currentTime = targetT
      })

      const canvas = document.createElement('canvas')
      // 优先用视频流自带的真实分辨率（Seedance 返回的 mp4 stream 有 videoWidth/videoHeight）；
      // fallback 1280×720 故意保守 —— I2V 场景 Seedance 会把 1080p 降级为 720p，
      // 即便作者设了 1080p，真实流也常是 1280×720。1920×1088 只在 T2V 时出现。
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      const ctx = canvas.getContext('2d')
      if (!ctx) return undefined
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL(format, quality)
    } catch {
      return undefined
    }
  }
}
