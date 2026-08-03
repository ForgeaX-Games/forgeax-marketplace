/**
 * 场景 meta 目录 —— 实体 / 属性 / 变量下拉选项（展示名称，写入 id）。
 * 新数据格式：EntitySpec→Entity、VarSpec→Variable（Variable 不再有 number/flag 之分）。
 */
import type { Entity, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'

export function findEntity(
  entities: Record<string, Entity> | undefined,
  id: string,
): Entity | undefined {
  if (!entities || !id) return undefined
  if (entities[id]) return entities[id]
  return Object.values(entities).find((e) => e.id === id)
}

export function listEntityOptions(
  entities: Record<string, Entity> | undefined,
): Array<{ id: string; label: string }> {
  return Object.entries(entities ?? {}).map(([key, e]) => {
    const id = e.id ?? key
    const name = (e.name ?? '').trim()
    const kind = (e.kind ?? '').trim()
    const label = name ? `${name}（${id}）` : kind ? `${kind} · ${id}` : id
    return { id, label }
  })
}

export function listAttrOptions(ent: Entity | undefined): Array<{ id: string; label: string }> {
  if (!ent) return []
  const keys = new Set<string>([
    ...Object.keys(ent.attrs ?? {}),
    ...Object.keys(ent.attrMeta ?? {}),
  ])
  return [...keys].sort().map((id) => {
    const label = ent.attrMeta?.[id]?.label?.trim()
    return { id, label: label ? `${label}（${id}）` : id }
  })
}

/**
 * 变量下拉。新数据格式的 Variable 不再区分 number/flag，`opts` 仅作调用点意图声明，
 * 目前一律返回全部变量（flag 语义交由使用处按值 true/false 处理）。
 */
export function listVarOptions(
  variables: Record<string, Variable> | undefined,
  _opts?: { flagsOnly?: boolean; numbersOnly?: boolean },
): Array<{ id: string; label: string }> {
  return Object.entries(variables ?? {}).map(([key, v]) => {
    const id = v.id ?? key
    const name = (v.name ?? '').trim()
    return { id, label: name ? `${name}（${id}）` : id }
  })
}

/** 公式下拉（应用公式时选具名公式）。 */
export function listFormulaOptions(
  formulas: Record<string, Formula> | undefined,
): Array<{ id: string; label: string }> {
  return Object.entries(formulas ?? {}).map(([key, f]) => {
    const id = f.id ?? key
    const name = (f.name ?? '').trim()
    return { id, label: name ? `${name}（${id}）` : id }
  })
}

export function findFormula(
  formulas: Record<string, Formula> | undefined,
  id: string,
): Formula | undefined {
  if (!formulas || !id) return undefined
  if (formulas[id]) return formulas[id]
  return Object.values(formulas).find((f) => f.id === id)
}
