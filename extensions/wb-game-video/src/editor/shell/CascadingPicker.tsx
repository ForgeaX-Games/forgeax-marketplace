import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '../../styles/injectStyle'

export interface CascadingPickerOption {
  key: string
  label: string
  value?: string
  children?: CascadingPickerOption[]
  disabled?: boolean
  presentation?: 'detail' | 'confirm'
  editor?: {
    value: string
    ariaLabel: string
    onChange: (value: string) => void
    inputMode?: 'text' | 'decimal'
    placeholder?: string
    pattern?: string
    invalid?: boolean
  }
}

const CASCADING_PICKER_CSS = `
.gc-cascade-root { position: relative; display: flex; flex: 1; min-width: 0; }
.gc-cascade-trigger {
  box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-width: 180px; min-height: 28px; padding: 4px 8px;
  border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-background-base, #191919);
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.gc-cascade-trigger:hover, .gc-cascade-trigger[aria-expanded="true"] {
  border-color: var(--color-brand-primary, #d4ff48);
}
.gc-cascade-trigger-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gc-cascade-trigger-label.is-placeholder { opacity: .45; }
.gc-cascade-trigger-arrow { flex: none; opacity: .65; }
.gc-cascade-panel {
  z-index: var(--z-top, 9999); box-sizing: border-box; display: flex; align-items: stretch;
  width: max-content; max-width: calc(100vw - 16px);
  height: min(320px, calc(100vh - 16px)); max-height: min(320px, calc(100vh - 16px));
  overflow-x: auto; overflow-y: hidden;
  border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-md, 8px);
  background: var(--color-background-floating, #242424);
  color: var(--color-text-primary, #f3f3f3);
  box-shadow: var(--ks-shadow-lift, 0 10px 28px rgba(0,0,0,.55));
}
.gc-cascade-column {
  box-sizing: border-box; width: 210px; min-width: 210px; height: 100%;
  overflow-y: auto; padding: 5px;
  border-right: 1px solid var(--color-border-default, #404040);
}
.gc-cascade-column.has-editor { width: 280px; min-width: 280px; }
.gc-cascade-column:last-child { border-right: 0; }
.gc-cascade-item {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 30px; padding: 5px 8px;
  border-radius: var(--radius-sm, 4px); color: inherit; cursor: pointer;
}
.gc-cascade-item:hover, .gc-cascade-item:focus-visible, .gc-cascade-item.is-active {
  background: var(--color-background-hover, rgba(255,255,255,.08));
}
.gc-cascade-item.is-selected { color: var(--color-brand-primary, #d4ff48); }
.gc-cascade-item:disabled { opacity: .45; cursor: default; }
.gc-cascade-item.is-detail:disabled { opacity: .78; }
.gc-cascade-item.is-confirm {
  color: var(--color-brand-primary, #d4ff48);
  background: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 10%, transparent);
}
.gc-cascade-item-label {
  min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gc-cascade-item-mark { width: 14px; flex: none; text-align: center; }
.gc-cascade-item-arrow { flex: none; opacity: .55; }
.gc-cascade-editor {
  box-sizing: border-box; display: grid; gap: 4px; width: 100%; padding: 5px 8px;
  color: inherit; font-size: 11px;
}
.gc-cascade-editor-label { opacity: .72; }
.gc-cascade-editor input {
  box-sizing: border-box; width: 100%; min-width: 0; height: 28px; padding: 4px 7px;
  border: 1px solid var(--color-border-default, #505050);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-background-base, #191919); color: inherit; font: inherit;
}
.gc-cascade-editor input:focus { outline: none; border-color: var(--color-brand-primary, #d4ff48); }
.gc-cascade-editor input[aria-invalid="true"] { border-color: var(--color-status-danger, #ef6a6a); }
`

function findOptionPath(
  options: readonly CascadingPickerOption[],
  value: string,
  path: string[] = [],
): string[] | null {
  for (const option of options) {
    const nextPath = [...path, option.key]
    if (option.value === value) return nextPath
    const nested = option.children ? findOptionPath(option.children, value, nextPath) : null
    if (nested) return nested
  }
  return null
}

function optionForKey(
  options: readonly CascadingPickerOption[],
  key: string,
): CascadingPickerOption | undefined {
  return options.find((option) => option.key === key)
}

function menuColumns(
  options: readonly CascadingPickerOption[],
  activePath: readonly string[],
): CascadingPickerOption[][] {
  const columns: CascadingPickerOption[][] = [[...options]]
  let current = options
  for (const key of activePath) {
    const active = optionForKey(current, key)
    if (!active?.children?.length) break
    columns.push(active.children)
    current = active.children
  }
  return columns
}

