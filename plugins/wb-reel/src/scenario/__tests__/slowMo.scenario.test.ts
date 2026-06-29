import { describe, expect, it } from 'vitest'
import { getDemoScenario } from '../demoScenario'
import { sanitizeScenarioForIO } from '../sanitize'

describe('demoScenario · 触发点 / slowMo', () => {
  it('demo 里至少有一个 cue 配置了 slowMo（确保作者打开就能看到效果）', () => {
    const s = getDemoScenario()
    const allCues = Object.values(s.scenes).flatMap((sc) => sc.qte?.cues ?? [])
    const slowOnes = allCues.filter((c) => c.slowMo)
    expect(slowOnes.length).toBeGreaterThan(0)
    for (const c of slowOnes) {
      expect(c.slowMo!.rate).toBeGreaterThan(0)
      expect(c.slowMo!.rate).toBeLessThanOrEqual(1)
    }
  })

  it('JSON 来回序列化不丢 slowMo 字段（编辑器导出/导入可保留）', () => {
    const s = getDemoScenario()
    const roundtrip = JSON.parse(JSON.stringify(s))
    const original = Object.values(s.scenes).flatMap((sc) =>
      (sc.qte?.cues ?? []).filter((c) => c.slowMo).map((c) => [sc.id, c.id, c.slowMo]),
    )
    const after = Object.values(roundtrip.scenes).flatMap((sc: unknown) => {
      const scene = sc as { id: string; qte?: { cues: { id: string; slowMo?: unknown }[] } }
      return (scene.qte?.cues ?? [])
        .filter((c) => c.slowMo)
        .map((c) => [scene.id, c.id, c.slowMo])
    })
    expect(after).toEqual(original)
  })

  it('sanitize 不剥离 slowMo（slowMo 是公开剧本数据）', () => {
    const s = getDemoScenario()
    const clean = sanitizeScenarioForIO(s)
    const before = Object.values(s.scenes).flatMap((sc) =>
      (sc.qte?.cues ?? []).filter((c) => c.slowMo),
    )
    const after = Object.values(clean.scenes).flatMap((sc) =>
      (sc.qte?.cues ?? []).filter((c) => c.slowMo),
    )
    expect(after.length).toBe(before.length)
    for (let i = 0; i < after.length; i++) {
      const a = after[i]
      const b = before[i]
      expect(a?.slowMo).toEqual(b?.slowMo)
    }
  })
})
