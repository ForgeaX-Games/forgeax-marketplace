import { describe, expect, it } from 'vitest'
import { buildVideoReferenceSet } from '../buildVideoReferenceSet'
import type { Scenario, Scene, Shot } from '../../scenario/types'

function mkScenario(partial: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 3,
    scenes: {},
    order: [],
    characters: {},
    locations: {},
    props: {},
    ...partial,
  } as unknown as Scenario
}

function mkScene(partial: Partial<Scene>): Scene {
  return {
    id: 's1',
    title: 'scene 1',
    narration: '',
    characterIds: [],
    shots: [],
    media: { kind: 'IMAGE' },
    ...partial,
  } as unknown as Scene
}

function mkShot(partial: Partial<Shot>): Shot {
  return {
    id: 'shot1',
    order: 0,
    prompt: '',
    characterIds: [],
    ...partial,
  } as unknown as Shot
}

const URLS: Record<string, string> = {
  m_shot1: 'https://cdn/shot1.png',
  m_shot0: 'https://cdn/shot0.png',
  m_shot2: 'https://cdn/shot2.png',
  m_shot3: 'https://cdn/shot3.png',
  m_loc: 'https://cdn/loc.png',
  m_loc_angle1: 'https://cdn/loc-a1.png',
  m_char1: 'https://cdn/char1.png',
  m_char2: 'https://cdn/char2.png',
  m_prop1: 'https://cdn/prop1.png',
}
const lookup = (id: string) => URLS[id]
const brokenLookup = () => undefined

describe('buildVideoReferenceSet', () => {
  it('shot.keyframeMediaRef 永远排第一', () => {
    const shot = mkShot({ keyframeMediaRef: 'm_shot1' })
    const scene = mkScene({ shots: [shot], locationId: 'L1' })
    const scenario = mkScenario({
      locations: { L1: { id: 'L1', name: 'L', prompt: '', refImageId: 'm_loc' } },
    })
    const { urls, trace } = buildVideoReferenceSet({
      scenario, scene, shot, mediaLookup: lookup,
    })
    expect(urls[0]).toBe('https://cdn/shot1.png')
    expect(trace[0].source).toBe('shot-keyframe')
    expect(urls).toContain('https://cdn/loc.png')
  })

  it('shot 无 keyframe 时返回数组不含 shot-keyframe trace', () => {
    const shot = mkShot({})
    const scene = mkScene({ shots: [shot] })
    const scenario = mkScenario()
    const { urls, trace } = buildVideoReferenceSet({
      scenario, scene, shot, mediaLookup: lookup,
    })
    expect(trace.find((t) => t.source === 'shot-keyframe')).toBeUndefined()
    expect(urls).toEqual([])
  })

  it('相邻 shot keyframe 打分高于远 shot', () => {
    const s0 = mkShot({ id: 'shot0', order: 0, keyframeMediaRef: 'm_shot0' })
    const s1 = mkShot({ id: 'shot1', order: 1, keyframeMediaRef: 'm_shot1' })
    const s2 = mkShot({ id: 'shot2', order: 2, keyframeMediaRef: 'm_shot2' })
    const s3 = mkShot({ id: 'shot3', order: 3, keyframeMediaRef: 'm_shot3' })
    const scene = mkScene({ shots: [s0, s1, s2, s3] })
    const { urls, trace } = buildVideoReferenceSet({
      scenario: mkScenario(), scene, shot: s1, mediaLookup: lookup,
    })
    // s1 是首帧；之后按相邻 > 远
    expect(urls[0]).toBe('https://cdn/shot1.png')
    const nonHead = trace.slice(1)
    const adjacent = nonHead.filter((t) => t.source === 'prev-shot-keyframe' || t.source === 'next-shot-keyframe')
    const far = nonHead.filter((t) => t.source === 'far-shot-keyframe')
    expect(adjacent.length).toBe(2)
    expect(far.length).toBe(1)
    // 排序：adjacent 都在 far 之前
    const lastAdjIdx = Math.max(
      trace.findIndex((t) => t.source === 'prev-shot-keyframe'),
      trace.findIndex((t) => t.source === 'next-shot-keyframe'),
    )
    const farIdx = trace.findIndex((t) => t.source === 'far-shot-keyframe')
    expect(farIdx).toBeGreaterThan(lastAdjIdx)
  })

  it('lookup 返回 undefined 的资产会被跳过，不产生空 url', () => {
    const shot = mkShot({ keyframeMediaRef: 'missing' })
    const scene = mkScene({ shots: [shot], locationId: 'L1' })
    const scenario = mkScenario({
      locations: { L1: { id: 'L1', name: 'L', prompt: '', refImageId: 'missing2' } },
    })
    const { urls } = buildVideoReferenceSet({
      scenario, scene, shot, mediaLookup: brokenLookup,
    })
    expect(urls).toEqual([])
  })

  it('去重：同一 url 只出现一次', () => {
    const shot = mkShot({ keyframeMediaRef: 'm_shot1', characterIds: ['C1'] })
    const scene = mkScene({
      shots: [shot],
      characterIds: ['C1'],
      locationId: 'L1',
    })
    // 让 location.refImageId 指向和 shot.keyframeMediaRef 同一个 mediaId
    const scenario = mkScenario({
      characters: {
        C1: {
          id: 'C1',
          name: 'X',
          prompt: '',
          turnaroundRefImageId: 'm_shot1', // 和 shot keyframe 同源
        } as Scenario['characters'][string],
      },
      locations: { L1: { id: 'L1', name: 'L', prompt: '', refImageId: 'm_shot1' } },
    })
    const { urls } = buildVideoReferenceSet({
      scenario, scene, shot, mediaLookup: lookup,
    })
    // m_shot1 不会在数组中出现两次
    const occ = urls.filter((u) => u === 'https://cdn/shot1.png').length
    expect(occ).toBe(1)
  })

  it('max=2 截断', () => {
    const s0 = mkShot({ id: 'shot0', order: 0, keyframeMediaRef: 'm_shot0' })
    const s1 = mkShot({ id: 'shot1', order: 1, keyframeMediaRef: 'm_shot1' })
    const s2 = mkShot({ id: 'shot2', order: 2, keyframeMediaRef: 'm_shot2' })
    const scene = mkScene({ shots: [s0, s1, s2], locationId: 'L1' })
    const scenario = mkScenario({
      locations: { L1: { id: 'L1', name: 'L', prompt: '', refImageId: 'm_loc' } },
    })
    const { urls } = buildVideoReferenceSet({
      scenario, scene, shot: s1, mediaLookup: lookup, max: 2,
    })
    expect(urls.length).toBe(2)
    expect(urls[0]).toBe('https://cdn/shot1.png') // shot keyframe 永远在第一
  })

  it('characterIds 从 shot 优先（而非 scene 全员）', () => {
    const shot = mkShot({
      id: 'shot1',
      keyframeMediaRef: 'm_shot1',
      characterIds: ['C1'],
    })
    const scene = mkScene({ shots: [shot], characterIds: ['C1', 'C2'] })
    const scenario = mkScenario({
      characters: {
        C1: {
          id: 'C1', name: 'X', prompt: '', turnaroundRefImageId: 'm_char1',
        } as Scenario['characters'][string],
        C2: {
          id: 'C2', name: 'Y', prompt: '', turnaroundRefImageId: 'm_char2',
        } as Scenario['characters'][string],
      },
    })
    const { urls } = buildVideoReferenceSet({
      scenario, scene, shot, mediaLookup: lookup,
    })
    expect(urls).toContain('https://cdn/char1.png')
    expect(urls).not.toContain('https://cdn/char2.png')
  })
})
