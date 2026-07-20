// @source wb-character/server/api-plugin.ts
/**
 * Vite server plugin: API proxy for wb-anim (spine + video pipelines).
 * Runs server-side only — keys never reach the browser.
 *
 * Route inventory (13 total, all under `/__ce-api__/*`):
 *
 * Exclusive to wb-anim (7):
 *   GET  /__ce-api__/video-query         — poll Kling task status
 *   GET  /__ce-api__/video-proxy         — proxy Kling CDN video URLs
 *   POST /__ce-api__/video-generate      — submit Kling video generation
 *   POST /__ce-api__/save-spine-session  — persist spine session to disk
 *   GET  /__ce-api__/load-spine-session  — load a saved spine session
 *   GET  /__ce-api__/list-spine-sessions — list history slots
 *   GET  /__ce-api__/spine-session-thumbnail — serve session thumbnail PNG
 *
 * Shared copies (D-2, 6 routes; wb-anim callers: spine editor + video pipeline):
 *   POST /__ce-api__/generate-image      — image generation (Gemini/gpt-image-2)
 *   POST /__ce-api__/gemini-text         — Gemini text generation
 *   POST /__ce-api__/chat                — LLM chat (Claude/Gemini fallback)
 *   POST /__ce-api__/character-turnaround — turnaround sheet generation
 *   POST /__ce-api__/analyze-ultimate    — analyze design sheet for video prompt
 *   GET+POST /__ce-api__/remove-bg       — background removal
 *
 * Credentials follow the same forgeax-studio .env convention as wb-character.
 */
import type { Plugin } from 'vite'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import sharp from 'sharp'
import {
  pickClaudeFromEnv,
  pickGeminiKeyFromEnv,
  pickAzureImageFromEnv,
  type AzureImageCredentials,
} from './env-credentials'
import { selectGeminiTextModel } from './select-gemini-text-model'

// ── Config ────────────────────────────────────────────────────────────

const getMcpHost = () => process.env.MCP_HOST || 'vag-mcp-sandbox'
const getMcpPromptPort = () => Number(process.env.MCP_PROMPT_PORT || '3101')
const getLlmProxyUrl = () => process.env.LLM_PROXY_URL || ''
const GEMINI_MODEL = 'gemini-3-pro-image-preview'
const REMBG_URL = process.env.REMBG_URL || 'http://127.0.0.1:5001'

let _proxyDown = false

// ── Kling Config ──────────────────────────────────────────────────────

interface KlingConfig { accessKey: string; secretKey: string }

function loadKlingConfig(): KlingConfig {
  const credPaths = [
    resolve(process.cwd(), 'config/kling-video-credentials.json'),
    '/workspace/games/character-editor/config/kling-video-credentials.json',
  ]
  for (const p of credPaths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'))
        if (raw.access_key && raw.secret_key) {
          console.log(`[Kling] Loaded credentials from ${p}`)
          return { accessKey: raw.access_key, secretKey: raw.secret_key }
        }
      } catch {}
    }
  }
  const legacyPaths = [
    resolve(process.cwd(), 'server/keys.local.json'),
    '/workspace/games/character-editor/server/keys.local.json',
  ]
  for (const p of legacyPaths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'))
        if (raw.kling) return { accessKey: raw.kling.access_key, secretKey: raw.kling.secret_key }
      } catch {}
    }
  }
  return { accessKey: process.env.KLING_ACCESS_KEY || '', secretKey: process.env.KLING_SECRET_KEY || '' }
}

let _clockOffsetSec = 0
let _clockCalibrated = false

