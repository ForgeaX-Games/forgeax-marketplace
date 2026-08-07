/**
 * 场景 meta 目录 —— 实体 / 属性 / 变量下拉选项（展示名称，写入 id）。
 * 新数据格式：EntitySpec→Entity、VarSpec→Variable（Variable 不再有 number/flag 之分）。
 */
import { isNumericScalar, type AttrMeta, type Entity, type Variable } from '../../runtime/schema/graph-schema'
import {
  parseFormulaAuthoringText,
  type Formula,
  type FormulaAstNode,
} from '../persist/formula-authoring'
import { authoringOptionLabel } from '../authoring-option-label'

export interface EntityAttributeCreateRequest {
  entityId: string
  attrId: string
  initialValue: number
  meta?: AttrMeta
}

export interface EntityCreateRequest {
  entityId: string
  name: string
  kind?: string
}

export interface VariableCreateRequest {
  variableId: string
  name: string
  initialValue: number
}

export interface FormulaCreateRequest {
  formulaId: string
  name: string
  ast: FormulaAstNode
}

export function catalogIdOccupied(
  catalog: Record<string, { id?: string }> | undefined,
  id: string,
): boolean {
  return Object.entries(catalog ?? {}).some(([key, item]) => key === id || item.id === id)
}

export function nextCatalogId(
  prefix: string,
  catalog: Record<string, { id?: string }> | undefined,
): string {
  let index = Object.keys(catalog ?? {}).length
  let id = `${prefix}${index}`
  while (catalogIdOccupied(catalog, id)) {
    index += 1
    id = `${prefix}${index}`
  }
  return id
}

export function nextAvailableCatalogId(
  requestedId: string,
  catalog: Record<string, { id?: string }> | undefined,
): string {
  if (!catalogIdOccupied(catalog, requestedId)) return requestedId
  let index = 2
  let id = `${requestedId}${index}`
  while (catalogIdOccupied(catalog, id)) {
    index += 1
    id = `${requestedId}${index}`
  }
  return id
}

export function ensureEntity(
  entities: Record<string, Entity> | undefined,
  request: EntityCreateRequest,
): Record<string, Entity> {
  const current = entities ?? {}
  const existing = Object.entries(current).find(([key, entity]) =>
    key === request.entityId || entity.id === request.entityId)
  if (existing) return current

  return {
    ...current,
    [request.entityId]: {
      id: request.entityId,
      name: request.name,
      ...(request.kind ? { kind: request.kind } : {}),
      attrs: {},
      attrMeta: {},
    },
  }
}

export function ensureVariable(
  variables: Record<string, Variable> | undefined,
  request: VariableCreateRequest,
): Record<string, Variable> {
  const current = variables ?? {}
  if (catalogIdOccupied(current, request.variableId)) return current

  return {
    ...current,
    [request.variableId]: {
      id: request.variableId,
      name: request.name,
      initial: request.initialValue,
    },
  }
}

export function formulaFromCreateRequest(request: FormulaCreateRequest): Formula {
  return {
    id: request.formulaId,
    name: request.name,
    ast: request.ast,
  }
}

export function parseFormulaCreateContent(
  content: string,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): FormulaAstNode {
  return parseFormulaAuthoringText(content, { entities, variables })
}

export function ensureFormula(
  formulas: Record<string, Formula> | undefined,
  request: FormulaCreateRequest,
): Record<string, Formula> {
  const current = formulas ?? {}
  if (catalogIdOccupied(current, request.formulaId)) return current

  return {
    ...current,
    [request.formulaId]: formulaFromCreateRequest(request),
  }
}

