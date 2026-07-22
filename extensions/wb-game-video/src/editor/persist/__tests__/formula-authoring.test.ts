import { describe, expect, it } from 'vitest'
import type { GameScenario } from '../../../runtime/schema/graph-schema'
import { toEditorScenarioDocument, toRuntimeScenario } from '../formula-authoring'

const base: GameScenario = {
  schemaVersion: 'wb-game-video.graph.v1',
  graph: { nodes: [], edges: [] },
}

describe('formula authoring document', () => {
  it('migrates interim editor metadata back to top-level formulas', () => {
    const doc = toEditorScenarioDocument({
      ...base,
      editor: {
        formulas: {
          damage: { id: 'damage', terms: [] },
        },
      },
    } as typeof base & { editor: { formulas: { damage: { id: string; terms: never[] } } } })
    expect(doc?.formulas?.damage?.id).toBe('damage')
  })

  it('keeps top-level formulas unchanged', () => {
    const legacy = {
      ...base,
      formulas: {
        damage: { id: 'damage', terms: [] },
      },
    }
    const doc = toEditorScenarioDocument(legacy)
    expect(doc?.formulas?.damage?.id).toBe('damage')
  })

  it('removes top-level formulas and expression picks before execution', () => {
    const runtime = toRuntimeScenario({
      ...base,
      formulas: { damage: { id: 'damage', terms: [] } },
      graph: {
        nodes: [{
          id: 'n1',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: {
            name: 'n1',
            reactions: [{
              when: { type: 'enter' },
              do: [{
                kind: 'effect',
                effects: [{
                  kind: 'attr',
                  entityId: 'player',
                  attr: 'hp',
                  op: 'add',
                  value: { expr: '1', pick: { mode: 'formula', formulaId: 'damage', holeBindings: {} } } as never,
                }],
              }],
            }],
          },
        }],
        edges: [],
      },
    })
    expect('formulas' in runtime).toBe(false)
    const value = (runtime.graph.nodes[0]?.data.reactions?.[0]?.do[0] as { effects?: Array<{ value?: unknown }> }).effects?.[0]?.value
    expect(value).toEqual({ expr: '1' })
  })
})
