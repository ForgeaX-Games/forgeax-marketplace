/**
 * Vite server plugin: API proxy for AI services.
 * Runs server-side only — keys never reach the browser.
 *
 * 路由总览（`/__ce-api__/*`）：
 *   1. `/monster/**`             → 代理到本机 Python Flask（:5000）；monster-gen 管线用
 *   2. `/character-render-config` → 本地 JSON 文件读写（简单持久化）
 *   3. AI 能力（POST）            → /generate-image /gemini-text /chat /enhance-prompt
 *                                   /pixelart /video-generate /character-turnaround
 *                                   /analyze-ultimate /magic-prompt /remove-bg
 *   4. 文件持久化                  → /save-spine-session /load-spine-session
 *                                    /list-spine-sessions /spine-session-thumbnail
 *
 * 凭证读取顺序（统一走 forgeax-studio `.env`，见 ./env-credentials.ts）：
 *   - Gemini：env GEMINI_API_KEY
 *   - Claude：env LITELLM_PROXY_KEY+LITELLM_PROXY_BASE_URL（代理优先）→ ANTHROPIC_API_KEY+ANTHROPIC_BASE_URL
 *   - Azure GPT-Image：env AZURE_GPT_IMAGE_KEY + AZURE_GPT_IMAGE_ENDPOINT (+ optional API_VERSION/DEPLOYMENT)
 *   - Kling ：config/kling-video-credentials.json → server/keys.local.json[kling] → env
 *   - LLM 代理：env LLM_PROXY_URL（默认路由到 gemini-for-claude-code:8083）
 *   - MCP ：env MCP_HOST / MCP_PROMPT_PORT / MCP_PIXELART_PORT
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

// ── Monster pipeline Flask proxy config ─────────────────────────────
const MONSTER_HOST = process.env.MONSTER_BACKEND_HOST || '127.0.0.1'
const MONSTER_PORT = Number(process.env.MONSTER_BACKEND_PORT || '5000')

// ── Config (lazy getters — env loaded by Vite loadEnv before use) ────
const getMcpHost = () => process.env.MCP_HOST || 'vag-mcp-sandbox'
const getMcpPromptPort = () => Number(process.env.MCP_PROMPT_PORT || '3101')
const getMcpPixelartPort = () => Number(process.env.MCP_PIXELART_PORT || '3105')
const getLlmProxyUrl = () => process.env.LLM_PROXY_URL || ''
const GEMINI_MODEL = 'gemini-3-pro-image-preview'

let _proxyDown = false

async function geminiPost(model: string, payload: string, timeout = 180_000): Promise<{ status: number; body: string }> {
  const proxyUrl = getLlmProxyUrl()
  const apiKey = getGeminiApiKey()
  if (!proxyUrl && !apiKey) throw new Error('LLM_PROXY_URL 和 Gemini API Key 均未配置')

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

  if (!apiKey) throw new Error('Gemini API Key 未配置且 Proxy 不可用')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  return httpsPost(url, { 'Content-Type': 'application/json' }, payload, timeout)
}

let _cachedGeminiKey: string | null = null
function getGeminiApiKey(): string {
  if (_cachedGeminiKey !== null) return _cachedGeminiKey
  _cachedGeminiKey = pickGeminiKeyFromEnv(process.env as Record<string, string | undefined>)
  return _cachedGeminiKey
}

interface LLMConfig {
  apiKey: string
  apiBase: string
  model: string
}

function loadClaudeConfig(): LLMConfig {
  const fromEnv = pickClaudeFromEnv(process.env as Record<string, string | undefined>)
  if (fromEnv) return fromEnv

  // 兜底：让 LLM_PROXY_URL 也能撑起 Claude 调用（不阻断旧部署），key 留空让上游 surface 401
  const proxyUrl = getLlmProxyUrl()
  return {
    apiKey: '',
    apiBase: proxyUrl || '',
    model: 'claude-opus-4-6',
  }
}

// ── Kling Config ─────────────────────────────────────────────────────

interface KlingConfig { accessKey: string; secretKey: string }

function loadKlingConfig(): KlingConfig {
  // 1) MCP-compatible credentials file (same format as kling-video MCP)
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
  // 2) Legacy keys.local.json
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
  // 3) Environment variables
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

// ── Helpers ─────────────────────────────────────────────────────────

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

function mcpCall(host: string, port: number, tool: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: tool, arguments: args },
      id: Date.now(),
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

// ── Gemini Image Generation (via LLM proxy) ─────────────────────────

async function geminiGenerateImage(body: any): Promise<any> {
  const { prompt, aspectRatio, inputImageBase64, inputImages, model, imageSize } = body
  if (!prompt) return { success: false, error: '缺少 prompt' }

  const geminiModel = model || GEMINI_MODEL

  const contents: any[] = []
  const parts: any[] = []

  if (inputImageBase64) {
    let mime = 'image/png'
    if (inputImageBase64.startsWith('/9j/') || inputImageBase64.startsWith('/9J/')) mime = 'image/jpeg'
    parts.push({
      inlineData: { mimeType: mime, data: inputImageBase64 },
    })
  }

  if (Array.isArray(inputImages)) {
    for (const img of inputImages) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/png',
          data: img.base64,
        },
      })
    }
  }

  parts.push({ text: prompt })
  contents.push({ role: 'user', parts })

  const genConfig: any = {
    responseModalities: ['IMAGE'],
    temperature: 1.0,
  }
  const imgCfg: any = {}
  if (aspectRatio) imgCfg.aspectRatio = aspectRatio
  if (imageSize) imgCfg.imageSize = imageSize
  if (Object.keys(imgCfg).length > 0) genConfig.imageConfig = imgCfg

  const payload = JSON.stringify({
    contents,
    generationConfig: genConfig,
  })

  console.log(`[Gemini] Calling ${geminiModel}, aspectRatio: ${aspectRatio || 'NONE'}, prompt: ${prompt.slice(0, 80)}...`)

  const resp = await geminiPost(geminiModel, payload)

  if (resp.status !== 200) {
    let errMsg = `Gemini API error (${resp.status})`
    try {
      const errBody = JSON.parse(resp.body)
      errMsg = errBody.error?.message || errMsg
    } catch {}
    return { success: false, error: errMsg }
  }

  try {
    const data = JSON.parse(resp.body)
    const candidates = data.candidates || []
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || []
      for (const part of parts) {
        if (part.inlineData) {
          return {
            success: true,
            imageBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          }
        }
      }
    }

    const text = candidates[0]?.content?.parts?.[0]?.text || ''
    if (data.promptFeedback?.blockReason) {
      return { success: false, error: `内容被拦截: ${data.promptFeedback.blockReason}` }
    }
    return { success: false, error: text || '未生成图像' }
  } catch (e: any) {
    return { success: false, error: 'Gemini 响应解析失败: ' + e.message }
  }
}

// ── Azure OpenAI gpt-image-2 ─────────────────────────────────────────

/**
 * Strip Stable Diffusion weight syntax from prompts before sending to gpt-image-2.
 * `(masterpiece:1.4)` → `masterpiece`, `(NOT x, NOT y:1.5)` → `NOT x, NOT y`
 * Also remove stray numeric tags like `8k uhd`.
 */
function sanitizePromptForGPT(raw: string): string {
  return raw
    .replace(/\(([^)]+):[\d.]+\)/g, '$1')   // (text:1.4) → text
    .replace(/\s{2,}/g, ' ')                  // collapse double spaces
    .trim()
}

