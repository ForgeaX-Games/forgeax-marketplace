// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewFormula } from '../../persist/formula-authoring'
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

describe('FormulaTextEditor input state', () => {
  it('renders a new draft formula empty and commits the first expression normally', () => {
    const onChange = vi.fn()
    const onEmpty = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        empty
        onEmpty={onEmpty}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ t: 'num', v: 25 }))
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('selects the initial zero so the first edit replaces it', () => {
    const onChange = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    fireEvent.focus(input)

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(1)

    fireEvent.change(input, { target: { value: '25', selectionStart: 2, selectionEnd: 2 } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ t: 'num', v: 25 }))
  })

  it('inserts a tool fragment at the saved selection after the toolbar takes focus', () => {
    render(
      <FormulaTextEditor
        ast={{
          t: 'bin',
          id: 'sum',
          op: '+',
          a: { t: 'num', id: 'one', v: 1 },
          b: { t: 'num', id: 'two', v: 2 },
        }}
        onChange={vi.fn()}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    const insertHole = screen.getByRole('button', { name: '?参数' })
    fireEvent.focus(input)
    input.setSelectionRange(4, 5)
    fireEvent.select(input)
    fireEvent.blur(input, { relatedTarget: insertHole })
    fireEvent.click(insertHole)

    expect(input.value).toBe('1 + ?参数')
    expect(input.selectionStart).toBe('1 + ?参数'.length)
    expect(input.selectionEnd).toBe('1 + ?参数'.length)
  })
})

describe('FormulaTextEditor authoring syntax', () => {
  const entities = {
    'ent-player': {
      id: 'ent-player',
      name: '玩家',
      attrs: { attack: 80, 'attack-power': 100 },
    },
    'ent-boss': {
      id: 'ent-boss',
      name: '敌人',
      attrs: { defense: 50 },
    },
  }

  it('commits no-space subtraction using the current entity catalog', () => {
    const onChange = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        entities={entities}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    fireEvent.change(input, {
      target: {
        value: 'entity.ent-player.attr.attack-entity.ent-boss.attr.defense',
      },
    })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ t: 'bin', op: '-' }))
  })

  it('normalizes full-width input and Unicode spacing through the shared authoring parser', () => {
    const onChange = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    fireEvent.change(input, {
      target: { value: 'ｍａｘ（　１０　－ ３，０　）' },
    })
    expect(screen.getByText('≈ 7')).toBeTruthy()
    fireEvent.blur(input)

    expect(previewFormula(onChange.mock.calls[0]![0])).toBe('max(10 - 3, 0)')
  })

  it('visually groups hyphenated references without offering score as authoring input', () => {
    const { container } = render(
      <FormulaTextEditor
        ast={{
          t: 'bin',
          id: 'sum',
          op: '+',
          a: {
            t: 'ref',
            id: 'attack',
            ref: { kind: 'entityAttr', entityId: 'ent-player', attr: 'attack-power' },
          },
          b: { t: 'ref', id: 'score', ref: { kind: 'score' } },
        }}
        entities={entities}
        onChange={vi.fn()}
      />,
    )

    expect(container.querySelector('.gc-fx-ref-tag')?.textContent)
      .toBe('entity.ent-player.attr.attack-power')
    expect(container.querySelector('.gc-fx-score-tag')).toBeNull()
    expect(screen.queryByRole('button', { name: '插入局面分' })).toBeNull()
    expect(screen.queryByText(/局面分/)).toBeNull()
  })
})
