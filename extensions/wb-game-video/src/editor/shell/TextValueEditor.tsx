import { useState, type CSSProperties } from 'react'
import type { Entity, NumOrExpr, Variable } from '../../runtime/schema/graph-schema'
import type { Formula, FormulaHoleBinding } from '../persist/formula-authoring'
import { CascadingPicker, type CascadingPickerOption } from './CascadingPicker'
import { FormulaApplyEditor } from './FormulaApplyEditor'
import { compileFormula } from './formulaApply'
import type { ValueExprAttributeCreateConfig, ValueExprEntityCreateConfig } from './ValueExprEditor'
import {
  attrDisplayName,
  entityDisplayName,
  findEntity,
  findFormula,
  formulaDisplayName,
  listAttrOptions,
  listEntityOptions,
  listFormulaOptions,
  listVarOptions,
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
  onChange: (next: TextOrRef) => void
}): JSX.Element {
  const [createDraft, setCreateDraft] = useState<EntityCreateDraft | null>(null)
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
  const variableChoices = listVarOptions(variables).map((variable) => ({
    key: `var:${encodeURIComponent(variable.id)}`,
    label: variableDisplayName(variables?.[variable.id], variable.id),
    ref: `var.${variable.id}`,
  }))
  const formulaChoices = listFormulaOptions(formulas).map((formula) => ({
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
  const createEntityTemplate = createEntity?.template
  const createEntityKey = createEntityTemplate
    ? `create-entity:${encodeURIComponent(createEntityTemplate.entityId)}`
    : ''
  const entityDraft = createEntityTemplate
    ? createDraft ?? {
      entityId: createEntityTemplate.entityId,
      name: createEntityTemplate.name,
    }
    : undefined
  const pickerOptions: CascadingPickerOption[] = [
    ...(orderedEntities.length === 0 && createEntity && createEntityTemplate && entityDraft ? [{
      key: 'entity-values',
      label: '实体',
      children: [{
        key: `configure:${createEntityKey}`,
        label: `配置「${createEntityTemplate.name}」实体`,
        children: [
          {
            key: `detail:${createEntityKey}:id`,
            label: '实体 ID',
            editor: {
              value: entityDraft.entityId,
              ariaLabel: '新实体 ID',
              invalid: !entityDraft.entityId.trim(),
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
            disabled: !entityDraft.entityId.trim(),
          },
        ],
      }],
    }] : []),
    ...(orderedEntities.length > 0 ? [{
      key: 'entity-values',
      label: '实体',
      children: orderedEntities.map((entity) => {
        const entityNameChoice = entityNameChoices.find((choice) => choice.key === entityNameKey(entity.id))!
        const attrs = entityAttrChoicesByEntity.find((entry) => entry.entity.id === entity.id)?.choices ?? []
        return {
          key: `entity:${encodeURIComponent(entity.id)}`,
          label: entityDisplayName(findEntity(entities, entity.id), entity.id),
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
          ],
        }
      }),
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
      if (!entityId) return
      createEntity.onCreate({
        entityId,
        name: entityDraft.name.trim(),
      })
      onChange({ ref: `entity.${entityId}.name` })
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
      <div style={row}>
        <CascadingPicker
          ariaLabel="文本内容"
          value={selected}
          displayValue={selectedLabel}
          placeholder="文本：我方 · 状态：entity.hero.name / var.qi · 公式：伤害公式"
          options={pickerOptions}
          onSelect={selectContent}
        />
        {selected === 'literal' ? (
          <input
            aria-label="固定文本"
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
            placeholder="输入固定文本"
            onChange={(event) => onChange(event.target.value)}
            style={{ flex: '0 1 40%', minWidth: 120, boxSizing: 'border-box' }}
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
        />
      ) : null}
    </div>
  )
}
