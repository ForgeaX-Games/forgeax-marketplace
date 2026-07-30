import { evalExpr, type EvalCtx } from '../../../engine/expr'
import { createRng } from '../../../engine/rng'
import type { NumOrExpr } from '../../../schema/graph-schema'
import type { SkinCtx } from '../../rendererRegistry'

export interface NumericFloatTextInputs {
  value?: NumOrExpr
  /** 兼容旧版字符串参数；新编辑器只写 value。 */
  text?: string
}

function evalCtxFromSkin(ctx: SkinCtx | undefined): EvalCtx {
  const state = ctx?.condition?.state
  if (state) {
    const rngState = state.rng?.getState()
    return {
      vars: state.vars,
      entities: state.entities,
      flags: state.flags,
      score: state.score,
      // React 渲染必须是纯读取；克隆当前位置，禁止 rand()/chance() 推进运行态 RNG。
      rng: rngState ? createRng(rngState.seed, rngState.step) : createRng(0),
    }
  }
  const hud = ctx?.hud
  return {
    vars: hud?.vars,
    entities: hud
      ? Object.fromEntries(Object.entries(hud.entities).map(([id, entity]) => [id, { attrs: entity.attrs }]))
      : undefined,
    flags: hud?.flags,
    score: hud?.score,
    rng: createRng(0),
  }
}

export function resolveNumericFloatValue(value: unknown, ctx: SkinCtx | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (!value || typeof value !== 'object') return undefined
  const expr = (value as { expr?: unknown }).expr
  if (typeof expr !== 'string' || !expr.trim()) return undefined
  try {
    const result = evalExpr(expr, evalCtxFromSkin(ctx))
    return Number.isFinite(result) ? result : undefined
  } catch {
    return undefined
  }
}

function signed(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return normalized > 0 ? `+${normalized}` : String(normalized)
}

export function resolveNumericFloatText(
  inputs: NumericFloatTextInputs,
  ctx: SkinCtx | undefined,
  fallback: string,
): string {
  const value = resolveNumericFloatValue(inputs.value, ctx)
  if (value != null) return signed(value)
  return typeof inputs.text === 'string' && inputs.text ? inputs.text : fallback
}
