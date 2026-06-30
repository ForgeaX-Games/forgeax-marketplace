import type { StreamEvent, TextClient, TextRequest } from './types'
import { createSseParser, feedSse } from './sseParser'
import { GeminiProvider } from './GeminiProvider'
import {
  HostGatewayTextProvider,
  shouldUseHostTextGateway,
} from './HostGatewayTextProvider'

/**
 * Azure 上托管的 Claude Opus 4.6（Anthropic 兼容路由）。
 *
 * 端点：`<api_base>/v1/messages?api-version=2023-06-01`
 *   - `<api_base>` 已包含 `/anthropic/`（见 llm_key.json: `azure-claude.api_base`）
 *   - Azure 通常不要求 `api-version`，但带上能保持版本稳定
 *   - 认证 header：`api-key: <key>`（Azure 风格），同时也兼容 `x-api-key`
 *
 * 请求 body 跟 Anthropic Messages API 一致：
 * ```
 * {
 *   model: "claude-opus-4-6",
 *   max_tokens: 1024,
 *   system: "...",
 *   messages: [ { role: "user", content: "..." } ]
 * }
 * ```
 *
 * 注：前端直连暴露 key，仅适用于内部 dev 沙盒。生产应改走后端代理。
 */

interface ClaudeAzureConfig {
  apiKey: string
  apiBase: string
  model?: string
  apiVersion?: string
}

interface AnthropicMessageBlock {
  type?: string
  text?: string
}
interface AnthropicResponse {
  content?: AnthropicMessageBlock[]
  stop_reason?: string
  error?: { type?: string; message?: string }
}

/**
 * Anthropic Messages API 的 user content block。
 * - text block：`{ type: 'text', text: '...' }`
 * - image block：`{ type: 'image', source: { type: 'base64', media_type, data } }`
 *   注意 media_type 必须是 `image/png|jpeg|gif|webp` 之一（Anthropic 限制）；
 *   data 是去掉 `data:...;base64,` 前缀后的纯 base64。
 */
type ClaudeUserBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }

/**
 * 把 TextRequest 转成 Anthropic Messages API 的 user.content。
 *
 * 规则：
 *   - 没有 images（或空数组）→ 直接返回字符串 userPrompt（与历史行为一致）
 *   - 有 images → 返回 content block 数组，先放所有图片，再放一段 text
 *   - data URL 必须是 base64 编码（`data:image/<png|jpeg|...>;base64,<...>`），
 *     否则抛 `[MULTIMODAL_BAD_DATA_URL]`，由调用方决定退路径
 *
 * 为什么图在前文在后：
 *   Anthropic 官方建议图片放在文字 prompt 之前，让模型先"看图"再"读问题"，
 *   能显著提升识别质量（参见 Anthropic vision 文档）。
 */
function buildUserContentForClaude(req: TextRequest): string | ClaudeUserBlock[] {
  const images = req.images ?? []
  if (images.length === 0) return req.userPrompt

  const blocks: ClaudeUserBlock[] = []
  for (const img of images) {
    const parsed = parseDataUrl(img.dataUrl)
    if (!parsed) {
      throw new Error(
        `[MULTIMODAL_BAD_DATA_URL] image ${img.label ?? '?'} is not a base64 data URL`,
      )
    }
    if (!ALLOWED_IMAGE_MIMES.has(parsed.mediaType)) {
      throw new Error(
        `[MULTIMODAL_BAD_MIME] ${parsed.mediaType} not in {png,jpeg,gif,webp}`,
      )
    }
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: parsed.mediaType, data: parsed.base64 },
    })
  }
  blocks.push({ type: 'text', text: req.userPrompt })
  return blocks
}

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  // 形如 `data:image/png;base64,iVBOR...`
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const mediaType = (m[1] ?? '').toLowerCase()
  const base64 = m[2] ?? ''
  if (!mediaType || !base64) return null
  return { mediaType, base64 }
}

export class ClaudeAzureProvider implements TextClient {
  private readonly apiKey: string
  private readonly apiBase: string
  private readonly model: string
  private readonly apiVersion: string

