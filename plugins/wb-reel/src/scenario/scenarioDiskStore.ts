import type { PersistedDb } from './scenarioPersist'
import { gameQuery } from '../shell/gameScope'

/**
 * scenarioDiskStore —— 剧本持久化的"磁盘镜像"前端适配层。
 *
 * 对应 Vite 插件 reel-scenarios（见 vite.config.ts 底部），接口极简：
 *   GET  /__reel__/scenarios       → { db: PersistedDb }
 *   PUT  /__reel__/scenarios       ← { db: PersistedDb }
 *
 * 为什么要这一层：
 *   原先剧本只写 localStorage，换浏览器 / 清站点数据 → 历史全丢。
 *   把同一份 PersistedDb 镜像到 dev server 所在目录（.reel-scenarios/），
 *   同一台机器任何浏览器启动都能读回。放在 iCloud 目录下还能跨机器同步。
 *
 * 行为契约：
 *   - 失败时**绝不抛** —— 上层 boot 要能优雅降级为 "localStorage only" 模式。
 *   - probeAvailable() 一次性探测，结果缓存在模块内；测试可 __resetForTest。
 *   - SSR / 静态构建（没有 dev server）时，探测失败 → 全链路回退到
 *     localStorage 行为，不影响已部署的 single-file bundle。
 */

const ENDPOINT = '/__reel__/scenarios'

let _available: boolean | null = null
let _availablePromise: Promise<boolean> | null = null

/**
 * 探测磁盘插件是否可用。结果缓存，重复调用只发一次请求。
 *
 * 判据：GET {endpoint} 在 5s 内返回 200 且 body 能 JSON 解。
 * 其他情形（404 / 网络错误 / 超时 / 解析失败）一律视为不可用。
 */
export function probeDiskAvailable(): Promise<boolean> {
  if (_available !== null) return Promise.resolve(_available)
  if (_availablePromise) return _availablePromise

  _availablePromise = (async () => {
    if (typeof fetch === 'undefined') {
      _available = false
      return false
    }
    try {
      // 不用 setTimeout 做超时：测试环境下 fakeTimers 会让 setTimeout 永不触发，
      // 反而让 fetch 无限挂着被 teardown 强杀产生噪音。dev server 同机本地
      // 毫秒级响应；异常走 catch 静默降级就够。
      const res = await fetch(ENDPOINT + gameQuery(), {
        method: 'GET',
        cache: 'no-store',
      })
      if (!res.ok) {
        _available = false
        return false
      }
      const body = (await res.json()) as { db?: unknown }
      _available = Boolean(body && typeof body === 'object' && 'db' in body)
      return _available
    } catch {
      _available = false
      return false
    } finally {
      _availablePromise = null
    }
  })()
  return _availablePromise
}

/**
 * 从磁盘读 PersistedDb；插件不可用或请求失败时返回 null。
 * 上层用 null 当信号：回退到 localStorage。
 */
export async function loadDbFromDisk(): Promise<PersistedDb | null> {
  if (typeof fetch === 'undefined') return null
  try {
    const res = await fetch(ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { db?: PersistedDb }
    if (!body || typeof body !== 'object' || !body.db) return null
    return body.db
  } catch {
    return null
  }
}

/**
 * 把 PersistedDb 写入磁盘。
 *
 * 返回 boolean 表示是否成功；失败时上层不应抛 —— 磁盘层是"增强"，
 * 失败不应该阻断用户操作，localStorage 会单独保证兜底。
 *
 * 失败场景：
 *   - 插件未挂载（静态 bundle / 非 vite dev 环境）
 *   - dev server 已停 / 网络错误
 *   - 超过 32 MiB 单 db 上限（插件侧 413）
 */
export async function saveDbToDisk(db: PersistedDb): Promise<boolean> {
  if (typeof fetch === 'undefined') return false
  try {
    const res = await fetch(ENDPOINT + gameQuery(), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ db }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** 仅测试用：清空缓存让 probe 重新发请求。 */
export function __resetScenarioDiskForTest(): void {
  _available = null
  _availablePromise = null
}
