import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { BlueprintPlayer } from '../BlueprintPlayer'
import { makeDemoScenario } from '../../blueprint/__tests__/fixtures'

// 让 React 18 的 act() 在 vitest+happy-dom 下正常工作（消除 act 环境告警）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('BlueprintPlayer (render smoke)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useScenarioStore.setState({ scenario: makeDemoScenario() } as any)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  test('mounts and plays the start node clip', () => {
    act(() => {
      root.render(<BlueprintPlayer />)
    })
    expect(container.textContent).toContain('开场对峙')
    expect(container.textContent).toContain('退出')
  })

  test('auto-advances to the choice node and renders options', () => {
    vi.useFakeTimers()
    act(() => {
      root.render(<BlueprintPlayer />)
    })
    // 起点 loop 节点作背景视频，流程立即推进到 choice（不等 durationMs）。
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(container.textContent).toContain('迎击（QTE）')
    expect(container.textContent).toContain('直冲 Boss')
  })

  test('starts choice window timing after the video can play', async () => {
    vi.useFakeTimers()
    const scenario = makeDemoScenario()
    scenario.rootSceneId = 'choose'
    scenario.scenes.choose = {
      ...scenario.scenes.choose!,
      clipId: 'vd-wcc-idle',
      mediaPlayMode: 'loop',
      decision: {
        optType: 'static',
        prompt: '怎么办？',
        windowStartMs: 1000,
        fireAt: 'on_pick',
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useScenarioStore.setState({ scenario } as any)

    act(() => {
      root.render(<BlueprintPlayer />)
    })

    expect(container.textContent).not.toContain('迎击（QTE）')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.textContent).not.toContain('迎击（QTE）')

    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    await act(async () => {
      video?.dispatchEvent(new Event('canplay', { bubbles: true }))
      await Promise.resolve()
    })
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(container.textContent).not.toContain('迎击（QTE）')
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(container.textContent).toContain('迎击（QTE）')
    expect(container.textContent).toContain('直冲 Boss')
  })
})