let _cachedAzureImage: AzureImageCredentials | null | undefined = undefined
function getAzureImageConfig(): AzureImageCredentials | null {
  if (_cachedAzureImage !== undefined) return _cachedAzureImage
  _cachedAzureImage = pickAzureImageFromEnv(process.env as Record<string, string | undefined>)
  return _cachedAzureImage
}

async function azureImageGenerate(body: any): Promise<any> {
  const creds = getAzureImageConfig()
  if (!creds) return { success: false, error: 'Azure OpenAI Image 凭据未配置（请在 .env 设置 AZURE_GPT_IMAGE_KEY + AZURE_GPT_IMAGE_ENDPOINT）' }

  const { prompt, aspectRatio, imageSize } = body
  if (!prompt) return { success: false, error: '缺少 prompt' }

  // Map aspect ratio to gpt-image-2 size format
  let size = '1024x1024'
  if (imageSize) {
    size = imageSize
  } else if (aspectRatio) {
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024',
      '16:9': '1536x1024',
      '9:16': '1024x1536',
      '3:4': '1024x1536',
      '4:3': '1536x1024',
      '3:2': '1536x1024',
      '2:3': '1024x1536',
    }
    size = sizeMap[aspectRatio] || '1024x1024'
  }

  const cleanPrompt = sanitizePromptForGPT(prompt)

  const payload = JSON.stringify({
    prompt: cleanPrompt,
    size,
    quality: body.quality || 'medium',
    output_format: 'png',
    output_compression: 100,
    n: 1,
  })

  const url = `${creds.apiBase}/openai/deployments/${creds.deployment}/images/generations?api-version=${creds.apiVersion}`

  console.log(`[gpt-image-2] Calling ${creds.deployment}, size: ${size}, prompt: ${cleanPrompt.slice(0, 100)}...`)

  try {
    const resp = await httpsPost(url, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${creds.apiKey}`,
    }, payload, 120_000)

    if (resp.status !== 200) {
      let errMsg = `gpt-image-2 API error (${resp.status})`
      try {
        const errBody = JSON.parse(resp.body)
        errMsg = errBody.error?.message || errMsg
      } catch {}
      console.error(`[gpt-image-2] Error: ${errMsg}`)
      return { success: false, error: errMsg }
    }

    const data = JSON.parse(resp.body)
    const b64 = data.data?.[0]?.b64_json
    if (b64) {
      return { success: true, imageBase64: b64, mimeType: 'image/png' }
    }

    const revisedPrompt = data.data?.[0]?.revised_prompt
    return { success: false, error: revisedPrompt ? `生成完成但未返回图像 (revised: ${revisedPrompt})` : '未返回图像数据' }
  } catch (e: any) {
    console.error(`[gpt-image-2] Request failed: ${e.message}`)
    return { success: false, error: `gpt-image-2 请求失败: ${e.message}` }
  }
}

/**
 * gpt-image-2 图生图（edits 端点）。
 * API 要求 multipart/form-data：image 字段为 PNG 文件，prompt 为文本。
 */
async function azureImageEdit(body: any): Promise<any> {
  const creds = getAzureImageConfig()
  if (!creds) return { success: false, error: 'Azure OpenAI Image 凭据未配置' }

  const { prompt, inputImageBase64, inputImages, aspectRatio, imageSize } = body
  if (!prompt) return { success: false, error: '缺少 prompt' }

  // Take the first available input image
  let imgB64: string | undefined = inputImageBase64
  if (!imgB64 && Array.isArray(inputImages) && inputImages.length > 0) {
    imgB64 = inputImages[0].base64
  }
  if (!imgB64) return { success: false, error: '缺少输入图片' }

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
  console.log(`[gpt-image-2 edit] size: ${size}, img: ${Math.round(imgBuf.length / 1024)}KB, prompt: ${prompt.slice(0, 80)}...`)

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
          console.error(`[gpt-image-2 edit] Error: ${errMsg}`)
          resolve({ success: false, error: errMsg })
          return
        }
        try {
          const data = JSON.parse(respBody)
          const b64 = data.data?.[0]?.b64_json
          if (b64) {
            resolve({ success: true, imageBase64: b64, mimeType: 'image/png' })
          } else {
            resolve({ success: false, error: '未返回图像数据' })
          }
        } catch (e: any) {
          resolve({ success: false, error: '响应解析失败: ' + e.message })
        }
      })
    })
    req.on('error', (e: any) => {
      console.error(`[gpt-image-2 edit] Request failed: ${e.message}`)
      resolve({ success: false, error: `请求失败: ${e.message}` })
    })
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: '请求超时 (120s)' }) })
    req.write(multipartBody)
    req.end()
  })
}

// ── Gemini Text (vision → text prompt generation, via LLM proxy) ────

async function geminiGenerateText(body: any): Promise<any> {
  const { prompt, inputImages, model } = body
  if (!prompt) return { success: false, error: '缺少 prompt' }

  // 调用方未传 model 时统一由 selectGeminiTextModel 决定；默认 `gemini-3.1-pro-preview`
  // （Claude 4.6 上游被封后，所有文本 LLM 路径统一走 Gemini 3.1 Pro）。
  const geminiModel = selectGeminiTextModel('analyze-image', {
    explicit: model,
    env: process.env,
  })

  const parts: any[] = []

  if (Array.isArray(inputImages)) {
    for (const img of inputImages) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/png',
          data: img.base64,
        },
      })
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

  console.log(`[Gemini Text] Calling ${geminiModel}, prompt: ${prompt.slice(0, 80)}..., images: ${inputImages?.length || 0}`)

  const resp = await geminiPost(geminiModel, payload)

  if (resp.status !== 200) {
    let errMsg = `Gemini API error (${resp.status})`
    try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
    return { success: false, error: errMsg }
  }

  try {
    const data = JSON.parse(resp.body)
    const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''
    if (!text) return { success: false, error: '未生成文本' }
    return { success: true, text }
  } catch (e: any) {
    return { success: false, error: 'Gemini 响应解析失败: ' + e.message }
  }
}

// ── LLM Chat (via proxy, Anthropic Messages format) ─────────────────

async function handleChat(body: any, config: LLMConfig): Promise<any> {
  const { messages, maxTokens, model, system } = body
  if (!messages?.length) return { success: false, error: '缺少 messages' }

  // Claude 4.6 目前在上游侧被封锁，默认直接走 Gemini（gemini-3.1-pro-preview）。
  // 保留 Claude 代码：一旦解封，设 env `USE_CLAUDE_CHAT=1` 即可切回。
  const useClaude = process.env.USE_CLAUDE_CHAT === '1'
  if (!useClaude) {
    return handleChatViaGemini(messages, maxTokens)
  }

  const useConfig = { ...config }
  if (model) useConfig.model = model

  if (!useConfig.apiBase || !useConfig.apiKey) {
    console.log('[Chat] Claude not configured, falling back to Gemini...')
    return handleChatViaGemini(messages, maxTokens)
  }

  const payloadObj: any = {
    model: useConfig.model,
    max_tokens: maxTokens || 4096,
    messages,
  }
  if (system) payloadObj.system = system
  const payload = JSON.stringify(payloadObj)

  let chatUrl = useConfig.apiBase.replace(/\/+$/, '')
  if (!chatUrl.endsWith('/v1/messages')) {
    chatUrl += '/v1/messages'
  }

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

async function handleChatViaGemini(messages: any[], maxTokens?: number): Promise<any> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    return { success: false, error: 'Claude 未配置且 Gemini API Key 也未设置。请将 gemini-credentials.json 放入 config/ 目录' }
  }

  const geminiModel = selectGeminiTextModel('chat-fallback', { env: process.env })
  const contents = messages.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }))

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`
  const payloadGemini = JSON.stringify({
    contents,
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: maxTokens ? Math.max(maxTokens, 4096) : 8192,
    },
  })

  const inputLen = contents.reduce((acc: number, c: any) => acc + (c.parts?.[0]?.text?.length || 0), 0)
  console.log(`[Chat→Gemini] model=${geminiModel}, messages=${messages.length}, inputChars=${inputLen}`)

  const resp = await httpsPost(apiUrl, { 'Content-Type': 'application/json' }, payloadGemini, 120_000)

  if (resp.status !== 200) {
    let errMsg = `Gemini API error (${resp.status})`
    try {
      const errData = JSON.parse(resp.body)
      errMsg = errData.error?.message || errMsg
      console.warn('[Chat→Gemini] API error:', resp.status, errMsg)
    } catch {}
    return { success: false, error: errMsg }
  }

  try {
    const data = JSON.parse(resp.body)
    const candidate = data.candidates?.[0]

    if (!candidate) {
      const blockReason = data.promptFeedback?.blockReason
      console.warn('[Chat→Gemini] No candidates returned. promptFeedback:', JSON.stringify(data.promptFeedback))
      return { success: false, error: blockReason ? `Gemini 拒绝生成 (${blockReason})，请简化角色描述后重试` : 'Gemini 未返回结果' }
    }

    if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      console.warn('[Chat→Gemini] finishReason:', candidate.finishReason)
      return { success: false, error: `Gemini 中止生成 (${candidate.finishReason})，请调整描述后重试` }
    }

    const text = candidate.content?.parts?.map((p: any) => p.text || '').join('') || ''
    if (!text) {
      console.warn('[Chat→Gemini] Empty text. Full candidate:', JSON.stringify(candidate).slice(0, 500))
      return { success: false, error: 'Gemini 未生成文本，可能是内容安全策略触发，请调整角色描述后重试' }
    }
    return { success: true, text }
  } catch (e: any) {
    return { success: false, error: 'Gemini 响应解析失败: ' + e.message }
  }
}