  constructor(cfg: ClaudeAzureConfig) {
    if (!cfg.apiKey) throw new Error('ClaudeAzureProvider: missing apiKey')
    if (!cfg.apiBase) throw new Error('ClaudeAzureProvider: missing apiBase')
    this.apiKey = cfg.apiKey
    this.apiBase = cfg.apiBase.replace(/\/$/, '')
    this.model = cfg.model ?? 'claude-opus-4-6'
    this.apiVersion = cfg.apiVersion ?? '2023-06-01'
  }

  getModel(): string {
    return this.model
  }
  getProviderName(): string {
    return 'Claude'
  }

  async generate(req: TextRequest): Promise<string> {
    const url = `${this.apiBase}/v1/messages?api-version=${encodeURIComponent(
      this.apiVersion,
    )}`

    const sys =
      req.systemPrompt +
      (req.jsonMode
        ? '\n\n你必须只返回单一合法 JSON 对象（无前后说明、无 markdown 代码块）。'
        : '')

    // Phase 5：多模态。images 非空时，user message 的 content 改成 array：
    //   [ { type: 'image', source: ... }, { type: 'text', text: userPrompt } ]
    // images 为空 / 缺省时，content 仍是单纯字符串（与历史行为一致，零改动）。
    const userContent = buildUserContentForClaude(req)

    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.85,
      system: sys,
      messages: [{ role: 'user' as const, content: userContent }],
    }

