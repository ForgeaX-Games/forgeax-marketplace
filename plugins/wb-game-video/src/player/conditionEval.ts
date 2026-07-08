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
  Effect,
  EntityAttr,
  EntryGate,
  GameVariable,
  Scenario,
  Scene,
} from '../scenario/types'

/** 运行时数值状态：varId -> 数字（flag 用 0/1） */
export type VarState = Record<string, number>

/** 运行时背包状态：itemId -> 拥有数量 */
export type ItemState = Record<string, number>

/** 玩法实体在条件求值时需要的最小读取形状（与 player/entities.EntityRuntime 结构兼容）。 */
export interface EntityHpView {
  hp: number
  maxHp: number
  statusIds: string[]
  /** 出手速度等运行时可比较属性（attrCompare 用）；缺省视为 0。 */
  speed?: number
}

export type MutableEntityState<T extends EntityHpView = EntityHpView> = Record<string, T>

/** 条件求值上下文 */
export interface EvalContext {
  vars: VarState
  /** 已访问过的 sceneId（用于 visited 条件） */
  visitedSceneIds: ReadonlySet<string>
  /** 背包持有量（用于 hasItem 条件）；缺省视为空背包。 */
  ownedItems?: Readonly<ItemState>
  /** 玩法实体运行时（用于 hpRatio / status 条件）；缺省视为无实体。 */
  entities?: Readonly<Record<string, EntityHpView>>
  /** 当前累计 QTE 分数（用于 score 条件）；缺省视为 0。 */
  score?: number
}

/** 数值比较算子求值（var / hpRatio / score 共用）。 */
function compareOp(
  cur: number,
  op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'neq',
  value: number,
): boolean {
  switch (op) {
    case 'gte':
      return cur >= value
    case 'lte':
      return cur <= value
    case 'gt':
      return cur > value
    case 'lt':
      return cur < value
    case 'eq':
      return cur === value
    case 'neq':
      return cur !== value
    default:
      return true
  }
}

/** 读实体的可比较属性（attrCompare 用）；实体/属性缺失视为 0。 */
function entityAttr(entity: EntityHpView | undefined, attr: EntityAttr): number {
  if (!entity) return 0
  switch (attr) {
    case 'speed':
      return entity.speed ?? 0
    default:
      return 0
  }
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
    case 'var':
      return compareOp(ctx.vars[clause.varId] ?? 0, clause.op, clause.value)
    case 'flag': {
      const cur = (ctx.vars[clause.varId] ?? 0) !== 0
      return cur === clause.equals
    }
    case 'visited':
      return ctx.visitedSceneIds.has(clause.sceneId)
    case 'hasItem': {
      const need = clause.count ?? 1
      const have = ctx.ownedItems?.[clause.itemId] ?? 0
      return have >= need
    }
    // 玩法系统(v9)：实体血量比例 / 累计分数 / 状态效果。
    case 'hpRatio': {
      const e = ctx.entities?.[clause.entityId]
      const ratio = e && e.maxHp > 0 ? e.hp / e.maxHp : 0
      return compareOp(ratio, clause.op, clause.value)
    }
    case 'score':
      return compareOp(ctx.score ?? 0, clause.op, clause.value)
    case 'status': {
      const has = (e: EntityHpView | undefined): boolean =>
        !!e && e.statusIds.includes(clause.statusId)
      const present = clause.entityId
        ? has(ctx.entities?.[clause.entityId])
        : Object.values(ctx.entities ?? {}).some(has)
      return present === clause.present
    }
    case 'attrCompare': {
      const left = entityAttr(ctx.entities?.[clause.left], clause.attr)
      const right = entityAttr(ctx.entities?.[clause.right], clause.attr)
      return compareOp(left, clause.op, right)
    }
    default:
      return true
  }
}

/**
 * 应用一组物品副作用，返回**新**背包状态（不修改入参）。
 * give 累加，take 扣减并夹到 ≥0；count 缺省 = 1。
 */
