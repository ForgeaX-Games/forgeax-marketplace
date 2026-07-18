/**
 * dsl-to-graph 编译器单测（Workstream A · verify）。
 *
 * 覆盖：
 *   1. compile：每语句一节点 + 线性 geometry 边 + ref id 边 + 终端 QC/URDF 节点
 *   2. op→电池映射：joint(type=X)→g_joint_X、fillet/chamfer→g_fillet、gear→g_gear
 *   3. 未知 op：显式报错并带行号，不建图
 *   4. round-trip：DSL → 图 → DSL 等价（含 chamfer 的 type 不丢）
 */

import { describe, it, expect } from 'vitest'
import { parseDSL, listOpSpecs, type Statement, type Arg } from '../../vendor/dist/shared/types/index.js'
import { compileDslToGraph, graphToDsl } from '../src/services/dsl-to-graph.js'

const CABINET = [
  'mat = material(rgba=[0.6, 0.4, 0.2, 1])',
  'body = box(size=[0.6, 0.4, 0.8])',
  'cavity = box(size=[0.55, 0.38, 0.7])',
  'shell = difference(base=body, tool=cavity)',
  'r_shell = fillet(shape=shell, radius=0.01, edges="vertical")',
  'p_body = part(shape=r_shell, material=mat)',
  'door = box(size=[0.6, 0.02, 0.75])',
  'p_door = part(shape=door, material=mat, origin=[0, 0.21, 0])',
  'hinge = joint(type="revolute", parent=p_body, child=p_door, axis=[0, 0, 1], origin=[0.3, 0.2, 0], lower=0, upper=1.57)',
].join('\n')

/** id → {op, 归一化 args JSON}，忽略 args 顺序，用于结构等价比较。 */
function canon(statements: readonly Statement[]): Record<string, { op: string; args: string }> {
  const out: Record<string, { op: string; args: string }> = {}
  for (const s of statements) out[s.id] = { op: s.op, args: canonArgs(s.args) }
  return out
}
function canonArgs(args: Record<string, Arg>): string {
  const keys = Object.keys(args).sort()
  return JSON.stringify(keys.map((k) => [k, args[k]]))
}

describe('compileDslToGraph: structure', () => {
  it('emits one node per statement plus terminal QC + URDF', () => {
    const r = compileDslToGraph(CABINET)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.graph).not.toBeNull()
    // 9 语句节点
    expect(r.statementNodeIds).toHaveLength(9)
    // + QC + URDF
    expect(r.graph!.nodes).toHaveLength(11)
    expect(r.qcNodeId).toBeTruthy()
    expect(r.urdfNodeId).toBeTruthy()
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get(r.qcNodeId)!.batteryId).toBe('g_geometry_qc')
    expect(byId.get(r.urdfNodeId)!.batteryId).toBe('g_to_urdf')
  })

  it('chains geometry edges linearly through statements into QC → URDF', () => {
    const r = compileDslToGraph(CABINET)
    const geomEdges = r.graph!.edges.filter((e) => e.source.port === 'geometry' && e.target.port === 'geometry')
    // 8 语句间 + 末语句→QC + QC→URDF = 10
    expect(geomEdges).toHaveLength(10)
    // 首节点无 incoming geometry
    const firstId = r.statementNodeIds[0]
    expect(geomEdges.some((e) => e.target.nodeId === firstId)).toBe(false)
    // QC→URDF 存在
    expect(geomEdges.some((e) => e.source.nodeId === r.qcNodeId && e.target.nodeId === r.urdfNodeId)).toBe(true)
  })

  it('creates ref id edges from referenced statement id output ports', () => {
    const r = compileDslToGraph(CABINET)
    const refEdges = r.graph!.edges.filter((e) => e.source.port === 'id')
    // difference(base,tool)=2, fillet(shape)=1, part(shape,material)=2, part(shape,material)=2, joint(parent,child)=2 → 9
    expect(refEdges).toHaveLength(9)
    // body → shell 的 base_id 边
    expect(refEdges.some((e) => e.source.nodeId === 'body' && e.target.nodeId === 'shell')).toBe(true)
    // p_body → hinge 的 parent 边
    expect(refEdges.some((e) => e.source.nodeId === 'p_body' && e.target.nodeId === 'hinge')).toBe(true)
  })

  it('carries a ref-LIST via params array and wires NO id→port edges (loft)', () => {
    // Regression: a runtime input port is single-valued (last-write-wins), so
    // N id→profile_ids edges would collapse to one id and shadow the params
    // array — loft then sees 1 profile and fails "must contain at least two".
    // The list must travel purely via node.params.profile_ids; no ref edges.
    const src = [
      'pa = profile_circle(radius=0.3)',
      'pb = profile_circle(radius=0.1)',
      'lf = loft(profiles=[pa, pb], height=0.5)',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const loft = r.graph!.nodes.find((n) => n.id === 'lf')!
    expect(loft.params!.profile_ids).toEqual(['pa', 'pb'])
    // No id-output edge targets loft's profile_ids port.
    const profileEdges = r.graph!.edges.filter((e) => e.target.nodeId === 'lf' && e.target.port === 'profile_ids')
    expect(profileEdges).toHaveLength(0)
  })

  it('maps line numbers per node for agent-facing diagnostics', () => {
    const r = compileDslToGraph(CABINET)
    expect(r.lineByNodeId['mat']).toBe(1)
    expect(r.lineByNodeId['hinge']).toBe(9)
    expect(r.lineByNodeId[r.qcNodeId]).toBe(0)
  })
})

