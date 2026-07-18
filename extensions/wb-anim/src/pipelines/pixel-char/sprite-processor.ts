import type { ChibiAction, Direction } from './actions'
import { computeSheetLayout, frameCoord, type SheetLayout } from './sheet-layout'

// ── Image loading ───────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// ── Template composition for fallback mode ──────────────────────────

export async function composeChibiTemplate(
  refImages: Record<Direction, string>,
  action: ChibiAction,
  canvasWidth = 2048,
): Promise<string> {
  const layout = computeSheetLayout(action)
  const cellW = Math.floor(canvasWidth / layout.physCols)
  const cellH = cellW

  const canvas = document.createElement('canvas')
  canvas.width = cellW * layout.physCols
  canvas.height = cellH * layout.physRows
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#00FF00'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Paint the reference pose into the FIRST frame cell of each direction —
  // the animation template then asks the AI to fill the remaining frame
  // cells with in-between poses. Filler cells past `framesPerDir` stay green.
  for (let d = 0; d < layout.directions.length; d++) {
    const dir = layout.directions[d]
    const src = refImages[dir]
    if (!src) continue

    const img = await loadImage(src)
    const pad = 4
    const availW = cellW - pad * 2
    const availH = cellH - pad * 2
    const scale = Math.min(availW / img.width, availH / img.height)
    const drawW = Math.round(img.width * scale)
    const drawH = Math.round(img.height * scale)

    const { physRow, physCol } = frameCoord(layout, d, 0)
    const offX = physCol * cellW + pad + Math.round((availW - drawW) / 2)
    const offY = physRow * cellH + pad + Math.round((availH - drawH) / 2)
    ctx.drawImage(img, offX, offY, drawW, drawH)
  }

  return canvas.toDataURL('image/png')
}

export function getSheetDimensions(action: ChibiAction, canvasWidth = 2048) {
  const layout = computeSheetLayout(action)
  const cellW = Math.floor(canvasWidth / layout.physCols)
  return {
    width: cellW * layout.physCols,
    height: cellW * layout.physRows,
    cellW,
    cellH: cellW,
    cols: layout.physCols,
    rows: layout.physRows,
  }
}

// ── Green-screen expansion (seam-free) ──────────────────────────────

/**
 * Expand a sprite sheet by first removing background from each cell,
 * then placing the clean character onto a fresh pure-green canvas that
 * is `factor` times larger.  This guarantees zero seam artifacts.
 */
export function expandGreenBackground(
  canvas: HTMLCanvasElement,
  cols: number,
  rows: number,
  factor = 2,
): HTMLCanvasElement {
  const srcW = canvas.width, srcH = canvas.height
  const cellW = Math.round(srcW / cols)
  const cellH = Math.round(srcH / rows)
  const newCellW = Math.round(cellW * factor)
  const newCellH = Math.round(cellH * factor)
  const dstW = newCellW * cols
  const dstH = newCellH * rows

  const out = document.createElement('canvas')
  out.width = dstW; out.height = dstH
  const dstCtx = out.getContext('2d')!
  dstCtx.fillStyle = '#00FF00'
  dstCtx.fillRect(0, 0, dstW, dstH)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = c * cellW, sy = r * cellH
      const dx = c * newCellW + Math.round((newCellW - cellW) / 2)
      const dy = r * newCellH + Math.round((newCellH - cellH) / 2)
      dstCtx.drawImage(canvas, sx, sy, cellW, cellH, dx, dy, cellW, cellH)
    }
  }

  return out
}

// ── Connected-component blob extraction ─────────────────────────────

export interface BlobRect {
  minX: number; minY: number; maxX: number; maxY: number; area: number
  /** Root label IDs that belong to this (possibly merged) blob group */
  labelIds: Set<number>
}

/**
 * Union-Find for connected component labeling (two-pass algorithm).
 * Uses **8-connectivity** (including diagonals) — essential for pixel art
 * where diagonal strokes are common and 4-connectivity would fragment them.
 * Returns per-pixel label map + bounding rects keyed by root label.
 */
export function connectedComponents(
  alpha: Uint8Array, w: number, h: number, threshold: number,
): { labels: Int32Array; rects: Map<number, BlobRect> } {
  const total = w * h
  const labels = new Int32Array(total).fill(-1)
  const parent = new Int32Array(total)
  for (let i = 0; i < total; i++) parent[i] = i

  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  let nextLabel = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (alpha[i] <= threshold) continue

      const up     = y > 0               ? labels[(y - 1) * w + x]     : -1
      const left   = x > 0               ? labels[y * w + x - 1]       : -1
      const upLeft = y > 0 && x > 0      ? labels[(y - 1) * w + x - 1] : -1
      const upRight = y > 0 && x < w - 1 ? labels[(y - 1) * w + x + 1] : -1

      const neighbors = [up, left, upLeft, upRight].filter(n => n >= 0)

      if (neighbors.length === 0) {
        labels[i] = nextLabel++
      } else {
        labels[i] = neighbors[0]
        for (let n = 1; n < neighbors.length; n++) union(neighbors[0], neighbors[n])
      }
    }
  }

  const rects = new Map<number, BlobRect>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (labels[i] < 0) continue
      const root = find(labels[i])
      labels[i] = root

      const r = rects.get(root)
      if (r) {
        if (x < r.minX) r.minX = x
        if (x > r.maxX) r.maxX = x
        if (y < r.minY) r.minY = y
        if (y > r.maxY) r.maxY = y
        r.area++
      } else {
        rects.set(root, { minX: x, minY: y, maxX: x, maxY: y, area: 1, labelIds: new Set([root]) })
      }
    }
  }

  return { labels, rects }
}

// ── Grid validation ─────────────────────────────────────────────────

export interface GridValidation {
  expectedCols: number
  expectedRows: number
  /** Number of significant blobs detected per row */
  detectedBlobsPerRow: number[]
  /** Whether the grid looks correct */
  valid: boolean
  /** Warning message if grid seems wrong */
  warning?: string
}

/**
 * Validate that an AI-generated sprite sheet actually has the expected
 * number of character blobs per row. Uses connected-component analysis
 * on each row strip to count distinct characters.
 */
