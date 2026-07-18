/**
 * rAF 节流 —— 把"高频参数 → 低频副作用"压到一帧最多一次。
 *
 * 用例：
 *   - 鼠标移动事件高频触发 setState，但显示的目标只需要 60fps；
 *   - 多次写入同一帧的"最后一次值"代表了用户意图，前面那些都可以丢。
 *
 * 设计：
 *   - 调用 throttled(args) 时**总是**记下最新 args；
 *   - 一帧之内只调度一次 effect；effect 拿当下最新的 args 执行；
 *   - cancel() 释放挂起的帧、丢弃挂起的 args；
 *   - 在 jsdom / SSR（无 requestAnimationFrame）下退化为 0ms setTimeout。
 *
 * 该工具**不带过期时间**——如果 effect 抛错，捕获后忽略，下一次仍可调度。
 */
export interface RafThrottled<TArgs extends unknown[]> {
  (...args: TArgs): void
  cancel(): void
}

/**
 * 通过 globalThis 间接取 RAF 引用（而不是 module 顶层捕获），
 * 这样测试中替换 `globalThis.requestAnimationFrame` 也能命中实现。
 */
function scheduleFrame(cb: FrameRequestCallback): number {
  const fn = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
    .requestAnimationFrame
  if (typeof fn === 'function') return fn(cb)
  return setTimeout(() => cb(performance.now()), 0) as unknown as number
}

function cancelFrame(id: number): void {
  const fn = (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame })
    .cancelAnimationFrame
  if (typeof fn === 'function') {
    fn(id)
    return
  }
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
}

export function rafThrottle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
): RafThrottled<TArgs> {
  let scheduled: number | null = null
  let pending: TArgs | null = null

  function throttled(...args: TArgs): void {
    pending = args
    if (scheduled != null) return
    scheduled = scheduleFrame(() => {
      scheduled = null
      const args2 = pending
      pending = null
      if (args2) {
        try {
          fn(...args2)
        } catch (err) {
          console.warn('[rafThrottle] handler threw:', err)
        }
      }
    })
  }

  throttled.cancel = (): void => {
    if (scheduled != null) {
      cancelFrame(scheduled)
      scheduled = null
    }
    pending = null
  }

  return throttled as RafThrottled<TArgs>
}