export function applyItemEffects(
  effects: Effect[] | undefined,
  owned: ItemState,
): ItemState {
  if (!effects || effects.length === 0) return owned
  const next: ItemState = { ...owned }
  for (const eff of effects) {
    if (eff.kind !== 'item') continue
    const n = eff.count ?? 1
    const cur = next[eff.itemId] ?? 0
    next[eff.itemId] = eff.op === 'give' ? cur + n : Math.max(0, cur - n)
  }
  return next
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

/** 求一组条件是否全部满足（AND）；空 / undefined = 满足。 */
export function evaluateCondition(
  condition: { all: ConditionClause[] } | undefined,
  ctx: EvalContext,
): boolean {
  const clauses = condition?.all
  if (!clauses || clauses.length === 0) return true
  return clauses.every((c) => evaluateClause(c, ctx))
}

/** 进入场景门槛求值结果。 */
export interface GateResult {
  /** 是否允许进入。 */
  allowed: boolean
  /** 不允许 + redirect 时的改道目标（调用方据此换场）。 */
  redirectSceneId?: string
  /** 不允许时给玩家看的提示文案。 */
  hint?: string
}

/**
 * 求场景进入门槛。
 *
 * 无 entryGate / 条件满足 → allowed=true。
 * 条件不满足：
 *   - onFail='redirect' 且 redirectSceneId 有效 → allowed=false + 改道目标。
 *   - 否则（block 或没填改道目标） → allowed=false（阻断）。
 */
export function evaluateGate(
  gate: EntryGate | undefined,
  ctx: EvalContext,
): GateResult {
  if (!gate) return { allowed: true }
  if (evaluateCondition(gate.condition, ctx)) return { allowed: true }
  if (gate.onFail === 'redirect' && gate.redirectSceneId) {
    return { allowed: false, redirectSceneId: gate.redirectSceneId, hint: gate.hint }
  }
  return { allowed: false, hint: gate.hint }
}

/** 便捷重载：直接传 scene。 */
export function evaluateSceneGate(scene: Scene | undefined, ctx: EvalContext): GateResult {
  return evaluateGate(scene?.entryGate, ctx)
}

/**
 * 应用一组数值副作用，返回**新**状态（不修改入参）。
 * scenario 用于取变量定义做 clamp / flag 归一化。
 */
export function applyEffects(
  effects: Effect[] | undefined,
  vars: VarState,
  scenario: Scenario,
): VarState {
  if (!effects || effects.length === 0) return vars
  const next: VarState = { ...vars }
  for (const eff of effects) {
    if (eff.kind === 'var') {
      const def = scenario.variables?.[eff.varId]
      const cur = next[eff.varId] ?? def?.initial ?? 0
      const raw = eff.op === 'add' ? cur + eff.value : eff.value
      next[eff.varId] = clampVar(def, raw)
    } else if (eff.kind === 'flag') {
      next[eff.varId] = eff.value ? 1 : 0
    }
  }
  return next
}

export function applyEntityEffects<T extends EntityHpView>(
  effects: Effect[] | undefined,
  entities: MutableEntityState<T>,
): MutableEntityState<T> {
  if (!effects || effects.length === 0) return entities
  let next: MutableEntityState<T> = entities
  for (const eff of effects) {
    if (eff.kind === 'entityStat') {
      const entity = next[eff.entityId]
      if (!entity) continue
      if (eff.stat === 'hp') {
        const raw = eff.op === 'add' ? entity.hp + eff.value : eff.value
        const hp = Math.max(0, Math.min(entity.maxHp, raw))
        if (hp === entity.hp) continue
        next = { ...next, [eff.entityId]: { ...entity, hp } }
      } else if (eff.stat === 'speed') {
        const cur = entity.speed ?? 0
        const speed = Math.max(0, eff.op === 'add' ? cur + eff.value : eff.value)
        if (speed === cur) continue
        next = { ...next, [eff.entityId]: { ...entity, speed } }
      }
      // qi / shield 暂无运行时载体，忽略（与既有行为一致）。
    } else if (eff.kind === 'status') {
      const ids = eff.entityId ? [eff.entityId] : Object.keys(next)
      for (const id of ids) {
        const entity = next[id]
        if (!entity) continue
        const set = new Set(entity.statusIds)
        if (eff.op === 'add') set.add(eff.statusId)
        else set.delete(eff.statusId)
        const statusIds = [...set]
        if (statusIds.join('\0') === entity.statusIds.join('\0')) continue
        next = { ...next, [id]: { ...entity, statusIds } }
      }
    }
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

const ATTR_LABEL: Record<EntityAttr, string> = {
  speed: '出手速度',
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
    case 'hasItem': {
      const name = scenario.items?.[clause.itemId]?.name ?? clause.itemId
      const n = clause.count ?? 1
      return n > 1 ? `拥有「${name}」×${n}` : `拥有「${name}」`
    }
    case 'hpRatio': {
      const name = scenario.entities?.[clause.entityId]?.name ?? clause.entityId
      const pct = Math.round(clause.value * 100)
      return `${name} 血量 ${OP_LABEL[clause.op] ?? clause.op} ${pct}%`
    }
    case 'score':
      return `分数 ${OP_LABEL[clause.op] ?? clause.op} ${clause.value}`
    case 'status': {
      const sName = scenario.statuses?.[clause.statusId]?.name ?? clause.statusId
      const who = clause.entityId
        ? scenario.entities?.[clause.entityId]?.name ?? clause.entityId
        : '任一方'
      return clause.present ? `${who} 处于「${sName}」` : `${who} 未处于「${sName}」`
    }
    case 'attrCompare': {
      const leftName = scenario.entities?.[clause.left]?.name ?? clause.left
      const rightName = scenario.entities?.[clause.right]?.name ?? clause.right
      return `${leftName} ${ATTR_LABEL[clause.attr] ?? clause.attr} ${OP_LABEL[clause.op] ?? clause.op} ${rightName}`
    }
    default:
      return ''
  }
}

export function describeItemEffect(eff: Extract<Effect, { kind: 'item' }>, scenario: Scenario): string {
  const name = scenario.items?.[eff.itemId]?.name ?? eff.itemId
  const n = eff.count ?? 1
  return eff.op === 'give' ? `获得 ${name}${n > 1 ? `×${n}` : ''}` : `消耗 ${name}${n > 1 ? `×${n}` : ''}`
}

/** 把整条分支条件渲染成一句话；无条件返回空串 */
export function describeCondition(branch: Branch, scenario: Scenario): string {
  const clauses = branch.condition?.all
  if (!clauses || clauses.length === 0) return ''
  return clauses.map((c) => describeClause(c, scenario)).join(' 且 ')
}

export function describeEffect(eff: Effect, scenario: Scenario): string {
  if (eff.kind === 'var') {
    const name = varName(scenario, eff.varId)
    if (eff.op === 'set') return `${name} = ${eff.value}`
    return `${name} ${eff.value >= 0 ? '+' : ''}${eff.value}`
  }
  if (eff.kind === 'flag') {
    const name = varName(scenario, eff.varId)
    return `${name} ${eff.value ? '已达成' : '未达成'}`
  }
  if (eff.kind === 'item') return describeItemEffect(eff, scenario)
  if (eff.kind === 'entityStat') {
    const name = scenario.entities?.[eff.entityId]?.name ?? eff.entityId
    const stat = eff.stat === 'hp' ? 'HP' : eff.stat === 'speed' ? '出手速度' : eff.stat
    if (eff.op === 'set') return `${name} ${stat} = ${eff.value}`
    return `${name} ${stat} ${eff.value >= 0 ? '+' : ''}${eff.value}`
  }
  const statusName = scenario.statuses?.[eff.statusId]?.name ?? eff.statusId
  const who = eff.entityId ? scenario.entities?.[eff.entityId]?.name ?? eff.entityId : '全部实体'
  return `${who} ${eff.op === 'add' ? '获得' : '移除'}状态「${statusName}」`
}
