/**
 * 公式（Formula）编译 / 回填 —— 把「公式定义（AST）+ 留空位绑定」编译成具体 NumOrExpr，并在公式库
 * 变化时批量回溯刷新所有已应用处的 expr 缓存。
 *
 * 设计：公式定义（`Formula.ast`）+ 每处应用的 holeBindings 是 SSOT；写进字段的 `expr` 字符串是
 * **派生缓存**，由 `compileFormula`/`recompileFormulaUsages` 这两个纯函数算出来（内部走
 * `serializeFormula` → 运行时 `serializeExpr`，序列化只此一套）。`runtime/engine/expr.ts` 全程
 * 不知道"公式"这个概念，只读普通表达式字符串——回溯刷新完全是编辑器侧的一次性数据变换。
 */
import type { Entity, NumOrExpr } from '../../runtime/schema/graph-schema'
import type { Formula, FormulaAstNode, FormulaHoleBinding, FormulaHoleKind, FormulaPick } from '../persist/formula-authoring'
import { normalizeHoleBinding, previewFormula, serializeFormula } from '../persist/formula-authoring'
import { findEntity, listAttrOptions } from './metaCatalog'

export interface FormulaHole {
  /** 稳定寻址键 = 该 hole 节点的 holeId，对应 holeBindings 的 key。 */
  holeId: string
  kind: FormulaHoleKind
  label?: string
  /** entityAttr 空位作者预置的约定属性名（应用时缺省取所选实体该属性 / 第一个属性）。 */
  suggestAttr?: string
}

/** 深度遍历 AST 收集全部留空位（应用公式时据此渲染填空控件）。 */
export function formulaHoles(formula: Formula): FormulaHole[] {
  const out: FormulaHole[] = []
  const seen = new Set<string>()
  const walk = (n: FormulaAstNode): void => {
    switch (n.t) {
      case 'hole':
        if (!seen.has(n.holeId)) {
          seen.add(n.holeId)
          out.push({ holeId: n.holeId, kind: n.kind, label: n.label, suggestAttr: n.suggestAttr })
        }
        break
      case 'unary':
        walk(n.x)
        break
      case 'bin':
        walk(n.a)
        walk(n.b)
        break
      case 'call':
        n.args.forEach(walk)
        break
      default:
        break
    }
  }
  walk(formula.ast)
  return out
}

/** 判定一个绑定是否已「填够」（够 serializeFormula 产出具体值）。 */
function holeBound(hole: FormulaHole, binding: FormulaHoleBinding | undefined): boolean {
  if (!binding) return false
  if (binding.kind === 'number') return true
  if (binding.kind === 'var') return !!binding.varId
  return !!binding.entityId && (!!binding.attr || !!hole.suggestAttr)
}

/** 尚未填全的留空位；调用方据此阻止把半成品误当完整公式。 */
export function missingFormulaHoles(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding>,
): FormulaHole[] {
  return formulaHoles(formula).filter((hole) => !holeBound(hole, normalizeHoleBinding(holeBindings[hole.holeId])))
}

/** 只读预览文案（公式定义列表 / 应用公式时的只读展示共用）：未填空位标 ❓。 */
export function formulaPreview(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding> = {},
): string {
  return previewFormula(formula.ast, holeBindings)
}

/**
 * 归一 holeBindings：把旧形状 / 松散值转成 typed，并为 entityAttr 空位补默认属性
 * （binding.attr → suggestAttr → 实体首个属性）。
 */
function resolveBindings(
  formula: Formula,
  holeBindings: Record<string, unknown>,
  entities: Record<string, Entity> | undefined,
): Record<string, FormulaHoleBinding> {
  const holes = formulaHoles(formula)
  const out: Record<string, FormulaHoleBinding> = {}
  for (const hole of holes) {
    const b = normalizeHoleBinding(holeBindings[hole.holeId])
    if (!b) continue
    if (b.kind === 'entityAttr') {
      const attr = b.attr
        || hole.suggestAttr
        || listAttrOptions(findEntity(entities, b.entityId))[0]?.id
      out[hole.holeId] = { kind: 'entityAttr', entityId: b.entityId, attr }
    } else {
      out[hole.holeId] = b
    }
  }
  return out
}

/** 编译一次「应用公式」：具体 NumOrExpr + 编辑器专属的 formula pick sidecar。 */
export function compileFormula(
  formula: Formula,
  holeBindings: Record<string, unknown>,
  entities: Record<string, Entity> | undefined,
): NumOrExpr {
  const resolved = resolveBindings(formula, holeBindings, entities)
  const expr = serializeFormula(formula.ast, resolved) ?? '0'
  const pick: FormulaPick = { mode: 'formula', formulaId: formula.id, holeBindings: resolved }
  return { expr, pick } as unknown as NumOrExpr
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
