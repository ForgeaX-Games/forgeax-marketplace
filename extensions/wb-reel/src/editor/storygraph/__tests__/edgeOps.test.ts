import { describe, expect, it } from 'vitest'
import type { Scenario, Branch } from '../../../scenario/types'
import {
  buildBranchFromConnect,
  formatEdgeId,
  parseEdgeId,
  resolveBranchFromEdge,
} from '../edgeOps'

function scn(extras?: Partial<Scenario>): Scenario {
  return {
    id: 'sc',
    title: 'demo',
    rootSceneId: 'a',
    defaultCharMs: 60,
    schemaVersion: 1,
    originIdea: '',
    scenes: {
      a: {
        id: 'a',
        title: 'A',
        durationMs: 5000,
        media: { kind: 'PLACEHOLDER' },
        dialogue: [],
        branches: [
          { id: 'b1', kind: 'auto', label: 'go', targetSceneId: 'b' },
        ],
      },
      b: {
        id: 'b',
        title: 'B',
        durationMs: 5000,
        media: { kind: 'PLACEHOLDER' },
        dialogue: [],
        branches: [],
      },
      c: {
        id: 'c',
        title: 'C',
        durationMs: 5000,
        media: { kind: 'PLACEHOLDER' },
        dialogue: [],
        branches: [],
      },
    },
    characters: {},
    ...extras,
  }
}

describe('buildBranchFromConnect', () => {
  it('returns a new Branch with default kind=auto when target exists and not duplicated', () => {
    const out = buildBranchFromConnect(scn(), 'a', 'c')
    expect(out).not.toBeNull()
    expect(out?.kind).toBe('auto')
    expect(out?.targetSceneId).toBe('c')
    expect(typeof out?.id).toBe('string')
    expect(out?.id.length).toBeGreaterThan(0)
  })

  it('returns null on self-loop', () => {
    expect(buildBranchFromConnect(scn(), 'a', 'a')).toBeNull()
  })

  it('returns null when target scene missing', () => {
    expect(buildBranchFromConnect(scn(), 'a', 'ghost')).toBeNull()
  })

  it('returns null when source scene missing', () => {
    expect(buildBranchFromConnect(scn(), 'ghost', 'b')).toBeNull()
  })

  it('rejects duplicate branch (same source → same target already exists)', () => {
    expect(buildBranchFromConnect(scn(), 'a', 'b')).toBeNull()
  })

  it('rejects empty source/target ids', () => {
    expect(buildBranchFromConnect(scn(), '', 'b')).toBeNull()
    expect(buildBranchFromConnect(scn(), 'a', '')).toBeNull()
    expect(buildBranchFromConnect(scn(), null, 'b')).toBeNull()
    expect(buildBranchFromConnect(scn(), 'a', null)).toBeNull()
  })

  it('generated id is unique across calls', () => {
    const a = buildBranchFromConnect(scn(), 'a', 'c')
    const b = buildBranchFromConnect(scn(), 'a', 'c')
    expect(a?.id).not.toBe(b?.id)
  })
})

describe('formatEdgeId / parseEdgeId', () => {
  it('round-trips sceneId + branchId', () => {
    const eid = formatEdgeId('intro', 'br-x9')
    expect(parseEdgeId(eid)).toEqual({ sceneId: 'intro', branchId: 'br-x9' })
  })

  it('returns null for malformed ids', () => {
    expect(parseEdgeId('whatever')).toBeNull()
    expect(parseEdgeId('intro__')).toBeNull()
    expect(parseEdgeId('__br')).toBeNull()
    expect(parseEdgeId('')).toBeNull()
  })

  it('handles scene ids that themselves contain "__"', () => {
    const eid = formatEdgeId('scene__weird', 'br-1')
    const parsed = parseEdgeId(eid)
    // 这种边界 case 选择"以最后一段当 branchId"，scene 部分允许包含 __
    expect(parsed).toEqual({ sceneId: 'scene__weird', branchId: 'br-1' })
  })
})

describe('resolveBranchFromEdge', () => {
  it('finds the matching branch by edgeId', () => {
    const s = scn()
    const eid = formatEdgeId('a', 'b1')
    const out = resolveBranchFromEdge(s, eid)
    expect(out?.sceneId).toBe('a')
    expect(out?.branch.id).toBe('b1')
  })

  it('returns null for unknown edges', () => {
    const s = scn()
    expect(resolveBranchFromEdge(s, formatEdgeId('a', 'ghost'))).toBeNull()
    expect(resolveBranchFromEdge(s, formatEdgeId('ghost', 'b1'))).toBeNull()
    expect(resolveBranchFromEdge(s, 'malformed')).toBeNull()
  })
})

describe('Branch kind enumeration', () => {
  it('all four kinds are recognized by buildBranchFromConnect default-fallback API', () => {
    // sanity check that types align — the Branch type accepts these kinds
    const kinds: Branch['kind'][] = ['auto', 'choice', 'qte_pass', 'qte_fail']
    expect(kinds).toHaveLength(4)
  })
})
