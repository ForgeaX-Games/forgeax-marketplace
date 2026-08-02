// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkinCtx } from '../../../rendererRegistry'
import { createCoreSkinRegistry } from '../../index'
import { Dialogue, DialogueManifest } from '../Dialogue'

afterEach(cleanup)

describe('components/new Dialogue', () => {
  it('declares its authoring inputs and renders speaker, text, and self-contained CSS', () => {
    expect(DialogueManifest.inputs).toEqual([
      { key: 'speaker', label: '说话人', valueType: 'string', component: 'numberExpr' },
      { key: 'text', label: '台词', valueType: 'string', default: '……' },
      { key: 'color', label: '字色', valueType: 'string', component: 'color' },
      { key: 'fontSize', label: '字号', valueType: 'number' },
    ])

    render(<Dialogue speaker="Nodia" text="Follow the signal." />)

    expect(screen.getByText('Nodia')).toHaveClass('gv-dialogue-speaker')
    expect(screen.getByText('Follow the signal.')).toHaveClass('gv-dialogue-text')
    const style = document.head.querySelector<HTMLStyleElement>(
      'style[data-skin-style="dialogue"]',
    )
    expect(style).not.toBeNull()
    expect(style?.textContent).toContain('.gv-dialogue-box')
  })

  it('keeps the dialogue visual default until an optional text appearance is supplied', () => {
    const { rerender } = render(<Dialogue text="默认文字" />)
    expect(screen.getByText('默认文字')).toHaveStyle({ color: '#f0f0f0', '--gv-text-font-size': '2cqh' })

    rerender(<Dialogue text="自定义文字" color="#2468ac" fontSize={2.5} />)
    expect(screen.getByText('自定义文字')).toHaveStyle({ color: '#2468ac', '--gv-text-font-size': '2.5cqh' })
  })

  it('omits an empty speaker and falls back to an ellipsis for missing text', () => {
    const { container } = render(<Dialogue />)
    expect(container.querySelector('.gv-dialogue-speaker')).toBeNull()
    expect(screen.getByText('……')).toHaveClass('gv-dialogue-text')
  })

  it('Host resolves the dynamic speaker while keeping dialogue text literal', () => {
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
    const skins = createCoreSkinRegistry()
    render(
      <>
        {skins.renderOverlay(
          {
            elementId: 'line-3',
            component: 'Dialogue',
            inputs: {
              speaker: { ref: 'entity.hero.name' },
              text: '继续前进。',
            },
          },
          undefined,
          undefined,
          ctx,
        )}
      </>,
    )

    expect(screen.getByText('空藏')).toHaveClass('gv-dialogue-speaker')
    expect(screen.getByText('继续前进。')).toHaveClass('gv-dialogue-text')
  })
})
