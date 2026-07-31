import { describe, expect, it } from 'vitest'
import {
  ensureBaseHudSchemes,
  listInterfaceCustomSchemeIds,
  NEW_COMPONENT_PRESETS,
  SCHEME_DYNAMIC_ID,
  SCHEME_STATIC_ID,
} from '../builtin-schemes'
import newComponents from '../../../runtime/component-host/components/new'
import { STAGE_FILL_LAYOUT } from '../../../runtime/schema/layout'
import type { Overlay } from '../../../runtime/schema/graph-schema'

const NEW_COMPONENT_IDS = newComponents.map(({ manifest }) => manifest.id)

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

describe('interface custom scheme order', () => {
  it('keeps a prepended new scheme ahead of built-in and existing schemes', () => {
    const overlay = (id: string): Overlay => ({ id, title: id, children: [] })
    const existing = {
      [SCHEME_STATIC_ID]: overlay(SCHEME_STATIC_ID),
      [SCHEME_DYNAMIC_ID]: overlay(SCHEME_DYNAMIC_ID),
      'scheme-old': overlay('scheme-old'),
    }
    const overlays = {
      'scheme-new': overlay('scheme-new'),
      ...existing,
    }

    expect(listInterfaceCustomSchemeIds(overlays)).toEqual([
      'scheme-new',
      SCHEME_STATIC_ID,
      SCHEME_DYNAMIC_ID,
      'scheme-old',
    ])
  })
})
