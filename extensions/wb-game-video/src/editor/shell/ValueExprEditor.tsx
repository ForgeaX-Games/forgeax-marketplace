/**
 * 通用数值表达式编辑器 —— 直接选择具体状态值或具名公式；固定值使用普通输入框。
 * 条款链（±×÷、留空实体）的编排完全收在「规则 → 公式」Tab（见 ScenarioInspector.tsx 的
 * FormulaRow + TermChainEditor）；这里不重复一份「当场拼公式」的入口——要用公式，先去规则页定义，
 * 再回这里选它、填空。
 */
import { useState, type CSSProperties } from 'react'
import type { Entity, NumOrExpr, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { CascadingPicker, type CascadingPickerOption } from './CascadingPicker'
import type { EntityAttributeCreateRequest, EntityCreateRequest } from './metaCatalog'
import { EffectOpButtons } from './OpSymbolButtons'
import { LooseNumberInput } from './TermChainEditor'
import { FormulaApplyEditor } from './FormulaApplyEditor'
import { compileFormula } from './formulaApply'
import {
  attrDisplayName,
  compileValuePick,
  entityDisplayName,
  findEntity,
  findFormula,
  formulaDisplayName,
  listAttrOptions,
  listEntityOptions,
  listFormulaOptions,
  listVarOptions,
  resolveValuePick,
  type EffectDisplayOp,
  type ValueExprInput,
  type ValuePick,
  variableDisplayName,
} from './valueExprPick'

const row: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'nowrap',
  width: '100%',
  minWidth: 0,
}
const fieldLabel: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }

type ContentChoice =
  | { key: 'const'; kind: 'const'; label: string }
  | { key: string; kind: 'entity'; label: string; entityId: string; attr: string }
  | { key: string; kind: 'var'; label: string; varId: string }
  | { key: string; kind: 'formula'; label: string; formulaId: string }

export interface ValueExprAttributeCreateConfig {
  template?: Omit<EntityAttributeCreateRequest, 'entityId'>
  onCreate: (request: EntityAttributeCreateRequest) => void
}

export interface ValueExprEntityCreateConfig {
  template?: EntityCreateRequest
  onCreate: (request: EntityCreateRequest) => void
}

function choiceKey(kind: 'entity' | 'var' | 'formula', ...parts: string[]): string {
  return `${kind}:${parts.map(encodeURIComponent).join(':')}`
}

function nextAvailableAttrId(entity: Entity | undefined, requestedId: string): string {
  const occupied = new Set([
    ...Object.keys(entity?.attrs ?? {}),
    ...Object.keys(entity?.attrMeta ?? {}),
  ])
  if (!occupied.has(requestedId)) return requestedId
  let index = 2
  while (occupied.has(`${requestedId}${index}`)) index += 1
  return `${requestedId}${index}`
}

const ATTR_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

interface CreateDraft {
  entityId: string
  entityName: string
  attrId: string
  attrLabel: string
  initialValue: string
}