// ── MCP Tools ───────────────────────────────────────────────────────

async function handleEnhancePrompt(body: any): Promise<any> {
  const { prompt, style } = body
  if (!prompt) return { success: false, error: '缺少 prompt' }

  const result = await mcpCall(getMcpHost(), getMcpPromptPort(), 'enhance_prompt', {
    prompt,
    style: style || 'game-character',
  })

  if (result.error) {
    return { success: false, error: result.error.message || JSON.stringify(result.error) }
  }

  const text = result.result?.content?.map((c: any) => c.text).join('') || ''
  return { success: true, enhanced: text }
}

async function handlePixelart(body: any): Promise<any> {
  const { tool, ...args } = body
  if (!tool) return { success: false, error: '缺少 tool' }

  const result = await mcpCall(getMcpHost(), getMcpPixelartPort(), tool, args)
  if (result.error) {
    return { success: false, error: result.error.message || JSON.stringify(result.error) }
  }

  const content = result.result?.content
  const text = content?.map((c: any) => c.text).join('') || ''

  for (const c of (content || [])) {
    if (c.type === 'image') {
      return { success: true, imageBase64: c.data, mimeType: c.mimeType || 'image/png', text }
    }
  }

  const pathMatch = text.match(/workspace\/[^\s\n"]+\.(png|gif)/i)
  if (pathMatch) {
    const absPath = `/workspace/${pathMatch[0].replace(/^workspace\//, '')}`
    try {
      const data = readFileSync(absPath)
      return { success: true, imageBase64: data.toString('base64'), mimeType: 'image/png', path: pathMatch[0], text }
    } catch {}
  }

  return { success: true, text }
}

// ── Kling: Video Generation ──────────────────────────────────────────

const KLING_BASE = 'https://api-beijing.klingai.com'

async function handleVideoGenerate(body: any, klingCfg: KlingConfig): Promise<any> {
  const { prompt, image_base64, end_frame_base64, mode, aspect_ratio, duration } = body
  if (!prompt && !image_base64) return { success: false, error: '请提供文本描述或上传图片' }

  await calibrateClock()
  const token = klingJWT(klingCfg)
  const reqBody: any = {
    model_name: 'kling-v3-omni',
    mode: mode === 'pro' ? 'pro' : 'std',
    duration: String(duration || '5'),
  }

  if (image_base64) {
    reqBody.prompt = prompt || '让图片中的内容动起来'
    const stripDataPrefix = (b64: string) =>
      b64.startsWith('data:') ? b64.replace(/^data:[^;]+;base64,/, '') : b64
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

// ── Kling: Video Proxy ──────────────────────────────────────────────

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

// ── Turnaround: Gemini multi-image generation ───────────────────────

// ── Turnaround: post-process — normalize character size across views ─

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

    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

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

    if (maxX <= minX || maxY <= minY) {
      console.warn('[Normalize] No non-white content detected, returning original')
      return { base64, mime }
    }

    const charW = maxX - minX + 1
    const charH = maxY - minY + 1

    const cropped = sharp(buf).extract({ left: minX, top: minY, width: charW, height: charH })

    const targetH = Math.round(H * NORM_CHAR_HEIGHT_RATIO)
    const scale = targetH / charH
    const targetW = Math.round(charW * scale)

    const resized = await cropped
      .resize(targetW, targetH, { fit: 'fill' })
      .png()
      .toBuffer()

    const footY = Math.round(H * (1 - NORM_FOOT_BOTTOM_MARGIN))
    const topY = footY - targetH
    const leftX = Math.round((W - targetW) / 2)

    const canvas = sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png()

    const result = await canvas
      .composite([{ input: resized, left: leftX, top: topY }])
      .png()
      .toBuffer()

    console.log(
      `[Normalize] bbox=${charW}x${charH} → resized=${targetW}x${targetH}, placed at (${leftX},${topY}) on ${W}x${H} canvas`,
    )
    return { base64: result.toString('base64'), mime: 'image/png' }
  } catch (err: any) {
    console.error('[Normalize] Failed, returning original:', err.message)
    return { base64, mime }
  }
}

// ── Turnaround: template-based stable generation ────────────────────

const TURNAROUND_PERSPECTIVE =
  'Subtle top-down camera (~30° above eye level). Top of head visible, body curves arc slightly downward, feet slightly smaller due to perspective.'

const TURNAROUND_FRAMING =
  'Character fills ~60% of frame height. Head sits in the top 20% of the frame, feet sit in the bottom 15%. Horizontally centered.'

const TURNAROUND_CANVAS =
  'White background (#FFFFFF), no shadow, no ground, no environment.'

const TURNAROUND_STYLE_MATCH =
  'CRITICAL: Replicate the exact art style of the character in the design reference — same rendering technique, color palette, line weight, and shading. ' +
  'If the reference is 2D illustration, output 2D illustration. If pixel art, output pixel art. If anime cel-shading, output anime cel-shading. ' +
  'Do NOT convert to 3D rendering. Do NOT add photorealistic lighting or textures.'

const TURNAROUND_OUTPUT_RULES =
  'OUTPUT RULES (MANDATORY): ' +
  '1) Output EXACTLY ONE single character — no duplicates, no extra figures, no accessories floating separately. ' +
  '2) Single character, exactly two feet. ' +
  '3) No text, no labels, no watermarks, no UI elements. ' +
  '4) Render at high resolution with sharp, clean lines and fine details.'

const TURNAROUND_NEGATIVE = 'multiple characters, extra limbs, extra feet, duplicate character'

const TURNAROUND_POSE: Record<string, string> = {
  front: [
    TURNAROUND_PERSPECTIVE,
    'Body faces camera directly, perfectly symmetrical, zero rotation.',
    'Both legs straight and pressed together — inner ankles and inner knees touching. Two feet side by side with no gap, on the same horizontal line.',
    'Arms relaxed at sides.',
    TURNAROUND_FRAMING,
  ].join(' '),
  side: [
    TURNAROUND_PERSPECTIVE,
    'Body rotated ~60° from front, facing RIGHT. This is a 3/4 side view — part of the front chest/torso is still visible, but the body is predominantly seen from the right side.',
    'Head turned right, nose points toward the right edge.',
    'Right arm visible in front, left arm mostly hidden behind torso.',
    'Legs close together, right foot slightly ahead of left.',
    TURNAROUND_FRAMING,
  ].join(' '),
  back: [
    TURNAROUND_PERSPECTIVE,
    'Body faces directly away from camera, symmetrical rear view.',
    'Legs in narrow stance close together, feet on the same horizontal line.',
    'Arms relaxed at sides.',
    TURNAROUND_FRAMING,
  ].join(' '),
}

const TURNAROUND_VIEW_LABEL: Record<string, string> = {
  front: 'front-facing',
  side: 'right-facing side-profile',
  back: 'rear-facing',
}

const TURNAROUND_APPEAR_NOTE: Record<string, string> = {
  front: 'shown from the front',
  side: 'shown from the right side',
  back: 'shown from the back',
}

function buildTurnaroundParts(
  view: string,
  templateB64: string,
  characterB64: string,
  style?: string,
  userPrompt?: string,
  extraDesc?: string,
): any[] {
  const viewLabel = TURNAROUND_VIEW_LABEL[view] || view
  const appearNote = TURNAROUND_APPEAR_NOTE[view] || view
  const pose = TURNAROUND_POSE[view] || TURNAROUND_POSE['front']
  const extra = [style, userPrompt, extraDesc].filter(Boolean).join(' ')

  if (view === 'idle') {
    const parts: any[] = [
      { text: 'Character design reference — match this character\'s appearance exactly:' },
      { inlineData: { mimeType: 'image/png', data: characterB64 } },
      { text: [
        'Task: Generate ONE image of this character in a 3/4 view (45-degree angle) idle pose.',
        '',
        `FACING DIRECTION (CRITICAL): The character's body and face MUST point toward the RIGHT edge of the image. The character faces screen-right (east direction). The character's nose, chest, and toes all point to the right. The left shoulder is closer to the camera, the right shoulder is farther away. This is NOT optional — a left-facing result is WRONG.`,
        '',
        'The character should be in a relaxed, natural idle pose — one hand on hip, slight lean, or combat-ready relaxed stance. NOT a T-pose.',
        '',
        TURNAROUND_PERSPECTIVE,
        TURNAROUND_FRAMING,
        '',
        `Appearance: exact same outfit, weapon, colors, art style, proportions.`,
        TURNAROUND_STYLE_MATCH,
        TURNAROUND_OUTPUT_RULES,
        TURNAROUND_CANVAS,
        extra ? `Additional instructions: ${extra}` : '',
        `\n\nIMPORTANT: The image must NOT contain any of these: ${TURNAROUND_NEGATIVE}`,
      ].filter(Boolean).join('\n') },
    ]
    return parts
  }

  const parts: any[] = [
    { text: `Pose/angle/size reference — match this mannequin's ${viewLabel} pose exactly:` },
    { inlineData: { mimeType: 'image/png', data: templateB64 } },
    { text: 'Character design reference — match this character\'s appearance exactly:' },
    { inlineData: { mimeType: 'image/png', data: characterB64 } },
    { text: [
      `Redraw the character from the design reference in the mannequin's ${viewLabel} pose.`,
      '',
      `Pose: ${pose}`,
      `Appearance: exact same outfit, weapon, colors, art style, proportions — ${appearNote}.`,
      '',
      TURNAROUND_STYLE_MATCH,
      '',
      `Single character, exactly two feet.${view === 'front' ? ' Legs together, no gap between ankles.' : ''} ${TURNAROUND_CANVAS}`,
      TURNAROUND_OUTPUT_RULES,
      extra ? `\nAdditional instructions: ${extra}` : '',
      `\n\nIMPORTANT: The image must NOT contain any of these: ${TURNAROUND_NEGATIVE}`,
    ].filter(Boolean).join('\n') },
  ]
  return parts
}

async function generateSingleView(characterBase64: string, view: string, style?: string, userPrompt?: string, extraDesc?: string): Promise<{ base64: string; mime: string } | { error: string }> {
  const templateDir = resolve(process.cwd(), 'public/assets/turnaround')
  const templatePath = resolve(templateDir, `turnaround-${view}.png`)
  let templateB64 = ''
  if (existsSync(templatePath)) {
    templateB64 = readFileSync(templatePath).toString('base64')
  }

  const parts = buildTurnaroundParts(view, templateB64, characterBase64, style, userPrompt, extraDesc)

  // Uses geminiPost with auto-fallback
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '1:1' },
    },
  })

  console.log(`[Turnaround] Generating ${view} view (template-based)...`)
  const resp = await geminiPost(GEMINI_MODEL, payload, 120_000)
  if (resp.status !== 200) {
    let errMsg = `Gemini error (${resp.status})`
    try { errMsg = JSON.parse(resp.body).error?.message || errMsg } catch {}
    console.error(`[Turnaround] ${view} FAILED: ${errMsg}`)
    return { error: `${view}: ${errMsg}` }
  }

  const data = JSON.parse(resp.body)
  const candidate = data.candidates?.[0]

  if (!candidate) {
    const blockReason = data.promptFeedback?.blockReason || ''
    console.error(`[Turnaround] ${view} NO CANDIDATE. blockReason=${blockReason}`)
    return { error: `${view}: ${blockReason || '模型未返回结果'}` }
  }

  const imgPart = candidate.content?.parts?.find((pt: any) => pt.inlineData)
  if (!imgPart) {
    const textPart = candidate.content?.parts?.[0]?.text || ''
    const blockReason = data.promptFeedback?.blockReason || ''
    const finishReason = candidate.finishReason || ''
    console.error(`[Turnaround] ${view} NO IMAGE. finish=${finishReason}, block=${blockReason}, text=${textPart.slice(0, 100)}`)
    return { error: `${view}: ${blockReason || finishReason || textPart || '未生成图像'}` }
  }

  console.log(`[Turnaround] ${view} OK, size=${Math.round(imgPart.inlineData.data.length / 1024)}KB`)
  return { base64: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/png' }
}

