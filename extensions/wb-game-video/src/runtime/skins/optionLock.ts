/**
 * 选项门控（方案 B）：皮肤用落盘 `condition` + 实时态自行判断，引擎不注入 `_locked`。
 */
import type { GraphCondition } from '../schema/graph-schema'
import type { MutableState } from '../engine/apply-effects'
import { evaluateCondition, type ConditionTarget } from '../engine/condition'
import type { HudSnap } from '../engine/session'
import type { SkinCtx } from './rendererRegistry'

/** 由 hud 拼弱化运行态（attrs + vars/flags/score）。 */
export function conditionTargetFromHud(hud: HudSnap, visited: Set<string> = new Set()): ConditionTarget {
  const entities: MutableState['entities'] = {}
  for (const [id, e] of Object.entries(hud.entities)) {
    const attrs = e.attrs ?? { hp: e.hp }
    const attrMeta: Record<string, { max?: number }> = { hp: { max: e.maxHp } }
    for (const [k, max] of Object.entries(e.attrMax ?? {})) attrMeta[k] = { max }
    entities[id] = { attrs, attrMeta }
  }
  return {
    state: {
      vars: hud.vars,
      flags: hud.flags,
      score: hud.score,
      entities,
    },
    visited,
  }
}

/** 皮肤求值目标：优先完整 condition；否则用 hud 弱化态。 */
export function skinConditionTarget(ctx: SkinCtx | undefined): ConditionTarget | undefined {
  if (!ctx) return undefined
  if (ctx.condition) return ctx.condition
  return conditionTargetFromHud(ctx.hud)
}

/**
 * 选项是否锁定（condition 不成立 → true）。
 * 无 condition → 不锁；无 ctx → 不锁（预览未注入态时仍可点）。
 */
export function isOptionLocked(
  opt: { condition?: GraphCondition },
  ctx: SkinCtx | undefined,
): boolean {
  if (!opt.condition) return false
  const t = skinConditionTarget(ctx)
  if (!t) return false
  return !evaluateCondition(opt.condition, t)
}
