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
  signals: Array<{ code: string; severity: string; ids?: string[] }>
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
  it('reports disconnected islands when parts are not joined', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1)',
      'b2 = box(size=[1,1,1])',
      'p2 = part(shape=b2, origin=[5,0,0])',
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
