import type { StreamEvent, TextClient, TextRequest } from './types'

/**
 * Google Generative Language API（AI Studio）—— Gemini 3.x pro / flash。
 *
 * 端点：`<api_base>/v1beta/models/<model>:generateContent?key=<apiKey>`
 *      流式：`:streamGenerateContent?alt=sse&key=<apiKey>`
 *   - `<api_base>` = `https://generativelanguage.googleapis.com`（llm_key.json: `gemini-aistudio.api_base`）
 *   - 认证：`key` query 参数（比 header 稳，代理/CORS 都通）
 *
 * 请求 body（Gemini 原生格式）：
 * ```
 * {
 *   system_instruction: { parts: [{ text: "..." }] },
 *   contents: [ { role: "user", parts: [{ text: "..." }] } ],
 *   generationConfig: {
 *     temperature: 0.85,
 *     maxOutputTokens: 1024,
 *     responseMimeType: "application/json",  // 仅 jsonMode
 *   }
 * }
 * ```
 *
 * 响应：
 * ```
 * {
 *   candidates: [{
 *     content: { parts: [{ text: "..." }], role: "model" },
 *     finishReason: "STOP" | "MAX_TOKENS" | "SAFETY" | ...
 *   }],
 *   promptFeedback: { blockReason?: string }
 * }
 * ```
 *
 * 流式 SSE 的每个 data 事件里，是一个**完整的增量 response**，取 `candidates[0].content.parts[0].text` 作为 delta。
 *
 * 与 ClaudeAzureProvider 语义完全对齐：
 *   - MAX_TOKENS → 抛 [TRUNCATED]
 *   - 空输出 → 抛 [EMPTY]
 *   - 网络错误 → [NET]，HTTP 非 2xx → [HTTP ...]
 *
 * 前端直连 key（与 Claude 方案一致）仅用于内部 dev 沙盒。
 */

interface GeminiConfig {
  apiKey: string
  /** 形如 `https://generativelanguage.googleapis.com`（尾部斜杠会被剥掉） */
  apiBase: string
  /** 默认 `gemini-3.1-pro-preview`，可传任意支持 generateContent 的 model id */
  model?: string
}

interface GeminiPart {
  text?: string
  /**
   * thought-only chunk 标志 —— Gemini 3.x forced-thinking 模型流式时常见：
   * part 带 thoughtSignature 但 text 为 ''。不能当作"已成功输出"。
   */
  thoughtSignature?: string
}

/**
 * 从 SSE buffer 里切出已完成的事件块。
 *
 * 纯函数（便于单测回放真实 Gemini SSE 片段）：
 *   入参：buffer（刚 decode 过的文本，可能以半条事件结尾）
 *   出参：{ events: 已完成事件列表（不含分隔符）, rest: 残余 buffer }
 *
 * 为什么自己切：Gemini 公网端点吐的事件分隔符**既可能是 `\n\n` 也可能是 `\r\n\r\n`**
 * （不同 frontend / 代理不一致）。原实现只认 `\n\n`，一旦上游 CRLF
 * chunk 化到一半就在 buffer 里永远对不齐 —— 表现为 `events=0`。
 */
export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = []
  let i = 0
  // 逐字符找分隔符；优先 \r\n\r\n，然后 \n\n
  while (i < buffer.length) {
    const crlf = buffer.indexOf('\r\n\r\n', i)
    const lf = buffer.indexOf('\n\n', i)
    let sepIdx = -1
    let sepLen = 0
    if (crlf >= 0 && (lf < 0 || crlf < lf)) {
      sepIdx = crlf
      sepLen = 4
    } else if (lf >= 0) {
      sepIdx = lf
      sepLen = 2
    }
    if (sepIdx < 0) break
    events.push(buffer.slice(i, sepIdx))
    i = sepIdx + sepLen
  }
  return { events, rest: buffer.slice(i) }
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string }
  finishReason?: string
}
interface GeminiResponse {
  candidates?: GeminiCandidate[]
  promptFeedback?: { blockReason?: string }
  error?: { code?: number; message?: string; status?: string }
}

