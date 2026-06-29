/**
 * faceMaskTool —— 「上传给视频模型(Seedance)前」的人脸打码接入点。
 *
 * 设计背景（2026-06）：
 *   · 角色立绘 / 三视图 / 关键帧 / 参考图等，**对作者展示的都是干净的写实真人图**
 *     （不再像旧版那样在生成提示词里强制画上像素马赛克）。
 *   · 但下游图生视频模型（Seedance / Kling 等）对「完整真人脸」审核严格，
 *     一张没打码的正脸会让整批 `safety_violations=[person]` / `moderation_blocked`。
 *   · 所以打码这一步从「生成期(提示词)」迁移到「上传期(本工具)」——
 *     **只有当一张图真的要被塞进 Seedance 请求时，才走一遍这里的打码工具。**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  接入现状（2026-06）
 * ─────────────────────────────────────────────────────────────────────────────
 *   applyFaceMask() 把图片转成 `data:` URL 后，POST 到宿主同源端点
 *   `/__ce-api__/face-mask`，期望返回打码后的 `data:` URL。
 *
 *   旧的本机 Python sidecar（YOLOv8 + OpenCV 马赛克）已移除——它依赖
 *   torch/opencv，不在工程允许的语言栈内，且仓内并无模型权重（长期处于透传）。
 *   因此该端点**当前默认透传**（返回 success:false → 这里降级为原图直传）。
 *
 *   要启用真打码：实现一个纯 TS 的打码服务（暴露 `POST /mask`），并给宿主
 *   forgeax-server 设 `FACE_MASK_SERVICE_URL` 指向它，ce-api-shim 会自动反代。
 *
 *   任何情况（未配置 / 不可用 / 调用失败）→ 一律**透传原图**，绝不阻断生成。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { BuildSeedanceContentInput } from './seedanceContent'
import type { VisualStyle } from '../scenario/types'

/**
 * 是否「写实真人」风格 —— 决定上传给视频模型前要不要走打码。
 * 只有 photoreal 视为写实；`undefined` 按默认风格（photoreal）也视为写实，
 * 保证老调用点（未串 visualStyle）仍保守打码，零回归。
 * 与 forgeImagePipeline.isRealisticVisualStyle 同义，这里内联以避免把
 * 重量级的 forgeImagePipeline 拖进各 VideoProvider 的 import 链。
 */
function isRealisticStyle(vs: VisualStyle | undefined): boolean {
  return vs === undefined || vs === 'photoreal'
}

/** 这张图在本次 Seedance 调用里的角色，便于打码工具按需做差异化处理（可选用）。 */
export interface FaceMaskContext {
  role?: 'first_frame' | 'last_frame' | 'reference_image'
  /** reference_image 在序列中的下标（仅多模态参考模式有意义） */
  index?: number
  /**
   * 打码模式：
   *   - 'half'（**默认**）：只在原图人脸框的一半（竖切，默认右半）打码 —— 既过审、又保留半张脸做身份锚点。
   *   - 'mosaic'：整张脸马赛克（旧行为）。
   */
  maskMode?: 'mosaic' | 'half'
  /** half 模式码哪半（默认右半）。 */
  halfSide?: 'left' | 'right'
}

/** 上传打码默认模式 —— 半脸（用户诉求：只打半张脸，保留另一半做锚点）。 */
const DEFAULT_MASK_MODE: 'mosaic' | 'half' = 'half'

/** 宿主同源代理端点（嵌入态同源；独立 dev 由 vite 反代到 forgeax-server）。 */
const FACE_MASK_ENDPOINT = '/__ce-api__/face-mask'

/**
 * 熔断：探测到打码服务不可用（未装/未起/报错）后，在该时间戳前不再发起请求，
 * 直接透传——避免对每张图都白等一次网络往返。服务恢复后会自动重试。
 */
let faceMaskColdUntil = 0
const FACE_MASK_COOLDOWN_MS = 30_000

/**
 * 把要上传给 Seedance 的图片过一遍人脸打码（YOLOv8 检测 + 全脸马赛克）。
 * 任何失败都**透传原图**，不抛错、不阻断上传。
 *
 * @param image 待上传图片（data: / blob: / https / 相对路径）
 * @param ctx   该图在本次 Seedance 调用里的角色信息（当前未用，预留差异化）
 * @returns     打码后的图片（data: URL）；不可用时为原图。
 */
