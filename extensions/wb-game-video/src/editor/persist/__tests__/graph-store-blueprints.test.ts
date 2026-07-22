import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphScenario } from '../graphScenarioStore'
import { NODIA_DEMO_PROJECT } from '../../demo/demo'

beforeEach(() => {
  const p = structuredClone(NODIA_DEMO_PROJECT)
  const mainId = p.manifest.mainPackId
  useGraphScenario.setState({
    blueprints: p.manifest.packs,
    mainBlueprintId: mainId,
    activeBlueprintId: mainId,
    graph: p.manifest.packs[mainId]!.graph,
    meta: {
      variables: p.variables,
      entities: p.entities,
      ui: p.ui,
    },
    booted: true,
  } as any)
})

describe('store blueprint actions', () => {
  it('createBlueprint adds + selects', () => {
    const id = useGraphScenario.getState().createBlueprint('T')
    const st = useGraphScenario.getState()
    expect(st.blueprints[id]).toBeTruthy()
    expect(st.activeBlueprintId).toBe(id)
  })
  it('deleteBlueprint blocks main', () => {
    const st = useGraphScenario.getState()
    expect(st.deleteBlueprint(st.mainBlueprintId).ok).toBe(false)
  })
  it('authoringScenario puts new blueprint in manifest.packs', () => {
    const id = useGraphScenario.getState().createBlueprint('Sub')
    const scn = useGraphScenario.getState().authoringScenario()
    expect(scn.manifest.packs[id]).toBeTruthy()
  })
})

describe('derived graph / blueprints invariant', () => {
  it('setGraph keeps graph === blueprints[activeBlueprintId].graph', () => {
    // 传更新器产生新图引用，确认写回活跃蓝图后缓存字段与真相同引用。
    useGraphScenario.getState().setGraph((g) => ({ ...g, nodes: [...g.nodes] }))
    const st = useGraphScenario.getState()
    expect(st.graph).toBe(st.blueprints[st.activeBlueprintId]!.graph)
  })

  it('createBlueprint + selectBlueprint points graph at the new blueprint', () => {
    const id = useGraphScenario.getState().createBlueprint('New')
    useGraphScenario.getState().selectBlueprint(id)
    const st = useGraphScenario.getState()
    expect(st.activeBlueprintId).toBe(id)
    expect(st.graph).toBe(st.blueprints[id]!.graph)
  })

  it('applyLayout with a missing active blueprint does not fabricate a desynced graph', () => {
    const before = useGraphScenario.getState().graph
    // 制造过期/无效的活跃 id（Task 8 删蓝图/撤销时可能瞬时出现）。
    useGraphScenario.setState({ activeBlueprintId: 'does-not-exist' } as any)
    useGraphScenario.getState().applyLayout()
    const st = useGraphScenario.getState()
    expect(st.blueprints['does-not-exist']).toBeUndefined()
    // no-op：graph 缓存原样保留（不被凭空排版成一份与 blueprints 脱钩的新图）。
    expect(st.graph).toBe(before)
  })
})
