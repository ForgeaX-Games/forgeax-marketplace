import { evalExpr, type EvalCtx } from '../../../engine/expr'
import { createRng } from '../../../engine/rng'
import type { NumOrExpr } from '../../../schema/graph-schema'
import type { SkinCtx } from '../../rendererRegistry'

export interface TextParameterInputs {
  parameter?: NumOrExpr | string
  durationMs?: number
}

function signed(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value
  return normalized > 0 ? `+${normalized}` : String(normalized)
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
      rng: rngState ? createRng(rngState.seed, rngState.step) : createRng(0),
    }
  }
  const hud = ctx?.hud
  return {
    vars: hud?.vars,
    entities: hud ? Object.fromEntries(Object.entries(hud.entities).map(([id, entity]) => [id, { attrs: entity.attrs }])) : undefined,
    flags: hud?.flags,
    score: hud?.score,
    rng: createRng(0),
  }
}

export function resolveTextParameter(value: unknown, ctx: SkinCtx | undefined, fallback: string): string {
  if (typeof value === 'number') return Number.isFinite(value) ? signed(value) : fallback
  if (typeof value === 'string') return value
  const expr = value && typeof value === 'object' ? (value as { expr?: unknown }).expr : undefined
  if (typeof expr !== 'string' || !expr.trim()) return fallback
  try {
    const result = evalExpr(expr, evalCtxFromSkin(ctx))
    return Number.isFinite(result) ? signed(result) : fallback
  } catch {
    return fallback
  }
}

export function resolveTextDurationMs(value: unknown, fallback = 1100): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
