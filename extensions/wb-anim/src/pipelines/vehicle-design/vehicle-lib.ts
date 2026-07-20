/**
 * Vehicle design library — IndexedDB persistence for vehicle generation data.
 *
 * Contains two stores:
 *   - `batches` — chronological history of whole generation runs
 *   - `anims`   — per-animation "action library" (analogous to pixel-char's
 *                 action-lib). Each entry is ONE animation (idle/move/fire/...)
 *                 for ONE vehicle, with its four views + optional per-entry
 *                 unified-size `scale` override.
 *
 * Pattern follows pixel-char/action-lib.ts on purpose — we want the mental
 * model "pick entry, tweak scale, inject into scene / export" to read the
 * same across pipelines.
 */

const IDB_NAME = 'ce-vehicle-design-lib'
const IDB_VERSION = 2
const BATCHES_STORE = 'batches'
const ANIMS_STORE = 'anims'
const MAX_BATCHES = 30

// ── Types ────────────────────────────────────────────────────────────

export interface VehicleBatchAnimResult {
  animId: string
  animLabel: string
  sheetDataUrl: string
  cleanSheetDataUrl?: string
  /** view -> frame data URLs */
  views: Record<string, string[]>
}

export interface VehicleBatchEntry {
  id: string
  createdAt: number
  label: string
  categoryId: string
  subtypeId: string
  styleId: string
  eraId: string
  viewModeId: string
  thumbnailUrl?: string
  designImageUrl?: string
  viewsImageUrl?: string
  animations: VehicleBatchAnimResult[]
}

/**
 * One saved animation in the vehicle action library. Mirrors the shape of
 * `PixelActionLibEntry` but with `views` instead of `directions` so the
 * vocabulary matches what the rest of the vehicle pipeline already uses.
 */
export interface VehicleAnimLibEntry {
  id: string
  animId: string
  animLabel: string
  sheetDataUrl: string
  /** view key (front/back/side_left/side_right/...) -> frame data URLs */
  views: Record<string, string[]>
  addedAt: number
  sourceBatchId?: string
  sourceBatchLabel?: string
  /**
   * Per-entry visual scale (same semantics as PixelActionLibEntry.scale):
   * applied CSS-only to thumbnails, baked into pixels at export / inject time.
   * Valid range after clampScale: [0.3, 3.0]. Undefined == 1.0 (no scaling).
   */
  scale?: number
}

// ── IndexedDB ────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(BATCHES_STORE)) {
        db.createObjectStore(BATCHES_STORE)
      }
      // v2 upgrade: add anim-library store. Existing DB instances from v1 just
      // gain the new store without losing their batches.
      if (!db.objectStoreNames.contains(ANIMS_STORE)) {
        db.createObjectStore(ANIMS_STORE)
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db!) }
    req.onerror = () => reject(req.error)
  })
}

// ── Batch CRUD ───────────────────────────────────────────────────────

export async function saveBatch(batch: VehicleBatchEntry): Promise<void> {
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

export async function loadBatch(batchId: string): Promise<VehicleBatchEntry | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BATCHES_STORE, 'readonly')
    const req = tx.objectStore(BATCHES_STORE).get(batchId)
    req.onsuccess = () => resolve((req.result as VehicleBatchEntry) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function listBatches(): Promise<VehicleBatchEntry[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BATCHES_STORE, 'readonly')
    const req = tx.objectStore(BATCHES_STORE).getAll()
    req.onsuccess = () => {
      const all = (req.result as VehicleBatchEntry[]) ?? []
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

// ── Anim Library CRUD ────────────────────────────────────────────────

function animKey(id: string): string {
  return `vehAnim:${id}`
}

export async function saveVehicleAnim(entry: VehicleAnimLibEntry): Promise<void> {
  if (!entry.id) entry.id = `${entry.animId}:${Date.now()}`
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMS_STORE, 'readwrite')
    tx.objectStore(ANIMS_STORE).put(entry, animKey(entry.id))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadAllVehicleAnims(): Promise<VehicleAnimLibEntry[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMS_STORE, 'readonly')
    const req = tx.objectStore(ANIMS_STORE).getAll()
    req.onsuccess = () => {
      const all = (req.result as VehicleAnimLibEntry[]) ?? []
      all.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      resolve(all)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function removeVehicleAnim(entryId: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMS_STORE, 'readwrite')
    tx.objectStore(ANIMS_STORE).delete(animKey(entryId))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeVehicleAnimsByAnimId(animId: string): Promise<number> {
  const all = await loadAllVehicleAnims()
  const toRemove = all.filter(e => e.animId === animId)
  for (const entry of toRemove) await removeVehicleAnim(entry.id)
  return toRemove.length
}

export async function clearVehicleAnimLib(): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMS_STORE, 'readwrite')
    tx.objectStore(ANIMS_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Cheap per-entry scale update. Read-modify-write a single record.
 * Used by the ±5% / auto-align UI which triggers on every click — we avoid
 * a full saveVehicleAnim that would rewrite all the frame data URLs.
 */
export async function updateVehicleAnimScale(entryId: string, scale: number): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ANIMS_STORE, 'readwrite')
    const store = tx.objectStore(ANIMS_STORE)
    const getReq = store.get(animKey(entryId))
    getReq.onsuccess = () => {
      const entry = getReq.result as VehicleAnimLibEntry | undefined
      if (!entry) { resolve(); return }
      entry.scale = scale
      store.put(entry, animKey(entryId))
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
