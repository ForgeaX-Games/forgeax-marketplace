import { useState, type CSSProperties } from 'react'
import type { Entity, NumOrExpr, Variable } from '../../runtime/schema/graph-schema'
import type { Formula, FormulaHoleBinding } from '../persist/formula-authoring'
import { CascadingPicker, type CascadingPickerOption } from './CascadingPicker'
import { FormulaApplyEditor } from './FormulaApplyEditor'
import { compileFormula } from './formulaApply'
import type {
  ValueExprAttributeCreateConfig,
  ValueExprEntityCreateConfig,
  ValueExprFormulaCreateConfig,
  ValueExprVariableCreateConfig,
} from './ValueExprEditor'
import {
  attrDisplayName,
  catalogIdOccupied,
  entityDisplayName,
  findEntity,
  findFormula,
  formulaFromCreateRequest,
  formulaDisplayName,
  listAttrOptions,
  listEntityOptions,
  listFormulaOptions,
  listVarOptions,
  nextAvailableCatalogId,
  nextCatalogId,
  parseFormulaCreateContent,
  type EntityAttributeCreateRequest,
  type FormulaCreateRequest,
  type VariableCreateRequest,
  variableDisplayName,
} from './metaCatalog'

export type TextOrRef = string | number | { ref: string } | NumOrExpr

const row: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'nowrap',
  width: '100%',
  minWidth: 0,
}

function entityNameKey(id: string): string {
  return `entity-name:${encodeURIComponent(id)}`
}

interface EntityCreateDraft {
  entityId: string
  name: string
}

interface AttributeCreateDraft {
  attrId: string
  label: string
  initialValue: string
}

interface VariableCreateDraft {
  variableId: string
  name: string
  initialValue: string
}

interface FormulaCreateDraft {
  formulaId: string
  name: string
  content: string
}

