// @source wb-character/server/api-plugin.ts
/**
 * wb-skill Vite server plugin: API proxy for skill-related AI services.
 * Runs server-side only -- keys never reach the browser.
 *
 * Routes (/__ce-api__/*):
 *   Workspace (D-4, migrated from wb-character):
 *     GET  /list-workspace-games           -- list game dirs in workspace
 *     GET  /workspace-game-manifest        -- read a character manifest from a game
 *     POST /merge-skills-to-workspace-game -- upsert skills[] into existing manifest
 *   Shared AI (copy from wb-character, per plan-strategy D-7):
 *     POST /generate-image                 -- Gemini image generation (+ Azure fallback)
 *     POST /gemini-text                    -- Gemini text generation
 *     POST /remove-bg                      -- background removal (local rembg + Gemini fallback)
 *     GET  /remove-bg                      -- check if local rembg service is available
 *
 * Credentials (from forgeax-studio .env -- see ./env-credentials.ts):
 *   Gemini: env GEMINI_API_KEY
 *   Azure gpt-image-2: env AZURE_GPT_IMAGE_KEY + AZURE_GPT_IMAGE_ENDPOINT
 *   LLM proxy: env LLM_PROXY_URL
 */

import type { Plugin } from 'vite'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  pickGeminiKeyFromEnv,
  pickAzureImageFromEnv,
  type AzureImageCredentials,
} from './env-credentials'
import { selectGeminiTextModel } from './select-gemini-text-model'

// ── Constants ──────────────────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-3-pro-image-preview'
const REMBG_URL = process.env.REMBG_URL || 'http://127.0.0.1:5001'
const getLlmProxyUrl = () => process.env.LLM_PROXY_URL || ''

// Workspace games directory (docker-compose mounts ./data/workspace/games to /workspace-games)
const WORKSPACE_GAMES_DIR = existsSync('/workspace-games')
  ? '/workspace-games'
  : resolve(process.cwd(), '../../data/workspace/games')

// ── Credential helpers ────────────────────────────────────────────────

let _cachedGeminiKey: string | null = null
function getGeminiApiKey(): string {
  if (_cachedGeminiKey !== null) return _cachedGeminiKey
  _cachedGeminiKey = pickGeminiKeyFromEnv(process.env as Record<string, string | undefined>)
  return _cachedGeminiKey
}

let _cachedAzureImage: AzureImageCredentials | null | undefined = undefined
function getAzureImageConfig(): AzureImageCredentials | null {
  if (_cachedAzureImage !== undefined) return _cachedAzureImage
  _cachedAzureImage = pickAzureImageFromEnv(process.env as Record<string, string | undefined>)
  return _cachedAzureImage
}

let _proxyDown = false

// ── HTTP helpers ──────────────────────────────────────────────────────

function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeout = 180_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const isSecure = u.protocol === 'https:'
    const fn = isSecure ? httpsRequest : httpRequest
    const req = fn({
      hostname: u.hostname,
      port: u.port || (isSecure ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      timeout,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    req.write(body)
    req.end()
  })
}

