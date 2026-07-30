/**
 * 通用数值表达式编辑器 —— 常量 / 应用规则库里的具名公式。
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
  compileValuePick,
  findFormula,
  listFormulaOptions,
  resolveValuePick,
  type EffectDisplayOp,
  type ValuePick,
} from './valueExprPick'

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }
const hint: CSSProperties = { fontSize: 11, opacity: 0.65, lineHeight: 1.4 }

export function ValueExprEditor({
  value,
  storedPick,
  entities,
  variables,
  formulas,
  onChange,
  hintText,
  effectOp,
}: {
  value: NumOrExpr | undefined
  storedPick?: unknown
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  /** 公式库（「规则 → 公式」维护）；非空时「应用公式」模式才可选。 */
  formulas?: Record<string, Formula>
  onChange: (next: NumOrExpr) => void
  hintText?: string
  /** 挂了这个 = 这个值要配一个 Effect「运算」符号按钮，嵌进编辑器顶部（跟常量/应用公式同一行）。 */
  effectOp?: { op: EffectDisplayOp; onOpChange: (next: EffectDisplayOp) => void }
}): JSX.Element {
  const pick = resolveValuePick(value, entities, variables, storedPick)
  const formulaOpts = listFormulaOptions(formulas)

  function setMode(mode: 'const' | 'formula'): void {
    if (mode === 'const') {
      // 保留正负号（旧实现 Math.abs 会把扣血负数抹成正数）
      const n = typeof value === 'number' ? value : pick.mode === 'const' ? pick.const : 0
      onChange(n)
      return
    }
    // 库为空时按钮已置灰，这里双重保险。
    const first = formulaOpts[0]
    const formula = first ? findFormula(formulas, first.id) : undefined
    if (!formula) return
    onChange(compileFormula(formula, {}, entities))
  }

  // 旧版「选取公式」（当场拼 ±×÷ 条款链）留下的数据：只读展示 + 提示改走规则页，不再提供编辑入口。
  const legacyPick = pick.mode === 'pick' ? compileValuePick(pick) : undefined
  const legacyPickLabel = legacyPick == null ? '' : typeof legacyPick === 'number' ? String(legacyPick) : legacyPick.expr

  return (
    <div style={box}>
      <div style={row} role="group" aria-label="数值来源">
        {effectOp && <EffectOpButtons op={effectOp.op} onChange={effectOp.onOpChange} />}
        <button type="button" className={pick.mode === 'const' ? 'gc-mini-action is-on' : 'gc-mini-action'} onClick={() => setMode('const')}>
          常量
        </button>
        <button
          type="button"
          className={pick.mode === 'formula' ? 'gc-mini-action is-on' : 'gc-mini-action'}
          disabled={formulaOpts.length === 0}
          title={formulaOpts.length === 0 ? '规则 → 公式 里还没有可用公式' : undefined}
          onClick={() => setMode('formula')}
        >
          应用公式
        </button>
      </div>

      {pick.mode === 'const' && (
        <LooseNumberInput
          value={pick.const}
          onChange={(n) => onChange(n)}
          aria-label="常量数值"
          style={{ width: '100%' }}
        />
      )}

      {pick.mode === 'pick' && (
        <p style={hint}>
          旧版「当场拼公式」数据（未迁移）：{legacyPickLabel || '（空）'}。
          条款链的编排请到「规则 → 公式」维护成具名公式再应用；这里改选「常量」或「应用公式」会覆盖它。
        </p>
      )}

      {pick.mode === 'formula' && (
        <FormulaApplyEditor
          formulaId={pick.formulaId}
          holeBindings={pick.holeBindings}
          formulas={formulas}
          entities={entities}
          variables={variables}
          onChange={onChange}
        />
      )}

      {hintText && pick.mode !== 'pick' && <p style={hint}>{hintText}</p>}
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
