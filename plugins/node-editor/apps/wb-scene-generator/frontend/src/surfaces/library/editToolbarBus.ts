// Cross-pane channel for the preview's edit toolbar. Two facts cross between the
// renderer pane (?pane=renderer) and the left pane (?pane=left), in opposite
// directions, so each gets its own localStorage key (sibling same-origin iframes
// → `storage` events, same pattern as selectedLayerBus.ts / paintAssetBus.ts):
//
//   editMode  — renderer publishes (it owns the Pencil toggle); the left pane
//               subscribes so its edit toolbar only expands while editing.
//   showGrid  — the left pane's toolbar publishes; the renderer subscribes and
//               mirrors it into the render store so compose draws the grid.
//   editZ     — the left pane publishes the active integer z layer; the renderer
//               uses it when mapping the selected top-face cell into a voxel.

const LS_EDIT_MODE = 'wb-scene-generator.preview.editMode'
const LS_SHOW_GRID = 'wb-scene-generator.preview.showGrid'
const LS_BRUSH_MODE = 'wb-scene-generator.preview.brushMode'
const LS_EDIT_TOOL = 'wb-scene-generator.preview.editTool'
const LS_EDIT_Z = 'wb-scene-generator.preview.editZ'
const LS_PREVIEW_CONTEXT = 'wb-scene-generator.preview.editContext'

export type BrushMode = 'free' | 'box'
export type PreviewEditTool = 'paint' | 'erase' | 'eyedropper' | 'select'

export interface PreviewEditContextBus {
  editMode: boolean
  viewMode: string
  drawMode: string
  editAvailable: boolean
}

function writeBool(key: string, value: boolean): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, value ? '1' : '0')
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : raw === '1'
}

function subscribeBool(key: string, cb: (value: boolean) => void, fallback: boolean): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== key) return
    cb(readBool(key, fallback))
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

function normalizeZ(value: number): number {
  return Math.trunc(Number.isFinite(value) ? value : 0)
}

// edit mode (renderer → left)
export const writeEditMode = (on: boolean): void => writeBool(LS_EDIT_MODE, on)
export const readEditMode = (): boolean => readBool(LS_EDIT_MODE, false)
export const subscribeEditMode = (cb: (on: boolean) => void): (() => void) =>
  subscribeBool(LS_EDIT_MODE, cb, false)

// show grid (left → renderer)
export const writeShowGrid = (on: boolean): void => writeBool(LS_SHOW_GRID, on)
export const readShowGrid = (): boolean => readBool(LS_SHOW_GRID, false)
export const subscribeShowGrid = (cb: (on: boolean) => void): (() => void) =>
  subscribeBool(LS_SHOW_GRID, cb, false)

// brush mode (left → renderer)
export function writeBrushMode(mode: BrushMode): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_BRUSH_MODE, mode)
}
export function readBrushMode(): BrushMode {
  if (typeof localStorage === 'undefined') return 'free'
  return localStorage.getItem(LS_BRUSH_MODE) === 'box' ? 'box' : 'free'
}
export function subscribeBrushMode(cb: (mode: BrushMode) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_BRUSH_MODE) return
    cb(readBrushMode())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

function normalizeEditTool(value: string | null): PreviewEditTool {
  return value === 'erase' || value === 'eyedropper' || value === 'select' ? value : 'paint'
}

// edit tool (left → renderer)
export function writeEditTool(tool: PreviewEditTool): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_EDIT_TOOL, tool)
}
export function readEditTool(): PreviewEditTool {
  if (typeof localStorage === 'undefined') return 'paint'
  return normalizeEditTool(localStorage.getItem(LS_EDIT_TOOL))
}
export function subscribeEditTool(cb: (tool: PreviewEditTool) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_EDIT_TOOL) return
    cb(readEditTool())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

// edit z layer (left → renderer)
export function writeEditZ(z: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_EDIT_Z, String(normalizeZ(z)))
}
export function readEditZ(): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(LS_EDIT_Z)
  if (raw === null) return 0
  return normalizeZ(Number(raw))
}
export function subscribeEditZ(cb: (z: number) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_EDIT_Z) return
    cb(readEditZ())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

// renderer view/draw context (renderer → left) for mode-aware edit tools
export function writePreviewEditContext(ctx: PreviewEditContextBus): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_PREVIEW_CONTEXT, JSON.stringify(ctx))
}

export function readPreviewEditContext(): PreviewEditContextBus {
  if (typeof localStorage === 'undefined') {
    return { editMode: false, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: false }
  }
  const raw = localStorage.getItem(LS_PREVIEW_CONTEXT)
  if (!raw) return { editMode: false, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: false }
  try {
    return JSON.parse(raw) as PreviewEditContextBus
  } catch {
    return { editMode: false, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: false }
  }
}

export function subscribePreviewEditContext(cb: (ctx: PreviewEditContextBus) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== LS_PREVIEW_CONTEXT) return
    cb(readPreviewEditContext())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
