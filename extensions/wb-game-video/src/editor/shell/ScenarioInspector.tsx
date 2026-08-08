/**
 * ScenarioInspector —— 场景级配置：variables / entities / overlays 目录 / formulas / 默认 BGM。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AttrMeta, Entity, GameScenario, Layout, Overlay, ScalarValue, Variable } from '../../runtime/schema/graph-schema'
import type { Formula, FormulaParseFailureSnapshot } from '../persist/formula-authoring'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { OverlayChildStyleEditor } from './OverlayChildStyleEditor'
import { NEW_COMPONENT_PRESETS, listSchemeAndBaseOverlayIds } from '../demo/builtin-schemes'
import { FormulaHelpContent, FormulaTextEditor } from './FormulaTextEditor'
import { LooseNumberInput } from './TermChainEditor'
import type { ScenarioIdRename } from '../persist/scenario-id'
import { nextUniqueOverlayTitle, overlayTitleExists } from './overlay-title'
import { injectStyleOnce } from '../../styles/injectStyle'
import { placeAdaptivePop } from './useBlueprintNavActions'
import { AiParameterFillButton } from './AiParameterFillButton'
import searchIcon from '../../assets/asset-toolbar-search.svg?url'

export type ScenarioMeta = Pick<GameScenario, 'variables' | 'entities' | 'ui'> & {
  formulas?: Record<string, Formula>
}

const box: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }
const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, fontSize: 12 }
const lbl: CSSProperties = { width: 60, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
const sectionTitle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 12,
  borderTop: '1px solid #333',
  padding: '6px 0',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--gc-panel, #1b1713)',
}
const entityAttrGrid = 'minmax(4.5rem, 0.45fr) minmax(0, 0.9fr) minmax(4rem, 0.5fr) minmax(7rem, 1.25fr) 2rem'
const FORMULA_RULES_CSS = `
.sir-formulas { min-width:0; }
.sir-formula-toolbar {
  height:44px; display:flex; align-items:center; justify-content:flex-end; gap:12px;
}
.sir-formula-create {
  height:24px; padding:0 10px; border:0; border-radius:6px;
  background:rgba(255,255,255,.08); color:rgba(255,255,255,.86);
  font-size:12px; cursor:pointer;
}
.sir-formula-search {
  box-sizing:border-box; width:190px; height:24px; padding:0 10px 0 30px;
  border:0; border-radius:6px; outline:0; color:rgba(255,255,255,.86);
  background:rgba(255,255,255,.08);
}
.sir-formula-search::placeholder { color:rgba(255,255,255,.32); }
.sir-formula-search-wrap { position:relative; display:inline-flex; }
.sir-formula-search-icon {
  position:absolute; left:10px; top:50%; width:12px; height:12px;
  transform:translateY(-50%); color:rgba(255,255,255,.88); pointer-events:none;
}
.sir-formula-row { border-bottom:1px solid rgba(255,255,255,.08); }
.sir-formula-row:first-of-type { border-top:1px solid rgba(255,255,255,.08); }
.sir-formula-head {
  min-height:64px; display:flex; align-items:center; gap:8px; position:relative;
}
.sir-formula-toggle {
  width:16px; height:20px; padding:0; border:0; background:transparent;
  display:inline-flex; align-items:center; justify-content:center; cursor:pointer;
  color:rgba(255,255,255,.34);
}
.sir-formula-toggle.is-open { color:rgba(255,255,255,.92); }
.sir-formula-toggle svg {
  width:12px; height:12px; display:block; transition:transform .16s ease,color .16s ease;
}
.sir-formula-toggle.is-open svg { transform:rotate(-90deg); }
.sir-formula-name {
  field-sizing:content; flex:0 1 auto; min-width:2.5em; width:auto; max-width:40%; padding:0; border:0; outline:0;
  background:transparent; color:rgba(255,255,255,.9); font:inherit; font-size:14px;
  overflow:hidden; text-overflow:ellipsis;
}
.sir-formula-id { flex:0 0 auto; margin-left:-2px; color:rgba(255,255,255,.32); font-size:14px; }
.sir-formula-more {
  margin-left:auto; width:24px; height:24px; padding:0; border:0;
  background:transparent; color:rgba(255,255,255,.9); font-size:18px;
  line-height:18px; cursor:pointer;
}
.sir-formula-menu {
  position:absolute; z-index:3; right:0; top:46px; padding:4px;
  border:1px solid rgba(255,255,255,.1); border-radius:6px; background:#242424;
  box-shadow:0 8px 20px rgba(0,0,0,.3);
}
.sir-formula-menu button {
  display:block; width:100%; min-width:96px; height:26px; border:0; border-radius:4px; background:transparent;
  color:#fff; cursor:pointer; text-align:left; padding:0 8px;
}
.sir-formula-menu button:hover { background:rgba(255,255,255,.08); }
.sir-formula-menu button.is-danger { color:#ff8e8e; }
.sir-formula-body { padding:0 0 14px; }
.sir-formula-field { display:grid; gap:6px; margin-bottom:10px; }
.sir-formula-field > span { color:rgba(255,255,255,.48); font-size:12px; }
.sir-formula-label { display:flex; align-items:center; gap:4px; }
.sir-formula-error { color:var(--gc-danger, #e0795f); font-size:11px; line-height:18px; cursor:help; }
.sir-formula-error:focus-visible { outline:1px solid var(--gc-danger, #e0795f); outline-offset:2px; border-radius:2px; }
.sir-formula-error-tooltip {
  box-sizing:border-box; max-width:min(360px, calc(100vw - 16px)); padding:7px 10px;
  border:1px solid rgba(255,255,255,.14); border-radius:7px;
  background:var(--color-background-floating, #333); color:rgba(255,255,255,.86);
  box-shadow:0 6px 18px rgba(0,0,0,.4); font-size:11px; line-height:1.45;
  overflow-wrap:anywhere; pointer-events:none;
}
.sir-formula-error-ai { margin-left:1px; }
.sir-formula-help-trigger {
  width:14px; height:14px; padding:0; border:0; border-radius:50%;
  display:inline-flex; align-items:center; justify-content:center;
  background:transparent; color:rgba(255,255,255,.42); cursor:pointer;
}
.sir-formula-help-trigger:hover,
.sir-formula-help-trigger[aria-expanded='true'] { color:rgba(255,255,255,.88); background:rgba(255,255,255,.08); }
.sir-formula-help-trigger:focus-visible { outline:1px solid var(--gc-accent, #f08840); outline-offset:2px; }
.sir-formula-help-trigger svg { width:12px; height:12px; display:block; }
.sir-formula-help {
  box-sizing:border-box; max-width:calc(100vw - 16px); max-height:min(440px, calc(100vh - 16px));
  overflow:auto; padding:12px 14px; border:1px solid rgba(255,255,255,.14); border-radius:8px;
  background:var(--color-background-floating, #333); color:rgba(255,255,255,.78);
  box-shadow:0 8px 24px rgba(0,0,0,.45); font-size:12px; line-height:1.55;
}
.sir-formula-help::before {
  content:''; position:absolute; width:8px; height:8px; background:inherit;
  border:inherit; transform:rotate(45deg); pointer-events:none;
}
.sir-formula-help[data-side='below']::before { top:-5px; left:calc(var(--ns-arrow) - 4px); border-right:0; border-bottom:0; }
.sir-formula-help[data-side='above']::before { bottom:-5px; left:calc(var(--ns-arrow) - 4px); border-left:0; border-top:0; }
.sir-formula-help[data-side='right']::before { left:-5px; top:calc(var(--ns-arrow) - 4px); border-right:0; border-top:0; }
.sir-formula-help[data-side='left']::before { right:-5px; top:calc(var(--ns-arrow) - 4px); border-left:0; border-bottom:0; }
.sir-formula-help h3 { margin:0 0 8px; color:rgba(255,255,255,.94); font-size:13px; }
.sir-formula-help-list { display:grid; gap:8px; margin:0; padding:0; list-style:none; }
.sir-formula-help-list > li { position:relative; padding-left:12px; }
.sir-formula-help-list > li::before { content:'·'; position:absolute; left:1px; color:var(--gc-accent, #f08840); }
.sir-formula-help strong { color:rgba(255,255,255,.94); font-weight:600; }
.sir-formula-help p { margin:2px 0 0; color:rgba(255,255,255,.62); }
.sir-formula-help code { font-family:var(--font-mono, ui-monospace, monospace); color:rgba(255,255,255,.9); }
.sir-formula-help-example { display:block; margin-top:4px; padding:5px 7px; border-radius:5px; background:rgba(0,0,0,.24); overflow-wrap:anywhere; }
.sir-formula-help-example .gc-fx-hole-tag { padding:1px 3px; }
.sir-formula-field > input {
  box-sizing:border-box; width:100%; height:24px; padding:0 8px;
  border:0; border-radius:6px; outline:0; background:rgba(0,0,0,.55);
  color:rgba(255,255,255,.88);
}
.sir-formula-field > input:focus {
  outline:0; box-shadow:none;
}
.sir-formula-empty { padding:20px 0; color:rgba(255,255,255,.38); }

/* ── 公式行弹窗（重命名 / 删除）—— 居中模态 ── */
.sir-modal-backdrop {
  position:fixed; inset:0; z-index:100;
  background:rgba(0,0,0,.55);
  display:flex; align-items:center; justify-content:center;
  padding:16px;
}
.sir-modal {
  box-sizing:border-box; width:min(420px, 100%);
  background:#161310; border:1px solid rgba(255,255,255,.08);
  border-radius:10px; padding:24px 28px 20px;
  box-shadow:0 20px 50px rgba(0,0,0,.5);
  color:#fff;
  display:flex; flex-direction:column; gap:16px;
}
.sir-modal-head {
  position:relative; display:flex; align-items:center; justify-content:center;
  font-size:16px; font-weight:500;
}
.sir-modal-close {
  position:absolute; right:-4px; top:-4px;
  width:24px; height:24px; border:0; background:transparent; color:rgba(255,255,255,.6);
  cursor:pointer; border-radius:4px; padding:0;
  display:inline-flex; align-items:center; justify-content:center;
}
.sir-modal-close:hover { background:rgba(255,255,255,.08); }
.sir-modal-close svg { width:14px; height:14px; display:block; }
.sir-modal-field { display:flex; flex-direction:column; gap:6px; }
.sir-modal-field > label { font-size:12px; color:rgba(255,255,255,.6); }
.sir-modal-input {
  box-sizing:border-box; width:100%; height:32px; padding:4px 10px;
  border:1px solid rgba(255,255,255,.18); border-radius:4px;
  background:rgba(0,0,0,.4); color:#fff; font-size:14px; outline:0;
}
.sir-modal-input:focus { border-color:rgba(255,255,255,.4); }
.sir-modal-input::placeholder { color:rgba(255,255,255,.32); }
.sir-modal-body { font-size:13px; line-height:1.6; color:rgba(255,255,255,.72); text-align:center; padding:8px 0; }
.sir-modal-body strong { color:rgba(255,156,42,1); font-weight:600; }
.sir-modal-actions { display:flex; justify-content:center; gap:24px; margin-top:4px; }
.sir-modal-btn {
  min-width:96px; height:34px; padding:0 18px; border:0; border-radius:4px;
  font-size:14px; cursor:pointer; transition:background-color .12s;
}
/* 按钮 hover 把背景变亮，显式钉死 color 避免文字色漂移；disabled 不响应 hover。 */
.sir-modal-btn.is-secondary { background:rgba(255,255,255,.92); color:#161310; }
.sir-modal-btn.is-secondary:not(:disabled):hover { background:#fff; color:#161310; }
.sir-modal-btn.is-primary { background:#f08840; color:#17120d; }
.sir-modal-btn.is-primary:not(:disabled):hover { background:#f59b56; color:#17120d; }
.sir-modal-btn:disabled { cursor:not-allowed; opacity:.4; }
`

function field(label: string, node: JSX.Element): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={lbl}>{label}</span>
      {node}
    </label>
  )
}

function EditableIdInput({ value, existing, rename, onRename, label, className }: {
  value: string
  existing: Record<string, unknown>
  rename: Omit<ScenarioIdRename, 'newId'> | { kind: 'attribute'; entityId: string; oldId: string }
  onRename: (rename: ScenarioIdRename) => { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
  label: string
  className?: string
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const next = draft.trim()
  const error = !next ? 'ID 不能为空' : next !== value && Object.hasOwn(existing, next) ? 'ID 已存在' : ''
  const commit = (): void => {
    if (error) { window.alert(`${label} 无法修改：${error}`); setDraft(value); return }
    if (next === value) return
    const result = onRename({ ...rename, newId: next } as ScenarioIdRename)
    if (!result.ok) { window.alert(`${label} 无法修改：ID 已存在`); setDraft(value) }
  }
  return <input className={className} value={draft} aria-label={label} aria-invalid={Boolean(error)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() } }} />
}

function ValueSettings({ values, onChange, label }: {
  values: Pick<AttrMeta, 'min' | 'max' | 'initial'>
  onChange: (field: 'min' | 'max' | 'initial', value: number | undefined) => void
  label: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const configured = (['min', 'max', 'initial'] as const).filter((field) => values[field] !== undefined)
  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 2 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', color: open ? '#d0c7b7' : '#918a7e', fontSize: 11, background: 'none', border: 0, cursor: 'pointer' }}
      >
        <span style={{ width: 10, color: '#b6a78d', fontSize: 13 }}>{open ? '⌄' : '›'}</span>
        <span>高级设置</span>
        {configured.length === 0 ? <span style={{ opacity: 0.55 }}>未配置</span> : configured.map((field) => (
          <span key={field} style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(184,161,117,.14)', color: '#c9b68e' }}>
            {field === 'min' ? '最小' : field === 'max' ? '最大' : '初始'} {values[field]}
          </span>
        ))}
      </button>
      {open ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, margin: '3px 0 5px', padding: '8px 10px 10px', background: 'rgba(176,151,105,.08)', border: '1px solid rgba(184,161,117,.2)', borderLeft: '2px solid #9f875d', borderRadius: 4 }}>
          {(['min', 'max', 'initial'] as const).map((field) => (
            <label key={field} style={{ display: 'grid', gap: 5, fontSize: 10, color: '#b2aa9c' }}>
              {field === 'min' ? '最小值' : field === 'max' ? '最大值' : '初始值'}
              <div style={{ display: 'flex', gap: 3 }}>
                <OptionalNumberInput value={values[field]} label={`${label} ${field}`} onCommit={(value) => onChange(field, value)} />
                {values[field] !== undefined ? <button type="button" onClick={() => onChange(field, undefined)} title={`清空${field}`} aria-label={`清空${field}`} style={{ padding: '0 5px', color: '#aab6c7', border: 0, background: 'none' }}>×</button> : null}
              </div>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function OptionalNumberInput({ value, onCommit, label }: { value?: number; onCommit: (value: number | undefined) => void; label: string }): JSX.Element {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  useEffect(() => setDraft(value == null ? '' : String(value)), [value])
  return <input className="gc-rule-range-input" type="text" inputMode="decimal" value={draft} aria-label={label} placeholder="未设置" onChange={(e) => {
    const next = e.target.value
    if (/^-?(?:\d+)?(?:\.\d*)?$/.test(next)) setDraft(next)
  }} onBlur={() => {
    const raw = draft.trim()
    const parsed = Number(raw)
    onCommit(raw && Number.isFinite(parsed) ? parsed : undefined)
  }} />
}

function ScalarValueInput({ value, onChange, label, style }: {
  value: ScalarValue
  onChange: (value: ScalarValue) => void
  label: string
  style?: CSSProperties
}): JSX.Element {
  return (
    <div className="gc-rule-scalar-input">
      {typeof value === 'string'
        ? <input type="text" value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} style={style} />
        : <LooseNumberInput value={value} aria-label={label} emptyValue={0} onChange={onChange} style={style} />}
    </div>
  )
}

function RuleOverflowAction({ label, currentName, onRename, onDelete }: {
  label: string
  currentName: string
  onRename: (name: string) => void
  onDelete: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return

    const closeWhenOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <span ref={rootRef} className="gc-rule-overflow">
      <button type="button" className="gc-rule-icon-button" aria-label={`${label}更多操作`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>⋯</button>
      {open ? (
        <span className="gc-rule-menu" role="menu">
          <button type="button" onClick={() => { setOpen(false); setDialog('rename') }}>重命名</button>
          <button type="button" onClick={() => { setOpen(false); setDialog('delete') }}>删除</button>
        </span>
      ) : null}
      {dialog ? <RuleActionDialog
        action={dialog}
        label={label}
        currentName={currentName}
        onClose={() => setDialog(null)}
        onRename={(name) => { onRename(name); setDialog(null) }}
        onDelete={() => { onDelete(); setDialog(null) }}
      /> : null}
    </span>
  )
}

function RuleActionDialog({ action, label, currentName, onClose, onRename, onDelete }: {
  action: 'rename' | 'delete'
  label: string
  currentName: string
  onClose: () => void
  onRename: (name: string) => void
  onDelete: () => void
}): JSX.Element {
  const [name, setName] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)
  const noun = label.replace(/^(实体|属性|变量|公式)\s+/, '').trim()

  useEffect(() => {
    if (action === 'rename') inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [action, onClose])

  return createPortal(
    <div className="gc-rule-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="gc-rule-dialog" role="dialog" aria-modal="true" aria-label={`${action === 'rename' ? '重命名' : '删除'}${label}`}>
        <button type="button" className="gc-rule-dialog-close" aria-label="关闭弹窗" onClick={onClose}>×</button>
        {action === 'rename' ? <>
          <h2>重命名{label}</h2>
          <input ref={inputRef} className="gc-rule-dialog-input" aria-label={`${label}新名称`} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) onRename(name.trim())
          }} />
          <div className="gc-rule-dialog-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="is-danger" disabled={!name.trim()} onClick={() => onRename(name.trim())}>确认</button>
          </div>
        </> : <>
          <h2>删除{label}</h2>
          <p>确认删除<span>{noun}</span>吗？工程中对这个{label.startsWith('实体') ? '实体' : '属性'}的调用引用将被清除。</p>
          <div className="gc-rule-dialog-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="is-danger" onClick={onDelete}>删除</button>
          </div>
        </>}
      </section>
    </div>,
    document.body,
  )
}

function NewEntityDialog({ defaultId, existing, onClose, onCreate }: {
  defaultId: string
  existing: Record<string, Entity>
  onClose: () => void
  onCreate: (name: string, id: string) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [id, setId] = useState(defaultId)
  const nameRef = useRef<HTMLInputElement>(null)
  const validId = Boolean(id.trim()) && !Object.hasOwn(existing, id.trim())
  const canCreate = Boolean(name.trim()) && validId

  useEffect(() => {
    nameRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return createPortal(
    <div className="gc-rule-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="gc-rule-dialog gc-rule-new-entity-dialog" role="dialog" aria-modal="true" aria-label="新建实体">
        <h2>新建</h2>
        <label>实体名称
          <input ref={nameRef} aria-label="实体名称" placeholder="例如:主角" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>实体id
          <input aria-label="实体id" placeholder="这里默认填入的是当前已有实体id的数值+1" value={id} onChange={(event) => setId(event.target.value)} />
        </label>
        <div className="gc-rule-dialog-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="is-danger" disabled={!canCreate} onClick={() => onCreate(name.trim(), id.trim())}>确认</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function NewVariableDialog({ defaultId, existing, onClose, onCreate }: {
  defaultId: string
  existing: Record<string, Variable>
  onClose: () => void
  onCreate: (name: string, id: string) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [id, setId] = useState(defaultId)
  const nameRef = useRef<HTMLInputElement>(null)
  const valid = Boolean(name.trim() && id.trim() && !Object.hasOwn(existing, id.trim()))
  useEffect(() => {
    nameRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return createPortal(
    <div className="gc-rule-dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="gc-rule-dialog gc-rule-new-entity-dialog" role="dialog" aria-modal="true" aria-label="新建变量">
        <h2>新建</h2>
        <label>变量名称<input ref={nameRef} aria-label="变量名称" placeholder="例如:金币" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>变量id<input aria-label="变量id" placeholder="这里默认填入的是当前已有变量id的数值+1" value={id} onChange={(event) => setId(event.target.value)} /></label>
        <div className="gc-rule-dialog-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="is-danger" disabled={!valid} onClick={() => onCreate(name.trim(), id.trim())}>确认</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

/** 自动分配与 Record key 对齐的 id（添加时用）。 */
function allocId(prefix: string, existing: Record<string, unknown>): string {
  let i = Object.keys(existing).length
  let id = `${prefix}${i}`
  while (existing[id]) {
    i += 1
    id = `${prefix}${i}`
  }
  return id
}

const ATTR_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

function clampRuleValue(value: number, meta: Pick<AttrMeta, 'min' | 'max'> | undefined): number {
  let next = value
  if (meta?.min !== undefined) next = Math.max(meta.min, next)
  if (meta?.max !== undefined) next = Math.min(meta.max, next)
  return next
}

function normalizeRange<T extends Pick<AttrMeta, 'min' | 'max' | 'initial'>>(
  meta: T,
  changedField: 'min' | 'max' | 'initial',
): T {
  const next = { ...meta }
  if (next.min !== undefined && next.max !== undefined && next.min > next.max) {
    if (changedField === 'min') next.max = next.min
    else next.min = next.max
  }
  if (next.initial !== undefined) next.initial = clampRuleValue(next.initial, next)
  return next as T
}

function AttributeIdInput({
  id,
  onCommit,
}: {
  id: string
  onCommit: (nextId: string) => string | undefined
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const commit = (input: HTMLInputElement): void => {
    const nextId = draft.trim()
    if (!nextId) return
    const error = onCommit(nextId)
    if (error) {
      input.setCustomValidity(error)
      input.reportValidity()
      return
    }
    input.setCustomValidity('')
  }

  return (
    <input
      value={draft}
      placeholder={id}
      aria-label={`属性「${id}」的 id`}
      pattern="[A-Za-z_][A-Za-z0-9_-]*"
      style={{ width: 84 }}
      title="属性 id：用于 entity.<实体id>.attr.<属性id> 引用；修改已有 id 可能需要同步检查公式和绑定"
      onChange={(e) => {
        e.currentTarget.setCustomValidity('')
        setDraft(e.currentTarget.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit(e.currentTarget)
        }
        if (e.key === 'Escape') {
          setDraft('')
          e.currentTarget.setCustomValidity('')
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => commit(e.currentTarget)}
    />
  )
}


/** 引用角标：被 N 个节点挂载引用；0 = 未被引用（灰）。 */
function UsageBadge({ count }: { count: number }): JSX.Element {
  const used = count > 0
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        background: used ? 'rgba(80,180,120,0.16)' : 'rgba(255,255,255,0.06)',
        color: used ? '#7fdda6' : '#8a8a8a',
        border: `1px solid ${used ? 'rgba(80,180,120,0.4)' : 'rgba(255,255,255,0.12)'}`,
      }}
      title={used ? `被 ${count} 个节点的 overlayNodes 引用` : '资源池里的闲置界面包（可保留）'}
    >
      {used ? `被 ${count} 个节点引用` : '未被引用'}
    </span>
  )
}

export type ScenarioSection = 'overlays' | 'variables' | 'entities' | 'formulas'

function RuleToolbar({
  title,
  search,
  onSearchChange,
  onCreate,
}: {
  title: string
  search: string
  onSearchChange: (value: string) => void
  onCreate: () => void
}): JSX.Element {
  return (
    <div className="gc-rule-toolbar" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
      <span className="gc-rule-section-title">{title}</span>
      <button type="button" className="gc-rule-button" aria-label={`＋ 新建${title}`} onClick={onCreate}>
        <span className="gc-rule-button-icon" aria-hidden />
        <span>新建{title}</span>
      </button>
      <label className="gc-rule-search-wrap">
        <span className="gc-rule-search-icon" aria-hidden><img src={searchIcon} alt="" /></span>
        <input className="gc-rule-search" aria-label={`搜索${title}`} placeholder={`搜索${title}`} value={search} onChange={(event) => onSearchChange(event.target.value)} />
      </label>
    </div>
  )
}

export function ScenarioInspector({
  value,
  section,
  overlayUsage,
  focusItemId,
  onChange,
  onRenameId = () => ({ ok: false, reason: 'not_found' }),
}: {
  value: ScenarioMeta
  section?: ScenarioSection
  /** overlayId → 被多少节点挂载引用（资源池「已用/未用」角标）。 */
  overlayUsage?: Record<string, number>
  /** 外侧规则树请求定位的同域条目。 */
  focusItemId?: string | null
  onChange: (next: ScenarioMeta) => void
  onRenameId?: (rename: ScenarioIdRename) => { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
}): JSX.Element {
  injectStyleOnce('scenario-inspector-formulas', FORMULA_RULES_CSS)
  const show = (s: ScenarioSection) => !section || section === s
  const variables = value.variables ?? {}
  const entities = value.entities ?? {}
  const formulas = value.formulas ?? {}
  const allOverlays = value.ui?.overlays ?? {}
  // 「通用样式」= 自由方案 + 基础覆盖物；排除每节点自动内容 overlay（node:*）。
  const schemeIds = listSchemeAndBaseOverlayIds(allOverlays)
  // 标题输入本地缓存：onChange 自由输入，onBlur 时提交到 renameScheme 做重名校验。
  const [schemeLocalTitles, setSchemeLocalTitles] = useState<Record<string, string>>({})
  const [variableSearch, setVariableSearch] = useState('')
  const [entitySearch, setEntitySearch] = useState('')
  const [formulaSearch, setFormulaSearch] = useState('')
  const [newVariableOpen, setNewVariableOpen] = useState(false)
  const [newEntityOpen, setNewEntityOpen] = useState(false)
  useEffect(() => {
    if (section === 'formulas' && focusItemId) setFormulaSearch('')
  }, [focusItemId, section])
  useEffect(() => {
    if (!focusItemId) return
    document.getElementById(`rule-item:${focusItemId}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusItemId, formulaSearch, section])
  const setOverlays = (overlays: Record<string, Overlay>) => onChange({ ...value, ui: { ...value.ui, overlays } })
  const patchOverlayChildInMeta = (
    overlayId: string,
    childId: string,
    patch: { inputs?: Record<string, unknown>; component?: string; layout?: Partial<Layout> },
  ) => {
    const ov = allOverlays[overlayId]
    if (!ov) return
    setOverlays({
      ...allOverlays,
      [overlayId]: {
        ...ov,
        children: ov.children.map((c) =>
          c.id !== childId
            ? c
            : {
                ...c,
                ...(patch.component != null ? { component: patch.component } : {}),
                inputs: patch.inputs ? { ...c.inputs, ...patch.inputs } : c.inputs,
                layout: patch.layout ? { ...c.layout, ...patch.layout } : c.layout,
              },
        ),
      },
    })
  }
  const addSchemeChild = (overlayId: string, presetId: string) => {
    const ov = allOverlays[overlayId]
    const preset = NEW_COMPONENT_PRESETS.find((p) => p.id === presetId)
    if (!ov || !preset) return
    const childId = `${presetId}-${Object.keys(ov.children).length}-${Date.now().toString(36)}`
    setOverlays({ ...allOverlays, [overlayId]: { ...ov, children: [...ov.children, preset.make(childId)] } })
  }
  const removeSchemeChild = (overlayId: string, childId: string) => {
    const ov = allOverlays[overlayId]
    if (!ov) return
    setOverlays({ ...allOverlays, [overlayId]: { ...ov, children: ov.children.filter((c) => c.id !== childId) } })
  }
  const renameScheme = (overlayId: string, title: string) => {
    const ov = allOverlays[overlayId]
    if (!ov) return
    if (overlayTitleExists(allOverlays, title, overlayId)) {
      window.alert(`界面方案名称「${title.trim()}」已存在`)
      return
    }
    setOverlays({ ...allOverlays, [overlayId]: { ...ov, title } })
  }
  const addScheme = () => {
    const id = allocId('scheme-', allOverlays)
    setOverlays({
      ...allOverlays,
      [id]: { id, title: nextUniqueOverlayTitle(allOverlays), children: [] },
    })
  }
  const removeScheme = (overlayId: string) => {
    const { [overlayId]: _drop, ...rest } = allOverlays
    setOverlays(rest)
  }
  const setVariables = (v: Record<string, Variable>) => onChange({ ...value, variables: v })
  const setEntities = (e: Record<string, Entity>) => onChange({ ...value, entities: e })
  const setFormulas = (f: Record<string, Formula>) => onChange({ ...value, formulas: f })
  const normalizedFormulaSearch = formulaSearch.trim().toLocaleLowerCase()
  const normalizedVariableSearch = variableSearch.trim().toLocaleLowerCase()
  const normalizedEntitySearch = entitySearch.trim().toLocaleLowerCase()
  const variableEntries = Object.entries(variables).filter(([id, variable]) =>
    !normalizedVariableSearch || [id, variable.name].some((part) => part?.toLocaleLowerCase().includes(normalizedVariableSearch)))
  const entityEntries = Object.entries(entities).filter(([id, entity]) =>
    !normalizedEntitySearch || [id, entity.name].some((part) => part?.toLocaleLowerCase().includes(normalizedEntitySearch))).reverse()
  const formulaEntries = Object.entries(formulas).filter(([id, formula]) => {
    if (!normalizedFormulaSearch) return true
    return [id, formula.name, formula.description]
      .some((part) => part?.toLocaleLowerCase().includes(normalizedFormulaSearch))
  })

  return (
    <div className="gc-rule-root">
      {show('overlays') && (
        <>
          <div style={sectionTitle}>
            <b>通用样式 · 界面方案</b>
            <button onClick={addScheme}>+ 方案</button>
          </div>
          <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 6 }}>
            自由可复用的界面方案（与节点解耦）：预览显示该方案的全部组件；节点在蓝图/挂载处引用方案。
          </div>
          {schemeIds.length === 0 ? (
            <div style={{ opacity: 0.5 }}>暂无方案</div>
          ) : (
            schemeIds.map((id) => {
              const ov = allOverlays[id]
              if (!ov) return null
              return (
                <div key={id} style={box}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <input
                      value={schemeLocalTitles[id] ?? ov.title ?? ''}
                      placeholder={id}
                      onChange={(e) => setSchemeLocalTitles((prev) => ({ ...prev, [id]: e.target.value }))}
                      onBlur={(e) => {
                        const local = schemeLocalTitles[id]
                        // 先清理本地缓存，保证聚焦后 value 回退到 ov.title
                        setSchemeLocalTitles((prev) => {
                          const next = { ...prev }
                          delete next[id]
                          return next
                        })
                        if (local !== undefined && local !== (ov.title ?? '')) {
                          renameScheme(id, local)
                          // 延迟聚焦：避免同步 blur→focus 触发重复 blur 事件
                          setTimeout(() => {
                            ;(e.target as HTMLInputElement).focus()
                          }, 0)
                        }
                      }}
                      style={{ flex: 1, fontWeight: 600 }}
                    />
                    <UsageBadge count={overlayUsage?.[id] ?? 0} />
                    <button style={del} onClick={() => removeScheme(id)}>删除</button>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>{id}</div>
                  <OverlayCatalogPreview overlay={ov} entities={entities} variables={variables} />
                  <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>组件（{ov.children.length}）</span>
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) addSchemeChild(id, e.target.value) }}
                        style={{ fontSize: 11 }}
                      >
                        <option value="">+ 添加组件…</option>
                        {NEW_COMPONENT_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    {ov.children.map((child) => (
                      <div key={child.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <OverlayChildStyleEditor
                            child={child}
                            onPatchParams={(patch) => patchOverlayChildInMeta(id, child.id, { inputs: patch })}
                            onPatchComponent={(component) => patchOverlayChildInMeta(id, child.id, { component })}
                            onPatchLayout={(patch) => patchOverlayChildInMeta(id, child.id, { layout: patch })}
                          />
                        </div>
                        <button style={{ ...del, marginTop: 6 }} onClick={() => removeSchemeChild(id, child.id)} title="移除组件">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </>
      )}

      {show('variables') && (
        <>
          <RuleToolbar
            title="变量"
            search={variableSearch}
            onSearchChange={setVariableSearch}
            onCreate={() => setNewVariableOpen(true)}
          />
          {newVariableOpen ? <NewVariableDialog
            defaultId={allocId('var', variables)}
            existing={variables}
            onClose={() => setNewVariableOpen(false)}
            onCreate={(name, id) => {
              setVariables({ ...variables, [id]: { id, name, initial: 0, value: 0 } })
              setNewVariableOpen(false)
            }}
          /> : null}
          {Object.keys(variables).length > 0 ? <div className="gc-rule-grid-head gc-rule-grid-head--attributes gc-rule-variable-head" aria-hidden>
            <span>变量名 + id</span><span>初始值</span><span>最小值</span><span>最大值</span><span />
          </div> : null}
          {variableEntries.map(([key, v]) => (
            <div key={key} id={`rule-item:${key}`} className="gc-rule-attribute-row gc-rule-variable-row">
              <div className={`gc-rule-id-pair${v.name ? '' : ' is-display-empty'}`}>
                <input value={v.name ?? ''} placeholder="变量名" aria-label={`${v.id} 的名称`} onChange={(e) => setVariables({ ...variables, [key]: { ...v, id: key, name: e.target.value } })} />
                <EditableIdInput value={v.id} existing={variables} rename={{ kind: 'variable', oldId: key }} onRename={onRenameId} label="变量 ID" />
              </div>
              <ScalarValueInput
                value={v.initial ?? 0}
                label={`${v.id} 的初值`}
                onChange={(initial) => setVariables({
                  ...variables,
                  [key]: {
                    ...v,
                    id: key,
                    initial: typeof initial === 'number' ? clampRuleValue(initial, v) : initial,
                    value: typeof initial === 'number' ? clampRuleValue(initial, v) : initial,
                  },
                })}
                style={{ width: '100%', minWidth: 0 }}
              />
              <OptionalNumberInput value={v.min} label={`${v.id} 的最小值`} onCommit={(min) => {
                const normalized = normalizeRange({
                  min,
                  max: v.max,
                  initial: typeof v.initial === 'number' ? v.initial : undefined,
                }, 'min')
                const initial = typeof v.initial === 'number' ? clampRuleValue(v.initial, normalized) : v.initial
                setVariables({ ...variables, [key]: { ...v, ...normalized, initial, value: initial } })
              }} />
              <OptionalNumberInput value={v.max} label={`${v.id} 的最大值`} onCommit={(max) => {
                const normalized = normalizeRange({
                  min: v.min,
                  max,
                  initial: typeof v.initial === 'number' ? v.initial : undefined,
                }, 'max')
                const initial = typeof v.initial === 'number' ? clampRuleValue(v.initial, normalized) : v.initial
                setVariables({ ...variables, [key]: { ...v, ...normalized, initial, value: initial } })
              }} />
              <RuleOverflowAction label={`变量 ${v.name || v.id}`} currentName={v.name || v.id} onRename={(name) => setVariables({ ...variables, [key]: { ...v, id: key, name } })} onDelete={() => {
                const { [key]: _d, ...rest } = variables
                setVariables(rest)
              }} />
            </div>
          ))}
        </>
      )}

      {show('entities') && (
        <>
          <RuleToolbar
            title="实体"
            search={entitySearch}
            onSearchChange={setEntitySearch}
            onCreate={() => setNewEntityOpen(true)}
          />
          {newEntityOpen ? <NewEntityDialog
            defaultId={allocId('ent-', entities)}
            existing={entities}
            onClose={() => setNewEntityOpen(false)}
            onCreate={(name, id) => {
              setEntities({
                ...entities,
                [id]: {
                  id,
                  name,
                  attrs: { attr0: 0 },
                  attrMeta: { attr0: { label: '属性1', initial: 0 } },
                },
              })
              setNewEntityOpen(false)
            }}
          /> : null}
          {entityEntries.map(([key, ent]) => (
            <div key={key} id={`rule-item:${key}`}>
              <EntityRow
                entKey={key}
                ent={ent}
                entities={entities}
                onChange={(next) => setEntities({ ...entities, [key]: { ...next, id: key } })}
                onRename={onRenameId}
                onDelete={() => {
                  const { [key]: _drop, ...rest } = entities
                  setEntities(rest)
                }}
              />
            </div>
          ))}
        </>
      )}

      {show('formulas') && (
        <div className="sir-formulas">
          <RuleToolbar
            title="公式"
            search={formulaSearch}
            onSearchChange={setFormulaSearch}
            onCreate={() => {
                const id = allocId('formula-', formulas)
                setFormulas({
                  ...formulas,
                  [id]: {
                    id,
                    name: id,
                    ast: { t: 'num', id: 'n0', v: 0 },
                    draftEmpty: true,
                  },
                })
              }}
          />
          {formulaEntries.length === 0 ? (
            <div className="sir-formula-empty">{normalizedFormulaSearch ? '没有匹配的公式' : '暂无公式'}</div>
          ) : null}
          {formulaEntries.map(([key, f], index) => (
            <FormulaRow
              key={key}
              formulaKey={key}
              formula={f}
              entities={entities}
              variables={variables}
              defaultExpanded={index === 0 || focusItemId === key}
              focused={focusItemId === key}
              onChange={(next) => setFormulas({ ...formulas, [key]: { ...next, id: key } })}
              onDelete={() => {
                const { [key]: _drop, ...rest } = formulas
                setFormulas(rest)
              }}
            />
          ))}
        </div>
      )}

    </div>
  )
}

function EntityRow({
  entKey,
  ent,
  entities,
  onChange,
  onRename,
  onDelete,
}: {
  entKey: string
  ent: Entity
  entities: Record<string, Entity>
  onChange: (next: Entity) => void
  onRename: (rename: ScenarioIdRename) => { ok: true } | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }
  onDelete: () => void
}): JSX.Element {
  const attrs = ent.attrs ?? {}
  const attrMeta = ent.attrMeta ?? {}
  const [expanded, setExpanded] = useState(true)
  const setAttrMeta = (m: Record<string, AttrMeta>) => onChange({ ...ent, id: entKey, attrMeta: m })
  const nextAttributeLabel = (): string => {
    const labels = new Set(Object.values(attrMeta).map((meta) => meta.label).filter(Boolean))
    let index = 1
    while (labels.has(`属性${index}`)) index += 1
    return `属性${index}`
  }
  const addAttribute = (): void => {
    const id = allocId('attr', attrs)
    onChange({
      ...ent,
      id: entKey,
      attrs: { ...attrs, [id]: 0 },
      attrMeta: { ...attrMeta, [id]: { label: nextAttributeLabel(), initial: 0 } },
    })
  }
  const setAttrValue = (attrId: string, value: ScalarValue) => {
    const nextAttrs = { ...attrs, [attrId]: value }
    const nextMeta = { ...attrMeta }

    if (typeof value === 'string') {
      onChange({ ...ent, id: entKey, attrs: nextAttrs, attrMeta: Object.keys(nextMeta).length ? nextMeta : undefined })
      return
    }

    const meta = normalizeRange({ ...nextMeta[attrId], initial: value }, 'initial')
    nextAttrs[attrId] = clampRuleValue(value, meta)
    nextMeta[attrId] = { ...meta, initial: nextAttrs[attrId] }

    onChange({
      ...ent,
      id: entKey,
      attrs: nextAttrs,
      attrMeta: Object.keys(nextMeta).length ? nextMeta : undefined,
    })
  }
  const renameAttr = (currentId: string, nextId: string): string | undefined => {
    const id = nextId.trim()
    if (!id) return '属性 id 不能为空'
    if (!ATTR_ID_PATTERN.test(id)) return '属性 id 需以字母或下划线开头，仅可包含字母、数字、下划线和短横线'
    if (id !== currentId && Object.hasOwn(attrs, id)) return `属性 id「${id}」已存在`
    if (id === currentId) return undefined

    const nextAttrs = Object.fromEntries(
      Object.entries(attrs).map(([key, value]) => [key === currentId ? id : key, value]),
    )
    const nextMeta = Object.fromEntries(
      Object.entries(attrMeta).map(([key, value]) => [key === currentId ? id : key, value]),
    )
    onChange({
      ...ent,
      id: entKey,
      attrs: nextAttrs,
      attrMeta: Object.keys(nextMeta).length ? nextMeta : undefined,
    })
    return undefined
  }
  const removeAttr = (ak: string) => {
    const { [ak]: _a, ...restAttrs } = attrs
    const { [ak]: _m, ...restMeta } = attrMeta
    onChange({ ...ent, id: entKey, attrs: restAttrs, attrMeta: Object.keys(restMeta).length ? restMeta : undefined })
  }

  return (
    <section className="gc-rule-accordion">
      <div className={`gc-rule-accordion-head${ent.name ? '' : ' is-display-empty'}`}>
        <button type="button" className={`gc-rule-accordion-toggle${expanded ? ' is-open' : ''}`} aria-label={`${expanded ? '折叠' : '展开'}实体 ${ent.name || entKey}`} onClick={() => setExpanded((value) => !value)}>›</button>
        <input className="gc-rule-accordion-name" value={ent.name ?? ''} aria-label={`${ent.id} 的名称`} placeholder={entKey} onChange={(e) => onChange({ ...ent, id: entKey, name: e.target.value })} />
        <span className="gc-rule-accordion-id">id:</span>
        <EditableIdInput
          className="gc-rule-accordion-id-input"
          value={entKey}
          existing={entities}
          rename={{ kind: 'entity', oldId: entKey }}
          onRename={onRename}
          label="实体 ID"
        />
        <RuleOverflowAction
          label={`实体 ${ent.name || entKey}`}
          currentName={ent.name || entKey}
          onRename={(name) => onChange({ ...ent, id: entKey, name })}
          onDelete={onDelete}
        />
      </div>
      {expanded ? <div className="gc-rule-accordion-body">
        <div className="gc-rule-grid-head gc-rule-grid-head--attributes"><span>属性名 + id</span><span>初始值</span><span>最小值</span><span>最大值</span><button type="button" className="gc-rule-icon-button" aria-label="新增属性" onClick={addAttribute}>＋</button></div>
      {Object.entries(attrs).map(([ak, av]) => (
        <div key={ak} className="gc-rule-attribute-row">
          <div className={`gc-rule-id-pair${attrMeta[ak]?.label ? '' : ' is-display-empty'}`}>
            <input value={attrMeta[ak]?.label ?? ''} placeholder="属性名" aria-label={`${ent.id} 的属性名称`} onChange={(e) => setAttrMeta({ ...attrMeta, [ak]: { ...attrMeta[ak], label: e.target.value || undefined } })} />
            <EditableIdInput value={ak} existing={attrs} rename={{ kind: 'attribute', entityId: entKey, oldId: ak }} onRename={onRename} label={`${ent.id} 的属性 ID`} />
          </div>
          <ScalarValueInput
            value={av}
            label={`属性「${ak}」的数值`}
            onChange={(value) => setAttrValue(ak, value)}
            style={{ minWidth: 0, width: '100%' }}
          />
          <OptionalNumberInput value={attrMeta[ak]?.min} label={`${ent.id} 的 ${ak} 最小值`} onCommit={(min) => {
            const meta = normalizeRange({ ...attrMeta[ak], initial: typeof av === 'number' ? av : undefined, min }, 'min')
            const value = typeof av === 'number' ? clampRuleValue(av, meta) : av
            onChange({ ...ent, id: entKey, attrs: typeof value === 'number' ? { ...attrs, [ak]: value } : attrs, attrMeta: { ...attrMeta, [ak]: { ...meta, initial: typeof value === 'number' ? value : undefined } } })
          }} />
          <OptionalNumberInput value={attrMeta[ak]?.max} label={`${ent.id} 的 ${ak} 最大值`} onCommit={(max) => {
            const meta = normalizeRange({ ...attrMeta[ak], initial: typeof av === 'number' ? av : undefined, max }, 'max')
            const value = typeof av === 'number' ? clampRuleValue(av, meta) : av
            onChange({ ...ent, id: entKey, attrs: typeof value === 'number' ? { ...attrs, [ak]: value } : attrs, attrMeta: { ...attrMeta, [ak]: { ...meta, initial: typeof value === 'number' ? value : undefined } } })
          }} />
          <RuleOverflowAction
            label={`属性 ${attrMeta[ak]?.label || ak}`}
            currentName={attrMeta[ak]?.label || ak}
            onRename={(name) => setAttrMeta({ ...attrMeta, [ak]: { ...attrMeta[ak], label: name } })}
            onDelete={() => removeAttr(ak)}
          />
        </div>
      ))}
      {Object.keys(attrs).length === 0 ? <div className="gc-rule-empty">暂无属性</div> : null}
      </div> : null}
    </section>
  )
}

function FormulaHelpPopover({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<ReturnType<typeof placeAdaptivePop>>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const titleId = useId()
  const frameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const panel = panelRef.current
      const rect = panel?.getBoundingClientRect()
      setPlacement(placeAdaptivePop(triggerRef.current, {
        width: rect?.width || 360,
        height: rect?.height || 280,
      }))
    }
    const schedulePlacement = (): void => {
      if (frameRef.current != null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        updatePlacement()
      })
    }
    updatePlacement()
    window.addEventListener('resize', schedulePlacement)
    window.addEventListener('scroll', schedulePlacement, true)
    return () => {
      window.removeEventListener('resize', schedulePlacement)
      window.removeEventListener('scroll', schedulePlacement, true)
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) || panelRef.current?.contains(target))) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sir-formula-help-trigger"
        aria-label="查看公式填写帮助"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" />
          <path d="M5.7 5.2a1.45 1.45 0 0 1 2.77.6c0 1.2-1.47 1.25-1.47 2.35" stroke="currentColor" strokeLinecap="round" />
          <circle cx="7" cy="10.25" r=".55" fill="currentColor" />
        </svg>
      </button>
      {open ? createPortal(
        <div
          ref={panelRef}
          id={panelId}
          className="sir-formula-help"
          role="dialog"
          aria-labelledby={titleId}
          data-side={placement?.side ?? 'below'}
          style={placement?.style ?? {
            position: 'fixed',
            width: 'min(360px, calc(100vw - 16px))',
            visibility: 'hidden',
          }}
        >
          <h3 id={titleId}>公式填写帮助</h3>
          {children}
        </div>,
        document.body,
      ) : null}
    </>
  )
}

function FormulaErrorIndicator({ failure }: { failure: FormulaParseFailureSnapshot }): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [placement, setPlacement] = useState<ReturnType<typeof placeAdaptivePop>>(null)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const tooltipId = useId()

  useLayoutEffect(() => {
    if (!visible) {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const rect = tooltipRef.current?.getBoundingClientRect()
      setPlacement(placeAdaptivePop(triggerRef.current, {
        width: rect?.width || 280,
        height: rect?.height || 48,
      }))
    }
    updatePlacement()
    const frame = requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setVisible(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [visible])

  return (
    <>
      <span
        ref={triggerRef}
        className="sir-formula-error"
        role="status"
        tabIndex={0}
        data-error-detail={failure.parserDiagnostic}
        aria-describedby={visible ? tooltipId : undefined}
        onPointerEnter={() => setVisible(true)}
        onPointerLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        公式解析失败
      </span>
      {visible ? createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className="sir-formula-error-tooltip"
          role="tooltip"
          data-side={placement?.side ?? 'below'}
          style={placement?.style ?? {
            position: 'fixed',
            width: 'min(280px, calc(100vw - 16px))',
            visibility: 'hidden',
          }}
        >
          错误详情：{failure.parserDiagnostic}
        </div>,
        document.body,
      ) : null}
    </>
  )
}

function FormulaRow({
  formulaKey,
  formula,
  entities,
  variables,
  defaultExpanded,
  focused,
  onChange,
  onDelete,
}: {
  formulaKey: string
  formula: Formula
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  defaultExpanded: boolean
  focused: boolean
  onChange: (next: Formula) => void
  onDelete: () => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [formulaFailure, setFormulaFailure] = useState<FormulaParseFailureSnapshot | null>(null)
  useEffect(() => {
    if (focused) setExpanded(true)
  }, [focused])
  return (
    <>
    <div id={`rule-item:${formulaKey}`} className="sir-formula-row">
      <div className="sir-formula-head">
        <button
          type="button"
          className={`sir-formula-toggle${expanded ? ' is-open' : ''}`}
          aria-label={`${expanded ? '折叠' : '展开'}公式 ${formula.name || formulaKey}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => {
            if (current) setFormulaFailure(null)
            return !current
          })}
        >
          <svg viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span
          className="sir-formula-name"
          title={formula.name || formulaKey}
        >
          {formula.name || formulaKey}
        </span>
        <span className="sir-formula-id">id:{formulaKey}</span>
        <button
          type="button"
          className="sir-formula-more"
          aria-label={`${formula.name || formulaKey}更多操作`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="sir-formula-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setRenameOpen(true) }}>重命名</button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); setDeleteOpen(true) }}>删除公式</button>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className="sir-formula-body">
          <label className="sir-formula-field">
            <span>描述</span>
            <input
              value={formula.description ?? ''}
              placeholder="如：伤害 = 攻击力 × 倍率 - 防御力"
              onChange={(e) => onChange({ ...formula, id: formulaKey, description: e.target.value || undefined })}
            />
          </label>
          <div className="sir-formula-field">
            <span className="sir-formula-label">
              公式
              <FormulaHelpPopover><FormulaHelpContent /></FormulaHelpPopover>
              {formulaFailure ? (
                <>
                  <FormulaErrorIndicator failure={formulaFailure} />
                  <AiParameterFillButton
                    className="sir-formula-error-ai"
                    ariaLabel="AI 修复公式"
                    title="AI 公式修复暂不可用"
                  />
                </>
              ) : null}
            </span>
            <FormulaTextEditor
              ast={formula.ast}
              empty={formula.draftEmpty}
              entities={entities}
              variables={variables}
              onParseFailureChange={setFormulaFailure}
              onEmpty={() => onChange({ ...formula, id: formulaKey, draftEmpty: true })}
              onChange={(ast) => onChange({
                ...formula,
                id: formulaKey,
                ast,
                draftEmpty: undefined,
              })}
            />
          </div>
        </div>
      ) : null}
    </div>
    {renameOpen ? (
      <FormulaRenameDialog
        initialName={formula.name ?? formulaKey}
        onCancel={() => setRenameOpen(false)}
        onConfirm={(nextName) => {
          setRenameOpen(false)
          onChange({ ...formula, id: formulaKey, name: nextName })
        }}
      />
    ) : null}
    {deleteOpen ? (
      <FormulaDeleteDialog
        name={formula.name || formulaKey}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => { setDeleteOpen(false); onDelete() }}
      />
    ) : null}
  </>
  )
}

/**
 * 公式重命名弹窗（居中模态）。
 * 只有一个「名称」字段（不出现 id），点 ✕ / 背景 / 取消 关闭；确认回调当前名称。
 */
function FormulaRenameDialog({
  initialName,
  onCancel,
  onConfirm,
}: {
  initialName: string
  onCancel: () => void
  onConfirm: (nextName: string) => void
}): JSX.Element {
  const [value, setValue] = useState(initialName)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const submit = (): void => {
    const next = value.trim()
    if (!next || next === initialName) { onCancel(); return }
    onConfirm(next)
  }
  return createPortal(
    <div
      className="sir-modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="sir-modal" role="dialog" aria-modal="true" aria-labelledby="sir-formula-rename-title">
        <div className="sir-modal-head">
          <span id="sir-formula-rename-title">重命名</span>
          <button type="button" className="sir-modal-close" aria-label="关闭" onClick={onCancel}>
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="sir-modal-field">
          <label htmlFor="sir-formula-rename-input">公式名称</label>
          <input
            id="sir-formula-rename-input"
            ref={inputRef}
            className="sir-modal-input"
            value={value}
            placeholder="这里默认填入的是当前公式名"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit() }
            }}
          />
        </div>
        <div className="sir-modal-actions">
          <button type="button" className="sir-modal-btn is-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="sir-modal-btn is-primary" onClick={submit} disabled={!value.trim()}>确认</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 公式删除确认弹窗（居中模态）。
 * 文案：「确认删除[名字]吗？工程中对这公式的调用引用将被清除。」
 */
function FormulaDeleteDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(
    <div
      className="sir-modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="sir-modal" role="dialog" aria-modal="true" aria-labelledby="sir-formula-delete-title">
        <div className="sir-modal-head">
          <span id="sir-formula-delete-title">删除公式</span>
          <button type="button" className="sir-modal-close" aria-label="关闭" onClick={onCancel}>
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="sir-modal-body">
          确认删除<strong>[{name}]</strong>吗？工程中对这公式的调用引用将被清除。
        </div>
        <div className="sir-modal-actions">
          <button type="button" className="sir-modal-btn is-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="sir-modal-btn is-primary" onClick={onConfirm}>删除</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
