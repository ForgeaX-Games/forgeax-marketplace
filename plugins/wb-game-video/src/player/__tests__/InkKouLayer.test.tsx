import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { InkKouLayer, isInkKouQte } from '../InkKouLayer'
import type { BlueprintQte } from '../../blueprint/blueprint-schema'

// React 18 act() 环境标记（对齐 BlueprintPlayer.test.tsx）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const qte: BlueprintQte = {
  kind: 'timing',
  windowMs: 200,
  cueMs: [9000],
  sequence: false,
  timeoutMs: 1500,
}

describe('InkKouLayer', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('isInkKouQte reads ext.qteUi', () => {
    expect(isInkKouQte({ ext: { qteUi: 'inkKou' } } as never)).toBe(true)
    expect(isInkKouQte({ ext: { qteUi: 'battleParry' } } as never)).toBe(false)
    expect(isInkKouQte(undefined)).toBe(false)
  })

  it('renders the 叩 glyph', () => {
    act(() => {
      root.render(<InkKouLayer qte={qte} onResolve={() => {}} />)
    })
    expect(container.textContent).toContain('叩')
  })

  it('click resolves pass', () => {
    const onResolve = vi.fn()
    act(() => {
      root.render(<InkKouLayer qte={qte} onResolve={onResolve} />)
    })
    act(() => {
      container.querySelector('button')?.click()
    })
    expect(onResolve).toHaveBeenCalledWith('pass')
  })

  it('timeout resolves fail', () => {
    vi.useFakeTimers()
    const onResolve = vi.fn()
    act(() => {
      root.render(<InkKouLayer qte={{ ...qte, timeoutMs: 500 }} onResolve={onResolve} />)
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onResolve).toHaveBeenCalledWith('fail')
  })
})