async function handleCharacterTurnaround(body: any): Promise<any> {
  const { characterBase64, prompt, style, singleView, extraDesc } = body
  if (!characterBase64) return { success: false, error: '缺少角色图' }

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

// ── Analyze Ultimate: design sheet → prompt ─────────────────────────

async function handleAnalyzeUltimate(body: any): Promise<any> {
  const { design_image_base64 } = body
  if (!design_image_base64) return { success: false, error: '请上传角色设计图' }

  const analyzePrompt = `你是一名专业的游戏角色动画导演，精通可灵AI视频生成平台的提示词编写。

我会给你一张角色图片。请你：
1. 仔细观察角色的外貌特征（发型发色、服饰穿搭、武器装备、五官形态、体型比例）
2. 如果图片中有招式/技能动作参考，分析其动作特点
3. 根据角色特征，设计一个符合其身份的5秒炫酷大招动画

请严格按照以下公式生成提示词：
提示词 = 主体(主体描述) + 运动 + 场景(场景描述) + 镜头语言 + 光影 + 氛围

各部分说明：
- 主体：角色的身份（如"一位持剑的女战士"），用多个短句描述外貌细节
- 主体描述：发型发色、服饰穿搭、武器外观、五官形态等，从图片中直接观察提取
- 运动：将5秒拆分为"蓄力"和"释放"两个阶段（无需收招），蓄力阶段占3秒，释放阶段占2秒。蓄力阶段拆分为2-3个镜头，其中表现人物面部/身体的镜头适当延长时长来烘托角色气势释放阶段的最终画面，释放阶段技能特效必须铺满整个屏幕，形成强烈的视觉冲击——如能量波席卷全画面、爆炸光芒吞没一切、巨型法阵/斩击充满整个镜头。
- 场景：角色释放大招时的场景环境（如废墟战场、魔法阵、风暴中心等），需要有丰富的环境背景，不要白色或纯色背景
- 镜头语言：积极使用多种镜头增加画面张力——斜角镜头（Dutch angle）营造不安/紧张感，在合适情景下使用希区柯克变焦（Dolly zoom）制造空间扭曲的戏剧效果，鱼眼镜头（Fisheye）增强冲击力。蓄力阶段可用特写+慢推来聚焦角色表情和蓄力动作，释放阶段切换为大广角/仰拍展现技能全貌。镜头之间有节奏变化，避免全程使用同一机位
- 光影：如氛围光照、能量光芒、丁达尔效应等
- 氛围：如史诗感、电影级调色、热血沸腾等

要求：
- 中文输出
- 100-150字
- 只输出提示词本身，不要任何解释、标题或编号
- 不要使用"提示词=""、引号或任何格式标记`

  const result = await geminiGenerateText({
    prompt: analyzePrompt,
    inputImages: [{ base64: design_image_base64, mimeType: 'image/png' }],
    model: selectGeminiTextModel('analyze-image', { env: process.env }),
  })
  if (!result.success) return result
  return { success: true, prompt: result.text.trim() }
}

// ── Magic Prompt: enhance user prompt ───────────────────────────────

async function handleMagicPrompt(body: any): Promise<any> {
  const { prompt, locale } = body
  if (!prompt) return { success: false, error: '缺少 prompt' }

  const sysZh = '你是一位专业的 AI 绘画提示词工程师。将用户的简单描述转化为详细、高质量的中文图像生成提示词。\n\n规则：\n1. 只输出优化后的提示词\n2. 包含：主体细节、环境、光照、材质、镜头角度、渲染风格\n3. 控制在 200 字以内\n4. 用逗号分隔描述词'
  const sysEn = 'You are a professional AI art prompt engineer. Transform simple descriptions into detailed, high-quality image generation prompts in English.\n\nRules:\n1. Output ONLY the enhanced prompt\n2. Include: subject details, environment, lighting, materials, camera angle, render style\n3. Keep it under 200 words\n4. Use comma-separated descriptors'

  const systemPrompt = locale === 'zh' ? sysZh : sysEn
  const result = await geminiGenerateText({
    prompt: systemPrompt + '\n\nUser input: ' + prompt,
    model: selectGeminiTextModel('magic-prompt', { env: process.env }),
  })
  if (!result.success) return result
  return { success: true, enhanced: result.text.trim() }
}

// ── Remove Background ────────────────────────────────────────────────

const REMBG_URL = process.env.REMBG_URL || 'http://127.0.0.1:5001'

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
  if (!image) return { success: false, error: '未提供图片数据' }

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
    console.log(`[remove-bg] Local service unavailable (${e.message}), falling back to Gemini...`)
  }

  // Fallback: use Gemini to redraw on pure white bg, then client-side whiteToAlpha
  try {
    const result = await geminiGenerateImage({
      prompt: 'Redraw this exact image with the subject placed on a perfectly uniform pure white (#FFFFFF) background. Keep the subject IDENTICAL — same pose, same details, same colors, same size, same position. Only change the background to solid pure white. No shadows, no gradients, no gray — pure white (#FFFFFF) everywhere except the subject.',
      inputImageBase64: image,
      model: 'gemini-3-pro-image-preview',
    })
    if (result.success && result.imageBase64) {
      return { success: true, image: result.imageBase64, needsWhiteToAlpha: true }
    }
    return { success: false, error: 'Gemini 去背景失败: ' + (result.error || '未知错误') }
  } catch (e: any) {
    return { success: false, error: 'Gemini fallback 失败: ' + e.message }
  }
}

