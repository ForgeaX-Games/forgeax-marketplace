import { describe, expect, test } from 'vitest'
import { getBlueprintCombatDemoScenario } from '../demoScenario'
import { branchOutcomeLabels, listPerformanceSettlements } from '../performanceSettlement'

describe('performanceSettlement', () => {
  test('lists damage cues from demo pu2 scene', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const rows = listPerformanceSettlements(scenario.scenes.pu2!)
    expect(rows).toHaveLength(4)
    expect(rows[0]?.damage).toBe(20)
    expect(rows[0]?.atMs).toBe(600)
  })

  test('lists text-only sticker clips without performance cue', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const base = scenario.scenes.pu!
    const rows = listPerformanceSettlements({
      ...base,
      performance: { cues: [] },
      stickerClips: [
        {
          id: 'txt-1',
          startMs: 900,
          endMs: 2200,
          kind: 'numeric',
          text: '完美！',
          x: 0.5,
          y: 0.3,
          sizePct: 12,
          scale: 1,
          rotation: 0,
          opacity: 1,
          enter: 'pop',
          layer: 1,
        },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.displayText).toBe('完美！')
    expect(rows[0]?.damage).toBeNull()
    expect(rows[0]?.atMs).toBe(900)
  })

  test('branchOutcomeLabels for qte tele scene', () => {
    const scenario = getBlueprintCombatDemoScenario()
    const labels = branchOutcomeLabels(scenario.scenes.tele!)
    expect(labels).toEqual(['受击防反', '受击闪避', '受击'])
  })

  test('branchOutcomeLabels hidden for single auto branch', () => {
    const scenario = getBlueprintCombatDemoScenario()
    expect(branchOutcomeLabels(scenario.scenes.pu!)).toEqual([])
  })
})
