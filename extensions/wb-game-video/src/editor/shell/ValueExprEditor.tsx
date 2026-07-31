/**
 * 通用数值表达式编辑器 —— 直接选择具体状态值或具名公式；固定值使用普通输入框。
 * 条款链（±×÷、留空实体）的编排完全收在「规则 → 公式」Tab（见 ScenarioInspector.tsx 的
 * FormulaRow + TermChainEditor）；这里不重复一份「当场拼公式」的入口——要用公式，先去规则页定义，
 * 再回这里选它、填空。
 */
import type { CSSProperties } from 'react'
import type { Entity, NumOrExpr, Variable } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
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

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }
const hint: CSSProperties = { fontSize: 11, opacity: 0.65, lineHeight: 1.4 }
const examples: CSSProperties = { fontSize: 10, opacity: 0.5, lineHeight: 1.4 }

type ContentChoice =
  | { key: 'const'; kind: 'const'; label: string }
  | { key: string; kind: 'entity'; label: string; entityId: string; attr: string }
  | { key: string; kind: 'var'; label: string; varId: string }
  | { key: string; kind: 'formula'; label: string; formulaId: string }

function choiceKey(kind: 'entity' | 'var' | 'formula', ...parts: string[]): string {
  return `${kind}:${parts.map(encodeURIComponent).join(':')}`
}

export function ValueExprEditor({
  value,
  storedPick,
  entities,
  variables,
  formulas,
  onChange,
  onClear,
  emptyLabel = '使用组件实时值',
  hintText,
  effectOp,
}: {
  value: ValueExprInput | undefined
  storedPick?: unknown
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  /** 公式库（「规则 → 公式」维护）；非空时「应用公式」模式才可选。 */
  formulas?: Record<string, Formula>
  onChange: (next: NumOrExpr) => void
  onClear?: () => void
  emptyLabel?: string
  hintText?: string
  /** 挂了这个 = 这个值要配一个 Effect「运算」符号按钮，嵌进编辑器顶部（跟常量/应用公式同一行）。 */
  effectOp?: { op: EffectDisplayOp; onOpChange: (next: EffectDisplayOp) => void }
}): JSX.Element {
  const pick = resolveValuePick(value, entities, variables, storedPick)
  const formulaOpts = listFormulaOptions(formulas)
  const directTerm = pick.mode === 'pick' ? pick.terms[0] : undefined
  const directBinding = pick.mode === 'pick'
    && pick.terms.length === 1
    && (directTerm?.source === 'entity' || directTerm?.source === 'var')
    && (directTerm.op === undefined || directTerm.op === '+' || directTerm.op === '*')
  const entityChoices: ContentChoice[] = listEntityOptions(entities).flatMap((entity) => {
    const source = findEntity(entities, entity.id)
    const entityName = entityDisplayName(source, entity.id)
    return listAttrOptions(source).map((attr) => ({
      key: choiceKey('entity', entity.id, attr.id),
      kind: 'entity' as const,
      label: `${entityName}的${attrDisplayName(source, attr.id)}`,
      entityId: entity.id,
      attr: attr.id,
    }))
  })
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
    { key: 'const', kind: 'const', label: '固定值（手动输入）' },
    ...entityChoices,
    ...variableChoices,
    ...formulaChoices,
  ]
  const empty = value === undefined && onClear != null
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

  function selectContent(key: string): void {
    if (key === 'empty') {
      onClear?.()
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

  return (
    <div style={box}>
      <div style={row}>
        {effectOp && <EffectOpButtons op={effectOp.op} onChange={effectOp.onOpChange} />}
        <select
          aria-label="数值内容"
          value={selectedKey}
          onChange={(event) => selectContent(event.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        >
          {!selectedKnown ? <option value={selectedKey}>当前内容（保持原值）</option> : null}
          {onClear ? <option value="empty">{emptyLabel}</option> : null}
          <option value="const">固定值（手动输入）</option>
          {entityChoices.length > 0 ? (
            <optgroup label="实体属性">
              {entityChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
            </optgroup>
          ) : null}
          {variableChoices.length > 0 ? (
            <optgroup label="变量">
              {variableChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
            </optgroup>
          ) : null}
          {formulaChoices.length > 0 ? (
            <optgroup label="公式">
              {formulaChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
            </optgroup>
          ) : null}
        </select>
        <span style={examples}>
          常量：10 · 状态：entity.hero.attr.hp / var.qi · 公式：伤害公式
        </span>
      </div>

      {!empty && pick.mode === 'const' && (
        <LooseNumberInput
          value={pick.const}
          onChange={(n) => onChange(n)}
          aria-label="常量数值"
          style={{ width: '100%' }}
        />
      )}

      {!empty && pick.mode === 'pick' && !directBinding && (
        <>
          <input
            aria-label="历史表达式"
            value={legacyPickLabel}
            readOnly
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <p style={hint}>历史复杂表达式保持原值；从上方选择其它内容后才会替换。</p>
        </>
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
        />
      )}

      {hintText && !empty && (pick.mode !== 'pick' || directBinding) && <p style={hint}>{hintText}</p>}
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
