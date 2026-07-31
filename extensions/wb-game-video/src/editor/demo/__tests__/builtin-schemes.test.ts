import { describe, expect, it } from 'vitest'
import { ensureBaseHudSchemes, NEW_COMPONENT_PRESETS } from '../builtin-schemes'
import { STAGE_FILL_LAYOUT } from '../../../runtime/schema/layout'

const NEW_COMPONENT_IDS = [
  'dialogue',
  'inkKou',
  'inkYingMo',
  'battleParry',
  'battleSkillBar',
  'damageFloatText',
  'gainFloatText',
  'battlePlayerHpBar',
  'battleEnemyHpBar',
] as const

describe('new component presets', () => {
  it('provides an explicit stage layout for every new component', () => {
    for (const componentId of NEW_COMPONENT_IDS) {
      const preset = NEW_COMPONENT_PRESETS.find(({ id }) => id === componentId)
      expect(preset, componentId).toBeTruthy()
      expect(preset!.make(`${componentId}-test`).layout).toEqual(STAGE_FILL_LAYOUT)
      expect(preset!.make(`${componentId}-test`).inputs).toEqual({})
    }
  })

  it('creates base schemes only for the new component registry', () => {
    const overlays = ensureBaseHudSchemes({})
    expect(Object.keys(overlays)).toEqual(NEW_COMPONENT_IDS.map((id) => `base:${id}`))
    expect(overlays['base:floatText']).toBeUndefined()
    expect(overlays['base:battleHpBar']).toBeUndefined()
  })
})
