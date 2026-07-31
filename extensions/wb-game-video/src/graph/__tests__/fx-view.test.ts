import { beforeAll, describe, expect, it } from 'vitest'
import { toFXView } from '../canvas/fx-view'
import { NODIA_DEMO } from '../../editor/demo/demo'
import { registerCoreSkins } from '../../runtime/component-host/components'
import { getSubProcess } from '../../runtime/schema/graph-schema'

beforeAll(() => {
    registerCoreSkins()
})

const overlays = () => NODIA_DEMO.ui?.overlays
const processGraph = (id: string) => getSubProcess(NODIA_DEMO.graph.nodes.find((n) => n.id === id)!.data)!.graph

describe('toFXView', () => {
  it('derives handles: narrative handoff has a default output; wait has skill event outputs', () => {
    const fx = toFXView(NODIA_DEMO.graph, overlays())
    const handoff = fx.nodes.find((n) => n.id === 'n_nolotus')!
    const outIds = handoff.outputs.map((h) => h.data?.flowId)
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
    const e = fx.edges.find((x) => x.source === 'n_nolotus' && x.target === 'a_my')!
    expect(e.sourceHandle).toBe('source:default')
    expect(e.targetHandle).toBe('target:in')
  })

  it('output handles carry Chinese display labels', () => {
    const fx = toFXView(processGraph('a_my'), overlays())
    const wait = fx.nodes.find((n) => n.id === 'wait')!
    const light = wait.outputs.find((h) => h.data?.flowId === 'light')!
    expect(light.label).toBe('轻攻击')
    expect(light.data?.displayLabel).toBe('轻攻击')
    const handoff = fx.nodes.find((n) => n.id === 'n_nolotus')!
    const def = handoff.outputs.find((h) => h.data?.flowId === 'default')!
    expect(def.label).toBe('默认推进')
  })

  it('leaf / container badges from overlayNode / subProcess', () => {
    const fx = toFXView(NODIA_DEMO.graph, overlays())
    expect(fx.nodes.find((n) => n.id === 'win')!.type).toBe('default')
    expect(fx.nodes.find((n) => n.id === 'b_ai')!.data.badge).toBeTruthy()
    const tele = toFXView(processGraph('b_ai'), overlays()).nodes.find((n) => n.id === 'tele')!
    // 有 overlay 则 badge=overlay；否则空（旧 qte-on-timeline 已迁走）
    expect(['overlay', '']).toContain(tele.data.badge)
  })
})