    const t0 = performance.now()
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new Error(`[NET] Claude fetch failed: ${(e as Error).message}`)
    }

    const latencyMs = Math.round(performance.now() - t0)
    const raw = await resp.text()
    if (!resp.ok) {
      const isBlocked = raw.includes('555420') || raw.includes('unusual behavior') || raw.includes('resource has been blocked')
      const friendlyHint = isBlocked
        ? '\n→ Azure 内容安全拦截（555420）：请稍等片刻重试，或精简输入内容再发送。'
        : ''
      throw new Error(
        `[HTTP ${resp.status}] ${resp.statusText} · ${raw.slice(0, 240)}${friendlyHint} · ${latencyMs}ms`,
      )
    }
    let data: AnthropicResponse
    try {
      data = JSON.parse(raw) as AnthropicResponse
    } catch {
      throw new Error(`[PARSE] non-JSON · head=${raw.slice(0, 200)}`)
    }
    if (data.error) {
      throw new Error(
        `[API ${data.error.type ?? '?'}] ${data.error.message ?? raw.slice(0, 200)}`,
      )
    }
    const text =
      data.content
        ?.map((b) => (typeof b.text === 'string' ? b.text : ''))
        .join('') ?? ''
    const stopReason = data.stop_reason ?? '?'
    if (!text.trim()) {
      throw new Error(
        `[EMPTY] no content · stop=${stopReason} · raw=${raw.slice(0, 200)}`,
      )
    }
    // 关键诊断信号 —— stop_reason='max_tokens' 表示输出被 token 上限截断；
    // 'end_turn' 表示模型自然结束。把这个信号每次都打到 console，作者排查时
    // 看一眼 DevTools 就能知道是不是被截断。
    console.info(
      `[ClaudeAzureProvider] ✓ ${this.model} · ${latencyMs}ms · stop=${stopReason} · text.len=${text.length}`,
    )
    if (stopReason === 'max_tokens') {
      // 直接抛 [TRUNCATED]：让下游不要在截断 JSON 上苦苦挣扎。
      // text 仍然带在错信里（前 600 字）供作者诊断。
      console.warn(
        `[ClaudeAzureProvider] ⚠ stop=max_tokens — 输出被 ${body.max_tokens} token 上限截断`,
      )
      throw new Error(
        `[TRUNCATED] LLM 输出被 max_tokens=${body.max_tokens} 截断，` +
          `已生成 ${text.length} 字符但未结束。\n` +
          `→ 解决：① 调高 maxTokens；② 或者把输入按章节分段再分批 forge。\n` +
          `partial=${text.slice(0, 600)}`,
      )
    }
    return text
  }

  /**
   * 流式生成 —— Anthropic Messages API 的 SSE 协议。
   *
   * 与 `generate()` 的主要差异：
   *   1. body 里 `stream: true`
   *   2. 请求头加 `Accept: text/event-stream`
   *   3. 用 ReadableStream + TextDecoder + createSseParser 逐段处理
   *
   * 每拿到一段 text_delta 就 onEvent({ type:'text', ... })；stop_reason
   * 最终通过 done 事件透传（遇到 max_tokens 仍然抛错 [TRUNCATED]，保持与 generate 一致）。
   */
  async generateStream(
    req: TextRequest,
    onEvent: (ev: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const url = `${this.apiBase}/v1/messages?api-version=${encodeURIComponent(
      this.apiVersion,
    )}`

    const sys =
      req.systemPrompt +
      (req.jsonMode
        ? '\n\n你必须只返回单一合法 JSON 对象（无前后说明、无 markdown 代码块）。'
        : '')

    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.85,
      system: sys,
      messages: [{ role: 'user' as const, content: buildUserContentForClaude(req) }],
      stream: true,
    }

    const t0 = performance.now()
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'api-key': this.apiKey,
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (e) {
      const msg = `[NET] Claude stream fetch failed: ${(e as Error).message}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => '')
      // 555420 = Azure AI Content Safety 检测到"异常行为"（通常因 prompt 含密集 JSON schema 或被判定为自动化滥用）
      const isBlocked = errText.includes('555420') || errText.includes('unusual behavior') || errText.includes('resource has been blocked')
      const friendlyHint = isBlocked
        ? '\n→ Azure 内容安全拦截（555420）：请稍等片刻重试，或精简输入内容再发送。'
        : ''
      const msg = `[HTTP ${resp.status}] ${resp.statusText} · ${errText.slice(0, 240)}${friendlyHint}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }

    onEvent({ type: 'open' })

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    const parser = createSseParser()
    let full = ''
    let stopReason: string | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const events = feedSse(parser, chunk)
        for (const ev of events) {
          if (ev.errorMessage) {
            const msg = `[API] ${ev.errorMessage}`
            onEvent({ type: 'error', message: msg })
            throw new Error(msg)
          }
          if (ev.stopReason) {
            stopReason = ev.stopReason
          }
          if (typeof ev.text === 'string' && ev.text.length > 0) {
            full += ev.text
            onEvent({ type: 'text', delta: ev.text, cumulative: full })
          }
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // noop
      }
    }

    const latencyMs = Math.round(performance.now() - t0)
    console.info(
      `[ClaudeAzureProvider] ✓ stream · ${this.model} · ${latencyMs}ms · stop=${
        stopReason ?? '?'
      } · text.len=${full.length}`,
    )

    if (!full.trim()) {
      const msg = `[EMPTY] no content · stop=${stopReason ?? '?'}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }
    if (stopReason === 'max_tokens') {
      const msg =
        `[TRUNCATED] LLM 输出被 max_tokens=${body.max_tokens} 截断，` +
        `已生成 ${full.length} 字符但未结束。\n` +
        `→ 解决：① 调高 maxTokens；② 或者把输入按章节分段再分批 forge。\n` +
        `partial=${full.slice(0, 600)}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }

    onEvent({ type: 'done', full, stopReason, latencyMs })
    return full
  }

  async ping(): Promise<{
    ok: boolean
    latencyMs: number
    sample?: string
    error?: string
  }> {
    const t0 = performance.now()
    try {
      const out = await this.generate({
        systemPrompt: 'You are a ping echo.',
        userPrompt: 'reply with the single word: pong',
        maxTokens: 8,
        temperature: 0,
      })
      return { ok: true, latencyMs: Math.round(performance.now() - t0), sample: out.trim() }
    } catch (e) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        error: (e as Error).message,
      }
    }
  }
}

