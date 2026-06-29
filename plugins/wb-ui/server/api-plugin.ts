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
 *   4. 文件持久化                  → /save-scene-settings /save-default-settings
 *                                    /save-spine-session /load-spine-session
 *                                    /list-spine-sessions /spine-session-thumbnail
 *
 * 凭证读取顺序（见各 load*Config）：
 *   - Gemini：config/gemini-credentials.json → env GEMINI_API_KEY
 *   - Claude：server/keys.local.json[azure-claude] → env CLAUDE_API_BASE/KEY
 *   - Kling ：config/kling-video-credentials.json → server/keys.local.json[kling] → env
 *   - LLM 代理：env LLM_PROXY_URL（默认路由到 gemini-for-claude-code:8083）
 *   - MCP ：env MCP_HOST / MCP_PROMPT_PORT / MCP_PIXELART_PORT
 */
import type { Plugin } from 'vite'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import sharp from 'sharp'
import { inspectUiAssetCanvas, isIconInspectionRejected, isIconInspectionRejectedRelaxed, normalizeStandaloneUiAsset } from '../src/pipelines/ui-design/ui-asset-cleanup'
import {
  MODULE_ICON_GLYPHS,
  activeIconModuleSpecs,
  buildFunctionalIconPrompt,
  buildModuleIconBrief,
  resolveIconSlotCount,
} from '../src/pipelines/ui-design/icon-semantics'
import {
  buildUiDesignAssetOutputPath,
  freshUiGenerationBody,
  uiDesignSessionPrefix,
  type UiGenerationPathBody,
} from '../src/pipelines/ui-design/ui-design-generation-path'
import { GENRE_COMPONENT_KITS, getGenreComponentKit, type GenrePresetId } from '../src/pipelines/ui-design/model'

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
  const credPaths = [
    resolve(process.cwd(), 'config/gemini-credentials.json'),
  ]
  const extra = process.env.GEMINI_CREDENTIALS_PATH
  if (extra) credPaths.push(extra)
  for (const p of credPaths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'))
        if (raw.api_key) {
          const key = String(raw.api_key)
          _cachedGeminiKey = key
          return key
        }
      } catch {}
    }
  }
  _cachedGeminiKey = process.env.GEMINI_API_KEY || ''
  return _cachedGeminiKey
}

interface LLMConfig {
  apiKey: string
  apiBase: string
  model: string
}