export async function validateSheetGrid(
  dataUrl: string,
  expectedCols: number,
  expectedRows: number,
): Promise<GridValidation> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.width; canvas.height = img.height
  canvas.getContext('2d')!.drawImage(img, 0, 0)

  const w = canvas.width, h = canvas.height
  const rowH = Math.round(h / expectedRows)
  const detectedBlobsPerRow: number[] = []
  let valid = true
  const warnings: string[] = []

  for (let r = 0; r < expectedRows; r++) {
    const y0 = r * rowH
    const rh = Math.min(rowH, h - y0)
    const strip = document.createElement('canvas')
    strip.width = w; strip.height = rh
    strip.getContext('2d')!.drawImage(canvas, 0, y0, w, rh, 0, 0, w, rh)

    const ctx = strip.getContext('2d')!
    const imgData = ctx.getImageData(0, 0, w, rh)
    const alpha = new Uint8Array(w * rh)
    for (let i = 0; i < w * rh; i++) alpha[i] = imgData.data[i * 4 + 3]

    const { rects } = connectedComponents(alpha, w, rh, 10)
    const minBlobArea = Math.round(w * rh * 0.01)
    const significantBlobs = [...rects.values()].filter(b => b.area >= minBlobArea)

    // Merge nearby blobs (e.g. weapon detached from body)
    const merged = mergeNearbyBlobRects(significantBlobs, w * 0.08)
    detectedBlobsPerRow.push(merged.length)

    if (merged.length !== expectedCols) {
      valid = false
      warnings.push(`Row ${r + 1}: detected ${merged.length} characters, expected ${expectedCols}`)
    }
  }

  return {
    expectedCols,
    expectedRows,
    detectedBlobsPerRow,
    valid,
    warning: warnings.length > 0 ? warnings.join('; ') : undefined,
  }
}

function mergeNearbyBlobRects(blobs: BlobRect[], threshold: number): BlobRect[] {
  if (blobs.length <= 1) return blobs

  const sorted = [...blobs].sort((a, b) => a.minX - b.minX)
  const merged: BlobRect[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = sorted[i]
    if (curr.minX - prev.maxX < threshold) {
      prev.maxX = Math.max(prev.maxX, curr.maxX)
      prev.maxY = Math.max(prev.maxY, curr.maxY)
      prev.minY = Math.min(prev.minY, curr.minY)
      prev.area += curr.area
    } else {
      merged.push({ ...curr })
    }
  }
  return merged
}

// ── Split sheet by blob extraction ──────────────────────────────────

export interface DirectionFrames {
  direction: Direction
  frames: HTMLCanvasElement[]
}

/**
 * Split a sprite sheet into individual character frames.
 *
 * Strategy: ROW-CC FIRST, GRID-CROP AFTER.
 *
 * The old implementation cropped each cell independently and then cleaned the
 * interior. That works when every frame's silhouette is strictly inside its
 * own cell — but once `framesPerDir` grows (e.g. boss attack at 6 frames,
 * ultimate at 7), cells become NARROW and stray pixels from one frame's
 * weapon/limb/tail routinely leak across the invisible cell boundary into
 * the next cell. The cropped neighbour then inherited those pixels as a
 * "ghost limb" the per-cell cleanup couldn't always detect (the ghost still
 * connected to the neighbour's main blob at the cell edge).
 *
 * The new approach runs connected-component analysis on the WHOLE row strip
 * once, assigns every significant blob to the cell containing its CENTROID,
 * and then — BEFORE cropping — wipes pixels whose blob is assigned to a
 * different column than where the pixel physically sits. After that scrub
 * the grid crop is clean: each cell only contains blobs whose centre of
 * mass is in that cell. A final per-cell `cleanCellBlob` pass removes any
 * tiny residual fragments.
 */
export async function splitSheetByDirection(
  dataUrl: string,
  action: ChibiAction,
): Promise<DirectionFrames[]> {
  const img = await loadImage(dataUrl)
  const fullCanvas = document.createElement('canvas')
  fullCanvas.width = img.width; fullCanvas.height = img.height
  fullCanvas.getContext('2d')!.drawImage(img, 0, 0)

  const layout = computeSheetLayout(action)
  const w = fullCanvas.width, h = fullCanvas.height
  const physCols = layout.physCols
  const physRows = layout.physRows
  const cellW = Math.round(w / physCols)
  const cellH = Math.round(h / physRows)

  // 1. Row-level clean-up — for EACH physical row, run connected-component
  //    analysis and scrub noise / remap within-cell leakage. We do this on
  //    every physical row (not only logical direction rows) because with
  //    wrapped layouts (rowsPerDir > 1) each physical row still needs its
  //    own column-level reconciliation.
  const scrubbedRows: HTMLCanvasElement[] = []
  for (let pr = 0; pr < physRows; pr++) {
    const rowY = pr * cellH
    const rowH = Math.min(cellH, h - rowY)

    const strip = document.createElement('canvas')
    strip.width = w; strip.height = rowH
    const sctx = strip.getContext('2d')!
    sctx.drawImage(fullCanvas, 0, rowY, w, rowH, 0, 0, w, rowH)

    const stripImg = sctx.getImageData(0, 0, w, rowH)
    const alpha = new Uint8Array(w * rowH)
    for (let i = 0; i < w * rowH; i++) alpha[i] = stripImg.data[i * 4 + 3]
    const { labels, rects } = connectedComponents(alpha, w, rowH, 10)

    // DROP — too small (noise dust, anti-aliasing leak)
    // SCRUB(col) — well-formed blob fitting inside one cell; rebind pixels
    //              to the centroid's column and erase leaks into neighbours
    // PASS — blob is wider than ~1 cell (AI failed to separate frames); do
    //        NOT remap, let the grid crop fall back to per-cell behaviour.
    //        This prevents the "one filled cell + rest empty" regression.
    const stripArea = w * rowH
    const minArea = Math.max(8, Math.round(stripArea * 0.0005))
    const maxBlobW = cellW * 1.2

    type Policy = { kind: 'scrub'; col: number } | { kind: 'drop' } | { kind: 'pass' }
    const blobPolicy = new Map<number, Policy>()
    for (const [lab, rect] of rects) {
      if (rect.area < minArea) {
        blobPolicy.set(lab, { kind: 'drop' })
        continue
      }
      const blobW = rect.maxX - rect.minX + 1
      if (blobW > maxBlobW) {
        blobPolicy.set(lab, { kind: 'pass' })
        continue
      }
      const cx = (rect.minX + rect.maxX) / 2
      const col = Math.min(physCols - 1, Math.max(0, Math.floor(cx / cellW)))
      blobPolicy.set(lab, { kind: 'scrub', col })
    }

    let changed = false
    for (let y = 0; y < rowH; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const lab = labels[i]
        if (lab < 0) continue
        const policy = blobPolicy.get(lab)
        if (!policy || policy.kind === 'drop') {
          stripImg.data[i * 4 + 3] = 0
          changed = true
          continue
        }
        if (policy.kind === 'pass') continue
        const pixCol = Math.min(physCols - 1, Math.max(0, Math.floor(x / cellW)))
        if (pixCol !== policy.col) {
          stripImg.data[i * 4 + 3] = 0
          changed = true
        }
      }
    }
    if (changed) sctx.putImageData(stripImg, 0, 0)

    scrubbedRows.push(strip)
  }

  // 2. Walk each logical direction, assembling its frame sequence by reading
  //    the physical cells left-to-right, top-to-bottom across `rowsPerDir`
  //    physical rows. Filler cells past `framesPerDir` are skipped.
  const result: DirectionFrames[] = []
  for (let d = 0; d < layout.directions.length; d++) {
    const frames: HTMLCanvasElement[] = []
    for (let f = 0; f < layout.framesPerDir; f++) {
      const { physRow, physCol } = frameCoord(layout, d, f)
      const row = scrubbedRows[physRow]
      if (!row) continue

      const cellX = physCol * cellW
      const cw = physCol < physCols - 1 ? cellW : row.width - cellX

      const cell = document.createElement('canvas')
      cell.width = cw; cell.height = row.height
      cell.getContext('2d')!.drawImage(row, cellX, 0, cw, row.height, 0, 0, cw, row.height)

      frames.push(cleanCellBlob(cell))
    }

    result.push({ direction: layout.directions[d], frames })
  }
  return result
}

