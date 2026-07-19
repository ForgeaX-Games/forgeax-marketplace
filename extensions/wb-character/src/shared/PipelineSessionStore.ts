/**
 * Unified pipeline session persistence layer.
 *
 * Single IndexedDB database `ce-pipeline-sessions` with two object stores:
 *   - `sessions` — lightweight metadata (for listing)
 *   - `blobs`    — large binary data (images as data URLs), keyed by `sessionId:blobKey`
 *
 * Each pipeline uses `sessionAutoSave` to keep a `current:<pipelineId>` slot
 * that is restored on startup. Explicit snapshots go into timestamped entries.
 */

const DB_NAME = 'ce-pipeline-sessions'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const BLOBS_STORE = 'blobs'

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE)
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE)
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db!) }
    req.onerror = () => reject(req.error)
  })
}

// ── Types ────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: string
  pipelineId: string
  label: string
  thumbnailDataUrl?: string
  createdAt: number
  updatedAt: number
  config: Record<string, any>
  blobKeys: string[]
}

export interface SessionData {
  meta: SessionMeta
  blobs: Record<string, string>
}

// ── Internal helpers ─────────────────────────────────────────────────

function blobStoreKey(sessionId: string, blobKey: string): string {
  return `${sessionId}::${blobKey}`
}

// ── Public API ───────────────────────────────────────────────────────

export async function sessionSave(
  meta: SessionMeta,
  blobs: Record<string, string>,
): Promise<void> {
  const db = await openDB()
  meta.blobKeys = Object.keys(blobs)
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS_STORE, BLOBS_STORE], 'readwrite')
    tx.objectStore(SESSIONS_STORE).put(meta, meta.id)
    for (const [key, value] of Object.entries(blobs)) {
      tx.objectStore(BLOBS_STORE).put(value, blobStoreKey(meta.id, key))
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function sessionLoad(sessionId: string): Promise<SessionData | null> {
  const db = await openDB()
  const meta = await new Promise<SessionMeta | null>((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly')
    const req = tx.objectStore(SESSIONS_STORE).get(sessionId)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  if (!meta) return null

  const blobs: Record<string, string> = {}
  if (meta.blobKeys.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOBS_STORE, 'readonly')
      const store = tx.objectStore(BLOBS_STORE)
      let pending = meta.blobKeys.length
      for (const key of meta.blobKeys) {
        const req = store.get(blobStoreKey(sessionId, key))
        req.onsuccess = () => {
          if (req.result) blobs[key] = req.result as string
          if (--pending === 0) resolve()
        }
        req.onerror = () => reject(req.error)
      }
      if (pending === 0) resolve()
    })
  }

  return { meta, blobs }
}

export async function sessionList(pipelineId: string): Promise<SessionMeta[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly')
    const req = tx.objectStore(SESSIONS_STORE).getAll()
    req.onsuccess = () => {
      const all = (req.result as SessionMeta[]) ?? []
      const filtered = all
        .filter(m => m.pipelineId === pipelineId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(filtered)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function sessionDelete(sessionId: string): Promise<void> {
  const db = await openDB()
  const meta = await new Promise<SessionMeta | null>((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly')
    const req = tx.objectStore(SESSIONS_STORE).get(sessionId)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })

  return new Promise((resolve, reject) => {
    const stores = [SESSIONS_STORE, BLOBS_STORE]
    const tx = db.transaction(stores, 'readwrite')
    tx.objectStore(SESSIONS_STORE).delete(sessionId)
    if (meta?.blobKeys) {
      const blobStore = tx.objectStore(BLOBS_STORE)
      for (const key of meta.blobKeys) {
        blobStore.delete(blobStoreKey(sessionId, key))
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Auto-save: overwrites the `current:<pipelineId>` slot.
 * Call this on every significant state change.
 */
export async function sessionAutoSave(
  pipelineId: string,
  config: Record<string, any>,
  blobs: Record<string, string>,
  label?: string,
  thumbnail?: string,
): Promise<void> {
  const id = `current:${pipelineId}`
  const now = Date.now()
  const existing = await sessionLoad(id)
  const meta: SessionMeta = {
    id,
    pipelineId,
    label: label || `${pipelineId} auto-save`,
    thumbnailDataUrl: thumbnail,
    createdAt: existing?.meta.createdAt || now,
    updatedAt: now,
    config,
    blobKeys: [],
  }
  await sessionSave(meta, blobs)
}

/**
 * Save a named snapshot to history.
 * Returns the generated session id.
 */
export async function sessionSnapshot(
  pipelineId: string,
  config: Record<string, any>,
  blobs: Record<string, string>,
  label?: string,
  thumbnail?: string,
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const id = `${pipelineId}:${ts}`
  const now = Date.now()
  const meta: SessionMeta = {
    id,
    pipelineId,
    label: label || `${pipelineId} ${ts}`,
    thumbnailDataUrl: thumbnail,
    createdAt: now,
    updatedAt: now,
    config,
    blobKeys: [],
  }
  await sessionSave(meta, blobs)

  const all = await sessionList(pipelineId)
  const snapshots = all.filter(m => !m.id.startsWith('current:'))
  const MAX_HISTORY = 20
  if (snapshots.length > MAX_HISTORY) {
    for (const old of snapshots.slice(MAX_HISTORY)) {
      await sessionDelete(old.id)
    }
  }

  return id
}
