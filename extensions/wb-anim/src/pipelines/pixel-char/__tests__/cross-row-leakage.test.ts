import { describe, expect, it } from 'vitest'
import { detectRowSeams } from '../sprite-processor'

function alphaFromGrid(grid: string[]): { alpha: Uint8Array; w: number; h: number } {
  const h = grid.length
  const w = grid[0].length
  const alpha = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      alpha[y * w + x] = grid[y][x] === '#' ? 255 : 0
    }
  }
  return { alpha, w, h }
}

describe('detectRowSeams', () => {
  it('returns just the outer bounds for a single-row sheet', () => {
    const { alpha, w, h } = alphaFromGrid(['.#.', '.#.', '.#.'])
    expect(detectRowSeams(alpha, w, h, 1)).toEqual([0, 3])
  })

  it('cuts at the empty gutter, not the arithmetic mean, when a foot dangles past it', () => {
    // 2 rows, nominal seam = h/2 = 4. Top character has a foot dangling to y=4
    // (one row PAST the nominal seam). The real empty gutter is y=5. The seam
    // must snap to y=5 so the dangling foot stays with its own (top) cell.
    const grid = [
      '.##.', // y0 top body
      '.##.', // y1
      '.##.', // y2
      '.##.', // y3
      '.#..', // y4 ← dangling foot, BELOW nominal seam (4)
      '....', // y5 ← true empty gutter
      '.##.', // y6 bottom body
      '.##.', // y7
    ]
    const { alpha, w, h } = alphaFromGrid(grid)
    const seams = detectRowSeams(alpha, w, h, 2)
    expect(seams[0]).toBe(0)
    expect(seams[2]).toBe(8)
    // Seam should land on the empty gutter (y5), keeping the foot (y4) above it.
    expect(seams[1]).toBe(5)
  })

  it('falls back to the nominal seam when the band is uniformly filled (tie-break)', () => {
    // Every scanline equally full → no clear gutter → stay at nominal seam.
    const grid = [
      '####', '####', '####', '####',
      '####', '####', '####', '####',
    ]
    const { alpha, w, h } = alphaFromGrid(grid)
    const seams = detectRowSeams(alpha, w, h, 2)
    expect(seams).toEqual([0, 4, 8])
  })

  it('keeps the seam inside the search window (does not run away to a far gutter)', () => {
    // A big empty region near the top must NOT pull the seam out of its window.
    const grid = [
      '....', // y0 empty (would be "emptiest" globally)
      '....', // y1
      '.##.', // y2
      '.##.', // y3
      '.#..', // y4
      '....', // y5 local gutter near nominal seam (4)
      '.##.', // y6
      '.##.', // y7
    ]
    const { alpha, w, h } = alphaFromGrid(grid)
    const seams = detectRowSeams(alpha, w, h, 2)
    // window is ±30% of bandH(4) ≈ ±1 around nominal 4 → range [3,5];
    // emptiest within window is y5.
    expect(seams[1]).toBeGreaterThanOrEqual(3)
    expect(seams[1]).toBeLessThanOrEqual(5)
    expect(seams[1]).toBe(5)
  })

  it('handles three rows', () => {
    const grid = [
      '.##.', '.##.', '....', // band 0 → gutter y2
      '.##.', '.##.', '....', // band 1 → gutter y5
      '.##.', '.##.', '....', // band 2
    ]
    const { alpha, w, h } = alphaFromGrid(grid)
    const seams = detectRowSeams(alpha, w, h, 3)
    expect(seams[0]).toBe(0)
    expect(seams[3]).toBe(9)
    // nominal seams at 3 and 6; nearby gutters at y2/y3 and y5/y6
    expect(seams[1]).toBeGreaterThanOrEqual(2)
    expect(seams[1]).toBeLessThanOrEqual(4)
    expect(seams[2]).toBeGreaterThanOrEqual(5)
    expect(seams[2]).toBeLessThanOrEqual(7)
  })
})
