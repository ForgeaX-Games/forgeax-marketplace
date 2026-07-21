import { beforeAll, describe, expect, it } from 'vitest'
import { floatTextComponent, resolveFloatTextDisplay } from '../skins/components/FloatText'
import { registerCoreSkins } from '../skins/components'
import { componentHandles } from '../registry/component-registry'
import type { SkinCtx } from '../skins/rendererRegistry'

beforeAll(() => {
  registerCoreSkins()
})

describe('skins/components 契约', () => {
  it('floatText: validate requires text or expr', () => {
    expect(floatTextComponent.validate!({ text: '+30' })).toEqual([])
    expect(floatTextComponent.validate!({ text: '' })).toHaveLength(1)
  })

  it('floatText: 绘制时 resolve expr（无 ComponentDef.render）', () => {
    const ctx: SkinCtx = {
      hud: {
        entities: {
          'ent-player': { hp: 100, maxHp: 100, attrs: { attack: 40 }, attrMax: { attack: 40 } },
        },
        vars: {},
        flags: {},
        score: 0,
      },
      condition: {
        state: {
          vars: {},
          entities: { 'ent-player': { attrs: { attack: 40 } } },
          flags: {},
          score: 0,
        },
        visited: new Set(),
      },
    }
    expect(resolveFloatTextDisplay({ text: '{v}', expr: '-(entity.ent-player.attr.attack)' }, ctx)).toBe('-40')
    expect(resolveFloatTextDisplay({ text: '嗨' }, ctx)).toBe('嗨')
  })

  it('choice/hotspot 出口 = inputs.events（handlesOf 派生）', () => {
    expect(componentHandles('choice', { events: [{ id: 's1' }, { id: 's2' }] }).map((h) => h.id)).toEqual(['s1', 's2'])
    expect(componentHandles('hotspot', { events: [{ id: 'door' }] }).map((h) => h.id)).toEqual(['door'])
  })

  it('qte 出口 = 组件静态 events（pass/good/fail）', () => {
    expect(componentHandles('qte', {}).map((h) => h.id)).toEqual(['pass', 'good', 'fail'])
  })
})
