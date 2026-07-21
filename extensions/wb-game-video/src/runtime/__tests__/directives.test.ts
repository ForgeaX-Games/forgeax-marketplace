import { describe, expect, it } from 'vitest'
import {
  isRenderOverlay,
  type RuntimeDirective,
} from '../engine/directives'

describe('directives', () => {
  it('constructs directive literals', () => {
    const play: RuntimeDirective = { type: 'playClip', nodeId: 'n1', name: '开场', loop: false }
    const overlay: RuntimeDirective = {
      type: 'renderOverlay',
      nodeId: 'n1',
      mountId: 'hpPanel',
      elementId: 'e1',
      component: 'floatText',
      inputs: { text: '+30', timeoutMs: 3000, defaultEvent: 'b' },
    }
    expect(play.type).toBe('playClip')
    expect(overlay.component).toBe('floatText')
    expect(overlay.inputs.timeoutMs).toBe(3000)
    expect(overlay.inputs.defaultEvent).toBe('b')
  })

  it('type guards discriminate renderOverlay', () => {
    const overlay: RuntimeDirective = {
      type: 'renderOverlay',
      nodeId: 'n',
      mountId: 'm1',
      elementId: 'e',
      component: 'x',
      inputs: {},
    }
    const play: RuntimeDirective = { type: 'playClip', nodeId: 'n', name: 'x', loop: false }
    expect(isRenderOverlay(overlay)).toBe(true)
    expect(isRenderOverlay(play)).toBe(false)
  })
})
