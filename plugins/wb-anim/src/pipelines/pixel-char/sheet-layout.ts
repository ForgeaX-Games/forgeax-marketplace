/**
 * Physical layout of a pixel-char sprite sheet.
 *
 * The LOGICAL spec for an action is `framesPerDir` columns × `directions`
 * rows. That matches how the runtime engine consumes the animation: one row
 * per facing, one column per frame.
 *
 * The AI model (`gemini-3-pro-image-preview`) however can only generate a
 * fixed set of aspect ratios, all within roughly 9:21 .. 21:9. When an action
 * has a SINGLE direction with many frames (a platformer boss with 5-7 side-
 * view frames) the logical 5:1 / 6:1 / 7:1 canvas is wider than the model
 * supports, so the model silently wraps the frames onto a second row — and
 * the downstream grid-crop, which only knew about the logical layout, then
 * slices every cell in half and you get the "each frame contains two stacked
 * creatures" disaster visible in the editor screenshot.
 *
 * `computeSheetLayout` resolves this by planning a PHYSICAL canvas grid that
 * the model actually accepts (`physCols × physRows`) and remembering how
 * many physical rows represent one logical direction. Down-stream code
 * (`splitSheetByDirection`, prompt templates, expand-green, aspect-ratio)
 * consumes this layout so the whole pipeline agrees on the shape.
 */

import type { ChibiAction, Direction } from './actions'

export const MAX_CANVAS_RATIO = 21 / 9
export const MIN_CANVAS_RATIO = 9 / 21

export interface SheetLayout {
  /** Logical directions the action emits (e.g. ['right'] or 4 dirs). */
  directions: Direction[]
  /** Logical animation frames per direction (as authored in actions.ts). */
  framesPerDir: number
  /**
   * How many PHYSICAL canvas rows are occupied by a single logical direction.
   * 1 for normal RPG/small-platformer actions; 2+ when wide single-row strips
   * have been wrapped so the canvas stays inside the model's aspect window.
   */
  rowsPerDir: number
  /** Cells per physical canvas row. */
  physCols: number
  /** Total physical rows (= directions.length * rowsPerDir). */
  physRows: number
  /** Physical cell count = physCols * physRows. */
  totalCells: number
  /**
   * True when the physical grid has trailing "filler" cells that the AI must
   * paint green (logical frame count < totalCells). Kept as a hint so the
   * prompt can explicitly tell the model not to animate those slots.
   */
  hasFillerCells: boolean
  /** Filler cell count at the tail of the last physical row (0 if none). */
  fillerCells: number
}

/**
 * Plan a physical grid for an action.
 *
 * The algorithm:
 *   1. Start with `rowsPerDir = 1` (no wrap).
 *   2. If the resulting canvas aspect (physCols / physRows) is already inside
 *      [MIN_CANVAS_RATIO, MAX_CANVAS_RATIO], keep it.
 *   3. Otherwise increase `rowsPerDir` until the aspect fits. This is only
 *      possible when the logical aspect is TOO WIDE — the too-tall case
 *      cannot be helped without changing the number of directions, which is
 *      a logical property we must preserve.
 */
export function computeSheetLayout(action: ChibiAction): SheetLayout {
  const directions = [...action.directions]
  const framesPerDir = action.framesPerDir
  const dirCount = Math.max(1, directions.length)

  let rowsPerDir = 1
  let physCols = framesPerDir
  let physRows = dirCount * rowsPerDir

  const aspectOf = (c: number, r: number): number => c / r

  // Only wrap if the logical layout is TOO WIDE. The too-tall case (rare:
  // framesPerDir = 1 with many directions) cannot be fixed by wrapping rows.
  //
  // `forceSingleRow` (set by the small-creature character type) explicitly
  // opts OUT of wrapping: the caller takes responsibility for authoring
  // prompts that size the creature small enough to fit in one row at 21:9
  // — see `character-types.ts` SMALL_CREATURE_MOTION and the prompt-engine
  // small-creature sizing clause.
  const startAspect = aspectOf(physCols, physRows)
  if (!action.forceSingleRow && startAspect > MAX_CANVAS_RATIO) {
    for (let r = 2; r <= framesPerDir; r++) {
      const c = Math.ceil(framesPerDir / r)
      const aspect = aspectOf(c, dirCount * r)
      if (aspect <= MAX_CANVAS_RATIO && aspect >= MIN_CANVAS_RATIO) {
        rowsPerDir = r
        physCols = c
        physRows = dirCount * r
        break
      }
    }
  }

  const totalCells = physCols * physRows
  const framesTotal = framesPerDir * dirCount
  // Filler cells only live at the tail of each direction's last physical row.
  const perDirCellCount = physCols * rowsPerDir
  const perDirFiller = perDirCellCount - framesPerDir
  const fillerCells = perDirFiller * dirCount

  return {
    directions,
    framesPerDir,
    rowsPerDir,
    physCols,
    physRows,
    totalCells,
    hasFillerCells: framesTotal < totalCells,
    fillerCells,
  }
}

/**
 * Resolve the physical (row, col) coordinate of a given logical frame inside
 * a given direction. Frames flow left-to-right, top-to-bottom, with each
 * direction occupying `rowsPerDir` consecutive physical rows.
 */
export function frameCoord(
  layout: SheetLayout,
  directionIndex: number,
  frameIndex: number,
): { physRow: number; physCol: number } {
  const dirRowStart = directionIndex * layout.rowsPerDir
  const rowOffset = Math.floor(frameIndex / layout.physCols)
  const colOffset = frameIndex % layout.physCols
  return {
    physRow: dirRowStart + rowOffset,
    physCol: colOffset,
  }
}