function parsedInitialValue(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function nextAvailableAttrId(entity: Entity | undefined, requestedId: string): string {
  const occupied = new Set([
    ...Object.keys(entity?.attrs ?? {}),
    ...Object.keys(entity?.attrMeta ?? {}),
  ])
  if (!occupied.has(requestedId)) return requestedId
  const suffix = /^(.*?)(\d+)$/.exec(requestedId)
  const prefix = suffix?.[1] ?? requestedId
  let index = suffix ? Number(suffix[2]) + 1 : 2
  while (occupied.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

function attributeIdOccupied(entity: Entity | undefined, attrId: string): boolean {
  return Object.hasOwn(entity?.attrs ?? {}, attrId)
    || Object.hasOwn(entity?.attrMeta ?? {}, attrId)
}

const ATTR_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

function formulaPick(value: TextOrRef | undefined): {
  formulaId: string
  holeBindings: Record<string, FormulaHoleBinding>
} | undefined {
  if (!value || typeof value !== 'object' || !('expr' in value)) return undefined
  const pick = (value as { pick?: unknown }).pick
  if (!pick || typeof pick !== 'object') return undefined
  const candidate = pick as Record<string, unknown>
  if (
    candidate.mode !== 'formula'
    || typeof candidate.formulaId !== 'string'
    || !candidate.holeBindings
    || typeof candidate.holeBindings !== 'object'
  ) {
    return undefined
  }
  return {
    formulaId: candidate.formulaId,
    holeBindings: candidate.holeBindings as Record<string, FormulaHoleBinding>,
  }
}

export function TextValueEditor({
  value,
  entities,
  variables,
  formulas,
  preferredEntityIds,
  entityNameOnly = false,
  createAttribute,
  createEntity,
  createVariable,
  createFormula,
  stackControls = false,
  onChange,
}: {
  value: TextOrRef | undefined
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  formulas?: Record<string, Formula>
  preferredEntityIds?: readonly string[]
  entityNameOnly?: boolean
  createAttribute?: ValueExprAttributeCreateConfig
  createEntity?: ValueExprEntityCreateConfig
  createVariable?: ValueExprVariableCreateConfig
  createFormula?: ValueExprFormulaCreateConfig
  stackControls?: boolean
  onChange: (next: TextOrRef) => void
}): JSX.Element {
  const [createDraft, setCreateDraft] = useState<EntityCreateDraft | null>(null)
  const [attributeCreateDrafts, setAttributeCreateDrafts] = useState<Record<string, AttributeCreateDraft>>({})
  const [variableCreateDrafts, setVariableCreateDrafts] = useState<Record<string, VariableCreateDraft>>({})
  const [formulaCreateDrafts, setFormulaCreateDrafts] = useState<Record<string, FormulaCreateDraft>>({})
  const entityRank = new Map((preferredEntityIds ?? []).map((id, index) => [id, index]))
  const orderedEntities = listEntityOptions(entities).sort((a, b) => {
    const rankA = entityRank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rankB = entityRank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return rankA - rankB
  })
  const entityNameChoices = orderedEntities.map((entity) => {
    const source = findEntity(entities, entity.id)
    return {
      key: entityNameKey(entity.id),
      label: entityDisplayName(source, entity.id),
      ref: `entity.${entity.id}.name`,
    }
  })
  const entityAttrChoicesByEntity = orderedEntities.map((entity) => {
    const source = findEntity(entities, entity.id)
    const entityName = entityDisplayName(source, entity.id)
    const choices = (entityNameOnly ? [] : listAttrOptions(source)).map((attr) => ({
      key: `entity-attr:${encodeURIComponent(entity.id)}:${encodeURIComponent(attr.id)}`,
      label: `${entityName}的${attrDisplayName(source, attr.id)}`,
      shortLabel: attrDisplayName(source, attr.id),
      ref: `entity.${entity.id}.attr.${attr.id}`,
    }))
    return { entity, entityName, choices }
  })
  const entityAttrChoices = entityAttrChoicesByEntity.flatMap((entry) => entry.choices)
  const variableChoices = (entityNameOnly ? [] : listVarOptions(variables)).map((variable) => ({
    key: `var:${encodeURIComponent(variable.id)}`,
    label: variableDisplayName(variables?.[variable.id], variable.id),
    ref: `var.${variable.id}`,
  }))
  const formulaChoices = (entityNameOnly ? [] : listFormulaOptions(formulas)).map((formula) => ({
    key: `formula:${encodeURIComponent(formula.id)}`,
    label: formulaDisplayName(findFormula(formulas, formula.id), formula.id),
    formulaId: formula.id,
  }))
  const stateChoices = [...entityNameChoices, ...entityAttrChoices, ...variableChoices]
  const appliedFormula = formulaPick(value)
  const ref = value && typeof value === 'object' && 'ref' in value ? value.ref : undefined
  const selected = appliedFormula
    ? `formula:${encodeURIComponent(appliedFormula.formulaId)}`
    : ref
      ? stateChoices.find((choice) => choice.ref === ref)?.key ?? 'unknown-ref'
      : value && typeof value === 'object'
        ? 'unknown-ref'
        : 'literal'
  const selectedChoice = stateChoices.find((choice) => choice.key === selected)
  const createEntityTemplate = createEntity
    ? createEntity.template ?? {
      entityId: nextCatalogId('entity', entities),
      name: '实体',
    }
    : undefined
  const defaultEntityId = createEntityTemplate
    ? nextAvailableCatalogId(createEntityTemplate.entityId, entities)
    : ''
  const createEntityKey = createEntityTemplate
    ? `create-entity:${encodeURIComponent(defaultEntityId)}`
    : ''
  const entityDraft = createEntityTemplate
    ? createDraft ?? {
      entityId: defaultEntityId,
      name: createEntityTemplate.name,
    }
    : undefined
  const attributeCreateActions = new Map<string, EntityAttributeCreateRequest>()
  const variableCreateActions = new Map<string, VariableCreateRequest>()
  const formulaCreateActions = new Map<string, FormulaCreateRequest>()
  const entityBranches: CascadingPickerOption[] = orderedEntities.map((entity) => {
    const source = findEntity(entities, entity.id)
    const entityNameChoice = entityNameChoices.find((choice) => choice.key === entityNameKey(entity.id))!
    const attrs = entityAttrChoicesByEntity.find((entry) => entry.entity.id === entity.id)?.choices ?? []
    const attributeTemplate = createAttribute
      ? createAttribute.template ?? {
        attrId: 'attr0',
        initialValue: 0,
        meta: { label: '属性', initial: 0 },
      }
      : undefined
    return {
      key: `entity:${encodeURIComponent(entity.id)}`,
      label: entityDisplayName(source, entity.id),
      children: [
        {
          key: entityNameChoice.key,
          label: '名称',
          value: entityNameChoice.key,
        },
        ...attrs.map((choice) => ({
          key: choice.key,
          label: choice.shortLabel,
          value: choice.key,
        })),
        ...(!entityNameOnly && createAttribute && attributeTemplate ? (() => {
          const defaultAttrId = nextAvailableAttrId(source, attributeTemplate.attrId)
          const draftKey = `create-text-attr:${encodeURIComponent(entity.id)}:${encodeURIComponent(defaultAttrId)}`
          const defaults: AttributeCreateDraft = {
            attrId: defaultAttrId,
            label: attributeTemplate.meta?.label ?? attributeTemplate.attrId,
            initialValue: String(attributeTemplate.initialValue),
          }
          const draft = { ...defaults, ...attributeCreateDrafts[draftKey] }
          const attrId = draft.attrId.trim()
          const initialValue = parsedInitialValue(draft.initialValue)
          const request: EntityAttributeCreateRequest = {
            ...attributeTemplate,
            entityId: entity.id,
            attrId,
            initialValue: initialValue ?? 0,
            meta: {
              ...attributeTemplate.meta,
              label: draft.label.trim() || undefined,
              initial: initialValue ?? 0,
            },
          }
          const actionKey = `${draftKey}:confirm`
          attributeCreateActions.set(actionKey, request)
          const patch = (change: Partial<AttributeCreateDraft>): void => {
            setAttributeCreateDrafts((current) => ({
              ...current,
              [draftKey]: { ...defaults, ...current[draftKey], ...change },
            }))
          }
          return [{
            key: `configure:${actionKey}`,
            presentation: 'create' as const,
            label: `配置「${draft.label.trim() || attrId || defaultAttrId}」属性`,
            children: [
              {
                key: `detail:${actionKey}:id`,
                label: '属性 ID',
                editor: {
                  value: draft.attrId,
                  ariaLabel: `${entityDisplayName(source, entity.id)}的新属性 ID`,
                  pattern: '[A-Za-z_][A-Za-z0-9_-]*',
                  invalid: !ATTR_ID_PATTERN.test(attrId) || attributeIdOccupied(source, attrId),
                  onChange: (value: string) => patch({ attrId: value }),
                },
              },
              {
                key: `detail:${actionKey}:label`,
                label: '显示名',
                editor: {
                  value: draft.label,
                  ariaLabel: `${entityDisplayName(source, entity.id)}的新属性显示名`,
                  onChange: (value: string) => patch({ label: value }),
                },
              },
              {
                key: `detail:${actionKey}:initial`,
                label: '初始值',
                editor: {
                  value: draft.initialValue,
                  ariaLabel: `${entityDisplayName(source, entity.id)}的新属性初始值`,
                  inputMode: 'decimal' as const,
                  invalid: initialValue === undefined,
                  onChange: (value: string) => patch({ initialValue: value }),
                },
              },
              {
                key: actionKey,
                label: '确认创建并选择',
                value: actionKey,
                presentation: 'confirm' as const,
                disabled: !ATTR_ID_PATTERN.test(attrId)
                  || attributeIdOccupied(source, attrId)
                  || initialValue === undefined,
              },
            ],
          }]
        })() : []),
      ],
    }
  })
  const createEntityOption: CascadingPickerOption | undefined =
    createEntity && createEntityTemplate && entityDraft
      ? {
        key: `configure:${createEntityKey}`,
        presentation: 'create' as const,
        label: `配置「${createEntityTemplate.name}」实体`,
        children: [
          {
            key: `detail:${createEntityKey}:id`,
            label: '实体 ID',
            editor: {
              value: entityDraft.entityId,
              ariaLabel: '新实体 ID',
              invalid: !entityDraft.entityId.trim()
                || catalogIdOccupied(entities, entityDraft.entityId.trim()),
              onChange: (entityId: string) => setCreateDraft({ ...entityDraft, entityId }),
            },
          },
          {
            key: `detail:${createEntityKey}:name`,
            label: '显示名',
            editor: {
              value: entityDraft.name,
              ariaLabel: '新实体显示名',
              onChange: (name: string) => setCreateDraft({ ...entityDraft, name }),
            },
          },
          {
            key: createEntityKey,
            label: '确认创建并选择',
            value: createEntityKey,
            presentation: 'confirm' as const,
            disabled: !entityDraft.entityId.trim()
              || catalogIdOccupied(entities, entityDraft.entityId.trim()),
          },
        ],
      }
      : undefined
  const pickerOptions: CascadingPickerOption[] = [
    ...(entityBranches.length > 0 || createEntityOption ? [{
      key: 'entity-values',
      label: '实体',
      children: [
        ...entityBranches,
        ...(createEntityOption ? [createEntityOption] : []),
      ],
    }] : []),
    ...(variableChoices.length > 0 || (!entityNameOnly && createVariable) ? [{
      key: 'variable-values',
      label: '变量',
      children: [
        ...variableChoices.map((choice) => ({
          key: choice.key,
          label: choice.label,
          value: choice.key,
        })),
        ...(!entityNameOnly && createVariable ? (() => {
          const defaultId = nextCatalogId('var', variables)
          const draftKey = `create-variable:${encodeURIComponent(defaultId)}`
          const defaults: VariableCreateDraft = {
            variableId: defaultId,
            name: defaultId,
            initialValue: '',
          }
          const draft = { ...defaults, ...variableCreateDrafts[draftKey] }
          const variableId = draft.variableId.trim()
          const initialValue = parsedInitialValue(draft.initialValue)
          const request: VariableCreateRequest = {
            variableId,
            name: draft.name.trim(),
            initialValue: initialValue ?? 0,
          }
          const actionKey = `${draftKey}:confirm`
          variableCreateActions.set(actionKey, request)
          const patch = (change: Partial<VariableCreateDraft>): void => {
            setVariableCreateDrafts((current) => ({
              ...current,
              [draftKey]: { ...defaults, ...current[draftKey], ...change },
            }))
          }
          return [{
            key: `configure:${actionKey}`,
            presentation: 'create' as const,
            label: `配置「${draft.name.trim() || variableId || defaultId}」变量`,
            children: [
              {
                key: `detail:${actionKey}:id`,
                label: '变量 ID',
                editor: {
                  value: draft.variableId,
                  ariaLabel: '新变量 ID',
                  invalid: !variableId || catalogIdOccupied(variables, variableId),
                  onChange: (value: string) => patch({ variableId: value }),
                },
              },
              {
                key: `detail:${actionKey}:name`,
                label: '显示名',
                editor: {
                  value: draft.name,
                  ariaLabel: '新变量显示名',
                  onChange: (value: string) => patch({ name: value }),
                },
              },
              {
                key: `detail:${actionKey}:initial`,
                label: '初始值',
                editor: {
                  value: draft.initialValue,
                  ariaLabel: '新变量初始值',
                  inputMode: 'decimal' as const,
                  invalid: initialValue === undefined,
                  onChange: (value: string) => patch({ initialValue: value }),
                },
              },
              {
                key: actionKey,
                label: '确认创建并选择',
                value: actionKey,
                presentation: 'confirm' as const,
                disabled: !variableId
                  || catalogIdOccupied(variables, variableId)
                  || initialValue === undefined,
              },
            ],
          }]
        })() : []),
      ],
    }] : []),
    ...(formulaChoices.length > 0 || (!entityNameOnly && createFormula) ? [{
      key: 'formula-values',
      label: '公式',
      children: [
        ...formulaChoices.map((choice) => ({
          key: choice.key,
          label: choice.label,
          value: choice.key,
        })),
        ...(!entityNameOnly && createFormula ? (() => {
          const defaultId = nextCatalogId('formula-', formulas)
          const draftKey = `create-formula:${encodeURIComponent(defaultId)}`
          const defaults: FormulaCreateDraft = {
            formulaId: defaultId,
            name: defaultId,
            content: '',
          }
          const draft = { ...defaults, ...formulaCreateDrafts[draftKey] }
          const formulaId = draft.formulaId.trim()
          let formulaAst: FormulaCreateRequest['ast'] | undefined
          let formulaError: string | undefined
          if (!draft.content.trim()) {
            formulaError = '请输入公式内容'
          } else {
            try {
              formulaAst = parseFormulaCreateContent(draft.content, entities, variables)
            } catch (error) {
              formulaError = error instanceof Error ? error.message : String(error)
            }
          }
          const request: FormulaCreateRequest | undefined = formulaAst
            ? { formulaId, name: draft.name.trim(), ast: formulaAst }
            : undefined
          const actionKey = `${draftKey}:confirm`
          if (request) formulaCreateActions.set(actionKey, request)
          const patch = (change: Partial<FormulaCreateDraft>): void => {
            setFormulaCreateDrafts((current) => ({
              ...current,
              [draftKey]: { ...defaults, ...current[draftKey], ...change },
            }))
          }
          return [{
            key: `configure:${actionKey}`,
            presentation: 'create' as const,
            label: `配置「${draft.name.trim() || formulaId || defaultId}」公式`,
            children: [
              {
                key: `detail:${actionKey}:id`,
                label: '公式 ID',
                editor: {
                  value: draft.formulaId,
                  ariaLabel: '新公式 ID',
                  invalid: !formulaId || catalogIdOccupied(formulas, formulaId),
                  onChange: (value: string) => patch({ formulaId: value }),
                },
              },
              {
                key: `detail:${actionKey}:name`,
                label: '显示名',
                editor: {
                  value: draft.name,
                  ariaLabel: '新公式显示名',
                  onChange: (value: string) => patch({ name: value }),
                },
              },
              {
                key: `detail:${actionKey}:content`,
                label: '公式内容',
                editor: {
                  value: draft.content,
                  ariaLabel: '新公式内容',
                  placeholder: '如：max(?攻击力 * ?倍率 - ?防御力, 0)',
                  multiline: true,
                  invalid: !formulaAst,
                  error: formulaError,
                  onChange: (value: string) => patch({ content: value }),
                },
              },
              {
                key: actionKey,
                label: '确认创建并选择',
                value: actionKey,
                presentation: 'confirm' as const,
                disabled: !formulaId
                  || catalogIdOccupied(formulas, formulaId)
                  || !formulaAst,
              },
            ],
          }]
        })() : []),
      ],
    }] : []),
    { key: 'literal', label: '常量', value: 'literal' },
  ]
  const selectedLabel = selected === 'unknown-ref'
    ? ''
    : selected === 'literal'
      ? '常量'
      : selectedChoice?.label
        ?? formulaChoices.find((choice) => choice.key === selected)?.label
        ?? ''

  function selectContent(key: string): void {
    if (createEntity && entityDraft && key === createEntityKey) {
      const entityId = entityDraft.entityId.trim()
      if (!entityId || catalogIdOccupied(entities, entityId)) return
      createEntity.onCreate({
        entityId,
        name: entityDraft.name.trim(),
      })
      onChange({ ref: `entity.${entityId}.name` })
      return
    }
    const attributeCreateRequest = attributeCreateActions.get(key)
    if (attributeCreateRequest && createAttribute) {
      createAttribute.onCreate(attributeCreateRequest)
      onChange({
        ref: `entity.${attributeCreateRequest.entityId}.attr.${attributeCreateRequest.attrId}`,
      })
      return
    }
    const variableCreateRequest = variableCreateActions.get(key)
    if (variableCreateRequest && createVariable) {
      createVariable.onCreate(variableCreateRequest)
      onChange({ ref: `var.${variableCreateRequest.variableId}` })
      return
    }
    const formulaCreateRequest = formulaCreateActions.get(key)
    if (formulaCreateRequest && createFormula) {
      createFormula.onCreate(formulaCreateRequest)
      onChange(compileFormula(formulaFromCreateRequest(formulaCreateRequest), {}, entities))
      return
    }
    if (key === 'literal') {
      onChange(typeof value === 'string' || typeof value === 'number' ? String(value) : '')
      return
    }
    const choice = stateChoices.find((item) => item.key === key)
    if (choice) {
      onChange({ ref: choice.ref })
      return
    }
    const formulaChoice = formulaChoices.find((item) => item.key === key)
    const formula = formulaChoice ? findFormula(formulas, formulaChoice.formulaId) : undefined
    if (formula) onChange(compileFormula(formula, {}, entities))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 }}>
      <div
        style={stackControls
          ? { ...row, flexDirection: 'column', alignItems: 'stretch' }
          : row}
      >
        <CascadingPicker
          ariaLabel="文本内容"
          value={selected}
          displayValue={selectedLabel}
          placeholder="文本：我方 · 状态：entity.hero.name / var.qi · 公式：伤害公式"
          options={pickerOptions}
          onSelect={selectContent}
          narrowSafe={stackControls}
        />
        {selected === 'literal' ? (
          <input
            aria-label="固定文本"
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
            placeholder="输入固定文本"
            onChange={(event) => onChange(event.target.value)}
            style={stackControls
              ? { flex: 'none', width: '100%', minWidth: 0, boxSizing: 'border-box' }
              : { flex: '0 1 40%', minWidth: 120, boxSizing: 'border-box' }}
          />
        ) : null}
      </div>
      {appliedFormula ? (
        <FormulaApplyEditor
          formulaId={appliedFormula.formulaId}
          holeBindings={appliedFormula.holeBindings}
          formulas={formulas}
          entities={entities}
          variables={variables}
          onChange={onChange}
          showFormulaPicker={false}
          createAttribute={createAttribute}
          createEntity={createEntity}
          createVariable={createVariable}
        />
      ) : null}
    </div>
  )
}
