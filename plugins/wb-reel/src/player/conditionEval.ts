/**
 * 数值系统 · 运行时求值（纯函数，无 DOM / 无 React / 无副作用）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 职责：
 *   - 从 Scenario.variables 初始化运行时数值状态（好感度 / flag / 积分）
 *   - 求一条分支的 condition 是否满足（控制选项「显示 / 锁定」）
 *   - 把分支 effects / 场景 onEnterEffects 应用到数值状态（累积好感等）
 *   - 把条件渲染成人类可读文本（编辑器 & 锁定选项的悬停提示复用）
 *
 * flag 类型在运行时统一用 0 / 1 表示，求值/展示时再翻译成 是/否。
 */

import type {
  Branch,
  ConditionClause,
  GameVariable,
  Scenario,
  VarEffect,
} from '../scenario/types'

/** 运行时数值状态：varId -> 数字（flag 用 0/1） */
export type VarState = Record<string, number>

/** 条件求值上下文 */
export interface EvalContext {
  vars: VarState
  /** 已访问过的 sceneId（用于 visited 条件） */
  visitedSceneIds: ReadonlySet<string>
}

function clampVar(def: GameVariable | undefined, n: number): number {
  if (!Number.isFinite(n)) return 0
  if (def?.kind === 'flag') return n !== 0 ? 1 : 0
  let v = n
  if (def && typeof def.min === 'number') v = Math.max(def.min, v)
  if (def && typeof def.max === 'number') v = Math.min(def.max, v)
  return v
}

/** 从变量定义初始化运行时状态 */
export function initVarState(scenario: Scenario): VarState {
  const out: VarState = {}
  for (const v of Object.values(scenario.variables ?? {})) {
    out[v.id] = clampVar(v, v.initial ?? 0)
  }
  return out
}

/** 求单条子句 */
export function evaluateClause(
  clause: ConditionClause,
  ctx: EvalContext,
): boolean {
  switch (clause.type) {
    case 'var': {
      const cur = ctx.vars[clause.varId] ?? 0
      switch (clause.op) {
        case 'gte':
          return cur >= clause.value
        case 'lte':
          return cur <= clause.value
        case 'gt':
          return cur > clause.value
        case 'lt':
          return cur < clause.value
        case 'eq':
          return cur === clause.value
        case 'neq':
          return cur !== clause.value
        default:
          return true
      }
    }
    case 'flag': {
      const cur = (ctx.vars[clause.varId] ?? 0) !== 0
      return cur === clause.equals
    }
    case 'visited':
      return ctx.visitedSceneIds.has(clause.sceneId)
    default:
      return true
  }
}

/**
 * 分支是否满足解锁条件。
 * 无 condition / 空 all[] = 始终可走（向后兼容旧数据）。
 */
export function isBranchAvailable(branch: Branch, ctx: EvalContext): boolean {
  const clauses = branch.condition?.all
  if (!clauses || clauses.length === 0) return true
  return clauses.every((c) => evaluateClause(c, ctx))
}

/**
 * 应用一组数值副作用，返回**新**状态（不修改入参）。
 * scenario 用于取变量定义做 clamp / flag 归一化。
 */
export function applyEffects(
  effects: VarEffect[] | undefined,
  vars: VarState,
  scenario: Scenario,
): VarState {
  if (!effects || effects.length === 0) return vars
  const next: VarState = { ...vars }
  for (const eff of effects) {
    const def = scenario.variables?.[eff.varId]
    const cur = next[eff.varId] ?? def?.initial ?? 0
    const raw = eff.op === 'add' ? cur + eff.value : eff.value
    next[eff.varId] = clampVar(def, raw)
  }
  return next
}

// ──────────────────────────────────────────────────────────────────────────
// 人类可读描述（编辑器 + 锁定选项悬停提示复用）
// ──────────────────────────────────────────────────────────────────────────

const OP_LABEL: Record<string, string> = {
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
  eq: '=',
  neq: '≠',
}

function varName(scenario: Scenario, id: string): string {
  return scenario.variables?.[id]?.name ?? id
}

export function describeClause(
  clause: ConditionClause,
  scenario: Scenario,
): string {
  switch (clause.type) {
    case 'var':
      return `${varName(scenario, clause.varId)} ${OP_LABEL[clause.op] ?? clause.op} ${clause.value}`
    case 'flag':
      return `${varName(scenario, clause.varId)} ${clause.equals ? '已达成' : '未达成'}`
    case 'visited': {
      const title = scenario.scenes[clause.sceneId]?.title ?? clause.sceneId
      return `经历过「${title}」`
    }
    default:
      return ''
  }
}

/** 把整条分支条件渲染成一句话；无条件返回空串 */
export function describeCondition(branch: Branch, scenario: Scenario): string {
  const clauses = branch.condition?.all
  if (!clauses || clauses.length === 0) return ''
  return clauses.map((c) => describeClause(c, scenario)).join(' 且 ')
}

export function describeEffect(eff: VarEffect, scenario: Scenario): string {
  const name = varName(scenario, eff.varId)
  if (eff.op === 'set') return `${name} = ${eff.value}`
  return `${name} ${eff.value >= 0 ? '+' : ''}${eff.value}`
}
