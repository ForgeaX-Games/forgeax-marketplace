/**
 * 公式是编辑器作者态：运行时只执行已编译的表达式字符串。
 *
 * 公式引用仍以内嵌 `pick` 形式贴在数值字段旁，便于在任意图结构里跟随复制/删除；
 * 该结构是编辑器私有的扩展形状，runtime 不声明也不读取它。
 */
import type { GameScenario, ValueTerm } from '../../runtime/schema/graph-schema'

export type EditorValueTerm = ValueTerm & { id?: string }

export interface Formula {
  id: string
  name?: string
  description?: string
  terms: EditorValueTerm[]
}

export interface FormulaHoleBinding {
  entityId: string
  attr?: string
}

export interface FormulaPick {
  mode: 'formula'
  formulaId: string
  holeBindings: Record<string, FormulaHoleBinding>
}

/** 存储/草稿文档：公式与 entities / variables 同级；运行时 `GameScenario` 不声明它。 */
export interface EditorScenarioDocument extends GameScenario {
  formulas?: Record<string, Formula>
}

export function isFormulaPick(value: unknown): value is FormulaPick {
  if (!value || typeof value !== 'object') return false
  const pick = value as Record<string, unknown>
  return pick.mode === 'formula'
    && typeof pick.formulaId === 'string'
    && !!pick.holeBindings
    && typeof pick.holeBindings === 'object'
}

/** 兼容短暂使用过的 `editor.formulas` 格式，统一还原为顶层 formulas。 */
export function toEditorScenarioDocument(raw: GameScenario | null | undefined): EditorScenarioDocument | null {
  if (!raw) return null
  const legacy = raw as GameScenario & { formulas?: Record<string, Formula>; editor?: { formulas?: Record<string, Formula> } }
  const formulas = legacy.formulas ?? legacy.editor?.formulas
  const { formulas: _legacyFormulas, editor, ...scenario } = legacy
  return {
    ...scenario,
    ...(formulas ? { formulas } : {}),
  }
}

/** 执行前递归移除编辑器 sidecar，确保 runtime 只接收表达式源码。 */
export function toRuntimeScenario<T extends GameScenario>(scenario: T): GameScenario {
  function strip(value: unknown, root = false): unknown {
    if (Array.isArray(value)) return value.map((item) => strip(item))
    if (!value || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(source)) {
      if (root && key === 'formulas') continue
      // `pick` 是数值表达式作者态；不按字段名全局删除，避免误伤组件的同名 input。
      if (key === 'pick' && typeof source.expr === 'string') continue
      out[key] = strip(child)
    }
    return out
  }
  return strip(scenario, true) as GameScenario
}
