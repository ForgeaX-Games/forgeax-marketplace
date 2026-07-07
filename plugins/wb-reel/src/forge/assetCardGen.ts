import type { ImageClient, ImageReference } from '../llm/config/types'
import type { VisualStyle, FilmLook, VideoConfig } from '../scenario/types'
import { useMediaStore } from '../media/mediaStore'
import { blobToDataUrl } from '../media/assetStore'
import { useSettingsStore } from '../scenario/settingsStore'
import { composeVisualPrompt } from '../llm/config/visualStylePresets'
import { createVideoProvider } from '../llm'
import { isVideoTaskProvider, type VideoRequest } from '../llm/providers/VideoProvider'
import { useVideoTaskStore, type VideoTaskStatus } from '../llm/pipeline/videoTaskStore'
import { DEFAULT_VIDEO_SIZE } from '../llm/refsets/seedanceResolution'
import { getTtsClient } from '../llm/providers/TTSProvider'
import type { CardKind } from './assetCards'
import type { GenRequestRef, GenRequestSnapshot } from './generationQueueStore'

/** 生成产物的媒体大类。 */
export type AssetMediaKind = 'image' | 'video' | 'audio'

/**
 * 一次生成的**自描述元信息** —— 让编排器/归档无需回读任何 store 就能知道
 * 「产出了什么、用了什么模型/时长」。刻意精简，详细参数看 request.params。
 */
export interface AssetGenMeta {
  kind: AssetMediaKind
  /** provider/模型名（如已知） */
  model?: string
  /** 产物 MIME（video/audio 已知；image 由 ingest 侧推断，通常省略） */
  mimeType?: string
  /** 视频时长秒（仅 video） */
  durationSec?: number
}

/**
 * 生成原语的中立返回 —— 影游(编排器)据此归档/回写，生成层不再替它做决定。
 *
 * request 与 onRequest 回调**同源**：onRequest 供队列在「完成前」实时展示；返回值里
 * 再带一份，方便**直接 await** 的调用方（如手点卡片）拿到就归档，省去外部 let 捕获。
 */
export interface AssetGenResult {
  /** 已 ingest 进 mediaStore 的媒体候选 id */
  mediaId: string
  meta: AssetGenMeta
  request?: GenRequestSnapshot
}

/** 卡片类型 → asset.meta.promptKind。
 *  刻意用 'card' 而非 'scene'，避免被 sceneImageCache 当成节点主画面自动采用
 *  （尊重 gen_only：卡片只生成候选，正式素材靠手动「采用」）。 */
export function cardPromptKind(_kind: CardKind): string {
  return 'card'
}

/**
 * 生成一张图像候选 —— 组合全局美术风格前缀 → 生图（可带锚点参考图）→ ingest 进
 * mediaStore（带 cardTag，落 assetStore）。返回 mediaId（失败抛错）。
 *
 * referenceImages 非空时走 provider 的图生图端点（多参考图一致性锚点）。
 */
