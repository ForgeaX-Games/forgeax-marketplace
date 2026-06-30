import { describe, it, expect } from 'vitest'
import { qteOverlayAmbientClass } from '../qteAmbient'
import type { Scene } from '../../scenario/types'

/**
 * 蓝色闪烁真元凶：QTE tap cue 的内点在 1.1s 循环脉冲 (#7dd3fc)；
 * 当场景没有预生成图（纯黑占位底）时对比度拉满，3 个 cue 齐闪 = 屏幕一直蹦蓝。
 *
 * qteOverlayAmbientClass(scene) 返回一个**根容器 modifier class**：
 *   - 场景有视频/图（或 pending 中）→ 空字符串，保留原设计脉动
 *   - 场景纯黑占位（IMAGE_PROMPT + 无 ref）→ 'is-bg-empty'
 *     → 配合 CSS 把 cue pulse / breathe / sweep 动画关掉
 *
 * 这样只"在没图时"收敛脉动，原设计语言在有画面时完全不变。
 */

function makeScene(mediaKind: 'VIDEO' | 'IMAGE_PROMPT' | 'PLACEHOLDER', ref: string | null | undefined): Scene {
  return {
    id: 's',
    title: 't',
    durationMs: 9000,
    media: { kind: mediaKind, ref: ref ?? undefined } as Scene['media'],
    branches: [],
    dialogue: [],
    qte: undefined,
    shots: [],
    minigames: [],
  } as unknown as Scene
}

describe('qteOverlayAmbientClass', () => {
  it('VIDEO 场景 — 有画面在播，cue 脉动保留', () => {
    const s = makeScene('VIDEO', 'media_video_1')
    expect(qteOverlayAmbientClass(s)).toBe('')
  })

  it('IMAGE_PROMPT + 有 ref — 已缓存，保留脉动', () => {
    const s = makeScene('IMAGE_PROMPT', 'media_img_1')
    expect(qteOverlayAmbientClass(s)).toBe('')
  })

  it('IMAGE_PROMPT + 无 ref — 黑底，关闭脉动', () => {
    const s = makeScene('IMAGE_PROMPT', null)
    expect(qteOverlayAmbientClass(s)).toBe('is-bg-empty')
  })

  it('IMAGE_PROMPT + undefined ref — 同上', () => {
    const s = makeScene('IMAGE_PROMPT', undefined)
    expect(qteOverlayAmbientClass(s)).toBe('is-bg-empty')
  })
})