async function calibrateClock(): Promise<void> {
  if (_clockCalibrated) return
  try {
    const serverTime = await new Promise<number>((resolve, reject) => {
      const req = httpsRequest('https://api-beijing.klingai.com/', { method: 'HEAD', timeout: 5000 }, (res) => {
        const dateStr = res.headers['date']
        if (dateStr) resolve(Math.floor(new Date(dateStr).getTime() / 1000))
        else reject(new Error('no date header'))
        res.resume()
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      req.end()
    })
    const local = Math.floor(Date.now() / 1000)
    _clockOffsetSec = serverTime - local
    _clockCalibrated = true
    if (Math.abs(_clockOffsetSec) > 30) {
      console.warn(`[Kling] Clock drift detected: ${_clockOffsetSec}s — JWT timestamps will be corrected`)
    }
  } catch (e: any) {
    console.warn(`[Kling] Clock calibration failed (${e.message}), using local time`)
  }
}

function accurateNowSec(): number {
  return Math.floor(Date.now() / 1000) + _clockOffsetSec
}

function klingJWT(cfg: KlingConfig): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = accurateNowSec()
  const payload = Buffer.from(JSON.stringify({ iss: cfg.accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url')
  const sig = createHmac('sha256', cfg.secretKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

// ── Helpers ───────────────────────────────────────────────────────────

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
        console.log(`[parseBody] total size: ${(raw.length / 1024).toFixed(0)}KB`)
        resolve(JSON.parse(raw))
      }
      catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function jsonRes(res: ServerResponse, status: number, body: any): void {
  if (res.headersSent) {
    console.warn('[jsonRes] Headers already sent, skipping duplicate response')
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

function httpsPost(url: string, headers: Record<string, string>, body: string, timeout = 180_000): Promise<{ status: number; body: string }> {
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

function httpsGet(url: string, headers: Record<string, string>, timeout = 15_000): Promise<{ status: number; body: string }> {
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

// ── Gemini helpers ────────────────────────────────────────────────────

let _cachedGeminiKey: string | null = null
function getGeminiApiKey(): string {
  if (_cachedGeminiKey !== null) return _cachedGeminiKey
  _cachedGeminiKey = pickGeminiKeyFromEnv(process.env as Record<string, string | undefined>)
  return _cachedGeminiKey
}

async function geminiPost(model: string, payload: string, timeout = 180_000): Promise<{ status: number; body: string }> {
  const proxyUrl = getLlmProxyUrl()
  const apiKey = getGeminiApiKey()
  if (!proxyUrl && !apiKey) throw new Error('LLM_PROXY_URL and Gemini API Key are not configured')

  if (proxyUrl && !_proxyDown) {
    const url = `${proxyUrl.replace(/\/+$/, '')}/v1/gemini/generateContent/${model}`
    try {
      const resp = await httpsPost(url, { 'Content-Type': 'application/json' }, payload, timeout)
      return resp
    } catch (e: any) {
      if (apiKey && (e.message?.includes('EAI_AGAIN') || e.message?.includes('ECONNREFUSED') || e.message?.includes('ENOTFOUND'))) {
        console.warn(`[Gemini] Proxy unreachable (${e.message}), switching to direct API`)
        _proxyDown = true
      } else {
        throw e
      }
    }
  }

  if (!apiKey) throw new Error('Gemini API Key not configured and Proxy unavailable')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  return httpsPost(url, { 'Content-Type': 'application/json' }, payload, timeout)
}

// ── Image Generation ──────────────────────────────────────────────────

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
  console.log(`[Gemini] Calling ${geminiModel}, aspectRatio: ${aspectRatio || 'NONE'}`)

  const resp = await geminiPost(geminiModel, payload)
  if (resp.status !== 200) {
    let errMsg = `Gemini API error (${resp.status})`
    try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
    return { success: false, error: errMsg }
  }

  try {
    const data = JSON.parse(resp.body)
    const candidates = data.candidates || []
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || []
      for (const part of parts) {
        if (part.inlineData) {
          return { success: true, imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' }
        }
      }
    }
    const text = candidates[0]?.content?.parts?.[0]?.text || ''
    if (data.promptFeedback?.blockReason) {
      return { success: false, error: `Content blocked: ${data.promptFeedback.blockReason}` }
    }
    return { success: false, error: text || 'No image generated' }
  } catch (e: any) {
    return { success: false, error: 'Gemini response parse failed: ' + e.message }
  }
}

// ── Azure gpt-image-2 ─────────────────────────────────────────────────

function sanitizePromptForGPT(raw: string): string {
  return raw.replace(/\(([^)]+):[\d.]+\)/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

let _cachedAzureImage: AzureImageCredentials | null | undefined = undefined
function getAzureImageConfig(): AzureImageCredentials | null {
  if (_cachedAzureImage !== undefined) return _cachedAzureImage
  _cachedAzureImage = pickAzureImageFromEnv(process.env as Record<string, string | undefined>)
  return _cachedAzureImage
}

async function azureImageGenerate(body: any): Promise<any> {
  const creds = getAzureImageConfig()
  if (!creds) return { success: false, error: 'Azure OpenAI Image credentials not configured' }

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

  try {
    const resp = await httpsPost(url, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.apiKey}`,
    }, payload, 120_000)

    if (resp.status !== 200) {
      let errMsg = `gpt-image-2 API error (${resp.status})`
      try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
      return { success: false, error: errMsg }
    }
    const data = JSON.parse(resp.body)
    const b64 = data.data?.[0]?.b64_json
    if (b64) return { success: true, imageBase64: b64, mimeType: 'image/png' }
    return { success: false, error: 'No image data returned' }
  } catch (e: any) {
    return { success: false, error: `gpt-image-2 request failed: ${e.message}` }
  }
}

async function azureImageEdit(body: any): Promise<any> {
  const creds = getAzureImageConfig()
  if (!creds) return { success: false, error: 'Azure OpenAI Image credentials not configured' }

  const { prompt, inputImageBase64, inputImages, aspectRatio, imageSize } = body
  if (!prompt) return { success: false, error: 'Missing prompt' }

  let imgB64: string | undefined = inputImageBase64
  if (!imgB64 && Array.isArray(inputImages) && inputImages.length > 0) imgB64 = inputImages[0].base64
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
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="input.png"\r\nContent-Type: image/png\r\n\r\n`))
  parts.push(imgBuf)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  const multipartBody = Buffer.concat(parts)

  const url = `${creds.apiBase}/openai/deployments/${creds.deployment}/images/edits?api-version=${creds.apiVersion}`
  return new Promise((resolve) => {
    const u = new URL(url)
    const isSecure = u.protocol === 'https:'
    const fn = isSecure ? httpsRequest : httpRequest
    const req = fn({
      hostname: u.hostname,
      port: u.port || (isSecure ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${creds.apiKey}`,
        'Content-Length': multipartBody.length,
      },
      timeout: 120_000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString())
          const b64 = data.data?.[0]?.b64_json
          if (b64) resolve({ success: true, imageBase64: b64, mimeType: 'image/png' })
          else resolve({ success: false, error: data.error?.message || 'No image data' })
        } catch (e: any) { resolve({ success: false, error: `Parse failed: ${e.message}` }) }
      })
    })
    req.on('error', (e: any) => resolve({ success: false, error: `Request failed: ${e.message}` }))
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Request timeout (120s)' }) })
    req.write(multipartBody)
    req.end()
  })
}

// ── Gemini Text ───────────────────────────────────────────────────────

async function geminiGenerateText(body: any): Promise<any> {
  const { prompt, inputImages, model } = body
  if (!prompt) return { success: false, error: 'Missing prompt' }

  const geminiModel = selectGeminiTextModel('analyze-image', { explicit: model, env: process.env })
  const parts: any[] = []
  if (Array.isArray(inputImages)) {
    for (const img of inputImages) {
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.base64 } })
    }
  }
  parts.push({ text: prompt })
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT'], temperature: 1.0, maxOutputTokens: 4096 },
  })

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
    return { success: false, error: 'Gemini response parse failed: ' + e.message }
  }
}

// ── LLM Chat ──────────────────────────────────────────────────────────

interface LLMConfig { apiKey: string; apiBase: string; model: string }

function loadClaudeConfig(): LLMConfig {
  const fromEnv = pickClaudeFromEnv(process.env as Record<string, string | undefined>)
  if (fromEnv) return fromEnv
  const proxyUrl = getLlmProxyUrl()
  return { apiKey: '', apiBase: proxyUrl || '', model: 'claude-opus-4-6' }
}

async function handleChatViaGemini(messages: any[], maxTokens?: number): Promise<any> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) return { success: false, error: 'Claude not configured and Gemini API Key not set' }

  const geminiModel = selectGeminiTextModel('chat-fallback', { env: process.env })
  const contents = messages.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }))
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`
  const payloadGemini = JSON.stringify({
    contents,
    generationConfig: { temperature: 0.9, maxOutputTokens: maxTokens ? Math.max(maxTokens, 4096) : 8192 },
  })
  const resp = await httpsPost(apiUrl, { 'Content-Type': 'application/json' }, payloadGemini, 120_000)
  if (resp.status !== 200) {
    let errMsg = `Gemini API error (${resp.status})`
    try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
    return { success: false, error: errMsg }
  }
  try {
    const data = JSON.parse(resp.body)
    const candidate = data.candidates?.[0]
    if (!candidate) return { success: false, error: 'Gemini returned no candidates' }
    const text = candidate.content?.parts?.map((p: any) => p.text || '').join('') || ''
    if (!text) return { success: false, error: 'Gemini generated empty text' }
    return { success: true, text }
  } catch (e: any) {
    return { success: false, error: 'Gemini response parse failed: ' + e.message }
  }
}

async function handleChat(body: any, config: LLMConfig): Promise<any> {
  const { messages, maxTokens, model, system } = body
  if (!messages?.length) return { success: false, error: 'Missing messages' }

  const useClaude = process.env.USE_CLAUDE_CHAT === '1'
  if (!useClaude) return handleChatViaGemini(messages, maxTokens)

  const useConfig = { ...config }
  if (model) useConfig.model = model
  if (!useConfig.apiBase || !useConfig.apiKey) {
    console.log('[Chat] Claude not configured, falling back to Gemini...')
    return handleChatViaGemini(messages, maxTokens)
  }

  const payloadObj: any = { model: useConfig.model, max_tokens: maxTokens || 4096, messages }
  if (system) payloadObj.system = system
  const payload = JSON.stringify(payloadObj)
  let chatUrl = useConfig.apiBase.replace(/\/+$/, '')
  if (!chatUrl.endsWith('/v1/messages')) chatUrl += '/v1/messages'

  try {
    const resp = await httpsPost(chatUrl, {
      'Content-Type': 'application/json',
      'x-api-key': useConfig.apiKey,
      'anthropic-version': '2023-06-01',
    }, payload, 120_000)
    const result = JSON.parse(resp.body)
    if (result.error) {
      console.warn('[Chat] Claude error, falling back to Gemini:', result.error.message)
      return handleChatViaGemini(messages, maxTokens)
    }
    const text = result.content?.map((c: any) => c.text).join('') || ''
    return { success: true, text, usage: result.usage }
  } catch (e: any) {
    console.warn('[Chat] Claude request failed, falling back to Gemini:', e.message)
    return handleChatViaGemini(messages, maxTokens)
  }
}

// ── Kling: Video ──────────────────────────────────────────────────────

const KLING_BASE = 'https://api-beijing.klingai.com'

async function handleVideoGenerate(body: any, klingCfg: KlingConfig): Promise<any> {
  const { prompt, image_base64, end_frame_base64, mode, aspect_ratio, duration } = body
  if (!prompt && !image_base64) return { success: false, error: 'Please provide text or image' }

  await calibrateClock()
  const token = klingJWT(klingCfg)
  const reqBody: any = {
    model_name: 'kling-v3-omni',
    mode: mode === 'pro' ? 'pro' : 'std',
    duration: String(duration || '5'),
  }
  if (image_base64) {
    reqBody.prompt = prompt || 'Make the content in the image move'
    const stripDataPrefix = (b64: string) => b64.startsWith('data:') ? b64.replace(/^data:[^;]+;base64,/, '') : b64
    const images: any[] = [{ image_url: stripDataPrefix(image_base64), type: 'first_frame' }]
    if (end_frame_base64) images.push({ image_url: stripDataPrefix(end_frame_base64), type: 'end_frame' })
    reqBody.image_list = images
  } else {
    reqBody.prompt = prompt
    const valid = ['16:9', '9:16', '1:1']
    reqBody.aspect_ratio = valid.includes(aspect_ratio) ? aspect_ratio : '16:9'
  }

  const resp = await httpsPost(`${KLING_BASE}/v1/videos/omni-video`, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }, JSON.stringify(reqBody), 90_000)

  const data = JSON.parse(resp.body)
  if (resp.status !== 200 || data.code !== 0) {
    return { success: false, error: data.message || `Kling API error (${resp.status})` }
  }
  return { success: true, task_id: data.data.task_id, task_status: data.data.task_status }
}

async function handleVideoQuery(taskId: string, klingCfg: KlingConfig): Promise<any> {
  await calibrateClock()
  const token = klingJWT(klingCfg)
  const url = `${KLING_BASE}/v1/videos/omni-video/${taskId}`
  const resp = await httpsGet(url, { 'Authorization': `Bearer ${token}` })
  const data = JSON.parse(resp.body)
  if (resp.status !== 200 || data.code !== 0) {
    return { success: false, error: data.message || `Kling query error (${resp.status})` }
  }
  return {
    success: true,
    task_id: data.data.task_id,
    task_status: data.data.task_status,
    task_status_msg: data.data.task_status_msg || '',
    videos: data.data.task_result?.videos || [],
  }
}

const PROXY_ALLOWED_HOSTS = ['v1-fdl.kechuangai.com', 'v4-fdl.kechuangai.com', 'api-beijing.klingai.com']
const PROXY_PATTERN = /^v\d+-fdl\.kechuangai\.com$/

function handleVideoProxy(urlParam: string, req: IncomingMessage, res: ServerResponse): void {
  let parsed: URL
  try { parsed = new URL(urlParam) } catch { jsonRes(res, 400, { error: 'Invalid url' }); return }
  const allowed = PROXY_ALLOWED_HOSTS.includes(parsed.hostname) || PROXY_PATTERN.test(parsed.hostname)
  if (!allowed) { jsonRes(res, 403, { error: 'Forbidden host' }); return }

  const isSecure = parsed.protocol === 'https:'
  const fn = isSecure ? httpsRequest : httpRequest
  const upstreamHeaders: Record<string, string> = { Accept: 'video/*' }
  if (req.headers.range) upstreamHeaders['Range'] = req.headers.range as string

  const proxyReq = fn({
    hostname: parsed.hostname,
    port: parsed.port || (isSecure ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: upstreamHeaders,
    timeout: 60_000,
  }, (proxyRes) => {
    const fwd: Record<string, string> = {
      'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    }
    if (proxyRes.headers['content-length']) fwd['Content-Length'] = proxyRes.headers['content-length'] as string
    if (proxyRes.headers['content-range']) fwd['Content-Range'] = proxyRes.headers['content-range'] as string
    res.writeHead(proxyRes.statusCode || 500, fwd)
    proxyRes.pipe(res)
  })
  proxyReq.on('error', (err) => { jsonRes(res, 502, { error: err.message }) })
  proxyReq.on('timeout', () => { proxyReq.destroy(); jsonRes(res, 504, { error: 'Proxy timeout' }) })
  proxyReq.end()
}

// ── Turnaround ────────────────────────────────────────────────────────

const NORM_CHAR_HEIGHT_RATIO = 0.70
const NORM_FOOT_BOTTOM_MARGIN = 0.05
const NORM_WHITE_THRESHOLD = 240

async function normalizeCharacterSize(
  base64: string,
  mime: string,
): Promise<{ base64: string; mime: string }> {
  try {
    const buf = Buffer.from(base64, 'base64')
    const image = sharp(buf)
    const meta = await image.metadata()
    const W = meta.width!
    const H = meta.height!
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const channels = info.channels
    let minX = W, minY = H, maxX = 0, maxY = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * channels
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3]
        if (a < 10) continue
        if (r >= NORM_WHITE_THRESHOLD && g >= NORM_WHITE_THRESHOLD && b >= NORM_WHITE_THRESHOLD) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX <= minX || maxY <= minY) return { base64, mime }
    const charW = maxX - minX + 1
    const charH = maxY - minY + 1
    const cropped = sharp(buf).extract({ left: minX, top: minY, width: charW, height: charH })
    const targetH = Math.round(H * NORM_CHAR_HEIGHT_RATIO)
    const scale = targetH / charH
    const targetW = Math.round(charW * scale)
    const resized = await cropped.resize(targetW, targetH, { fit: 'fill' }).png().toBuffer()
    const footY = Math.round(H * (1 - NORM_FOOT_BOTTOM_MARGIN))
    const topY = footY - targetH
    const leftX = Math.round((W - targetW) / 2)
    const canvas = sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png()
    const result = await canvas.composite([{ input: resized, left: leftX, top: topY }]).png().toBuffer()
    return { base64: result.toString('base64'), mime: 'image/png' }
  } catch (err: any) {
    console.error('[Normalize] Failed, returning original:', err.message)
    return { base64, mime }
  }
}

const TURNAROUND_PERSPECTIVE = 'Subtle top-down camera (~30° above eye level). Top of head visible, body curves arc slightly downward, feet slightly smaller due to perspective.'
const TURNAROUND_FRAMING = 'Character fills ~60% of frame height. Head sits in the top 20% of the frame, feet sit in the bottom 15%. Horizontally centered.'
const TURNAROUND_CANVAS = 'White background (#FFFFFF), no shadow, no ground, no environment.'
const TURNAROUND_STYLE_MATCH = 'CRITICAL: Replicate the exact art style of the character in the design reference — same rendering technique, color palette, line weight, and shading. If the reference is 2D illustration, output 2D illustration. If pixel art, output pixel art. If anime cel-shading, output anime cel-shading. Do NOT convert to 3D rendering. Do NOT add photorealistic lighting or textures.'
const TURNAROUND_OUTPUT_RULES = 'OUTPUT RULES (MANDATORY): 1) Output EXACTLY ONE single character — no duplicates, no extra figures, no accessories floating separately. 2) Single character, exactly two feet. 3) No text, no labels, no watermarks, no UI elements. 4) Render at high resolution with sharp, clean lines and fine details.'
const TURNAROUND_NEGATIVE = 'multiple characters, extra limbs, extra feet, duplicate character'
const TURNAROUND_POSE: Record<string, string> = {
  front: [TURNAROUND_PERSPECTIVE, 'Body faces camera directly, perfectly symmetrical, zero rotation.', 'Both legs straight and pressed together — inner ankles and inner knees touching. Two feet side by side with no gap, on the same horizontal line.', 'Arms relaxed at sides.', TURNAROUND_FRAMING].join(' '),
  side: [TURNAROUND_PERSPECTIVE, 'Body rotated ~60° from front, facing RIGHT. This is a 3/4 side view — part of the front chest/torso is still visible, but the body is predominantly seen from the right side.', 'Head turned right, nose points toward the right edge.', 'Right arm visible in front, left arm mostly hidden behind torso.', 'Legs close together, right foot slightly ahead of left.', TURNAROUND_FRAMING].join(' '),
  back: [TURNAROUND_PERSPECTIVE, 'Body faces directly away from camera, symmetrical rear view.', 'Legs in narrow stance close together, feet on the same horizontal line.', 'Arms relaxed at sides.', TURNAROUND_FRAMING].join(' '),
}
const TURNAROUND_VIEW_LABEL: Record<string, string> = { front: 'front-facing', side: 'right-facing side-profile', back: 'rear-facing' }
const TURNAROUND_APPEAR_NOTE: Record<string, string> = { front: 'shown from the front', side: 'shown from the right side', back: 'shown from the back' }

function buildTurnaroundParts(view: string, templateB64: string, characterB64: string, style?: string, userPrompt?: string, extraDesc?: string): any[] {
  const viewLabel = TURNAROUND_VIEW_LABEL[view] || view
  const appearNote = TURNAROUND_APPEAR_NOTE[view] || view
  const pose = TURNAROUND_POSE[view] || TURNAROUND_POSE['front']
  const extra = [style, userPrompt, extraDesc].filter(Boolean).join(' ')

  if (view === 'idle') {
    return [
      { text: "Character design reference — match this character's appearance exactly:" },
      { inlineData: { mimeType: 'image/png', data: characterB64 } },
      { text: ['Task: Generate ONE image of this character in a 3/4 view (45-degree angle) idle pose.', '', "FACING DIRECTION (CRITICAL): The character's body and face MUST point toward the RIGHT edge of the image.", '', 'The character should be in a relaxed, natural idle pose.', '', TURNAROUND_PERSPECTIVE, TURNAROUND_FRAMING, '', 'Appearance: exact same outfit, weapon, colors, art style, proportions.', TURNAROUND_STYLE_MATCH, TURNAROUND_OUTPUT_RULES, TURNAROUND_CANVAS, extra ? `Additional instructions: ${extra}` : '', `\n\nIMPORTANT: The image must NOT contain any of these: ${TURNAROUND_NEGATIVE}`].filter(Boolean).join('\n') },
    ]
  }

  return [
    { text: `Pose/angle/size reference — match this mannequin's ${viewLabel} pose exactly:` },
    { inlineData: { mimeType: 'image/png', data: templateB64 } },
    { text: "Character design reference — match this character's appearance exactly:" },
    { inlineData: { mimeType: 'image/png', data: characterB64 } },
    { text: [`Redraw the character from the design reference in the mannequin's ${viewLabel} pose.`, '', `Pose: ${pose}`, `Appearance: exact same outfit, weapon, colors, art style, proportions — ${appearNote}.`, '', TURNAROUND_STYLE_MATCH, '', `Single character, exactly two feet.${view === 'front' ? ' Legs together, no gap between ankles.' : ''} ${TURNAROUND_CANVAS}`, TURNAROUND_OUTPUT_RULES, extra ? `\nAdditional instructions: ${extra}` : '', `\n\nIMPORTANT: The image must NOT contain any of these: ${TURNAROUND_NEGATIVE}`].filter(Boolean).join('\n') },
  ]
}

async function generateSingleView(characterBase64: string, view: string, style?: string, userPrompt?: string, extraDesc?: string): Promise<{ base64: string; mime: string } | { error: string }> {
  const templateDir = resolve(process.cwd(), 'public/assets/turnaround')
  const templatePath = resolve(templateDir, `turnaround-${view}.png`)
  let templateB64 = ''
  if (existsSync(templatePath)) templateB64 = readFileSync(templatePath).toString('base64')

  const parts = buildTurnaroundParts(view, templateB64, characterBase64, style, userPrompt, extraDesc)
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  })

  const resp = await geminiPost(GEMINI_MODEL, payload, 120_000)
  if (resp.status !== 200) {
    let errMsg = `Gemini error (${resp.status})`
    try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
    return { error: `${view}: ${errMsg}` }
  }
  const data = JSON.parse(resp.body)
  const candidate = data.candidates?.[0]
  if (!candidate) return { error: `${view}: ${data.promptFeedback?.blockReason || 'No result'}` }
  const imgPart = candidate.content?.parts?.find((pt: any) => pt.inlineData)
  if (!imgPart) return { error: `${view}: ${data.promptFeedback?.blockReason || candidate.finishReason || 'No image generated'}` }
  return { base64: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/png' }
}

async function handleCharacterTurnaround(body: any): Promise<any> {
  const { characterBase64, prompt, style, singleView, extraDesc } = body
  if (!characterBase64) return { success: false, error: 'Missing character image' }

  if (singleView) {
    const result = await generateSingleView(characterBase64, singleView, style, prompt, extraDesc)
    if ('error' in result) return { success: false, error: result.error }
    const normalized = await normalizeCharacterSize(result.base64, result.mime)
    return { success: true, view: singleView, viewResult: normalized }
  }

  const allViews = ['front', 'side', 'back', 'idle'] as const
  const results: Record<string, { base64: string; mime: string }> = {}
  for (const view of allViews) {
    const result = await generateSingleView(characterBase64, view, style, prompt)
    if ('error' in result) return { success: false, error: result.error }
    results[view] = result
  }
  for (const view of Object.keys(results)) {
    results[view] = await normalizeCharacterSize(results[view].base64, results[view].mime)
  }
  return { success: true, views: results }
}

// ── Analyze Ultimate ──────────────────────────────────────────────────

async function handleAnalyzeUltimate(body: any): Promise<any> {
  const { design_image_base64 } = body
  if (!design_image_base64) return { success: false, error: 'Please upload a character design image' }

  const analyzePrompt = `你是一名专业的游戏角色动画导演，精通可灵AI视频生成平台的提示词编写。

我会给你一张角色图片。请你：
1. 仔细观察角色的外貌特征（发型发色、服饰穿搭、武器装备、五官形态、体型比例）
2. 如果图片中有招式/技能动作参考，分析其动作特点
3. 根据角色特征，设计一个符合其身份的5秒炫酷大招动画

请严格按照以下公式生成提示词：
提示词 = 主体(主体描述) + 运动 + 场景(场景描述) + 镜头语言 + 光影 + 氛围

要求：
- 中文输出
- 100-150字
- 只输出提示词本身，不要任何解释、标题或编号`

  const result = await geminiGenerateText({
    prompt: analyzePrompt,
    inputImages: [{ base64: design_image_base64, mimeType: 'image/png' }],
    model: selectGeminiTextModel('analyze-image', { env: process.env }),
  })
  if (!result.success) return result
  return { success: true, prompt: result.text.trim() }
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

  try {
    const resp = await httpsPost(`${REMBG_URL}/api/remove-bg`, { 'Content-Type': 'application/json' }, JSON.stringify({ image }), 60_000)
    if (resp.status === 200) {
      const data = JSON.parse(resp.body)
      return { success: true, image: data.image || '' }
    }
  } catch (e: any) {
    console.log(`[remove-bg] Local service unavailable (${e.message}), falling back to Gemini...`)
  }

  try {
    const result = await geminiGenerateImage({
      prompt: 'Redraw this exact image with the subject placed on a perfectly uniform pure white (#FFFFFF) background. Keep the subject IDENTICAL — same pose, same details, same colors, same size, same position. Only change the background to solid pure white. No shadows, no gradients, no gray — pure white (#FFFFFF) everywhere except the subject.',
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

// ── Spine Session Persistence ─────────────────────────────────────────

const SPINE_DIR = resolve(process.cwd(), 'workspace/spine')
const SPINE_HISTORY_DIR = resolve(SPINE_DIR, 'history')
const MAX_HISTORY_SESSIONS = 20

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function b64ToFile(dataUrl: string, filePath: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) { writeFileSync(filePath, dataUrl, 'utf-8'); return filePath }
  writeFileSync(filePath, Buffer.from(match[2], 'base64'))
  return filePath
}

function fileToB64(filePath: string, mime = 'image/png'): string | null {
  if (!existsSync(filePath)) return null
  const buf = readFileSync(filePath)
  return `data:${mime};base64,${buf.toString('base64')}`
}

function saveSpineSession(body: any, slotDir: string): void {
  ensureDir(slotDir)
  const partsDir = join(slotDir, 'parts')
  ensureDir(partsDir)

  const meta: any = {
    profession: body.profession,
    characterDescription: body.characterDescription,
    activeTab: body.activeTab,
    exportPath: body.exportPath,
    bindingJson: body.bindingJson,
    bindingVersion: body.bindingVersion,
    timestamp: body.timestamp || Date.now(),
    partRegionsMeta: [],
    hasCharacterImage: false,
    hasExplosionImage: false,
    attachmentKeys: [],
    animationKeys: [],
  }

  if (body.characterImage) { b64ToFile(body.characterImage, join(slotDir, 'character.png')); meta.hasCharacterImage = true }
  if (body.explosionImage) { b64ToFile(body.explosionImage, join(slotDir, 'explosion.png')); meta.hasExplosionImage = true }

  if (Array.isArray(body.partRegions)) {
    for (const r of body.partRegions) {
      const partMeta: any = { id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height }
      if (r.imageData && r.width > 0) { b64ToFile(r.imageData, join(partsDir, `${r.id}.png`)); partMeta.hasImage = true }
      meta.partRegionsMeta.push(partMeta)
    }
  }

  if (body.attachmentImages && typeof body.attachmentImages === 'object') {
    for (const [key, dataUrl] of Object.entries(body.attachmentImages)) {
      b64ToFile(dataUrl as string, join(slotDir, `attach_${key}.png`))
      meta.attachmentKeys.push(key)
    }
  }

  if (body.animations && typeof body.animations === 'object') {
    meta.animations = body.animations
    meta.animationKeys = Object.keys(body.animations)
  }

  writeFileSync(join(slotDir, 'session.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

function loadSpineSession(slotDir: string): any | null {
  const metaPath = join(slotDir, 'session.json')
  if (!existsSync(metaPath)) return null
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
  const result: any = {
    profession: meta.profession,
    characterDescription: meta.characterDescription,
    activeTab: meta.activeTab,
    exportPath: meta.exportPath,
    bindingJson: meta.bindingJson,
    bindingVersion: meta.bindingVersion,
    timestamp: meta.timestamp,
    characterImage: null,
    explosionImage: null,
    partRegions: [],
    attachmentImages: {},
    animations: meta.animations || {},
  }
  if (meta.hasCharacterImage) result.characterImage = fileToB64(join(slotDir, 'character.png'))
  if (meta.hasExplosionImage) result.explosionImage = fileToB64(join(slotDir, 'explosion.png'))

  const partsDir = join(slotDir, 'parts')
  if (Array.isArray(meta.partRegionsMeta)) {
    for (const pm of meta.partRegionsMeta) {
      const region: any = { id: pm.id, name: pm.name, x: pm.x, y: pm.y, width: pm.width, height: pm.height, imageData: '' }
      if (pm.hasImage) region.imageData = fileToB64(join(partsDir, `${pm.id}.png`)) || ''
      result.partRegions.push(region)
    }
  }
  if (Array.isArray(meta.attachmentKeys)) {
    for (const key of meta.attachmentKeys) {
      const data = fileToB64(join(slotDir, `attach_${key}.png`))
      if (data) result.attachmentImages[key] = data
    }
  }
  return result
}

function pruneHistory(): void {
  ensureDir(SPINE_HISTORY_DIR)
  const dirs = readdirSync(SPINE_HISTORY_DIR)
    .filter(d => existsSync(join(SPINE_HISTORY_DIR, d, 'session.json')))
    .sort()
    .reverse()
  for (const dir of dirs.slice(MAX_HISTORY_SESSIONS)) {
    try { rmSync(join(SPINE_HISTORY_DIR, dir), { recursive: true, force: true }) } catch {}
  }
}

// ── MCP ───────────────────────────────────────────────────────────────

function mcpCall(host: string, port: number, tool: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: tool, arguments: args }, id: Date.now(),
    })
    const req = httpRequest({
      hostname: host, port, path: '/mcp', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 180_000,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch (e) { reject(new Error('MCP parse error: ' + e)) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('MCP timeout')) })
    req.write(payload)
    req.end()
  })
}

// ── Plugin ────────────────────────────────────────────────────────────

export function apiProxyPlugin(): Plugin {
  const claudeConfig = loadClaudeConfig()
  const klingConfig = loadKlingConfig()
  const azureImgCfg = getAzureImageConfig()
  console.log(`[wb-anim API] Claude model: ${claudeConfig.model}, Gemini: ${GEMINI_MODEL}, gpt-image-2: ${azureImgCfg ? 'configured' : 'NOT configured'}, Kling: ${klingConfig.accessKey ? 'configured' : 'NOT configured'}`)

  return {
    name: 'wb-anim-api',
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

        // GET routes
        if (req.method === 'GET') {
          try {
            if (urlPath === '/__ce-api__/video-query') {
              const taskId = urlParams.get('taskId')
              if (!taskId) { jsonRes(res, 400, { success: false, error: 'Missing taskId' }); return }
              const result = await handleVideoQuery(taskId, klingConfig)
              jsonRes(res, 200, result); return
            }
            if (urlPath === '/__ce-api__/video-proxy') {
              const url = urlParams.get('url')
              if (!url) { jsonRes(res, 400, { error: 'Missing url' }); return }
              handleVideoProxy(url, req, res); return
            }
            if (urlPath === '/__ce-api__/remove-bg') {
              const available = await checkRemoveBgAvailable()
              jsonRes(res, 200, { available }); return
            }
            if (urlPath === '/__ce-api__/load-spine-session') {
              try {
                const slot = urlParams.get('slot')
                const dir = slot ? join(SPINE_HISTORY_DIR, slot) : join(SPINE_DIR, 'current')
                const data = loadSpineSession(dir)
                if (data) {
                  jsonRes(res, 200, { success: true, session: data })
                } else {
                  jsonRes(res, 200, { success: false, error: 'No saved session' })
                }
              } catch (err: any) {
                jsonRes(res, 200, { success: false, error: err.message })
              }
              return
            }
            if (urlPath === '/__ce-api__/list-spine-sessions') {
              try {
                ensureDir(SPINE_HISTORY_DIR)
                const dirs = readdirSync(SPINE_HISTORY_DIR)
                  .filter(d => existsSync(join(SPINE_HISTORY_DIR, d, 'session.json')))
                  .sort()
                  .reverse()
                const entries = dirs.map(d => {
                  try {
                    const meta = JSON.parse(readFileSync(join(SPINE_HISTORY_DIR, d, 'session.json'), 'utf-8'))
                    const hasThumbnail = existsSync(join(SPINE_HISTORY_DIR, d, 'character.png'))
                    return {
                      slot: d, timestamp: meta.timestamp, profession: meta.profession,
                      activeTab: meta.activeTab, hasThumbnail,
                      hasExplosion: meta.hasExplosionImage || false,
                      partsCount: (meta.partRegionsMeta || []).filter((p: any) => p.width > 0).length,
                    }
                  } catch { return null }
                }).filter(Boolean)
                jsonRes(res, 200, { success: true, sessions: entries })
              } catch (err: any) {
                jsonRes(res, 200, { success: false, error: err.message })
              }
              return
            }
            if (urlPath === '/__ce-api__/spine-session-thumbnail') {
              const slot = urlParams.get('slot')
              if (!slot) { jsonRes(res, 400, { error: 'Missing slot' }); return }
              const imgPath = join(SPINE_HISTORY_DIR, slot, 'character.png')
              if (existsSync(imgPath)) {
                const data = readFileSync(imgPath)
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=3600' })
                res.end(data)
              } else {
                jsonRes(res, 404, { error: 'No thumbnail' })
              }
              return
            }
          } catch (err: any) {
            console.error('[wb-anim API GET Error]', req.url, err?.message)
            jsonRes(res, 200, { success: false, error: err.message || 'Server error' })
          }
          return next()
        }

        // POST routes
        if (req.method !== 'POST') return next()

        // Save spine session (large body)
        if (urlPath === '/__ce-api__/save-spine-session') {
          try {
            const body = await parseBody(req)
            const currentDir = join(SPINE_DIR, 'current')
            saveSpineSession(body, currentDir)
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            const historySlot = join(SPINE_HISTORY_DIR, ts)
            saveSpineSession(body, historySlot)
            pruneHistory()
            console.log(`[wb-anim API] Spine session saved (current + history/${ts})`)
            jsonRes(res, 200, { success: true, historySlot: ts })
          } catch (err: any) {
            console.error('[wb-anim API] Spine save error:', err.message)
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
        }

        try {
          const body = await parseBody(req)
          let result: any

          console.log(`[wb-anim API] ${urlPath}, body keys: ${Object.keys(body).join(',')}, body size: ~${Math.round(JSON.stringify(body).length / 1024)}KB`)

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
                  console.log('[generate-image] Azure edit failed, falling back to Gemini')
                  result = await geminiGenerateImage(body)
                }
              } else {
                result = await azureImageGenerate(body)
                if (!result.success) {
                  console.log('[generate-image] Azure gen failed, falling back to Gemini')
                  result = await geminiGenerateImage(body)
                }
              }
              break
            }
            case '/__ce-api__/gemini-text':
              result = await geminiGenerateText(body)
              break
            case '/__ce-api__/chat':
              result = await handleChat(body, claudeConfig)
              break
            case '/__ce-api__/character-turnaround':
              result = await handleCharacterTurnaround(body)
              break
            case '/__ce-api__/analyze-ultimate':
              result = await handleAnalyzeUltimate(body)
              break
            case '/__ce-api__/remove-bg':
              result = await handleRemoveBg(body)
              break
            case '/__ce-api__/video-generate':
              result = await handleVideoGenerate(body, klingConfig)
              break
            default:
              return next()
          }

          jsonRes(res, 200, result)
        } catch (err: any) {
          console.error('[wb-anim API Error]', req.url, err?.message, err?.stack?.slice(0, 500))
          jsonRes(res, 200, { success: false, error: err.message || 'Server error' })
        }
      })
    },
  }
}