// ── Spine Session Persistence ────────────────────────────────────────

const SPINE_DIR = resolve(process.cwd(), 'workspace/spine')
const SPINE_HISTORY_DIR = resolve(SPINE_DIR, 'history')
const MAX_HISTORY = 20

// ── Character Publish (→ game engine shared volume) ──────────────────
// Writes to /app/character-export in dev (docker-compose bind-mounts
// packages/game_templates/templates/basic/phaser-2d/public/characters → here).
// Fallback: <cwd>/character-export for non-docker dev.
const CHARACTER_EXPORT_DIR = existsSync('/app/character-export')
  ? '/app/character-export'
  : resolve(process.cwd(), 'character-export')

// 工作区游戏根目录（./data/workspace/games）。docker-compose 把它挂在
// character-editor 容器的 /workspace-games；本地 vite dev 直接用宿主相对路径。
// 每个子目录是一个游戏 UUID，内部按 Vite public 约定：
//   <gameId>/public/assets/art/characters/<slot>/character.manifest.json
const WORKSPACE_GAMES_DIR = existsSync('/workspace-games')
  ? '/workspace-games'
  : resolve(process.cwd(), '../../data/workspace/games')

/** Reject characterIds that could escape the export root */
function isSafeCharacterId(id: unknown): id is string {
  return typeof id === 'string'
      && id.length > 0
      && id.length < 128
      && /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(id)
}

/** 游戏 UUID 严格采用 RFC4122 十六进制+短横线，或至少是无跨目录字符的标识。 */
function isSafeGameId(id: unknown): id is string {
  return typeof id === 'string'
      && id.length > 0
      && id.length < 128
      && /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(id)
}

/**
 * Write a freshly published character package to the shared volume.
 * Body schema: { characterId, manifest, files: { 'sprites/attack/atlas_down.png': '<base64>' } }
 *
 * Implementation notes:
 *   - Target dir is wiped then recreated (fresh publish, no stale atlases).
 *   - Any file path containing '..' is rejected to prevent traversal.
 *   - Manifest is written as pretty JSON so downstream diffs are readable.
 */
