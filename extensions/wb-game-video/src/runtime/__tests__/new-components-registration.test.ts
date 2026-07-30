import { describe, expect, it } from 'vitest'
import {
  createCoreSkinRegistry,
  createDefaultComponentRegistry,
} from '../component-host/components'
import newComponents from '../component-host/components/new'

const NEW_COMPONENT_IDS = [
  'BattleEnemyHpBar',
  'BattlePlayerHpBar',
  'BattleSkill',
  'BattleParry',
  'Dialogue',
  'DamageFloatText',
  'GainFloatText',
  'InkYingMo',
  'InkKou',
] as const

describe('components/new registration', () => {
  it('registers all nine definitions and renderers in isolated registries', () => {
    const components = createDefaultComponentRegistry()
    const skins = createCoreSkinRegistry()

    expect(newComponents.map(({ manifest }) => manifest.id)).toEqual(NEW_COMPONENT_IDS)
    for (const { manifest } of newComponents) {
      expect(components.getComponent(manifest.id)).toBe(manifest)
      expect(skins.hasOverlayRenderer(manifest.id)).toBe(true)
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
