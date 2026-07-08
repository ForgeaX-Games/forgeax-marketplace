import { describe, expect, test } from 'vitest'
import type { Scene } from '../../scenario/types'
import { resolveScenePlaybackDurationMs } from '../scenePlaybackDuration'

describe('resolveScenePlaybackDurationMs', () => {
  test('non-loop nodes use scene.durationMs even when clip catalog is longer', () => {
    const scene = { durationMs: 3200, media: { kind: 'VIDEO', ref: 'm-builtin-vd-wcc-pugong' } } as Scene
    expect(resolveScenePlaybackDurationMs(scene)).toBe(3200)
  })

  test('calc nodes with short durationMs are not stretched to idle clip length', () => {
    const scene = { durationMs: 500, media: { kind: 'VIDEO', ref: 'm-builtin-vd-wcc-idle' }, mediaPlayMode: 'once' } as Scene
    expect(resolveScenePlaybackDurationMs(scene)).toBe(500)
  })

  test('loop nodes still use full clip cycle', () => {
    const scene = {
      durationMs: 8000,
      media: { kind: 'VIDEO', ref: 'm-builtin-vd-wcc-idle' },
      mediaPlayMode: 'loop',
    } as Scene
    expect(resolveScenePlaybackDurationMs(scene, { loop: true })).toBe(8000)
  })

  test('respects longer scene.durationMs from timeline edits', () => {
    const scene = { durationMs: 9000, media: { kind: 'VIDEO', ref: 'm-builtin-vd-wcc-pugong' } } as Scene
    expect(resolveScenePlaybackDurationMs(scene)).toBe(9000)
  })
})