function publishCharacter(body: any): { success: true; dir: string; fileCount: number } {
  if (!isSafeCharacterId(body?.characterId)) {
    throw new Error('Invalid characterId (must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')
  }
  if (!body.manifest || typeof body.manifest !== 'object') {
    throw new Error('Missing manifest')
  }
  const files = (body.files || {}) as Record<string, string>
  if (typeof files !== 'object') throw new Error('files must be an object')

  const charDir = resolve(CHARACTER_EXPORT_DIR, body.characterId)
  // Clean previous export so removed atlases don't stick around
  if (existsSync(charDir)) rmSync(charDir, { recursive: true, force: true })
  ensureDir(charDir)

  let fileCount = 0
  for (const [relPath, b64] of Object.entries(files)) {
    if (typeof relPath !== 'string' || relPath.includes('..') || relPath.startsWith('/')) {
      throw new Error(`Illegal file path: ${relPath}`)
    }
    if (typeof b64 !== 'string') continue
    const abs = resolve(charDir, relPath)
    if (!abs.startsWith(charDir + '/') && abs !== charDir) {
      throw new Error(`Path escapes target dir: ${relPath}`)
    }
    ensureDir(resolve(abs, '..'))
    const match = b64.match(/^data:[^;]+;base64,(.+)$/)
    const raw = match ? match[1] : b64
    writeFileSync(abs, Buffer.from(raw, 'base64'))
    fileCount++
  }

  writeFileSync(
    resolve(charDir, 'character.manifest.json'),
    JSON.stringify(body.manifest, null, 2),
    'utf-8',
  )
  fileCount++

  console.log(`[API Proxy] publish-character: ${body.characterId} → ${charDir} (${fileCount} files)`)
  return { success: true, dir: charDir, fileCount }
}

/**
 * 列出 data/workspace/games/ 下的游戏 UUID 目录。
 * 过滤隐藏文件、非目录、以及目录里没有 package.json 或 src/ 的（避免列出脏目录）。
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
    // "是不是游戏工程" 的最小启发：要么有 package.json，要么有 public/。
    // 不做硬校验，让脏目录也能出现但可识别；前端按 hasPlayerSlot 决定默认值。
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
 * 把角色包发布到 data/workspace/games/<gameId>/public/assets/art/characters/<slot>/。
 *
 * 与 publishCharacter() 的区别：
 *   - 目标是真实的游戏工程目录（不是 phaser-2d 模板共享卷）
 *   - 必须显式给 gameId；不用 auto-pick，避免误写
 *   - slot（characterId）约定：'player' = 主角，'enemy_thug' = 喽啰，等等
 *
 * 前置条件：docker-compose 把 ./data/workspace/games 挂在 /workspace-games。
 */
function publishToWorkspaceGame(body: any): { success: true; dir: string; fileCount: number } {
  if (!isSafeGameId(body?.gameId)) {
    throw new Error('Invalid gameId (must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')
  }
  if (!isSafeCharacterId(body?.characterId)) {
    throw new Error('Invalid characterId (must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')
  }
  if (!body.manifest || typeof body.manifest !== 'object') {
    throw new Error('Missing manifest')
  }
  const files = (body.files || {}) as Record<string, string>
  if (typeof files !== 'object') throw new Error('files must be an object')

  const gameRoot = resolve(WORKSPACE_GAMES_DIR, body.gameId)
  if (!existsSync(gameRoot)) {
    throw new Error(`Game directory not found: ${body.gameId} (looked in ${WORKSPACE_GAMES_DIR})`)
  }
  // 防止 gameId 里有符号链接逃逸到 WORKSPACE_GAMES_DIR 之外
  if (!gameRoot.startsWith(WORKSPACE_GAMES_DIR + '/') && gameRoot !== WORKSPACE_GAMES_DIR) {
    throw new Error(`Path escapes workspace games dir: ${body.gameId}`)
  }

  const charDir = resolve(gameRoot, 'public/assets/art/characters', body.characterId)
  // Clean previous export so removed atlases don't stick around
  if (existsSync(charDir)) rmSync(charDir, { recursive: true, force: true })
  ensureDir(charDir)

  let fileCount = 0
  for (const [relPath, b64] of Object.entries(files)) {
    if (typeof relPath !== 'string' || relPath.includes('..') || relPath.startsWith('/')) {
      throw new Error(`Illegal file path: ${relPath}`)
    }
    if (typeof b64 !== 'string') continue
    const abs = resolve(charDir, relPath)
    if (!abs.startsWith(charDir + '/') && abs !== charDir) {
      throw new Error(`Path escapes target dir: ${relPath}`)
    }
    ensureDir(resolve(abs, '..'))
    const match = b64.match(/^data:[^;]+;base64,(.+)$/)
    const raw = match ? match[1] : b64
    writeFileSync(abs, Buffer.from(raw, 'base64'))
    fileCount++
  }

  writeFileSync(
    resolve(charDir, 'character.manifest.json'),
    JSON.stringify(body.manifest, null, 2),
    'utf-8',
  )
  fileCount++

  console.log(`[API Proxy] publish-to-workspace-game: ${body.gameId}/${body.characterId} → ${charDir} (${fileCount} files)`)
  return { success: true, dir: charDir, fileCount }
}

/**
 * 把 VFX 管线产出的 `ExportedSkill[]` 合并到已经发布的 character.manifest.json。
 *
 * 设计约束：
 *   - character 必须先存在（用户走过 pixel-char 的"导入到游戏作为主角"）；否则
 *     没有 action 清单可以绑定。返回 400 让前端引导用户去做第一步。
 *   - 合并规则：按 `slotId` upsert。旧 manifest 里 slotId 匹配的被覆盖；新槽位
 *     追加。这样 VFX 管线可以多次导入"只更新 ultimate"这种小改。
 *   - 过滤 orphan skill：引用不存在的 actionId 的 skill 直接跳过，并返回给前端
 *     toast 提示（避免写入后游戏端 findAction 返回 undefined 而静默失败）。
 *   - 不改 actions / 尺寸 / sprite 文件。只动 skills 数组。
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
    throw new Error(`Character not found: ${body.characterId} in game ${body.gameId}. 请先在"像素角色"管线点「导入到游戏作为主角」。`)
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
  console.log(`[API Proxy] merge-skills: ${body.gameId}/${body.characterId} → +${applied.length} applied, ${skipped.length} skipped`)

  return {
    success: true,
    dir: charDir,
    skillsApplied: applied.length,
    skillsSkipped: skipped.length,
    skippedDetail: skipped,
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function b64ToFile(dataUrl: string, filePath: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    writeFileSync(filePath, dataUrl, 'utf-8')
    return filePath
  }
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

  if (body.characterImage) {
    b64ToFile(body.characterImage, join(slotDir, 'character.png'))
    meta.hasCharacterImage = true
  }
  if (body.explosionImage) {
    b64ToFile(body.explosionImage, join(slotDir, 'explosion.png'))
    meta.hasExplosionImage = true
  }

  if (Array.isArray(body.partRegions)) {
    for (const r of body.partRegions) {
      const partMeta: any = { id: r.id, name: r.name, x: r.x, y: r.y, width: r.width, height: r.height }
      if (r.imageData && r.width > 0) {
        b64ToFile(r.imageData, join(partsDir, `${r.id}.png`))
        partMeta.hasImage = true
      }
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

  if (meta.hasCharacterImage) {
    result.characterImage = fileToB64(join(slotDir, 'character.png'))
  }
  if (meta.hasExplosionImage) {
    result.explosionImage = fileToB64(join(slotDir, 'explosion.png'))
  }

  const partsDir = join(slotDir, 'parts')
  if (Array.isArray(meta.partRegionsMeta)) {
    for (const pm of meta.partRegionsMeta) {
      const region: any = { id: pm.id, name: pm.name, x: pm.x, y: pm.y, width: pm.width, height: pm.height, imageData: '' }
      if (pm.hasImage) {
        region.imageData = fileToB64(join(partsDir, `${pm.id}.png`)) || ''
      }
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

  for (const dir of dirs.slice(MAX_HISTORY)) {
    try { rmSync(join(SPINE_HISTORY_DIR, dir), { recursive: true, force: true }) } catch {}
  }
}

// ── Monster pipeline HTTP proxy ─────────────────────────────────────
/**
 * Forwards `/__ce-api__/monster/<rest>` to Flask `/api/<rest>` on MONSTER_HOST:MONSTER_PORT.
 *
 * Strategy:
 *   - For non-SSE requests we buffer the full request body in memory, then send
 *     it with an explicit Content-Length. Naively `req.pipe(proxyReq)` was
 *     producing "socket hang up" on multi-MB uploads, likely because chunked
 *     transfer combined with Werkzeug's dev server doesn't agree under load.
 *   - For SSE endpoints (/pipeline/status/<pid>) we still stream, because they
 *     are long-lived and we need the server-sent events to arrive as they land.
 *   - We pipe the RESPONSE stream so binary (hero.png / zip) and SSE payloads
 *     reach the browser unchanged.
 *   - Timeout is 300s so slow Gemini generations don't get cut off early.
 */
