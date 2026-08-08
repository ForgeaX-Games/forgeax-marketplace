// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

afterEach(cleanup)

describe('ScenarioInspector formulas', () => {
  it('creates a formula with an empty expression', () => {
    function Harness(): JSX.Element {
      const [value, setValue] = useState<ScenarioMeta>({})
      return <ScenarioInspector value={value} section="formulas" onChange={setValue} />
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建公式' }))

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    expect(input.value).toBe('')
    expect(input).toHaveAttribute('placeholder', '输入公式')

    fireEvent.focus(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(0)
  })

  it('uses formula-specific toolbar copy and accordion rows', () => {
    render(
      <ScenarioInspector
        value={{
          formulas: {
            'formula-0': {
              id: 'formula-0',
              name: '减法',
              description: '打',
              ast: { t: 'num', id: 'n0', v: 1 },
            },
            'formula-1': {
              id: 'formula-1',
              name: '加法',
              ast: { t: 'num', id: 'n0', v: 2 },
            },
          },
        }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: '＋ 新建公式' })).toBeTruthy()
    expect(screen.getByPlaceholderText('搜索公式')).toHaveAttribute('aria-label', '搜索公式')
    expect(screen.queryByText('新建实体')).toBeNull()
    expect(screen.queryByPlaceholderText('搜索实体')).toBeNull()

    const open = screen.getByRole('button', { name: '折叠公式 减法' })
    const closed = screen.getByRole('button', { name: '展开公式 加法' })
    expect(open).toHaveClass('is-open')
    expect(open).toHaveStyle({ color: 'rgba(255,255,255,.92)' })
    expect(closed).not.toHaveClass('is-open')
    expect(closed).toHaveStyle({ color: 'rgba(255,255,255,.34)' })
    expect(screen.getByDisplayValue('打')).toBeTruthy()

    fireEvent.click(closed)
    expect(screen.getByRole('button', { name: '折叠公式 加法' })).toHaveClass('is-open')
  })

  it('shows formula guidance in an accessible click popover', async () => {
    render(
      <ScenarioInspector
        value={{
          formulas: {
            damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } },
          },
        }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    const nameInput = screen.getByRole('textbox', { name: '公式 damage 名称' })
    expect(nameInput).toHaveAttribute('size', '2')

    const trigger = screen.getByRole('button', { name: '查看公式填写帮助' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: '公式填写帮助' })).toBeNull()

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '公式填写帮助' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText('添加公式')).toBeTruthy()
    expect(within(dialog).getByText('添加实体 / 变量 / 函数')).toBeTruthy()
    expect(within(dialog).getByText('参数留空')).toBeTruthy()
    expect(within(dialog).getByText('公式示例')).toBeTruthy()
    expect(within(dialog).getByText('示例目标：')).toBeTruthy()
    expect(within(dialog).getByText('示例原理：')).toBeTruthy()
    expect(dialog.querySelector('code.sir-formula-help-example')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '公式示例' })).toBeNull()

    fireEvent.mouseDown(dialog)
    expect(screen.getByRole('dialog', { name: '公式填写帮助' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '公式填写帮助' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('shows parsing failure and the shared AI affordance after the help icon', async () => {
    render(
      <ScenarioInspector
        value={{ formulas: { damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } } } }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    fireEvent.change(input, { target: { value: 'max(' } })

    const help = screen.getByRole('button', { name: '查看公式填写帮助' })
    const error = await screen.findByText('公式解析失败')
    const ai = screen.getByRole('button', { name: 'AI 修复公式' })
    expect(help.nextElementSibling).toBe(error)
    expect(error.nextElementSibling).toBe(ai)
    expect(error).toHaveClass('sir-formula-error')
    const detail = error.getAttribute('data-error-detail')
    expect(detail).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerEnter(error)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent(`错误详情：${detail}`)
    expect(tooltip.parentElement).toBe(document.body)
    expect(error).toHaveAttribute('aria-describedby', tooltip.id)
    fireEvent.pointerLeave(error)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.focus(error)
    expect(screen.getByRole('tooltip')).toHaveTextContent(`错误详情：${detail}`)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(error).toHaveAttribute('tabindex', '0')
    fireEvent.blur(error)

    expect(ai).toBeDisabled()
    expect(ai).toHaveAttribute('title', 'AI 公式修复暂不可用')
    expect(screen.getAllByText('公式解析失败')).toHaveLength(1)
    expect(screen.queryByText('无法解析')).toBeNull()
    expect(screen.queryByText(/^错误详情：/)).toBeNull()

    fireEvent.change(input, { target: { value: 'max(1, 2)' } })
    await waitFor(() => expect(screen.queryByText('公式解析失败')).toBeNull())
    expect(screen.queryByRole('button', { name: 'AI 修复公式' })).toBeNull()
  })

  it('clears parsing failure when the formula row collapses', async () => {
    render(
      <ScenarioInspector
        value={{ formulas: { damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } } } }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '公式表达式' }), { target: { value: 'max(' } })
    expect(await screen.findByText('公式解析失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '折叠公式 伤害' }))
    expect(screen.queryByText('公式解析失败')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开公式 伤害' }))
    expect(screen.queryByText('公式解析失败')).toBeNull()
  })

  it('closes formula guidance when the row collapses', () => {
    render(
      <ScenarioInspector
        value={{ formulas: { damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } } } }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '查看公式填写帮助' }))
    expect(screen.getByRole('dialog', { name: '公式填写帮助' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '折叠公式 伤害' }))
    expect(screen.queryByRole('dialog', { name: '公式填写帮助' })).toBeNull()
  })

  it('filters formulas by name, id, and description', () => {
    render(
      <ScenarioInspector
        value={{
          formulas: {
            damage: { id: 'damage', name: '减法', description: '扣除防御', ast: { t: 'num', id: 'n0', v: 1 } },
            heal: { id: 'heal', name: '加法', ast: { t: 'num', id: 'n0', v: 2 } },
          },
        }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '搜索公式' }), { target: { value: '防御' } })
    expect(screen.getByDisplayValue('减法')).toBeTruthy()
    expect(screen.queryByDisplayValue('加法')).toBeNull()
  })
})
