/**
 * 通用数值表达式编辑器 —— 常量 / 从项目实体·变量选取，支持 ±×÷ 链式组合（含属性×属性）。
 */
import { useState, type CSSProperties } from 'react'
import type { Entity, NumOrExpr, ValuePick, ValueTerm, ValueTermOp, Variable } from '../../runtime/schema/graph-schema'
import {
  VALUE_TERM_OP_LABEL,
  compileValuePick,
  emptyPickTerm,
  findEntity,
  listAttrOptions,
  listEntityOptions,
  listVarOptions,
  resolveValuePick,
} from './valueExprPick'

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }
const hint: CSSProperties = { fontSize: 11, opacity: 0.65, lineHeight: 1.4 }

function termOp(t: ValueTerm): ValueTermOp {
  return t.op === '+' || t.op === '-' || t.op === '*' || t.op === '/' ? t.op : '+'
}

/** 允许输入过程中的 `-` / `.` / `-0.`；避免 `Number(x)||0` 把负数/小数草稿打回 0。 */
const LOOSE_NUM_RE = /^[+-]?(\d+\.?\d*|\.\d*)?$/

function LooseNumberInput({
  value,
  onChange,
  style,
  'aria-label': ariaLabel,
}: {
  value: number
  onChange: (n: number) => void
  style?: CSSProperties
  'aria-label'?: string
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value)
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={shown}
      style={style}
      onFocus={() => setDraft(String(value))}
      onBlur={() => {
        const raw = (draft ?? '').trim()
        const n = Number(raw)
        onChange(raw !== '' && Number.isFinite(n) ? n : value)
        setDraft(null)
      }}
      onChange={(e) => {
        const next = e.target.value
        if (next !== '' && !LOOSE_NUM_RE.test(next)) return
        setDraft(next)
        if (next === '' || next === '+' || next === '-' || next === '.' || next === '+.' || next === '-.') return
        const n = Number(next)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

export function ValueExprEditor({
  value,
  storedPick,
  entities,
  variables,
  onChange,
  hintText,
}: {
  value: NumOrExpr | undefined
  storedPick?: unknown
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  onChange: (next: NumOrExpr) => void
  hintText?: string
}): JSX.Element {
  const pick = resolveValuePick(value, entities, variables, storedPick)
  const entityOpts = listEntityOptions(entities)
  const varOpts = listVarOptions(variables, { numbersOnly: true })
  const hasCatalog = entityOpts.length > 0 || varOpts.length > 0

  function emit(next: ValuePick): void {
    onChange(compileValuePick(next))
  }

  function setMode(mode: 'const' | 'pick'): void {
    if (mode === 'const') {
      // 保留正负号（旧实现 Math.abs 会把扣血负数抹成正数）
      const n = typeof value === 'number' ? value : pick.mode === 'const' ? pick.const : 0
      emit({ mode: 'const', const: n })
      return
    }
    emit({ mode: 'pick', terms: [emptyPickTerm(entities, variables, '-')] })
  }

  function patchTerm(i: number, patch: Partial<ValueTerm>): void {
    if (pick.mode !== 'pick') return
    const terms = pick.terms.map((t, idx) => {
      if (idx !== i) return t
      const next: ValueTerm = { ...t, ...patch }
      if (patch.source === 'entity') {
        const id = next.refId || entityOpts[0]?.id || ''
        const ent = findEntity(entities, id)
        next.refId = id
        next.attr = next.attr && listAttrOptions(ent).some((a) => a.id === next.attr)
          ? next.attr
          : listAttrOptions(ent)[0]?.id ?? 'hp'
        next.constValue = undefined
      }
      if (patch.source === 'var') {
        next.refId = next.refId || varOpts[0]?.id || ''
        next.attr = undefined
        next.constValue = undefined
      }
      if (patch.source === 'const') {
        next.refId = ''
        next.attr = undefined
        next.constValue = next.constValue ?? 1
      }
      if (patch.refId && next.source === 'entity') {
        const ent = findEntity(entities, patch.refId)
        const attrs = listAttrOptions(ent)
        if (!attrs.some((a) => a.id === next.attr)) next.attr = attrs[0]?.id ?? next.attr
      }
      // 首项不允许 ×÷（无左操作数）
      if (idx === 0 && (next.op === '*' || next.op === '/')) next.op = '+'
      return next
    })
    emit({ mode: 'pick', terms })
  }

  const compiled = compileValuePick(pick)
  const compiledLabel = typeof compiled === 'number' ? String(compiled) : compiled.expr

  return (
    <div style={box}>
      <div style={row} role="group" aria-label="数值来源">
        <button type="button" className={pick.mode === 'const' ? 'gc-mini-action is-on' : 'gc-mini-action'} onClick={() => setMode('const')}>
          常量
        </button>
        <button type="button" className={pick.mode === 'pick' ? 'gc-mini-action is-on' : 'gc-mini-action'} onClick={() => setMode('pick')}>
          选取公式
        </button>
      </div>

      {pick.mode === 'const' ? (
        <LooseNumberInput
          value={pick.const}
          onChange={(n) => emit({ mode: 'const', const: n })}
          aria-label="常量数值"
          style={{ width: '100%' }}
        />
      ) : (
        <>
          {!hasCatalog && (
            <p style={hint}>当前项目还没有可选取的实体属性或数值变量。也可选「常数」做系数。请先到「配置」添加实体 / 变量。</p>
          )}
          {pick.terms.map((t, i) => {
            const op = termOp(t)
            const ent = t.source === 'entity' ? findEntity(entities, t.refId) : undefined
            const attrs = listAttrOptions(ent)
            return (
              <div key={i} style={{ ...row, border: '1px solid var(--gc-accent-line, #2a2a2a)', borderRadius: 6, padding: 6 }}>
                <select
                  value={op}
                  onChange={(e) => patchTerm(i, { op: e.target.value as ValueTermOp })}
                  aria-label={i === 0 ? '正负' : '运算'}
                >
                  {(i === 0 ? (['+', '-'] as ValueTermOp[]) : (['+', '-', '*', '/'] as ValueTermOp[])).map((o) => (
                    <option key={o} value={o}>{VALUE_TERM_OP_LABEL[o]}</option>
                  ))}
                </select>
                <select
                  value={t.source}
                  onChange={(e) => patchTerm(i, { source: e.target.value as ValueTerm['source'] })}
                  aria-label="对象类型"
                >
                  <option value="entity" disabled={entityOpts.length === 0}>实体</option>
                  <option value="var" disabled={varOpts.length === 0}>变量</option>
                  <option value="const">常数</option>
                </select>
                {t.source === 'entity' ? (
                  <>
                    <select value={t.refId} onChange={(e) => patchTerm(i, { refId: e.target.value })} aria-label="实体" style={{ flex: 1, minWidth: 100 }}>
                      <option value="" disabled>选择对象…</option>
                      {entityOpts.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    <select value={t.attr ?? ''} onChange={(e) => patchTerm(i, { attr: e.target.value })} aria-label="属性" style={{ flex: 1, minWidth: 90 }}>
                      <option value="" disabled>选择属性…</option>
                      {attrs.map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                  </>
                ) : t.source === 'var' ? (
                  <select value={t.refId} onChange={(e) => patchTerm(i, { refId: e.target.value })} aria-label="变量" style={{ flex: 1, minWidth: 100 }}>
                    <option value="" disabled>选择变量…</option>
                    {varOpts.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <LooseNumberInput
                    value={t.constValue ?? 0}
                    onChange={(n) => patchTerm(i, { constValue: n })}
                    aria-label="常数"
                    style={{ width: 72 }}
                  />
                )}
                <button
                  type="button"
                  className="gc-mini-danger"
                  title={pick.terms.length <= 1 ? '删除后回到常量' : '删除此项'}
                  onClick={() => {
                    if (pick.terms.length <= 1) {
                      emit({ mode: 'const', const: 0 })
                      return
                    }
                    emit({ mode: 'pick', terms: pick.terms.filter((_, idx) => idx !== i) })
                  }}
                >
                  删除
                </button>
              </div>
            )
          })}
          <button
            type="button"
            className="gc-mini-action"
            onClick={() => {
              if (pick.mode !== 'pick') return
              // 默认「×」下一项，方便属性互乘；无目录时用常数
              emit({
                mode: 'pick',
                terms: [...pick.terms, emptyPickTerm(entities, variables, '*')],
              })
            }}
          >
            ＋ 添加一项
          </button>
          <p style={hint}>
            {hintText
              ? `${hintText} 预览：${compiledLabel || '（未完成选取）'}。`
              : `预览：${compiledLabel || '（未完成选取）'}。按顺序左结合（可 ×÷ 属性）。`}
          </p>
        </>
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
  onChange,
}: {
  valuePick: unknown
  damageValue: NumOrExpr
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  onChange: (next: { valuePick: ValuePick; damageValue: NumOrExpr }) => void
}): JSX.Element {
  return (
    <ValueExprEditor
      value={damageValue}
      storedPick={valuePick}
      entities={entities}
      variables={variables}
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