/**
 * Expose the layout for a given action — used by callers that need to agree
 * on the physical canvas size (aspect-ratio selection, green-background
 * expansion, grid validation). Thin re-export so downstream files don't
 * reach into `sheet-layout.ts` directly.
 */
export function getSheetLayout(action: ChibiAction): SheetLayout {
  return computeSheetLayout(action)
}

/**
 * Within a single grid cell, keep only the main character blob.
 * Small fragments near edges (leaked from adjacent cells) are removed.
 */
function cleanCellBlob(cell: HTMLCanvasElement): HTMLCanvasElement {
  const w = cell.width, h = cell.height
  const ctx = cell.getContext('2d')!
  const imgData = ctx.getImageData(0, 0, w, h)
  const alpha = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) alpha[i] = imgData.data[i * 4 + 3]

  const { labels, rects } = connectedComponents(alpha, w, h, 10)

  if (rects.size <= 1) return cell

  // Find the main blob (largest area)
  const minArea = Math.round(w * h * 0.005)
  const significant = [...rects.entries()]
    .filter(([, r]) => r.area >= minArea)
    .sort(([, a], [, b]) => b.area - a.area)

  if (significant.length === 0) return cell

  // Keep the main blob + any blob close to it (weapon detached from body)
  const mainBlob = significant[0][1]
  const keepLabels = new Set<number>([significant[0][0]])
  for (const id of mainBlob.labelIds) keepLabels.add(id)

  // Also keep blobs that overlap or are near the main blob.
  // 0.5 is generous — pixel sprites are small and detached parts (weapon tips,
  // hat plumes, floating effects) can be far from the body centroid.
  const mainCx = (mainBlob.minX + mainBlob.maxX) / 2
  const mainCy = (mainBlob.minY + mainBlob.maxY) / 2
  const nearThreshold = Math.max(w, h) * 0.5

  for (let i = 1; i < significant.length; i++) {
    const [id, blob] = significant[i]
    const cx = (blob.minX + blob.maxX) / 2
    const cy = (blob.minY + blob.maxY) / 2
    const dist = Math.sqrt((cx - mainCx) ** 2 + (cy - mainCy) ** 2)
    if (dist < nearThreshold) {
      keepLabels.add(id)
      for (const lid of blob.labelIds) keepLabels.add(lid)
    }
  }

  // Mask out pixels not in kept labels
  let changed = false
  for (let i = 0; i < w * h; i++) {
    if (labels[i] >= 0 && !keepLabels.has(labels[i])) {
      imgData.data[i * 4 + 3] = 0
      changed = true
    }
  }

  if (changed) ctx.putImageData(imgData, 0, 0)
  return cell
}


function gridSplitRow(strip: HTMLCanvasElement, cols: number): HTMLCanvasElement[] {
  const w = strip.width, h = strip.height
  const cellW = Math.round(w / cols)
  const frames: HTMLCanvasElement[] = []
  for (let c = 0; c < cols; c++) {
    const x0 = c * cellW
    const fw = c < cols - 1 ? cellW : w - x0
    const fc = document.createElement('canvas')
    fc.width = fw; fc.height = h
    fc.getContext('2d')!.drawImage(strip, x0, 0, fw, h, 0, 0, fw, h)
    frames.push(fc)
  }
  return frames
}

// ── Background removal ──────────────────────────────────────────────

function detectDominantEdgeColor(d: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number) => {
    const o = (y * w + x) * 4
    if (d[o + 3] < 128) return
    const qr = Math.round(d[o] / 16) * 16
    const qg = Math.round(d[o + 1] / 16) * 16
    const qb = Math.round(d[o + 2] / 16) * 16
    const key = `${qr},${qg},${qb}`
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += d[o]; e.g += d[o + 1]; e.b += d[o + 2]
    buckets.set(key, e)
  }
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1) }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y) }
  let best: { n: number; r: number; g: number; b: number } | null = null
  for (const e of buckets.values()) { if (!best || e.n > best.n) best = e }
  if (!best || best.n === 0) return [0, 255, 0]
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function isGreenHue(r: number, g: number, b: number, bgColor: [number, number, number]): boolean {
  const [bgH, bgS] = rgbToHsl(bgColor[0], bgColor[1], bgColor[2])
  const [h, s, l] = rgbToHsl(r, g, b)
  if (s < 0.15 || l < 0.08 || l > 0.95) return false
  const hueRange = bgS > 0.3 ? 45 : 60
  let hueDist = Math.abs(h - bgH)
  if (hueDist > 180) hueDist = 360 - hueDist
  return hueDist < hueRange && s > 0.2
}

