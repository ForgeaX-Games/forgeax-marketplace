/**
 * 应用公式 —— ValueExprEditor 第三模式的填空 UI：选一个具名公式，给它的每个留空位（未知实体）
 * 选具体实体，实时编译回 NumOrExpr。复用 EntitySelect / AttrSelect（跟 Effect/条件编辑器同源）。
 */
import type { CSSProperties, JSX } from 'react'
import type { Entity, NumOrExpr, Variable } from '../../runtime/schema/graph-schema'
import type { Formula, FormulaHoleBinding } from '../persist/formula-authoring'
import { AttrSelect, EntitySelect } from './editors'
import { compileFormula, formulaHoles, formulaTermsPreview, missingFormulaHoles } from './formulaApply'
import { findEntity, findFormula, listAttrOptions, listFormulaOptions } from './valueExprPick'

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }
const hint: CSSProperties = { fontSize: 11, opacity: 0.65, lineHeight: 1.4 }
const holeLbl: CSSProperties = { fontSize: 11, opacity: 0.8, minWidth: 120 }

/** 给定留空位当前绑定，算出实际会用到的属性 id（约定名有效则用它，否则落该实体第一个属性）——供 AttrSelect 显示当前生效值。 */
function effectiveAttr(binding: FormulaHoleBinding | undefined, suggestedAttr: string | undefined, entities: Record<string, Entity> | undefined): string {
  if (!binding?.entityId) return ''
  const attrs = listAttrOptions(findEntity(entities, binding.entityId))
  if (binding.attr && attrs.some((a) => a.id === binding.attr)) return binding.attr
  if (suggestedAttr && attrs.some((a) => a.id === suggestedAttr)) return suggestedAttr
  return attrs[0]?.id ?? ''
}

export function FormulaApplyEditor({
  formulaId,
  holeBindings,
  formulas,
  entities,
  variables,
  onChange,
}: {
  formulaId: string
  holeBindings: Record<string, FormulaHoleBinding>
  formulas: Record<string, Formula> | undefined
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  onChange: (next: NumOrExpr) => void
}): JSX.Element {
  const options = listFormulaOptions(formulas)
  const formula = findFormula(formulas, formulaId)
  const holes = formula ? formulaHoles(formula) : []
  const missingHoles = formula ? missingFormulaHoles(formula, holeBindings) : []

  function pickFormula(nextId: string): void {
    const next = findFormula(formulas, nextId)
    if (!next) return
    onChange(compileFormula(next, {}, entities))
  }

  function patchHole(termId: string, patch: Partial<FormulaHoleBinding>): void {
    if (!formula) return
    const nextBindings: Record<string, FormulaHoleBinding> = {
      ...holeBindings,
      [termId]: { ...holeBindings[termId], ...patch } as FormulaHoleBinding,
    }
    onChange(compileFormula(formula, nextBindings, entities))
  }

  const compiled = formula ? compileFormula(formula, holeBindings, entities) : undefined
  const compiledLabel = compiled == null ? '' : typeof compiled === 'number' ? String(compiled) : compiled.expr

  return (
    <div style={box}>
      <div style={row} role="group" aria-label="选择公式">
        <select value={formulaId} onChange={(e) => pickFormula(e.target.value)} aria-label="公式" style={{ flex: 1, minWidth: 140 }}>
          <option value="" disabled>选择公式…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>
      {!formula ? (
        <p style={hint}>该公式已被删除，数值维持上次编译结果；请另选一个公式。</p>
      ) : (
        <>
          <p style={hint}>条款：{formulaTermsPreview(formula.terms, entities, variables)}</p>
          {holes.length === 0 ? (
            <p style={hint}>该公式没有留空位，直接应用即可。</p>
          ) : (
            holes.map((h) => {
              const binding = holeBindings[h.termId]
              const entityId = binding?.entityId ?? ''
              return (
                <div key={h.termId} style={{ ...row, border: '1px solid var(--gc-accent-line, #2a2a2a)', borderRadius: 6, padding: 6 }}>
                  <span style={holeLbl}>
                    留空位{h.suggestedAttr ? `（约定属性：${h.suggestedAttr}）` : ''}
                  </span>
                  <EntitySelect
                    value={entityId}
                    entities={entities}
                    onChange={(id) => patchHole(h.termId, { entityId: id, attr: undefined })}
                  />
                  <AttrSelect
                    entityId={entityId}
                    value={effectiveAttr(binding, h.suggestedAttr, entities)}
                    entities={entities}
                    onChange={(attr) => patchHole(h.termId, { attr })}
                  />
                </div>
              )
            })
          )}
          {missingHoles.length > 0 ? (
            <p role="alert" style={{ ...hint, color: '#ffb86c', fontWeight: 600 }}>
              还缺 {missingHoles.length} 个实体绑定。当前只会按已填条款计算；补全后再用于结算。
            </p>
          ) : null}
          <p style={hint}>预览：{compiledLabel || '（未完成填空）'}。</p>
        </>
      )}
    </div>
  )
}
