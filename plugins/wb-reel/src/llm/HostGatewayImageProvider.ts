import type { ImageClient, ImageRequest, ImageResult, ImageReference } from './types'

/**
 * HostGatewayImageProvider —— 把生图委托给宿主 forgeax-server 的图像网关
 * （`/__ce-api__/generate-image`），而不是浏览器直连 Azure。
 *
 * 为什么（作者 2026-06 · litellm 统一接入）：
 *   · 浏览器直连 Azure gpt-image-2 受单 deployment RPM（典型 6 RPM）+ 本地
 *     imageRateLimiter（rps≤1.5）双重限速 —— 互动影游要批量出几十张关键帧/
 *     素材时极慢。
 *   · 宿主 server 侧的 image-gateway 接 litellm（内置并发 100）+ 多厂商回落，
 *     把瓶颈从单 deployment 转移到代理侧；并发由宿主统一调度。
 *   · **安全**：apiKey 全部留在 server（.env 的 LITELLM_PROXY_KEY 等），
 *     浏览器只发同源 `/__ce-api__/*`，key 永不进前端 bundle、不进日志。
 *
 * 端点契约（宿主 ce-api-shim · 全部走 litellm）：
 *   POST /__ce-api__/reel-image
 *   body: { prompt, size?, referenceImagesB64?[] }
 *   resp: { success, imageBase64, mimeType, modelId } | { success:false, error }
 *
 * 锚点一致性：
 *   · 无参考图 → litellm /v1/images/generations（gpt-image-2 文生图）
 *   · ≥1 参考图 → litellm /v1/images/edits（gpt-image-2 多图编辑，保锚点一致）
 *
 * 固定 model='gpt-image-2'（尊重作者「固定图像只用 image2」约束），宿主侧 pin 死。
 */

interface GenerateImageResp {
  success?: boolean
  imageBase64?: string
  mimeType?: string
  modelId?: string
  error?: string
}

/** dataUrl / blob: / 相对资产 URL → 纯 base64（去 data 前缀）。在浏览器上下文解析。 */
async function toBase64(src: string): Promise<string> {
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',')
    return comma >= 0 ? src.slice(comma + 1) : ''
  }
  const resp = await fetch(src)
  if (!resp.ok) throw new Error(`[REF] fetch ${resp.status} ${resp.statusText}`)
  const blob = await resp.blob()
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

export class HostGatewayImageProvider implements ImageClient {
  private readonly base: string

  constructor(base = '/__ce-api__') {
    this.base = base.replace(/\/$/, '')
  }

  getModel(): string {
    return 'gpt-image-2@litellm-host'
  }
  getProviderName(): string {
    return 'HostGateway'
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const refs: ImageReference[] = []
    if (req.referenceImages) {
      for (const r of req.referenceImages) if (r?.dataUrl) refs.push(r)
    }
    if (req.referenceImageDataUrl && refs.length === 0) {
      refs.push({ dataUrl: req.referenceImageDataUrl })
    }

    const referenceImagesB64 = await Promise.all(refs.map((r) => toBase64(r.dataUrl)))

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      size: req.size ?? '1024x1024',
    }
    if (referenceImagesB64.length > 0) {
      body.referenceImagesB64 = referenceImagesB64.filter((b) => !!b)
    }

    const t0 = performance.now()
    const resp = await fetch(`${this.base}/reel-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const raw = await resp.text()
    if (!resp.ok) {
      throw new Error(`[HTTP ${resp.status}] host image gateway · ${raw.slice(0, 240)}`)
    }
    let data: GenerateImageResp
    try {
      data = JSON.parse(raw) as GenerateImageResp
    } catch {
      throw new Error(`[PARSE] host image gateway non-JSON · ${raw.slice(0, 200)}`)
    }
    if (!data.success || !data.imageBase64) {
      throw new Error(data.error || '宿主图像网关生成失败')
    }
    const mime = data.mimeType || 'image/png'
    return {
      base64: data.imageBase64,
      mimeType: mime,
      dataUrl: `data:${mime};base64,${data.imageBase64}`,
      prompt: req.prompt,
      latencyMs: Math.round(performance.now() - t0),
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t0 = performance.now()
    try {
      await this.generate({ prompt: '一个白色立方体，纯黑背景，极简，工作室灯光', size: '1024x1024' })
      return { ok: true, latencyMs: Math.round(performance.now() - t0) }
    } catch (e) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), error: (e as Error).message }
    }
  }
}

/**
 * 是否走宿主图像网关。
 *
 *   - 嵌入宿主（path 含 /plugins/wb-reel）→ 同源 /__ce-api__ 命中 forgeax-server → 默认开
 *   - localStorage `reel-studio.imageProvider` 显式覆盖：'host' 强制开 / 'direct' 强制关
 *   - 其余（独立 dev 无宿主）→ 关，走直连 GptImageProvider / Mock
 */
export function shouldUseHostImageGateway(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const override = window.localStorage.getItem('reel-studio.imageProvider')
    if (override === 'host') return true
    if (override === 'direct') return false
  } catch {
    /* localStorage 不可用时按路径判断 */
  }
  // 嵌入宿主有两种形态：① host serveStatic 在 /plugins/wb-reel 子路径下；
  // ② 独立插件 dev —— 宿主把 wb-reel iframe 到它自己的端口（:15175，路径 '/'）。
  // 形态②路径里没有 /plugins/wb-reel，但宿主 vite 仍把 /__ce-api__ 反代到
  // forgeax-server → litellm，所以「被 iframe 嵌入」即可默认走宿主网关
  // （key 全留 server）。只有真正独立打开（非 iframe）才回落到直连/Mock。
  if (window.location.pathname.includes('/plugins/wb-reel')) return true
  try {
    return window.self !== window.top
  } catch {
    // 跨源访问 window.top 抛错 = 必然被嵌在异源宿主里 → 走宿主网关
    return true
  }
}
