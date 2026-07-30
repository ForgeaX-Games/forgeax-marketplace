// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Formula } from '../../persist/formula-authoring'
import { FormulaApplyEditor } from '../FormulaApplyEditor'

afterEach(cleanup)

describe('FormulaApplyEditor variable guidance', () => {
  it('prompts the author to create a variable referenced by the selected formula', () => {
    const formula: Formula = {
      id: 'formula-rage',
      name: '怒气伤害',
      ast: { t: 'ref', id: 'r0', ref: { kind: 'var', varId: 'rage' } },
    }
    render(
      <FormulaApplyEditor
        formulaId={formula.id}
        holeBindings={{}}
        formulas={{ [formula.id]: formula }}
        entities={{}}
        variables={{}}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('公式引用的变量「rage」尚未创建，请先到「规则 → 变量」创建变量。')).toBeTruthy()
  })

  it('prompts for creating variables when the selected formula has an unbound variable slot', () => {
    const formula: Formula = {
      id: 'formula-slot',
      name: '变量加成',
      ast: { t: 'hole', id: 'h0', holeId: 'bonus', kind: 'var', label: '加成变量' },
    }
    render(
      <FormulaApplyEditor
        formulaId={formula.id}
        holeBindings={{}}
        formulas={{ [formula.id]: formula }}
        entities={{}}
        variables={{}}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('该公式需要变量，请先到「规则 → 变量」创建变量。')).toBeTruthy()
  })

  it('keeps random sample output stable across unrelated rerenders', () => {
    const formula: Formula = {
      id: 'formula-random',
      name: '随机伤害',
      ast: {
        t: 'unary',
        id: 'neg',
        op: '-',
        x: {
          t: 'call',
          id: 'floor',
          name: 'floor',
          args: [{
            t: 'bin',
            id: 'mul',
            op: '*',
            a: { t: 'num', id: 'base', v: 10 },
            b: {
              t: 'bin',
              id: 'random-factor',
              op: '+',
              a: { t: 'num', id: 'min-factor', v: 0.85 },
              b: {
                t: 'bin',
                id: 'random-span',
                op: '*',
                a: { t: 'call', id: 'rand', name: 'rand', args: [] },
                b: { t: 'num', id: 'span', v: 0.3 },
              },
            },
          }],
        },
      },
    }
    function Harness(): JSX.Element {
      const [, rerender] = useState(0)
      return (
        <>
          <button type="button" onClick={() => rerender((value) => value + 1)}>刷新</button>
          <FormulaApplyEditor
            formulaId={formula.id}
            holeBindings={{}}
            formulas={{ [formula.id]: formula }}
            entities={{}}
            variables={{}}
            onChange={vi.fn()}
          />
        </>
      )
    }
    render(<Harness />)
    const first = screen.getByText(/^≈ /).textContent
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(screen.getByText(/^≈ /).textContent).toBe(first)
  })
})