function httpsGet(
  url: string,
  headers: Record<string, string>,
  timeout = 15_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const isSecure = u.protocol === 'https:'
    const fn = isSecure ? httpsRequest : httpRequest
    const req = fn({
      hostname: u.hostname,
      port: u.port || (isSecure ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers,
      timeout,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    req.end()
  })
}

function parseBody(req: IncomingMessage, maxSize = 50 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    req.on('data', (c: Buffer) => {
      totalSize += c.length
      if (totalSize > maxSize) {
        req.destroy()
        reject(new Error(`Request body too large: ${(totalSize / 1024 / 1024).toFixed(1)}MB > ${maxSize / 1024 / 1024}MB limit`))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString()
        resolve(JSON.parse(raw))
      } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function jsonRes(res: ServerResponse, status: number, body: any): void {
  if (res.headersSent) {
    console.warn('[wb-skill jsonRes] Headers already sent, skipping duplicate response')
    return
  }
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
  })
  res.end(json)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ── Gemini proxy ──────────────────────────────────────────────────────

async function geminiPost(
  model: string,
  payload: string,
  timeout = 180_000,
): Promise<{ status: number; body: string }> {
  const proxyUrl = getLlmProxyUrl()
  const apiKey = getGeminiApiKey()
  if (!proxyUrl && !apiKey) throw new Error('LLM_PROXY_URL and Gemini API Key are both unconfigured')

  if (proxyUrl && !_proxyDown) {
    const url = `${proxyUrl.replace(/\/+$/, '')}/v1/gemini/generateContent/${model}`
    try {
      return await httpsPost(url, { 'Content-Type': 'application/json' }, payload, timeout)
    } catch (e: any) {
      if (apiKey && (e.message?.includes('EAI_AGAIN') || e.message?.includes('ECONNREFUSED') || e.message?.includes('ENOTFOUND'))) {
        console.warn(`[wb-skill Gemini] Proxy unreachable (${e.message}), switching to direct API`)
        _proxyDown = true
      } else {
        throw e
      }
    }
  }

  if (!apiKey) throw new Error('Gemini API Key unconfigured and proxy unavailable')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  return httpsPost(url, { 'Content-Type': 'application/json' }, payload, timeout)
}

// ── Generate Image ────────────────────────────────────────────────────

function sanitizePromptForGPT(raw: string): string {
  return raw
    .replace(/\(([^)]+):[\d.]+\)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function geminiGenerateImage(body: any): Promise<any> {
  const { prompt, aspectRatio, inputImageBase64, inputImages, model, imageSize } = body
  if (!prompt) return { success: false, error: 'Missing prompt' }

  const geminiModel = model || GEMINI_MODEL
  const contents: any[] = []
  const parts: any[] = []

  if (inputImageBase64) {
    let mime = 'image/png'
    if (inputImageBase64.startsWith('/9j/') || inputImageBase64.startsWith('/9J/')) mime = 'image/jpeg'
    parts.push({ inlineData: { mimeType: mime, data: inputImageBase64 } })
  }

  if (Array.isArray(inputImages)) {
    for (const img of inputImages) {
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.base64 } })
    }
  }

  parts.push({ text: prompt })
  contents.push({ role: 'user', parts })

  const genConfig: any = { responseModalities: ['IMAGE'], temperature: 1.0 }
  const imgCfg: any = {}
  if (aspectRatio) imgCfg.aspectRatio = aspectRatio
  if (imageSize) imgCfg.imageSize = imageSize
  if (Object.keys(imgCfg).length > 0) genConfig.imageConfig = imgCfg

  const payload = JSON.stringify({ contents, generationConfig: genConfig })
  console.log(`[wb-skill Gemini] Calling ${geminiModel}, aspectRatio: ${aspectRatio || 'NONE'}, prompt: ${prompt.slice(0, 80)}...`)

  const resp = await geminiPost(geminiModel, payload)

  if (resp.status !== 200) {
    let errMsg = `Gemini API error (${resp.status})`
    try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
    return { success: false, error: errMsg }
  }

  try {
    const data = JSON.parse(resp.body)
    const candidates = data.candidates || []
    for (const cand of candidates) {
      for (const part of (cand.content?.parts || [])) {
        if (part.inlineData?.data) {
          return { success: true, imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' }
        }
      }
    }
    return { success: false, error: 'No image in response' }
  } catch (e: any) {
    return { success: false, error: 'Response parse failed: ' + e.message }
  }
}

async function azureImageGenerate(body: any): Promise<any> {
  const creds = getAzureImageConfig()
  if (!creds) return { success: false, error: 'Azure OpenAI Image credentials not configured (set AZURE_GPT_IMAGE_KEY + AZURE_GPT_IMAGE_ENDPOINT in .env)' }

  const { prompt, aspectRatio, imageSize } = body
  if (!prompt) return { success: false, error: 'Missing prompt' }

  let size = '1024x1024'
  if (imageSize) {
    size = imageSize
  } else if (aspectRatio) {
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536',
      '3:4': '1024x1536', '4:3': '1536x1024', '3:2': '1536x1024', '2:3': '1024x1536',
    }
    size = sizeMap[aspectRatio] || '1024x1024'
  }

  const cleanPrompt = sanitizePromptForGPT(prompt)
  const payload = JSON.stringify({
    prompt: cleanPrompt, size, quality: body.quality || 'medium',
    output_format: 'png', output_compression: 100, n: 1,
  })

  const url = `${creds.apiBase}/openai/deployments/${creds.deployment}/images/generations?api-version=${creds.apiVersion}`
  console.log(`[wb-skill gpt-image-2] Calling ${creds.deployment}, size: ${size}, prompt: ${cleanPrompt.slice(0, 100)}...`)

  try {
    const resp = await httpsPost(url, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.apiKey}`,
    }, payload, 120_000)

    if (resp.status !== 200) {
      let errMsg = `gpt-image-2 API error (${resp.status})`
      try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
      console.error(`[wb-skill gpt-image-2] Error: ${errMsg}`)
      return { success: false, error: errMsg }
    }

    const data = JSON.parse(resp.body)
    const b64 = data.data?.[0]?.b64_json
    if (b64) return { success: true, imageBase64: b64, mimeType: 'image/png' }
    const revised = data.data?.[0]?.revised_prompt
    return { success: false, error: revised ? `No image returned (revised: ${revised})` : 'No image data' }
  } catch (e: any) {
    console.error(`[wb-skill gpt-image-2] Request failed: ${e.message}`)
    return { success: false, error: `gpt-image-2 request failed: ${e.message}` }
  }
}

async function azureImageEdit(body: any): Promise<any> {
  const creds = getAzureImageConfig()
  if (!creds) return { success: false, error: 'Azure OpenAI Image credentials not configured' }

  const { prompt, inputImageBase64, inputImages, aspectRatio, imageSize } = body
  if (!prompt) return { success: false, error: 'Missing prompt' }

  let imgB64: string | undefined = inputImageBase64
  if (!imgB64 && Array.isArray(inputImages) && inputImages.length > 0) {
    imgB64 = inputImages[0].base64
  }
  if (!imgB64) return { success: false, error: 'Missing input image' }

  let size = '1024x1024'
  if (imageSize) {
    size = imageSize
  } else if (aspectRatio) {
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536',
      '3:4': '1024x1536', '4:3': '1536x1024', '3:2': '1536x1024', '2:3': '1024x1536',
    }
    size = sizeMap[aspectRatio] || '1024x1024'
  }

  const cleanPrompt = sanitizePromptForGPT(prompt)
  const imgBuf = Buffer.from(imgB64, 'base64')
  const boundary = `----FormBoundary${Date.now().toString(36)}`

  const fields: Array<{ name: string; value: string }> = [
    { name: 'prompt', value: cleanPrompt },
    { name: 'size', value: size },
    { name: 'quality', value: 'high' },
    { name: 'n', value: '1' },
  ]

  const parts: Buffer[] = []
  for (const f of fields) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`
    ))
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="input.png"\r\nContent-Type: image/png\r\n\r\n`
  ))
  parts.push(imgBuf)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  const multipartBody = Buffer.concat(parts)
  const url = `${creds.apiBase}/openai/deployments/${creds.deployment}/images/edits?api-version=${creds.apiVersion}`
  console.log(`[wb-skill gpt-image-2 edit] size: ${size}, img: ${Math.round(imgBuf.length / 1024)}KB, prompt: ${prompt.slice(0, 80)}...`)

  return new Promise((resolve) => {
    const parsed = new URL(url)
    const req = httpsRequest({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
      },
      timeout: 120_000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const respBody = Buffer.concat(chunks).toString('utf-8')
        if (res.statusCode !== 200) {
          let errMsg = `gpt-image-2 edit error (${res.statusCode})`
          try { errMsg = JSON.parse(respBody).error?.message || errMsg } catch {}
          console.error(`[wb-skill gpt-image-2 edit] Error: ${errMsg}`)
          resolve({ success: false, error: errMsg })
          return
        }
        try {
          const data = JSON.parse(respBody)
          const b64 = data.data?.[0]?.b64_json
          if (b64) resolve({ success: true, imageBase64: b64, mimeType: 'image/png' })
          else resolve({ success: false, error: 'No image data returned' })
        } catch (e: any) {
          resolve({ success: false, error: 'Response parse failed: ' + e.message })
        }
      })
    })
    req.on('error', (e: any) => {
      console.error(`[wb-skill gpt-image-2 edit] Request failed: ${e.message}`)
      resolve({ success: false, error: `Request failed: ${e.message}` })
    })
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Request timeout (120s)' }) })
    req.write(multipartBody)
    req.end()
  })
}

// ── Gemini Text ───────────────────────────────────────────────────────

async function geminiGenerateText(body: any): Promise<any> {
  const { prompt, inputImages, model } = body
  if (!prompt) return { success: false, error: 'Missing prompt' }

  const geminiModel = selectGeminiTextModel('analyze-image', {
    explicit: model,
    env: process.env,
  })

  const parts: any[] = []

  if (Array.isArray(inputImages)) {
    for (const img of inputImages) {
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.base64 } })
    }
  }
  parts.push({ text: prompt })

  const payload = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT'],
      temperature: 1.0,
      maxOutputTokens: 4096,
    },
  })

  console.log(`[wb-skill Gemini Text] Calling ${geminiModel}, prompt: ${prompt.slice(0, 80)}..., images: ${inputImages?.length || 0}`)

  const resp = await geminiPost(geminiModel, payload)

  if (resp.status !== 200) {
    let errMsg = `Gemini API error (${resp.status})`
    try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
    return { success: false, error: errMsg }
  }

  try {
    const data = JSON.parse(resp.body)
    const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''
    if (!text) return { success: false, error: 'No text generated' }
    return { success: true, text }
  } catch (e: any) {
    return { success: false, error: 'Response parse failed: ' + e.message }
  }
}

// ── Remove Background ─────────────────────────────────────────────────

async function checkRemoveBgAvailable(): Promise<boolean> {
  try {
    const resp = await httpsGet(`${REMBG_URL}/api/remove-bg/status`, {}, 3_000)
    if (resp.status === 200) {
      const data = JSON.parse(resp.body)
      return data.available === true
    }
  } catch {}
  return false
}

async function handleRemoveBg(body: any): Promise<any> {
  const { image } = body
  if (!image) return { success: false, error: 'No image provided' }

  // Try local rembg service first
  try {
    const resp = await httpsPost(`${REMBG_URL}/api/remove-bg`, {
      'Content-Type': 'application/json',
    }, JSON.stringify({ image }), 60_000)

    if (resp.status === 200) {
      const data = JSON.parse(resp.body)
      return { success: true, image: data.image || '' }
    }
  } catch (e: any) {
    console.log(`[wb-skill remove-bg] Local service unavailable (${e.message}), falling back to Gemini...`)
  }

  // Fallback: use Gemini to redraw on pure white bg, then client-side whiteToAlpha
  try {
    const result = await geminiGenerateImage({
      prompt: 'Redraw this exact image with the subject placed on a perfectly uniform pure white (#FFFFFF) background. Keep the subject IDENTICAL -- same pose, same details, same colors, same size, same position. Only change the background to solid pure white. No shadows, no gradients, no gray -- pure white (#FFFFFF) everywhere except the subject.',
      inputImageBase64: image,
      model: 'gemini-3-pro-image-preview',
    })
    if (result.success && result.imageBase64) {
      return { success: true, image: result.imageBase64, needsWhiteToAlpha: true }
    }
    return { success: false, error: 'Gemini remove-bg failed: ' + (result.error || 'unknown') }
  } catch (e: any) {
    return { success: false, error: 'Gemini fallback failed: ' + e.message }
  }
}

// ── Workspace Games ───────────────────────────────────────────────────

/** Reject characterIds that could escape the export root */
function isSafeCharacterId(id: unknown): id is string {
  return typeof id === 'string'
    && id.length > 0
    && id.length < 128
    && /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(id)
}

/** Game UUID: RFC4122 hex+dash or at minimum no path-traversal chars */
function isSafeGameId(id: unknown): id is string {
  return typeof id === 'string'
    && id.length > 0
    && id.length < 128
    && /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(id)
}

/**
 * List game UUID directories under data/workspace/games/.
 * Filters hidden dirs, non-dirs, and dirs without package.json or public/.
 */
function listWorkspaceGames(): { gameId: string; hasPlayerSlot: boolean }[] {
  if (!existsSync(WORKSPACE_GAMES_DIR)) return []
  const entries = readdirSync(WORKSPACE_GAMES_DIR, { withFileTypes: true })
  const out: { gameId: string; hasPlayerSlot: boolean }[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (ent.name.startsWith('.')) continue
    if (!isSafeGameId(ent.name)) continue
    const gameRoot = resolve(WORKSPACE_GAMES_DIR, ent.name)
    const looksLikeGame = existsSync(resolve(gameRoot, 'package.json'))
      || existsSync(resolve(gameRoot, 'public'))
    if (!looksLikeGame) continue
    const hasPlayerSlot = existsSync(
      resolve(gameRoot, 'public/assets/art/characters/player/character.manifest.json'),
    )
    out.push({ gameId: ent.name, hasPlayerSlot })
  }
  return out
}

/**
 * Upsert VFX pipeline ExportedSkill[] into an already-published character manifest.
 * Merge rule: upsert by slotId. Orphan skills (unknown actionId) are skipped.
 * Only modifies skills[]; actions/sprite files are untouched.
 */
function mergeSkillsToWorkspaceGame(body: any): {
  success: true
  dir: string
  skillsApplied: number
  skillsSkipped: number
  skippedDetail: { slotId: string; reason: string }[]
} {
  if (!isSafeGameId(body?.gameId)) {
    throw new Error('Invalid gameId (must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')
  }
  if (!isSafeCharacterId(body?.characterId)) {
    throw new Error('Invalid characterId (must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')
  }
  if (!Array.isArray(body?.skills)) {
    throw new Error('Missing skills[] in request body')
  }

  const gameRoot = resolve(WORKSPACE_GAMES_DIR, body.gameId)
  if (!gameRoot.startsWith(WORKSPACE_GAMES_DIR + '/') && gameRoot !== WORKSPACE_GAMES_DIR) {
    throw new Error(`Path escapes workspace games dir: ${body.gameId}`)
  }
  const charDir = resolve(gameRoot, 'public/assets/art/characters', body.characterId)
  const manifestPath = resolve(charDir, 'character.manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Character not found: ${body.characterId} in game ${body.gameId}. Please first publish the character via the pixel-char pipeline.`)
  }

  let manifest: any
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (e: any) {
    throw new Error(`Failed to parse existing manifest: ${e.message}`)
  }
  if (!Array.isArray(manifest.actions)) {
    throw new Error('Existing manifest has no actions[]')
  }

  const actionIds = new Set<string>(manifest.actions.map((a: any) => String(a?.id)))
  const existingSkills: any[] = Array.isArray(manifest.skills) ? manifest.skills : []
  const bySlotId = new Map<string, any>()
  for (const s of existingSkills) {
    if (s && typeof s.slotId === 'string') bySlotId.set(s.slotId, s)
  }

  const applied: any[] = []
  const skipped: { slotId: string; reason: string }[] = []
  for (const raw of body.skills) {
    if (!raw || typeof raw !== 'object') continue
    const slotId = String(raw.slotId || '')
    const actionId = String(raw.actionId || '')
    if (!slotId) { skipped.push({ slotId: '?', reason: 'missing slotId' }); continue }
    if (!actionId || !actionIds.has(actionId)) {
      skipped.push({ slotId, reason: `actionId "${actionId}" not in manifest` })
      continue
    }
    bySlotId.set(slotId, raw)
    applied.push(raw)
  }

  manifest.skills = Array.from(bySlotId.values())
  manifest.exportedAt = Date.now()

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`[wb-skill] merge-skills: ${body.gameId}/${body.characterId} -> +${applied.length} applied, ${skipped.length} skipped`)

  return {
    success: true,
    dir: charDir,
    skillsApplied: applied.length,
    skillsSkipped: skipped.length,
    skippedDetail: skipped,
  }
}

