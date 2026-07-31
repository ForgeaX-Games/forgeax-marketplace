import type { CSSProperties } from 'react'
import type { Entity, Variable } from '../../runtime/schema/graph-schema'
import { findEntity, listAttrOptions, listEntityOptions, listVarOptions } from './metaCatalog'

export type TextOrRef = string | { ref: string }

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }
const examples: CSSProperties = { fontSize: 10, opacity: 0.5, lineHeight: 1.4 }

function entityNameKey(id: string): string {
  return `entity-name:${encodeURIComponent(id)}`
}

export function TextValueEditor({
  value,
  entities,
  variables,
  onChange,
}: {
  value: TextOrRef | undefined
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  onChange: (next: TextOrRef) => void
}): JSX.Element {
  const entityNameChoices = listEntityOptions(entities).map((entity) => ({
    key: entityNameKey(entity.id),
    label: `${entity.label} / 名称`,
    ref: `entity.${entity.id}.name`,
  }))
  const entityAttrChoices = listEntityOptions(entities).flatMap((entity) =>
    listAttrOptions(findEntity(entities, entity.id)).map((attr) => ({
      key: `entity-attr:${encodeURIComponent(entity.id)}:${encodeURIComponent(attr.id)}`,
      label: `${entity.label} / ${attr.label}`,
      ref: `entity.${entity.id}.attr.${attr.id}`,
    })),
  )
  const variableChoices = listVarOptions(variables).map((variable) => ({
    key: `var:${encodeURIComponent(variable.id)}`,
    label: variable.label,
    ref: `var.${variable.id}`,
  }))
  const stateChoices = [...entityNameChoices, ...entityAttrChoices, ...variableChoices]
  const ref = value && typeof value === 'object' ? value.ref : undefined
  const selected = ref
    ? stateChoices.find((choice) => choice.ref === ref)?.key ?? 'unknown-ref'
    : 'literal'

  function selectContent(key: string): void {
    if (key === 'literal') {
      onChange(typeof value === 'string' ? value : '')
      return
    }
    const choice = stateChoices.find((item) => item.key === key)
    if (choice) onChange({ ref: choice.ref })
  }

  return (
    <div style={box}>
      <div style={row}>
        <select
          aria-label="文本内容"
          value={selected}
          onChange={(event) => selectContent(event.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        >
          {selected === 'unknown-ref' ? <option value="unknown-ref">当前引用（保持原值）</option> : null}
          <option value="literal">固定文本（手动输入）</option>
          {entityNameChoices.length > 0 ? (
            <optgroup label="实体名称">
              {entityNameChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>{choice.label}</option>
              ))}
            </optgroup>
          ) : null}
          {entityAttrChoices.length > 0 ? (
            <optgroup label="实体属性">
              {entityAttrChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>{choice.label}</option>
              ))}
            </optgroup>
          ) : null}
          {variableChoices.length > 0 ? (
            <optgroup label="变量">
              {variableChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>{choice.label}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <span style={examples}>文本：我方 · 状态：entity.hero.name / var.qi</span>
      </div>
      {selected === 'literal' ? (
        <input
          aria-label="固定文本"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      ) : null}
    </div>
  )
}
