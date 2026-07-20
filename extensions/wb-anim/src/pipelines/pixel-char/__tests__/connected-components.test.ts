import { describe, expect, it } from 'vitest'
import { connectedComponents } from '../sprite-processor'

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

function countBlobs(grid: string[], threshold = 10): number {
  const { alpha, w, h } = alphaFromGrid(grid)
  const { rects } = connectedComponents(alpha, w, h, threshold)
  return rects.size
}

describe('connectedComponents (8-connectivity)', () => {
  it('treats a diagonal line as a single blob', () => {
    const grid = [
      '#....',
      '.#...',
      '..#..',
      '...#.',
      '....#',
    ]
    expect(countBlobs(grid)).toBe(1)
  })

  it('treats two separate diagonal blobs as two blobs', () => {
    const grid = [
      '#.....',
      '.#....',
      '....#.',
      '.....#',
    ]
    expect(countBlobs(grid)).toBe(2)
  })

  it('merges horizontally adjacent pixels', () => {
    const grid = [
      '###',
      '...',
      '###',
    ]
    expect(countBlobs(grid)).toBe(2)
  })

  it('merges all 8-connected pixels into one blob', () => {
    // L-shape connected only via diagonal
    const grid = [
      '#..',
      '.#.',
      '.##',
    ]
    expect(countBlobs(grid)).toBe(1)
  })

  it('returns 0 blobs for an empty grid', () => {
    const grid = [
      '...',
      '...',
    ]
    expect(countBlobs(grid)).toBe(0)
  })

  it('returns 1 for a single pixel', () => {
    const grid = [
      '...',
      '.#.',
      '...',
    ]
    expect(countBlobs(grid)).toBe(1)
  })

  it('correctly isolates two blobs separated by a gap', () => {
    const grid = [
      '##..##',
      '##..##',
    ]
    expect(countBlobs(grid)).toBe(2)
  })

  it('handles anti-aliasing-like semi-transparent pixels below threshold', () => {
    const alpha = new Uint8Array([
      255, 5, 0,
      0, 5, 255,
    ])
    const { rects } = connectedComponents(alpha, 3, 2, 10)
    expect(rects.size).toBe(2)
  })
})
