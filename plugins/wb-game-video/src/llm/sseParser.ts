/**
 * 把一段 SSE byte stream 解析成 Anthropic Messages 风格的 event 流。
 *
 * 只处理我们实际需要的事件类型：
 *   - `content_block_delta` 里的 `text_delta` → 当作真实可见内容增量
 *   - `message_delta.stop_reason` → 拼到 done 事件里，用于诊断 max_tokens 截断
 *
 * 其他事件（message_start / content_block_start / ping 等）全部忽略，
 * UI 不关心厂商协议细节。
 *
 * 设计要点：
 *   - 纯函数式 feed()：一次喂一段 buffer，返回**本次喂入产生的**事件
 *     这让单测非常好写（不用真 fetch、不用 mock ReadableStream）
 *   - SSE 事件块以 `\n\n` 为分隔；每块内部按行解析 event: / data:
 *   - 跨 chunk 粘包由 `carry` 承接
 */

export interface SseParsedEvent {
  /** 文本增量（text_delta） */
  text?: string
  /** 模型自报的 stop_reason（message_delta 里来的） */
  stopReason?: string
  /** 上游报错（event:error）—— 让调用端能把 message 往 UI 上甩 */
  errorMessage?: string
}

export interface SseParserState {
  carry: string
}

interface AnthropicEventData {
  type?: string
  delta?: { type?: string; text?: string; stop_reason?: string }
  error?: { message?: string }
}

export function createSseParser(): SseParserState {
  return { carry: '' }
}

/**
 * 喂入一段新字节（已 TextDecoder 过）；返回本次喂入解析出来的事件。
 * 残缺的半段会留在 state.carry，等下次 feed 补齐。
 */
export function feedSse(state: SseParserState, chunk: string): SseParsedEvent[] {
  state.carry += chunk
  const out: SseParsedEvent[] = []

  while (true) {
    const sep = state.carry.indexOf('\n\n')
    if (sep < 0) break
    const block = state.carry.slice(0, sep)
    state.carry = state.carry.slice(sep + 2)

    let eventName = ''
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
      // 忽略空行 / 注释行（以 : 开头）
    }
    if (dataLines.length === 0) continue
    const dataStr = dataLines.join('\n')
    if (dataStr === '[DONE]') {
      // OpenAI 风格哨兵；Anthropic 没有，但遇到就当结束
      continue
    }

    let parsed: AnthropicEventData
    try {
      parsed = JSON.parse(dataStr) as AnthropicEventData
    } catch {
      continue
    }

    // Anthropic SSE：event name 和 data.type 都有，用 data.type 更稳
    const t = parsed.type ?? eventName
    if (t === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      const text = parsed.delta.text
      if (typeof text === 'string' && text.length > 0) {
        out.push({ text })
      }
    } else if (t === 'message_delta' && parsed.delta?.stop_reason) {
      out.push({ stopReason: parsed.delta.stop_reason })
    } else if (t === 'error' && parsed.error?.message) {
      out.push({ errorMessage: parsed.error.message })
    }
  }

  return out
}
