import type { JSX } from 'react'
import { getComponentManifest } from '../../runtime/registry/component-registry'
import type { EditorPickerCtx } from './editors'
import {
  ComponentFormFields,
  summarizeComponentInputs,
  type EntityAttributeCreateHandler,
  type EntityCreateHandler,
  type FormulaCreateHandler,
  type VariableCreateHandler,
} from './component-form-fields'

export function ComponentInputsDisclosure({
  childId,
  componentId,
  values,
  pickers,
  onChange,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: {
  childId: string
  componentId: string
  values: Record<string, unknown>
  pickers?: EditorPickerCtx
  onChange: (next: Record<string, unknown>) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
}): JSX.Element {
  const componentName = getComponentManifest(componentId)?.label ?? componentId
  const summary = summarizeComponentInputs(values)
  return (
    <details
      data-component-inputs-disclosure={`${childId}:${componentId}`}
      style={{
        marginBottom: 6,
        border: '1px solid #2a2a2a',
        borderRadius: 6,
        padding: '2px 8px',
        fontSize: 11,
        background: 'rgba(0,0,0,0.22)',
      }}
    >
      <summary
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          listStyle: 'none',
          padding: '2px 0',
        }}
        title={`组件 ${childId}（${componentName}）的 inputs。展开后编辑；悬停各字段可看说明。`}
      >
        <span style={{ opacity: 0.65 }}>组件</span>
        <b>{childId}</b>
        <span style={{ opacity: 0.55 }}>· {componentName}</span>
        {summary ? (
          <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.75 }}>{summary}</span>
        ) : null}
        <span style={{ opacity: 0.4, marginLeft: 'auto' }}>▾</span>
      </summary>
      <div style={{ padding: '4px 0 6px' }}>
        <ComponentFormFields
          componentId={componentId}
          values={values}
          onChange={onChange}
          pickers={pickers}
          excludeKeys={['x', 'y']}
          density="compact"
          onCreateEntityAttribute={onCreateEntityAttribute}
          onCreateEntity={onCreateEntity}
          onCreateVariable={onCreateVariable}
          onCreateFormula={onCreateFormula}
        />
      </div>
    </details>
  )
}
