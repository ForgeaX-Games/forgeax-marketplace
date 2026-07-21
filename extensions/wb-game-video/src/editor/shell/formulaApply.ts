/**
 * 公式（Formula）编译 / 回填 —— 把「公式定义 + 留空位绑定」编译成具体 NumOrExpr，并在公式库
 * 变化时批量回溯刷新所有已应用处的 expr 缓存。
 *
 * 设计：公式定义 + 每处应用的 holeBindings 是 SSOT；写进字段的 `expr` 字符串是**派生缓存**，
 * 由 `compileFormula`/`recompileFormulaUsages` 这两个纯函数算出来。`runtime/engine/expr.ts`
 * 全程不知道"公式"这个概念，只读普通表达式字符串——回溯刷新完全是编辑器侧的一次性数据变换。
 */
import type {
  Entity,
  NumOrExpr,
  ValueTermOp,
  Variable,
} from '../../runtime/schema/graph-schema'
import type { EditorValueTerm, Formula, FormulaHoleBinding, FormulaPick } from '../persist/formula-authoring'
import {
  VALUE_TERM_OP_LABEL,
  compileValuePick,
  findEntity,
  listAttrOptions,
  listVarOptions,
} from './valueExprPick'

export interface FormulaHole {
  /** 稳定寻址键，对应 holeBindings 的 key（= 该条款的 ValueTerm.id，缺失时按下标兜底）。 */
  termId: string
  index: number
  /** 作者预置的约定属性名（留空表示应用时直接取所选实体的第一个属性）。 */
  suggestedAttr?: string
}

function termKey(t: EditorValueTerm, index: number): string {
  return t.id ?? `t${index}`
}

/** 未知实体留空位 —— 本期唯一支持的公式留空类型：`source==='entity' && refId===''`。 */
function isHoleTerm(t: EditorValueTerm): boolean {
  return t.source === 'entity' && !t.refId
}

/** 扫描公式条款，列出全部留空位（应用公式时据此渲染填空控件）。 */
export function formulaHoles(formula: Formula): FormulaHole[] {
  return formula.terms
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => isHoleTerm(t))
    .map(({ t, index }) => ({ termId: termKey(t, index), index, suggestedAttr: t.attr }))
}

/** 尚未绑定实体的留空位；调用方据此阻止把半成品误当完整公式。 */
export function missingFormulaHoles(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding>,
): FormulaHole[] {
  return formulaHoles(formula).filter((hole) => !holeBindings[hole.termId]?.entityId)
}

/** 把 holeBindings 套回对应留空位，产出具体（或仍不完整）的条款链。 */
function resolveFormulaTerms(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding>,
  entities: Record<string, Entity> | undefined,
): EditorValueTerm[] {
  return formula.terms.map((t, index) => {
    if (!isHoleTerm(t)) return t
    const binding = holeBindings[termKey(t, index)]
    if (!binding?.entityId) return t // 仍未填 -> 保持不完整，compileValuePick 的 atomComplete 会把它滤掉
    const ent = findEntity(entities, binding.entityId)
    const attrs = listAttrOptions(ent)
    const attr = binding.attr && attrs.some((a) => a.id === binding.attr)
      ? binding.attr
      : (t.attr && attrs.some((a) => a.id === t.attr) ? t.attr : attrs[0]?.id)
    return { ...t, refId: binding.entityId, attr }
  })
}

function termOpOf(t: EditorValueTerm): ValueTermOp {
  return t.op === '+' || t.op === '-' || t.op === '*' || t.op === '/' ? t.op : '+'
}

