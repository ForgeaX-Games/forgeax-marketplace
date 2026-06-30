import type { StreamEvent, TextClient, TextRequest } from './types'

/**
 * HostGatewayTextProvider —— 把文本生成委托给宿主 forgeax-server 的 litellm
 * 文本网关（`/__ce-api__/reel-chat` 与 `/reel-chat-stream`），而不是浏览器直连
 * Gemini / Claude。
 *
 * 为什么（作者 2026-06 · 全部走 litellm + 密钥红线）：
 *   · 原 createTextProvider 用 `__RS_GEMINI_KEY__`/`__RS_CLAUDE_KEY__` 编译期注入，
 *     key 被打进前端 bundle —— 违反「key 不进前端」红线。
 *   · 改走宿主后，LITELLM_PROXY_KEY 全程留在 server .env，浏览器只发同源
 *     `/__ce-api__/*`；文本统一经 litellm /v1/chat/completions。
 *
 * 能力：jsonMode、多模态（vision，image_url）、SSE 流式（与原 generateStream 等价）。
 */

interface ReelChatResp {
  success?: boolean
  text?: string
  upstreamModel?: string
  error?: string
}

function buildBody(req: TextRequest): Record<string, unknown> {
  return {
    system: req.systemPrompt,
    user: req.userPrompt,
    images: (req.images ?? []).map((i) => ({ dataUrl: i.dataUrl })),
    jsonMode: req.jsonMode,
    maxTokens: req.maxTokens,
    temperature: req.temperature,
  }
}

export class HostGatewayTextProvider implements TextClient {
  private readonly base: string
  private readonly model: string

  constructor(opts: { base?: string; model?: string } = {}) {
    this.base = (opts.base ?? '/__ce-api__').replace(/\/$/, '')
    this.model = opts.model ?? 'litellm@host-gateway'
  }

  getModel(): string {
    return this.model
  }
  getProviderName(): string {
    return 'HostGatewayText'
  }

  async generate(req: TextRequest): Promise<string> {
    const resp = await fetch(`${this.base}/reel-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBody(req)),
    })
    const raw = await resp.text()
    if (!resp.ok) throw new Error(`[HTTP ${resp.status}] host text gateway · ${raw.slice(0, 240)}`)
    let data: ReelChatResp
    try {
      data = JSON.parse(raw) as ReelChatResp
    } catch {
      throw new Error(`[PARSE] host text gateway non-JSON · ${raw.slice(0, 200)}`)
    }
    if (!data.success || !data.text) throw new Error(data.error || '宿主文本网关生成失败')
    return data.text
  }

  async generateStream(
    req: TextRequest,
    onEvent: (ev: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const t0 = Date.now()
    let resp: Response
    try {
      resp = await fetch(`${this.base}/reel-chat-stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(buildBody(req)),
        signal,
      })
    } catch (e) {
      const msg = `[NET] host text stream fetch failed: ${(e as Error).message}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }
    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => '')
      const msg = `[HTTP ${resp.status}] ${errText.slice(0, 240)}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }

    onEvent({ type: 'open' })
    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    let full = ''
    let errored: string | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          const payload = t.slice(5).trim()
          if (!payload) continue
          let obj: { delta?: string; done?: boolean; full?: string; error?: string }
          try {
            obj = JSON.parse(payload)
          } catch {
            continue
          }
          if (obj.error) {
            errored = obj.error
            continue
          }
          if (typeof obj.delta === 'string' && obj.delta) {
            full += obj.delta
            onEvent({ type: 'text', delta: obj.delta, cumulative: full })
          }
          if (obj.done && typeof obj.full === 'string' && obj.full.length > full.length) {
            full = obj.full
          }
        }
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        /* noop */
      }
    }

    if (errored) {
      onEvent({ type: 'error', message: `[API] ${errored}` })
      throw new Error(`[API] ${errored}`)
    }
    if (!full.trim()) {
      const msg = '[EMPTY] no content'
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }
    const latencyMs = Date.now() - t0
    onEvent({ type: 'done', full, latencyMs })
    return full
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
    const t0 = Date.now()
    try {
      const out = await this.generate({
        systemPrompt: 'You are a ping echo.',
        userPrompt: 'reply with the single word: pong',
        maxTokens: 8,
        temperature: 0,
      })
      return { ok: true, latencyMs: Date.now() - t0, sample: out.trim() }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message }
    }
  }
}

/**
 * 是否走宿主文本网关（litellm）。
 *   - 嵌入宿主（path 含 /plugins/wb-reel）→ 默认开
 *   - localStorage `reel-studio.textProvider`：'host' 强制开 / 'direct' 强制关
 */
export function shouldUseHostTextGateway(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const override = window.localStorage.getItem('reel-studio.textProvider')
    if (override === 'host') return true
    if (override === 'direct') return false
  } catch {
    /* ignore */
  }
  // 同 HostGatewayImageProvider：独立插件 dev 把 wb-reel iframe 到自己端口
  // （路径 '/'），仍经宿主 /__ce-api__ 反代到 forgeax-server → litellm。
  // 「被 iframe 嵌入」即默认走宿主网关；真正独立打开才回落直连。
  if (window.location.pathname.includes('/plugins/wb-reel')) return true
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