export function ensureEntityAttribute(
  entities: Record<string, Entity> | undefined,
  request: EntityAttributeCreateRequest,
): Record<string, Entity> | undefined {
  if (!entities) return entities
  const entry = Object.entries(entities).find(([key, entity]) =>
    key === request.entityId || entity.id === request.entityId)
  if (!entry) return entities

  const [key, entity] = entry
  if (
    Object.hasOwn(entity.attrs ?? {}, request.attrId)
    || Object.hasOwn(entity.attrMeta ?? {}, request.attrId)
  ) {
    return entities
  }

  const attrMeta = request.meta
    ? { ...entity.attrMeta, [request.attrId]: request.meta }
    : entity.attrMeta
  return {
    ...entities,
    [key]: {
      ...entity,
      attrs: { ...entity.attrs, [request.attrId]: request.initialValue },
      ...(attrMeta ? { attrMeta } : {}),
    },
  }
}

export function findEntity(
  entities: Record<string, Entity> | undefined,
  id: string,
): Entity | undefined {
  if (!entities || !id) return undefined
  if (entities[id]) return entities[id]
  return Object.values(entities).find((e) => e.id === id)
}

export function entityDisplayName(entity: Entity | undefined, fallbackId: string): string {
  const name = entity?.name?.trim()
  const kind = entity?.kind?.trim()
  return name || kind || fallbackId
}

export function attrDisplayName(entity: Entity | undefined, attrId: string): string {
  return entity?.attrMeta?.[attrId]?.label?.trim() || attrId
}

export function attrValueText(entity: Entity | undefined, attrId: string): string {
  return String(entity?.attrs?.[attrId] ?? entity?.attrMeta?.[attrId]?.initial ?? 0)
}

export function variableDisplayName(variable: Variable | undefined, fallbackId: string): string {
  return variable?.name?.trim() || fallbackId
}

export function formulaDisplayName(formula: Formula | undefined, fallbackId: string): string {
  return formula?.name?.trim() || fallbackId
}

export function listEntityOptions(
  entities: Record<string, Entity> | undefined,
): Array<{ id: string; label: string }> {
  return Object.entries(entities ?? {}).map(([key, e]) => {
    const id = e.id ?? key
    const name = (e.name ?? '').trim()
    const kind = (e.kind ?? '').trim()
    const label = name ? authoringOptionLabel(name, id) : kind ? `${kind} · ${id}` : id
    return { id, label }
  })
}

export function listAttrOptions(
  ent: Entity | undefined,
  opts?: { numbersOnly?: boolean },
): Array<{ id: string; label: string }> {
  if (!ent) return []
  const keys = new Set<string>([
    ...Object.keys(ent.attrs ?? {}),
    ...Object.keys(ent.attrMeta ?? {}),
  ])
  const ids = [...keys]
  const filtered = opts?.numbersOnly
    ? ids.filter((id) => {
      const current = ent.attrs?.[id]
      return current === undefined
        ? ent.attrMeta?.[id] !== undefined
        : isNumericScalar(current)
    })
    : ids
  return filtered.sort().map((id) => {
    const label = ent.attrMeta?.[id]?.label?.trim()
    return { id, label: authoringOptionLabel(label, id) }
  })
}

/**
 * 变量下拉。新数据格式不再声明独立类型；numbersOnly 排除已知字符串初值，
 * 未设置初值的旧变量继续保留，避免仅因缺少元数据而丢失合法数值引用。
 */
export function listVarOptions(
  variables: Record<string, Variable> | undefined,
  opts?: { flagsOnly?: boolean; numbersOnly?: boolean },
): Array<{ id: string; label: string }> {
  return Object.entries(variables ?? {}).filter(([, variable]) => (
    !opts?.numbersOnly
    || variable.initial === undefined
    || isNumericScalar(variable.initial)
  )).map(([key, v]) => {
    const id = v.id ?? key
    const name = (v.name ?? '').trim()
    return { id, label: authoringOptionLabel(name, id) }
  })
}

/** 公式下拉（应用公式时选具名公式）。 */
export function listFormulaOptions(
  formulas: Record<string, Formula> | undefined,
): Array<{ id: string; label: string }> {
  return Object.entries(formulas ?? {}).map(([key, f]) => {
    const id = f.id ?? key
    const name = (f.name ?? '').trim()
    return { id, label: authoringOptionLabel(name, id) }
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
