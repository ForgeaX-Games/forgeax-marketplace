/**
 * Vehicle sprite processing — thin wrapper around pixel-char's proven functions.
 *
 * We re-export the core functions and add vehicle-specific adapters
 * that bridge VehicleAnimation/ViewMode to the ChibiAction interface
 * expected by splitSheetByDirection / unifyActionFrames.
 */

import type { ChibiAction, Direction } from '../pixel-char/actions'
import type { VehicleAnimation, VehicleView, ViewMode } from './vehicle-types'
import { getEffectiveFrameCount } from './vehicle-types'

export {
  expandGreenBackground,
  removeAnyBackground,
  ensureAllFramesBgRemoved,
  splitSheetByDirection,
  unifyActionFrames,
  autoCenterCanvases,
  canvasArrayToDataUrls,
  canvasToDataUrl,
  createGifPreview,
  normalizeFrameSize,
  getMaxFrameSize,
  normalizeAllActions,
  validateSheetGrid,
  ALIGN_MODES,
} from '../pixel-char/sprite-processor'

export type { GifPreviewHandle, AlignMode } from '../pixel-char/sprite-processor'

// ── View <-> Direction mapping ───────────────────────────────────────

/**
 * Map vehicle views to the Direction type used by pixel-char's split functions.
 * The pixel-char system expects 'down'|'left'|'right'|'up' which map to rows
 * in the sprite sheet. We map vehicle views sequentially to these slots.
 */

const VIEW_TO_DIR: Record<VehicleView, Direction> = {
  front: 'down',
  left: 'left',
  right: 'right',
  back: 'up',
  top: 'down',
  'iso-nw': 'down',
  'iso-ne': 'left',
  'iso-sw': 'right',
  'iso-se': 'up',
}

/**
 * Build a direction list for a view mode, preserving row order.
 * For view modes with more than 4 views (e.g. topdown-plus with 5),
 * we use a synthetic approach — splitting manually instead of via
 * splitSheetByDirection.
 */
function viewsToDirections(views: VehicleView[]): Direction[] {
  if (views.length <= 4) {
    return views.map(v => VIEW_TO_DIR[v])
  }
  // For >4 views, we use the first 4 direction slots cyclically
  const dirs: Direction[] = ['down', 'left', 'right', 'up']
  return views.map((_, i) => dirs[i % 4])
}

// ── Build ChibiAction-compatible object ──────────────────────────────

/**
 * Build a ChibiAction-compatible object from vehicle animation + view mode.
 * This allows reuse of splitSheetByDirection and other pixel-char functions.
 */
export function buildVehicleAction(
  anim: VehicleAnimation,
  viewMode: ViewMode,
  overrideViews?: VehicleView[],
): ChibiAction {
  const views = overrideViews ?? viewMode.views
  const dirs = viewsToDirections(views)
  return {
    id: anim.id,
    label: anim.label,
    framesPerDir: getEffectiveFrameCount(anim, viewMode),
    looping: anim.looping,
    expandFactor: anim.expandFactor,
    directions: dirs,
    motion: anim.motion,
  }
}

/**
 * Build a single-view ChibiAction (1 row) for per-direction regeneration.
 */
export function buildSingleViewAction(
  anim: VehicleAnimation,
  view: VehicleView,
  viewMode: ViewMode,
): ChibiAction {
  return {
    id: anim.id,
    label: anim.label,
    framesPerDir: getEffectiveFrameCount(anim, viewMode),
    looping: anim.looping,
    expandFactor: anim.expandFactor,
    directions: [VIEW_TO_DIR[view]],
    motion: anim.motion,
  }
}

// ── Multi-view reference splitting ───────────────────────────────────

/**
 * Split a multi-view reference image into individual view images.
 * The reference is a grid (e.g. 2x2 for four-dir, 1x2 for side-only).
 */
export async function splitVehicleViews(
  dataUrl: string,
  viewMode: ViewMode,
): Promise<Record<VehicleView, string>> {
  const img = await loadImage(dataUrl)
  const views = viewMode.views
  const count = views.length

  let cols: number, rows: number
  if (count <= 2) {
    cols = count; rows = 1
  } else if (count <= 4) {
    cols = 2; rows = 2
  } else {
    cols = 3; rows = Math.ceil(count / 3)
  }

  const cellW = Math.round(img.width / cols)
  const cellH = Math.round(img.height / rows)

  const result: Record<string, string> = {}

  for (let i = 0; i < views.length; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const canvas = document.createElement('canvas')
    canvas.width = cellW
    canvas.height = cellH
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH)
    result[views[i]] = canvas.toDataURL('image/png')
  }

  return result as Record<VehicleView, string>
}

// ── Canvas utilities ─────────────────────────────────────────────────

export function flipCanvasHorizontally(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = canvas.width
  out.height = canvas.height
  const ctx = out.getContext('2d')!
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(canvas, 0, 0)
  return out
}

// ── Internal ─────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = src
  })
}
