/**
 * 通用选取式数值公式 —— 从 scenario.entities / variables 选取，编译成 NumOrExpr。
 * 条款为左结合链：±×÷（可属性×属性）；结构稿存于 NumOrExpr.pick，重开时复原下拉。
 */
import type {
  Entity,
  NumOrExpr,
  ValueTermOp,
  Variable,
} from '../../runtime/schema/graph-schema'
import type { EditorValueTerm as ValueTerm, FormulaHoleBinding, FormulaPick } from '../persist/formula-authoring'
import {
  findEntity,
  findFormula,
  listAttrOptions,
  listEntityOptions,
  listFormulaOptions,
  listVarOptions,
} from './metaCatalog'

export type ValuePick =
  | { mode: 'const'; const: number }
  | { mode: 'pick'; terms: ValueTerm[] }
  | FormulaPick
export type { ValueTerm, ValueTermOp }

export {
  findEntity,
  findFormula,
  listAttrOptions,
  listEntityOptions,
  listFormulaOptions,
  listVarOptions,
} from './metaCatalog'

export const VALUE_TERM_OPS: ValueTermOp[] = ['+', '-', '*', '/']
export const VALUE_TERM_OP_LABEL: Record<ValueTermOp, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
}

function termOp(t: ValueTerm): ValueTermOp {
  return t.op === '+' || t.op === '-' || t.op === '*' || t.op === '/' ? t.op : '+'
}

function atomComplete(t: ValueTerm): boolean {
  if (t.source === 'const') return true
  if (!t.refId) return false
  if (t.source === 'var') return true
  return !!t.attr
}

function atomRef(t: ValueTerm): string {
  if (t.source === 'const') {
    const n = t.constValue ?? 0
    return n < 0 ? `(${n})` : String(n)
  }
  if (t.source === 'var') return `var.${t.refId}`
  return `entity.${t.refId}.attr.${t.attr || 'hp'}`
}

/** 统一补齐 op，并按 source 清理无关字段。四种运算符对每一项（含首项）都合法——见 `leadTerm`。 */
export function normalizeTerms(terms: ValueTerm[]): ValueTerm[] {
  return terms.map((t) => {
    const op = termOp(t)
    const source = t.source === 'const' ? 'const' : t.source === 'var' ? 'var' : 'entity'
    return {
      op,
      source,
      refId: source === 'const' ? '' : t.refId,
      attr: source === 'entity' ? t.attr : undefined,
      constValue: source === 'const' ? (t.constValue ?? 0) : undefined,
    }
  })
}

/**
 * 首项没有左操作数，×÷ 不表示"跟左边结合"，而是跟 +− 一样的一元变换：
 * + / × → 原值；− → 取反；÷ → 取倒数（跟 Effect 层「运算」符号按钮的减/除同一套语义）。
 */
function leadTerm(op: ValueTermOp, body: string): string {
  if (op === '-') return `-${body}`
  if (op === '/') return `1/(${body})`
  return body
}

/**
 * 把选取式条款编译成引擎 NumOrExpr（左结合加括号；对象形态附带 pick）。
 * 只接常量 / 选取式两态——`formula` 态走 `formulaApply.ts` 的 `compileFormula`（它内部编译留空位
 * 回填后的条款链时，也是转手调这个函数，只是永远只传 `mode:'pick'`）。
 */
export function compileValuePick(pick: Exclude<ValuePick, { mode: 'formula' }>): NumOrExpr {
  if (pick.mode === 'const') return pick.const
  const terms = normalizeTerms(pick.terms).filter(atomComplete)
  if (terms.length === 0) return { expr: '0', pick }
  let expr = leadTerm(termOp(terms[0]!), atomRef(terms[0]!))
  for (let i = 1; i < terms.length; i++) {
    const t = terms[i]!
    const op = termOp(t)
    const body = atomRef(t)
    expr = `(${expr}${op}${body})`
  }
  return { expr, pick: { mode: 'pick', terms } }
}

/** Effect 层"运算"符号按钮的减/除动作——落盘仍只有 add/mul/set，减=取反后 add，除=取倒数后 mul。 */
export function negateNumOrExpr(v: NumOrExpr): NumOrExpr {
  return typeof v === 'number' ? -v : { expr: `-(${v.expr})` }
}
export function reciprocalNumOrExpr(v: NumOrExpr): NumOrExpr {
  return typeof v === 'number' ? (v === 0 ? 0 : 1 / v) : { expr: `1/(${v.expr})` }
}

/** 给公式条款分配稳定 id（留空位按它寻址绑定；普通选取式条款不需要）。 */
export function allocTermId(existing: ValueTerm[]): string {
  const used = new Set(existing.map((t) => t.id).filter(Boolean))
  let i = existing.length
  let id = `t${i}`
  while (used.has(id)) {
    i += 1
    id = `t${i}`
  }
  return id
}

export function emptyPickTerm(
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
  op: ValueTermOp = '-',
): ValueTerm {
  const ents = listEntityOptions(entities)
  if (ents[0]) {
    const ent = findEntity(entities, ents[0].id)
    const attrs = listAttrOptions(ent)
    return { op, source: 'entity', refId: ents[0].id, attr: attrs[0]?.id ?? 'hp' }
  }
  const vars = listVarOptions(variables, { numbersOnly: true })
  if (vars[0]) return { op, source: 'var', refId: vars[0].id }
  return { op, source: 'const', refId: '', constValue: 1 }
}

function asValuePick(stored: unknown): ValuePick | undefined {
  if (!stored || typeof stored !== 'object') return undefined
  const m = (stored as ValuePick).mode
  if (m === 'const') {
    const c = (stored as { const?: unknown }).const
    return { mode: 'const', const: typeof c === 'number' ? c : 0 }
  }
  if (m === 'pick') {
    const terms = (stored as { terms?: ValueTerm[] }).terms
    if (Array.isArray(terms) && terms.length > 0) {
      return { mode: 'pick', terms: normalizeTerms(terms) }
    }
  }
  if (m === 'formula') {
    const formulaId = (stored as { formulaId?: unknown }).formulaId
    const holeBindings = (stored as { holeBindings?: unknown }).holeBindings
    if (typeof formulaId === 'string' && holeBindings && typeof holeBindings === 'object') {
      return { mode: 'formula', formulaId, holeBindings: holeBindings as Record<string, FormulaHoleBinding> }
    }
  }
  return undefined
}

/** 从 NumOrExpr / 独立 sidecar 恢复选取态（优先 sidecar → value.pick → 常量 / 空行）。 */
export function resolveValuePick(
  value: NumOrExpr | undefined,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
  storedPick?: unknown,
): ValuePick {
  const fromStored = asValuePick(storedPick)
  if (fromStored) return fromStored
  if (value && typeof value === 'object' && value.pick) {
    const fromEmbedded = asValuePick(value.pick)
    if (fromEmbedded) return fromEmbedded
  }
  // 常量保留正负号（结算扣血写 -10 等）；旧 Math.abs 会在回填时把负数抹成正数，输入框无法留下负号。
  if (typeof value === 'number') return { mode: 'const', const: value }
  return { mode: 'pick', terms: [emptyPickTerm(entities, variables)] }
}
