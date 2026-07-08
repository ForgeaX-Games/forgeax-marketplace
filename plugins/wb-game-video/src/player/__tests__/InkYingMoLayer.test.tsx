import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { InkYingMoLayer, isInkYingMoChoice } from '../InkYingMoLayer'
import type { Scene } from '../../scenario/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const scene = {
  id: 'n_tea',
  kind: 'choice',
  ext: { choiceUi: 'inkYingMo' },
  branches: [
    { id: 'b-ying', kind: 'choice', label: '應', targetSceneId: 'n_drink' },
    { id: 'b-mo', kind: 'choice', label: '默', targetSceneId: 'n_nodrink' },
  ],
} as unknown as Scene

describe('InkYingMoLayer', () => {
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
  })

  it('isInkYingMoChoice reads ext.choiceUi', () => {
    expect(isInkYingMoChoice(scene)).toBe(true)
    expect(isInkYingMoChoice({ ext: { choiceUi: 'battleSkillBar' } } as never)).toBe(false)
    expect(isInkYingMoChoice(undefined)).toBe(false)
  })

  it('renders 應 and 默', () => {
    act(() => {
      root.render(<InkYingMoLayer scene={scene} onPick={() => {}} />)
    })
    expect(container.textContent).toContain('應')
    expect(container.textContent).toContain('默')
  })

  it('pick 應 calls onPick with that branch', () => {
    const onPick = vi.fn()
    act(() => {
      root.render(<InkYingMoLayer scene={scene} onPick={onPick} />)
    })
    const buttons = container.querySelectorAll('button')
    const yingBtn = Array.from(buttons).find((b) => b.textContent?.includes('應'))
    act(() => {
      yingBtn?.click()
    })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-ying' }))
  })

  it('timed decision auto-picks defaultBranchId (默) on timeout', async () => {
    const timedScene = {
      ...scene,
      decision: { optType: 'timed', timeoutMs: 20, defaultBranchId: 'b-mo' },
    } as unknown as Scene
    const onPick = vi.fn()
    act(() => {
      root.render(<InkYingMoLayer scene={timedScene} onPick={onPick} />)
    })
    await new Promise((r) => setTimeout(r, 80))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-mo' }))
  })
})
