import { beforeAll, describe, expect, it } from 'vitest'
import { floatTextComponent, registerCoreComponents } from '../registry/core-components'
import { componentHandles } from '../registry/component-registry'

beforeAll(() => { registerCoreComponents() })

describe('core-components', () => {
  it('floatText: validate requires text or expr', () => {
    expect(floatTextComponent.validate!({ text: '+30' })).toEqual([])
    expect(floatTextComponent.validate!({ text: '' })).toHaveLength(1)
  })

  it('choice/hotspot 出口 = inputs.events（handlesOf 派生）', () => {
    expect(componentHandles('choice', { events: [{ id: 's1' }, { id: 's2' }] }).map((h) => h.id)).toEqual(['s1', 's2'])
    expect(componentHandles('hotspot', { events: [{ id: 'door' }] }).map((h) => h.id)).toEqual(['door'])
  })

  it('qte 出口 = 组件静态 events（pass/good/fail）', () => {
    expect(componentHandles('qte', {}).map((h) => h.id)).toEqual(['pass', 'good', 'fail'])
  })
})
