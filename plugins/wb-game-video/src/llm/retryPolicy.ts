/**
 * 重试策略 —— 纯函数。
 *
 * 真实 bug 现场：image gen 偶发 `[HTTP 429] EngineOverloaded`，单次 fetch 卡 62s
 * 才报错；下游链路（剧情树缩略、批量生图）整段瘫痪。
 *
 * 这个模块把"是否重试"和"等多久"这两个决策做成纯函数，方便单测覆盖死角。
 *
 * 调用约定：
 *   1) 网络失败（fetch 抛 TypeError）→ shouldRetryError → 重试
 *   2) 服务端响应（resp）→ shouldRetryHttp(resp.status)
 *      - 429 / 5xx → true，按 computeBackoffMs 等
 *      - 其他 → 不重试，直接抛
 *   3) AbortError 永不重试（用户主动取消信号）
 */

/** HTTP 状态码：哪些值得重试。 */
export function shouldRetryHttp(status: number): boolean {
  if (status === 429) return true
  if (status >= 500 && status < 600) return true
  return false
}

/** 网络层错误：fetch 抛出来的 Error 对象 → 是否值得重试。 */
export function shouldRetryError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // 用户主动 abort 不重试 —— 拉到底也没意义
  if (err.name === 'AbortError') return false
  // TypeError 通常是网络错（CORS、DNS、断网）
  if (err instanceof TypeError) return true
  // 其他业务错（[API ...]、[PARSE]）按字面理解是确定性的，不重试
  return false
}

/**
 * 计算第 attempt 次失败后应等多久（毫秒）。
 *
 * 优先级：
 *   1) Retry-After 头能解析成数字秒 → 用之（+ jitter 避免惊群）
 *   2) 否则指数退避：base = min(2^attempt * 1000, 30_000)，再加 ±25% jitter
 *
 * @param attempt 已重试次数（0 表示第 1 次重试前的 wait）
 * @param retryAfterHeader 可选；HTTP "Retry-After" 头的原值
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterHeader?: string | null,
): number {
  // Retry-After 优先（429 通常带）
  if (retryAfterHeader) {
    const seconds = parseFloat(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds > 0) {
      // 服务端要等 N 秒，外加 0-25% jitter，避免大家同时撞回
      const jitter = seconds * 1000 * Math.random() * 0.25
      return Math.round(seconds * 1000 + jitter)
    }
  }
  // 指数退避：1s, 2s, 4s, 8s, 16s, 30s（封顶）
  const base = Math.min(2 ** attempt * 1000, 30_000)
  // ±25% jitter
  const jitter = base * (Math.random() * 0.5 - 0.25)
  // 再钳一次：jitter 可能把 30s 推超，最终结果不超过 30s
  return Math.min(30_000, Math.max(0, Math.round(base + jitter)))
}

// ─────────────────────────────────────────────────────────────────────────────
// withRetry —— 把一段"会报错的请求"包成"自动重试的请求"
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryOpts {
  /** 最大尝试次数（含首次）。默认 5 次（首次 + 4 次重试）。 */
  maxAttempts?: number
  /** 每次重试前的 callback，作者排错时能在 console 看到 */
  onRetry?: (info: {
    attempt: number
    totalAttempts: number
    waitMs: number
    reason: string
  }) => void
  /** 自定义 sleep —— 测试时注入 fake timer / 立即返回 */
  sleep?: (ms: number) => Promise<void>
}

/**
 * 通用重试包装：尝试 fn()，遇到可重试错（网络错 / 429 / 5xx）退避后再来。
 *
 * 关键不变量：
 *   - 业务错（[API ...]）抛出来的就抛出去，不重试
 *   - HTTP 4xx (除 429) 不重试
 *   - 失败次数达到 maxAttempts 后抛**最后一次**的错（带 attempt 标记便于诊断）
 */
export async function withRetry<T>(
  fn: () => Promise<{ resp: Response; payload: T } | T>,
  opts: RetryOpts = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 5
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      const out = await fn()
      // 调用方可以返回 { resp, payload } 让 withRetry 看 status；
      // 否则就直接当成成功值
      if (out && typeof out === 'object' && 'resp' in out && 'payload' in out) {
        const { resp, payload } = out as { resp: Response; payload: T }
        if (resp.ok) return payload
        if (!shouldRetryHttp(resp.status) || attempt === max - 1) {
          throw new Error(
            `[HTTP ${resp.status}] ${resp.statusText}` +
              (attempt > 0 ? ` · attempt=${attempt + 1}/${max}` : ''),
          )
        }
        const wait = computeBackoffMs(attempt, resp.headers.get('retry-after'))
        opts.onRetry?.({
          attempt: attempt + 1,
          totalAttempts: max,
          waitMs: wait,
          reason: `HTTP ${resp.status}`,
        })
        await sleep(wait)
        continue
      }
      return out as T
    } catch (e) {
      lastErr = e
      if (!shouldRetryError(e) || attempt === max - 1) {
        throw e
      }
      const wait = computeBackoffMs(attempt)
      opts.onRetry?.({
        attempt: attempt + 1,
        totalAttempts: max,
        waitMs: wait,
        reason: (e as Error).message,
      })
      await sleep(wait)
    }
  }
  // 理论上走不到这里，但 TS 要求
  throw lastErr ?? new Error('[RETRY] exhausted without throwing')
}