describe('compileDslToGraph: op → battery mapping', () => {
  it('dispatches joint(type=X) to the concrete g_joint_X battery', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1)',
      'b2 = box(size=[1,1,1])',
      'p2 = part(shape=b2)',
      'jf = joint(type="fixed", parent=p1, child=p2)',
      'jr = joint(type="revolute", parent=p1, child=p2, axis=[0,0,1])',
      'jp = joint(type="prismatic", parent=p1, child=p2, axis=[1,0,0])',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('jf')!.batteryId).toBe('g_joint_fixed')
    expect(byId.get('jr')!.batteryId).toBe('g_joint_revolute')
    expect(byId.get('jp')!.batteryId).toBe('g_joint_prismatic')
  })

  it('maps fillet and chamfer to g_fillet with correct type param', () => {
    const src = [
      'b = box(size=[1,1,1])',
      'f = fillet(shape=b, radius=0.02)',
      'c = chamfer(shape=b, radius=0.02)',
    ].join('\n')
    const r = compileDslToGraph(src)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('f')!.batteryId).toBe('g_fillet')
    expect(byId.get('f')!.params!.type).toBe('round')
    expect(byId.get('c')!.batteryId).toBe('g_fillet')
    expect(byId.get('c')!.params!.type).toBe('chamfer')
  })

  it('maps gear variants to their shared batteries', () => {
    const src = 'g = spur_gear(module=1, teeth_number=20, width=0.01)'
    const r = compileDslToGraph(src)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('g')!.batteryId).toBe('g_gear')
  })

  it('injects tooth_profile from the gear alias so profiles are not lost', () => {
    const src = [
      'g0 = spur_gear(module=1, teeth_number=20, width=0.01)',
      'g1 = herringbone_gear(module=1, teeth_number=20, width=0.01)',
      'g2 = crossed_helical_gear(module=1, teeth_number=20, width=0.01)',
      'g3 = hyperbolic_gear(module=1, teeth_number=20, width=0.01)',
      'g4 = herringbone_ring_gear(module=1, teeth_number=40, width=0.015, rim_width=0.005)',
      'g5 = herringbone_rack_gear(module=1, length=0.1, width=0.01, height=0.01)',
    ].join('\n')
    const r = compileDslToGraph(src)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('g0')!.params!.tooth_profile).toBe('spur')
    expect(byId.get('g1')!.params!.tooth_profile).toBe('herringbone')
    expect(byId.get('g2')!.params!.tooth_profile).toBe('helical')
    expect(byId.get('g3')!.params!.tooth_profile).toBe('hyperbolic')
    expect(byId.get('g4')!.batteryId).toBe('g_ring_gear')
    expect(byId.get('g4')!.params!.tooth_profile).toBe('herringbone')
    expect(byId.get('g5')!.batteryId).toBe('g_rack_gear')
    expect(byId.get('g5')!.params!.tooth_profile).toBe('herringbone')
  })

  it('round-trips a herringbone gear back to its alias (profile preserved)', () => {
    const src = 'g1 = herringbone_gear(module=1, teeth_number=20, width=0.01)'
    const r = compileDslToGraph(src)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    expect(back).toContain('herringbone_gear(')
    expect(back).not.toContain('tooth_profile')
    const reparsed = parseDSL(back)
    expect(canon(reparsed.statements)).toEqual(canon(parseDSL(src).statements))
  })
})

