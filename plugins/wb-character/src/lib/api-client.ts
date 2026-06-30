const API = '/__ce-api__'

/** Phase A4 — when running embedded inside forgeax-studio with the new
 *  host-sdk path enabled (FX_USE_IFRAME), prefer the typed host.tool.call
 *  RPC over the legacy /__ce-api__ HTTP shim. Falls back to fetch when
 *  - we're in standalone vite dev mode (no parent), or
 *  - the host returns ok:false (tool not registered there yet).
 *  Once Phase B6 wires a real ToolRegistry on the host, we can drop the
 *  fetch fallback entirely. */
async function tryHostTool<T>(toolId: string, args: unknown, timeoutMs = 30_000): Promise<T | null> {
  const w = window as typeof window & {
    __forgeaxHost?: {
      available: boolean
      tool: { call(toolId: string, args?: unknown, timeoutMs?: number): Promise<{ ok: boolean; result?: unknown; error?: string }> }
    }
  }
  const host = w.__forgeaxHost
  if (!host || !host.available) return null
  try {
    const r = await host.tool.call(toolId, args, timeoutMs)
    if (r.ok) return r.result as T
    return null
  } catch {
    return null
  }
}

/** Host-only tool call — no legacy /__ce-api__ fallback (wrong schema for 3D turnaround). */
async function callHostTool<T>(toolId: string, args: unknown, timeoutMs: number): Promise<T> {
  const w = window as typeof window & {
    __forgeaxHost?: {
      available: boolean
      tool: { call(toolId: string, args?: unknown, timeoutMs?: number): Promise<{ ok: boolean; result?: unknown; error?: string }> }
    }
  }
  const host = w.__forgeaxHost
  if (!host?.available) {
    throw new Error('host tool bridge unavailable — open wb-character inside Studio workbench')
  }
  const r = await host.tool.call(toolId, args, timeoutMs)
  if (r.ok) return r.result as T
  throw new Error(r.error ?? `host tool ${toolId} failed`)
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

/** Per-view asset from `character:generate-turnaround` (3D-ready orthographic views). */
export interface TurnaroundViewAsset {
  path: string
  url: string
}

export interface GenerateTurnaroundFor3DArgs {
  slug: string
  charId: string
  prompt?: string
  style?: string
  /** Reference portrait (base64, with or without data: prefix). Bypasses disk lookup when set. */
  refImageBase64?: string
  /** Preferred image vendor — azure-gpt-image for gpt-image-2 turnaround. */
  model?: 'seedream' | 'nano-banana' | 'azure-gpt-image'
}

export interface GenerateTurnaroundFor3DResult {
  charId: string
  slug: string
  views: Partial<Record<'front' | 'back' | 'left' | 'right', TurnaroundViewAsset>>
  manifestPath: string
  model: string
  costEstimate?: { usd: number; vendor: string }
}

/** Server generates up to 4 orthographic views sequentially (120s/view budget). */
const TURNAROUND_3D_HOST_TIMEOUT_MS = 600_000

/** 3D-model-ready turnaround (slug/charId + saved portrait ref). Host bridge only. */
export function generateTurnaroundFor3D(args: GenerateTurnaroundFor3DArgs): Promise<GenerateTurnaroundFor3DResult> {
  return callHostTool('character:generate-turnaround', args, TURNAROUND_3D_HOST_TIMEOUT_MS)
}

export type Turnaround3DHandoffViews = {
  front: string
  back?: string
  left?: string
  right?: string
}

const TURNAROUND_3D_VIEW_KEYS = ['front', 'back', 'left', 'right'] as const
type Turnaround3DViewKey = (typeof TURNAROUND_3D_VIEW_KEYS)[number]

/** Same URL shape as server `assetUrl()` — browser-fetchable under Studio. */
export function characterAssetUrl(slug: string, charId: string, rel: string): string {
  const safeRel = rel.replace(/^\/+/, '')
  return `/api/wb/character/asset?path=${encodeURIComponent(
    `.forgeax/games/${slug}/characters/${charId}/${safeRel}`,
  )}`
}

/** Build handoff img src URLs from manifest-relative turnaround paths. */
export function relPathsToTurnaround3DHandoff(
  slug: string,
  charId: string,
  views: Partial<Record<Turnaround3DViewKey, string>>,
): Turnaround3DHandoffViews | null {
  const out: Partial<Turnaround3DHandoffViews> = {}
  for (const key of TURNAROUND_3D_VIEW_KEYS) {
    const rel = views[key]?.trim()
    if (!rel) continue
    out[key] = characterAssetUrl(slug, charId, rel)
  }
  return out.front ? (out as Turnaround3DHandoffViews) : null
}

async function assetExists(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD' })
    if (head.ok) return true
    if (head.status !== 405 && head.status !== 404) return false
  } catch { /* fall through to ranged GET */ }
  try {
    const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } })
    return probe.ok || probe.status === 206
  } catch {
    return false
  }
}

/** Probe standard turnaround/<view>.{jpg,jpeg,png} when manifest is stale. */
export async function probeTurnaround3DOnDisk(
  slug: string,
  charId: string,
): Promise<Turnaround3DHandoffViews | null> {
  const found: Partial<Record<Turnaround3DViewKey, string>> = {}
  for (const key of TURNAROUND_3D_VIEW_KEYS) {
    for (const ext of ['jpg', 'jpeg', 'png'] as const) {
      const url = characterAssetUrl(slug, charId, `turnaround/${key}.${ext}`)
      if (await assetExists(url)) {
        found[key] = url
        break
      }
    }
  }
  if (!found.front) return null
  return {
    front: found.front,
    back: found.back,
    left: found.left,
    right: found.right,
  }
}

interface CharacterManifestTurnaround {
  views?: Partial<Record<Turnaround3DViewKey, string>>
}

async function loadTurnaround3DFromManifest(
  slug: string,
  charId: string,
): Promise<Turnaround3DHandoffViews | null> {
  const res = await fetch(
    `/api/wb/character/characters/${encodeURIComponent(charId)}?slug=${encodeURIComponent(slug)}`,
  )
  if (!res.ok) return null
  const data = (await res.json()) as {
    manifest?: { pipelines?: { turnaround?: CharacterManifestTurnaround } }
  }
  const views = data.manifest?.pipelines?.turnaround?.views
  if (!views) return null
  return relPathsToTurnaround3DHandoff(slug, charId, views)
}

/** Hydrate 3D turnaround grid from manifest, falling back to on-disk probe. */
export async function loadTurnaround3DHandoffViews(
  slug: string,
  charId: string,
): Promise<Turnaround3DHandoffViews | null> {
  const fromManifest = await loadTurnaround3DFromManifest(slug, charId)
  if (fromManifest) return fromManifest
  return probeTurnaround3DOnDisk(slug, charId)
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
