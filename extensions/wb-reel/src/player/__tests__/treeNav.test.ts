import { describe, expect, it } from 'vitest'
import { computeNodeAccess, isJumpable } from '../treeNav'
import type { Scenario } from '../../scenario/types'

/**
 * treeNav —— 剧情树「章节/关卡选择」可达性判定的独立单测。
 *
 * 图: s1 →(auto) s2 ;  s2 →(choice) s3 / s4 ;  s5 孤岛(无人指向)。
 */
function mkGraph(): Scenario {
  return {
    id: 'sc',
    title: 't',
    rootSceneId: 's1',
    defaultCharMs: 40,
    schemaVersion: 10,
    scenes: {
      s1: {
        id: 's1',
        title: 'S1',
        media: { kind: 'IMAGE_PROMPT', ref: '' },
        durationMs: 1000,
        dialogue: [],
        branches: [{ id: 'b1', kind: 'auto', targetSceneId: 's2' }],
      },
      s2: {
        id: 's2',
        title: 'S2',
        media: { kind: 'IMAGE_PROMPT', ref: '' },
        durationMs: 1000,
        dialogue: [],
        branches: [
          { id: 'b2', kind: 'choice', label: 'A', targetSceneId: 's3' },
          { id: 'b3', kind: 'choice', label: 'B', targetSceneId: 's4' },
        ],
      },
      s3: {
        id: 's3',
        title: 'S3',
        media: { kind: 'IMAGE_PROMPT', ref: '' },
        durationMs: 1000,
        dialogue: [],
        branches: [],
      },
      s4: {
        id: 's4',
        title: 'S4',
        media: { kind: 'IMAGE_PROMPT', ref: '' },
        durationMs: 1000,
        dialogue: [],
        branches: [],
      },
      s5: {
        id: 's5',
        title: 'S5',
        media: { kind: 'IMAGE_PROMPT', ref: '' },
        durationMs: 1000,
        dialogue: [],
        branches: [],
      },
    },
  } as Scenario
}

describe('computeNodeAccess', () => {
  it('当前在 s2、已访问 s1/s2 → s3/s4=frontier,s5=locked', () => {
    const acc = computeNodeAccess({
      scenario: mkGraph(),
      currentSceneId: 's2',
      visited: ['s1', 's2'],
    })
    expect(acc.s2).toBe('current')
    expect(acc.s1).toBe('visited')
    expect(acc.s3).toBe('frontier')
    expect(acc.s4).toBe('frontier')
    expect(acc.s5).toBe('locked')
  })

  it('current 自动计入 visited(即使未显式传入)', () => {
    const acc = computeNodeAccess({
      scenario: mkGraph(),
      currentSceneId: 's1',
      visited: [],
    })
    expect(acc.s1).toBe('current')
    expect(acc.s2).toBe('frontier')
    expect(acc.s3).toBe('locked')
  })
})

describe('isJumpable', () => {
  it('none → 全不可跳', () => {
    expect(isJumpable('visited', 'none')).toBe(false)
    expect(isJumpable('frontier', 'none')).toBe(false)
  })
  it('visited → visited/frontier 可跳,locked/current 不可', () => {
    expect(isJumpable('visited', 'visited')).toBe(true)
    expect(isJumpable('frontier', 'visited')).toBe(true)
    expect(isJumpable('locked', 'visited')).toBe(false)
    expect(isJumpable('current', 'visited')).toBe(false)
  })
  it('all → 除 current 外任意可跳(含 locked)', () => {
    expect(isJumpable('locked', 'all')).toBe(true)
    expect(isJumpable('current', 'all')).toBe(false)
  })
})
