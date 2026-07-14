import { afterEach, describe, expect, it } from 'vitest'
import { registerKind, getKind, unregisterKind, deriveOutputs, type KindPlugin } from '../registry/kind-registry'
import type { GameNode } from '../schema/graph-schema'

const qtePlugin: KindPlugin = {
  kind: 'qte',
  role: 'interaction',
  validate: () => [],
  outputs: () => [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
}

const node = (kinds: string[]): GameNode => ({
  id: 'n1',
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: {
    name: 't',
    timeline: kinds.map((k, i) => ({
      id: `e${i}`,
      role: 'interaction' as const,
      kind: k,
      trigger: { when: 'enter' as const },
      params: {},
    })),
  },
})

afterEach(() => unregisterKind('qte'))

describe('kind-registry', () => {
  it('register / get', () => {
    registerKind(qtePlugin)
    expect(getKind('qte')?.role).toBe('interaction')
    expect(getKind('nope')).toBeUndefined()
  })

  it('deriveOutputs = default out + interaction kind outputs (dedup)', () => {
    registerKind(qtePlugin)
    expect(deriveOutputs(node(['qte'])).map((h) => h.id)).toEqual(['out', 'pass', 'good', 'fail'])
  })

  it('unregistered kind contributes no handle', () => {
    expect(deriveOutputs(node(['unknownKind'])).map((h) => h.id)).toEqual(['out'])
  })

  it('runtime contracts: logic run + interaction resolve', () => {
    registerKind({
      kind: 'settle',
      role: 'logic',
      validate: () => [],
      outputs: () => [],
      run: () => ({ effects: [{ id: 'e', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }),
    })
    registerKind(qtePlugin)
    registerKind({
      kind: 'qteResolve',
      role: 'interaction',
      validate: () => [],
      outputs: () => [{ id: 'pass' }, { id: 'fail' }],
      resolve: (_ctx, _p, input) => ({ outcome: input === 'hit' ? 'pass' : 'fail' }),
    })
    const logic = getKind('settle')!
    expect(logic.run!({ state: {} as never, nodeId: 'n', elapsedMs: 0 }, {}).effects[0]).toMatchObject({
      varId: 'qi',
      value: 1,
    })
    const inter = getKind('qteResolve')!
    const ended = inter.resolve!({ state: {} as never, nodeId: 'n', elapsedMs: 0 }, {}, 'hit')
    expect(ended.continue).not.toBe(true)
    if (ended.continue !== true) expect(ended.outcome).toBe('pass')
    unregisterKind('settle')
    unregisterKind('qteResolve')
  })
})
