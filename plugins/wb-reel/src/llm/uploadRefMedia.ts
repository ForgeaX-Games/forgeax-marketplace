/**
 * `uploadRefMedia` —— 把作者拖进来的参考视频/音频转成一个本地可引用的 URL，
 * 后续 videoProvider 提交任务时带着它一起走。
 *
 * 2026-06 退役本机 Python Flask 后端（`/api/upload/media`）后：
 *   · **不再上传到任何后端**，直接 `URL.createObjectURL(file)` 生成 blob: URL；
 *   · 真正提交视频任务时，由 `HostGatewayVideoProvider.toDataUrl()` 现取现转
 *     base64，连同 prompt 一起 POST 到宿主 litellm 视频网关。
 *   · 体积/类型校验改在本层做（不再依赖服务端 config.py）。
 *
 * 仅浏览器环境可用（依赖 `URL.createObjectURL`）。
 */

/** 参考视频体积上限（UI 预判 + 本层硬校验）。 */
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024
/** 参考音频体积上限。 */
export const MAX_AUDIO_BYTES = 120 * 1024 * 1024

export type RefMediaKind = 'video' | 'audio'

export interface UploadRefMediaResult {
  kind: RefMediaKind
  /** 文件名（取自 File.name）。 */
  filename: string
  /** 本地 `blob:` 对象 URL —— 提交视频任务时由网关转 base64。 */
  url: string
  size: number
  /** 原始文件名。 */
  originalName: string
}

/**
 * 把一个参考视频/音频文件登记为本地可引用的 blob: URL。
 *
 * @param file File 对象
 * @param kind 'video' | 'audio' —— 用于挑选体积上限与 MIME 大类校验
 */
export async function uploadRefMedia(
  file: File,
  kind: RefMediaKind,
): Promise<UploadRefMediaResult> {
  const max = kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES
  if (file.size > max) {
    throw new Error(
      `[SIZE] ${kind} 超过上限 ${Math.round(max / (1024 * 1024))}MB` +
        `（本文件 ${Math.round(file.size / (1024 * 1024))}MB）`,
    )
  }
  // MIME 大类弱校验：防止把 .mp3 塞进视频槽（File.type 可能为空，空则放过）。
  const bigType = (file.type || '').split('/')[0]
  if (bigType && bigType !== kind) {
    throw new Error(`[EXPECT] 期望 ${kind}，实际是 ${file.type}`)
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('[ENV] 当前环境不支持 URL.createObjectURL')
  }
  const url = URL.createObjectURL(file)
  return {
    kind,
    filename: file.name,
    url,
    size: file.size,
    originalName: file.name,
  }
}