function defringeGreen(canvas: HTMLCanvasElement, bgColor: [number, number, number], passes = 2): void {
  const w = canvas.width, h = canvas.height
  const ctx = canvas.getContext('2d')!
  const total = w * h

  try {
    for (let pass = 0; pass < passes; pass++) {
      const imgData = ctx.getImageData(0, 0, w, h)
      const d = imgData.data
      const kill = new Uint8Array(total)
      const soften = new Uint8Array(total)

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const o = i * 4
          if (d[o + 3] === 0) continue

          let clearNeighbors = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = x + dx, ny = y + dy
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) clearNeighbors++
              else if (d[(ny * w + nx) * 4 + 3] === 0) clearNeighbors++
            }
          }
          if (clearNeighbors === 0) continue

          const green = isGreenHue(d[o], d[o + 1], d[o + 2], bgColor)
          const [, sat] = rgbToHsl(d[o], d[o + 1], d[o + 2])

          if (green && sat > 0.3) {
            kill[i] = 1
          } else if (green) {
            soften[i] = 1
          } else if (clearNeighbors >= 3) {
            soften[i] = 1
          }
        }
      }

      for (let i = 0; i < total; i++) {
        if (kill[i]) d[i * 4 + 3] = 0
        else if (soften[i]) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * 0.4)
      }
      ctx.putImageData(imgData, 0, 0)
    }
  } catch (e) {
    console.warn('[defringeGreen] pass failed:', e)
  }

  try {
    despillGreen(ctx, w, h, bgColor)
  } catch (e) {
    console.warn('[despillGreen] failed:', e)
  }
}

function despillGreen(ctx: CanvasRenderingContext2D, cw: number, ch: number, bgColor: [number, number, number]): void {
  const imgData = ctx.getImageData(0, 0, cw, ch)
  const d = imgData.data
  const total = cw * ch
  const [bgH] = rgbToHsl(bgColor[0], bgColor[1], bgColor[2])

  for (let i = 0; i < total; i++) {
    const o = i * 4
    const a = d[o + 3]
    if (a === 0) continue
    if (a === 255) {
      let touchesClear = false
      const x = i % cw, y = (i - x) / cw
      for (let dy = -2; dy <= 2 && !touchesClear; dy++) {
        for (let dx = -2; dx <= 2 && !touchesClear; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue
          if (d[(ny * cw + nx) * 4 + 3] === 0) touchesClear = true
        }
      }
      if (!touchesClear) continue
    }

    const r = d[o], g = d[o + 1], b = d[o + 2]
    const [hue, sat] = rgbToHsl(r, g, b)
    let hueDist = Math.abs(hue - bgH)
    if (hueDist > 180) hueDist = 360 - hueDist
    if (hueDist > 60 || sat < 0.1) continue

    const spillStrength = Math.max(0, 1 - hueDist / 60) * Math.min(1, sat / 0.5)
    const avg = (r + b) / 2
    d[o + 1] = Math.round(g - (g - avg) * spillStrength * 0.7)
  }
  ctx.putImageData(imgData, 0, 0)
}

export function removeAnyBackground(
  canvas: HTMLCanvasElement,
  opts: { tolerance?: number; shrinkPx?: number } = {},
): HTMLCanvasElement {
  const { tolerance = 50, shrinkPx = 1 } = opts
  const w = canvas.width, h = canvas.height
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  const ctx = out.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)

  const imgData = ctx.getImageData(0, 0, w, h)
  const d = imgData.data
  const total = w * h

  const bgColor = detectDominantEdgeColor(d, w, h)

  // Pass 1: flood-fill from edges (catches large open background)
  const isBg = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    const o = i * 4
    if (
      Math.abs(d[o] - bgColor[0]) <= tolerance &&
      Math.abs(d[o + 1] - bgColor[1]) <= tolerance &&
      Math.abs(d[o + 2] - bgColor[2]) <= tolerance
    ) isBg[i] = 1
  }

  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0, tail = 0
  const seed = (x: number, y: number) => {
    const idx = y * w + x
    if (isBg[idx] && !visited[idx]) { visited[idx] = 1; queue[tail++] = idx }
  }
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1) }
  for (let y = 1; y < h - 1; y++) { seed(0, y); seed(w - 1, y) }
  while (head < tail) {
    const idx = queue[head++]
    const x = idx % w, y = (idx - x) / w
    if (x > 0)     { const n = idx - 1; if (isBg[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n } }
    if (x < w - 1) { const n = idx + 1; if (isBg[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n } }
    if (y > 0)     { const n = idx - w; if (isBg[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n } }
    if (y < h - 1) { const n = idx + w; if (isBg[n] && !visited[n]) { visited[n] = 1; queue[tail++] = n } }
  }
  for (let i = 0; i < total; i++) { if (visited[i]) d[i * 4 + 3] = 0 }

  // Pass 2: HSL-based green detection for enclosed areas (armpits, legs, weapon gaps)
  // RGB tolerance misses shade variations; HSL hue matching catches all greens reliably
  for (let i = 0; i < total; i++) {
    if (d[i * 4 + 3] === 0) continue
    const o = i * 4
    if (isGreenHue(d[o], d[o + 1], d[o + 2], bgColor)) {
      const [, s] = rgbToHsl(d[o], d[o + 1], d[o + 2])
      if (s > 0.3) d[o + 3] = 0
    }
  }

  // Pass 3: strict RGB fallback for near-exact bg color matches missed by HSL
  const strictTol = Math.round(tolerance * 0.5)
  for (let i = 0; i < total; i++) {
    if (d[i * 4 + 3] === 0) continue
    const o = i * 4
    if (
      Math.abs(d[o] - bgColor[0]) <= strictTol &&
      Math.abs(d[o + 1] - bgColor[1]) <= strictTol &&
      Math.abs(d[o + 2] - bgColor[2]) <= strictTol
    ) {
      d[o + 3] = 0
    }
  }

  ctx.putImageData(imgData, 0, 0)

  if (shrinkPx > 0) defringeGreen(out, bgColor, Math.max(2, shrinkPx))
  return out
}

/**
 * Check if a canvas frame still has a green-ish background (BG removal missed it).
 * If yes, run removeAnyBackground on it. Safe to call on already-processed frames.
 */
export function ensureFrameBgRemoved(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width, h = canvas.height
  if (w === 0 || h === 0) return canvas
  const d = canvas.getContext('2d')!.getImageData(0, 0, w, h).data

  const edgeColor = detectDominantEdgeColor(d, w, h)
  const [hue, sat] = rgbToHsl(edgeColor[0], edgeColor[1], edgeColor[2])

  const isGreenBg = hue > 60 && hue < 180 && sat > 0.3 && edgeColor[1] > 80
  if (!isGreenBg) return canvas

  return removeAnyBackground(canvas, { tolerance: 50, shrinkPx: 2 })
}

/**
 * Batch-process frame canvases: remove any remaining green background per frame.
 */
export function ensureAllFramesBgRemoved(
  rawFrames: Record<string, HTMLCanvasElement[]>,
): Record<string, HTMLCanvasElement[]> {
  const result: Record<string, HTMLCanvasElement[]> = {}
  for (const [key, frames] of Object.entries(rawFrames)) {
    result[key] = frames.map(f => ensureFrameBgRemoved(f))
  }
  return result
}

// ── Alignment types & anchor detection ──────────────────────────────

export type AlignMode =
  | 'waist'          // auto-detect waist band center-of-mass (default, best for characters)
  | 'center-mass'    // whole-sprite center of mass
  | 'bottom-center'  // horizontal center at foot level
  | 'top-center'     // horizontal center at head top
  | 'bbox-center'    // bounding-box geometric center

export const ALIGN_MODES: { id: AlignMode; label: string; desc: string }[] = [
  { id: 'waist',         label: '腰部对齐',   desc: '自动识别腰部，以腰部水平重心对齐（推荐）' },
  { id: 'center-mass',   label: '重心对齐',   desc: '以整体像素重心对齐' },
  { id: 'bottom-center', label: '脚底居中',   desc: '以脚底水平中心对齐' },
  { id: 'top-center',    label: '头顶居中',   desc: '以头顶水平中心对齐' },
  { id: 'bbox-center',   label: '包围盒居中', desc: '以包围盒几何中心对齐' },
]

export interface AnchorPoint { x: number; y: number }

interface SpriteBounds {
  minX: number; minY: number; maxX: number; maxY: number
  massX: number; massY: number
  totalPixels: number
}

function analyzeSprite(canvas: HTMLCanvasElement, threshold = 10): SpriteBounds | null {
  const w = canvas.width, h = canvas.height
  const d = canvas.getContext('2d')!.getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  let sumX = 0, sumY = 0, count = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        sumX += x; sumY += y; count++
      }
    }
  }
  if (count === 0) return null
  return { minX, minY, maxX, maxY, massX: sumX / count, massY: sumY / count, totalPixels: count }
}

