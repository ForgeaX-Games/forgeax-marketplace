// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BattleParry, BattleParryManifest } from '../BattleParry'

afterEach(cleanup)

function renderParry(emit = vi.fn()) {
  const view = render(<BattleParry emit={emit} />)
  return { ...view, emit }
}

describe('BattleParry', () => {
  it('settles both hit keys as a great success and animates each hit key away', () => {
    const { emit } = renderParry()

    const first = screen.getByRole('button', { name: '第一击' })
    const second = screen.getByRole('button', { name: '第二击' })
    fireEvent.click(first)
    expect(first).toHaveClass('hit')
    expect(second).not.toHaveClass('hit')
    fireEvent.click(second)

    expect(emit).toHaveBeenCalledWith('greatSuccess')
    expect(second).toHaveClass('hit')
  })

  it('settles one hit as success when the QTE ends', () => {
    const { emit, unmount } = renderParry()
    fireEvent.click(screen.getByRole('button', { name: '第一击' }))
    unmount()
    expect(emit).toHaveBeenCalledWith('success')
  })

  it('uses configured keyboard keys while preserving the button labels', () => {
    render(<BattleParry firstKey="Q" secondKey="E" />)

    fireEvent.keyDown(window, { key: 'q' })

    expect(screen.getByRole('button', { name: '第一击' })).toHaveTextContent('Q')
    expect(screen.getByRole('button', { name: '第一击' })).toHaveClass('hit')
    expect(screen.getByRole('button', { name: '第二击' })).toHaveTextContent('E')
  })

  it('settles no hits as failure when the QTE ends', () => {
    const { emit, unmount } = renderParry()
    unmount()
    expect(emit).toHaveBeenCalledWith('fail')
  })

  it('settles the one-shot QTE window after both rings have closed', () => {
    vi.useFakeTimers()
    try {
      const { container, emit } = renderParry()
      act(() => vi.advanceTimersByTime(1500))
      expect(emit).toHaveBeenCalledWith('fail')
      expect(container.firstElementChild).toHaveClass('is-finished')
    } finally {
      vi.useRealTimers()
    }
  })

  it('freezes each key at its own point in the editor preview timeline', () => {
    const { container } = render(<BattleParry preview previewTimeMs={1500} />)
    expect(container.firstElementChild).toHaveClass('is-frozen')
    expect(container.firstElementChild).toHaveStyle({ '--preview-t': '1500ms' })
  })

  it('declares the three QTE result events', () => {
    expect(BattleParryManifest.inputs).toEqual([
      { key: 'firstKey', label: '第一按键', valueType: 'string', default: 'A' },
      { key: 'secondKey', label: '第二按键', valueType: 'string', default: 'B' },
    ])
    expect(BattleParryManifest.events).toEqual([
      { id: 'greatSuccess', label: '大成功' },
      { id: 'success', label: '成功' },
      { id: 'fail', label: '失败' },
    ])
  })
})
