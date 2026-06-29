/**
 * `buildSeedanceContent` —— 构造火山方舟 / Seedance 2.0 `/contents/generations/tasks`
 * 的 `content[]` 数组（多模态参考：首帧 / 尾帧 / 运镜参考 / BGM 参考）。
 *
 * v4（2026-05-07）重写：
 *   · Seedance 2.0 官方 `max_ref_images = 9`，不再写死 2 张首/尾帧。
 *   · 取消"data:URL 一律跳过 + warning"的降级逻辑。reel-studio 现在配套了
 *     本地视频服务（reel-studio/server/），前端把 dataURI 走 `/api/upload`
 *     转成 `/uploads/<fn>` 后由服务端自己再转 base64 喂 Seedance，所以
 *     这里只做"顺序 append + 数量上限校验"，不再做网络协议守卫。
 *   · 保留 `video_url / audio_url` 的占位，但实际上 reel-studio 短期内只跑
 *     图生视频，不接 reference_video / audio（作者已确认 P3 再做）。
 *
 * 依然是纯函数，便于单测；VideoProvider 只在 createTask 里调它一次。
 */

/**
 * 图片 part 的 role —— 与火山官方 `content[]` 对齐（2026 文档核对）：
 *   · first_frame / last_frame  —— 「首尾帧模式」，严格控制起止画面
 *   · reference_image           —— 「多模态参考模式」，角色/场景/道具一致性锚点
 *
 * 官方硬约束：**首尾帧模式与多模态参考模式互斥**，同一次请求只能用其一；
 * 且尾帧必须配首帧。本模块据 `mode` 强制分流，绝不混用。
 */
export type SeedanceImageRole = 'first_frame' | 'last_frame' | 'reference_image'

export type SeedanceContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url'
      image_url: { url: string }
      role: SeedanceImageRole
    }
  | {
      type: 'video_url'
      video_url: { url: string }
      role: 'reference_video'
    }
  | {
      type: 'audio_url'
      audio_url: { url: string }
      role: 'reference_audio'
    }

/** Seedance 2.0 官方限额 —— 与后端 server/config.py 的 MAX_REF_IMAGES 对齐 */
export const SEEDANCE_MAX_REF_IMAGES = 9
/** 多模态参考模式：参考视频 / 参考音频各最多 3 个（官方 2026 文档） */
export const SEEDANCE_MAX_REF_VIDEOS = 3
export const SEEDANCE_MAX_REF_AUDIOS = 3

/**
 * 生成模式（官方互斥语义）：
 *   · 'frames'    首尾帧模式 —— 仅 first_frame(必填) + last_frame(可选)
 *   · 'reference' 多模态参考模式 —— reference_image(≤9) + reference_video(≤3) + reference_audio(≤3)
 *
 * 缺省 = 'reference'（向后兼容老调用点：把 referenceImageUrls 当多模态参考图）。
 */
export type SeedanceMode = 'frames' | 'reference'

export interface BuildSeedanceContentInput {
  /** 最终拼进 text part 的提示词（调用方需自行 merge 原 prompt + 场景上下文） */
  composedText: string
  /**
   * 生成模式。决定图片走 first/last_frame 还是 reference_image，两者互斥。
   * 不传 = 'reference'（兼容历史）。
   */
  mode?: SeedanceMode
  /**
   * 首帧 URL —— 仅 `mode==='frames'` 生效（role=first_frame）。
   * 尾帧模式下必填；缺失则尾帧被丢弃并 warning。
   */
  firstFrameUrl?: string
  /** 尾帧 URL —— 仅 `mode==='frames'` 且 firstFrameUrl 存在时生效（role=last_frame）。 */
  lastFrameUrl?: string
  /**
   * 参考图序列 —— 仅 `mode!=='frames'` 生效，按顺序 append 为 role=reference_image。
   * 超过 `SEEDANCE_MAX_REF_IMAGES` 的元素会被截断。
   *
   * 允许的 URL 形式：
   *   · http/https://…          —— 公网可达，直通
   *   · data:image/…;base64,…   —— 经本地视频服务转发（见上面 doc）
   *   · /uploads/xxx            —— 本地视频服务落盘后的相对路径，后端自动解析
   *
   * 所有 URL 原样透传，不做格式校验；由 reel-studio/server/ 或上游 API 处理失败。
   */
  referenceImageUrls?: string[]
  /** 运镜参考视频 URL —— 仅多模态参考模式生效（reference_video role） */
  referenceVideoUrl?: string
  /** BGM 参考音频 URL —— 仅多模态参考模式生效（reference_audio role） */
  referenceAudioUrl?: string
}

export interface BuildSeedanceContentOutput {
  content: SeedanceContentPart[]
  /** 非致命提示（例如被截断 / 模式互斥裁剪）。致命错误直接抛 Error，由调用方 toast */
  warnings: string[]
}

function cleanUrls(urls: string[] | undefined): string[] {
  return (urls ?? []).filter(
    (u): u is string => typeof u === 'string' && u.trim().length > 0,
  )
}

export function buildSeedanceContent(
  input: BuildSeedanceContentInput,
): BuildSeedanceContentOutput {
  const warnings: string[] = []
  const content: SeedanceContentPart[] = [
    { type: 'text', text: input.composedText },
  ]

  // ── 首尾帧模式：first_frame(必) + last_frame(可选)，与参考模式互斥 ──
  if (input.mode === 'frames') {
    const first = input.firstFrameUrl?.trim()
    const last = input.lastFrameUrl?.trim()
    if (first) {
      content.push({
        type: 'image_url',
        image_url: { url: first },
        role: 'first_frame',
      })
      if (last) {
        content.push({
          type: 'image_url',
          image_url: { url: last },
          role: 'last_frame',
        })
      }
    } else if (last) {
      warnings.push('[Seedance] 尾帧必须配首帧；当前无首帧，已忽略尾帧。')
    }
    // 首尾帧模式下显式拒收多模态参考输入，避免官方互斥报错
    if (
      cleanUrls(input.referenceImageUrls).length > 0 ||
      input.referenceVideoUrl?.trim() ||
      input.referenceAudioUrl?.trim()
    ) {
      warnings.push(
        '[Seedance] 首尾帧模式与多模态参考互斥，已忽略本次的锚点参考图/参考视频/参考音频。',
      )
    }
    return { content, warnings }
  }

  // ── 多模态参考模式（默认）：reference_image(≤9) + reference_video(≤3) + reference_audio(≤3) ──
  const raw = cleanUrls(input.referenceImageUrls)
  const imgs = raw.slice(0, SEEDANCE_MAX_REF_IMAGES)
  if (raw.length > SEEDANCE_MAX_REF_IMAGES) {
    warnings.push(
      `[Seedance] 参考图数量 ${raw.length} 超过上限 ${SEEDANCE_MAX_REF_IMAGES}，已截断为前 ${SEEDANCE_MAX_REF_IMAGES} 张。`,
    )
  }
  for (const url of imgs) {
    content.push({
      type: 'image_url',
      image_url: { url: url.trim() },
      role: 'reference_image',
    })
  }

  const v = input.referenceVideoUrl?.trim()
  if (v) {
    content.push({
      type: 'video_url',
      video_url: { url: v },
      role: 'reference_video',
    })
  }

  const a = input.referenceAudioUrl?.trim()
  if (a) {
    content.push({
      type: 'audio_url',
      audio_url: { url: a },
      role: 'reference_audio',
    })
  }

  return { content, warnings }
}
