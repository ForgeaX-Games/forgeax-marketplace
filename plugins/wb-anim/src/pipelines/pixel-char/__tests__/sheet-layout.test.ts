import { describe, it, expect } from 'vitest'
import type { ChibiAction } from '../actions'
import { computeSheetLayout, frameCoord, MAX_CANVAS_RATIO, MIN_CANVAS_RATIO } from '../sheet-layout'

function action(frames: number, directions: ChibiAction['directions']): ChibiAction {
  return {
    id: 'test',
    label: 'test',
    framesPerDir: frames,
    directions,
    motion: '',
    looping: true,
  }
}

describe('computeSheetLayout', () => {
  it('keeps a 4-direction RPG action on a single row per direction', () => {
    const layout = computeSheetLayout(action(3, ['down', 'left', 'right', 'up']))
    expect(layout.rowsPerDir).toBe(1)
    expect(layout.physCols).toBe(3)
    expect(layout.physRows).toBe(4)
    expect(layout.hasFillerCells).toBe(false)
    // 3:4 is inside the supported window.
    expect(layout.physCols / layout.physRows).toBeLessThanOrEqual(MAX_CANVAS_RATIO)
    expect(layout.physCols / layout.physRows).toBeGreaterThanOrEqual(MIN_CANVAS_RATIO)
  })

  it('wraps a 5-frame single-direction action into 3x2 with 1 filler cell', () => {
    // Platformer boss walk/run — 5 frames on a single physical row is 5:1
    // (the bug). Wrapping to 3 cols x 2 rows brings aspect to 3:2, which
    // Gemini supports, and leaves exactly one filler cell at the tail.
    const layout = computeSheetLayout(action(5, ['right']))
    expect(layout.rowsPerDir).toBe(2)
    expect(layout.physCols).toBe(3)
    expect(layout.physRows).toBe(2)
    expect(layout.totalCells).toBe(6)
    expect(layout.fillerCells).toBe(1)
    expect(layout.hasFillerCells).toBe(true)
    expect(layout.physCols / layout.physRows).toBeLessThanOrEqual(MAX_CANVAS_RATIO)
  })

  it('wraps a 7-frame single-direction ultimate into 4x2 with 1 filler cell', () => {
    const layout = computeSheetLayout(action(7, ['right']))
    expect(layout.rowsPerDir).toBe(2)
    expect(layout.physCols).toBe(4)
    expect(layout.physRows).toBe(2)
    expect(layout.fillerCells).toBe(1)
    expect(layout.physCols / layout.physRows).toBeLessThanOrEqual(MAX_CANVAS_RATIO)
  })

  it('keeps narrow single-direction actions (2-3 frames) within the window without wrap when already valid', () => {
    const two = computeSheetLayout(action(2, ['right']))
    expect(two.rowsPerDir).toBe(1)
    expect(two.physCols).toBe(2)
    expect(two.physRows).toBe(1)
    expect(two.hasFillerCells).toBe(false)
  })

  it('wraps a 3-frame single-direction action because 3:1 is wider than 21:9', () => {
    const layout = computeSheetLayout(action(3, ['right']))
    // 3:1 = 3.0 > 21/9 ≈ 2.33, so it must wrap.
    expect(layout.rowsPerDir).toBe(2)
    expect(layout.physCols).toBe(2)
    expect(layout.physRows).toBe(2)
    expect(layout.fillerCells).toBe(1)
    expect(layout.physCols / layout.physRows).toBeLessThanOrEqual(MAX_CANVAS_RATIO)
  })

  it('respects forceSingleRow even when the logical aspect is too wide', () => {
    // Small-creature path: 4 frames in 1 row is 4:1 (wider than the usual
    // 21:9 cap), but with `forceSingleRow=true` the layout MUST stay a
    // single row per direction — the creature itself will be sized down in
    // each cell by the prompt, not wrapped across rows by the layout.
    const a = { ...action(4, ['right']), forceSingleRow: true }
    const layout = computeSheetLayout(a)
    expect(layout.rowsPerDir).toBe(1)
    expect(layout.physCols).toBe(4)
    expect(layout.physRows).toBe(1)
    expect(layout.fillerCells).toBe(0)
    expect(layout.hasFillerCells).toBe(false)
  })

  it('forceSingleRow on a multi-direction action keeps each direction on 1 row', () => {
    const a = { ...action(4, ['left', 'right']), forceSingleRow: true }
    const layout = computeSheetLayout(a)
    expect(layout.rowsPerDir).toBe(1)
    expect(layout.physCols).toBe(4)
    expect(layout.physRows).toBe(2)
    expect(frameCoord(layout, 0, 3)).toEqual({ physRow: 0, physCol: 3 })
    expect(frameCoord(layout, 1, 0)).toEqual({ physRow: 1, physCol: 0 })
  })
})

describe('frameCoord', () => {
  it('maps single-row layouts to the original grid', () => {
    const layout = computeSheetLayout(action(3, ['down', 'left', 'right', 'up']))
    expect(frameCoord(layout, 0, 0)).toEqual({ physRow: 0, physCol: 0 })
    expect(frameCoord(layout, 0, 2)).toEqual({ physRow: 0, physCol: 2 })
    expect(frameCoord(layout, 2, 1)).toEqual({ physRow: 2, physCol: 1 })
    expect(frameCoord(layout, 3, 2)).toEqual({ physRow: 3, physCol: 2 })
  })

  it('walks wrapped layouts left-to-right, then top-to-bottom per direction', () => {
    const layout = computeSheetLayout(action(5, ['right']))
    // Expected physical grid (rowsPerDir=2, physCols=3):
    //   row 0: [F1][F2][F3]
    //   row 1: [F4][F5][GREEN]
    expect(frameCoord(layout, 0, 0)).toEqual({ physRow: 0, physCol: 0 })
    expect(frameCoord(layout, 0, 2)).toEqual({ physRow: 0, physCol: 2 })
    expect(frameCoord(layout, 0, 3)).toEqual({ physRow: 1, physCol: 0 })
    expect(frameCoord(layout, 0, 4)).toEqual({ physRow: 1, physCol: 1 })
  })

  it('isolates each direction to its own physical row block in a 2-dir wrapped layout', () => {
    const layout = computeSheetLayout(action(5, ['left', 'right']))
    // directions=2, rowsPerDir=2 → physRows=4
    expect(layout.physRows).toBe(4)
    expect(frameCoord(layout, 0, 0)).toEqual({ physRow: 0, physCol: 0 })
    expect(frameCoord(layout, 0, 4)).toEqual({ physRow: 1, physCol: 1 })
    expect(frameCoord(layout, 1, 0)).toEqual({ physRow: 2, physCol: 0 })
    expect(frameCoord(layout, 1, 4)).toEqual({ physRow: 3, physCol: 1 })
  })
})
