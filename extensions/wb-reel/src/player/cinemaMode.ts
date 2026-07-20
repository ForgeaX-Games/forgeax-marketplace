/**
 * cinemaMode —— 试玩态「电影观影」自动进入逻辑
 *
 * 作者要求：进入 player 后 2 秒，把顶部"返回 / 设置"等 UI 渐隐掉，并让
 * 上下两条黑色 letterbox 滑入，营造观看电影的仪式感。
 *
 * 这里把"是否应激活电影模式"抽成一个纯函数 —— 只依赖两个参数：
 *   - sinceEnterMs: 进入 player 后经过的毫秒数
 *   - delayMs:      延迟阈值（产品当前 2000ms）
 *
 * 这样：
 *   1) React 组件只负责启动/清理 setTimeout，不掺杂判定逻辑；
 *   2) 规则变了（比如改成 1.5s、或者条件增加"鼠标静止"），都在这里改；
 *   3) 可以 vitest 跑，不依赖 happy-dom 和 React 生命周期。
 */

export const DEFAULT_CINEMA_DELAY_MS = 2000

/** 何时应当进入 cinema（letterbox + UI 渐隐）。小于 delay 返回 false。 */
export function shouldActivateCinema(
  sinceEnterMs: number,
  delayMs: number = DEFAULT_CINEMA_DELAY_MS,
): boolean {
  if (!Number.isFinite(sinceEnterMs) || sinceEnterMs < 0) return false
  if (!Number.isFinite(delayMs) || delayMs < 0) return false
  return sinceEnterMs >= delayMs
}

/**
 * 规整 delay 输入：
 *   - 负数 / NaN → fallback 到默认值
 *   - 非整数 → Math.max(0, Math.round(x))
 * 这一层的价值是：调用方（如 App.tsx）拿到外部配置时可以不自己做防御性处理，
 * 交给这里统一收口，避免 setTimeout(NaN) 导致"永远不进电影模式"的静默 bug。
 */
export function normalizeCinemaDelay(
  raw: unknown,
  fallback: number = DEFAULT_CINEMA_DELAY_MS,
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return fallback
  return Math.max(0, Math.round(raw))
}
