/**
 * generation/gateway-client —— 服务端（forgeax-server 进程内 · Node/Bun）调用宿主
 * litellm 网关 `/__ce-api__` 的瘦客户端。
 *
 * 端点契约对齐**宿主 studio ce-api-shim**（packages/cli/src/api/ce-api-shim.ts），
 * 而非 wb-reel 浏览器 provider 的 `/reel-*`（那套端点宿主 shim 并不提供，会 404）：
 *   · 文本  POST /chat            { system?,messages:[{role,content}],model?,maxTokens? }        → { success,text }
 *          POST /gemini-text     { system?,prompt,inputImages?:[{base64}],model? }（带图时走它） → { success,text }
 *   · 生图  POST /generate-image  { prompt,model?,role?,inputImages?:[{base64}] }                → { success,imageBase64,mimeType }
 *   · 视频  POST /generate-video  { prompt,seconds,size?,inputReferenceDataUrl?,mode,... }       → { success,taskId }
 *          GET  /video-status?taskId=                                                            → { success,status,videoUrl? }
 *
 * 差异：浏览器同源相对 URL + btoa/window；服务端必须**绝对 base**（getCeApiBase 读
 * ctx.env）+ Buffer。密钥红线不变：LITELLM_PROXY_KEY 全留 server，本客户端只发
 * 同机 `http://127.0.0.1:<port>/__ce-api__/*`。
 */
import { readFileSync } from 'node:fs'
import { mimeForPath } from '../asset-registry'

export interface GatewayCtx {
  env?: Record<string, string | undefined>
}

/** 宿主 forgeax-server litellm shim 根。FORGEAX_SERVER_URL 覆盖整根，或 FORGEAX_SERVER_PORT 覆盖端口（缺省 18900）。 */
export function getCeApiBase(ctx: GatewayCtx): string {
  const explicit = ctx.env?.FORGEAX_SERVER_URL
  if (explicit) return `${explicit.replace(/\/+$/, '')}/__ce-api__`
  const port = ctx.env?.FORGEAX_SERVER_PORT ?? '18900'
  return `http://127.0.0.1:${port}/__ce-api__`
}

/** 磁盘文件 → base64 data URL（服务端 Buffer；供图/视频参考图透传）。 */
export function fileToDataUrl(path: string): string {
  const bytes = readFileSync(path)
  const mime = mimeForPath(path)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** 磁盘文件 → 纯 base64（去 data 前缀；供 /reel-image referenceImagesB64）。 */
export function fileToBase64(path: string): string {
  return readFileSync(path).toString('base64')
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await resp.text()
  if (!resp.ok) throw new Error(`[HTTP ${resp.status}] ${url} · ${raw.slice(0, 240)}`)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`[PARSE] ${url} non-JSON · ${raw.slice(0, 200)}`)
  }
}

// ── 文本 ─────────────────────────────────────────────────────────────────────
export interface GenTextInput {
  system?: string
  user: string
  images?: { dataUrl: string }[]
  jsonMode?: boolean
  maxTokens?: number
  temperature?: number
}
interface ChatResp {
  success?: boolean
  text?: string
  error?: string
}

/** data URL → 纯 base64（gemini-text/generate-image 的 inputImages 收纯 base64）。 */
function dataUrlToB64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

export async function genText(ctx: GatewayCtx, input: GenTextInput): Promise<string> {
  const base = getCeApiBase(ctx)
  const images = input.images ?? []
  // 带图 → 宿主多模态文本端点 /gemini-text（收 inputImages）；纯文本 → /chat（收 messages）。
  // 注：宿主 shim 无 jsonMode/temperature 旋钮；JSON 输出由 prompt 内的 schema 指令保证。
  const data = images.length
    ? await postJson<ChatResp>(`${base}/gemini-text`, {
        system: input.system,
        prompt: input.user,
        inputImages: images.map((i) => ({ base64: dataUrlToB64(i.dataUrl) })),
      })
    : await postJson<ChatResp>(`${base}/chat`, {
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
        maxTokens: input.maxTokens,
      })
  if (!data.success || !data.text) throw new Error(data.error || '宿主文本网关生成失败')
  return data.text
}

// ── 生图 ─────────────────────────────────────────────────────────────────────
export interface GenImageInput {
  prompt: string
  size?: string
  /** 纯 base64（无 data 前缀）参考图。 */
  referenceImagesB64?: string[]
}
interface GenImageResp {
  success?: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
}
export interface GenImageResult {
  base64: string
  mime: string
}

