/**
 * FormulaTextEditor —— Grafana 式公式编辑器（规则 → 公式）。
 *
 * 单一 SSOT 仍是 `Formula.ast`（一棵 FormulaAstNode）。本编辑器用**自由文本**作主输入：
 *  · 文本框直接写 expr 串（`parseFormulaText` 实时校验，支持 `?参数` 留空位语法）；
 *  · 文本框下方一行**结构摘要**：引用了哪些实体/变量、含几个参数、无参数时 `≈ 样例值`
 *    ——不再逐字复述公式串（那与输入框重复）；
 *  · **试算面板**（默认折叠）：含 `?参数` 时给每个参数填样例值，实时算出结果，让用户直观看懂产出；
 *  · 插入工具条：往光标处插入 实体属性 / 变量 / score / 函数 / ?参数（复用 scenario-pickers）。
 *
 * 与旧 FormulaAstEditor 的可编辑节点嵌套树不同——文本 ↔ AST 双向经 formula-authoring 的
 * parseFormulaText / previewFormula，runtime expr.ts 不认 hole，故 hole 语法只活在编辑器层。
 */
import { useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { Entity, Variable } from '../../runtime/schema/graph-schema'
import { tryEvalExpr, type EvalCtx } from '../../runtime/engine/expr'
import { createRng } from '../../runtime/engine/rng'
import type { FormulaAstNode, FormulaHoleBinding } from '../persist/formula-authoring'
import { parseFormulaText, previewFormula, serializeFormula } from '../persist/formula-authoring'
import { formulaHoles, type FormulaHole } from './formulaApply'
import { AttrPicker, EntityPicker, VariablePicker } from './scenario-pickers'

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }

/** 样例求值上下文：实体 attrs 原样、变量取 initial；每次试算另建 seed 0 RNG。 */
function sampleCtx(entities?: Record<string, Entity>, variables?: Record<string, Variable>): EvalCtx {
  const ents: EvalCtx['entities'] = {}
  for (const [id, e] of Object.entries(entities ?? {})) ents[id] = { attrs: e.attrs ?? {} }
  const vars: Record<string, number> = {}
  for (const [id, v] of Object.entries(variables ?? {})) vars[id] = v.initial ?? 0
  return { entities: ents, vars, flags: {}, score: 0 }
}

// expr.ts eval 支持的函数名（插入用）。
const FUNCTIONS = ['floor', 'round', 'abs', 'min', 'max', 'chance', 'rand', 'randInt']

/** 一条公式引用了哪些实体 / 变量（去重、按出现顺序）——供结构摘要展示。 */
function collectRefs(ast: FormulaAstNode): { entities: Set<string>; vars: Set<string>; usesScore: boolean } {
  const entities = new Set<string>()
  const vars = new Set<string>()
  let usesScore = false
  const walk = (n: FormulaAstNode): void => {
    switch (n.t) {
      case 'ref':
        if (n.ref.kind === 'entityAttr' && n.ref.entityId) entities.add(n.ref.entityId)
        else if (n.ref.kind === 'var' && n.ref.varId) vars.add(n.ref.varId)
        else if (n.ref.kind === 'score') usesScore = true
        break
      case 'unary':
        walk(n.x)
        break
      case 'bin':
        walk(n.a)
        walk(n.b)
        break
      case 'call':
        n.args.forEach(walk)
        break
      default:
        break
    }
  }
  walk(ast)
  return { entities, vars, usesScore }
}

/** 实体/变量 id → 显示名（有 name 用 name，否则回退 id）。 */
function entName(id: string, entities?: Record<string, Entity>): string {
  return entities?.[id]?.name || id
}
function varName(id: string, variables?: Record<string, Variable>): string {
  return variables?.[id]?.name || id
}