function proxyToMonsterFlask(
  req: IncomingMessage,
  res: ServerResponse,
  targetPath: string,
): void {
  const isSSE = targetPath.includes('/pipeline/status/')

  const forward = (bodyBuf: Buffer | null) => {
    // Minimal header set — Werkzeug dev server is picky with unexpected
    // headers (e.g. Expect: 100-continue, Sec-* headers from browsers), so
    // we rebuild a clean JSON POST instead of forwarding every browser header.
    const upstreamHeaders: Record<string, string> = {
      host: `${MONSTER_HOST}:${MONSTER_PORT}`,
      accept: (req.headers['accept'] as string) || 'application/json, text/event-stream',
      'content-type': (req.headers['content-type'] as string) || 'application/json',
      connection: 'close',
    }
    if (bodyBuf) upstreamHeaders['content-length'] = String(bodyBuf.length)

    const options = {
      hostname: MONSTER_HOST,
      port: MONSTER_PORT,
      path: targetPath,
      method: req.method,
      headers: upstreamHeaders,
      // Disable HTTP keep-alive pool so each request gets a fresh socket —
      // Werkzeug's dev server occasionally drops pooled sockets.
      agent: false as const,
    }

    const bodyInfo = bodyBuf ? `${(bodyBuf.length / 1024).toFixed(1)}KB` : '(none)'
    console.log(`[ce-api-proxy] → ${req.method} ${targetPath} body=${bodyInfo}`)

    const proxyReq = httpRequest(options, (proxyRes) => {
      console.log(`[ce-api-proxy] ← ${proxyRes.statusCode} ${targetPath}`)
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
      proxyRes.on('error', (err) => {
        console.error('[ce-api-proxy] upstream response stream error:', err.message)
        if (!res.writableEnded) res.end()
      })
      proxyRes.pipe(res, { end: true })
    })

    // 5-minute ceiling for slow Gemini generations; without this, some stacks
    // fall back to a short keep-alive timeout and drop the socket silently.
    proxyReq.setTimeout(300_000, () => {
      console.error(`[ce-api-proxy] Monster backend timeout on ${targetPath}`)
      proxyReq.destroy(new Error('upstream timeout after 300s'))
    })

    proxyReq.on('error', (err: NodeJS.ErrnoException) => {
      const isRefused = err.code === 'ECONNREFUSED'
      const detail = `${err.code || 'ERR'}: ${err.message}`
      console.error(
        isRefused
          ? '[ce-api-proxy] Monster backend not running — start it with:\n' +
            '  cd character-editor/server/monster-pipeline && python server.py'
          : `[ce-api-proxy] Monster backend error on ${targetPath}: ${detail}`,
      )
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(
          JSON.stringify({
            error: isRefused
              ? '怪物生成后端未启动，请在 server/monster-pipeline/ 目录运行：python server.py'
              : `代理错误: ${detail}`,
          }),
        )
      } else if (!res.writableEnded) {
        res.end()
      }
    })

    if (bodyBuf) {
      proxyReq.end(bodyBuf)
    } else if (isSSE || req.method === 'GET' || req.method === 'HEAD') {
      proxyReq.end()
    } else {
      // Fallback for non-buffered streaming; practically unreachable.
      req.pipe(proxyReq, { end: true })
    }
  }

  if (isSSE || req.method === 'GET' || req.method === 'HEAD') {
    forward(null)
    return
  }

  // Buffer the request body; abort cleanly if the browser disconnects mid-upload.
  const chunks: Buffer[] = []
  let aborted = false
  let totalSize = 0
  const MAX_BODY_BYTES = 40 * 1024 * 1024 // 40 MB ceiling, matches backend limit

  req.on('data', (chunk: Buffer) => {
    if (aborted) return
    totalSize += chunk.length
    if (totalSize > MAX_BODY_BYTES) {
      aborted = true
      console.error(`[ce-api-proxy] Body too large on ${targetPath}: ${totalSize} bytes`)
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: `请求体过大 (${totalSize} bytes)，最大 40MB` }))
      }
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (aborted) return
    forward(Buffer.concat(chunks))
  })
  req.on('error', (err) => {
    console.error('[ce-api-proxy] client request stream error:', err.message)
    aborted = true
    if (!res.headersSent) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: `客户端请求中断: ${err.message}` }))
    }
  })
}

// ── Character render config (simple JSON persistence) ───────────────
/**
 * Stores CharacterRenderPanel's settings at public/character-render/character-render.json.
 * Frontend uses GET to load and POST to save.
 */
function handleCharacterRenderConfig(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const settingsDir = resolve(process.cwd(), 'public/character-render')
  const settingsPath = resolve(settingsDir, 'character-render.json')

  if (req.method === 'GET') {
    try {
      if (existsSync(settingsPath)) {
        const raw = readFileSync(settingsPath, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(raw)
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: msg }))
    }
    return
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        mkdirSync(settingsDir, { recursive: true })
        writeFileSync(settingsPath, body, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: msg }))
        }
      }
    })
    return
  }

  res.writeHead(405, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ success: false, error: `Method ${req.method} not allowed` }))
}

// ── Plugin ──────────────────────────────────────────────────────────

