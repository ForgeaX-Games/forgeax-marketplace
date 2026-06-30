import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface WorkbenchSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
  description?: string;
}

export interface WorkbenchSelectGroup {
  label: string;
  options: WorkbenchSelectOption[];
}

export interface WorkbenchFieldSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: WorkbenchSelectOption[];
  groups?: WorkbenchSelectGroup[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  hint?: ReactNode;
  id?: string;
  /** Controlled open state — use with onOpenChange for single-open groups */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Max height of in-flow option list (scrolls inside the field) */
  menuMaxHeight?: number;
}

function flattenOptions(
  options: WorkbenchSelectOption[] | undefined,
  groups: WorkbenchSelectGroup[] | undefined,
): WorkbenchSelectOption[] {
  const flat: WorkbenchSelectOption[] = [];
  if (options) flat.push(...options);
  if (groups) {
    for (const group of groups) flat.push(...group.options);
  }
  return flat;
}

export function WorkbenchFieldSelect({
  label,
  value,
  onChange,
  options,
  groups,
  placeholder,
  allowEmpty = false,
  emptyLabel = "不限",
  disabled = false,
  hint,
  id,
  open: openProp,
  onOpenChange,
  menuMaxHeight = 168,
}: WorkbenchFieldSelectProps) {
  const fieldId = id ?? `wb-dropdown-${label.replace(/\s+/g, "-")}`;
  const [internalOpen, setInternalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const setOpen = useCallback((next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  }, [isControlled, onOpenChange]);

  const allOptions = useMemo(
    () => flattenOptions(options, groups),
    [options, groups],
  );

  const selected = allOptions.find((opt) => opt.value === value);
  const isUnset = allowEmpty && !value;
  const triggerLabel = selected?.label
    ?? (isUnset ? (placeholder ?? emptyLabel) : placeholder ?? "请选择");
  const triggerIsPlaceholder = !selected?.label;

  const pick = useCallback((next: string) => {
    onChange(next);
    setOpen(false);
  }, [onChange, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  const renderOption = (opt: WorkbenchSelectOption) => {
    const active = opt.value === value;
    return (
      <button
        key={opt.value || "__empty__"}
        type="button"
        role="option"
        aria-selected={active}
        title={opt.title}
        disabled={opt.disabled}
        className={`wb-dropdown-option${active ? " active" : ""}`}
        onClick={() => pick(opt.value)}
      >
        <span className="wb-dropdown-option-label">{opt.label}</span>
        {opt.description && (
          <small className="wb-dropdown-option-desc">{opt.description}</small>
        )}
      </button>
    );
  };

  return (
    <div className="wb-field" ref={rootRef}>
      <span className="wb-field-label" id={`${fieldId}-label`}>{label}</span>
      <div
        className={`wb-dropdown${open ? " open" : ""}${disabled ? " disabled" : ""}`}
        style={{ "--wb-dropdown-menu-max-height": `${menuMaxHeight}px` } as React.CSSProperties}
      >
        <button
          type="button"
          id={fieldId}
          className="wb-dropdown-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${fieldId}-label`}
          disabled={disabled}
          onClick={() => !disabled && setOpen(!open)}
        >
          <span className={`wb-dropdown-value${triggerIsPlaceholder ? " is-placeholder" : ""}`}>{triggerLabel}</span>
          <ChevronDown className="wb-dropdown-chevron" size={14} strokeWidth={2} aria-hidden />
        </button>

        {open && (
          <div className="wb-dropdown-menu workbench-pane-scroll" role="listbox" aria-labelledby={`${fieldId}-label`}>
            {allowEmpty && renderOption({ value: "", label: emptyLabel })}
            {options?.map(renderOption)}
            {groups?.map((group) => (
              <div key={group.label} className="wb-dropdown-group">
                <div className="wb-dropdown-group-label">{group.label}</div>
                {group.options.map(renderOption)}
              </div>
            ))}
          </div>
        )}
      </div>
      {hint && <div className="wb-field-hint">{hint}</div>}
      {!hint && placeholder && !allowEmpty && <div className="wb-field-hint">{placeholder}</div>}
    </div>
  );
}
