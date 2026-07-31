import { describe, expect, it } from 'vitest'
import { GraphSession } from '../engine/session'
import type { GameGraph } from '../schema/graph-schema'
import { node, scnOf } from './test-fixtures'

describe('SessionSnapshot blueprint location', () => {
  it('snapshot exposes activeBlueprintId and callStack titles', () => {
    const main: GameGraph = {
      nodes: [node('wrap', { subFlowPack: { id: 'enemy-turn', version: '1' }, durationMs: 100 })],
      edges: [],
    }
    const packGraph: GameGraph = { nodes: [node('tele', { durationMs: 100 })], edges: [] }
    const scn = {
      ...scnOf(main),
      manifest: {
        version: 'wb-game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'wrap', graph: main },
          'enemy-turn': { id: 'enemy-turn', title: '敌方回合', version: '1', entry: 'tele', graph: packGraph },
        },
      },
    }
    const session = new GraphSession(scn, { rootBlueprintId: 'bp-main' })
    const snap = session.start()
    expect(snap.activeBlueprintId).toBe('enemy-turn')
    expect(snap.activeGraphPath).toEqual([])
    expect(snap.callStack).toEqual([{ blueprintId: 'bp-main', callerNodeId: 'wrap', graphPath: [], title: '主蓝图' }])
  })
})
