import { describe, expect, it } from 'vitest'
import {
  isOpenInteraction,
  isRenderOverlay,
  type RuntimeDirective,
} from '../directives'

describe('directives', () => {
  it('constructs directive literals', () => {
    const play: RuntimeDirective = { type: 'playClip', nodeId: 'n1', name: '开场', loop: false }
    const overlay: RuntimeDirective = {
      type: 'renderOverlay',
      nodeId: 'n1',
      elementId: 'e1',
      kind: 'floatText',
      params: { text: '+30' },
    }
    const inter: RuntimeDirective = {
      type: 'openInteraction',
      nodeId: 'n1',
      elementId: 'e2',
      kind: 'qte',
      params: {},
      handles: ['pass', 'good', 'fail'],
    }
    expect(play.type).toBe('playClip')
    expect(overlay.kind).toBe('floatText')
    expect(inter.handles).toEqual(['pass', 'good', 'fail'])
  })

  it('type guards discriminate', () => {
    const inter: RuntimeDirective = { type: 'openInteraction', nodeId: 'n', elementId: 'e', kind: 'qte', params: {}, handles: [] }
    const overlay: RuntimeDirective = { type: 'renderOverlay', nodeId: 'n', elementId: 'e', kind: 'x', params: {} }
    expect(isOpenInteraction(inter)).toBe(true)
    expect(isOpenInteraction(overlay)).toBe(false)
    expect(isRenderOverlay(overlay)).toBe(true)
    expect(isRenderOverlay(inter)).toBe(false)
  })
})
