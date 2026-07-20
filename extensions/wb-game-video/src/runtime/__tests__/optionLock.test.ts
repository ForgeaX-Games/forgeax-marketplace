import { describe, expect, it } from 'vitest'
import { isOptionLocked, conditionTargetFromHud } from '../skins/optionLock'
import type { SkinCtx } from '../skins/rendererRegistry'
import type { HudSnap } from '../engine/session'

function hud(vars: Record<string, number>): HudSnap {
  return { entities: {}, vars, flags: {}, score: 0 }
}

describe('isOptionLocked (方案 B)', () => {
  const heavy = {
    condition: { all: [{ type: 'var' as const, varId: 'qi', op: 'gte' as const, value: 2 }] },
  }

  it('无 condition → 不锁', () => {
    const ctx: SkinCtx = { hud: hud({ qi: 0 }) }
    expect(isOptionLocked({}, ctx)).toBe(false)
  })

  it('hud.vars 不满足 → 锁；满足 → 不锁（时时随 hud）', () => {
    expect(isOptionLocked(heavy, { hud: hud({ qi: 1 }) })).toBe(true)
    expect(isOptionLocked(heavy, { hud: hud({ qi: 2 }) })).toBe(false)
  })

  it('注入完整 condition 目标时与引擎同源', () => {
    const t = conditionTargetFromHud(hud({ qi: 5, lizhi: 4 }))
    const ctx: SkinCtx = { hud: hud({ qi: 0 }), condition: t }
    const ult = {
      condition: {
        all: [
          { type: 'var' as const, varId: 'qi', op: 'gte' as const, value: 5 },
          { type: 'var' as const, varId: 'lizhi', op: 'gte' as const, value: 4 },
        ],
      },
    }
    expect(isOptionLocked(ult, ctx)).toBe(false)
  })

  it('openInteraction 不再依赖 _locked 字段', () => {
    const ctx: SkinCtx = { hud: hud({ qi: 0 }) }
    expect(isOptionLocked({ ...heavy, _locked: false } as typeof heavy & { _locked: boolean }, ctx)).toBe(true)
  })
})