/**
 * 构造 Gemini 请求 body —— 纯函数，便于单测。
 *
 * v3.9.8 · thinking 模型默认 maxTokens 抬底
 *   Gemini 3.x 的 pro-preview（可能还有后续 3.x 系列）是 **forced thinking mode**：
 *     · `thinkingBudget: 0` 会被服务端拒 400（INVALID_ARGUMENT）
 *     · 输出 token 里 thinking 自己会吃 ~60-200+（短 prompt）甚至上千（长/复杂 prompt）
 *   如果 caller 传默认 `maxTokens=1024`，thinking 耗光后几乎没 text 额度 →
 *   `candidatesTokenCount=0~2` + `finishReason=MAX_TOKENS` 或连 finishReason 都没带 →
 *   `extractGeminiText` 返 '' → 上层报 `[EMPTY] no content · finish=?`（作者端截图复现）。
 *
 *   补丁：model 名命中 gemini-3 系时，若 caller 给的 maxTokens < 8192 则抬到 8192。
 *   说明：
 *     · 2.5 pro / 2.5 flash 也支持 thinking 但默认关，不需要抬
 *     · 8192 是 Gemini 3 preview 对 pro 的稳妥下限，长链任务（storyboard forge）
 *       作者 caller 侧仍可再往上抬（没设上限）
 */
export function buildGeminiBody(
  req: TextRequest,
  model?: string,
): Record<string, unknown> {
  const isThinkingForced = !!model && /^gemini-3(?:\.|-)/.test(model)
  const requestedMax = req.maxTokens ?? 1024
  const maxOutputTokens = isThinkingForced
    ? Math.max(8192, requestedMax)
    : requestedMax
  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature ?? 0.85,
    maxOutputTokens,
  }
  if (req.jsonMode) {
    generationConfig.responseMimeType = 'application/json'
  }
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [{ text: req.userPrompt }],
      },
    ],
    generationConfig,
  }
  // 多模态早期保护（Phase 5）：当前 GeminiProvider 还没接 inline_data 图片，
  // 如果调用方带了 images，明确报错，避免图被静默丢弃。
  // 真正接图片支持时把这里换成 inline_data 拼装即可。
  if (Array.isArray(req.images) && req.images.length > 0) {
    throw new Error(
      '[MULTIMODAL_NOT_SUPPORTED] GeminiProvider does not yet accept image inputs; switch to ClaudeAzureProvider for vision.',
    )
  }
  const sys = req.systemPrompt?.trim()
  if (sys) {
    body.system_instruction = { parts: [{ text: sys }] }
  }
  return body
}

/**
 * 从 Gemini 响应里抽文本 —— 容错版：parts 可能有多条、也可能为空。
 *
 * v3.9.9：thought-only parts（只含 thoughtSignature 没 text）不计入"内容 text"。
 * 同时附返 hasThought 标志，帮上游分辨"确实收到了事件只是 thinking 没结束"
 * 和"事件格式挂了"两种失败态。
 */
export function extractGeminiText(data: GeminiResponse): {
  text: string
  hasThought: boolean
} {
  const cand = data.candidates?.[0]
  if (!cand?.content?.parts) return { text: '', hasThought: false }
  let text = ''
  let hasThought = false
  for (const p of cand.content.parts) {
    if (typeof p.text === 'string' && p.text.length > 0) text += p.text
    if (p.thoughtSignature) hasThought = true
  }
  return { text, hasThought }
}

export class GeminiProvider implements TextClient {
  private readonly apiKey: string
  private readonly apiBase: string
  private readonly model: string

  constructor(cfg: GeminiConfig) {
    if (!cfg.apiKey) throw new Error('GeminiProvider: missing apiKey')
    if (!cfg.apiBase) throw new Error('GeminiProvider: missing apiBase')
    this.apiKey = cfg.apiKey
    this.apiBase = cfg.apiBase.replace(/\/$/, '')
    this.model = cfg.model ?? 'gemini-3.1-pro-preview'
  }

  getModel(): string {
    return this.model
  }
  getProviderName(): string {
    return 'Gemini'
  }

  private endpoint(streaming: boolean): string {
    const action = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'
    const sep = action.includes('?') ? '&' : '?'
    return `${this.apiBase}/v1beta/models/${encodeURIComponent(
      this.model,
    )}:${action}${sep}key=${encodeURIComponent(this.apiKey)}`
  }

  async generate(req: TextRequest): Promise<string> {
    const url = this.endpoint(false)
    const body = buildGeminiBody(req, this.model)

    const t0 = performance.now()
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new Error(`[NET] Gemini fetch failed: ${(e as Error).message}`)
    }

