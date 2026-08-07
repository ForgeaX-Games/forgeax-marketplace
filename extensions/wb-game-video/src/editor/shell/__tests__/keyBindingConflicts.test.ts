import { beforeAll, describe, expect, it } from 'vitest'
import type { GameGraph, Overlay } from '../../../runtime/schema/graph-schema'
import { bootEditorSkins } from '../../init'
import {
  collectAllKeyBindingSites,
  collectCurrentNodeKeyBindingSites,
  collectCurrentOverlayKeyBindingSites,
  conflictForInput,
  findKeyBindingConflicts,
  keyConflictChildIds,
  keyConflictTooltip,
  keysMatch,
} from '../keyBindingConflicts'

beforeAll(() => {
  bootEditorSkins()
})

function overlay(id: string, title: string, children: Overlay['children']): Overlay {
  return { id, title, children }
}

describe('keyBindingConflicts', () => {
  it('matches keys case-insensitively like runtime sameKey', () => {
    expect(keysMatch('C', 'c')).toBe(true)
    expect(keysMatch('A', 'B')).toBe(false)
  })

  it('flags the same key used by two catalog components', () => {
    const overlays = {
      schemeA: overlay('schemeA', '新方案 1', [
        { id: 'skill', component: 'BattleSkill', inputs: { heavyKey: 'C' } },
      ]),
      schemeB: overlay('schemeB', '新方案 2', [
        { id: 'opt', component: 'TextOption', inputs: { triggerKey: 'c' } },
      ]),
    }
    const conflicts = findKeyBindingConflicts(collectAllKeyBindingSites(overlays))
    expect(conflicts.has('schemeA/skill/heavyKey')).toBe(true)
    expect(conflicts.has('schemeB/opt/triggerKey')).toBe(true)
    expect(keyConflictChildIds('schemeA', conflicts)).toEqual(new Set(['skill']))
    expect(keyConflictTooltip(conflicts.get('schemeA/skill/heavyKey'))).toBe(
      '按键C已应用于文字交互-触发',
    )
  })

  it('does not compare key bindings across different schemes', () => {
    const schemeA = overlay('schemeA', '新方案 1', [
      { id: 'opt-a', component: 'TextOption', inputs: {} },
    ])
    const schemeB = overlay('schemeB', '新方案 2', [
      { id: 'opt-b', component: 'TextOption', inputs: {} },
    ])
    const overlays = { schemeA, schemeB }

    expect(findKeyBindingConflicts(
      collectCurrentOverlayKeyBindingSites(schemeA, overlays),
    ).size).toBe(0)
    expect(findKeyBindingConflicts(
      collectCurrentOverlayKeyBindingSites(schemeB, overlays),
    ).size).toBe(0)
  })

  it('flags two keys inside the same BattleSkill when they collide', () => {
    const overlays = {
      hud: overlay('hud', '战斗 HUD', [
        {
          id: 'bar',
          component: 'BattleSkill',
          inputs: { lightKey: 'X', heavyKey: 'X', meditKey: 'S', ultKey: 'B' },
        },
      ]),
    }
    const conflicts = findKeyBindingConflicts(collectAllKeyBindingSites(overlays))
    expect(conflictForInput(conflicts, 'hud', 'bar', 'lightKey')).toBeTruthy()
    expect(conflictForInput(conflicts, 'hud', 'bar', 'heavyKey')).toBeTruthy()
    expect(conflictForInput(conflicts, 'hud', 'bar', 'meditKey')).toBeUndefined()
  })

  it('restores manifest defaults when a configured key is cleared', () => {
    const current = overlay('scheme', '新方案', [
      {
        id: 'parry',
        component: 'BattleParry',
        inputs: { firstKey: '', secondKey: 'Q' },
      },
      {
        id: 'skills',
        component: 'BattleSkill',
        inputs: { heavyKey: 'A' },
      },
    ])
    const conflicts = findKeyBindingConflicts(
      collectCurrentOverlayKeyBindingSites(current, { scheme: current }),
    )

    expect(conflictForInput(conflicts, 'scheme', 'parry', 'firstKey')?.site.key).toBe('A')
    expect(conflictForInput(conflicts, 'scheme', 'skills', 'heavyKey')).toBeTruthy()
  })

  it('does not treat an unused base component template as a key owner', () => {
    const overlays = {
      'base:TextOption': overlay('base:TextOption', '文字交互', [
        { id: 'text-option', component: 'TextOption', inputs: {} },
      ]),
      schemeA: overlay('schemeA', '新方案 3', [
        { id: 'opt', component: 'TextOption', inputs: {} },
      ]),
    }
    const conflicts = findKeyBindingConflicts(collectAllKeyBindingSites(overlays))

    expect(conflicts.size).toBe(0)
  })

  it('includes node-added children without double-counting unchanged catalog mounts', () => {
    const overlays = {
      base: overlay('base', '基础交互', [
        { id: 'opt', component: 'TextOption', inputs: { triggerKey: 'F' } },
      ]),
    }
    const graph: GameGraph = {
      nodes: [{
        id: 'n1',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '节点一',
          overlayNodes: [{
            overlay: 'base',
            added: [{ id: 'extra', component: 'InkKou', inputs: { triggerKey: 'F' } }],
          }],
        },
      }],
      edges: [],
    }
    const sites = collectAllKeyBindingSites(overlays, [graph])
    const conflicts = findKeyBindingConflicts(sites)
    expect(conflicts.has('base/opt/triggerKey')).toBe(true)
    expect([...conflicts.keys()].some((id) => id.includes('extra') && id.includes('triggerKey'))).toBe(true)
  })

  it('limits blueprint conflicts to the current node mounts', () => {
    const overlays = {
      keys: overlay('keys', '按键界面', [
        { id: 'opt', component: 'TextOption', inputs: {} },
      ]),
    }
    const current = collectCurrentNodeKeyBindingSites(overlays, 'node-a', [
      { id: 'mount-a', overlay: 'keys' },
    ])
    const other = collectCurrentNodeKeyBindingSites(overlays, 'node-b', [
      { id: 'mount-b', overlay: 'keys' },
    ])

    expect(findKeyBindingConflicts(current).size).toBe(0)
    expect(findKeyBindingConflicts(other).size).toBe(0)
    expect(findKeyBindingConflicts([...current, ...other]).size).toBe(2)
  })
})
