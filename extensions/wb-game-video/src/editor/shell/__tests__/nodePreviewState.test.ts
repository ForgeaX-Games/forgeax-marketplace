import { describe, expect, it } from 'vitest'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { projectNodePreviewState } from '../nodePreviewState'

describe('projectNodePreviewState', () => {
  it('applies an at settlement at its configured playhead and resets when scrubbing backward', () => {
    const current = node('entry', {
      reactions: [{
        when: { type: 'at', ms: 3500 },
        do: [{
          kind: 'effect',
          effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -80 }],
        }],
      }],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        entities: {
          'ent-player': {
            id: 'ent-player',
            kind: 'player',
            attrs: { hp: 100 },
            attrMeta: { hp: { initial: 100, min: 0, max: 100 } },
          },
        },
      },
    )

    expect(projectNodePreviewState(scenario, current, 3499, 15_100).entities['ent-player']?.attrs.hp).toBe(100)
    expect(projectNodePreviewState(scenario, current, 3500, 15_100).entities['ent-player']?.attrs.hp).toBe(20)
    expect(projectNodePreviewState(scenario, current, 2000, 15_100).entities['ent-player']?.attrs.hp).toBe(100)
  })

  it('applies enter immediately and complete then exit at the node end', () => {
    const current = node('entry', {
      reactions: [
        { when: { type: 'enter' }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] },
        { when: { type: 'complete' }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 2 }] }] },
        { when: { type: 'exit' }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 3 }] }] },
      ],
    })
    const scenario = scnOf({ nodes: [current], edges: [] })

    expect(projectNodePreviewState(scenario, current, 0, 1000).vars.qi).toBe(1)
    expect(projectNodePreviewState(scenario, current, 1000, 1000).vars.qi).toBe(6)
  })
})