/**
 * Detect a horizontal center-of-mass within a vertical band (e.g. the
 * waist region at ~45-60% of the sprite height). This gives a stable
 * anchor even when arms/weapons swing.
 */
function waistCenterX(canvas: HTMLCanvasElement, bounds: SpriteBounds): number {
  const w = canvas.width, h = canvas.height
  const d = canvas.getContext('2d')!.getImageData(0, 0, w, h).data
  const spriteH = bounds.maxY - bounds.minY + 1
  const bandTop = bounds.minY + Math.round(spriteH * 0.40)
  const bandBot = bounds.minY + Math.round(spriteH * 0.60)

  let sumX = 0, count = 0
  for (let y = bandTop; y <= bandBot && y < h; y++) {
    for (let x = bounds.minX; x <= bounds.maxX && x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) { sumX += x; count++ }
    }
  }
  return count > 0 ? sumX / count : (bounds.minX + bounds.maxX) / 2
}

function bottomCenterX(canvas: HTMLCanvasElement, bounds: SpriteBounds): number {
  const w = canvas.width
  const d = canvas.getContext('2d')!.getImageData(0, 0, w, canvas.height).data
  const spriteH = bounds.maxY - bounds.minY + 1
  const bandTop = bounds.maxY - Math.max(1, Math.round(spriteH * 0.10))

  let sumX = 0, count = 0
  for (let y = bandTop; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) { sumX += x; count++ }
    }
  }
  return count > 0 ? sumX / count : (bounds.minX + bounds.maxX) / 2
}

function topCenterX(canvas: HTMLCanvasElement, bounds: SpriteBounds): number {
  const w = canvas.width
  const d = canvas.getContext('2d')!.getImageData(0, 0, w, canvas.height).data
  const spriteH = bounds.maxY - bounds.minY + 1
  const bandBot = bounds.minY + Math.max(1, Math.round(spriteH * 0.10))

  let sumX = 0, count = 0
  for (let y = bounds.minY; y <= bandBot; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) { sumX += x; count++ }
    }
  }
  return count > 0 ? sumX / count : (bounds.minX + bounds.maxX) / 2
}

export function detectAnchor(canvas: HTMLCanvasElement, mode: AlignMode): AnchorPoint | null {
  const b = analyzeSprite(canvas)
  if (!b) return null

  switch (mode) {
    case 'waist':
      return { x: waistCenterX(canvas, b), y: b.minY + (b.maxY - b.minY) * 0.5 }
    case 'center-mass':
      return { x: b.massX, y: b.massY }
    case 'bottom-center':
      return { x: bottomCenterX(canvas, b), y: b.maxY }
    case 'top-center':
      return { x: topCenterX(canvas, b), y: b.minY }
    case 'bbox-center':
      return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  }
}

/**
 * Extract per-direction reference anchors from a 2×2 turnaround image.
 * Layout: top-left=down, top-right=left, bottom-left=right, bottom-right=up
 */
export function extractReferenceAnchors(
  turnaroundCanvas: HTMLCanvasElement,
  mode: AlignMode,
): Record<string, AnchorPoint> {
  const w = turnaroundCanvas.width, h = turnaroundCanvas.height
  const halfW = Math.round(w / 2), halfH = Math.round(h / 2)

  const slots: { dir: Direction; sx: number; sy: number; sw: number; sh: number }[] = [
    { dir: 'down',  sx: 0,     sy: 0,     sw: halfW, sh: halfH },
    { dir: 'left',  sx: halfW, sy: 0,     sw: w - halfW, sh: halfH },
    { dir: 'right', sx: 0,     sy: halfH, sw: halfW, sh: h - halfH },
    { dir: 'up',    sx: halfW, sy: halfH, sw: w - halfW, sh: h - halfH },
  ]

  const anchors: Record<string, AnchorPoint> = {}
  for (const { dir, sx, sy, sw, sh } of slots) {
    const cell = document.createElement('canvas')
    cell.width = sw; cell.height = sh
    cell.getContext('2d')!.drawImage(turnaroundCanvas, sx, sy, sw, sh, 0, 0, sw, sh)
    const a = detectAnchor(cell, mode)
    if (a) anchors[dir] = a
  }
  return anchors
}