function loadClaudeConfig(): LLMConfig {
  const paths = [
    resolve(process.cwd(), 'server/keys.local.json'),
    '/workspace/games/character-editor/server/keys.local.json',
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf-8'))
        if (raw['azure-claude']) {
          return {
            apiKey: raw['azure-claude'].api_key,
            apiBase: raw['azure-claude'].api_base,
            model: raw['azure-claude'].models?.split(',')[0]?.trim() || 'claude-opus-4-6',
          }
        }
      } catch {}
    }
  }
  const proxyUrl = getLlmProxyUrl()
  return {
    apiKey: process.env.CLAUDE_API_KEY || 'proxy-managed',
    apiBase: proxyUrl || process.env.CLAUDE_API_BASE || '',
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
          'Accept': 'application/json',
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

// ── Gemini Text (vision → text prompt generation, via LLM proxy) ────

async function geminiGenerateText(body: any): Promise<any> {
  const { prompt, inputImages, model } = body
  if (!prompt) return { success: false, error: '缺少 prompt' }

  const geminiModel = model || 'gemini-2.5-flash'

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

  const geminiModel = 'gemini-2.5-flash'
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
    model: 'gemini-2.5-flash',
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
    model: 'gemini-2.5-flash',
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

// ── UI Design: Generate Assets via MCP ───────────────────────────────

const MCP_GEMINI_IMAGE_PORT = Number(process.env.MCP_GEMINI_IMAGE_PORT || '3100')

/**
 * Build a text_to_image prompt for a given screen kind, genre, and style.
 */
// ─────────────────────────────────────────────────────────────────────────────
// UI Asset Generation Rules
//
// PRIORITY ORDER (most important first):
//   1. panel_texture  — UI panel/card/frame material (repeated seam-tile or full card)
//   2. icon_*         — functional icons (skill, item, weapon, currency, nav)
//   3. bg             — scene background (MUST be dark/desaturated, UI-readable)
//   4. npc            — dialog character portrait
//
// BACKGROUND RULES (prevents "illustration" problem):
//   - Must look like a real rendered game environment, not concept art or illustration
//   - Deliberately underexposed / dark vignette at edges so UI elements stay readable
//   - Center zone slightly brighter (natural framing for HUD)
//   - No saturated colours dominating — environment depth over colour pop
//   - Style: "in-engine screenshot", "environmental render", "atmospheric depth"
//   - Forbidden keywords: "illustration", "painting", "anime key visual", "artwork", "poster"
// ─────────────────────────────────────────────────────────────────────────────

/** Icon categories per genre — what functional icons to generate */
const GENRE_ICON_SETS: Record<string, string[][]> = {
  fps:         [['pistol','handgun side profile'],['assault rifle','ar15 side view'],['hand grenade','fragmentation grenade'],['first aid kit','medkit cross']],
  'open-world':[['compass rose','navigation compass'],['quest scroll','mission parchment'],['backpack','inventory bag'],['sword','melee weapon silhouette']],
  'action-rpg':[['fire spell scroll','magic skill'],['health potion','red flask'],['shield crest','defense icon'],['gold coin stack','currency']],
  survival:    [['food can','canned supplies'],['wood logs','crafting material'],['campfire','survival fire'],['axe','tool weapon']],
  mmo:         [['guild banner','faction crest emblem'],['star burst','experience level up'],['backpack','inventory bag'],['coin stack','gold currency']],
  'life-sim':  [['heart','relationship love'],['coffee cup','energy drink'],['calendar','schedule planner'],['flower','garden item']],
  racing:      [['checkered flag','race finish'],['speedometer','speed gauge'],['nitro boost','turbo fuel'],['trophy cup','win prize']],
  puzzle:      [['lightbulb','hint idea'],['star badge','score star'],['clock timer','countdown'],['key','puzzle unlock']],
}

/** Panel/frame texture descriptions per style */
const STYLE_PANEL_TEXTURE: Record<string, string> = {
  'modern-dark':        'dark carbon fibre weave panel texture, subtle grid lines, matte metallic surface, game UI frame material, tileable, very dark background near-black',
  'fantasy':            'aged leather-bound tome texture, faded parchment with subtle ink stains, gold leaf border inlay, RPG panel material, seamless tile',
  'anime':              'clean frosted glass panel, holographic sheen, thin neon blue edge glow, anime UI frame material, translucent dark surface, seamless',
  'sci-fi':             'brushed titanium HUD panel, etched circuit trace lines, scanline overlay, cyan accent edge, futuristic monitor bezel texture, tileable',
  'pixel':              'pixel art panel frame with continuous unbroken pixel border, retro 8-bit dungeon UI frame, controlled moss accents only at corners, not ruined, not fragmented, sharp pixel edges, no anti-aliasing',
  'cute-cartoon':       'soft pastel rounded panel, bubbly border with small stars and dots, white gradient fill, cartoon game UI frame, kawaii style',
  'fresh-pastoral':     'light wooden plank panel, soft grain lines, watercolour wash border, pastoral game UI frame, natural warm beige, seamless tile',
  'realistic-military': 'olive-drab metal plate panel, rivet bolts at corners, worn paint scratches, military stencil marks, tactical HUD frame texture, tileable',
  'modern-minimal':     'clean white flat panel, ultra-thin 1px border, subtle drop shadow, minimalist UI card surface, paper-white flat, seamless tile',
}

/**
 * Button art descriptions per style.
 * Each entry defines the visual language for a game UI button background image.
 * Rules: wide rectangle 4:1 ratio, artistically textured, NO text, NO icons.
 */
const STYLE_BUTTON_ART: Record<string, { normal: string; primary: string }> = {
  'modern-dark': {
    normal:  'game UI button background texture, dark metallic brushed steel surface, subtle horizontal scanline, thin bright top edge highlight, very dark near-black fill, matte finish, 4:1 wide rectangle, no text, no icons',
    primary: 'game UI primary button background, warm golden amber gradient with metallic sheen, glowing inner edge in gold, dark vignette at sides, premium action button texture, 4:1 rectangle, no text, no icons',
  },
  fantasy: {
    normal:  'RPG game button background, aged brown leather with faint parchment grain, ornate thin gold border inlay, dark aged patina center, fantasy scroll button surface, 4:1 rectangle, no text, no icons',
    primary: 'RPG game primary button, richly illuminated manuscript gold and crimson, ornate filigree edge embossing, glowing warm amber center, magic scroll confirm button, 4:1 rectangle, no text, no icons',
  },
  anime: {
    normal:  'anime game UI button, frosted dark glass surface, thin electric blue neon edge glow, holographic sheen, subtle gradient dark to slightly lighter, smooth modern panel, 4:1 rectangle, no text, no icons',
    primary: 'anime game primary action button, vibrant cyan blue neon glow outline, bright electric highlight at top, translucent glassy fill with vivid accent, 4:1 rectangle, no text, no icons',
  },
  'sci-fi': {
    normal:  'sci-fi HUD button background, dark titanium alloy surface, fine etched circuit trace lines, subtle green scanline grid, industrial corner chamfer, 4:1 rectangle, no text, no icons',
    primary: 'sci-fi primary button, glowing cyan holographic surface, bright neon edge pulse line, circuit board pattern inner glow, futuristic confirm action panel, 4:1 rectangle, no text, no icons',
  },
  pixel: {
    normal:  'pixel art game button background, retro 8-bit stone block surface, 2px pixel border frame, dark grey center, mossy texture accents, sharp pixel-perfect edges, 4:1 rectangle, no text',
    primary: 'pixel art primary button, bright golden yellow pixel block highlight, 2px dark border, retro game action slot shine, 4:1 rectangle, no text, no icons',
  },
  'cute-cartoon': {
    normal:  'cute cartoon game button, soft pastel lavender rounded rectangle, slight 3D extrusion shadow below, gentle inner gradient light to medium, kawaii UI style, 4:1 rectangle, no text, no icons',
    primary: 'cute cartoon primary button, bright bubblegum pink shiny rounded surface, white gloss highlight streak at top, cheerful bold colour, 3D pressed look, 4:1 rectangle, no text, no icons',
  },
  'fresh-pastoral': {
    normal:  'pastoral game button, light natural wood plank surface, soft grain texture, thin green vine border trim, warm cream fill, cosy handcrafted feel, 4:1 rectangle, no text, no icons',
    primary: 'pastoral game primary button, warm honey oak wood plank with darker grain, thin leafy decorative border, sunlit warm amber tone, 4:1 rectangle, no text, no icons',
  },
  'realistic-military': {
    normal:  'military tactical button background, olive drab metal plate, worn paint scratches, rivet dots at corners, matte battle-hardened surface, stencil-ready, 4:1 rectangle, no text, no icons',
    primary: 'military primary action button, darker olive plate with amber warning stripe at edge, high-vis tactical highlight, worn heavy-duty surface, 4:1 rectangle, no text, no icons',
  },
  'modern-minimal': {
    normal:  'minimal game button background, clean pure white flat rectangle, ultra-thin 1px dark border, subtle inner drop shadow, paper-white matte finish, 4:1 rectangle, no text, no icons',
    primary: 'minimal primary button, flat deep navy or charcoal rectangle, clean sharp edges, no decoration, bold solid colour block, 4:1 rectangle, no text, no icons',
  },
}

/** Title / heading decoration per style */
const STYLE_TITLE_DECO: Record<string, string> = {
  'modern-dark':        'game title backdrop texture, wide horizontal dark metallic bar, brushed steel with subtle amber glow edges, matte premium surface, 3:1 wide rectangle, no text',
  'fantasy':            'game title backdrop, ornate RPG parchment scroll header, gold leaf corner flourishes, aged tan fill, illustrated border vines, 3:1 wide, no text',
  'anime':              'anime game title backdrop, wide glassy panel with cyan neon underline accent, dark frosted surface, holographic shimmer, 3:1 rectangle, no text',
  'sci-fi':             'sci-fi title panel, dark titanium header bar, etched circuit border lines, cyan accent edge, techno-grid inner texture, 3:1 wide, no text',
  'pixel':              'pixel art title backdrop, retro 8-bit dark banner with pixel border frame, blocky stone top edge, 3:1 wide rectangle, no text',
  'cute-cartoon':       'cute title backdrop, pastel rainbow gradient horizontal banner, star and dot accents, bubbly rounded ends, kawaii style, 3:1, no text',
  'fresh-pastoral':     'pastoral title header, natural wood beam with flower vine border, warm cream fill, hand-painted edge trim, 3:1, no text',
  'realistic-military': 'military title bar, olive stencil plate, large rivet accents, worn edge scratches, tactical header band, 3:1, no text',
  'modern-minimal':     'minimal title bar, clean white or very light grey flat rectangle, single thin accent line underneath, 3:1, no text',
}

/**
 * 为 chrome 类组件（按钮/标题/面板）指定**色键底**色，减少与军事灰/木色/中灰的混淆，降低抠图误伤。
 * 粉/霓虹偏多的风格用绿幕，其余默认洋红。
 */
const STYLE_CHROMA_KEY: Record<string, 'magenta' | 'green'> = {
  anime: 'green',
  'cute-cartoon': 'green',
}

function buildChromaBackdropInstruction(styleKey: string): string {
  const k = STYLE_CHROMA_KEY[styleKey] ?? 'magenta'
  if (k === 'green') {
    return 'CRITICAL chroma-key: place the final UI object on one flat, uniform #00FF00 (pure screen green) canvas filling all four edges, no gradient, no vignette, no black stage, no shadow field. Leave a visible margin of the screen green on every side (at least 4–6% of canvas width/height) so the object does not touch the image border. The object must not use the same pure green. This color exists only to separate subject from background for cutout — not part of the art direction.'
  }
  return 'CRITICAL chroma-key: place the final UI object on one flat, uniform #FF00FF (pure magenta) canvas filling all four edges, no gradient, no vignette, no black stage, no shadow field. Leave a visible margin of the magenta on every side (at least 4–6% of canvas width/height) so the object does not touch the image border. The object must not use the same pure magenta. This color exists only to separate subject from background for cutout — not part of the art direction.'
}

/** 功能 icon 与 game-icon-cutout-qa skill 一致：白底提取，不用洋红/绿幕（避免描边脏边与内嵌色键残片）。 */
function buildIconWhiteBackdropInstruction(): string {
  return 'CRITICAL extraction background: place the naked glyph on one flat, uniform #FFFFFF (pure white) canvas filling all four edges. Leave generous white margin (at least 8% canvas width/height) on every side so the symbol does not touch the image border. White exists ONLY for cutout extraction — not part of the art. No grey gradient, no vignette, no shadow field on background.'
}

/** 与 game-ui-component-stylist 齐平的成品材质条：防止糊、水彩绘、整页截屏感 */
const SKILL_GRADE_CHROME = `Output quality bar: shipped high-end game UI art at real pixel scale, sharp edges, readable PBR material, no heavy blur, no watercolor wash, no stock-photo texture, no Figma wireframe, no “UI kit mockup page”, no reference collage, no black/gray stage behind the object, no screenshot crop. Designed to stretch via CSS background-size:100% 100% onto wide game menu buttons (~220×68px primary, ~168×58px secondary).`
const SKILL_GRADE_ICON = `Output quality bar: flat vector game HUD glyph icon (ability-icon / Material-icon clarity), bold filled silhouette, sharp clean edges, 2-3 flat colors max, readable at 56px on dark UI (must stay crisp at 48–64px skill slots and 52px inventory cells). ZERO readable pixels — no Chinese, English, numbers, labels, captions, button banners, settlement ribbons. NOT a UI widget screenshot, NOT glossy 3D chrome, NOT button/panel/bar strip, NOT empty slot plate, NOT solid rounded-square tile, NOT decorative neon bezel frame, NOT avatar/portrait frame plate.`

interface ModuleAssetSpecInput {
  id?: string
  label?: string
  category?: string
  layer?: string
  zone?: string
  description?: string
  aiHint?: string
  assetRoles?: string[]
}

function moduleSpecsFromBody(specs?: ModuleAssetSpecInput[]): ModuleAssetSpecInput[] {
  return Array.isArray(specs) ? specs.filter(item => item && typeof item === 'object') : []
}

function moduleSpecsForRole(specs: ModuleAssetSpecInput[], role: string): ModuleAssetSpecInput[] {
  return specs.filter(spec => Array.isArray(spec.assetRoles) && spec.assetRoles.includes(role))
}

function moduleSpecSummary(specs: ModuleAssetSpecInput[], fallback = ''): string {
  const lines = specs
    .slice(0, 12)
    .map((spec) => {
      const label = spec.label || spec.id || 'module'
      const role = Array.isArray(spec.assetRoles) ? spec.assetRoles.join('/') : ''
      return `${label} (${spec.category || '组件'}; ${spec.zone || '未知区域'}; ${role}) - ${spec.description || ''} ${spec.aiHint || ''}`.trim()
    })
  return lines.length > 0 ? `Selected layout modules to support: ${lines.join(' | ')}.` : fallback
}

/** 生图 prompt 用：仅英文 module id，避免模型把中文模块名画进 icon。 */
function moduleSpecSummaryForImagePrompt(specs: ModuleAssetSpecInput[], fallback = ''): string {
  const lines = specs
    .slice(0, 12)
    .map((spec) => {
      const id = spec.id || 'module'
      const role = Array.isArray(spec.assetRoles) ? spec.assetRoles.join('/') : 'icon'
      return `${id} (${role})`
    })
  return lines.length > 0
    ? `Layout module ids for metadata only — never render as readable text: ${lines.join(' | ')}.`
    : fallback
}

function iconModuleSpecsFromModuleSpecs(specs: ModuleAssetSpecInput[]): ModuleAssetSpecInput[] {
  return activeIconModuleSpecs(specs) as ModuleAssetSpecInput[]
}

function resolveGenreIconKey(genreKey: string, genreLabel: string): string {
  if (genreKey && GENRE_ICON_SETS[genreKey]) return genreKey
  return Object.keys(GENRE_ICON_SETS).find(k => genreLabel.toLowerCase().includes(k)) ?? 'open-world'
}

function genreIconFallback(idx: number, genreKey: string) {
  const gk = resolveGenreIconKey(genreKey, '')
  const iconSet = GENRE_ICON_SETS[gk] ?? GENRE_ICON_SETS['open-world']
  const [iconName, iconDesc] = iconSet[idx % iconSet.length] ?? ['gear cog', 'settings']
  return {
    anchor: iconName,
    motif: `single bold filled ${iconDesc} (${iconName}) as a readable flat game HUD glyph silhouette, centered, no chrome frame`,
    forbidden: 'map pin unless map-related, app-icon plate, badge tile, button strip, empty slot plate, decorative neon bezel, meaningless abstract dash',
  }
}

function iconSubjectsFromModuleSpecs(specs: ModuleAssetSpecInput[]): string[] {
  return iconModuleSpecsFromModuleSpecs(specs)
    .map(spec => spec.label || spec.id || '')
    .filter(Boolean)
}

function resolveIconSlotCountFromBody(body: { iconSlotCount?: number; moduleAssetSpecs?: ModuleAssetSpecInput[] }): number {
  const explicit = Number(body.iconSlotCount)
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(4, Math.min(8, Math.floor(explicit)))
  const specs = moduleSpecsFromBody(body.moduleAssetSpecs)
  if (specs.length <= 0) return 4
  return resolveIconSlotCount(specs)
}

/**
 * @param stylePresetId 风格预设 id（如 modern-dark, sci-fi）；中文 label 无法命中 STYLE_* 表时必须由客户端传此字段
 * @param genreKey 游戏类型 id（如 fps, action-rpg），用于功能图标四宫格与 GENRE_ICON_SETS 对齐
 */
export function buildAssetPrompt(
  assetType: string,
  screenKind: string,
  genreLabel: string,
  styleLabel: string,
  styleTone: string,
  sceneDesc = '',
  promptNotes = '',
  stylePresetId = '',
  genreKey = '',
  moduleAssetSpecs: ModuleAssetSpecInput[] = [],
): string {
  const moduleSpecs = moduleSpecsFromBody(moduleAssetSpecs)
  const moduleHint = (roles: string[]) => moduleSpecSummary(
    roles.flatMap(role => moduleSpecsForRole(moduleSpecs, role)),
  )
  const styleKey = (stylePresetId && STYLE_BUTTON_ART[stylePresetId])
    ? stylePresetId
    : styleLabel.toLowerCase().replace(/\s+/g, '-')
  const styleBase = `${styleLabel} visual style, ${styleTone}`
  const extraHint = promptNotes.trim() ? ` Extra direction: ${promptNotes.trim()}.` : ''
  const resolvedGenreKey = (genreKey && GENRE_COMPONENT_KITS[genreKey as GenrePresetId])
    ? genreKey as GenrePresetId
    : 'open-world'
  const componentKit = getGenreComponentKit(resolvedGenreKey)
  const genreLanguage = [
    `GENRE COMPONENT LANGUAGE: genre determines semantics and layout; style only controls material and color treatment.`,
    `Use ${componentKit.tokens.shape}; information density: ${componentKit.tokens.density}; feedback tone: ${componentKit.tokens.feedbackTone}; icon metaphors: ${componentKit.tokens.iconMetaphor}.`,
    `Do not produce generic Web UI, SaaS dashboard UI, or universal menu components. Components must read as ${genreLabel} game UI.`,
    ...componentKit.promptGuidance,
  ].join(' ')

  // ── Background ──────────────────────────────────────────────────────────────
  if (assetType === 'bg') {
    const sceneHint = sceneDesc ? ` Scene setting: ${sceneDesc}.` : ''
    const screenContext: Record<string, string> = {
      start:         'main menu environment, grand establishing shot, heroic vista',
      hud:           'active gameplay environment, player perspective, immersive scene',
      combat:        'battle arena environment, tense atmosphere, dynamic lighting',
      dialog:        'intimate scene environment, character encounter location, soft depth',
      shop:          'trading post interior or storefront, warm ambient lighting',
      bag:           'character inventory room or shelter interior, calm atmosphere',
      character:     'character showcase environment, neutral dramatic backdrop',
      map:           'cartography room or strategic overview environment',
      pause:         'tranquil environment, softly blurred, depth of field',
      results:       'victory or defeat environment, dramatic sky or arena',
      end:           'epilogue environment, peaceful or triumphant atmosphere',
      'level-select':'level hub world, abstract or stylised environment',
      'weapon-select':'armoury or weapon display environment',
    }
    const ctx = screenContext[screenKind] ?? 'game environment, atmospheric depth'
    return [
      `Game background scene for ${genreLabel} video game UI.`,
      `${styleBase}.${sceneHint}${extraHint}`,
      genreLanguage,
      `Context: ${ctx}.`,
      // Rendering rules — prevent illustration look
      `RENDERING RULES: photo-realistic in-engine render or high-fidelity 3D environment screenshot.`,
      `Dark vignette around all four edges so overlaid UI elements remain readable.`,
      `Desaturated moody colour palette — no oversaturated illustration colours.`,
      `Deep atmospheric depth-of-field, environmental haze, cinematic but DARK.`,
      `Forbidden: anime key visual, concept art painting, watercolour, illustration, poster layout, text overlay, characters in foreground, collage, reference-board composition, visible UI fragments.`,
      `16:9 widescreen composition. Output ONLY the environment background, no UI, no HUD, no text.`,
    ].join(' ')
  }

  // ── Button Art ───────────────────────────────────────────────────────────────
  if (assetType === 'button_normal' || assetType === 'button_primary') {
    const btnArt = STYLE_BUTTON_ART[styleKey] ?? STYLE_BUTTON_ART['modern-dark']
    const desc = assetType === 'button_primary' ? btnArt.primary : btnArt.normal
    const isolationRule = styleKey === 'pixel'
      ? `SINGLE standalone button only. Do NOT output surrounding menu layout, grid background, adjacent UI pieces, or page fragments.`
      : `SINGLE standalone button only. Do NOT output surrounding UI layout or extra component fragments.`
    return [
      `Game UI button background image for ${genreLabel}.`,
      `${styleBase}.${extraHint}`,
      genreLanguage,
      moduleHint(['button-base', 'tab']),
      desc,
      buildChromaBackdropInstruction(styleKey),
      `Frame-fit rule: object occupies roughly 88-96% of canvas width and 78-92% of canvas height; keep decorative borders fully inside the frame.`,
      `CRITICAL: Output ONLY the button background texture/material. NO text, NO labels, NO icons inside.`,
      isolationRule,
      `The image will be used as CSS background-image stretched with background-size:100% 100% over game menu buttons (primary ~220×68px, secondary ~168×58px).`,
      `Forbidden: full interface screenshot, reference board, multiple components in one image, embedded preview page.`,
      `Aspect ratio 4:1 (wide rectangle). High quality, artistically styled button art.`,
      SKILL_GRADE_CHROME,
    ].join(' ')
  }

  // ── Title Decoration ─────────────────────────────────────────────────────────
  if (assetType === 'title_deco') {
    const desc = STYLE_TITLE_DECO[styleKey] ?? STYLE_TITLE_DECO['modern-dark']
    const isolationRule = styleKey === 'pixel'
      ? `SINGLE standalone title strip only. Do NOT include buttons, icons, panel frames, HUD bars, or full menu composition.`
      : `SINGLE standalone title strip only. Do NOT include extra buttons, icons, panels, or full menu composition.`
    return [
      `Game UI title decoration for ${genreLabel}.`,
      `${styleBase}.${extraHint}`,
      genreLanguage,
      moduleHint(['panel', 'modal-panel']),
      desc,
      buildChromaBackdropInstruction(styleKey),
      `Frame-fit rule: title strip spans 88-96% of canvas width and remains centered; keep both left and right trim caps fully visible.`,
      `CRITICAL: Output ONLY the decorative background/frame. NO text, NO characters.`,
      isolationRule,
      `Forbidden: screenshot of a whole UI page, reference image collage, visible buttons or icons.`,
      `Used as CSS background-image behind game title text. Aspect ratio 3:1.`,
      SKILL_GRADE_CHROME,
    ].join(' ')
  }

  // ── Panel / Frame Texture ────────────────────────────────────────────────────
  if (assetType === 'panel_texture') {
    const desc = STYLE_PANEL_TEXTURE[styleKey] ??
                 STYLE_PANEL_TEXTURE['modern-dark']
    const isolationRule = styleKey === 'pixel'
      ? `SINGLE intact standalone panel frame only. Do NOT output a whole menu page. Do NOT include extra buttons, bottom bars, side icons, inventory slots, HUD fragments, or multiple panels. The frame itself should be the only UI object in the image.`
      : `SINGLE intact standalone panel frame only. Do NOT output a whole menu page or multiple UI components in one image.`
    const backdropRule = styleKey === 'pixel'
      ? `The panel frame must sit on the chroma key below; do NOT place it inside a complete menu layout or decorative scene.`
      : `The panel frame must sit on the chroma key below; do not use grey photo backdrops or UI-grey stage floors.`
    return [
      `Game UI panel frame texture for ${genreLabel} game.`,
      `${styleBase}.${extraHint}`,
      genreLanguage,
      moduleHint(['panel', 'card', 'modal-panel', 'list-row', 'bar']),
      desc,
      buildChromaBackdropInstruction(styleKey),
      `Frame-fit rule: output one complete panel frame with all four edges visible and balanced margins (no edge crop).`,
      `MUST be seamlessly tileable or a single card-sized frame.`,
      isolationRule,
      `No text, no icons, no characters. Pure material texture for UI background/border.`,
      backdropRule,
      `Forbidden: full-screen UI screenshot, layout mockup, reference board, visible scene photography.`,
      `Output: square 1:1 ratio, pure texture only.`,
      SKILL_GRADE_CHROME,
    ].join(' ')
  }

  // ── Functional Icons ─────────────────────────────────────────────────────────
  if (assetType.startsWith('icon_')) {
    const idx = parseInt(assetType.split('_')[1] ?? '0', 10)
    const iconSpecs = iconModuleSpecsFromModuleSpecs(moduleSpecs)
    const spec = iconSpecs[idx] ?? iconSpecs[idx % Math.max(iconSpecs.length, 1)]
    const gk = resolveGenreIconKey(genreKey, genreLabel)
    const resolvedGk = (genreKey && GENRE_COMPONENT_KITS[genreKey as GenrePresetId])
      ? genreKey as GenrePresetId
      : 'open-world'
    const brief = buildModuleIconBrief(spec, idx, resolvedGk, (i) => genreIconFallback(i, gk))
    const siblingHints = iconSpecs
      .filter((_, i) => i !== idx)
      .slice(0, 5)
      .map((s) => MODULE_ICON_GLYPHS[s.id || '']?.anchor || s.label || s.id)
      .filter(Boolean)
    const sciFiFlatNote = styleKey === 'sci-fi' || styleKey === 'anime'
      ? 'Even in neon/sci-fi style: keep the glyph FLAT and simplified; neon may only be a thin outline accent, never a glowing plate, HUD bar strip, or 3D glass chrome. Do not replace module-specific metaphors with generic genre decoration.'
      : ''
    const styleMaterialNote = `${styleLabel} (${styleTone}) controls color and line treatment ONLY — symbol semantics come from the module function above, NOT from genre icon metaphors like backpack/compass/map pin unless this module is explicitly inventory/map related.`
    return [
      buildFunctionalIconPrompt(brief, {
        styleBase,
        extraHint,
        styleMaterialNote,
        sciFiFlatNote,
        siblingAnchors: siblingHints,
        moduleIconHint: moduleSpecSummaryForImagePrompt(moduleSpecsForRole(moduleSpecs, 'icon')),
      }),
      buildIconWhiteBackdropInstruction(),
      SKILL_GRADE_ICON,
    ].join(' ')
  }

  // ── NPC Portrait ─────────────────────────────────────────────────────────────
  if (assetType === 'npc') {
    return [
      `Game NPC character portrait for ${genreLabel} dialog screen.`,
      `${styleBase}.${extraHint}`,
      genreLanguage,
      `Half-body bust shot, character facing slightly left toward viewer.`,
      `Expressive face showing personality — merchant, quest giver, or story character.`,
      `Dark semi-transparent background or plain dark gradient — NOT white background.`,
      `Character art matches ${styleLabel} style. High detail face, readable emotion.`,
      `Forbidden: multiple characters, white background, chibi proportion, full-body.`,
    ].join(' ')
  }

  // ── Legacy item/weapon slots (kept for prototype generation) ─────────────────
  if (assetType.startsWith('item-')) {
    const items = ['supply crate or treasure chest','armor plate or shield','weapon attachment or scope','battle pass badge or ticket']
    const desc = items[parseInt(assetType.split('-')[1] ?? '0', 10)] ?? items[0]
    return `Game item icon: ${desc}. ${styleBase}.${extraHint} ${genreLanguage} Single naked item glyph centered on pure white (#FFFFFF) background for cutout extraction, clean silhouette, zero readable text or letters, no border frame, no decorative tile, no rounded-square container, no app-icon plate, no colored background card, no circular badge, no settlement banner. Square 1:1.`
  }
  if (assetType.startsWith('weapon-')) {
    const weapons = ['pistol side profile','assault rifle side view','shotgun side view','sniper rifle side view']
    const desc = weapons[parseInt(assetType.split('-')[1] ?? '0', 10)] ?? weapons[0]
    return `Game weapon icon: ${desc}. ${styleBase}.${extraHint} ${genreLanguage} Single naked weapon glyph centered on pure white (#FFFFFF) background for cutout extraction, high detail, clean silhouette, zero readable text or letters, no border frame, no decorative tile, no rounded-square container, no app-icon plate, no colored background card, no circular badge. Square 1:1.`
  }

  return `Game UI asset (${assetType}) for ${genreLabel}, ${styleBase}.${extraHint} ${genreLanguage} Clean professional game art, dark background, no text.`
}

interface GeneratedAssets {
  /** screen kind → background image base64 data URL */
  backgrounds: Record<string, string>
  /** npc portrait base64 data URL (for dialog screen) */
  npc?: string
  /** shop item icons [0..3] base64 data URLs */
  shopItems: string[]
  /** weapon icons [0..3] base64 data URLs */
  weapons: string[]
  /** UI panel frame/texture base64 data URL */
  panelTexture?: string
  /** functional icons [0..3] base64 data URLs, genre-specific */
  icons: string[]
  /** normal button background art */
  buttonNormal?: string
  /** primary/CTA button background art */
  buttonPrimary?: string
  /** title/heading decoration art */
  titleDeco?: string
}

async function mcpTextToImage(
  host: string,
  port: number,
  prompt: string,
  outputPath: string,
  aspectRatio = '16:9',
): Promise<string | null> {
  try {
    const result = await mcpCall(host, port, 'text_to_image', {
      prompt,
      outputPath,
      aspectRatio,
    })
    // MCP returns content array with image data or file path
    const content = result?.result?.content ?? result?.content ?? []
    for (const item of content) {
      if (item?.type === 'image' && item?.data) {
        return `data:${item.mimeType ?? 'image/png'};base64,${item.data}`
      }
      if (item?.type === 'text') {
        // vag-mcp returns "Successfully generated image: workspace/images/xxx.png"
        const text = (item.text ?? '').trim()
        const match = text.match(/workspace\/images\/[^\s"']+\.(?:png|jpe?g|webp)/i)
        if (match) {
          // In character-editor, data/workspace is mounted at /workspace
          const absPath = `/workspace/${match[0].replace(/^workspace\//, '')}`
          if (existsSync(absPath)) {
            const buf = readFileSync(absPath)
            const ext = absPath.split('.').pop()?.toLowerCase() ?? 'png'
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
            return `data:${mime};base64,${buf.toString('base64')}`
          }
          console.warn('[ui-design/generate-assets] image file not found at', absPath)
        }
      }
    }
    return null
  } catch (e: any) {
    console.error('[ui-design/generate-assets] MCP error:', e.message)
    return null
  }
}

async function handleUiDesignGenerateAssets(body: any): Promise<any> {
  const freshBody = freshUiGenerationBody(body as UiGenerationPathBody & Record<string, unknown>)
  const { genre, style, styleTone, screens, sceneDesc = '', styleBoardPrompt = '', assetPromptNotes = '', assetKinds = [], styleKey: styleKeyIn = '', genreKey: genreKeyIn = '', generationNonce = '', generationAttempt = 1, moduleAssetSpecs = [], iconSlotCount, iconIndex: iconIndexIn } = freshBody as {
    genre: string
    style: string
    styleTone: string
    screens: string[]
    sceneDesc?: string
    styleBoardPrompt?: string
    assetPromptNotes?: string
    assetKinds?: string[]
    /** 与 STYLE_PRESETS 的 id 一致，如 sci-fi、modern-dark */
    styleKey?: string
    /** 与 GENRE_PRESETS 的 id 一致，如 fps、action-rpg */
    genreKey?: string
    /** 用户主动重生成时的随机种子，避免同 prompt 复用旧输出 */
    generationNonce?: string
    /** 单 kind 重试轮次，也进入输出签名 */
    generationAttempt?: number
    moduleAssetSpecs?: ModuleAssetSpecInput[]
    iconSlotCount?: number
    /** 仅生成指定槽位功能图标（客户端按槽并行） */
    iconIndex?: number
  }

  if (!genre || !style || !Array.isArray(screens)) {
    return { success: false, error: 'Missing genre, style, or screens' }
  }

  const moduleSpecs = moduleSpecsFromBody(moduleAssetSpecs)
  const iconCount = resolveIconSlotCountFromBody({ iconSlotCount, moduleAssetSpecs: moduleSpecs })
  const singleIconIndex = typeof iconIndexIn === 'number'
    && Number.isFinite(iconIndexIn)
    && iconIndexIn >= 0
    && iconIndexIn < iconCount
    ? iconIndexIn
    : null
  const generationSeed = String(generationNonce || '').trim()
  const generationAttemptNum = Number.isFinite(Number(generationAttempt)) ? Number(generationAttempt) : 1
  const variationHint = generationSeed ? `Generation variation seed ${generationSeed}, attempt ${generationAttemptNum}; create a fresh unique variation while preserving the requested style.` : ''
  const promptNotes = [styleBoardPrompt, assetPromptNotes, variationHint].filter(Boolean).join(' ')
  const onlyKinds = new Set(Array.isArray(assetKinds) ? assetKinds : [])
  const wants = (kind: string): boolean => onlyKinds.size === 0 || onlyKinds.has(kind)
  const mcpHost = getMcpHost()
  const mcpPort = MCP_GEMINI_IMAGE_PORT

  /** 中文 style label 无法命中风格表，客户端必须带 styleKey；未带时回退 modern-dark 以免整表错位 */
  const stylePresetId = (styleKeyIn && String(styleKeyIn).trim()) || 'modern-dark'
  const genreKey = (genreKeyIn && String(genreKeyIn).trim()) || ''
  const sessionPrefix = uiDesignSessionPrefix({
    genre,
    style,
    styleKey: stylePresetId,
    genreKey,
    styleTone,
    styleBoardPrompt,
    assetPromptNotes,
    generationNonce: generationSeed,
    generationAttempt: generationAttemptNum,
    moduleAssetSpecs: moduleSpecs,
  })
  const freshAssetPath = (kind: string, variant = '', attempt = generationAttemptNum): string => {
    const rel = buildUiDesignAssetOutputPath(sessionPrefix, kind, variant, attempt)
    const abs = rel.startsWith('/workspace/')
      ? rel
      : `/workspace/${rel.replace(/^workspace\//, '')}`
    if (existsSync(abs)) rmSync(abs, { force: true })
    return rel
  }

  const assets: GeneratedAssets = { backgrounds: {}, shopItems: [], weapons: [], icons: Array.from({ length: iconCount }, () => '') }

  /** 科幻 / 军事暗色金属：额外收边，减轻粉边与黑底半透明晕染 */
  const chromeEdgeRefine = (stylePresetId === 'sci-fi' || stylePresetId === 'realistic-military')
    ? ('dark-ui' as const)
    : undefined

  const chromeOpts = { mode: 'chrome' as const, fillRatio: 0.9, chromeEdgeRefine }
  const chromePanelOpts = { mode: 'chrome' as const, fillRatio: 0.9, chromeEdgeRefine }
  const normalizeChromeAsset = async (dataUrl: string, opts = chromeOpts): Promise<string | null> => {
    const normalized = await normalizeStandaloneUiAsset(dataUrl, opts)
    const report = await inspectUiAssetCanvas(normalized)
    const brokenCutout = report.opaqueEdgePixels > 0
      || report.fragmentationRatio > 0.42
      || report.largestComponentRatio < 0.56
      || report.transparentCornerDirtyPixels > 0
      || report.transparentDirtyPixels > 0
    return brokenCutout ? null : normalized
  }
  const generateCleanStandaloneIconAsset = async (assetType: string, outputStem: string): Promise<string> => {
    const iconIdx = parseInt(assetType.split('_')[1] ?? assetType.split('-')[1] ?? '0', 10)
    const iconSpecs = iconModuleSpecsFromModuleSpecs(moduleSpecs)
    const iconSpec = iconSpecs[iconIdx] ?? iconSpecs[iconIdx % Math.max(iconSpecs.length, 1)]
    const moduleId = iconSpec?.id || ''
    const glyphAnchor = MODULE_ICON_GLYPHS[moduleId]?.anchor || 'readable symbol'
    const retryNotes = [
      '',
      `REJECTED: prior candidate had dirty white fringe, app-icon plate, empty slot tile, settlement/banner text, or label strip. Regenerate ONE naked flat "${glyphAnchor}" pictogram on pure #FFFFFF — absolutely zero letters/words in the image.`,
      `REJECTED again: symbol-only glyph, no rounded-square container, no ribbon banner, no Chinese/English characters, no title bar, no reward/settlement caption. Clean alpha-friendly edges on white.`,
      `FINAL RETRY: flat pictogram of "${glyphAnchor}" only. No text. No plate. No bezel. No empty tile.`,
    ]
    const maxAttempts = 5
    let bestFallback: string | null = null
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const prompt = buildAssetPrompt(
        assetType,
        'ui',
        genre,
        style,
        styleTone,
        sceneDesc,
        [promptNotes, retryNotes[Math.min(attempt, retryNotes.length - 1)]].filter(Boolean).join(' '),
        stylePresetId,
        genreKey,
        moduleSpecs,
      )
      const dataUrl = await mcpTextToImage(mcpHost, mcpPort, prompt, freshAssetPath('icons', outputStem, attempt + 1), '1:1')
      if (!dataUrl) continue
      const normalized = await normalizeStandaloneUiAsset(dataUrl, { mode: 'icon', fillRatio: 0.76 })
      const postReport = await inspectUiAssetCanvas(normalized)
      if (!isIconInspectionRejected(postReport)) return normalized
      if (!isIconInspectionRejectedRelaxed(postReport)) bestFallback = normalized
    }
    return bestFallback ?? ''
  }

  // ── Priority 1: Button art + Title deco (直接决定 UI 视觉风格) ──────────────
  const btnNormalTask = async () => {
    const prompt = buildAssetPrompt('button_normal', 'ui', genre, style, styleTone, sceneDesc, promptNotes, stylePresetId, genreKey, moduleSpecs)
    const dataUrl = await mcpTextToImage(mcpHost, mcpPort, prompt, freshAssetPath('buttonNormal', 'normal'), '4:1')
    if (dataUrl) {
      const normalized = await normalizeChromeAsset(dataUrl)
      if (normalized) assets.buttonNormal = normalized
    }
  }
  const btnPrimaryTask = async () => {
    const prompt = buildAssetPrompt('button_primary', 'ui', genre, style, styleTone, sceneDesc, promptNotes, stylePresetId, genreKey, moduleSpecs)
    const dataUrl = await mcpTextToImage(mcpHost, mcpPort, prompt, freshAssetPath('buttonPrimary', 'primary'), '4:1')
    if (dataUrl) {
      const normalized = await normalizeChromeAsset(dataUrl)
      if (normalized) assets.buttonPrimary = normalized
    }
  }
  const titleDecoTask = async () => {
    const prompt = buildAssetPrompt('title_deco', 'ui', genre, style, styleTone, sceneDesc, promptNotes, stylePresetId, genreKey, moduleSpecs)
    const dataUrl = await mcpTextToImage(mcpHost, mcpPort, prompt, freshAssetPath('titleDeco', 'deco'), '21:9')
    if (dataUrl) {
      const normalized = await normalizeChromeAsset(dataUrl)
      if (normalized) assets.titleDeco = normalized
    }
  }

  // ── Priority 2: Panel texture + icons ───────────────────────────────────────
  const panelTask = async () => {
    const prompt = buildAssetPrompt('panel_texture', 'ui', genre, style, styleTone, sceneDesc, promptNotes, stylePresetId, genreKey, moduleSpecs)
    const dataUrl = await mcpTextToImage(mcpHost, mcpPort, prompt, freshAssetPath('panelTexture', 'panel'), '1:1')
    if (dataUrl) {
      const normalized = await normalizeChromeAsset(dataUrl, chromePanelOpts)
      if (normalized) assets.panelTexture = normalized
    }
  }
  const iconTasks = singleIconIndex !== null
    ? [async () => {
      assets.icons[singleIconIndex] = await generateCleanStandaloneIconAsset(`icon_${singleIconIndex}`, `icon-${singleIconIndex}`)
    }]
    : Array.from({ length: iconCount }, (_, i) => async () => {
      assets.icons[i] = await generateCleanStandaloneIconAsset(`icon_${i}`, `icon-${i}`)
    })

  // ── Priority 3: Backgrounds ──────────────────────────────────────────────────
  const bgTasks = screens.map(screenKind => async () => {
    const prompt = buildAssetPrompt('bg', screenKind, genre, style, styleTone, sceneDesc, promptNotes, stylePresetId, genreKey)
    const dataUrl = await mcpTextToImage(mcpHost, mcpPort, prompt, freshAssetPath('background', screenKind), '16:9')
    if (dataUrl) assets.backgrounds[screenKind] = dataUrl
  })

  // ── Priority 4: NPC / shop / weapon ─────────────────────────────────────────
  const needDialog = screens.includes('dialog')
  const npcTask = needDialog ? async () => {
    const prompt = buildAssetPrompt('npc', 'dialog', genre, style, styleTone, sceneDesc, promptNotes, stylePresetId, genreKey)
    const dataUrl = await mcpTextToImage(mcpHost, mcpPort, prompt, freshAssetPath('npc', 'portrait'), '1:1')
    if (dataUrl) assets.npc = dataUrl
  } : null

  const needShop = screens.includes('shop')
  const shopTasks = needShop ? [0, 1, 2, 3].map(i => async () => {
    assets.shopItems[i] = await generateCleanStandaloneIconAsset(`item-${i}`, `item-${i}`)
  }) : []

  const needWeapons = screens.includes('weapon-select')
  const weaponTasks = needWeapons ? [0, 1, 2, 3].map(i => async () => {
    assets.weapons[i] = await generateCleanStandaloneIconAsset(`weapon-${i}`, `weapon-${i}`)
  }) : []

  const runBatch = async (tasks: Array<() => Promise<void>>, concurrency: number) => {
    for (let i = 0; i < tasks.length; i += concurrency) {
      await Promise.all(tasks.slice(i, i + concurrency).map(t => t()))
    }
  }

  const highPriorityTasks = [
    ...(wants('buttonNormal') ? [btnNormalTask] : []),
    ...(wants('buttonPrimary') ? [btnPrimaryTask] : []),
    ...(wants('titleDeco') ? [titleDecoTask] : []),
  ]
  const libraryTasks = [
    ...(wants('panelTexture') ? [panelTask] : []),
    ...(wants('icons') ? iconTasks : []),
  ]
  const contentTasks = [
    ...(wants('background') ? bgTasks : []),
    ...(wants('npc') && npcTask ? [npcTask] : []),
    ...(wants('shopItems') ? shopTasks : []),
    ...(wants('weapons') ? weaponTasks : []),
  ]

  await runBatch(highPriorityTasks, 3)
  await runBatch(libraryTasks, 3)
  await runBatch(contentTasks, 3)

  const failedKinds: string[] = []
  if (wants('buttonNormal') && !assets.buttonNormal) failedKinds.push('buttonNormal')
  if (wants('buttonPrimary') && !assets.buttonPrimary) failedKinds.push('buttonPrimary')
  if (wants('titleDeco') && !assets.titleDeco) failedKinds.push('titleDeco')
  if (wants('panelTexture') && !assets.panelTexture) failedKinds.push('panelTexture')
  if (wants('icons')) {
    if (singleIconIndex !== null) {
      if (!assets.icons[singleIconIndex]) failedKinds.push(`icons:${singleIconIndex}`)
    } else {
      for (let i = 0; i < iconCount; i++) {
        if (!assets.icons[i]) failedKinds.push(`icons:${i}`)
      }
    }
  }
  if (wants('shopItems') && needShop) {
    for (let i = 0; i < 4; i++) {
      if (!assets.shopItems[i]) failedKinds.push(`shopItems:${i}`)
    }
  }
  if (wants('weapons') && needWeapons) {
    for (let i = 0; i < 4; i++) {
      if (!assets.weapons[i]) failedKinds.push(`weapons:${i}`)
    }
  }

  console.log(
    `[ui-design/generate-assets] Done:`,
    `btn=${!!assets.buttonNormal}/${!!assets.buttonPrimary} title=${!!assets.titleDeco}`,
    `panel=${!!assets.panelTexture} icons=${assets.icons.filter(Boolean).length}/4`,
    `bg=${Object.keys(assets.backgrounds).length} npc=${!!assets.npc}`,
    failedKinds.length ? `failed=${failedKinds.join(',')}` : 'failed=none',
  )

  if (failedKinds.length > 0) {
    return {
      success: false,
      error: `组件生成失败: ${failedKinds.join(', ')}`,
      assets,
      failedKinds,
    }
  }

  return { success: true, assets }
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

/** Reject characterIds that could escape the export root */
function isSafeCharacterId(id: unknown): id is string {
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
    // Strip headers that we want the outgoing request to manage itself.
    const upstreamHeaders: Record<string, string | string[] | undefined> = { ...req.headers }
    delete upstreamHeaders['content-length']
    delete upstreamHeaders['transfer-encoding']
    delete upstreamHeaders['connection']
    upstreamHeaders['host'] = `${MONSTER_HOST}:${MONSTER_PORT}`
    if (bodyBuf) upstreamHeaders['content-length'] = String(bodyBuf.length)

    const options = {
      hostname: MONSTER_HOST,
      port: MONSTER_PORT,
      path: targetPath,
      method: req.method,
      headers: upstreamHeaders,
    }

    const proxyReq = httpRequest(options, (proxyRes) => {
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
 * Stores CharacterRenderPanel's settings at public/scenes/character-render.json.
 * Frontend uses GET to load and POST to save; used to be missing entirely.
 */
function handleCharacterRenderConfig(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const settingsPath = resolve(process.cwd(), 'public/scenes/character-render.json')

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
        mkdirSync(resolve(process.cwd(), 'public/scenes'), { recursive: true })
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
  console.log(`[API Proxy] Claude model: ${claudeConfig.model}, Gemini model: ${GEMINI_MODEL}, Kling: ${klingConfig.accessKey ? 'configured' : 'NOT configured'}`)

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
          } catch (err: any) {
            console.error('[API Proxy GET Error]', req.url, err?.message)
            jsonRes(res, 200, { success: false, error: err.message || '服务端错误' })
          }
          return next()
        }

        // POST-only: save-default-settings
        if (urlPath === '/__ce-api__/save-default-settings' && req.method === 'POST') {
          try {
            const body = await parseBody(req)
            const settingsPath = resolve(process.cwd(), 'public/scenes/default-settings.json')
            writeFileSync(settingsPath, JSON.stringify(body, null, 2), 'utf-8')
            console.log('[API Proxy] Saved default-settings.json')
            jsonRes(res, 200, { success: true })
          } catch (err: any) {
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
        }

        // POST-only: save per-scene settings to file
        if (urlPath === '/__ce-api__/save-scene-settings' && req.method === 'POST') {
          try {
            const body = await parseBody(req)
            const settingsPath = resolve(process.cwd(), 'public/scenes/scene-settings.json')
            writeFileSync(settingsPath, JSON.stringify(body, null, 2), 'utf-8')
            console.log(`[API Proxy] Saved scene-settings.json (${Object.keys(body.scenes || {}).length} scenes)`)
            jsonRes(res, 200, { success: true })
          } catch (err: any) {
            jsonRes(res, 200, { success: false, error: err.message })
          }
          return
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
            case '/__ce-api__/generate-image':
              result = await geminiGenerateImage(body)
              break
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
            case '/__ce-api__/ui-design/generate-assets':
              result = await handleUiDesignGenerateAssets(body)
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
