import { describe, expect, it } from 'vitest'
import { listInterfaceCustomSchemeIds } from '../builtin-schemes'
import type { Overlay } from '../../../runtime/schema/graph-schema'

describe('interface custom scheme order', () => {
  it('keeps a prepended new scheme ahead of existing custom schemes', () => {
    const overlay = (id: string): Overlay => ({ id, title: id, children: [] })
    const overlays = {
      'scheme-new': overlay('scheme-new'),
      'scheme-old': overlay('scheme-old'),
      'base:Dialogue': overlay('base:Dialogue'),
    }

    expect(listInterfaceCustomSchemeIds(overlays)).toEqual([
      'scheme-new',
      'scheme-old',
    ])
  })
})
