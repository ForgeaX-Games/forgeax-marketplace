/**
 * 图像 endpoint 全局限流（进程内单例）。
 *
 * 为什么要这个：
 *   v3.8 之前只在每个批量调度器里做 concurrency，但实际场景下：
 *     - BatchGenBar 的"一键生成所有分镜" (concurrency=4)
 *     - Timeline / StagePane 点单镜即时生图
 *     - Forge 流水线（参考图 / turnaround）
 *   三条路径各自 limit，但**共享同一个 Azure deployment**，加起来就会打到 8+ 并发，
 *   立即触发 429 Too Many Requests。多次重试还会把配额算进 rate-limit window，越抢越慢。
 *
 * 方案：
 *   - 单一全局 semaphore —— 同时在飞的 fetch 不超过 `maxConcurrent`
 *   - 单一令牌桶 —— 每秒最多发出 `rps` 个请求（削峰）
 *   - 429 抛到上层时，caller 调 `noteRateLimitHit(retryAfterMs)` 让整桶暂停
 *
 * 默认值（保守起见）：
 *   - maxConcurrent = 3
 *   - rps = 1.5（≈ 每 667ms 一个）
 *   - rateLimitCooldownMs = 2000（429 命中后全桶静默 2s）
 *
 * 这些数能从 env 覆盖（vite define）：
 *   __RS_IMG_MAX_CONCURRENT__, __RS_IMG_RPS__ —— 可选
 */

interface QueueEntry {
  resolve: () => void
}

class ImageRateLimiter {
  private readonly maxConcurrent: number
  private readonly minIntervalMs: number
  private readonly rateLimitCooldownMs: number

  private inFlight = 0
  private lastStartAt = 0
  private cooldownUntil = 0
  private queue: QueueEntry[] = []

  constructor(cfg: {
    maxConcurrent: number
    rps: number
    rateLimitCooldownMs: number
  }) {
    this.maxConcurrent = Math.max(1, cfg.maxConcurrent)
    this.minIntervalMs = Math.max(0, Math.round(1000 / Math.max(0.1, cfg.rps)))
    this.rateLimitCooldownMs = Math.max(0, cfg.rateLimitCooldownMs)
  }

  /**
   * 取一个令牌 —— 并发/令牌桶/cooldown 都满足后 resolve。
   * 调用方必须在 finally 里调用 `release()`，否则会把位置永久占住。
   */
  async acquire(): Promise<() => void> {
    await new Promise<void>((resolve) => {
      this.queue.push({ resolve })
      this.pump()
    })
    let released = false
    return () => {
      if (released) return
      released = true
      this.inFlight--
      this.pump()
    }
  }

  /**
   * 通知限流器：刚刚命中 429。整桶进入冷却期，后续 acquire 会多等。
   * retryAfterMs 优先于默认 cooldownMs；取两者较大。
   */
  noteRateLimitHit(retryAfterMs?: number): void {
    const wait = Math.max(this.rateLimitCooldownMs, retryAfterMs ?? 0)
    const until = Date.now() + wait
    if (until > this.cooldownUntil) this.cooldownUntil = until
  }

  private pump(): void {
    while (
      this.queue.length > 0 &&
      this.inFlight < this.maxConcurrent
    ) {
      const now = Date.now()
      const earliestStart = Math.max(
        this.lastStartAt + this.minIntervalMs,
        this.cooldownUntil,
      )
      if (now < earliestStart) {
        setTimeout(() => this.pump(), earliestStart - now)
        return
      }
      const entry = this.queue.shift()!
      this.inFlight++
      this.lastStartAt = now
      entry.resolve()
    }
  }
}

// ── 默认实例 ───────────────────────────────────────────────────────────────
// 没做 env 覆盖的 getter，避免引 vite-globals；实际调参改这三个字面量。
const DEFAULT_MAX_CONCURRENT = 3
const DEFAULT_RPS = 1.5
const DEFAULT_COOLDOWN_MS = 2000

export const imageRateLimiter = new ImageRateLimiter({
  maxConcurrent: DEFAULT_MAX_CONCURRENT,
  rps: DEFAULT_RPS,
  rateLimitCooldownMs: DEFAULT_COOLDOWN_MS,
})
