import { beforeAll, describe, expect, it } from 'vitest'
import { toFXView } from '../canvas/fx-view'
import { NODIA_DEMO } from '../../editor/demo/demo'
import { registerCoreSkins } from '../../runtime/component-host/components'

beforeAll(() => {
    registerCoreSkins()
})

const overlays = () => NODIA_DEMO.ui?.overlays

describe('toFXView', () => {
  it('derives handles: enter has default outputs; wait has skill event outputs', () => {
    const fx = toFXView(NODIA_DEMO.graph, overlays())
    const enter = fx.nodes.find((n) => n.id === 'enter')!
    const outIds = enter.outputs.map((h) => h.data?.flowId)
    expect(outIds).toContain('default')

    const wait = fx.nodes.find((n) => n.id === 'wait')!
    const wOut = wait.outputs.map((h) => h.data?.flowId)
    expect(wOut).toContain('light')
    expect(wOut).toContain('heavy')
    expect(wOut).toContain('ult')
  })

  it('every node has a single input handle; edges carry source/target handles', () => {
    const fx = toFXView(NODIA_DEMO.graph, overlays())
    expect(fx.nodes.every((n) => n.inputs.length === 1 && n.inputs[0]!.data?.flowId === 'in')).toBe(true)
    const e = fx.edges.find((x) => x.source === 'enter' && x.target === 'a_my')!
    expect(e.sourceHandle).toBe('source:default')
    expect(e.targetHandle).toBe('target:in')
  })

  it('output handles carry Chinese display labels', () => {
    const fx = toFXView(NODIA_DEMO.graph, overlays())
    const wait = fx.nodes.find((n) => n.id === 'wait')!
    const light = wait.outputs.find((h) => h.data?.flowId === 'light')!
    expect(light.label).toBe('轻攻击')
    expect(light.data?.displayLabel).toBe('轻攻击')
    const enter = fx.nodes.find((n) => n.id === 'enter')!
    const def = enter.outputs.find((h) => h.data?.flowId === 'default')!
    expect(def.label).toBe('默认推进')
  })

  it('leaf / container badges from overlayNode / subFlow*', () => {
    const fx = toFXView(NODIA_DEMO.graph, overlays())
    expect(fx.nodes.find((n) => n.id === 'win')!.type).toBe('default')
    const tele = fx.nodes.find((n) => n.id === 'tele')!
    // 有 overlay 则 badge=overlay；否则空（旧 qte-on-timeline 已迁走）
    expect(['overlay', '']).toContain(tele.data.badge)
  })
})
