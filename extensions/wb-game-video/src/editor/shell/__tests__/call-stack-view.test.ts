import { describe, expect, it } from 'vitest'
import { blueprintBreadcrumbs, deepestCallerOnBlueprint } from '../call-stack-view'

describe('blueprintBreadcrumbs', () => {
  it('collapses same-graph subflow frames', () => {
    const crumbs = blueprintBreadcrumbs(
      'main', '主蓝图',
      [
        { blueprintId: 'main', title: '主蓝图' }, // same-graph subFlow
        { blueprintId: 'main', title: '主蓝图' }, // still on main before/at pack call
      ],
      'pack', '战斗',
    )
    expect(crumbs.map((c) => c.blueprintId)).toEqual(['main', 'pack'])
  })

  it('nested pack: caller frame uses returnBlueprintId of inner pack', () => {
    const crumbs = blueprintBreadcrumbs(
      'main', '主蓝图',
      [
        { blueprintId: 'main', title: '主蓝图' },
        { blueprintId: 'pack-a', title: '战斗 A' }, // return frame: called pack-b from pack-a graph
      ],
      'pack-b', '战斗 B',
    )
    expect(crumbs.map((c) => c.blueprintId)).toEqual(['main', 'pack-a', 'pack-b'])
  })
})

describe('deepestCallerOnBlueprint', () => {
  it('picks deepest caller on pinned blueprint', () => {
    const stack = [
      { blueprintId: 'main', callerNodeId: 'turn' },
      { blueprintId: 'main', callerNodeId: 'combat' },
    ]
    expect(deepestCallerOnBlueprint(stack, 'main', 'pack')).toBe('combat')
    expect(deepestCallerOnBlueprint(stack, 'pack', 'pack')).toBeNull()
  })
})
