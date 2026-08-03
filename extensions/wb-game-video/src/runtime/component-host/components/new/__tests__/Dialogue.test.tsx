import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkinCtx } from '../../../rendererRegistry'
import { Dialogue, DialogueManifest } from '../Dialogue'

afterEach(cleanup)

describe('components/new Dialogue', () => {
  it('declares its authoring inputs and renders speaker, text, and self-contained CSS', () => {
    expect(DialogueManifest.inputs).toEqual([
      { key: 'speaker', label: '说话人', valueType: 'string', component: 'numberExpr' },
      { key: 'text', label: '台词', valueType: 'string', default: '……', component: 'numberExpr' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color' },
      { key: 'fontSize', label: '字号', valueType: 'number' },
    ])

    render(
      <Dialogue
        overlay={{
          elementId: 'line-1',
          component: 'Dialogue',
          inputs: { speaker: 'Nodia', text: 'Follow the signal.' },
        }}
      />,
    )

    expect(screen.getByText('Nodia')).toHaveClass('gv-dialogue-speaker')
    expect(screen.getByText('Follow the signal.')).toHaveClass('gv-dialogue-text')
    const style = document.head.querySelector<HTMLStyleElement>(
      'style[data-skin-style="dialogue"]',
    )
    expect(style).not.toBeNull()
    expect(style?.textContent).toContain('.gv-dialogue-box')
    expect(style?.textContent).toContain('inline-size:100%;box-sizing:border-box')
    expect(style?.textContent).toContain('background:transparent')
    expect(style?.textContent).toContain('text-align:center')
  })

  it('keeps the dialogue visual default until an optional text appearance is supplied', () => {
    const { rerender } = render(
      <Dialogue overlay={{ elementId: 'default', component: 'Dialogue', inputs: { text: '默认文字' } }} />,
    )
    expect(screen.getByText('默认文字')).toHaveStyle({ color: '#f0f0f0', '--gv-text-font-size': '2cqh' })

    rerender(
      <Dialogue
        overlay={{ elementId: 'override', component: 'Dialogue', inputs: { text: '自定义文字', color: '#2468ac', fontSize: 2.5 } }}
      />,
    )
    expect(screen.getByText('自定义文字')).toHaveStyle({ color: '#2468ac', '--gv-text-font-size': '2.5cqh' })
  })

  it('omits an empty speaker and falls back to an ellipsis for missing text', () => {
    const { container } = render(
      <Dialogue
        overlay={{
          elementId: 'line-2',
          component: 'Dialogue',
          inputs: {},
        }}
      />,
    )

    expect(container.querySelector('.gv-dialogue-speaker')).toBeNull()
    expect(screen.getByText('……')).toHaveClass('gv-dialogue-text')
  })

  it('resolves speaker and text from state references', () => {
    const ctx: SkinCtx = {
      hud: {
        entities: {
          hero: {
            name: '空藏',
            hp: 80,
            maxHp: 100,
            attrs: { hp: 80 },
            attrMax: { hp: 100 },
          },
        },
        vars: { qi: 3 },
        flags: {},
        score: 0,
      },
    }
    render(
      <Dialogue
        overlay={{
          elementId: 'line-3',
          component: 'Dialogue',
          inputs: {
            speaker: { ref: 'entity.hero.name' },
            text: { ref: 'var.qi' },
          },
        }}
        ctx={ctx}
      />,
    )

    expect(screen.getByText('空藏')).toHaveClass('gv-dialogue-speaker')
    expect(screen.getByText('3')).toHaveClass('gv-dialogue-text')
  })
})
