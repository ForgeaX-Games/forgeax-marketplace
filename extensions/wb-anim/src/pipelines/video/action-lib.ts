// @source wb-character/src/pipelines/video/action-lib.ts
const IDB_NAME = 'ce-action-lib'
const IDB_STORE = 'actions'
const IDB_VERSION = 1

export interface ActionLibEntry {
  presetId: string
  presetNameZh: string
  view: string
  videoUrl: string
  spritesheetUrl?: string
  gifUrl?: string
  isCinematic: boolean
  addedAt: number
}

let _db: IDBDatabase | null = null

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE) }
    req.onsuccess = () => { _db = req.result; resolve(_db!) }
    req.onerror = () => reject(req.error)
  })
}

function actionKey(presetId: string, view: string): string {
  return `action:${presetId}:${view}`
}

export async function saveAction(entry: ActionLibEntry): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(entry, actionKey(entry.presetId, entry.view))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadAction(presetId: string, view: string): Promise<ActionLibEntry | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(actionKey(presetId, view))
    req.onsuccess = () => resolve((req.result as ActionLibEntry) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function loadAllActions(): Promise<ActionLibEntry[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).getAll()
    req.onsuccess = () => resolve((req.result as ActionLibEntry[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function removeAction(presetId: string, view: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(actionKey(presetId, view))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearActionLib(): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
