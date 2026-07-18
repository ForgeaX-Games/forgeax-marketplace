const IDB_NAME = 'ce-pixel-action-lib'
const IDB_VERSION = 3
const ACTIONS_STORE = 'actions'
const BATCHES_STORE = 'batches'
const MAX_BATCHES = 30

// ── Types ────────────────────────────────────────────────────────────

export type VfxType = 'slash' | 'impact' | 'aura' | 'projectile'

export interface VfxBinding {
  type: VfxType
  startFrame: number
  duration: number
  color: string
  scale: number
  /**
   * 原始特效 id（例如 `starblade` / `weaponslash` / `dashtrail` / `attack`）。
   * 可选——老 manifest 里没有时退化到仅用 `type` 的通用粒子。游戏侧 VfxOverlay
   * 优先用 effectId 查富实现；没有才走 type 兜底。
   */
  effectId?: string
}

export interface SkillMeta {
  name: string
  damage: number
  range: number
  cooldown: number
  triggerFrame: number
  vfx?: VfxBinding
}

export interface PixelActionLibEntry {
  id: string
  actionId: string
  actionLabel: string
  sheetDataUrl: string
  directions: Record<string, string[]>
  addedAt: number
  sourceBatchId?: string
  sourceBatchLabel?: string
  skill?: SkillMeta
  /**
   * Per-entry visual scale for the "action-library unified size" feature.
   * Applied at:
   *   - thumbnail preview (CSS transform, non-destructive)
   *   - export time (baked into frame pixels via rescaleDirections)
   * Undefined / 1 means no scaling. Valid range after clamping: [0.3, 2.0].
   */
  scale?: number
}

export interface BatchActionResult {
  actionId: string
  actionLabel: string
  sheetDataUrl: string
  cleanSheetDataUrl?: string
  directions: Record<string, string[]>
}

export interface GenerationBatchEntry {
  id: string
  createdAt: number
  label: string
  thumbnailUrl?: string
  actions: BatchActionResult[]
}

// ── IndexedDB ────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(ACTIONS_STORE)) {
        db.createObjectStore(ACTIONS_STORE)
      }
      if (!db.objectStoreNames.contains(BATCHES_STORE)) {
        db.createObjectStore(BATCHES_STORE)
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db!) }
    req.onerror = () => reject(req.error)
  })
}

// ── Action Library (multi-version) ───────────────────────────────────

function actionKey(id: string): string {
  return `pixel:${id}`
}

export async function savePixelAction(entry: PixelActionLibEntry): Promise<void> {
  if (!entry.id) {
    entry.id = `${entry.actionId}:${Date.now()}`
  }
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, 'readwrite')
    tx.objectStore(ACTIONS_STORE).put(entry, actionKey(entry.id))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadAllPixelActions(): Promise<PixelActionLibEntry[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, 'readonly')
    const req = tx.objectStore(ACTIONS_STORE).getAll()
    req.onsuccess = () => {
      const all = (req.result as PixelActionLibEntry[]) ?? []
      all.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      resolve(all)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function removePixelAction(entryId: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, 'readwrite')
    tx.objectStore(ACTIONS_STORE).delete(actionKey(entryId))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removePixelActionsByActionId(actionId: string): Promise<number> {
  const all = await loadAllPixelActions()
  const toRemove = all.filter(e => e.actionId === actionId)
  for (const entry of toRemove) {
    await removePixelAction(entry.id)
  }
  return toRemove.length
}

/**
 * Update the per-entry scale without touching frames. Used by the unified-size
 * UI: the scale is cheap to persist on its own (single IDB put) and we bake
 * the pixels only at export time, so we avoid re-resampling on every tweak.
 */
export async function updatePixelActionScale(entryId: string, scale: number): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, 'readwrite')
    const store = tx.objectStore(ACTIONS_STORE)
    const getReq = store.get(actionKey(entryId))
    getReq.onsuccess = () => {
      const entry = getReq.result as PixelActionLibEntry | undefined
      if (!entry) { resolve(); return }
      entry.scale = scale
      store.put(entry, actionKey(entryId))
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearPixelActionLib(): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIONS_STORE, 'readwrite')
    tx.objectStore(ACTIONS_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Generation Batches ───────────────────────────────────────────────

export async function saveBatch(batch: GenerationBatchEntry): Promise<void> {
  const db = await getDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BATCHES_STORE, 'readwrite')
    tx.objectStore(BATCHES_STORE).put(batch, batch.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  const all = await listBatches()
  if (all.length > MAX_BATCHES) {
    for (const old of all.slice(MAX_BATCHES)) {
      await deleteBatch(old.id)
    }
  }
}

export async function loadBatch(batchId: string): Promise<GenerationBatchEntry | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BATCHES_STORE, 'readonly')
    const req = tx.objectStore(BATCHES_STORE).get(batchId)
    req.onsuccess = () => resolve((req.result as GenerationBatchEntry) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function listBatches(): Promise<GenerationBatchEntry[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BATCHES_STORE, 'readonly')
    const req = tx.objectStore(BATCHES_STORE).getAll()
    req.onsuccess = () => {
      const all = (req.result as GenerationBatchEntry[]) ?? []
      all.sort((a, b) => b.createdAt - a.createdAt)
      resolve(all)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteBatch(batchId: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BATCHES_STORE, 'readwrite')
    tx.objectStore(BATCHES_STORE).delete(batchId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearAllBatches(): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BATCHES_STORE, 'readwrite')
    tx.objectStore(BATCHES_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
