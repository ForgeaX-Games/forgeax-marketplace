import { beforeAll, describe, expect, it } from 'vitest'
import { scenarioToGraph } from '../scenarioToGraph'
import { GraphRuntime } from '../engine'
import { registerCoreKinds } from '../core-kinds'
import { validateGraph } from '../validate'
import { getDemoScenario, getBlueprintCombatDemoScenario } from '../../../scenario/demoScenario'
import { migrateScenarioToLatest } from '../../../scenario/schemaMigrate'
import type { Scenario } from '../../../scenario/types'

beforeAll(() => registerCoreKinds())

function latest(s: Scenario): Scenario {
  return migrateScenarioToLatest(s)
}

describe('scenarioToGraph (legacy Scenario → graph GameScenario)', () => {
  it('emits one node per scene with the root scene first (engine starts at nodes[0])', () => {
    const scenario = latest(getDemoScenario())
    const g = scenarioToGraph(scenario)
    expect(g.graph.nodes.length).toBe(Object.keys(scenario.scenes).length)
    expect(g.graph.nodes[0]?.id).toBe(scenario.rootSceneId)
    for (const n of g.graph.nodes) expect(n.type).toBe('perf')
  })

  it('carries variables and hp-attr entities into meta', () => {
    const scenario = latest(getBlueprintCombatDemoScenario())
    const g = scenarioToGraph(scenario)
    for (const [id, e] of Object.entries(scenario.entities ?? {})) {
      const mapped = g.entities?.[id]
      expect(mapped).toBeTruthy()
      expect(mapped!.attrs?.hp).toBe(e.initialHp ?? e.maxHp)
      expect(mapped!.attrMeta?.hp?.max).toBe(e.maxHp)
    }
    if (scenario.variables) {
      for (const id of Object.keys(scenario.variables)) expect(g.variables?.[id]).toBeTruthy()
    }
  })

  it('maps choice branches to opt:<id> edges + a choice interaction element', () => {
    const scenario = latest(getBlueprintCombatDemoScenario())
    const g = scenarioToGraph(scenario)
    for (const scene of Object.values(scenario.scenes)) {
      const choiceBranches = (scene.branches ?? []).filter((b) => b.kind === 'choice')
      if (choiceBranches.length === 0) continue
      const node = g.graph.nodes.find((n) => n.id === scene.id)!
      expect(node.data.timeline.some((el) => el.kind === 'choice')).toBe(true)
      for (const b of choiceBranches) {
        if (!scenario.scenes[b.targetSceneId]) continue
        expect(g.graph.edges.some((e) => e.source === scene.id && e.sourceHandle === `opt:${b.id}`)).toBe(true)
      }
    }
  })

  it('produced graph passes the validator and is runnable on GraphRuntime', () => {
    const scenario = latest(getBlueprintCombatDemoScenario())
    const g = scenarioToGraph(scenario)
    const errors = validateGraph(g.graph, {
      entities: Object.keys(g.entities ?? {}),
      vars: Object.keys(g.variables ?? {}),
      rules: g.rules,
    }).filter((i) => i.level === 'error')
    expect(errors).toEqual([])

    const rt = new GraphRuntime(g.graph, g)
    rt.start()
    expect(rt.state.currentNodeId).toBe(scenario.rootSceneId)
  })
})