export async function generateCardImage(opts: {
  sceneId: string
  kind: CardKind
  tag: string
  title: string
  prompt: string
  client: ImageClient
  referenceImages?: ImageReference[]
  /**
   * 全局美术风格前缀 —— 由编排器/调用方从 scenario.visualStyle 显式传入。
   * 生成层不再自己读 scenarioStore（charter Pipeline-Isolation：生成原语保持无状态）。
   */
  visualStyle?: VisualStyle
  /** 全局电影美学调色前缀 —— 与 visualStyle 叠加注入；由调用方从 scenario.filmLook 传入。 */
  filmLook?: FilmLook
  /**
   * 资产归属的 game/scenario id —— 由编排器/调用方显式传入，透传给 mediaStore ingest，
   * 决定素材记到哪个 game（charter 解耦：生成层与 mediaStore 都不隐式读 scenarioStore）。
   */
  scenarioId?: string
  /**
   * 请求快照回调 —— 发图前调用一次，把「发给图像模型的东西」(最终提示词 + 参数 +
   * 上传的参考图) 交给调用方记录到队列 job.request，成功失败都可在素材库/队列回看。
   */
  onRequest?: (req: GenRequestSnapshot) => void
}): Promise<AssetGenResult> {
  const finalPrompt = composeVisualPrompt(opts.prompt, opts.visualStyle, opts.filmLook)
  const refs = opts.referenceImages?.length ? opts.referenceImages : undefined

  // ── 请求快照：先记下「发了什么」，再发请求；onRequest(队列实时) 与返回值(await 方) 各得一份 ─
  const reqRefs: GenRequestRef[] = (refs ?? []).map((r) => ({
    role: 'reference_image',
    url: r.dataUrl,
    label: r.label ?? '参考图',
  }))
  const request: GenRequestSnapshot = {
    endpoint: `${opts.client.getModel?.() ?? opts.client.getProviderName?.() ?? '图像'} · ${refs ? '图生图(参考锚点)' : '文生图'}`,
    prompt: finalPrompt,
    params: {
      size: '1024x1024',
      provider: opts.client.getProviderName?.() ?? '(未知)',
      model: opts.client.getModel?.() ?? '(默认)',
      mode: refs ? '图生图' : '文生图',
      refs: refs?.length ?? 0,
    },
    refs: reqRefs,
    at: Date.now(),
  }
  opts.onRequest?.(request)

  const out = await opts.client.generate({
    prompt: finalPrompt,
    size: '1024x1024',
    ...(refs ? { referenceImages: refs } : {}),
  })
  const mediaId = useMediaStore.getState().ingestDataUrl(out.dataUrl, {
    sceneId: opts.sceneId,
    promptKind: cardPromptKind(opts.kind),
    tags: [opts.tag],
    humanReadableName: opts.title,
    scenarioId: opts.scenarioId,
  })
  return { mediaId, meta: { kind: 'image', model: opts.client.getModel?.() }, request }
}

/**
 * 生成一段视频候选 —— 多模态：首帧/尾帧 + 锚点参考图序列 + 运镜 prompt。
 *
 * 走可 resume 的 VideoTaskProvider（LocalSeedance/Seedance）时记 videoTaskStore，
 *   切 tab/刷新可被 resumeRunningVideoTasks 接盘；Mock 走 generate 直返。
 * 完成后 fetch 视频 → ingest 进 mediaStore（带 cardTag、kind=video）→ 返回 mediaId。
 *
 * apiKey/apiBase 永远来自 settingsStore（本机 localStorage），scenario 只贡献
 *   model/duration/size 等项目级字段 —— 与 PromptTabs.VideoPromptTab 同一安全约束。
 */