    const latencyMs = Math.round(performance.now() - t0)
    const raw = await resp.text()
    if (!resp.ok) {
      throw new Error(
        `[HTTP ${resp.status}] ${resp.statusText} · ${raw.slice(0, 240)} · ${latencyMs}ms`,
      )
    }

    let data: GeminiResponse
    try {
      data = JSON.parse(raw) as GeminiResponse
    } catch {
      throw new Error(`[PARSE] non-JSON · head=${raw.slice(0, 200)}`)
    }
    if (data.error) {
      throw new Error(
        `[API ${data.error.status ?? data.error.code ?? '?'}] ${
          data.error.message ?? raw.slice(0, 200)
        }`,
      )
    }
    if (data.promptFeedback?.blockReason) {
      throw new Error(
        `[SAFETY] blocked by safety filter: ${data.promptFeedback.blockReason}`,
      )
    }

    const { text, hasThought } = extractGeminiText(data)
    const finish = data.candidates?.[0]?.finishReason ?? '?'
    if (!text.trim()) {
      const thoughtHint = hasThought
        ? `\n→ 模型返回了 thought-only chunk（只有 thoughtSignature 没 text）。` +
          `对于 gemini-3.x 强制推理模型，请把 maxTokens 调高（≥ 8192），` +
          `给 thinking 留足预算，避免 thinking 耗光后再没空间吐答案。`
        : ''
      throw new Error(
        `[EMPTY] no content · finish=${finish} · raw=${raw.slice(0, 200)}${thoughtHint}`,
      )
    }
    console.info(
      `[GeminiProvider] ✓ ${this.model} · ${latencyMs}ms · finish=${finish} · text.len=${text.length}`,
    )
    if (finish === 'MAX_TOKENS') {
      console.warn(
        `[GeminiProvider] ⚠ finish=MAX_TOKENS — 输出被 maxOutputTokens=${req.maxTokens ?? 1024} 截断`,
      )
      throw new Error(
        `[TRUNCATED] LLM 输出被 maxOutputTokens=${req.maxTokens ?? 1024} 截断，` +
          `已生成 ${text.length} 字符但未结束。\n` +
          `→ 解决：① 调高 maxTokens；② 或者把输入按章节分段再分批 forge。\n` +
          `partial=${text.slice(0, 600)}`,
      )
    }
    return text
  }

  /**
   * 流式生成 —— Gemini 的 SSE 每条 `data:` 就是一个**完整的增量 GeminiResponse**。
   * 我们逐条提取 text，追加到 `full`，并向外 emit delta。
   */
  async generateStream(
    req: TextRequest,
    onEvent: (ev: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const url = this.endpoint(true)
    const body = buildGeminiBody(req, this.model)

    const t0 = performance.now()
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (e) {
      const msg = `[NET] Gemini stream fetch failed: ${(e as Error).message}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => '')
      const msg = `[HTTP ${resp.status}] ${resp.statusText} · ${errText.slice(0, 240)}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }

    onEvent({ type: 'open' })

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let full = ''
    let finish: string | undefined
    // v3.9.8：诊断字段 —— 作者反馈"[EMPTY] no content · finish=?" 时我们
    //   完全不知道 LLM 究竟回了什么（thinking mode 把 token 花光？代理没
    //   返 SSE？parts 全是 thought 无 text？）。记下三件事：
    //     · eventCount：收到的 SSE 事件数 —— 0 = 代理根本没 stream
    //     · chunkCount：成功 parse 的 JSON chunk 数
    //     · lastParsedHead：最后一个 parsed chunk 的 JSON 前 240 字符，
    //       用于肉眼看 "有 candidate 但 parts 没 text" 之类的怪相
    let eventCount = 0
    let chunkCount = 0
    let lastParsedHead = ''
    // thought-only 事件计数（parts 里只有 thoughtSignature 没 text）
    let thoughtOnlyCount = 0

    // 把"拿到一个完整事件文本 → 解析 data: → 抽 text → 回调"抽出来，
    // 这样循环里和循环外 flush 残余都能复用。
    const handleEvent = (rawEvent: string): void => {
      eventCount += 1
      const dataLines = rawEvent
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
      if (dataLines.length === 0) return
      const payload = dataLines.join('')
      if (!payload || payload === '[DONE]') return
      let parsed: GeminiResponse
      try {
        parsed = JSON.parse(payload) as GeminiResponse
      } catch {
        return
      }
      chunkCount += 1
      lastParsedHead = payload.slice(0, 240)
      if (parsed.error) {
        const msg = `[API ${parsed.error.status ?? parsed.error.code ?? '?'}] ${
          parsed.error.message ?? ''
        }`
        onEvent({ type: 'error', message: msg })
        throw new Error(msg)
      }
      const reason = parsed.candidates?.[0]?.finishReason
      if (reason) finish = reason
      const { text: delta, hasThought } = extractGeminiText(parsed)
      if (delta) {
        full += delta
        onEvent({ type: 'text', delta, cumulative: full })
      } else if (hasThought) {
        thoughtOnlyCount += 1
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = splitSseEvents(buffer)
        buffer = rest
        for (const ev of events) handleEvent(ev)
      }
      // v3.9.10：reader done 之后 **必须 flush 残余 buffer**。
      // Gemini 公网端点有时最后一个 data 后面只跟了单个换行或直接 EOF，
      // 老实现只认 `\n\n` 分隔符，这一段 payload 就被永久丢进 /dev/null，
      // 表现为 "events=0"。先尝试把残余当最后一个事件再 parse 一次。
      const tail = buffer.trim()
      if (tail.length > 0) {
        handleEvent(tail)
        buffer = ''
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
      `[GeminiProvider] ✓ stream · ${this.model} · ${latencyMs}ms · finish=${
        finish ?? '?'
      } · text.len=${full.length} · events=${eventCount} · chunks=${chunkCount}` +
        (thoughtOnlyCount > 0 ? ` · thought-only=${thoughtOnlyCount}` : ''),
    )

    if (!full.trim()) {
      const isThinkingForced = /^gemini-3(?:\.|-)/.test(this.model)
      let hint = ''
      if (eventCount === 0) {
        hint =
          ' · 没有收到任何 SSE 事件 —— 代理 / 网关可能没开启流式，或上游没响应。' +
          `先用 curl 直打 streamGenerateContent 看是否是 text/event-stream。raw buffer 尾部 = "${buffer.slice(-240).replace(/\n/g, '\\n')}"`
      } else if (chunkCount === 0) {
        hint =
          ' · 收到了事件但全部解析失败 —— 代理可能吐了非 JSON 或被错误编码。' +
          `raw buffer 尾部 = "${buffer.slice(-240).replace(/\n/g, '\\n')}"`
      } else if (thoughtOnlyCount > 0 && chunkCount === thoughtOnlyCount) {
        // 所有 chunk 都是 thought-only —— 典型 forced-thinking 把预算烧光
        hint =
          ` · 所有 ${chunkCount} 个 chunk 都是 thought-only（只有 thoughtSignature 没 text）。` +
          `thinking 模型（${this.model}）把 maxOutputTokens=${req.maxTokens ?? 1024} 全花在思考上了。` +
          `方案：① caller 把 maxTokens 抬到 16384+；② 换非强制思考模型（gemini-2.5-pro / gemini-2.5-flash）。`
      } else if (finish === 'MAX_TOKENS' || isThinkingForced) {
        hint =
          ` · thinking 模型（${this.model}）输出预算被思考耗尽 —— ` +
          `maxOutputTokens=${req.maxTokens ?? 1024} 对这个 prompt 不够。` +
          `方案：① caller 传更大的 maxTokens（16384+）；② 换 non-thinking-forced 的模型（如 gemini-2.5-pro / gemini-2.5-flash）；③ 本 provider 已自动把 3.x 的下限抬到 8192，若仍不够请继续往上。` +
          `最后 chunk head = ${lastParsedHead}`
      } else {
        hint =
          ` · parts 里没有 text —— 可能是 thought-only 回复或代理剥掉了 text part。` +
          `最后 chunk head = ${lastParsedHead}`
      }
      const msg = `[EMPTY] no content · finish=${finish ?? '?'}${hint}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }
    if (finish === 'MAX_TOKENS') {
      const msg =
        `[TRUNCATED] LLM 输出被 maxOutputTokens=${req.maxTokens ?? 1024} 截断，` +
        `已生成 ${full.length} 字符但未结束。\n` +
        `→ 解决：① 调高 maxTokens；② 或者把输入按章节分段再分批 forge。\n` +
        `partial=${full.slice(0, 600)}`
      onEvent({ type: 'error', message: msg })
      throw new Error(msg)
    }

    onEvent({ type: 'done', full, stopReason: finish, latencyMs })
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
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        sample: out.trim(),
      }
    } catch (e) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        error: (e as Error).message,
      }
    }
  }
}
