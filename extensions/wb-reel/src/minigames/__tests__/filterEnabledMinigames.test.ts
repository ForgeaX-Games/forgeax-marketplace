import { describe, expect, it } from 'vitest'
import { filterEnabledMinigames } from '../filterEnabledMinigames'
import type { MinigameDescriptor } from '../registry'

const mk = (id: string): MinigameDescriptor => ({
  id,
  title: `title-${id}`,
  src: `/__minigames/${id}.html?embed=1`,
  blurb: `blurb-${id}`,
  defaultDurationMs: 30_000,
})

const all: MinigameDescriptor[] = [mk('a'), mk('placeholder-rhythm'), mk('c')]

describe('filterEnabledMinigames', () => {
  it('enabledIds=undefined → 返回全部', () => {
    const res = filterEnabledMinigames(all, undefined)
    expect(res.length).toBe(all.length)
    expect(res).toEqual(all)
  })

  it('enabledIds=[] → 返回全部', () => {
    const res = filterEnabledMinigames(all, [])
    expect(res.length).toBe(all.length)
    expect(res).toEqual(all)
  })

  it("enabledIds=['placeholder-rhythm'] → 只返回该 1 个", () => {
    const res = filterEnabledMinigames(all, ['placeholder-rhythm'])
    expect(res.length).toBe(1)
    expect(res[0].id).toBe('placeholder-rhythm')
  })

  it('enabledIds 含不存在 id → 忽略不报错（只返回命中的）', () => {
    const res = filterEnabledMinigames(all, ['a', 'does-not-exist'])
    expect(res.map((m) => m.id)).toEqual(['a'])
  })

  it('保持 all 的原始顺序', () => {
    const res = filterEnabledMinigames(all, ['c', 'a'])
    expect(res.map((m) => m.id)).toEqual(['a', 'c'])
  })
})