describe('compileDslToGraph: unknown op', () => {
  it('reports an unmapped op with its 1-based line number and does not build a graph', () => {
    const src = ['x = box(size=[1,1,1])', 'y = wibblewobble(foo=1)'].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(false)
    expect(r.graph).toBeNull()
    const unmapped = r.errors.find((e) => e.kind === 'unmapped-op')
    expect(unmapped).toBeTruthy()
    expect(unmapped!.line).toBe(2)
    expect(unmapped!.message).toContain('wibblewobble')
  })

  it('reports parse errors without a graph', () => {
    const r = compileDslToGraph('m = material(texture="oops')
    expect(r.ok).toBe(false)
    expect(r.graph).toBeNull()
    expect(r.errors.length).toBeGreaterThan(0)
  })
})

describe('compileDslToGraph: op-registry ↔ battery mapping parity', () => {
  // 防漂移守卫：op-registry(SSOT，op-directory.md 由它生成) 里暴露给 DSL 的每个 op
  // 都必须在 OP_TABLE / GENERIC_BATTERY 里有电池映射，否则 agent 会写出一个
  // 目录里合法、却在编译期报 "unmapped-op" 的 op（如历史上的 pipe / section_loft）。
  //
  // 已知例外：*_gear_pair 是 **baker-only** builder，故意不给电池——齿轮对的建模路径是
  // 「两个单齿轮 + joint」（见 g_bevel_gear/meta.json）。它们出现在 op-registry 里只为
  // 让 baker DSL 可执行，不应作为 DSL-authorable op（这是另一处方向相反的漂移：op-directory
  // 误把它们列为可写 op，理想修法是在 vendor op-registry 里不把 pair 计入 listOpSpecs）。
  const BAKER_ONLY_OPS = new Set(['bevel_gear_pair', 'crossed_gear_pair', 'hyperbolic_gear_pair'])
  it('maps every DSL-authorable op advertised by listOpSpecs() to a battery', () => {
    const unmapped: string[] = []
    for (const spec of listOpSpecs()) {
      if (BAKER_ONLY_OPS.has(spec.name)) continue
      const r = compileDslToGraph(`t = ${spec.name}()`, { appendTerminals: false })
      if (r.errors.some((e) => e.kind === 'unmapped-op')) unmapped.push(spec.name)
    }
    expect(unmapped).toEqual([])
  })
})

describe('graphToDsl: round-trip', () => {
  it('reconstructs an equivalent DSL from the compiled graph', () => {
    const r = compileDslToGraph(CABINET)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    const original = parseDSL(CABINET)
    const reparsed = parseDSL(back)
    expect(reparsed.errors).toEqual([])
    expect(canon(reparsed.statements)).toEqual(canon(original.statements))
  })

  it('preserves chamfer (not silently downgraded to fillet)', () => {
    const src = ['b = box(size=[1,1,1])', 'c = chamfer(shape=b, radius=0.02, edges="all")'].join('\n')
    const r = compileDslToGraph(src)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    expect(back).toContain('chamfer(')
    expect(back).not.toContain('fillet(')
    const reparsed = parseDSL(back)
    expect(canon(reparsed.statements)).toEqual(canon(parseDSL(src).statements))
  })

  it('preserves joint type + axis + limits through round-trip', () => {
    const r = compileDslToGraph(CABINET)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    const hinge = parseDSL(back).statements.find((s) => s.id === 'hinge')!
    expect(hinge.op).toBe('joint')
    expect(hinge.args.type).toEqual({ kind: 'string', value: 'revolute' })
    expect(hinge.args.axis).toEqual({ kind: 'list', items: [
      { kind: 'number', value: 0 }, { kind: 'number', value: 0 }, { kind: 'number', value: 1 },
    ] })
  })
})