/** 条款只读预览文案（公式定义列表 / 应用公式时的只读展示共用）：留空位标「❓待填实体」。 */
export function formulaTermLabel(
  t: EditorValueTerm,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): string {
  const opLabel = VALUE_TERM_OP_LABEL[termOpOf(t)]
  if (t.source === 'const') return `${opLabel} ${t.constValue ?? 0}`
  if (t.source === 'var') {
    const v = listVarOptions(variables).find((o) => o.id === t.refId)
    return `${opLabel} ${v?.label ?? t.refId ?? '变量'}`
  }
  if (isHoleTerm(t)) return `${opLabel} ❓待填实体${t.attr ? `·约定属性「${t.attr}」` : ''}`
  const ent = findEntity(entities, t.refId)
  const entLabel = ent?.name?.trim() || ent?.id || t.refId
  const attrLabel = ent ? listAttrOptions(ent).find((a) => a.id === t.attr)?.label ?? t.attr : t.attr
  return `${opLabel} ${entLabel}·${attrLabel ?? ''}`
}

export function formulaTermsPreview(
  terms: EditorValueTerm[],
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): string {
  if (terms.length === 0) return '（空）'
  return terms.map((t) => formulaTermLabel(t, entities, variables)).join(' ')
}

/** 编译一次「应用公式」：具体 NumOrExpr + 编辑器专属的 formula pick sidecar。 */
export function compileFormula(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding>,
  entities: Record<string, Entity> | undefined,
): NumOrExpr {
  const terms = resolveFormulaTerms(formula, holeBindings, entities)
  const compiled = compileValuePick({ mode: 'pick', terms })
  const expr = typeof compiled === 'number' ? String(compiled) : compiled.expr
  return { expr, pick: { mode: 'formula', formulaId: formula.id, holeBindings } as unknown as FormulaPick } as unknown as NumOrExpr
}

interface FormulaPickNode {
  expr: string
  pick: FormulaPick
}

function asFormulaPickNode(v: unknown): FormulaPickNode | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.expr !== 'string') return undefined
  const p = o.pick
  if (!p || typeof p !== 'object') return undefined
  const pm = p as Record<string, unknown>
  if (pm.mode !== 'formula' || typeof pm.formulaId !== 'string' || typeof pm.holeBindings !== 'object' || !pm.holeBindings) {
    return undefined
  }
  return { expr: o.expr, pick: { mode: 'formula', formulaId: pm.formulaId, holeBindings: pm.holeBindings as Record<string, FormulaHoleBinding> } }
}

/**
 * 深度遍历任意可序列化值（scenario/graph 的 JSON 树），把所有形如
 * `{ expr, pick: {mode:'formula', formulaId, holeBindings} }` 的节点按公式库**当前**定义重新编译。
 * - 公式已被删除 → 原样保留旧 `expr`（不报错、不清空）。
 * - 没变化的分支保持原对象引用（避免无谓的 zundo 历史抖动 / 无意义的 re-render）。
 * - 结构无关：不管这个形状此刻藏在 Effect.value、numberExpr 组件输入还是别的地方都会命中，
 *   不用逐个字段枚举，未来新增的数值字段天然也被覆盖。
 */
export function recompileFormulaUsages<T>(
  tree: T,
  formulas: Record<string, Formula> | undefined,
  entities: Record<string, Entity> | undefined,
): T {
  if (!formulas || Object.keys(formulas).length === 0) return tree
  function walk(v: unknown): unknown {
    const node = asFormulaPickNode(v)
    if (node) {
      const formula = formulas![node.pick.formulaId]
      if (!formula) return v
      const next = compileFormula(formula, node.pick.holeBindings, entities)
      const nextExpr = typeof next === 'number' ? String(next) : next.expr
      return nextExpr === node.expr ? v : next
    }
    if (Array.isArray(v)) {
      let changed = false
      const out = v.map((item) => {
        const nv = walk(item)
        if (nv !== item) changed = true
        return nv
      })
      return changed ? out : v
    }
    if (v && typeof v === 'object') {
      let changed = false
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const nv = walk(val)
        if (nv !== val) changed = true
        out[k] = nv
      }
      return changed ? out : v
    }
    return v
  }
  return walk(tree) as T
}
