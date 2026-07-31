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

  it('uses a new clip occurrence for same-id entries and returns through nested packs', () => {
    const main: GameGraph = {
      nodes: [node('wrap-a', { subFlowPack: { id: 'pack-a', version: '1' } }), node('after', { durationMs: 100 })],
      edges: [{ id: 'main-next', source: 'wrap-a', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packA: GameGraph = {
      nodes: [node('entry', { durationMs: 100 }), node('wrap-b', { subFlowPack: { id: 'pack-b', version: '1' } })],
      edges: [{ id: 'a-next', source: 'entry', target: 'wrap-b', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const packB: GameGraph = { nodes: [node('entry', { durationMs: 100 })], edges: [] }
    const scn = {
      ...scnOf(main),
      manifest: {
        version: 'wb-game-video.blueprint-manifest.v1' as const,
        mainPackId: 'bp-main',
        packs: {
          'bp-main': { id: 'bp-main', entry: 'wrap-a', graph: main },
          'pack-a': { id: 'pack-a', version: '1', entry: 'entry', graph: packA },
          'pack-b': { id: 'pack-b', version: '1', entry: 'entry', graph: packB },
        },
      },
    }
    const session = new GraphSession(scn, { rootBlueprintId: 'bp-main' })

    let snap = session.start()
    expect(snap.clip?.nodeId).toBe('entry')
    expect(snap.activeBlueprintId).toBe('pack-a')
    expect(snap.clipSeq).toBe(1)

    snap = session.performanceEnd()
    expect(snap.clip?.nodeId).toBe('entry')
    expect(snap.activeBlueprintId).toBe('pack-b')
    expect(snap.clipSeq).toBe(2)

    snap = session.performanceEnd()
    expect(snap.currentNodeId).toBe('after')
    expect(snap.activeBlueprintId).toBe('bp-main')
    expect(snap.callStack).toEqual([])
    expect(snap.clipSeq).toBe(3)
  })
})