export function CascadingPicker({
  ariaLabel,
  value,
  displayValue,
  placeholder,
  options,
  onSelect,
}: {
  ariaLabel: string
  value: string
  displayValue: string
  placeholder?: string
  options: readonly CascadingPickerOption[]
  onSelect: (value: string) => void
}): JSX.Element {
  injectStyleOnce('gc-cascading-picker', CASCADING_PICKER_CSS)
  const [open, setOpen] = useState(false)
  const [activePath, setActivePath] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)

  const columns = menuColumns(options, activePath)

  function openPicker(): void {
    setActivePath((findOptionPath(options, value) ?? []).slice(0, -1))
    setOpen(true)
  }

  function choose(option: CascadingPickerOption, depth: number): void {
    if (option.disabled) return
    if (option.children?.length) {
      setActivePath((current) => [...current.slice(0, depth), option.key])
      return
    }
    if (option.value == null) return
    onSelect(option.value)
    setOpen(false)
  }

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return
    }
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger || typeof window === 'undefined') return
      const rect = trigger.getBoundingClientRect()
      const panelWidth = Math.min(
        Math.max(210, columns.reduce((width, column) =>
          width + (column.some((option) => option.editor) ? 280 : 210), 0)),
        window.innerWidth - 16,
      )
      const panelHeight = Math.min(320, window.innerHeight - 16)
      const gap = 5
      const below = window.innerHeight - rect.bottom
      const placeAbove = below < panelHeight + gap && rect.top > below
      const top = placeAbove
        ? Math.max(8, rect.top - panelHeight - gap)
        : Math.min(window.innerHeight - 8, rect.bottom + gap)
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - panelWidth - 8))
      setPanelStyle({ position: 'fixed', top, left })
    }
    place()
    requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, columns.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const panel = open && panelStyle ? (
    <div
      ref={panelRef}
      className="gc-cascade-panel"
      role="menu"
      aria-label={`${ariaLabel}选项`}
      style={panelStyle}
    >
      {columns.map((column, depth) => (
        <div
          className={`gc-cascade-column${column.some((option) => option.editor) ? ' has-editor' : ''}`}
          role="group"
          key={`${depth}:${activePath[depth - 1] ?? 'root'}`}
        >
          {column.map((option) => {
            const active = activePath[depth] === option.key
            const selected = option.value === value
            if (option.editor) {
              return (
                <label className="gc-cascade-editor" role="none" key={option.key}>
                  <span className="gc-cascade-editor-label">{option.label}</span>
                  <input
                    value={option.editor.value}
                    aria-label={option.editor.ariaLabel}
                    aria-invalid={option.editor.invalid || undefined}
                    inputMode={option.editor.inputMode}
                    placeholder={option.editor.placeholder}
                    pattern={option.editor.pattern}
                    onChange={(event) => option.editor?.onChange(event.target.value)}
                  />
                </label>
              )
            }
            return (
              <button
                type="button"
                role="menuitem"
                aria-label={option.label}
                className={[
                  'gc-cascade-item',
                  active ? 'is-active' : '',
                  selected ? 'is-selected' : '',
                  option.presentation === 'detail' ? 'is-detail' : '',
                  option.presentation === 'confirm' ? 'is-confirm' : '',
                ].filter(Boolean).join(' ')}
                aria-haspopup={option.children?.length ? 'menu' : undefined}
                aria-expanded={option.children?.length ? active : undefined}
                disabled={option.disabled}
                onClick={() => choose(option, depth)}
                onPointerEnter={() => {
                  if (option.children?.length) {
                    setActivePath((current) => [...current.slice(0, depth), option.key])
                  }
                }}
                key={option.key}
              >
                <span className="gc-cascade-item-mark">{selected ? '✓' : ''}</span>
                <span className="gc-cascade-item-label">{option.label}</span>
                {option.children?.length ? <span className="gc-cascade-item-arrow">›</span> : null}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  ) : null

  return (
    <div className="gc-cascade-root" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="gc-cascade-trigger"
        value={value}
        onClick={() => open ? setOpen(false) : openPicker()}
        onChange={(event) => onSelect((event.target as HTMLButtonElement).value)}
      >
        <span className={`gc-cascade-trigger-label${displayValue ? '' : ' is-placeholder'}`}>
          {displayValue || placeholder || ''}
        </span>
        <span className="gc-cascade-trigger-arrow">▾</span>
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