export async function applyFaceMask(
  image: string,
  ctx: FaceMaskContext = {},
): Promise<string> {
  if (!image || !image.trim()) return image
  if (typeof fetch !== 'function') return image // 非浏览器环境：透传

  const now = Date.now()
  if (now < faceMaskColdUntil) return image // 冷却期内：直接透传

  // sidecar 只认 base64；远程/相对路径先转 data URL，转不成则透传。
  let dataUrl: string
  try {
    dataUrl = await toDataUrl(image)
  } catch {
    return image
  }
  if (!dataUrl.startsWith('data:')) return image

  const mode = ctx.maskMode ?? DEFAULT_MASK_MODE
  const halfSide = ctx.halfSide ?? 'right'

  try {
    const resp = await fetch(FACE_MASK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, mode, halfSide }),
    })
    if (!resp.ok) {
      faceMaskColdUntil = Date.now() + FACE_MASK_COOLDOWN_MS
      return image
    }
    const data = (await resp.json().catch(() => null)) as
      | { success?: boolean; image?: string }
      | null
    if (data && data.success === true && typeof data.image === 'string' && data.image) {
      return data.image // 打码后的 data URL（无脸时为原图回显，同样安全）
    }
    // success:false → 服务未就绪/未安装：进入冷却，透传。
    faceMaskColdUntil = Date.now() + FACE_MASK_COOLDOWN_MS
    return image
  } catch {
    faceMaskColdUntil = Date.now() + FACE_MASK_COOLDOWN_MS
    return image
  }
}

/**
 * 把任意来源的图片转成 `data:` URL（给打码工具取像素用）。
 *   · 已是 `data:` → 原样返回
 *   · 其它（blob: / https / 相对路径）→ fetch 后转 base64
 *   · 失败 → 原样返回（不阻断上传；交由上游/Seedance 自己报错）
 *
 * 仅浏览器环境可用（依赖 fetch / btoa）。
 */
export async function toDataUrl(src: string): Promise<string> {
  if (!src) return src
  if (src.startsWith('data:')) return src
  try {
    const resp = await fetch(src)
    if (!resp.ok) return src
    const blob = await resp.blob()
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
    const mime = blob.type || 'image/png'
    return `data:${mime};base64,${btoa(bin)}`
  } catch {
    return src
  }
}

/** 单图：过一遍打码工具。空串原样返回。 */
export async function maskImageForSeedance(
  url: string | undefined,
  ctx: FaceMaskContext = {},
): Promise<string | undefined> {
  if (!url || !url.trim()) return url
  return applyFaceMask(url, ctx)
}

/**
 * 把一次 Seedance 调用要上传的**所有图片**（首帧 / 尾帧 / 多模态参考图）
 * 统一过一遍打码工具，返回一个新的 contentInput（不可变，原对象不动）。
 *
 * 三个 VideoProvider（HostGateway / 直连 Seedance / Local）都在
 * `resolveSeedanceCall()` 之后、真正发请求之前调用本函数，即「上传给 Seedance
 * 的唯一入口」。文本 / 参考视频 / 参考音频不动。
 *
 * 风格 gate（作者诉求）：**只有写实风格（photoreal）才走打码**；非写实
 * （anime / cartoon / pixelart / watercolor / ink）直接透传整组图，连打码服务
 * 都不请求。`visualStyle` 缺省视为写实（保守、零回归）。
 */
export async function maskSeedanceContentInput(
  input: BuildSeedanceContentInput,
  opts: { visualStyle?: VisualStyle } = {},
): Promise<BuildSeedanceContentInput> {
  // 非写实风格：跳过整个打码流程（不误伤风格化画、也省一次网络往返）
  if (!isRealisticStyle(opts.visualStyle)) return input

  const out: BuildSeedanceContentInput = { ...input }

  if (input.firstFrameUrl) {
    out.firstFrameUrl = await maskImageForSeedance(input.firstFrameUrl, {
      role: 'first_frame',
    })
  }
  if (input.lastFrameUrl) {
    out.lastFrameUrl = await maskImageForSeedance(input.lastFrameUrl, {
      role: 'last_frame',
    })
  }
  if (input.referenceImageUrls && input.referenceImageUrls.length > 0) {
    out.referenceImageUrls = await Promise.all(
      input.referenceImageUrls.map((u, index) =>
        applyFaceMask(u, { role: 'reference_image', index }),
      ),
    )
  }

  return out
}
