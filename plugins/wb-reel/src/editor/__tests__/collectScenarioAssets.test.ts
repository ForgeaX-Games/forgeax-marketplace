import { describe, expect, it } from 'vitest'
import { collectScenarioAssets } from '../collectScenarioAssets'
import type { Scenario, Scene } from '../../scenario/types'

/**
 * collectScenarioAssets —— 把一整本 scenario 的所有 scene.sceneImages /
 * scene.sceneVideos 平铺成"全剧本素材库"数据。
 *
 * 作者需求（v3.9.4）：
 *   "我在这个剧本中生成的、上传的图像和视频历史，要在当前的素材库中能看到。"
 *
 * 关键行为：
 *   - 按 scene.pos.y / scene.id 的稳定顺序排列 scenes
 *   - 每个 scene 内部保留 sceneImages / sceneVideos 的原有顺序
 *   - 跨场景去重：同一个 mediaId 如果被多个 scene 引用，只出现一次（归属于
 *     按顺序遍历时第一个撞到的 scene）。理由：mediaStore 里的实体本来就是
 *     单源，素材库是引用视图，重复展示只会让作者困惑。
 *   - 空 scenario 返回空列表；没有素材的 scene 被跳过。
 */

function makeScene(id: string, over: Partial<Scene> = {}): Scene {
  return {
    id,
    title: id,
    media: { kind: 'PLACEHOLDER' },
    durationMs: 1000,
    branches: [],
    ...over,
  } as Scene
}

function makeScenario(scenes: Scene[]): Scenario {
  const map: Record<string, Scene> = {}
  for (const s of scenes) map[s.id] = s
  return {
    id: 'sc',
    title: 't',
    rootSceneId: scenes[0]!.id,
    scenes: map,
    defaultCharMs: 30,
    schemaVersion: 3,
  }
}

describe('collectScenarioAssets', () => {
  it('空 scenario 返回空的两个列表', () => {
    const out = collectScenarioAssets(makeScenario([makeScene('a')]))
    expect(out.images).toEqual([])
    expect(out.videos).toEqual([])
  })

  it('单场景：按原顺序铺平 sceneImages / sceneVideos', () => {
    const scene = makeScene('a', {
      sceneImages: ['img-1', 'img-2'],
      sceneVideos: ['vid-1'],
    })
    const out = collectScenarioAssets(makeScenario([scene]))
    expect(out.images).toEqual([
      { mediaId: 'img-1', sceneId: 'a' },
      { mediaId: 'img-2', sceneId: 'a' },
    ])
    expect(out.videos).toEqual([{ mediaId: 'vid-1', sceneId: 'a' }])
  })

  it('多场景：按 scene id 字典序稳定遍历（pos.y 缺省回退 id）', () => {
    const a = makeScene('a', { sceneImages: ['img-a1'] })
    const b = makeScene('b', { sceneImages: ['img-b1'] })
    const c = makeScene('c', { sceneImages: ['img-c1'] })
    const out = collectScenarioAssets(makeScenario([c, a, b]))
    expect(out.images.map((x) => x.mediaId)).toEqual(['img-a1', 'img-b1', 'img-c1'])
  })

  it('pos.y 存在时按 pos.y 排（y 小的更早）', () => {
    const a = makeScene('a', { sceneImages: ['img-a'], pos: { x: 0, y: 300 } })
    const b = makeScene('b', { sceneImages: ['img-b'], pos: { x: 0, y: 100 } })
    const out = collectScenarioAssets(makeScenario([a, b]))
    // b 的 y 较小 → 先出
    expect(out.images.map((x) => x.mediaId)).toEqual(['img-b', 'img-a'])
  })

  it('跨场景去重：同一 mediaId 只归属第一个撞到的 scene', () => {
    const a = makeScene('a', { sceneImages: ['img-shared', 'img-a'] })
    const b = makeScene('b', { sceneImages: ['img-shared', 'img-b'] })
    const out = collectScenarioAssets(makeScenario([a, b]))
    expect(out.images).toEqual([
      { mediaId: 'img-shared', sceneId: 'a' },
      { mediaId: 'img-a', sceneId: 'a' },
      { mediaId: 'img-b', sceneId: 'b' },
    ])
  })

  it('视频与图像互不干扰（同 id 分别出现在 sceneImages / sceneVideos）', () => {
    const a = makeScene('a', {
      sceneImages: ['x'],
      sceneVideos: ['x'], // 理论上不会发生，但去重独立就行
    })
    const out = collectScenarioAssets(makeScenario([a]))
    expect(out.images).toEqual([{ mediaId: 'x', sceneId: 'a' }])
    expect(out.videos).toEqual([{ mediaId: 'x', sceneId: 'a' }])
  })

  it('没有素材的 scene 被跳过，不产生条目', () => {
    const a = makeScene('a')
    const b = makeScene('b', { sceneImages: ['img-b'] })
    const out = collectScenarioAssets(makeScenario([a, b]))
    expect(out.images).toEqual([{ mediaId: 'img-b', sceneId: 'b' }])
  })
})
