import { describe, expect, it } from 'vitest'
import { lintScenario } from '../lintScenario'
import type { Scenario } from '../types'

function minimalScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'scn-test',
    title: 'Test',
    rootSceneId: 's1',
    scenes: {
      s1: {
        id: 's1',
        title: 'Start',
        media: { kind: 'PLACEHOLDER' },
        durationMs: 5000,
        dialogue: [],
        branches: [{ id: 'b1', kind: 'auto', targetSceneId: 's2' }],
      },
      s2: {
        id: 's2',
        title: 'End',
        media: { kind: 'PLACEHOLDER' },
        durationMs: 3000,
        dialogue: [],
        branches: [],
        isEnding: true,
      },
    },
    defaultCharMs: 40,
    schemaVersion: 9,
    ...overrides,
  }
}

describe('lintScenario', () => {
  it('passes a minimal valid graph', () => {
    const r = lintScenario(minimalScenario())
    expect(r.ok).toBe(true)
    expect(r.errorCount).toBe(0)
  })

  it('errors on dangling branch target', () => {
    const scn = minimalScenario()
    scn.scenes.s1.branches = [{ id: 'b1', kind: 'auto', targetSceneId: 'missing' }]
    const r = lintScenario(scn)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'branch.dangling_target')).toBe(true)
  })

  it('errors when boss win scene missing', () => {
    const scn = minimalScenario()
    scn.entities = { boss1: { id: 'boss1', name: 'Boss', kind: 'boss', maxHp: 100 } }
    scn.scenes.s1.kind = 'battle'
    scn.scenes.s1.boss = {
      entityId: 'boss1',
      rounds: [{ id: 'r1' }],
      winSceneId: 'nope',
      loseSceneId: 's2',
    }
    const r = lintScenario(scn)
    expect(r.issues.some((i) => i.code === 'boss.win_missing')).toBe(true)
  })

  it('errors on non-monotonic QTE window', () => {
    const scn = minimalScenario()
    scn.scenes.s1.qte = {
      cues: [],
      window: { perfect: 200, great: 100, good: 50 },
      score: { perfect: 100, great: 50, good: 20, miss: -10 },
    }
    const r = lintScenario(scn)
    expect(r.issues.some((i) => i.code === 'qte.window_not_monotonic')).toBe(true)
  })

  it('warns on unreachable orphan scene', () => {
    const scn = minimalScenario()
    scn.scenes.orphan = {
      id: 'orphan',
      title: 'Lonely',
      media: { kind: 'PLACEHOLDER' },
      durationMs: 1000,
      dialogue: [],
      branches: [],
    }
    const r = lintScenario(scn)
    expect(r.issues.some((i) => i.code === 'graph.unreachable' && i.sceneId === 'orphan')).toBe(
      true,
    )
  })
})
