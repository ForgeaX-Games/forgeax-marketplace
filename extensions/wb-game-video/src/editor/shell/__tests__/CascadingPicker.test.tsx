// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CascadingPicker, type CascadingPickerOption } from '../CascadingPicker'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const options: CascadingPickerOption[] = [
  {
    key: 'entity',
    label: '实体属性',
    children: [
      {
        key: 'hero',
        label: '主角',
        children: [{
          key: 'hero-hp',
          label: '当前生命',
          secondaryText: '12345678901234567890',
          value: 'entity.hero.attr.hp',
        }],
      },
      {
        key: 'enemy',
        label: '敌方',
        children: [{ key: 'enemy-hp', label: '当前生命', value: 'entity.enemy.attr.hp' }],
      },
    ],
  },
  {
    key: 'variable',
    label: '变量',
    children: [{ key: 'rage', label: '怒气', value: 'var.rage' }],
  },
]

const createOptions: CascadingPickerOption[] = [
  {
    key: 'entity',
    label: '实体',
    children: [
      { key: 'hero', label: '主角', value: 'hero' },
      {
        key: 'create-entity',
        label: '配置「实体」实体',
        presentation: 'create',
        children: [
          {
            key: 'entity-id',
            label: '实体 ID',
            editor: {
              value: 'entity',
              ariaLabel: '新实体 ID',
              onChange: vi.fn(),
            },
          },
          {
            key: 'confirm',
            label: '确认创建并选择',
            value: 'confirm',
            presentation: 'confirm',
          },
        ],
      },
    ],
  },
]

function renderPicker(): void {
  render(
    <CascadingPicker
      ariaLabel="绑定属性"
      value="entity.hero.attr.hp"
      displayValue="主角的当前生命"
      options={options}
      onSelect={vi.fn()}
    />,
  )
}

describe('CascadingPicker interaction stability', () => {
  it('sizes the popup from visible columns and scrolls each column independently', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('combobox', { name: '绑定属性' }))

    const panel = screen.getByRole('menu', { name: '绑定属性选项' })
    expect(panel.style.width).toBe('')
    expect(panel.style.height).toBe('')
    expect(window.getComputedStyle(panel).overflowX).toBe('auto')
    expect(window.getComputedStyle(panel).overflowY).toBe('hidden')
    expect(panel.querySelector('.gc-cascade-content')).toBeTruthy()
    const initialColumns = within(panel).getAllByRole('group')
    expect(initialColumns).toHaveLength(3)
    for (const column of initialColumns) {
      expect(window.getComputedStyle(column).overflowY).toBe('auto')
    }
    const attribute = screen.getByRole('menuitem', { name: '当前生命' })
    const attributeValue = attribute.querySelector('.gc-cascade-item-secondary')
    expect(attribute).toHaveAttribute('title', '当前生命：12345678901234567890')
    expect(attributeValue).toHaveTextContent('12345678901234567890')
    expect(window.getComputedStyle(attributeValue!).fontSize).toBe('10px')
    expect(window.getComputedStyle(attributeValue!).textOverflow).toBe('ellipsis')
    expect(window.getComputedStyle(attributeValue!).maxWidth).toBe('45%')

    fireEvent.click(screen.getByRole('menuitem', { name: '变量' }))
    expect(within(panel).getAllByRole('group')).toHaveLength(2)
    expect(panel.style.width).toBe('')
    expect(panel.style.height).toBe('')
  })

  it('keeps hover passive and only changes branches on click', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('combobox', { name: '绑定属性' }))

    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: '敌方' }))
    expect(screen.getAllByRole('menuitem', { name: '当前生命' })).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: '敌方' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('menuitem', { name: '主角' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('menuitem', { name: '敌方' }))
    expect(screen.getAllByRole('menuitem', { name: '当前生命' })).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: '敌方' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: '主角' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows a named create action and opens its form in a separate popup', () => {
    vi.useFakeTimers()
    render(
      <CascadingPicker
        ariaLabel="实体"
        value="hero"
        displayValue="主角"
        options={createOptions}
        onSelect={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '实体' }))

    const create = screen.getByRole('menuitem', { name: '新增实体' })
    expect(create).toHaveClass('is-create')
    expect(create).toHaveAttribute('title', '配置「实体」实体')
    expect(create).toHaveTextContent('+新增实体')
    expect(create.parentElement).toHaveClass('gc-cascade-create-block')
    expect(window.getComputedStyle(create.parentElement!).borderTopStyle).toBe('solid')
    expect(window.getComputedStyle(create).minHeight).toBe('28px')
    expect(window.getComputedStyle(create).marginLeft).toBe('8px')

    fireEvent.pointerEnter(create)
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()

    const menu = screen.getByRole('menu', { name: '实体选项' })
    const columnCount = within(menu).getAllByRole('group').length
    fireEvent.click(create)

    const dialog = screen.getByRole('dialog', { name: '新增实体' })
    const editor = screen.getByRole('textbox', { name: '新实体 ID' })
    expect(editor.closest('.gc-cascade-create-dialog')).toBe(dialog)
    expect(editor.closest('.gc-cascade-column')).toBeNull()
    expect(within(menu).getAllByRole('group')).toHaveLength(columnCount)
    expect(menu.querySelector('.gc-cascade-column.has-editor')).toBeNull()
    expect(dialog.style.position).toBe('fixed')
    expect(dialog.style.height).toBe('')
    expect(dialog.style.maxHeight).toBe('')
    expect(dialog.style.overflowY).toBe('')

    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm).toHaveClass('is-confirm')
    expect(confirm.children).toHaveLength(1)
    expect(window.getComputedStyle(confirm).justifyContent).toBe('center')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '新增实体' })).toBeNull()
    expect(screen.getByRole('menu', { name: '实体选项' })).toBeTruthy()
  })
})