function parsedInitialValue(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function attributeIdOccupied(entity: Entity | undefined, attrId: string): boolean {
  return Object.hasOwn(entity?.attrs ?? {}, attrId)
    || Object.hasOwn(entity?.attrMeta ?? {}, attrId)
}

export function ValueExprEditor({
  value,
  storedPick,
  entities,
  variables,
  formulas,
  onChange,
  onClear,
  emptyWhenUndefined = false,
  emptyLabel = '使用组件实时值',
  hintText,
  effectOp,
  preferredEntityIds,
  preferredAttrIds,
  allowAttribute,
  createAttribute,
  createEntity,
  fieldLabels,
}: {
  value: ValueExprInput | undefined
  storedPick?: unknown
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  /** 公式库（「规则 → 公式」维护）；非空时「应用公式」模式才可选。 */
  formulas?: Record<string, Formula>
  onChange: (next: NumOrExpr) => void
  onClear?: () => void
  /** 只把 undefined 显示为空态，不在菜单中提供清空选项。 */
  emptyWhenUndefined?: boolean
  emptyLabel?: string
  hintText?: string
  /** 组件语义上的首选实体，越靠前优先级越高。 */
  preferredEntityIds?: readonly string[]
  /** 组件字段语义上的首选属性，越靠前优先级越高。 */
  preferredAttrIds?: readonly string[]
  /** 逐实体限制属性候选；变量、公式和固定值仍按原能力提供。 */
  allowAttribute?: (entity: Entity | undefined, attrId: string) => boolean
  /** 某实体没有匹配属性时，在级联菜单内提供确认创建入口。 */
  createAttribute?: ValueExprAttributeCreateConfig
  /** 实体目录为空时，在级联菜单内提供确认创建入口。 */
  createEntity?: ValueExprEntityCreateConfig
  /** 挂了这个 = 这个值要配一个 Effect「运算」符号按钮，嵌进编辑器顶部（跟常量/应用公式同一行）。 */
  effectOp?: { op: EffectDisplayOp; onOpChange: (next: EffectDisplayOp) => void }
  /** Effect 表单使用显式字段名区分“取什么值”和“输入多少”，避免与目标实体属性混淆。 */
  fieldLabels?: { source: string; value: string }
}): JSX.Element {
  const [createDrafts, setCreateDrafts] = useState<Record<string, CreateDraft>>({})
  const createAttributeTemplate = createAttribute?.template
  const createEntityTemplate = createEntity?.template
  const draftFor = (key: string, defaults: CreateDraft): CreateDraft => ({
    ...defaults,
    ...createDrafts[key],
  })
  const patchDraft = (key: string, defaults: CreateDraft, patch: Partial<CreateDraft>): void => {
    setCreateDrafts((current) => ({
      ...current,
      [key]: { ...defaults, ...current[key], ...patch },
    }))
  }
  const pick = resolveValuePick(value, entities, variables, storedPick)
  const formulaOpts = listFormulaOptions(formulas)
  const directTerm = pick.mode === 'pick' ? pick.terms[0] : undefined
  const directBinding = pick.mode === 'pick'
    && pick.terms.length === 1
    && (directTerm?.source === 'entity' || directTerm?.source === 'var')
    && (directTerm.op === undefined || directTerm.op === '+' || directTerm.op === '*')
  const entityRank = new Map((preferredEntityIds ?? []).map((id, index) => [id, index]))
  const attrRank = new Map((preferredAttrIds ?? []).map((id, index) => [id, index]))
  const orderedEntities = listEntityOptions(entities).sort((a, b) => {
    const rankA = entityRank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rankB = entityRank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return rankA - rankB
  })
  const entityChoicesByEntity = orderedEntities.map((entity) => {
    const source = findEntity(entities, entity.id)
    const entityName = entityDisplayName(source, entity.id)
    const choices: ContentChoice[] = listAttrOptions(source)
      .filter((attr) => !allowAttribute || allowAttribute(source, attr.id))
      .sort((a, b) => {
        const rankA = attrRank.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const rankB = attrRank.get(b.id) ?? Number.MAX_SAFE_INTEGER
        if (rankA !== rankB) return rankA - rankB
        return attrDisplayName(source, a.id).localeCompare(attrDisplayName(source, b.id), 'zh-CN')
      })
      .map((attr) => ({
        key: choiceKey('entity', entity.id, attr.id),
        kind: 'entity' as const,
        label: `${entityName}的${attrDisplayName(source, attr.id)}`,
        entityId: entity.id,
        attr: attr.id,
      }))
    return { entity, entityName, source, choices }
  })
  const entityChoices = entityChoicesByEntity.flatMap((entry) => entry.choices)
  const createActions = new Map<string, {
    entityRequest?: EntityCreateRequest
    attributeRequest: EntityAttributeCreateRequest
    selectedValue: NumOrExpr
  }>()
  const variableChoices: ContentChoice[] = listVarOptions(variables).map((variable) => ({
    key: choiceKey('var', variable.id),
    kind: 'var',
    label: variableDisplayName(variables?.[variable.id], variable.id),
    varId: variable.id,
  }))
  const formulaChoices: ContentChoice[] = formulaOpts.map((formula) => ({
    key: choiceKey('formula', formula.id),
    kind: 'formula',
    label: formulaDisplayName(findFormula(formulas, formula.id), formula.id),
    formulaId: formula.id,
  }))
  const choices: ContentChoice[] = [
    { key: 'const', kind: 'const', label: '常量' },
    ...entityChoices,
    ...variableChoices,
    ...formulaChoices,
  ]
  const empty = value === undefined && (onClear != null || emptyWhenUndefined)
  const selectedKey = empty
    ? 'empty'
    : pick.mode === 'const'
    ? 'const'
    : pick.mode === 'formula'
      ? choiceKey('formula', pick.formulaId)
      : directBinding && directTerm?.source === 'entity'
        ? choiceKey('entity', directTerm.refId, directTerm.attr ?? '')
        : directBinding && directTerm?.source === 'var'
          ? choiceKey('var', directTerm.refId)
          : 'legacy'
  const selectedKnown = selectedKey === 'empty' || choices.some((choice) => choice.key === selectedKey)
  const selectedChoice = choices.find((choice) => choice.key === selectedKey)
  const missingEntityAction = orderedEntities.length === 0
    && createEntity
    && createEntityTemplate
    && createAttribute
    && createAttributeTemplate
    ? (() => {
      const draftKey = `create-entity:${encodeURIComponent(createEntityTemplate.entityId)}:${encodeURIComponent(createAttributeTemplate.attrId)}`
      const defaults: CreateDraft = {
        entityId: createEntityTemplate.entityId,
        entityName: createEntityTemplate.name,
        attrId: createAttributeTemplate.attrId,
        attrLabel: createAttributeTemplate.meta?.label ?? createAttributeTemplate.attrId,
        initialValue: String(createAttributeTemplate.initialValue),
      }
      const draft = draftFor(draftKey, defaults)
      const initialValue = parsedInitialValue(draft.initialValue)
      const entityId = draft.entityId.trim()
      const attrId = draft.attrId.trim()
      const attributeRequest: EntityAttributeCreateRequest = {
        ...createAttributeTemplate,
        entityId,
        attrId,
        initialValue: initialValue ?? 0,
        meta: {
          ...createAttributeTemplate.meta,
          label: draft.attrLabel.trim() || undefined,
          initial: initialValue ?? 0,
        },
      }
      const entityRequest: EntityCreateRequest = {
        entityId,
        name: draft.entityName.trim(),
      }
      const candidate: Entity = {
        id: entityId,
        name: entityRequest.name,
        attrs: { [attrId]: attributeRequest.initialValue },
        attrMeta: { [attrId]: attributeRequest.meta ?? {} },
      }
      const valid = !!entityId
        && ATTR_ID_PATTERN.test(attrId)
        && initialValue !== undefined
        && (!allowAttribute || allowAttribute(candidate, attrId))
      const actionKey = `${draftKey}:confirm`
      createActions.set(actionKey, {
        entityRequest,
        attributeRequest,
        selectedValue: compileValuePick({
          mode: 'pick',
          terms: [{
            op: '+',
            source: 'entity',
            refId: entityId,
            attr: attrId,
          }],
        }),
      })
      return {
        key: 'entity-values',
        label: '实体属性',
        children: [{
          key: `configure:${actionKey}`,
          label: `配置「${draft.entityName.trim() || createEntityTemplate.name}」实体`,
          children: [
            {
              key: `detail:${actionKey}:entity-id`,
              label: '实体 ID',
              editor: {
                value: draft.entityId,
                ariaLabel: '新实体 ID',
                invalid: !entityId,
                onChange: (value: string) => patchDraft(draftKey, defaults, { entityId: value }),
              },
            },
            {
              key: `detail:${actionKey}:entity-name`,
              label: '实体显示名',
              editor: {
                value: draft.entityName,
                ariaLabel: '新实体显示名',
                onChange: (value: string) => patchDraft(draftKey, defaults, { entityName: value }),
              },
            },
            {
              key: `detail:${actionKey}:id`,
              label: '属性 ID',
              editor: {
                value: draft.attrId,
                ariaLabel: '新属性 ID',
                pattern: '[A-Za-z_][A-Za-z0-9_-]*',
                invalid: !ATTR_ID_PATTERN.test(attrId),
                onChange: (value: string) => patchDraft(draftKey, defaults, { attrId: value }),
              },
            },
            {
              key: `detail:${actionKey}:label`,
              label: '属性显示名',
              editor: {
                value: draft.attrLabel,
                ariaLabel: '新属性显示名',
                invalid: !!allowAttribute && !allowAttribute(candidate, attrId),
                onChange: (value: string) => patchDraft(draftKey, defaults, { attrLabel: value }),
              },
            },
            {
              key: `detail:${actionKey}:initial`,
              label: '初始值',
              editor: {
                value: draft.initialValue,
                ariaLabel: '新属性初始值',
                inputMode: 'decimal' as const,
                invalid: initialValue === undefined,
                onChange: (value: string) => patchDraft(draftKey, defaults, { initialValue: value }),
              },
            },
            {
              key: actionKey,
              label: '确认创建并选择',
              value: actionKey,
              presentation: 'confirm' as const,
              disabled: !valid,
            },
          ],
        }],
      }
    })()
    : undefined
  const pickerOptions: CascadingPickerOption[] = [
    ...(missingEntityAction ? [missingEntityAction] : []),
    ...(orderedEntities.length > 0 && (entityChoices.length > 0 || createAttributeTemplate) ? [{
      key: 'entity-values',
      label: '实体属性',
      children: entityChoicesByEntity
        .filter((entry) => entry.choices.length > 0 || createAttributeTemplate)
        .map((entry) => ({
          key: `entity:${encodeURIComponent(entry.entity.id)}`,
          label: entry.entityName,
          children: [
            ...entry.choices.map((choice) => ({
              key: choice.key,
              label: choice.kind === 'entity'
                ? attrDisplayName(entry.source, choice.attr)
                : choice.label,
              value: choice.key,
            })),
            ...(entry.choices.length === 0 && createAttribute && createAttributeTemplate
              ? (() => {
                const draftKey = `create-attr:${encodeURIComponent(entry.entity.id)}:${encodeURIComponent(createAttributeTemplate.attrId)}`
                const defaults: CreateDraft = {
                  entityId: entry.entity.id,
                  entityName: entry.entityName,
                  attrId: nextAvailableAttrId(entry.source, createAttributeTemplate.attrId),
                  attrLabel: createAttributeTemplate.meta?.label ?? createAttributeTemplate.attrId,
                  initialValue: String(createAttributeTemplate.initialValue),
                }
                const draft = draftFor(draftKey, defaults)
                const initialValue = parsedInitialValue(draft.initialValue)
                const attrId = draft.attrId.trim()
                const request: EntityAttributeCreateRequest = {
                  ...createAttributeTemplate,
                  entityId: entry.entity.id,
                  attrId,
                  initialValue: initialValue ?? 0,
                  meta: {
                    ...createAttributeTemplate.meta,
                    label: draft.attrLabel.trim() || undefined,
                    initial: initialValue ?? 0,
                  },
                }
                const candidate: Entity = {
                  ...(entry.source ?? { id: entry.entity.id }),
                  attrs: { ...entry.source?.attrs, [attrId]: request.initialValue },
                  attrMeta: { ...entry.source?.attrMeta, [attrId]: request.meta ?? {} },
                }
                const valid = ATTR_ID_PATTERN.test(attrId)
                  && !attributeIdOccupied(entry.source, attrId)
                  && initialValue !== undefined
                  && (!allowAttribute || allowAttribute(candidate, attrId))
                const actionKey = `${draftKey}:confirm`
                createActions.set(actionKey, {
                  attributeRequest: request,
                  selectedValue: compileValuePick({
                    mode: 'pick',
                    terms: [{ op: '+', source: 'entity', refId: entry.entity.id, attr: request.attrId }],
                  }),
                })
                return [{
                  key: `configure:${actionKey}`,
                  label: `配置「${draft.attrLabel.trim() || request.attrId}」属性`,
                  children: [
                    {
                      key: `detail:${actionKey}:id`,
                      label: '属性 ID',
                      editor: {
                        value: draft.attrId,
                        ariaLabel: `${entry.entityName}的新属性 ID`,
                        pattern: '[A-Za-z_][A-Za-z0-9_-]*',
                        invalid: !ATTR_ID_PATTERN.test(attrId) || attributeIdOccupied(entry.source, attrId),
                        onChange: (value: string) => patchDraft(draftKey, defaults, { attrId: value }),
                      },
                    },
                    {
                      key: `detail:${actionKey}:label`,
                      label: '显示名',
                      editor: {
                        value: draft.attrLabel,
                        ariaLabel: `${entry.entityName}的新属性显示名`,
                        invalid: !!allowAttribute && !allowAttribute(candidate, attrId),
                        onChange: (value: string) => patchDraft(draftKey, defaults, { attrLabel: value }),
                      },
                    },
                    {
                      key: `detail:${actionKey}:initial`,
                      label: '初始值',
                      editor: {
                        value: draft.initialValue,
                        ariaLabel: `${entry.entityName}的新属性初始值`,
                        inputMode: 'decimal' as const,
                        invalid: initialValue === undefined,
                        onChange: (value: string) => patchDraft(draftKey, defaults, { initialValue: value }),
                      },
                    },
                    {
                      key: actionKey,
                      label: '确认创建并选择',
                      value: actionKey,
                      presentation: 'confirm' as const,
                      disabled: !valid,
                    },
                  ],
                }]
              })()
              : []),
          ],
        })),
    }] : []),
    ...(variableChoices.length > 0 ? [{
      key: 'variable-values',
      label: '变量',
      children: variableChoices.map((choice) => ({
        key: choice.key,
        label: choice.label,
        value: choice.key,
      })),
    }] : []),
    ...(formulaChoices.length > 0 ? [{
      key: 'formula-values',
      label: '公式',
      children: formulaChoices.map((choice) => ({
        key: choice.key,
        label: choice.label,
        value: choice.key,
      })),
    }] : []),
    { key: 'const', label: '常量', value: 'const' },
    ...(onClear ? [{ key: 'empty', label: emptyLabel, value: 'empty' }] : []),
  ]
  const selectedLabel = selectedKey === 'empty'
    ? onClear ? emptyLabel : ''
    : selectedKnown
      ? selectedChoice?.label ?? '常量'
      : ''
  const formulaMode = !empty && pick.mode === 'formula'

  function selectContent(key: string): void {
    if (key === 'empty') {
      onClear?.()
      return
    }
    const createAction = createActions.get(key)
    if (createAction && createAttribute) {
      if (createAction.entityRequest && createEntity) {
        createEntity.onCreate(createAction.entityRequest)
      }
      createAttribute.onCreate(createAction.attributeRequest)
      onChange(createAction.selectedValue)
      return
    }
    const choice = choices.find((item) => item.key === key)
    if (!choice) return
    if (choice.kind === 'const') {
      // 保留正负号（旧实现 Math.abs 会把扣血负数抹成正数）
      const n = typeof value === 'number' ? value : pick.mode === 'const' ? pick.const : 0
      onChange(n)
      return
    }
    if (choice.kind === 'entity') {
      onChange(compileValuePick({
        mode: 'pick',
        terms: [{ op: '+', source: 'entity', refId: choice.entityId, attr: choice.attr }],
      }))
      return
    }
    if (choice.kind === 'var') {
      onChange(compileValuePick({
        mode: 'pick',
        terms: [{ op: '+', source: 'var', refId: choice.varId }],
      }))
      return
    }
    const formula = findFormula(formulas, choice.formulaId)
    if (!formula) return
    onChange(compileFormula(formula, {}, entities))
  }

  // 旧版「选取公式」（当场拼 ±×÷ 条款链）留下的数据：只读展示 + 提示改走规则页，不再提供编辑入口。
  const legacyPick = pick.mode === 'pick' ? compileValuePick(pick) : undefined
  const legacyPickLabel = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !value.pick
      ? value.expr
      : legacyPick == null
        ? ''
        : typeof legacyPick === 'number'
          ? String(legacyPick)
          : legacyPick.expr
  const sourceControl = (
    <>
      {fieldLabels ? <span style={fieldLabel}>{fieldLabels.source}</span> : null}
      {effectOp && <EffectOpButtons op={effectOp.op} onChange={effectOp.onOpChange} />}
      <CascadingPicker
        ariaLabel={fieldLabels?.source ?? '数值内容'}
        value={selectedKey}
        displayValue={selectedLabel}
        placeholder="常量：10 · 状态：entity.hero.attr.hp / var.qi · 公式：伤害公式"
        options={pickerOptions}
        onSelect={selectContent}
      />
    </>
  )

  return (
    <div
      style={formulaMode || fieldLabels
        ? { ...row, flexDirection: 'column', alignItems: 'stretch' }
        : row}
      title={hintText}
    >
      {fieldLabels ? <div style={row}>{sourceControl}</div> : sourceControl}

      {!empty && pick.mode === 'const' && (
        fieldLabels ? (
          <div style={row}>
            <span style={fieldLabel}>{fieldLabels.value}</span>
            <LooseNumberInput
              value={pick.const}
              onChange={(n) => onChange(n)}
              aria-label={fieldLabels.value}
              placeholder="输入常量"
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        ) : (
          <LooseNumberInput
            value={pick.const}
            onChange={(n) => onChange(n)}
            aria-label="常量数值"
            placeholder="输入常量"
            style={{ flex: '0 1 32%', minWidth: 96 }}
          />
        )
      )}

      {!empty && pick.mode === 'pick' && !directBinding && (
        <input
          aria-label="历史表达式"
          value={legacyPickLabel}
          readOnly
          title="历史复杂表达式保持原值；从上方选择其它内容后才会替换。"
          style={{ flex: '0 1 40%', minWidth: 120, boxSizing: 'border-box' }}
        />
      )}

      {!empty && pick.mode === 'formula' && (
        <FormulaApplyEditor
          formulaId={pick.formulaId}
          holeBindings={pick.holeBindings}
          formulas={formulas}
          entities={entities}
          variables={variables}
          onChange={onChange}
          showFormulaPicker={false}
          createAttribute={createAttribute}
          createEntity={createEntity}
        />
      )}

    </div>
  )
}

/** 飘字专用包装：同时写回 valuePick sidecar 与 damageValue。 */
export function FloatValuePickEditor({
  valuePick,
  damageValue,
  entities,
  variables,
  formulas,
  onChange,
}: {
  valuePick: unknown
  damageValue: NumOrExpr
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  formulas?: Record<string, Formula>
  onChange: (next: { valuePick: ValuePick; damageValue: NumOrExpr }) => void
}): JSX.Element {
  return (
    <ValueExprEditor
      value={damageValue}
      storedPick={valuePick}
      entities={entities}
      variables={variables}
      formulas={formulas}
      hintText="结算时写入同一公式；文案可用 {v} 显示结果。"
      onChange={(damageValueNext) => {
        onChange({
          valuePick: resolveValuePick(damageValueNext, entities, variables),
          damageValue: damageValueNext,
        })
      }}
    />
  )
}