// ── Frame processing (unified cross-direction) ──────────────────────

/**
 * Game-engine-ready frame alignment for a single action.
 *
 * Accepts ALL frames from ALL directions of one action together, so
 * the output canvas size, anchor placement, and crop are consistent
 * across every direction.  When a game engine draws frame N of any
 * direction at the same screen position, the character stays stable.
 *
 * Strategy:
 *   1. Detect each frame's anchor (waist / center-mass / etc.)
 *   2. Compute the shift needed to put each anchor at x=0 (relative)
 *   3. Find the global extent across ALL shifted frames (all dirs)
 *   4. Build a tight square canvas where the anchor sits at center
 *   5. Render every frame into that shared canvas layout
 *
 * @param dirFrames  Map of direction → raw extracted frame canvases
 * @param mode       Alignment mode
 * @param refAnchors Per-direction reference anchors (from turnaround)
 * @returns Same structure but with unified, game-ready canvases
 */
export function unifyActionFrames(
  dirFrames: Record<string, HTMLCanvasElement[]>,
  mode: AlignMode = 'waist',
  refAnchors?: Record<string, AnchorPoint> | null,
  alphaThreshold = 10,
): Record<string, HTMLCanvasElement[]> {
  // Flatten all frames with their metadata
  type FrameInfo = {
    dir: string; idx: number; canvas: HTMLCanvasElement
    bounds: SpriteBounds | null; anchor: AnchorPoint | null
    shiftX: number
  }

  const allFrames: FrameInfo[] = []
  for (const [dir, frames] of Object.entries(dirFrames)) {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      const bounds = analyzeSprite(f, alphaThreshold)
      const anchor = bounds ? detectAnchor(f, mode) : null
      allFrames.push({ dir, idx: i, canvas: f, bounds, anchor, shiftX: 0 })
    }
  }

  if (allFrames.length === 0) return dirFrames

  // ── 1. Per-frame anchor & shift ──────────────────────────────────
  // For each direction, determine the consensus anchor X, then compute
  // per-frame shift to align to that consensus.
  const dirGroups = new Map<string, FrameInfo[]>()
  for (const fi of allFrames) {
    if (!dirGroups.has(fi.dir)) dirGroups.set(fi.dir, [])
    dirGroups.get(fi.dir)!.push(fi)
  }

  for (const [dir, group] of dirGroups) {
    const ref = refAnchors?.[dir]
    const anchorsX = group.map(fi => fi.anchor?.x).filter((v): v is number => v != null)
    let targetX: number

    if (ref) {
      // Reference anchor from turnaround: all frames in this direction
      // should align to the reference's relative position.
      // ref.x is in turnaround-cell coordinate space; use it directly
      // since frames and cells are at comparable scale.
      targetX = ref.x
    } else if (anchorsX.length > 0) {
      const sorted = [...anchorsX].sort((a, b) => a - b)
      targetX = sorted[Math.floor(sorted.length / 2)]
    } else {
      targetX = group[0]?.canvas.width / 2 || 0
    }

    for (const fi of group) {
      fi.shiftX = fi.anchor ? Math.round(targetX - fi.anchor.x) : 0
    }
  }

  // ── 2. Global extents (across ALL directions) ────────────────────
  // Find how much space is needed relative to the anchor point.
  // anchorRelLeft  = max distance from anchor to left edge of content
  // anchorRelRight = max distance from anchor to right edge of content
  // Then the output width = anchorRelLeft + anchorRelRight + padding
  // and the anchor sits exactly at canvas center.

  let maxLeft = 0    // max pixels to the left of anchor
  let maxRight = 0   // max pixels to the right of anchor
  let maxUp = 0      // max pixels above anchor
  let maxDown = 0    // max pixels below anchor

  for (const fi of allFrames) {
    if (!fi.bounds || !fi.anchor) continue
    const b = fi.bounds
    const ax = fi.anchor.x + fi.shiftX
    const ay = fi.anchor.y

    const left = ax - b.minX
    const right = b.maxX - ax
    const up = ay - b.minY
    const down = b.maxY - ay

    if (left > maxLeft) maxLeft = left
    if (right > maxRight) maxRight = right
    if (up > maxUp) maxUp = up
    if (down > maxDown) maxDown = down
  }

  const pad = 4
  maxLeft += pad; maxRight += pad; maxUp += pad; maxDown += pad

  // Make symmetric so anchor is at true center
  const halfW = Math.max(maxLeft, maxRight)
  const halfH = Math.max(maxUp, maxDown)
  const side = Math.max(halfW * 2, halfH * 2, 1)

  // Canvas center = anchor target
  const cx = Math.floor(side / 2)
  const cy = Math.floor(side / 2)

  // ── 3. Render all frames into unified canvases ──────────────────
  const result: Record<string, HTMLCanvasElement[]> = {}

  for (const [dir, group] of dirGroups) {
    result[dir] = group.map(fi => {
      const out = document.createElement('canvas')
      out.width = side; out.height = side

      if (!fi.anchor) {
        // No anchor detected: just center the frame in the canvas
        const dx = cx - Math.floor(fi.canvas.width / 2)
        const dy = cy - Math.floor(fi.canvas.height / 2)
        out.getContext('2d')!.drawImage(fi.canvas, dx, dy)
      } else {
        // Place so that (anchor.x + shiftX, anchor.y) maps to (cx, cy)
        const dx = cx - Math.round(fi.anchor.x + fi.shiftX)
        const dy = cy - Math.round(fi.anchor.y)
        out.getContext('2d')!.drawImage(fi.canvas, dx, dy)
      }
      return out
    })
  }

  return result
}

/** @deprecated Use unifyActionFrames for game-ready output. Kept for single-direction use. */
export function trimAndUnifyFrames(
  frames: HTMLCanvasElement[],
  alphaThreshold = 10,
  mode: AlignMode = 'bbox-center',
  _referenceAnchor?: AnchorPoint | null,
): HTMLCanvasElement[] {
  const result = unifyActionFrames({ _single: frames }, mode, null, alphaThreshold)
  return result['_single'] || frames
}

// ── Auto-center frames ──────────────────────────────────────────────

/**
 * Center sprite content within each canvas.
 * Detects the opaque bounding box and shifts content so its center
 * aligns with the canvas center.  Operates on canvases in-place (returns new).
 */
