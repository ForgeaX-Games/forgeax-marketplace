import { describe, expect, it } from 'vitest'
import {
  createCoreSkinRegistry,
  createDefaultComponentRegistry,
} from '../component-host/components'
import { NEW_COMPONENTS } from '../component-host/components/new'

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

describe('components/new registration', () => {
  it('registers all nine definitions and renderers in isolated registries', () => {
    const components = createDefaultComponentRegistry()
    const skins = createCoreSkinRegistry()

    expect(NEW_COMPONENTS.map(({ id }) => id)).toEqual(NEW_COMPONENT_IDS)
    for (const { id, definition } of NEW_COMPONENTS) {
      expect(components.getComponent(id)).toBe(definition)
      expect(skins.hasOverlayRenderer(id)).toBe(true)
    }
  })

  it('does not register legacy component ids', () => {
    const components = createDefaultComponentRegistry()
    const skins = createCoreSkinRegistry()

    for (const id of ['battleHpBar', 'floatText', 'transition', 'choice', 'skill', 'qte', 'hotspot', 'filter', 'fx']) {
      expect(components.getComponent(id), id).toBeUndefined()
      expect(skins.hasOverlayRenderer(id), id).toBe(false)
    }
  })
})