/**
 * 离线兜底 —— 没有 key 时，编辑器仍可以跑：所有"生成"调用直接返回模板文本。
 */
export class MockTextProvider implements TextClient {
  getModel(): string {
    return 'mock-claude'
  }
  getProviderName(): string {
    return 'Mock'
  }
  async generate(req: TextRequest): Promise<string> {
    if (req.jsonMode) {
      return JSON.stringify({
        ok: true,
        note: 'mock provider — no real LLM',
        echo: req.userPrompt.slice(0, 80),
      })
    }
    const stamp = new Date().toISOString().slice(11, 19)
    return [
      `[Mock @ ${stamp}]`,
      '— 我是离线占位文本，未连真实 LLM。',
      '— 你的提问：',
      req.userPrompt.slice(0, 200),
    ].join('\n')
  }
  async generateStream(
    req: TextRequest,
    onEvent: (ev: StreamEvent) => void,
  ): Promise<string> {
    // 模拟一下真实流式：切成 8 段，每段间隔 80ms
    const full = await this.generate(req)
    onEvent({ type: 'open' })
    const chunks = chunkText(full, 8)
    let cumulative = ''
    for (const c of chunks) {
      cumulative += c
      onEvent({ type: 'text', delta: c, cumulative })
      await new Promise((r) => setTimeout(r, 80))
    }
    onEvent({ type: 'done', full, stopReason: 'end_turn', latencyMs: 80 * chunks.length })
    return full
  }
  async ping(): Promise<{ ok: boolean; latencyMs: number; sample?: string }> {
    return { ok: true, latencyMs: 0, sample: 'mock' }
  }
}

function chunkText(text: string, n: number): string[] {
  if (n <= 0 || text.length === 0) return []
  const size = Math.max(1, Math.ceil(text.length / n))
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size))
  }
  return out
}

/**
 * 装配 —— 优先级 Gemini > Claude > Mock：
 *
 *   1. 若 `gemini-aistudio` key 可用（默认情况）→ GeminiProvider（gemini-3.1-pro-preview）
 *   2. 否则 `azure-claude` 可用 → ClaudeAzureProvider（Opus/Sonnet 4.6 兜底）
 *   3. 都没有 → MockTextProvider（离线占位，编辑器仍可使用）
 *
 * 注：Claude Opus 4.6 被 Azure 下架/限流时会由上游统一把 `gemini` 置空以绕开；
 * 所以这里的"优先 Gemini"是**真正运行时的单一选项**，Claude 仅作历史兼容保险。
 */
export function createTextProvider(): TextClient {
  // 全部走 litellm（作者 2026-06）：嵌入宿主时，文本统一经宿主 litellm 网关，
  // key 留 server、不进前端 bundle。localStorage `reel-studio.textProvider='direct'`
  // 可强制绕开（仅供独立 dev 调试）。
  if (shouldUseHostTextGateway()) {
    console.info('[reel-studio/llm] using HostGatewayTextProvider · litellm@host')
    return new HostGatewayTextProvider()
  }
  if (__RS_GEMINI_KEY__ && __RS_GEMINI_BASE__) {
    console.info(
      `[reel-studio/llm] using GeminiProvider · ${__RS_GEMINI_MODEL__}`,
    )
    return new GeminiProvider({
      apiKey: __RS_GEMINI_KEY__,
      apiBase: __RS_GEMINI_BASE__,
      model: __RS_GEMINI_MODEL__,
    })
  }
  if (__RS_CLAUDE_KEY__ && __RS_CLAUDE_BASE__) {
    console.info(
      `[reel-studio/llm] Gemini key missing — fallback to ClaudeAzureProvider · ${__RS_CLAUDE_MODEL__}`,
    )
    return new ClaudeAzureProvider({
      apiKey: __RS_CLAUDE_KEY__,
      apiBase: __RS_CLAUDE_BASE__,
      model: __RS_CLAUDE_MODEL__,
    })
  }
  console.info('[reel-studio/llm] no LLM key — using MockTextProvider')
  return new MockTextProvider()
}
