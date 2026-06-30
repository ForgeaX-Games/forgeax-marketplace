import { describe, it, expect } from 'vitest'
import { lookupWithWildcard } from '../neighborKey'

describe('lookupWithWildcard', () => {
  it('prefers an exact match over a wildcard', () => {
    expect(lookupWithWildcard({ '1,1,1,1': 6, '1,1,1,*': 99 }, '1,1,1,1')).toBe(6)
  })
  it('falls back to the most specific wildcard (fewest *)', () => {
    expect(lookupWithWildcard({ '1,1,*,*': 4, '*,*,*,*': 0 }, '1,1,0,1')).toBe(4)
  })
  it('returns undefined when nothing matches', () => {
    expect(lookupWithWildcard({ '0,0,0,0': 1 }, '1,1,1,1')).toBeUndefined()
  })
})
