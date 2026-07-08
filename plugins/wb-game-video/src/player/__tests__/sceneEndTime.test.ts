import { describe, expect, it } from 'vitest'
import { computeEffectiveEndMs } from '../sceneEndTime'
import type { Scene, Shot } from '../../scenario/types'

/**
 * computeEffectiveEndMs 契约 ——
 *
 * 作者 2026-05-01 诉求："拖入的视频只有 10s，不要等满 30s 再跳"。
 * 下面的用例锁定几个关键不变量：
 *   - 有带时长的 shot  → 取最晚的 endMs
 *   - 没有带时长的 shot → 退回 durationMs（空场景/老数据行为不变）
 *   - shots 超出 scene.durationMs 时夹到 durationMs（不允许外溢）
 *   - 部分 shot 只有 startMs / 只有 endMs / endMs<=startMs → 忽略这些坏数据
 */

const baseScene = (over: Partial<Scene>): Scene => ({
  id: 's',
  title: '',
  media: { kind: 'PLACEHOLDER' },
  durationMs: 30_000,
  dialogue: [],
  branches: [],
  ...over,
})

const shot = (over: Partial<Shot>): Shot => ({
  id: 'sh',
  order: 0,
  framing: 'medium',
  prompt: '',
  ...over,
})

describe('computeEffectiveEndMs', () => {
  it('无 shots 时返 durationMs（老数据/空场景兼容）', () => {
    const s = baseScene({ shots: [] })
    expect(computeEffectiveEndMs(s)).toBe(30_000)
  })

  it('shots 都没写 startMs/endMs 时返 durationMs', () => {
    const s = baseScene({
      shots: [shot({ id: 'a' }), shot({ id: 'b' })],
    })
    expect(computeEffectiveEndMs(s)).toBe(30_000)
  })

  it('单个视频 shot (0~10s) 在 30s 场景中 → 返 10s', () => {
    const s = baseScene({
      shots: [shot({ id: 'a', startMs: 0, endMs: 10_000 })],
    })
    expect(computeEffectiveEndMs(s)).toBe(10_000)
  })

  it('多个 shot → 取最晚 endMs', () => {
    const s = baseScene({
      shots: [
        shot({ id: 'a', startMs: 0, endMs: 4_000 }),
        shot({ id: 'b', startMs: 4_000, endMs: 12_000 }),
        shot({ id: 'c', startMs: 12_000, endMs: 8_500 }), // 坏数据：end<=start，忽略
      ],
    })
    expect(computeEffectiveEndMs(s)).toBe(12_000)
  })

  it('shot.endMs 超出 scene.durationMs 时夹到 durationMs', () => {
    const s = baseScene({
      durationMs: 10_000,
      shots: [shot({ id: 'a', startMs: 0, endMs: 99_000 })],
    })
    expect(computeEffectiveEndMs(s)).toBe(10_000)
  })

  it('只写了 startMs（缺 endMs）的 shot 被忽略', () => {
    const s = baseScene({
      shots: [
        shot({ id: 'a', startMs: 0 }),
        shot({ id: 'b', startMs: 0, endMs: 6_000 }),
      ],
    })
    expect(computeEffectiveEndMs(s)).toBe(6_000)
  })

  it('只写了 endMs（缺 startMs）的 shot 也被忽略（保守）', () => {
    const s = baseScene({
      shots: [shot({ id: 'a', endMs: 5_000 })],
    })
    expect(computeEffectiveEndMs(s)).toBe(30_000)
  })

  it('shot endMs 非有限数（Infinity/NaN）时忽略', () => {
    const s = baseScene({
      shots: [
        shot({ id: 'a', startMs: 0, endMs: Number.POSITIVE_INFINITY }),
        shot({ id: 'b', startMs: 0, endMs: Number.NaN }),
      ],
    })
    expect(computeEffectiveEndMs(s)).toBe(30_000)
  })

  it('durationMs 为 0 时夹出的结果也是 0', () => {
    const s = baseScene({
      durationMs: 0,
      shots: [shot({ id: 'a', startMs: 0, endMs: 5_000 })],
    })
    expect(computeEffectiveEndMs(s)).toBe(0)
  })
})