export async function generateCardVideo(opts: {
  sceneId: string
  tag: string
  title: string
  prompt: string
  /** 生成模式（官方互斥）：frames=首尾帧 / reference=多模态参考。不传由 provider 推断 */
  mode?: VideoRequest['mode']
  /** 分辨率档位（body.resolution）。不传回落 cfg.size 推导 */
  resolution?: VideoRequest['resolution']
  /** 比例（body.ratio）。不传回落 cfg.size 推导 */
  ratio?: VideoRequest['ratio']
  startFrameUrl?: string
  endFrameUrl?: string
  referenceImageUrls?: string[]
  /**
   * 与 referenceImageUrls 同序的「身份标签」（如「角色 · 林深」「场景 · 客厅」「道具 · 钥匙」）。
   * 仅用于请求快照展示，让作者在卡片/队列里看清「这次用了哪些角色/场景/道具锚点」。
   */
  referenceImageLabels?: string[]
  /** 与 referenceImageUrls 同序的 mediaId（已知时传，可含 undefined 占位）：刷新后据此重解析缩略图。 */
  referenceImageMediaIds?: (string | undefined)[]
  /** 首帧 mediaId（已知时传，用于快照刷新后重解析缩略图）。 */
  startFrameMediaId?: string
  /** 尾帧 mediaId（已知时传）。 */
  endFrameMediaId?: string
  /** 运镜/动作参考视频 URL（Seedance reference_video role） */
  referenceVideoUrl?: string
  /** BGM/氛围参考音频 URL（Seedance reference_audio role） */
  referenceAudioUrl?: string
  /** 让 Seedance 直接产出带音轨的视频（body.generate_audio） */
  generateAudio?: boolean
  /**
   * 全局视觉风格 —— 透传给 VideoRequest.visualStyle，仅作上传层人脸打码 gate
   * （写实/缺省才打码）。不传时 provider 无从判断，写实角色的合规打码不会触发。
   */
  visualStyle?: VideoRequest['visualStyle']
  durationSec?: number
  /**
   * 项目级视频参数（model/duration/size 等）—— 由编排器/调用方从 scenario.videoConfig
   * 显式传入，覆盖 settingsStore 默认；apiKey/apiBase 仍只来自 settingsStore（本机）。
   * 生成层不再自己读 scenarioStore（charter Pipeline-Isolation）。
   */
  scenarioVideoConfig?: VideoConfig
  /**
   * 资产归属的 game/scenario id —— 由编排器/调用方显式传入，透传给 mediaStore ingest。
   */
  scenarioId?: string
  onStage?: (stage: string) => void
  /**
   * 请求快照回调 —— 在真正发起视频请求前调用一次，把「发给模型的东西」
   * （prompt + 参数 + 上传的参考素材）交给调用方记录（如写进队列 job.request）。
   * 成功失败都已记录，便于在队列里一键回看排查。
   */
  onRequest?: (req: GenRequestSnapshot) => void
}): Promise<AssetGenResult> {
  const settings = useSettingsStore.getState().videoConfig
  const cfg = { ...settings, ...(opts.scenarioVideoConfig ?? {}) }
  const provider = createVideoProvider(cfg)

  const req: VideoRequest = {
    prompt: opts.prompt,
    mode: opts.mode,
    resolution: opts.resolution,
    ratio: opts.ratio,
    startFrameImageUrl: opts.startFrameUrl,
    endFrameImageUrl: opts.endFrameUrl,
    referenceImageUrls:
      opts.referenceImageUrls && opts.referenceImageUrls.length > 0
        ? opts.referenceImageUrls
        : undefined,
    referenceVideoUrl: opts.referenceVideoUrl,
    referenceAudioUrl: opts.referenceAudioUrl,
    generateAudio: opts.generateAudio,
    visualStyle: opts.visualStyle,
    durationSec: opts.durationSec ?? cfg.durationSec ?? 5,
    size: cfg.size ?? DEFAULT_VIDEO_SIZE,
  }

  // ── 请求快照：onRequest(队列实时展示) 与返回值(await 方归档) 各得一份，成功失败都留底 ─
  const snapRefs: GenRequestRef[] = []
  if (req.startFrameImageUrl)
    snapRefs.push({
      role: 'first_frame',
      url: req.startFrameImageUrl,
      label: '首帧',
      mediaId: opts.startFrameMediaId,
    })
  if (req.endFrameImageUrl)
    snapRefs.push({
      role: 'last_frame',
      url: req.endFrameImageUrl,
      label: '尾帧',
      mediaId: opts.endFrameMediaId,
    })
  ;(req.referenceImageUrls ?? []).forEach((u, i) =>
    snapRefs.push({
      role: 'reference_image',
      url: u,
      label: opts.referenceImageLabels?.[i] ?? '参考图',
      mediaId: opts.referenceImageMediaIds?.[i],
    }),
  )
  if (req.referenceVideoUrl)
    snapRefs.push({ role: 'reference_video', url: req.referenceVideoUrl, label: '运镜参考视频' })
  if (req.referenceAudioUrl)
    snapRefs.push({ role: 'reference_audio', url: req.referenceAudioUrl, label: '音色/氛围参考音频' })
  const snapParams: Record<string, string | number | boolean> = {
    mode: req.mode ?? 'auto',
    ratio: req.ratio ?? '(默认)',
    resolution: req.resolution ?? '(默认)',
    seconds: req.durationSec ?? 5,
    generateAudio: Boolean(req.generateAudio),
  }
  if (cfg.model) snapParams.model = cfg.model
  if (req.size) snapParams.size = req.size
  const request: GenRequestSnapshot = {
    endpoint: `${cfg.model ?? 'Seedance'} · ${req.mode === 'frames' ? '首尾帧' : '参考图'}图生视频`,
    prompt: req.prompt,
    params: snapParams,
    refs: snapRefs,
    at: Date.now(),
  }
  opts.onRequest?.(request)

  let videoUrl: string | undefined
  if (isVideoTaskProvider(provider)) {
    const created = await provider.createTask(req)
    const taskId = created.taskId
    useVideoTaskStore.getState().upsert({
      taskId,
      remoteTaskId: created.remoteTaskId,
      sceneId: opts.sceneId,
      status: 'generating',
      createdAt: Date.now(),
      lastMessage: '已提交，排队中',
      providerKind: provider.getProviderKind(),
    })
    const result = await provider.pollTask(taskId, {
      onUpdate: (t) => {
        const stage = `${t.status}${t.api_status ? ` · ${t.api_status}` : ''}`
        useVideoTaskStore.getState().patch(taskId, {
          status: t.status as VideoTaskStatus,
          apiStatus: t.api_status,
          lastMessage: stage,
        })
        opts.onStage?.(stage)
      },
    })
    if (result.status !== 'completed' || !result.videoUrl) {
      useVideoTaskStore.getState().patch(taskId, {
        status: result.status,
        error: result.error,
        lastMessage: result.error ?? result.status,
      })
      throw new Error(`视频任务 ${result.status} · ${result.error ?? '(无详情)'}`)
    }
    useVideoTaskStore.getState().patch(taskId, {
      status: 'completed',
      videoUrl: result.videoUrl,
      ingested: true,
      lastMessage: '完成',
    })
    videoUrl = result.videoUrl
  } else {
    const out = await provider.generate({
      ...req,
      onProgress: (msg) => opts.onStage?.(msg),
    })
    videoUrl = out.url
  }

  if (!videoUrl) throw new Error('视频生成未返回 URL')
  const resp = await fetch(videoUrl)
  const blob = await resp.blob()
  const dataUrl = await blobToDataUrl(blob)
  const mimeType = blob.type || 'video/mp4'
  const mediaId = useMediaStore.getState().ingestDataUrl(dataUrl, {
    sceneId: opts.sceneId,
    promptKind: 'card',
    tags: [opts.tag],
    humanReadableName: opts.title,
    mimeType,
    scenarioId: opts.scenarioId,
  })
  return {
    mediaId,
    meta: { kind: 'video', model: cfg.model, mimeType, durationSec: req.durationSec },
    request,
  }
}

