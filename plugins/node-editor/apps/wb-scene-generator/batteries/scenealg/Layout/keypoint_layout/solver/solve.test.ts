import { describe, it, expect } from 'vitest'
import { buildModel } from './model.ts'
import { solve, characteristicLength } from './solve.ts'

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

describe('solve', () => {
  it('satisfies a single clearance relation (net gap ≈ distance)', () => {
    const model = buildModel({
      hierarchy: {
        id: 'root',
        area: Math.PI * 100, // r = 10, comfortably contains the children
        children: [
          { id: 'a', area: Math.PI * 4, children: [] }, // r = 2
          { id: 'b', area: Math.PI * 1, children: [] }, // r = 1
        ],
      },
      relations: [{ from: 'a', to: 'b', kind: 'clearance', distance: 3 }],
    })
    const result = solve(model)
    const ia = model.index.get('a')!
    const ib = model.index.get('b')!
    const ra = model.nodes[ia].radius
    const rb = model.nodes[ib].radius
    const gap = dist(result.positions[ia], result.positions[ib]) - ra - rb
    // Within ~5% (compactness biases the gap slightly below the target).
    expect(Math.abs(gap - 3)).toBeLessThan(3 * 0.05)
  })

  it('places every node and is scale-invariant in relative geometry', () => {
    // Root sized 100× between the two cases so the whole problem (radii, distance,
    // parent radius) scales uniformly → identical normalized problem.
    const small = buildModel({
      hierarchy: { id: 'r', area: Math.PI * 25, children: [ // r = 5
        { id: 'a', area: Math.PI, children: [] },
        { id: 'b', area: Math.PI, children: [] },
      ] },
      relations: [{ from: 'a', to: 'b', kind: 'clearance', distance: 2 }],
    })
    const big = buildModel({
      hierarchy: { id: 'r', area: Math.PI * 250000, children: [ // r = 500
        { id: 'a', area: Math.PI * 10000, children: [] },
        { id: 'b', area: Math.PI * 10000, children: [] },
      ] },
      relations: [{ from: 'a', to: 'b', kind: 'clearance', distance: 200 }],
    })
    const rs = solve(small)
    const rb = solve(big)
    expect(rs.positions).toHaveLength(3)
    expect(rb.positions).toHaveLength(3)
    const gapS = dist(rs.positions[small.index.get('a')!], rs.positions[small.index.get('b')!]) -
      small.nodes[small.index.get('a')!].radius - small.nodes[small.index.get('b')!].radius
    const gapB = dist(rb.positions[big.index.get('a')!], rb.positions[big.index.get('b')!]) -
      big.nodes[big.index.get('a')!].radius - big.nodes[big.index.get('b')!].radius
    // Scale invariance: the 100× larger problem yields a 100× larger gap.
    expect(gapB).toBeCloseTo(gapS * 100, 0)
    // Clearance approximately satisfied (compactness biases it slightly smaller).
    expect(Math.abs(gapS - 2)).toBeLessThan(2 * 0.06)
    expect(Math.abs(gapB - 200)).toBeLessThan(200 * 0.06)
  })

  it('characteristicLength reflects the largest radius / clearance', () => {
    const model = buildModel({
      hierarchy: { id: 'a', area: Math.PI * 9, children: [] }, // r = 3
      relations: [],
    })
    expect(characteristicLength(model)).toBeCloseTo(3, 6)
  })
})
