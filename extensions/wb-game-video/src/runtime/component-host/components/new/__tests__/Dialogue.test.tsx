import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialogue, DialogueManifest } from '../Dialogue'

afterEach(cleanup)

describe('components/new Dialogue', () => {
  it('declares its authoring inputs and renders speaker, text, and self-contained CSS', () => {
    expect(DialogueManifest.inputs).toEqual([
      { key: 'speaker', label: '说话人', valueType: 'string' },
      { key: 'text', label: '台词', valueType: 'string', default: '……' },
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
})