/**
 * 生成一段配音/音色候选 —— TTS 合成（音色 = voiceType）→ ingest 进 mediaStore
 *   （mimeType=audio/mpeg，带 cardTag）。返回 mediaId（失败抛错）。
 *
 * voiceType 来自：角色已锚定音色(characterVoiceAnchor) 或卡内选的预设音色。
 * apiKey/appId 走 build-time 注入（getTtsClient），无 key 时返回静音占位（mock）。
 */
export async function generateCardAudio(opts: {
  sceneId: string
  tag: string
  title: string
  text: string
  voiceType: string
  speedRatio?: number
  /** 资产归属的 game/scenario id —— 由编排器/调用方显式传入，透传给 mediaStore ingest。 */
  scenarioId?: string
}): Promise<AssetGenResult> {
  const tts = getTtsClient()
  const out = await tts.synth({
    text: opts.text,
    voiceType: opts.voiceType,
    speedRatio: opts.speedRatio,
    label: opts.title,
  })
  const mediaId = useMediaStore.getState().ingestDataUrl(out.dataUrl, {
    sceneId: opts.sceneId,
    promptKind: 'card',
    tags: [opts.tag],
    humanReadableName: opts.title,
    mimeType: out.mimeType,
    scenarioId: opts.scenarioId,
  })
  return { mediaId, meta: { kind: 'audio', mimeType: out.mimeType } }
}

/** 并发池：limit 个一批跑 tasks，吞掉单个失败（错误由各 task 内部处理）。 */
export async function runPool(
  tasks: (() => Promise<void>)[],
  limit = 3,
): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++
      const task = tasks[idx]
      if (!task) break
      try {
        await task()
      } catch {
        /* 单卡失败不影响其它 */
      }
    }
  })
  await Promise.all(workers)
}
