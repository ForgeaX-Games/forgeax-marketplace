/**
 * effect 应用器（图原生、通用）—— 把声明式 GraphEffect 作用到可变运行态。
 *
 * 通用化（方向 C）：**没有 hp 特权**。实体只是一袋 attrs（+可选 attrMeta 约束）；`attr` effect 写任意
 * attr，按 attrMeta 的 min/max clamp。value 可为常量或表达式 `{expr}`（公式，就地声明，去 combatRules 散耦合）。
 */
import type { AttrMeta, GraphEffect } from '../schema/graph-schema'
import { evalExpr, type EvalCtx } from './expr'
import type { Rng } from './rng'

export interface MutableEntity {
  attrs: Record<string, number>
  attrMeta?: Record<string, AttrMeta>
}

export interface MutableState {
  vars: Record<string, number>
  varMeta?: Record<string, { min?: number; max?: number }>
  entities: Record<string, MutableEntity>
  flags: Record<string, number>
  score: number
  items?: Record<string, number>
  rng?: Rng
  /** 已应用过的 once effect id 集合。 */
  appliedOnce?: Set<string>
}

function ctxFrom(state: MutableState): EvalCtx {
  return {
    vars: state.vars,
    entities: state.entities,
    flags: state.flags,
    score: state.score,
    rng: state.rng,
  }
}

function resolveValue(value: number | { expr: string }, state: MutableState): number {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && typeof value.expr === 'string') {
    return evalExpr(value.expr, ctxFrom(state))
  }
  throw new Error(`bad effect value: ${JSON.stringify(value)}`)
}

function clamp(v: number, meta?: { min?: number; max?: number }): number {
  let out = v
  if (meta?.min !== undefined) out = Math.max(meta.min, out)
  if (meta?.max !== undefined) out = Math.min(meta.max, out)
  return out
}

/** 把一组 effect 顺序作用到 state（原地修改）。 */
export function applyEffects(state: MutableState, effects: readonly GraphEffect[]): void {
  for (const eff of effects) {
    // once：仅首次生效（跨回合循环用）。
    if ('once' in eff && eff.once && eff.id) {
      state.appliedOnce ??= new Set()
      if (state.appliedOnce.has(eff.id)) continue
      state.appliedOnce.add(eff.id)
    }
    switch (eff.kind) {
      case 'var': {
        const cur = state.vars[eff.varId] ?? 0
        const val = resolveValue(eff.value, state)
        state.vars[eff.varId] = clamp(eff.op === 'set' ? val : cur + val, state.varMeta?.[eff.varId])
        break
      }
      case 'attr': {
        const ent = state.entities[eff.entityId]
        if (!ent) break
        const cur = ent.attrs[eff.attr] ?? 0
        const val = resolveValue(eff.value, state)
        ent.attrs[eff.attr] = clamp(eff.op === 'set' ? val : cur + val, ent.attrMeta?.[eff.attr])
        break
      }
      case 'flag': {
        state.flags[eff.varId] = eff.value ? 1 : 0
        break
      }
      case 'item': {
        state.items ??= {}
        const cur = state.items[eff.itemId] ?? 0
        state.items[eff.itemId] = eff.op === 'give' ? cur + eff.count : Math.max(0, cur - eff.count)
        break
      }
    }
  }
}