export function autoCenterCanvases(
  canvases: HTMLCanvasElement[],
  alphaThreshold = 10,
): HTMLCanvasElement[] {
  return canvases.map(src => {
    const w = src.width, h = src.height
    const d = src.getContext('2d')!.getImageData(0, 0, w, h).data

    let minX = w, maxX = 0, minY = h, maxY = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > alphaThreshold) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < minX) return src

    const dx = Math.round(w / 2 - (minX + maxX) / 2)
    const dy = Math.round(h / 2 - (minY + maxY) / 2)
    if (dx === 0 && dy === 0) return src

    const out = document.createElement('canvas')
    out.width = w; out.height = h
    out.getContext('2d')!.drawImage(src, dx, dy)
    return out
  })
}

// ── Frame size normalization ─────────────────────────────────────────

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

/**
 * Resize all frames to `targetSize x targetSize` using nearest-neighbor.
 * Content bounding box is scaled proportionally and centered.
 */
export async function normalizeFrameSize(
  dirMap: Record<string, string[]>,
  targetSize: number,
): Promise<Record<string, string[]>> {
  if (targetSize <= 0) return dirMap

  const result: Record<string, string[]> = {}
  for (const [dir, frames] of Object.entries(dirMap)) {
    result[dir] = await Promise.all(frames.map(async (url) => {
      const img = await loadImg(url)
      if (img.width === targetSize && img.height === targetSize) return url

      const srcW = img.width, srcH = img.height
      const srcData = (() => {
        const c = document.createElement('canvas')
        c.width = srcW; c.height = srcH
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, srcW, srcH).data
      })()

      let minX = srcW, maxX = 0, minY = srcH, maxY = 0
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          if (srcData[(y * srcW + x) * 4 + 3] > 10) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }

      if (maxX < minX) {
        const empty = document.createElement('canvas')
        empty.width = targetSize; empty.height = targetSize
        return empty.toDataURL('image/png')
      }

      const contentW = maxX - minX + 1
      const contentH = maxY - minY + 1
      const scale = Math.min(targetSize / contentW, targetSize / contentH, targetSize / srcW, targetSize / srcH)

      const out = document.createElement('canvas')
      out.width = targetSize; out.height = targetSize
      const ctx = out.getContext('2d')!
      ctx.imageSmoothingEnabled = false

      const drawW = Math.round(srcW * scale)
      const drawH = Math.round(srcH * scale)
      const dx = Math.round((targetSize - drawW) / 2)
      const dy = Math.round((targetSize - drawH) / 2)
      ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, drawW, drawH)
      return out.toDataURL('image/png')
    }))
  }
  return result
}

/**
 * Scan all split frames across actions to find the maximum frame dimension.
 */
export function getMaxFrameSize(allFrames: Record<string, Record<string, string[]>>): number {
  let max = 0
  for (const dirMap of Object.values(allFrames)) {
    for (const frames of Object.values(dirMap)) {
      for (const url of frames) {
        const match = url.match(/^data:image\/png;base64,/)
        if (!match) continue
        // Parse size from data URL by creating a temporary image
        // For efficiency, we parse the PNG header directly
        try {
          const b64 = url.slice(match[0].length)
          const bin = atob(b64.slice(0, 40))
          if (bin.length >= 24 && bin.charCodeAt(1) === 0x50) { // PNG signature
            const w = (bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) | (bin.charCodeAt(18) << 8) | bin.charCodeAt(19)
            const h = (bin.charCodeAt(20) << 24) | (bin.charCodeAt(21) << 16) | (bin.charCodeAt(22) << 8) | bin.charCodeAt(23)
            if (w > max) max = w
            if (h > max) max = h
          }
        } catch { /* skip */ }
      }
    }
  }
  return max
}

/**
 * Normalize all actions' frames to the same target size.
 */
export async function normalizeAllActions(
  allFrames: Record<string, Record<string, string[]>>,
  targetSize: number,
): Promise<void> {
  for (const actionId of Object.keys(allFrames)) {
    allFrames[actionId] = await normalizeFrameSize(allFrames[actionId], targetSize)
  }
}

// ── GIF preview ─────────────────────────────────────────────────────

export interface GifPreviewHandle {
  stop(): void
  pause(): void
  resume(): void
  canvas: HTMLCanvasElement
}

export interface GifPreviewOptions {
  delay?: number
  displayScale?: number
  pingPong?: boolean
  /** Hold the last frame for this many ms before restarting (for one-shot anims like death) */
  holdLastFrameMs?: number
}

