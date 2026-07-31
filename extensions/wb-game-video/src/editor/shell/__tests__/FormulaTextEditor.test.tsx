// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FormulaTextEditor } from '../FormulaTextEditor'

afterEach(cleanup)

describe('FormulaTextEditor hole guidance', () => {
  it('highlights holes in both the example and multiline editor with the same tag style', () => {
    const { container } = render(
      <FormulaTextEditor
        ast={{
          t: 'bin',
          id: 'sum',
          op: '+',
          a: { t: 'hole', id: 'h-atk', holeId: '攻击力', kind: 'number', label: '攻击力' },
          b: { t: 'hole', id: 'h-bonus', holeId: '加成', kind: 'number', label: '加成' },
        }}
        onChange={vi.fn()}
      />,
    )

    const example = screen.getByRole('region', { name: '公式示例' })
    expect(within(example).getByText('目标：')).toBeTruthy()
    expect(within(example).getByText(/攻击力乘以技能倍率/)).toBeTruthy()
    expect(example.querySelectorAll('.gc-fx-hole-tag')).toHaveLength(3)

    fireEvent.change(screen.getByRole('textbox', { name: '公式表达式' }), {
      target: { value: '?攻击力 +\n?加成' },
    })
    const highlight = container.querySelector('.gc-fx-highlight')
    expect(highlight?.textContent).toBe('?攻击力 +\n?加成')
    expect(highlight?.querySelectorAll('.gc-fx-hole-tag')).toHaveLength(2)
    expect(container.querySelectorAll('.gc-fx-hole-tag')).toHaveLength(5)
  })
})