export function FormulaTextEditor({
  ast,
  entities,
  variables,
  onChange,
}: {
  ast: FormulaAstNode
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  onChange: (ast: FormulaAstNode) => void
}): JSX.Element {
  const canonical = previewFormula(ast)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const text = draft ?? canonical
  const ctx = useMemo(() => sampleCtx(entities, variables), [entities, variables])

  // 结构摘要 / 试算面板都基于「当前文本能否解析成 AST」——解析成功用新 AST，失败沿用旧 AST。
  const liveAst = useMemo<FormulaAstNode | null>(() => {
    const src = text.trim()
    if (!src) return { t: 'num', id: 'n0', v: 0 }
    try {
      return parseFormulaText(src)
    } catch {
      return null
    }
  }, [text])

  const holes = useMemo<FormulaHole[]>(() => (liveAst ? formulaHoles({ id: '', ast: liveAst }) : []), [liveAst])
  const refs = useMemo(() => (liveAst ? collectRefs(liveAst) : null), [liveAst])
  const hasHole = holes.length > 0
  const sampleValue = !error && !hasHole ? tryEvalExpr(text, { ...ctx, rng: createRng(0) }) : null

  /** 校验并（成功时）回写 AST。 */
  function commit(next: string): void {
    const src = next.trim()
    if (!src) {
      onChange({ t: 'num', id: 'n0', v: 0 })
      setDraft(null)
      setError(null)
      return
    }
    try {
      const nextAst = parseFormulaText(src)
      setError(null)
      onChange(nextAst)
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /** 实时校验当前文本（输入 / 插入后调用）。 */
  function revalidate(next: string): void {
    try { parseFormulaText(next.trim() || '0'); setError(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  /** 往光标处插入片段（无选区时追加到末尾）；插入后聚焦并把光标移到片段末。 */
  function insert(frag: string): void {
    const ta = taRef.current
    const base = draft ?? canonical
    if (!ta) {
      const next = base + frag
      setDraft(next)
      revalidate(next)
      return
    }
    const start = ta.selectionStart ?? base.length
    const end = ta.selectionEnd ?? base.length
    const next = base.slice(0, start) + frag + base.slice(end)
    setDraft(next)
    revalidate(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + frag.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const entOpts = Object.values(entities ?? {})
  const varOpts = Object.values(variables ?? {})

  return (
    <div className="gc-fx" style={box}>
      <textarea
        ref={taRef}
        className={error ? 'gc-fx-input is-err' : 'gc-fx-input'}
        aria-label="公式表达式"
        rows={2}
        value={text}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          revalidate(next)
        }}
        onBlur={() => commit(draft ?? canonical)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(draft ?? canonical) }
        }}
      />

      {/* 结构摘要行（不复述公式串；给引用/参数/样例值的概览） */}
      <div className="gc-fx-summary" aria-label="公式结构摘要">
        {error ? (
          <span className="gc-fx-summary-item gc-fx-summary-item--err">无法解析</span>
        ) : refs ? (
          <>
            {refs.entities.size > 0 && (
              <span className="gc-fx-summary-item">
                实体 {[...refs.entities].map((id) => entName(id, entities)).join('、')}
              </span>
            )}
            {refs.vars.size > 0 && (
              <span className="gc-fx-summary-item">
                变量 {[...refs.vars].map((id) => varName(id, variables)).join('、')}
              </span>
            )}
            {refs.usesScore && <span className="gc-fx-summary-item">局面分</span>}
            {hasHole && <span className="gc-fx-summary-item gc-fx-summary-item--hole">参数 {holes.length}</span>}
            {refs.entities.size === 0 && refs.vars.size === 0 && !refs.usesScore && !hasHole && (
              <span className="gc-fx-summary-item gc-fx-summary-item--muted">常量表达式</span>
            )}
          </>
        ) : null}
        {sampleValue != null && <span className="gc-fx-eq">≈ {sampleValue}</span>}
      </div>

      {/* 试算面板（默认折叠）：给每个 ?参数 填样例值、实时算出结果 */}
      {hasHole && liveAst && !error && (
        <TrialPanel ast={liveAst} holes={holes} ctx={ctx} entities={entities} />
      )}

      {/* 插入工具条 */}
      <div className="gc-fx-tools">
        {entOpts.length > 0 && (
          <label>实体
            <EntitySelectInsert entities={entities} onPick={(id, attr) => insert(`entity.${id}.attr.${attr}`)} />
          </label>
        )}
        {varOpts.length > 0 && (
          <label>变量
            <VariablePicker value="" variables={variables} allowEmpty onChange={(id) => id && insert(`var.${id}`)} />
          </label>
        )}
        <button type="button" className="gc-fx-chip" onClick={() => insert('score')}>score</button>
        <select
          className="gc-fx-chip"
          value=""
          aria-label="插入函数"
          onChange={(e) => { const fn = e.target.value; if (fn) insert(`${fn}()`); e.currentTarget.value = '' }}
        >
          <option value="">＋函数</option>
          {FUNCTIONS.map((f) => <option key={f} value={f}>{f}()</option>)}
        </select>
        <button type="button" className="gc-fx-chip" onClick={() => insert('?参数')} title="插入留空位——应用公式时再绑定具体值">?参数</button>
      </div>

      {error ? (
        <p className="gc-fx-err">解析失败：{error}</p>
      ) : (
        <p className="gc-fx-hint">
          可用：数字 / var.&lt;id&gt; / entity.&lt;id&gt;.attr.&lt;名&gt; / score / floor·min·max·chance 等函数。
          <code> ?参数 </code>= 留空位（应用公式时绑定具体值）。⌘/Ctrl+Enter 提交。
        </p>
      )}
    </div>
  )
}

/**
 * 试算面板：把每个 ?参数 当纯数值代入，实时算出「≈ 结果」。默认折叠。
 * 样例值只在本地 state，不写回公式定义——纯粹帮用户看懂公式产出。
 */
function TrialPanel({
  ast,
  holes,
  ctx,
  entities,
}: {
  ast: FormulaAstNode
  holes: FormulaHole[]
  ctx: EvalCtx
  entities?: Record<string, Entity>
}): JSX.Element {
  // 每个 hole 一个样例数值（默认 1；entityAttr 空位默认取约定属性在样例实体上的值，取不到回退 1）。
  const [values, setValues] = useState<Record<string, number>>({})
  const sample = (hole: FormulaHole): number => {
    if (values[hole.holeId] != null) return values[hole.holeId]!
    if (hole.kind === 'entityAttr' && hole.suggestAttr) {
      for (const e of Object.values(entities ?? {})) {
        const v = e.attrs?.[hole.suggestAttr]
        if (typeof v === 'number') return v
      }
    }
    return 1
  }

  // hole → number 绑定，走同一套 serializeFormula → tryEvalExpr。
  const bindings: Record<string, FormulaHoleBinding> = {}
  for (const h of holes) bindings[h.holeId] = { kind: 'number', value: sample(h) }
  const expr = serializeFormula(ast, bindings)
  const result = expr != null ? tryEvalExpr(expr, { ...ctx, rng: createRng(0) }) : null

  return (
    <details className="gc-fx-trial">
      <summary className="gc-fx-trial-head">
        试算
        {result != null && <span className="gc-fx-trial-eq">≈ {result}</span>}
      </summary>
      <div className="gc-fx-trial-body">
        {holes.map((h) => (
          <label key={h.holeId} className="gc-fx-trial-row">
            <span className="gc-fx-trial-label">{h.label ?? h.holeId}</span>
            <input
              type="number"
              className="gc-fx-trial-input"
              value={sample(h)}
              aria-label={`样例值 ${h.label ?? h.holeId}`}
              onChange={(e) => setValues((prev) => ({ ...prev, [h.holeId]: Number(e.target.value) || 0 }))}
            />
          </label>
        ))}
        <p className="gc-fx-hint">样例值仅用于试算预览，不写入公式定义。</p>
      </div>
    </details>
  )
}

/** 实体+属性两级选择，选定后把 `entity.id.attr.attr` 交给 onPick 插入。 */
function EntitySelectInsert({
  entities,
  onPick,
}: {
  entities?: Record<string, Entity>
  onPick: (entityId: string, attr: string) => void
}): JSX.Element {
  const [ent, setEnt] = useState('')
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      <EntityPicker value={ent} entities={entities} allowEmpty onChange={setEnt} />
      {ent ? (
        <AttrPicker entityId={ent} value="" entities={entities} onChange={(attr) => { if (attr) { onPick(ent, attr); setEnt('') } }} />
      ) : null}
    </span>
  )
}