export async function genImage(ctx: GatewayCtx, input: GenImageInput): Promise<GenImageResult> {
  const body: Record<string, unknown> = { prompt: input.prompt, size: input.size ?? '1024x1024' }
  const refs = (input.referenceImagesB64 ?? []).filter(Boolean)
  // 宿主 /generate-image 收 inputImages:[{base64}]（纯 base64）；单图也走 inputImages。
  if (refs.length) body.inputImages = refs.map((b64) => ({ base64: b64 }))
  const data = await postJson<GenImageResp>(`${getCeApiBase(ctx)}/generate-image`, body)
  if (!data.success || !data.imageBase64) throw new Error(data.error || '宿主图像网关生成失败')
  return { base64: data.imageBase64, mime: data.mimeType || 'image/png' }
}

// ── 视频 ─────────────────────────────────────────────────────────────────────
export type VideoRole = 'first_frame' | 'last_frame' | 'reference_image'
export interface VideoRoleImage {
  role: VideoRole
  /** data URL。 */
  url: string
}
export interface GenVideoInput {
  prompt: string
  seconds: number
  size?: string
  imageWithRoles?: VideoRoleImage[]
  generateAudio?: boolean
  watermark?: boolean
}
interface CreateVideoResp {
  success?: boolean
  taskId?: string
  error?: string
}
interface VideoStatusResp {
  success?: boolean
  status?: string
  videoUrl?: string
  error?: string
}

export async function createVideoTask(ctx: GatewayCtx, input: GenVideoInput): Promise<string> {
  const roles = input.imageWithRoles ?? []
  const frames = roles.some((r) => r.role === 'first_frame' || r.role === 'last_frame')
  const data = await postJson<CreateVideoResp>(`${getCeApiBase(ctx)}/generate-video`, {
    prompt: input.prompt,
    seconds: input.seconds,
    size: input.size,
    inputReferenceDataUrl: roles[0]?.url,
    generateAudio: input.generateAudio ?? false,
    mode: frames ? 'frames' : 'reference',
    resolution: '1080p',
    ratio: 'adaptive',
    imageWithRoles: roles.length ? roles : undefined,
    watermark: input.watermark ?? false,
  })
  if (!data.success || !data.taskId) throw new Error(data.error || '宿主视频网关创建任务失败')
  return data.taskId
}

export interface PollOpts {
  pollIntervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  onStatus?: (status: string) => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 轮询到 completed，返回 videoUrl（网关同源 URL）。失败/超时抛错。 */
export async function pollVideoTask(ctx: GatewayCtx, taskId: string, opts: PollOpts = {}): Promise<string> {
  const base = getCeApiBase(ctx)
  const interval = opts.pollIntervalMs ?? 5000
  const timeout = opts.timeoutMs ?? 10 * 60 * 1000
  const t0 = Date.now()
  let consecutiveFail = 0
  const MAX_CONSEC_FAIL = 8
  while (true) {
    if (opts.signal?.aborted) throw new Error('[ABORT] poll aborted')
    if (Date.now() - t0 > timeout) throw new Error(`[TIMEOUT] video task > ${timeout}ms`)
    await sleep(interval)
    let data: VideoStatusResp
    try {
      const resp = await fetch(`${base}/video-status?taskId=${encodeURIComponent(taskId)}`, { signal: opts.signal })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      data = (await resp.json()) as VideoStatusResp
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      if (++consecutiveFail >= MAX_CONSEC_FAIL) throw new Error(`[NET] video-status ${consecutiveFail}× · ${(e as Error).message}`)
      continue
    }
    consecutiveFail = 0
    if (!data.success) throw new Error(data.error || '视频状态查询失败')
    opts.onStatus?.(data.status ?? 'queued')
    if (data.status === 'completed' && data.videoUrl) return data.videoUrl
    if (data.status === 'failed') throw new Error(data.error || '视频任务失败')
  }
}

/** 从网关同源 URL 拉回二进制（把 mp4 落进 registry 用）。 */
export async function fetchBinary(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`[HTTP ${resp.status}] fetch binary · ${url}`)
  const buf = new Uint8Array(await resp.arrayBuffer())
  const mime = resp.headers.get('content-type') || 'video/mp4'
  return { bytes: buf, mime }
}

/** 创建 → 轮询 → 拉回二进制，一步到位。 */
export async function genVideoAndWait(
  ctx: GatewayCtx,
  input: GenVideoInput,
  opts: PollOpts = {},
): Promise<{ bytes: Uint8Array; mime: string; sourceUrl: string; taskId: string }> {
  const taskId = await createVideoTask(ctx, input)
  const sourceUrl = await pollVideoTask(ctx, taskId, opts)
  const { bytes, mime } = await fetchBinary(sourceUrl)
  return { bytes, mime, sourceUrl, taskId }
}
