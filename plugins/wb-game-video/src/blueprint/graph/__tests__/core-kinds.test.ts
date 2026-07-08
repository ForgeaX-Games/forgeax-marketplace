import { describe, expect, it } from 'vitest'
import {
  choiceKind,
  hotspotKind,
  qteKind,
  settleKind,
  floatTextKind,
} from '../core-kinds'

const ctx = { state: {} as never, nodeId: 'n', elapsedMs: 0 }

describe('core-kinds', () => {
  it('settle: run returns its effects; validate', () => {
    expect(settleKind.run!(ctx, { effects: [{ id: 'e', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }).effects).toHaveLength(1)
    expect(settleKind.validate({ effects: [] })).toEqual([])
    expect(settleKind.validate({ effects: undefined as never })).toHaveLength(1)
  })

  it('floatText: validate requires text; no outputs', () => {
    expect(floatTextKind.validate({ text: '+30' })).toEqual([])
    expect(floatTextKind.validate({ text: '' })).toHaveLength(1)
    expect(floatTextKind.outputs({ text: 'x' })).toEqual([])
  })

  it('choice: outputs per option; resolve maps key → opt:key + effects', () => {
    const params = {
      options: [
        { key: 's1', label: '轻击', effects: [{ id: 'q', kind: 'var' as const, varId: 'qi', op: 'add' as const, value: 2 }] },
        { key: 's2', label: '重击' },
      ],
    }
    expect(choiceKind.outputs(params).map((h) => h.id)).toEqual(['opt:s1', 'opt:s2'])
    const r = choiceKind.resolve!(ctx, params, 's1')
    expect(r.outcome).toBe('opt:s1')
    expect(r.effects).toHaveLength(1)
    // 缺省 input → defaultKey/首项
    expect(choiceKind.resolve!(ctx, params, undefined).outcome).toBe('opt:s1')
  })

  it('qte: three outcomes; resolve by string or hits', () => {
    expect(qteKind.outputs({}).map((h) => h.id)).toEqual(['pass', 'good', 'fail'])
    expect(qteKind.resolve!(ctx, {}, 'good').outcome).toBe('good')
    expect(qteKind.resolve!(ctx, { passingHits: 3 }, { hits: 3 }).outcome).toBe('pass')
    expect(qteKind.resolve!(ctx, { passingHits: 3 }, { hits: 1 }).outcome).toBe('fail')
  })

  it('hotspot: outputs hs:id; resolve id → hs:id', () => {
    const params = { hotspots: [{ id: 'door', target: 'sub1' }] }
    expect(hotspotKind.outputs(params).map((h) => h.id)).toEqual(['hs:door'])
    expect(hotspotKind.resolve!(ctx, params, 'door').outcome).toBe('hs:door')
  })
})