export function apiProxyPlugin(): Plugin {
  const claudeConfig = loadClaudeConfig()
  const klingConfig = loadKlingConfig()
  const azureImgCfg = getAzureImageConfig()
  console.log(`[API Proxy] Claude model: ${claudeConfig.model}, Gemini model: ${GEMINI_MODEL}, gpt-image-2: ${azureImgCfg ? 'configured' : 'NOT configured'}, Kling: ${klingConfig.accessKey ? 'configured' : 'NOT configured'}`)

  return {
    name: 'character-editor-api',
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

        // ── Monster pipeline: /__ce-api__/monster/** → Flask :5000 ──
        if (urlPath.startsWith('/__ce-api__/monster')) {
          const rest = req.url.slice('/__ce-api__/monster'.length) // keeps query string
          const targetPath = '/api' + rest
          proxyToMonsterFlask(req, res, targetPath)
          return
        }

        // ── Character render config (simple JSON persistence) ──
        if (urlPath === '/__ce-api__/character-render-config') {
          handleCharacterRenderConfig(req, res)
          return
        }

        // GET endpoints
        if (req.method === 'GET') {
          try {
            if (urlPath === '/__ce-api__/video-query') {
              const taskId = urlParams.get('taskId')
              if (!taskId) { jsonRes(res, 400, { success: false, error: '缺少 taskId' }); return }
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

            // 列出游戏里的 NPC 清单 + 每个 slot 是否已有发布过的角色。
            // 依赖游戏在 `public/npcs.json` 里声明 NPC；缺失时返回空。
            //
            // 用途：pixel-char 管线的"批量发布到 NPC 槽位"UI。
            if (urlPath === '/__ce-api__/list-workspace-game-npcs') {
              const gameId = urlParams.get('gameId') || ''
              if (!isSafeGameId(gameId)) {
                jsonRes(res, 200, { success: false, error: 'invalid gameId' }); return
              }
              const gameRoot = resolve(WORKSPACE_GAMES_DIR, gameId)
              const npcsJsonPath = resolve(gameRoot, 'public/npcs.json')
              if (!existsSync(npcsJsonPath)) {
                jsonRes(res, 200, {
                  success: false,
                  error: '游戏里没有 public/npcs.json —— 无法自动发现 NPC 槽位。请把 NPC 声明到该文件里（见 createNPC.ts 注释）。',
                  npcs: [],
                }); return
              }
              try {
                const parsed = JSON.parse(readFileSync(npcsJsonPath, 'utf-8'))
                const raw = Array.isArray(parsed?.npcs) ? parsed.npcs : []
                const charDirRoot = resolve(gameRoot, 'public/assets/art/characters')
                const npcs = raw
                  .filter((n: any) => n && typeof n.manifestId === 'string' && isSafeCharacterId(n.manifestId))
                  .map((n: any) => {
                    const manifestPath = resolve(charDirRoot, n.manifestId, 'character.manifest.json')
                    return {
                      kind: n.kind === 'civilian_pool' ? 'civilian_pool' : 'npc',
                      tag: String(n.tag ?? ''),
                      name: String(n.name ?? n.tag ?? n.manifestId),
                      manifestId: n.manifestId,
                      hasManifest: existsSync(manifestPath),
                    }
                  })
                jsonRes(res, 200, { success: true, npcs }); return
              } catch (e: any) {
                jsonRes(res, 200, { success: false, error: `parse npcs.json failed: ${e.message}` }); return
              }
            }
          } catch (err: any) {
            console.error('[API Proxy GET Error]', req.url, err?.message)
            jsonRes(res, 200, { success: false, error: err.message || '服务端错误' })
          }
          return next()
        }

        // ── Character Publish → phaser-2d public/characters via shared volume ──
        if (urlPath === '/__ce-api__/publish-character' && req.method === 'POST') {
          try {
            const body = await parseBody(req, 200 * 1024 * 1024)  // up to 200MB for large sprite sets
            const result = publishCharacter(body)
            jsonRes(res, 200, result)
          } catch (err: any) {
            console.error('[API Proxy] publish-character error:', err.message)
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
        }

        // ── Publish character → 工作区某个游戏工程的 public/assets/art/characters/<slot>/ ──
        // 用于「把编辑器里做好的角色一键挂进游戏」，例如作为主角（slot='player'）。
        if (urlPath === '/__ce-api__/publish-to-workspace-game' && req.method === 'POST') {
          try {
            const body = await parseBody(req, 200 * 1024 * 1024)
            const result = publishToWorkspaceGame(body)
            jsonRes(res, 200, result)
          } catch (err: any) {
            console.error('[API Proxy] publish-to-workspace-game error:', err.message)
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
        }

        // ── Merge skills (VFX pipeline → 已发布角色 manifest) ────────────
        // 只改 manifest.skills[]，不动 actions / sprite 文件。前置条件：
        // 角色必须已经通过 publish-to-workspace-game 落地过一次。
        if (urlPath === '/__ce-api__/merge-skills-to-workspace-game' && req.method === 'POST') {
          try {
            const body = await parseBody(req, 1 * 1024 * 1024)
            const result = mergeSkillsToWorkspaceGame(body)
            jsonRes(res, 200, result)
          } catch (err: any) {
            console.error('[API Proxy] merge-skills-to-workspace-game error:', err.message)
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
        }

        // ── Spine Session APIs ──
        if (urlPath === '/__ce-api__/save-spine-session' && req.method === 'POST') {
          try {
            const body = await parseBody(req)
            const currentDir = join(SPINE_DIR, 'current')
            saveSpineSession(body, currentDir)

            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            const historySlot = join(SPINE_HISTORY_DIR, ts)
            saveSpineSession(body, historySlot)
            pruneHistory()

            console.log(`[API Proxy] Spine session saved (current + history/${ts})`)
            jsonRes(res, 200, { success: true, historySlot: ts })
          } catch (err: any) {
            console.error('[API Proxy] Spine save error:', err.message)
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
        }

        if (urlPath === '/__ce-api__/load-spine-session' && req.method === 'GET') {
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

        if (urlPath === '/__ce-api__/list-spine-sessions' && req.method === 'GET') {
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
                  slot: d,
                  timestamp: meta.timestamp,
                  profession: meta.profession,
                  activeTab: meta.activeTab,
                  hasThumbnail,
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

        if (urlPath === '/__ce-api__/spine-session-thumbnail' && req.method === 'GET') {
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

        if (req.method !== 'POST') return next()

        try {
          const body = await parseBody(req)
          let result: any

          console.log(`[API Proxy] ${urlPath}, body keys: ${Object.keys(body).join(',')}, body size: ~${Math.round(JSON.stringify(body).length / 1024)}KB`)

          switch (urlPath) {
            case '/__ce-api__/generate-image': {
              const requestedModel = (body.model || '').trim()
              const hasInputImages = body.inputImageBase64 || body.inputImages
              const forceGemini = requestedModel.startsWith('gemini')

              if (forceGemini) {
                result = await geminiGenerateImage(body)
              } else if (hasInputImages) {
                // 图生图：优先 gpt-image-2 edits，失败回退 Gemini
                result = await azureImageEdit(body)
                if (!result.success) {
                  console.log('[generate-image] Azure edit failed, falling back to Gemini')
                  result = await geminiGenerateImage(body)
                }
              } else {
                // 纯文生图：优先 gpt-image-2，失败回退 Gemini
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
            case '/__ce-api__/enhance-prompt':
              result = await handleEnhancePrompt(body)
              break
            case '/__ce-api__/pixelart':
              result = await handlePixelart(body)
              break
            case '/__ce-api__/video-generate':
              result = await handleVideoGenerate(body, klingConfig)
              break
            case '/__ce-api__/character-turnaround':
              result = await handleCharacterTurnaround(body)
              break
            case '/__ce-api__/analyze-ultimate':
              result = await handleAnalyzeUltimate(body)
              break
            case '/__ce-api__/magic-prompt':
              result = await handleMagicPrompt(body)
              break
            case '/__ce-api__/remove-bg':
              result = await handleRemoveBg(body)
              break
            default:
              return next()
          }

          jsonRes(res, 200, result)
        } catch (err: any) {
          console.error('[API Proxy Error]', req.url, err?.message, err?.stack?.slice(0, 500))
          jsonRes(res, 200, { success: false, error: err.message || '服务端错误' })
        }
      })
    },
  }
}
