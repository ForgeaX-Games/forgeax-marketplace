/**
 * Vitest 全局 setup。
 *
 * 为什么需要：happy-dom 20.9.0 在 vitest 3 环境下 `window.localStorage` 的方法
 * （clear / getItem / setItem …）经其 Proxy 暴露后取不到（`typeof ...clear === 'undefined'`），
 * 导致一切依赖 localStorage 的测试（videoTaskStore 等）整片 `is not a function` 失败。
 *
 * 修法：用一个确定可用的内存版 Storage 覆盖 `globalThis` 与 `window` 上的 localStorage /
 * sessionStorage（同一实例，保证「测试里 clear」与「被测代码里读写」作用于同一份数据）。
 * 仅测试期生效，不进生产构建。
 */
class MemoryStorage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }
}

function needsPolyfill(target: object, prop: 'localStorage' | 'sessionStorage'): boolean {
  const probe = (target as Record<string, unknown>)[prop] as { clear?: unknown } | undefined
  return !probe || typeof probe.clear !== 'function'
}

function install(targets: object[], prop: 'localStorage' | 'sessionStorage'): void {
  // 同一实例铺到所有目标，保证 `window.x` 与全局 `x` 读写同一份数据
  const shared = new MemoryStorage()
  for (const t of targets) {
    if (!needsPolyfill(t, prop)) continue
    Object.defineProperty(t, prop, { value: shared, configurable: true, writable: true })
  }
}

const targets: object[] = [globalThis]
if (typeof window !== 'undefined' && window !== (globalThis as unknown)) targets.push(window)
install(targets, 'localStorage')
install(targets, 'sessionStorage')