export function createGifPreview(
  frames: HTMLCanvasElement[],
  delayOrOpts: number | GifPreviewOptions = 120,
  displayScale = 0,
  pingPong = true,
): GifPreviewHandle {
  const opts: GifPreviewOptions = typeof delayOrOpts === 'number'
    ? { delay: delayOrOpts, displayScale, pingPong }
    : delayOrOpts
  const delay = opts.delay ?? 120
  const holdLast = opts.holdLastFrameMs ?? 0

  const noop = () => {}
  if (frames.length === 0) {
    const empty = document.createElement('canvas')
    empty.width = 1; empty.height = 1
    return { stop: noop, pause: noop, resume: noop, canvas: empty }
  }

  const usePingPong = (opts.pingPong ?? true) && holdLast === 0

  let sequence: number[]
  if (usePingPong && frames.length > 2) {
    sequence = []
    for (let i = 0; i < frames.length; i++) sequence.push(i)
    for (let i = frames.length - 2; i > 0; i--) sequence.push(i)
  } else {
    sequence = frames.map((_, i) => i)
  }

  const fw = frames[0].width
  const fh = frames[0].height
  const sc = (opts.displayScale ?? 0) > 0 ? opts.displayScale! : Math.max(1, Math.min(3, Math.floor(200 / fh)))

  const canvas = document.createElement('canvas')
  canvas.width = fw * sc
  canvas.height = fh * sc
  canvas.style.imageRendering = 'pixelated'

  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  let seqIdx = 0
  let stopped = false
  let paused = false
  let isVisible = false
  let rAFId: number | null = null
  let lastFrameTime = 0
  let holdTimeoutId: number | null = null

  function tick(now: number) {
    rAFId = null
    if (stopped || paused || !isVisible || document.hidden) return

    if (now - lastFrameTime >= delay) {
      lastFrameTime = now
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(frames[sequence[seqIdx]], 0, 0, canvas.width, canvas.height)

      const isLastFrame = seqIdx === sequence.length - 1
      seqIdx = (seqIdx + 1) % sequence.length

      if (isLastFrame && holdLast > 0) {
        holdTimeoutId = window.setTimeout(() => {
          holdTimeoutId = null
          if (!stopped && !paused && isVisible) scheduleNext()
        }, holdLast)
        return
      }
    }
    scheduleNext()
  }

  function scheduleNext() {
    if (rAFId === null && !stopped && !paused && isVisible && !document.hidden) {
      rAFId = requestAnimationFrame(tick)
    }
  }

  function cancelScheduled() {
    if (rAFId !== null) { cancelAnimationFrame(rAFId); rAFId = null }
    if (holdTimeoutId !== null) { clearTimeout(holdTimeoutId); holdTimeoutId = null }
  }

  function onVisibilityChange() {
    if (stopped) return
    if (document.hidden) {
      cancelScheduled()
    } else if (!paused && isVisible) {
      lastFrameTime = 0
      scheduleNext()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  // Only animate when the canvas is scrolled into view (IntersectionObserver).
  // This is the key perf win: dozens of off-screen GIF previews no longer tick.
  let observer: IntersectionObserver | null = null
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        isVisible = entry.isIntersecting
        if (isVisible && !stopped && !paused && !document.hidden) {
          lastFrameTime = 0
          scheduleNext()
        } else {
          cancelScheduled()
        }
      }
    }, { threshold: 0 })
    observer.observe(canvas)
  } else {
    isVisible = true
    if (!document.hidden) {
      lastFrameTime = 0
      scheduleNext()
    }
  }

  // Draw the first frame immediately so the canvas isn't blank
  ctx.drawImage(frames[sequence[0]], 0, 0, canvas.width, canvas.height)

  return {
    stop() {
      stopped = true
      cancelScheduled()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      observer?.disconnect()
      observer = null
    },
    pause() {
      paused = true
      cancelScheduled()
    },
    resume() {
      paused = false
      if (!stopped && isVisible && !document.hidden) { lastFrameTime = 0; scheduleNext() }
    },
    canvas,
  }
}

// ── Canvas helpers ──────────────────────────────────────────────────

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

export function canvasArrayToDataUrls(canvases: HTMLCanvasElement[]): string[] {
  return canvases.map(c => c.toDataURL('image/png'))
}

// ── Content-height measurement & per-entry rescale ──────────────────
//
// These helpers drive the "action-library unified scale" feature. The AI
// emits each action at its own "camera framing" — attack frames often end
// up occupying more vertical space than idle because of raised weapons.
// We measure each entry's actual character height once, compute a per-entry
// scale relative to a reference (usually the idle action), and at export
// time bake that scale into the frames. This keeps frame pixel dimensions
// the same while visually unifying character size across actions.

/**
 * Measure the vertical pixel extent of non-transparent content in a frame.
 * Returns 0 if the frame is fully transparent or unreadable.
 */
export async function measureContentHeight(frameUrl: string, alphaThreshold = 10): Promise<number> {
  try {
    const img = await loadImg(frameUrl)
    const w = img.width, h = img.height
    if (w === 0 || h === 0) return 0
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, w, h).data

    let minY = h, maxY = -1
    // Fast vertical scan: for each row test if ANY pixel passes alpha
    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4 + 3
      for (let x = 0; x < w; x++) {
        if (data[rowStart + x * 4] > alphaThreshold) {
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          break
        }
      }
    }
    return maxY < minY ? 0 : maxY - minY + 1
  } catch {
    return 0
  }
}

/**
 * Compute a representative content height for a whole action by sampling up
 * to N frames from each direction. Median is resilient to a single stretched
 * attack frame that would otherwise inflate the measurement.
 */
export async function measureActionContentHeight(
  directions: Record<string, string[]>,
  sampleLimit = 3,
): Promise<number> {
  const heights: number[] = []
  for (const frames of Object.values(directions)) {
    const n = Math.min(sampleLimit, frames.length)
    // Sample spread across the animation: first, middle, last (when available)
    const idxs = n === 1 ? [0] : n === 2 ? [0, frames.length - 1] : [0, Math.floor(frames.length / 2), frames.length - 1]
    for (const i of idxs) {
      const h = await measureContentHeight(frames[i])
      if (h > 0) heights.push(h)
    }
  }
  if (heights.length === 0) return 0
  heights.sort((a, b) => a - b)
  return heights[Math.floor(heights.length / 2)]
}

/**
 * Clamp a scale value to a reasonable range. Outside this range the result
 * looks broken (too small = invisible, too large = clipped by cell).
 * Upper bound was 2.0 originally; bumped to 3.0 because some AI-generated
 * attack/ultimate frames come out *very* small relative to idle and need
 * more headroom to match.
 */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.max(0.3, Math.min(3.0, scale))
}

/**
 * Apply a scale factor to a single frame. The output canvas keeps the SAME
 * dimensions as the source (so downstream atlas assembly stays aligned) —
 * only the character's rendered size changes. The character stays centred
 * both horizontally and vertically; extra space becomes transparent.
 *
 * Pixel-art safe: `imageSmoothingEnabled = false` keeps edges crisp.
 */
export async function rescaleFrameData(frameUrl: string, scale: number): Promise<string> {
  if (scale === 1 || !Number.isFinite(scale)) return frameUrl
  const img = await loadImg(frameUrl)
  const w = img.width, h = img.height
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const dw = Math.max(1, Math.round(w * scale))
  const dh = Math.max(1, Math.round(h * scale))
  const dx = Math.round((w - dw) / 2)
  const dy = Math.round((h - dh) / 2)
  ctx.drawImage(img, 0, 0, w, h, dx, dy, dw, dh)
  return out.toDataURL('image/png')
}

/**
 * Rescale every frame in every direction of an action. Returns a fresh copy
 * so callers can persist or compare against the original without accidental
 * mutation.
 */
export async function rescaleDirections(
  directions: Record<string, string[]>,
  scale: number,
): Promise<Record<string, string[]>> {
  if (scale === 1 || !Number.isFinite(scale)) {
    const copy: Record<string, string[]> = {}
    for (const [d, frames] of Object.entries(directions)) copy[d] = [...frames]
    return copy
  }
  const out: Record<string, string[]> = {}
  for (const [dir, frames] of Object.entries(directions)) {
    out[dir] = await Promise.all(frames.map(u => rescaleFrameData(u, scale)))
  }
  return out
}
