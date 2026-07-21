/**
 * g_geometry_qc 审计单测（Workstream D · d-qcfix）。
 *
 * 重点守护刚修复的 bug：孤立 profile 检测 与 lathe/revolve XY 误用检测此前只覆盖
 * rect/circle/polygon 3 种，漏掉 rounded_rect / regular_polygon。这里对全部 5 种
 * profile 都断言能命中，防止回归；并附带 islands / overlap / missing_aabb 核心检查。
 */

import { describe, it, expect } from 'vitest'
import { geometryFromSource } from '../../vendor/dist/shared/types/index.js'
import { gGeometryQc } from '../../batteries/Output/QC/g_geometry_qc/index.ts'

interface QcOut {
  valid: boolean
  islands: number
  missing_aabb: number
  overlaps: number
  orphan_profiles: number
  primitive_only: boolean
  signals: Array<{ code: string; severity: string; message?: string; ids?: string[] }>
}

function qc(src: string, extra: Record<string, unknown> = {}): QcOut {
  return gGeometryQc({ geometry: geometryFromSource(src), ...extra }) as unknown as QcOut
}

describe('g_geometry_qc: orphan profile detection covers all 5 sketch ops', () => {
  const cases: Array<[string, string]> = [
    ['profile_rect', 'pr = profile_rect(w=0.1, d=0.2)'],
    ['profile_circle', 'pr = profile_circle(radius=0.1)'],
    ['profile_polygon', 'pr = profile_polygon(points=[[0,0],[1,0],[1,1]])'],
    ['profile_rounded_rect', 'pr = profile_rounded_rect(w=0.1, d=0.2, radius=0.02)'],
    ['profile_regular_polygon', 'pr = profile_regular_polygon(radius=0.1, sides=6)'],
  ]
  for (const [op, src] of cases) {
    it(`flags a lone ${op} as orphan_profile`, () => {
      const r = qc(src)
      expect(r.orphan_profiles).toBe(1)
      expect(r.signals.some((s) => s.code === 'orphan_profile' && s.ids?.includes('pr'))).toBe(true)
    })
  }

  it('does NOT flag a profile consumed by extrude', () => {
    const r = qc(['pr = profile_rounded_rect(w=0.1, d=0.2, radius=0.02)', 's = extrude(profile=pr, height=0.05)'].join('\n'))
    expect(r.orphan_profiles).toBe(0)
    expect(r.signals.some((s) => s.code === 'orphan_profile')).toBe(false)
  })
})

describe('g_geometry_qc: lathe/revolve XY-profile misuse covers all 5 sketch ops', () => {
  const cases: Array<[string, string]> = [
    ['profile_rect', 'pr = profile_rect(w=0.1, d=0.2)'],
    ['profile_circle', 'pr = profile_circle(radius=0.1)'],
    ['profile_rounded_rect', 'pr = profile_rounded_rect(w=0.1, d=0.2, radius=0.02)'],
    ['profile_regular_polygon', 'pr = profile_regular_polygon(radius=0.1, sides=6)'],
  ]
  for (const [op, profSrc] of cases) {
    it(`flags lathe fed an XY-centered ${op}`, () => {
      const r = qc([profSrc, 'sh = lathe(profile=pr)'].join('\n'))
      expect(r.signals.some((s) => s.code === 'lathe_xy_profile')).toBe(true)
    })
  }
})

describe('g_geometry_qc: core structural checks', () => {
  it('reports disconnected islands when jointed parts form multiple trees', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1)',
      'b2 = box(size=[1,1,1])',
      'p2 = part(shape=b2, origin=[2,0,0])',
      'j1 = joint(type="fixed", parent=p1, child=p2)',
      'b3 = box(size=[1,1,1])',
      'p3 = part(shape=b3, origin=[5,0,0])',
      'b4 = box(size=[1,1,1])',
      'p4 = part(shape=b4, origin=[7,0,0])',
      'j2 = joint(type="fixed", parent=p3, child=p4)',
    ].join('\n')
    const r = qc(src)
    expect(r.islands).toBe(2)
    expect(r.valid).toBe(false)
    expect(r.signals.some((s) => s.code === 'islands')).toBe(true)
  })

  it('detects sibling AABB overlap in rest pose', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1, origin=[0,0,0])',
      'b2 = box(size=[1,1,1])',
      'p2 = part(shape=b2, origin=[0.2,0,0])',
      'j = joint(type="fixed", parent=p1, child=p2)',
    ].join('\n')
    const r = qc(src)
    expect(r.overlaps).toBeGreaterThanOrEqual(1)
  })

  it('is valid for a clean two-part fixed assembly with no overlap', () => {
    const src = [
      'b1 = box(size=[0.1,0.1,0.1])',
      'p1 = part(shape=b1, origin=[0,0,0])',
      'b2 = box(size=[0.1,0.1,0.1])',
      'p2 = part(shape=b2, origin=[0.5,0,0])',
      'j = joint(type="fixed", parent=p1, child=p2, origin=[0.5,0,0])',
    ].join('\n')
    const r = qc(src)
    expect(r.islands).toBe(1)
    expect(r.overlaps).toBe(0)
    expect(r.valid).toBe(true)
  })
})

