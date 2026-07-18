import { beforeAll, describe, expect, it } from 'vitest'
import { toFXView } from '../canvas/fx-view'
import { NODIA_DEMO } from '../../editor/demo/demo'
import { registerCoreKinds } from '../../runtime/registry/core-kinds'

beforeAll(() => registerCoreKinds())

describe('toFXView', () => {
  it('derives handles: enter has cond:0/else outputs; wait has opt:* outputs', () => {
    const fx = toFXView(NODIA_DEMO.graph)
    const enter = fx.nodes.find((n) => n.id === 'enter')!
    const outIds = enter.outputs.map((h) => h.data?.flowId)
    expect(outIds).toContain('cond:0')
    expect(outIds).toContain('else')

    const wait = fx.nodes.find((n) => n.id === 'wait')!
    const wOut = wait.outputs.map((h) => h.data?.flowId)
    expect(wOut).toContain('opt:light')
    expect(wOut).toContain('opt:heavy')
    expect(wOut).toContain('opt:ult')
  })

  it('every node has a single input handle; edges carry source/target handles', () => {
    const fx = toFXView(NODIA_DEMO.graph)
    expect(fx.nodes.every((n) => n.inputs.length === 1 && n.inputs[0]!.data?.flowId === 'in')).toBe(true)
    const e = fx.edges.find((x) => x.id === 'e-init-me')!
    expect(e.sourceHandle).toBe('source:cond:0')
    expect(e.targetHandle).toBe('target:in')
  })

  it('leaf / container badges from overlayNode / subFlow*', () => {
    const fx = toFXView(NODIA_DEMO.graph)
    expect(fx.nodes.find((n) => n.id === 'win')!.type).toBe('default')
    const tele = fx.nodes.find((n) => n.id === 'tele')!
    // 有 overlay 则 badge=overlay；否则空（旧 qte-on-timeline 已迁走）
    expect(['overlay', '']).toContain(tele.data.badge)
  })
})
