import type { Scene } from '../../scenario/types'
import type { SceneImageRecord } from '../../media/sceneImageCache'
import type { MediaEntry } from '../../media/mediaStore'

/**
 * computeNodeThumbnail —— 给剧情树节点算"该显示什么图 + 什么状态 + 是图还是视频"的纯函数。
 *
 * 历史坑：旧实现只看 sceneImageCache，所以：
 *   - 用 Forge 流水线生成的关键帧（只写 shot.keyframeMediaRef → mediaStore）
 *     在剧情树里一直 NO PREVIEW，作者以为"白干了"。
 *   - 批量生图的非-keyShot 同样看不见。
 *   - 单节点 regen 时节点没有任何"正在跑"的信号。
 *
 * 新策略（优先级）：
 *   1. cache.pending / error：**以 cache 状态为准**（生成中要立刻反馈），
 *      url 回退到已有 mediaStore 旧图当底图
 *   2. cache.ready：直接用 cache.dataUrl（它一定是生图结果 → 'image' 类型）
 *   3. cache 无：按 scene.media.ref → keyShot.keyframeMediaRef →
 *      shots[0].keyframeMediaRef 顺序查 mediaStore
 *   4. 都无：empty
 *
 * mediaKind 语义：
 *   - 'image'：SceneNode 用 <img> 渲染
 *   - 'video'：SceneNode 用 <video muted preload=metadata> 渲染（静默抓首帧，
 *              不 autoplay、不出声）—— 修 "VIDEO 场景被 <img src=blob:mp4> 渲染
 *              导致剧情树 NO PREVIEW" 的 bug
 *   - cache.ready 永远是 image（GPT-Image-2 / Gemini 只产静图）
 *   - mimeType 不明或缺失时保守当 image，交给 <img> 处理（最差显示 broken）
 */
export type ThumbnailStatus = 'ready' | 'pending' | 'error' | 'empty'
export type ThumbnailMediaKind = 'image' | 'video'

export interface NodeThumbnail {
  url: string | undefined
  status: ThumbnailStatus
  mediaKind: ThumbnailMediaKind
  /**
   * 视频节点的静态封面 URL —— 仅在 mediaKind==='video' 且存在首镜关键帧静图时填充。
   *
   * 用途（剧情树性能优化）：
   *   - 预览态（鼠标未 hover）：SceneNode 显示这张静图，省去 <video> 的解码/网络开销
   *   - hover 态：再切换到 <video> 实时播放
   *
   * 选取顺序（都要求是 image mime，指向视频的 ref 不作封面）：
   *   1. keyShot.keyframeMediaRef（作者钦定的代表镜）
   *   2. shots[0].keyframeMediaRef（第一镜兜底）
   *
   * 没有可用静图时保持 undefined —— SceneNode 自己会回退到 <video preload=metadata> 抓首帧。
   */
  posterUrl?: string
}

export function computeNodeThumbnail(
  scene: Scene,
  cache: SceneImageRecord | undefined,
  mediaEntries: Record<string, MediaEntry>,
): NodeThumbnail {
  const fallback = pickMediaFallback(scene, mediaEntries)

  if (cache?.status === 'pending') {
    return {
      url: fallback?.url,
      status: 'pending',
      mediaKind: fallback?.mediaKind ?? 'image',
    }
  }
  if (cache?.status === 'error') {
    return {
      url: fallback?.url,
      status: 'error',
      mediaKind: fallback?.mediaKind ?? 'image',
    }
  }
  if (cache?.status === 'ready') {
    // sceneImageCache 的产出一定是静图（GPT-Image-2 / Gemini / 手动生图）
    return { url: cache.dataUrl, status: 'ready', mediaKind: 'image' }
  }
  if (fallback) {
    const base: NodeThumbnail = {
      url: fallback.url,
      status: 'ready',
      mediaKind: fallback.mediaKind,
    }
    if (fallback.mediaKind === 'video') {
      const poster = pickVideoPoster(scene, mediaEntries)
      if (poster) base.posterUrl = poster
    }
    return base
  }
  return { url: undefined, status: 'empty', mediaKind: 'image' }
}

interface FallbackPick {
  url: string
  mediaKind: ThumbnailMediaKind
}

function pickMediaFallback(
  scene: Scene,
  mediaEntries: Record<string, MediaEntry>,
): FallbackPick | undefined {
  const candidateIds: string[] = []

  if (scene.media?.ref) candidateIds.push(scene.media.ref)

  const shots = scene.shots ?? []
  if (shots.length > 0) {
    const keyShotId = scene.keyShotId ?? shots[0]?.id
    const keyShot = shots.find((s) => s.id === keyShotId)
    if (keyShot?.keyframeMediaRef) candidateIds.push(keyShot.keyframeMediaRef)
    const first = shots[0]
    if (first?.keyframeMediaRef) candidateIds.push(first.keyframeMediaRef)
  }

  for (const id of candidateIds) {
    const e = mediaEntries[id]
    if (e?.url) {
      return { url: e.url, mediaKind: sniffKind(e.mimeType) }
    }
  }
  return undefined
}

function sniffKind(mimeType: string | undefined): ThumbnailMediaKind {
  if (typeof mimeType === 'string' && mimeType.startsWith('video/')) {
    return 'video'
  }
  return 'image'
}

/**
 * 给视频节点挑一张"静态封面"—— 必须是 image mime 的 mediaEntry，否则视为无封面。
 *
 * 为什么严格限制 image：如果关键帧 ref 意外指回另一段视频，拿来当 poster 反而
 * 没省出任何性能（<img> 加载视频 URL 会直接失败），还会让节点闪一次 broken-image。
 * 宁可无封面让 SceneNode 回退到 preload=metadata 抓首帧。
 */
function pickVideoPoster(
  scene: Scene,
  mediaEntries: Record<string, MediaEntry>,
): string | undefined {
  const shots = scene.shots ?? []
  if (shots.length === 0) return undefined

  const candidates: string[] = []
  const keyShotId = scene.keyShotId ?? shots[0]?.id
  const keyShot = shots.find((s) => s.id === keyShotId)
  if (keyShot?.keyframeMediaRef) candidates.push(keyShot.keyframeMediaRef)
  const first = shots[0]
  if (first?.keyframeMediaRef && first.keyframeMediaRef !== keyShot?.keyframeMediaRef) {
    candidates.push(first.keyframeMediaRef)
  }

  for (const id of candidates) {
    const e = mediaEntries[id]
    if (e?.url && sniffKind(e.mimeType) === 'image') return e.url
  }
  return undefined
}
