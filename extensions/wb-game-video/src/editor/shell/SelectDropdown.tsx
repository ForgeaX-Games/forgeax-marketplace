/**
 * 通用单列下拉：外观与 CascadingPicker 一致，选项为扁平列表（无多级分支）。
 */
import type { JSX } from 'react'
import { CascadingPicker, type CascadingPickerOption } from './CascadingPicker'

export interface SelectDropdownOption {
  value: string
  label: string
  disabled?: boolean
}

export function SelectDropdown({
  ariaLabel,
  value,
  options,
  placeholder = '请选择…',
  onChange,
  narrowSafe = true,
}: {
  ariaLabel: string
  value: string
  options: readonly SelectDropdownOption[]
  placeholder?: string
  onChange: (value: string) => void
  narrowSafe?: boolean
}): JSX.Element {
  const selected = options.find((option) => option.value === value)
  const pickerOptions: CascadingPickerOption[] = options.map((option) => ({
    key: option.value || `__empty:${option.label}`,
    label: option.label,
    value: option.value,
    disabled: option.disabled,
  }))
  return (
    <CascadingPicker
      ariaLabel={ariaLabel}
      value={value}
      displayValue={selected?.label ?? ''}
      placeholder={placeholder}
      options={pickerOptions}
      onSelect={onChange}
      narrowSafe={narrowSafe}
      fitContent
    />
  )
}
