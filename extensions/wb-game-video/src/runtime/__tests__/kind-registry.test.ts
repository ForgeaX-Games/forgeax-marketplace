import { afterEach, describe, expect, it } from 'vitest'
import { registerKind, getKind, unregisterKind, deriveOutputs, type KindPlugin } from '../registry/kind-registry'
import type { GameNode, Overlay } from '../schema/graph-schema'

const qtePlugin: KindPlugin = {
  kind: 'qte',
  role: 'interaction',
  validate: () => [],
  outputs: () => [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
}

function nodeWithKinds(kinds: string[]): { node: GameNode; overlays: Record<string, Overlay> } {
  const overlays: Record<string, Overlay> = {
    'ov-n1': {
      id: 'ov-n1',
      children: kinds.map((k, i) => ({
        id: `e${i}`,
        component: k,
        trigger: { when: 'enter' as const },
        params: {},
      })),
    },
  }
  const node: GameNode = {
    id: 'n1',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: 't', overlayNodes: [{ overlay: 'ov-n1' }] },
  }
  return { node, overlays }
}

afterEach(() => unregisterKind('qte'))

describe('kind-registry', () => {
  it('register / get', () => {
    registerKind(qtePlugin)
    expect(getKind('qte')?.role).toBe('interaction')
    expect(getKind('nope')).toBeUndefined()
  })

  it('deriveOutputs = default out + interaction kind outputs (dedup)', () => {
    registerKind(qtePlugin)
    const { node, overlays } = nodeWithKinds(['qte'])
    expect(deriveOutputs(node, overlays).map((h) => h.id)).toEqual(['out', 'pass', 'good', 'fail'])
  })

  it('unregistered kind contributes no handle', () => {
    const { node, overlays } = nodeWithKinds(['unknownKind'])
    expect(deriveOutputs(node, overlays).map((h) => h.id)).toEqual(['out'])
  })

  it('runtime contract: interaction resolve', () => {
    registerKind({
      kind: 'qteResolve',
      role: 'interaction',
      validate: () => [],
      outputs: () => [{ id: 'pass' }, { id: 'fail' }],
      resolve: (_ctx, _p, input) => ({ outcome: input === 'hit' ? 'pass' : 'fail' }),
    })
    const inter = getKind('qteResolve')!
    const ended = inter.resolve!({ state: {} as never, nodeId: 'n', elapsedMs: 0 }, {}, 'hit')
    expect(ended.continue).not.toBe(true)
    if (ended.continue !== true) expect(ended.outcome).toBe('pass')
    unregisterKind('qteResolve')
  })
})