describe('g_geometry_qc: overlap severity follows the actual moving-joint relationship, not "does the model have any moving joint"', () => {
  it('does NOT fail a benign fixed-joint overlap just because an unrelated door elsewhere is revolute (the moving-joint trap)', () => {
    // slab (root, x/y in [-2,2], z in [-0.1,0.1])
    //   -- fixed --> wall (benign rest-pose overlap with slab, low-poly corner overlap)
    //   -- revolute --> door, hinged flush at the slab edge (x=2) and swinging outward
    //                   in +X — cleanly clear of both slab and wall, joint seated with 0 gap.
    const src = [
      'b_slab = box(size=[4,4,0.2])',
      'p_slab = part(shape=b_slab, origin=[0,0,0])',
      'b_wall = box(size=[4,0.2,2])',
      // wall origin chosen so it overlaps the slab AABB in rest pose (benign low-poly corner overlap)
      'p_wall = part(shape=b_wall, origin=[0,0,1.0])',
      'j_wall = joint(type="fixed", parent=p_slab, child=p_wall)',
      'b_door = box(size=[0.9,0.05,2.1])',
      // door's own link-local offset pushes it clear of the slab footprint (x>=2)
      'p_door = part(shape=b_door, origin=[0.45,0,1.05])',
      // hinge sits exactly on the slab edge → 0 gap to parent AABB, well within tolerance
      'j_door = joint(type="revolute", parent=p_slab, child=p_door, origin=[2,0,0], axis=[0,0,1])',
    ].join('\n')
    const r = qc(src)
    expect(r.overlaps).toBeGreaterThanOrEqual(1)
    // the slab/wall overlap is rigidly linked (fixed only) — must stay a warning, not fatal,
    // even though the model also contains a revolute joint elsewhere (the door, which itself
    // does not overlap anything and is seated with no gap).
    expect(
      r.signals.some((s) => s.code === 'aabb_overlap' && s.severity === 'error'),
    ).toBe(false)
    expect(r.signals.some((s) => s.code === 'aabb_overlap' && s.severity === 'note')).toBe(true)
    expect(r.signals.some((s) => s.code === 'joint_origin_far_from_parent')).toBe(false)
    expect(r.signals.some((s) => s.code === 'joint_attaches_distant_child')).toBe(false)
    expect(r.valid).toBe(true)
  })

  it('reports moving-joint overlap as warning only (does not fail valid)', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1, origin=[0,0,0])',
      'b2 = box(size=[1,1,1])',
      // overlaps p1 in rest pose
      'p2 = part(shape=b2, origin=[0.3,0,0])',
      'j = joint(type="revolute", parent=p1, child=p2, axis=[0,0,1])',
    ].join('\n')
    const r = qc(src)
    expect(r.overlaps).toBeGreaterThanOrEqual(1)
    expect(r.signals.some((s) => s.code === 'aabb_overlap' && s.severity === 'warning')).toBe(true)
    expect(r.signals.some((s) => s.code === 'aabb_overlap' && s.severity === 'error')).toBe(false)
    expect(r.valid).toBe(true)
  })

  it('fails valid for floating_link (part with no joint path to root)', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1)',
      'b2 = box(size=[1,1,1])',
      'p2 = part(shape=b2)',
      'j = joint(type="fixed", parent=p1, child=p2)',
      'b3 = box(size=[1,1,1])',
      'p3 = part(shape=b3)',
    ].join('\n')
    const r = qc(src)
    expect(r.floating_links).toBe(1)
    expect(r.signals.some((s) => s.code === 'floating_link' && s.severity === 'error')).toBe(true)
    expect(r.valid).toBe(false)
  })

  it('does NOT fail valid for jointless multi-part scenes (islands are expected)', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1, origin=[0,0,0])',
      'b2 = box(size=[1,1,1])',
      'p2 = part(shape=b2, origin=[2,0,0])',
    ].join('\n')
    const r = qc(src)
    expect(r.islands).toBe(2)
    expect(r.signals.some((s) => s.code === 'islands')).toBe(false)
    expect(r.valid).toBe(true)
  })
})

describe('g_geometry_qc: rock/boulder (mesh-backed primitive)', () => {
  it('does NOT flag a lone rock as primitive_only (unlike box/sphere/cone/…)', () => {
    const r = qc('r1 = rock(radius=0.2)')
    expect(r.primitive_only).toBe(false)
    expect(r.signals.some((s) => s.code === 'primitive_only')).toBe(false)
  })

  it('flags rock used as a boolean operand (mesh-backed, cannot participate in CSG)', () => {
    const src = [
      'r1 = rock(radius=0.2)',
      'b1 = box(size=[0.5, 0.5, 0.5])',
      'd1 = difference(base=b1, tool=r1)',
    ].join('\n')
    const r = qc(src)
    expect(r.valid).toBe(false)
    expect(
      r.signals.some((s) => s.code === 'mesh_boolean_misuse' && s.severity === 'error' && /r1\(rock\)/.test(s.message ?? '')),
    ).toBe(true)
  })

  it('flags rock as a boolean operand even through an intervening translate', () => {
    const src = [
      'r1 = rock(radius=0.2)',
      'm1 = translate(shape=r1, offset=[0.1, 0, 0])',
      'b1 = box(size=[0.5, 0.5, 0.5])',
      'u1 = union(a=b1, b=m1)',
    ].join('\n')
    const r = qc(src)
    expect(r.valid).toBe(false)
    expect(r.signals.some((s) => s.code === 'mesh_boolean_misuse')).toBe(true)
  })

  it('does NOT flag mesh_boolean_misuse for rock consumed by a plain part() (not a boolean operand)', () => {
    // note: a bare rock/pipe/sweep/section_loft part() still trips the pre-existing, unrelated
    // "aabb_missing" check (mesh-backed shapes have no static AABB formula) — that is expected
    // and applies uniformly to every mesh-backed op, not something rock-specific to guard here.
    const src = ['r1 = rock(radius=0.2)', 'p1 = part(shape=r1)'].join('\n')
    const r = qc(src)
    expect(r.signals.some((s) => s.code === 'mesh_boolean_misuse')).toBe(false)
  })
})
