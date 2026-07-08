import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NarrativeStatsLayer } from '../NarrativeStatsLayer'
import type { Scenario } from '../../scenario/types'

// React 18 act() 在 vitest+happy-dom 下需要此标志。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const scenario = {
  variables: {
    lizhi:   { id: 'lizhi',   name: '理智', kind: 'number', initial: 5,  min: 0, max: 12 },
    foxing:  { id: 'foxing',  name: '佛性', kind: 'number', initial: 10, min: 0, max: 12 },
    yezhang: { id: 'yezhang', name: '业障', kind: 'number', initial: 1,  min: 0, max: 12 },
    chi:     { id: 'chi',     name: '痴',   kind: 'number', initial: 1,  min: 0, max: 12 },
  },
} as unknown as Scenario

describe('NarrativeStatsLayer', () => {
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

  it('renders all four stats with current vars', () => {
    act(() => {
      root.render(<NarrativeStatsLayer scenario={scenario} vars={{ lizhi: 4, yezhang: 2 }} />)
    })
    // 标签文字存在
    expect(container.textContent).toContain('理智')
    // lizhi 用传入的值 4
    expect(container.querySelector('[data-stat="lizhi"] .pvm-stat-v')?.textContent).toBe('4')
    // foxing 无传入，用 initial 兜底（10）
    expect(container.querySelector('[data-stat="foxing"] .pvm-stat-v')?.textContent).toBe('10')
    // yezhang 传入 2
    expect(container.querySelector('[data-stat="yezhang"] .pvm-stat-v')?.textContent).toBe('2')
  })

  it('returns null when scenario lacks the four stats (battle-only scenario)', () => {
    act(() => {
      root.render(
        <NarrativeStatsLayer
          scenario={{ variables: { qi: { id: 'qi', name: '气力', kind: 'number', initial: 0 } } } as never}
          vars={{}}
        />,
      )
    })
    expect(container.firstChild).toBeNull()
  })
})
