import { describe, expect, it } from 'vitest'
import { buildSceneAudioPlan, gainAtLocalMs } from '../audioEngine'
import type { Scene } from '../../scenario/types'

function sceneWith(partial: Partial<Scene>): Scene {
  return {
    id: 's1',
    title: '测试场',
    media: { kind: 'IMAGE_PROMPT', prompt: '' },
    durationMs: 10000,
    dialogue: [],
    branches: [],
    ...partial,
  } as unknown as Scene
}

describe('buildSceneAudioPlan', () => {
  it('映射 scene.audio[]：丢弃无 ref / 0 时长，clamp volume，回填 role 默认增益', () => {
    const scene = sceneWith({
      audio: [
        { id: 'a1', role: 'vo', ref: 'm-vo', startMs: 1000, durationMs: 2000, volume: 0.8 },
        { id: 'a2', role: 'bgm', ref: 'm-bgm', startMs: 0, durationMs: 5000 }, // 无 volume → 默认
        { id: 'a3', role: 'sfx', ref: '', startMs: 0, durationMs: 1000 }, // 无 ref → 丢
        { id: 'a4', role: 'sfx', ref: 'm-x', startMs: 0, durationMs: 0 }, // 0 时长 → 丢
      ],
    } as Partial<Scene>)
    const plan = buildSceneAudioPlan(scene)
    expect(plan.map((p) => p.id)).toEqual(['a1', 'a2'])
    expect(plan[0]!.volume).toBeCloseTo(0.8)
    // bgm 默认增益
    expect(plan[1]!.volume).toBeGreaterThan(0)
    expect(plan[1]!.volume).toBeLessThan(1)
  })

  it('sceneBgm → 整场循环 bgm 条，带默认淡入淡出', () => {
    const scene = sceneWith({
      durationMs: 8000,
      sceneBgm: { mediaId: 'm-theme', prompt: 'x', chineseSummary: 's', bpm: 90, genre: 'g', moodTags: [], keyInstruments: [], estDurationSec: 60 },
    } as Partial<Scene>)
    const plan = buildSceneAudioPlan(scene)
    expect(plan).toHaveLength(1)
    const e = plan[0]!
    expect(e.mediaId).toBe('m-theme')
    expect(e.loop).toBe(true)
    expect(e.startMs).toBe(0)
    expect(e.durationMs).toBe(8000)
    expect(e.fadeInMs).toBeGreaterThan(0)
    expect(e.fadeOutMs).toBeGreaterThan(0)
    expect(e.role).toBe('bgm')
  })

  it('sceneBgm 无 mediaId（还在生成中）→ 不产出条目', () => {
    const scene = sceneWith({
      sceneBgm: { prompt: 'x', chineseSummary: 's', bpm: 90, genre: 'g', moodTags: [], keyInstruments: [], estDurationSec: 60 },
    } as Partial<Scene>)
    expect(buildSceneAudioPlan(scene)).toHaveLength(0)
  })

  it('空/缺失 scene → 空 plan', () => {
    expect(buildSceneAudioPlan(undefined)).toEqual([])
    expect(buildSceneAudioPlan(sceneWith({ audio: [] }))).toEqual([])
  })
})

describe('gainAtLocalMs · 淡入淡出包络', () => {
  const entry = {
    id: 'a1',
    mediaId: 'm',
    startMs: 0,
    durationMs: 4000,
    offsetMs: 0,
    volume: 1,
    fadeInMs: 1000,
    fadeOutMs: 1000,
    role: 'vo' as const,
    loop: false,
  }

  it('窗外为 0', () => {
    expect(gainAtLocalMs(entry, -1)).toBe(0)
    expect(gainAtLocalMs(entry, 4001)).toBe(0)
  })

  it('淡入：起点 0、中点半、淡入末端满', () => {
    expect(gainAtLocalMs(entry, 0)).toBeCloseTo(0)
    expect(gainAtLocalMs(entry, 500)).toBeCloseTo(0.5)
    expect(gainAtLocalMs(entry, 1000)).toBeCloseTo(1)
  })

  it('平台段满音量', () => {
    expect(gainAtLocalMs(entry, 2000)).toBeCloseTo(1)
  })

  it('淡出：开始满、中点半、末端 0', () => {
    expect(gainAtLocalMs(entry, 3000)).toBeCloseTo(1)
    expect(gainAtLocalMs(entry, 3500)).toBeCloseTo(0.5)
    expect(gainAtLocalMs(entry, 4000)).toBeCloseTo(0)
  })

  it('volume<1 时整体按比例缩放', () => {
    const quiet = { ...entry, volume: 0.5 }
    expect(gainAtLocalMs(quiet, 2000)).toBeCloseTo(0.5)
    expect(gainAtLocalMs(quiet, 500)).toBeCloseTo(0.25)
  })
})
