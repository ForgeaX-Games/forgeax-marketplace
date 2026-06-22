import { describe, it, expect } from 'vitest'
import { mergeChunkScenarios } from '../mergeChunkScenarios'
import type { Scenario, Scene, Branch } from '../../scenario/types'

function scene(id: string, opts: Partial<Scene> = {}): Scene {
  return {
    id,
    title: opts.title ?? id,
    media: { kind: 'PLACEHOLDER' },
    durationMs: opts.durationMs ?? 1000,
    dialogue: opts.dialogue ?? [],
    branches: opts.branches ?? [],
    ...opts,
  }
}

function auto(id: string, target: string): Branch {
  return { id, kind: 'auto', targetSceneId: target, label: '' }
}

function scenario(
  id: string,
  scenes: Scene[],
  opts: Partial<Scenario> = {},
): Scenario {
  const rec: Record<string, Scene> = {}
  for (const s of scenes) rec[s.id] = s
  return {
    id,
    title: opts.title ?? id,
    rootSceneId: opts.rootSceneId ?? scenes[0]?.id ?? '',
    scenes: rec,
    defaultCharMs: 40,
    schemaVersion: 5,
    ...opts,
  }
}

describe('mergeChunkScenarios', () => {
  it('单段直接原样返回', () => {
    const s = scenario('a', [scene('s1')])
    expect(mergeChunkScenarios([s])).toBe(s)
  })

  it('空段被过滤；全空抛错', () => {
    const empty = scenario('a', [])
    expect(() => mergeChunkScenarios([empty, empty])).toThrow()
  })

  it('两段同名 scene id 不撞车（命名空间隔离）', () => {
    const p0 = scenario('a', [scene('s1', { branches: [] })])
    const p1 = scenario('b', [scene('s1', { branches: [] })])
    const m = mergeChunkScenarios([p0, p1])
    const keys = Object.keys(m.scenes)
    expect(keys).toContain('c0_s1')
    expect(keys).toContain('c1_s1')
    expect(keys).toHaveLength(2)
  })

  it('段内分支引用被命名空间化且仍然有效', () => {
    const p0 = scenario('a', [
      scene('s1', { branches: [auto('b1', 's2')] }),
      scene('s2', { branches: [] }),
    ])
    const p1 = scenario('b', [scene('s1', { branches: [] })])
    const m = mergeChunkScenarios([p0, p1])
    const s1 = m.scenes['c0_s1']!
    expect(s1.branches[0]!.targetSceneId).toBe('c0_s2')
    expect(m.scenes['c0_s2']).toBeDefined()
  })

  it('尾场景无出边 → 自动缝合到下一段根', () => {
    const p0 = scenario('a', [scene('s1', { branches: [] })])
    const p1 = scenario('b', [scene('s9', { branches: [] })], { rootSceneId: 's9' })
    const m = mergeChunkScenarios([p0, p1])
    const tail = m.scenes['c0_s1']!
    expect(tail.branches).toHaveLength(1)
    expect(tail.branches[0]!.kind).toBe('auto')
    expect(tail.branches[0]!.targetSceneId).toBe('c1_s9')
    expect(m.rootSceneId).toBe('c0_s1')
  })

  it('悬空分支（指向段外）重指到下一段根；最后一段悬空丢弃', () => {
    const p0 = scenario('a', [
      scene('s1', { branches: [auto('b1', 'ghost-next')] }),
    ])
    const p1 = scenario('b', [
      scene('s1', { branches: [auto('b2', 'ghost-end')] }),
    ])
    const m = mergeChunkScenarios([p0, p1])
    // p0 的悬空分支 → 指到 p1 根
    expect(m.scenes['c0_s1']!.branches[0]!.targetSceneId).toBe('c1_s1')
    // p1（最后一段）的悬空分支 → 丢弃（结局）
    expect(m.scenes['c1_s1']!.branches).toHaveLength(0)
  })

  it('同名角色跨段去重，引用归一到同一 canonical id', () => {
    const p0 = scenario('a', [scene('s1', { characterIds: ['ch1'] })], {
      characters: {
        ch1: { id: 'ch1', name: '秋月', prompt: '银镯少女' },
      },
    })
    const p1 = scenario('b', [scene('s1', { characterIds: ['cA'] })], {
      characters: {
        cA: { id: 'cA', name: '秋月', prompt: '' },
        cB: { id: 'cB', name: '陌生人', prompt: '黑衣' },
      },
    })
    const m = mergeChunkScenarios([p0, p1])
    // 秋月只存一份（canonical = 第一段的 c0_ch1）
    const chars = m.characters!
    const qiuyueIds = Object.values(chars)
      .filter((c) => c.name === '秋月')
      .map((c) => c.id)
    expect(qiuyueIds).toEqual(['c0_ch1'])
    // 第二段场景对秋月的引用被映射到 canonical id
    expect(m.scenes['c1_s1']!.characterIds).toContain('c0_ch1')
    // 陌生人作为新角色入库
    expect(Object.values(chars).some((c) => c.name === '陌生人')).toBe(true)
  })

  it('canonical 角色用后段补齐空 prompt', () => {
    const p0 = scenario('a', [scene('s1')], {
      characters: { ch1: { id: 'ch1', name: '秋月', prompt: '' } },
    })
    const p1 = scenario('b', [scene('s1')], {
      characters: { cA: { id: 'cA', name: '秋月', prompt: '银镯少女' } },
    })
    const m = mergeChunkScenarios([p0, p1])
    expect(m.characters!['c0_ch1']!.prompt).toBe('银镯少女')
  })
})
