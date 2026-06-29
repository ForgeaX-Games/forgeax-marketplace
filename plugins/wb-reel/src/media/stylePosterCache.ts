import type { ImageClient } from '../llm/types'

/**
 * stylePosterCache —— 风格/UI 预设「海报样张」缓存。
 *
 * 海报样张靠 API 实时生成（贵 + 慢），所以分三层命中：
 *   内存 Map → IndexedDB → client.generate（竖版 1024x1536 海报）。
 *
 * 设计要点（沿用 mediaIdb / sceneImageCache 的防御式三层模型）：
 *   - 内存层：cacheKey → dataUrl，O(1) 命中。
 *   - in-flight：同一 cacheKey 并发只触发一次 generate，settle 后清掉。
 *   - IndexedDB：独立 DB/store，key=cacheKey value=dataUrl 字符串；
 *     读不到不报错、写失败吞掉，且在无 indexedDB（SSR/单测）环境直接跳过。
 *   - generate 抛错 → 返回 null 且不缓存（允许下次重试），调用方降级到 swatch 占位。
 */

const DB_NAME = 'reel-style-posters'
const STORE = 'posters'
const DB_VERSION = 1

const memCache = new Map<string, string>()
const inFlight = new Map<string, Promise<string | null>>()

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

let _dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!hasIDB()) return Promise.reject(new Error('indexedDB unavailable'))
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('idb open failed'))
  })
  return _dbPromise
}

async function idbGet(key: string): Promise<string | null> {
  if (!hasIDB()) return null
  try {
    const db = await openDb()
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const st = tx.objectStore(STORE)
      const req = st.get(key)
      req.onsuccess = () => {
        const v = req.result
        resolve(typeof v === 'string' ? v : null)
      }
      req.onerror = () => reject(req.error ?? new Error('idb get failed'))
    })
  } catch {
    return null
  }
}

async function idbPut(key: string, value: string): Promise<void> {
  if (!hasIDB()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const st = tx.objectStore(STORE)
      const req = st.put(value, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('idb put failed'))
    })
  } catch {
    // 忽略：隐私模式 / 配额耗尽，不影响返回值
  }
}

/** 海报样张支持的画幅：竖版电影海报（风格）/ 横版 16:9（UI 截图）。 */
export type StylePosterSize = '1024x1536' | '1536x1024'

/**
 * 取某个 style/ui 预设的海报样张 dataUrl。
 * 命中顺序：内存 Map → IndexedDB → client.generate。
 *   - 风格：竖版 '1024x1536' 电影海报（默认）
 *   - UI：横版 '1536x1024'（16:9 截图样张），由调用方传 size 指定
 * 生成成功后写回内存 + IndexedDB。失败返回 null（调用方降级到 swatch 渐变占位）。
 * 同一 cacheKey 并发调用只触发一次 generate（in-flight promise 去重）。
 *
 * 注意：cacheKey 须随 size 区分（如 'ui:obsidian-glass:1536x1024'），
 * 否则换比例后会命中旧画幅缓存。调用方负责在 key 里带尺寸语义。
 */
export async function ensureStylePoster(
  cacheKey: string,
  posterPrompt: string,
  client: ImageClient,
  size: StylePosterSize = '1024x1536',
): Promise<string | null> {
  const mem = memCache.get(cacheKey)
  if (mem) return mem

  const pending = inFlight.get(cacheKey)
  if (pending) return pending

  const task = (async (): Promise<string | null> => {
    // 缓存 key 按 provider 维度隔离：Mock 占位图（把 prompt 画成文字）绝不能与
    // 真实 AzureOpenAI 生成图共用 key —— 否则一旦 mock 阶段写过 IndexedDB，
    // 后续切到真 key 也会命中旧的"文字占位图"，表现为"图片永远是空的/一堆英文"。
    const provider = client.getProviderName?.() ?? 'unknown'
    const scopedKey = `${provider}::${cacheKey}`

    // IndexedDB 命中（按 provider 隔离的 key）
    const fromIdb = await idbGet(scopedKey)
    if (fromIdb) {
      memCache.set(cacheKey, fromIdb)
      return fromIdb
    }

    // 没缓存 → 生成；失败返回 null 且不缓存（允许下次重试）
    try {
      const result = await client.generate({
        prompt: posterPrompt,
        size,
        n: 1,
      })
      const dataUrl = result.dataUrl
      memCache.set(cacheKey, dataUrl)
      // Mock 占位图不落 IndexedDB —— 避免污染下次真 key 会话（mock 是临时降级）
      if (provider !== 'Mock') {
        void idbPut(scopedKey, dataUrl)
      }
      return dataUrl
    } catch {
      return null
    }
  })()

  inFlight.set(cacheKey, task)
  try {
    return await task
  } finally {
    inFlight.delete(cacheKey)
  }
}

/** 测试用：清空内存缓存与 in-flight map */
export function __resetStylePosterCacheForTest(): void {
  memCache.clear()
  inFlight.clear()
  _dbPromise = null
}
