// Cross-pane channel for the asset the user paints with in the preview's edit
// mode. The AssetStore pane (?pane=assetstore) publishes the selected tile; the
// renderer pane (?pane=renderer) reads it as the paint asset. Sibling same-origin
// iframes, so this rides the localStorage + `storage` event bus (same pattern as
// rulesApi.ts).

export interface PaintAsset {
  /** Library alias of the selected tile — also what the baked layer binds to. */
  alias: string
  /** asset_name written onto the painted layer (matchAssetEntry resolves it). */
  name: string
  /** asset_type, e.g. 'tile'. */
  type?: string
}

const LS_PAINT_ASSET = 'wb-scene-generator.assetstore.paintAsset'

// Asset aliases are `[..]_[..]_…` bracket-field strings. The renderer's
// `matchAssetEntry` keys layers by field 4 (the item name) with fuzzy=false, and
// field 9 carries the PPU. We surface both so a painted layer binds an asset_name
// that actually resolves, and the renderer can size sprites by PPU.
function bracketFields(alias: string): string[] {
  const m = alias.match(/\[([^\]]*)\]/g)
  return m ? m.map((s) => s.slice(1, -1).trim()) : []
}

/** Item-name field (index 4) of an asset alias; falls back to the full alias. */
export function aliasItemName(alias: string): string {
  const f = bracketFields(alias)
  return f.length > 4 && f[4] ? f[4] : alias
}

/** PPU field (index 9) of an asset alias; null when absent/invalid. */
export function aliasPpu(alias: string): number | null {
  const f = bracketFields(alias)
  if (f.length <= 9) return null
  const n = parseInt(f[9], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function writePaintAsset(asset: PaintAsset | null): void {
  if (typeof localStorage === 'undefined') return
  if (asset) localStorage.setItem(LS_PAINT_ASSET, JSON.stringify(asset))
  else localStorage.removeItem(LS_PAINT_ASSET)
}

export function readPaintAsset(): PaintAsset | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(LS_PAINT_ASSET)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PaintAsset
  } catch {
    return null
  }
}

export function subscribePaintAsset(cb: (asset: PaintAsset | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_PAINT_ASSET) return
    cb(readPaintAsset())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
