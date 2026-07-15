import { describe, expect, it } from 'vitest'
import {
  isOpenInteraction,
  isRenderOverlay,
  type RuntimeDirective,
} from '../engine/directives'

describe('directives', () => {
  it('constructs directive literals', () => {
    const play: RuntimeDirective = { type: 'playClip', nodeId: 'n1', name: '开场', loop: false }
    const overlay: RuntimeDirective = {
      type: 'renderOverlay',
      nodeId: 'n1',
      elementId: 'e1',
      component: 'floatText',
      params: { text: '+30' },
    }
    const inter: RuntimeDirective = {
      type: 'openInteraction',
      nodeId: 'n1',
      elementId: 'e2',
      component: 'qte',
      params: {},
      handles: ['pass', 'good', 'fail'],
    }
    expect(play.type).toBe('playClip')
    expect(overlay.component).toBe('floatText')
    expect(inter.handles).toEqual(['pass', 'good', 'fail'])
  })

  it('type guards discriminate', () => {
    const inter: RuntimeDirective = {
      type: 'openInteraction',
      nodeId: 'n',
      elementId: 'e',
      component: 'qte',
      params: {},
      handles: [],
    }
    const overlay: RuntimeDirective = {
      type: 'renderOverlay',
      nodeId: 'n',
      elementId: 'e',
      component: 'x',
      params: {},
    }
    expect(isOpenInteraction(inter)).toBe(true)
    expect(isOpenInteraction(overlay)).toBe(false)
    expect(isRenderOverlay(overlay)).toBe(true)
    expect(isRenderOverlay(inter)).toBe(false)
  })
})
