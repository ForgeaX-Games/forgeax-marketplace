/**
 * batchVideoGen —— 剧情树"一键生成全部视频"的批处理入口。
 *
 * 设计取舍：
 *   - 图像批已有 batchImageGen（独立成文件），视频批也成文件对称；保持 llm 层
 *     只负责"网络 + 业务编排"，不碰 UI 组件 / store。
 *   - 视频依赖图像（即梦 seedance 支持 image-to-video，起手帧来自 IMAGE_PROMPT
 *     场景的缓存）；但在这一层**不强制检查**依赖完整性 —— 作者可以单独只生某些
 *     场景；哪些场景需要图，由上层根据 sceneImageCache 决策，通过 tasks 列表
 *     直接传进来。
 *   - 并发默认 2：火山引擎 seedance 任务本身异步，轮询间隔 4-6s，客户端并发
 *     过高会导致 HTTP 429；并且一次视频消耗远高于图，作者对"出错回溯"成本
 *     敏感，宁可稍慢也不要爆一片失败。
 *
 * 失败策略：
 *   - 单任务失败不中断整批（同 batchImageGen），收集到 failures 统一报
 *   - VideoProvider 内部已有有限重试（ping + task failed 分类），到这里抛出
 *     即真失败，无需额外重试
 */
import type { VideoClient } from './VideoProvider'
import { composeVisualPrompt } from './visualStylePresets'
import type { VisualStyle } from '../scenario/types'
import { runWithConcurrency, type BatchResult } from './batchImageGen'
import { DEFAULT_VIDEO_SIZE, type VideoSize } from './seedanceResolution'
import { VIDEO_BATCH_CONCURRENCY } from './concurrency'

export interface VideoBatchTask {
  sceneId: string
  prompt: string
  /** Image-to-video 起手帧 dataUrl；没有则纯 text-to-video */
  referenceImageDataUrl?: string
  /**
   * v4（2026-05-07）· 额外参考图序列（最多 9 张，含自动挑选的角色/场所/相邻 shot）。
   * 由 buildVideoReferenceSet 产出，传给 LocalSeedanceProvider 走 /api/video/generate。
   * 首帧会由 Provider 自动拼到数组头部 —— 这里**不要**重复塞 referenceImageDataUrl。
   */
  referenceImageUrls?: string[]
  /** 该场景时长（秒）—— 用 scenario.durationMs/1000 */
  durationSec: number
  /**
   * 视频分辨率档位，默认 `1080p`。
   * 合法值见 `seedanceResolution.VideoSize`（含 1080p/720p/480p × 方向）。
   * I2V 场景（referenceImageDataUrl 非空）1080p 会被 Provider 自动降级到 720p。
   */
  size?: VideoSize
}

export interface VideoBatchSuccess {
  sceneId: string
  url: string
  taskId: string
  latencyMs: number
  durationSec: number
}

export async function batchGenerateVideos(args: {
  tasks: VideoBatchTask[]
  client: VideoClient
  concurrency?: number
  visualStyle?: VisualStyle
  onProgress?: (done: number, total: number) => void
  onPersist?: (success: VideoBatchSuccess) => Promise<void> | void
  /** 单任务进度（异步轮询的消息）—— 用 sceneId 区分是哪个场景 */
  onTaskMessage?: (sceneId: string, message: string, elapsedMs: number) => void
  /** v3.8 · 暂停信号；传入后 abort 即停止派发新 Seedance 任务（已在飞的轮询继续跑） */
  signal?: AbortSignal
}): Promise<BatchResult<VideoBatchSuccess, VideoBatchTask>> {
  const concurrency = args.concurrency ?? VIDEO_BATCH_CONCURRENCY
  return runWithConcurrency(
    args.tasks,
    async (task) => {
      const t0 = performance.now()
      const out = await args.client.generate({
        prompt: composeVisualPrompt(task.prompt, args.visualStyle),
        referenceImageDataUrl: task.referenceImageDataUrl,
        referenceImageUrls: task.referenceImageUrls,
        durationSec: task.durationSec,
        size: task.size ?? DEFAULT_VIDEO_SIZE,
        // 写实风格才在上传层打码（透传给 maskSeedanceContentInput 的 gate）
        visualStyle: args.visualStyle,
        onProgress: (msg, elapsed) =>
          args.onTaskMessage?.(task.sceneId, msg, elapsed),
      })
      const success: VideoBatchSuccess = {
        sceneId: task.sceneId,
        url: out.url,
        taskId: out.taskId,
        latencyMs: Math.round(performance.now() - t0),
        durationSec: out.durationSec,
      }
      await args.onPersist?.(success)
      return success
    },
    { concurrency, onProgress: args.onProgress, signal: args.signal },
  )
}
