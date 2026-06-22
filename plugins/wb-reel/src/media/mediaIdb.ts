/**
 * mediaIdb —— mediaStore 的 IndexedDB 本地兜底。
 *
 * 为什么需要这一层：
 *   - 用户上传视频后，mediaStore.ingest 会 fire-and-forget 调 assetStore.saveBlob
 *     把 blob 发给 dev server 落盘。成功路径下，刷新时 hydrateMediaFromAssets 能
 *     把磁盘 URL 灌回 mediaStore，UI 不感知。
 *   - 但如果 saveBlob 失败 / 未完成时就刷新 / 离线打包产物里根本没有后端 ——
 *     assetStore.records 里就没有这条 mediaId 的记录，刷新后 SceneAssetGallery
 *     查 entries 查不到，UI 变成 "ref missing"。用户已经为此反馈过三次。
 *
 * 设计原则（同 assetStore / sceneImageCache 的三层模型）：
 *
 *   ┌──────────────────────┬──────────────┬────────────────────────┐
 *   │ 层                   │ 存储         │ 生命周期               │
 *   ├──────────────────────┼──────────────┼────────────────────────┤
 *   │ assetStore           │ 磁盘         │ 持久（最优）           │
 *   │ mediaIdb（本层）     │ IndexedDB    │ 持久（本地兜底）       │
 *   │ mediaStore.entries   │ 内存/blob    │ 当前会话               │
 *   └──────────────────────┴──────────────┴────────────────────────┘
 *
 *   - put：与 ingest 同步触发，异步落 IDB；即便后端挂也能刷新恢复
 *   - getAll：启动时拉全量，喂给 hydrateMediaFromIdb 产 MediaEntry
 *   - delete：与 mediaStore.remove 同步，避免 IDB 无限膨胀
 *
 * 纯函数 vs 副作用：
 *   - 本模块所有导出函数都返回 Promise；内部握住 DB 连接，lazy 打开
 *   - SSR / 无 indexedDB 环境（node 单测默认无 IDB）下，所有操作 no-op + resolve 空值
 *     —— 这样 ingest 调用点不需要 try/catch，也能继续裸奔
 */

const DB_NAME = 'reel-studio-media'
const STORE = 'blobs'
const DB_VERSION = 1

export interface StoredMedia {
  id: string
  name: string
  mimeType: string
  size: number
  createdAt: number
  blob: Blob
}

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
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('idb open failed'))
  })
  return _dbPromise
}

/**
 * 写入一条 blob。成功 resolve(void)；IDB 不可用 / 写失败时 **静默 resolve**
 *（绝不 reject 抛错到 fire-and-forget 的 ingest 里，否则会污染控制台）。
 */
export async function putMedia(m: StoredMedia): Promise<void> {
  if (!hasIDB()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const st = tx.objectStore(STORE)
      const req = st.put(m)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('idb put failed'))
    })
  } catch {
    // 忽略：用户可能在隐私模式 / 存储配额耗尽，让 ingest 流程继续
  }
}

/**
 * 取所有 blob 记录 —— hydrate 启动阶段用。
 * IDB 不可用时返回空数组而不是 reject。
 */
export async function getAllMedia(): Promise<StoredMedia[]> {
  if (!hasIDB()) return []
  try {
    const db = await openDb()
    return await new Promise<StoredMedia[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const st = tx.objectStore(STORE)
      const req = st.getAll()
      req.onsuccess = () => resolve((req.result as StoredMedia[]) ?? [])
      req.onerror = () => reject(req.error ?? new Error('idb getAll failed'))
    })
  } catch {
    return []
  }
}

/**
 * 按 id 取单条 —— retryPersist 用（失败后重试落盘时从 IDB 拉原 blob）。
 * IDB 不可用 / 记录不存在时返回 null。
 */
export async function getMedia(id: string): Promise<StoredMedia | null> {
  if (!hasIDB()) return null
  try {
    const db = await openDb()
    return await new Promise<StoredMedia | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const st = tx.objectStore(STORE)
      const req = st.get(id)
      req.onsuccess = () => resolve((req.result as StoredMedia | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('idb get failed'))
    })
  } catch {
    return null
  }
}

/**
 * 删一条 —— mediaStore.remove 时调。失败静默。
 */
export async function deleteMedia(id: string): Promise<void> {
  if (!hasIDB()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const st = tx.objectStore(STORE)
      const req = st.delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('idb delete failed'))
    })
  } catch {
    // 同上：不抛
  }
}

/** 单测用：重置模块内的 DB promise 缓存，避免 happy-dom fakeIndexedDB 间串味 */
export function __resetMediaIdbForTest(): void {
  _dbPromise = null
}