// ── Plugin ────────────────────────────────────────────────────────────

export function apiProxyPlugin(): Plugin {
  const azureImgCfg = getAzureImageConfig()
  console.log(`[wb-skill API] Gemini model: ${GEMINI_MODEL}, gpt-image-2: ${azureImgCfg ? 'configured' : 'NOT configured'}, workspace: ${WORKSPACE_GAMES_DIR}`)

  return {
    name: 'wb-skill-api',
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/__ce-api__/')) return next()

        const urlPath = req.url.replace(/\?.*$/, '')
        const urlParams = new URL(req.url, 'http://localhost').searchParams

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          return res.end()
        }

        // ── GET endpoints ──────────────────────────────────────────
        if (req.method === 'GET') {
          try {
            if (urlPath === '/__ce-api__/remove-bg') {
              const available = await checkRemoveBgAvailable()
              jsonRes(res, 200, { available }); return
            }
            if (urlPath === '/__ce-api__/list-workspace-games') {
              const games = listWorkspaceGames()
              jsonRes(res, 200, { success: true, root: WORKSPACE_GAMES_DIR, games }); return
            }
            if (urlPath === '/__ce-api__/workspace-game-manifest') {
              const gameId = urlParams.get('gameId') || ''
              const characterId = urlParams.get('characterId') || ''
              if (!isSafeGameId(gameId) || !isSafeCharacterId(characterId)) {
                jsonRes(res, 200, { success: false, error: 'invalid gameId/characterId' }); return
              }
              const p = resolve(
                WORKSPACE_GAMES_DIR, gameId,
                'public/assets/art/characters', characterId,
                'character.manifest.json',
              )
              if (!existsSync(p)) {
                jsonRes(res, 200, { success: false, error: 'manifest not found' }); return
              }
              try {
                const manifest = JSON.parse(readFileSync(p, 'utf-8'))
                jsonRes(res, 200, { success: true, manifest }); return
              } catch (e: any) {
                jsonRes(res, 200, { success: false, error: `parse failed: ${e.message}` }); return
              }
            }
          } catch (err: any) {
            console.error('[wb-skill API GET Error]', req.url, err?.message)
            jsonRes(res, 200, { success: false, error: err.message || 'server error' })
          }
          return next()
        }

        // ── POST: merge-skills-to-workspace-game ──────────────────
        if (urlPath === '/__ce-api__/merge-skills-to-workspace-game' && req.method === 'POST') {
          try {
            const body = await parseBody(req, 1 * 1024 * 1024)
            const result = mergeSkillsToWorkspaceGame(body)
            jsonRes(res, 200, result)
          } catch (err: any) {
            console.error('[wb-skill API] merge-skills-to-workspace-game error:', err.message)
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
        }

        // ── POST: shared AI routes ─────────────────────────────────
        if (req.method === 'POST' && (
          urlPath === '/__ce-api__/generate-image' ||
          urlPath === '/__ce-api__/gemini-text' ||
          urlPath === '/__ce-api__/remove-bg'
        )) {
          let body: any
          try {
            body = await parseBody(req, 50 * 1024 * 1024)
          } catch (err: any) {
            jsonRes(res, 200, { success: false, error: err.message })
            return
          }

          let result: any

          try {
            console.log(`[wb-skill API] ${urlPath}, body keys: ${Object.keys(body).join(',')}, body size: ~${Math.round(JSON.stringify(body).length / 1024)}KB`)

            switch (urlPath) {
              case '/__ce-api__/generate-image': {
                const requestedModel = (body.model || '').trim()
                const hasInputImages = body.inputImageBase64 || body.inputImages
                const forceGemini = requestedModel.startsWith('gemini')

                if (forceGemini) {
                  result = await geminiGenerateImage(body)
                } else if (hasInputImages) {
                  result = await azureImageEdit(body)
                  if (!result.success) {
                    console.log('[wb-skill generate-image] Azure edit failed, falling back to Gemini')
                    result = await geminiGenerateImage(body)
                  }
                } else {
                  result = await azureImageGenerate(body)
                  if (!result.success) {
                    console.log('[wb-skill generate-image] Azure gen failed, falling back to Gemini')
                    result = await geminiGenerateImage(body)
                  }
                }
                break
              }
              case '/__ce-api__/gemini-text':
                result = await geminiGenerateText(body)
                break
              case '/__ce-api__/remove-bg':
                result = await handleRemoveBg(body)
                break
              default:
                return next()
            }

            jsonRes(res, 200, result)
          } catch (err: any) {
            console.error('[wb-skill API Error]', req.url, err?.message, err?.stack?.slice(0, 500))
            jsonRes(res, 200, { success: false, error: err.message || 'server error' })
          }
          return
        }

        next()
      })
    },
  }
}
