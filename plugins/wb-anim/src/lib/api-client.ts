// @source wb-character/src/lib/api-client.ts
const API = '/__ce-api__'

/** Phase A4 — when running embedded inside forgeax-studio with the new
 *  host-sdk path enabled (FX_USE_IFRAME), prefer the typed host.tool.call
 *  RPC over the legacy /__ce-api__ HTTP shim. Falls back to fetch when
 *  - we're in standalone vite dev mode (no parent), or
 *  - the host returns ok:false (tool not registered there yet).
 *  Once Phase B6 wires a real ToolRegistry on the host, we can drop the
 *  fetch fallback entirely. */
async function tryHostTool<T>(toolId: string, args: unknown): Promise<T | null> {
  const w = window as typeof window & {
    __forgeaxHost?: {
      available: boolean
      tool: { call(toolId: string, args?: unknown, timeoutMs?: number): Promise<{ ok: boolean; result?: unknown; error?: string }> }
    }
  }
  const host = w.__forgeaxHost
  if (!host || !host.available) return null
  try {
    const r = await host.tool.call(toolId, args, 30_000)
    if (r.ok) return r.result as T
    return null
  } catch {
    return null
  }
}

async function post<T = any>(path: string, body: any, toolId?: string): Promise<T> {
  if (toolId) {
    const viaHost = await tryHostTool<T>(toolId, body)
    if (viaHost !== null) return viaHost
  }
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function get<T = any>(path: string, params?: Record<string, string>, toolId?: string): Promise<T> {
  if (toolId) {
    const viaHost = await tryHostTool<T>(toolId, params ?? {})
    if (viaHost !== null) return viaHost
  }
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  const res = await fetch(`${API}${path}${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

// ── Video (Kling) ───────────────────────────────────────────────────

export interface VideoGenerateParams {
  prompt?: string
  image_base64?: string
  end_frame_base64?: string
  mode?: 'std' | 'pro'
  aspect_ratio?: string
  duration?: string
}

export interface VideoGenerateResult {
  success: boolean
  task_id?: string
  task_status?: string
  error?: string
}

export function videoGenerate(params: VideoGenerateParams): Promise<VideoGenerateResult> {
  return post('/video-generate', params, 'character:generate-video')
}

export interface VideoQueryResult {
  success: boolean
  task_id?: string
  task_status?: string
  task_status_msg?: string
  videos?: Array<{ id: string; url: string; duration: string }>
  error?: string
}

export function videoQuery(taskId: string): Promise<VideoQueryResult> {
  return get('/video-query', { taskId }, 'character:video-query')
}

export function videoProxyUrl(url: string): string {
  return `${API}/video-proxy?url=${encodeURIComponent(url)}`
}

// ── Turnaround ──────────────────────────────────────────────────────

export interface TurnaroundResult {
  success: boolean
  views?: Record<'front' | 'side' | 'back' | 'idle', { base64: string; mime: string }>
  error?: string
}

export function characterTurnaround(characterBase64: string, prompt?: string, style?: string): Promise<TurnaroundResult> {
  return post('/character-turnaround', { characterBase64, prompt, style }, 'character:generate-turnaround')
}

export interface SingleViewResult {
  success: boolean
  view?: string
  viewResult?: { base64: string; mime: string }
  error?: string
}

export function regenerateSingleView(
  characterBase64: string,
  view: string,
  opts?: { prompt?: string; style?: string; extraDesc?: string },
): Promise<SingleViewResult> {
  return post(
    '/character-turnaround',
    { characterBase64, singleView: view, ...opts },
    'character:regenerate-view',
  )
}

// ── Analyze Ultimate ────────────────────────────────────────────────

export interface AnalyzeUltimateResult {
  success: boolean
  prompt?: string
  error?: string
}

export function analyzeUltimate(designImageBase64: string): Promise<AnalyzeUltimateResult> {
  return post('/analyze-ultimate', { design_image_base64: designImageBase64 }, 'character:analyze-design')
}

// ── Magic Prompt ────────────────────────────────────────────────────

export interface MagicPromptResult {
  success: boolean
  enhanced?: string
  error?: string
}

export function magicPrompt(prompt: string, locale = 'zh'): Promise<MagicPromptResult> {
  return post('/magic-prompt', { prompt, locale }, 'character:magic-prompt')
}

// ── Remove Background ────────────────────────────────────────────────

export interface RemoveBgResult {
  success: boolean
  image?: string
  error?: string
}

export function removeBg(imageBase64: string): Promise<RemoveBgResult> {
  return post('/remove-bg', { image: imageBase64 }, 'character:remove-bg')
}

export async function checkRemoveBgAvailable(): Promise<boolean> {
  try {
    const result = await get<{ available: boolean }>('/remove-bg')
    return result.available === true
  } catch {
    return false
  }
}

// ── Generate Image (existing) ───────────────────────────────────────

export interface GenerateImageResult {
  success: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
}

export function generateImage(prompt: string, opts?: {
  aspectRatio?: string
  inputImageBase64?: string
  inputImages?: Array<{ base64: string; mimeType?: string }>
  model?: string
}): Promise<GenerateImageResult> {
  return post('/generate-image', { prompt, ...opts }, 'character:generate-image')
}
