import { describe, expect, it } from 'vitest'
import { prunePlaybackScenario } from '../prunePlaybackScenario'
import type { Scenario } from '../../types'

/**
 * prunePlaybackScenario —— "所见即所得"瘦身函数的独立单测。
 *
 * 关注点：
 *   1) 可达性 BFS：只保留从 rootSceneId 顺 branches 能走到的 scene
 *   2) 字段清洗：scene 层的编辑态字段（shots/sceneImages/sceneVideos/...）被剥掉
 *   3) 剧本层：characters / locations / props / uiStyle / originIdea 一律丢弃
 *   4) includeSubtitles=false 时 dialogue[] 被清空
 *   5) 不修改原 scenario（引用隔离）
 */

function makeFullScenario(): Scenario {
  return {
    id: 'sc-prune',
    title: '瘦身测试',
    synopsis: '简介',
    rootSceneId: 's1',
    defaultCharMs: 40,
    schemaVersion: 3,
    scenes: {
      s1: {
        id: 's1',
        title: '起',
        media: { kind: 'VIDEO', ref: 'm-s1-video' },
        durationMs: 3000,
        dialogue: [
          { id: 'd1', role: 'narration', text: '字幕一', startMs: 0 },
          { id: 'd2', role: 'character', speaker: 'c1', text: '对白', startMs: 500 },
        ],
        branches: [{ id: 'b1', kind: 'auto', targetSceneId: 's2' }],
        shots: [
          {
            id: 'sh1',
            order: 0,
            framing: 'medium',
            prompt: 'p',
            keyframeMediaRef: 'm-shot-key',
            videoMediaRef: 'm-shot-video',
          },
        ],
        sceneImages: ['m-library-1', 'm-library-2'],
        sceneVideos: ['m-library-v1'],
        keyShotId: 'sh1',
        audio: [
          {
            id: 'a1',
            role: 'bgm',
            ref: 'm-bgm',
            startMs: 0,
            durationMs: 3000,
          },
        ],
        minigames: [
          {
            id: 'mg1',
            minigameId: 'qte-click',
            startMs: 1000,
            durationMs: 500,
          },
        ],
        characterIds: ['c1'],
        locationId: 'l1',
        background: '宫殿 · 夜',
        prompts: { scene: '内部生成用', video: '视频提示' },
      },
      s2: {
        id: 's2',
        title: '承',
        media: { kind: 'IMAGE_PROMPT', ref: 'm-s2-img' },
        durationMs: 2000,
        dialogue: [],
        branches: [
          { id: 'b2', kind: 'choice', label: '选A', targetSceneId: 's3' },
          { id: 'b3', kind: 'choice', label: '选B', targetSceneId: 's4' },
        ],
      },
      s3: {
        id: 's3',
        title: '转',
        media: { kind: 'IMAGE_PROMPT', ref: 'm-s3-img' },
        durationMs: 1000,
        dialogue: [],
        branches: [],
        isEnding: true,
      },
      s4: {
        id: 's4',
        title: '合',
        media: { kind: 'IMAGE_PROMPT', ref: 'm-s4-img' },
        durationMs: 1000,
        dialogue: [],
        branches: [],
      },
      // 孤岛：没有任何 branch 指向它，rootSceneId 不等于它
      orphan: {
        id: 'orphan',
        title: '孤岛',
        media: { kind: 'IMAGE_PROMPT', ref: 'm-orphan' },
        durationMs: 500,
        dialogue: [],
        branches: [],
      },
    },
    characters: {
      c1: { id: 'c1', name: '书生', prompt: '', refImageId: 'm-char-1' },
    },
    locations: {
      l1: { id: 'l1', name: '宫殿', prompt: '', refImageId: 'm-loc-1' },
    },
    props: {
      p1: { id: 'p1', name: '书卷', prompt: '', refImageId: 'm-prop-1' },
    },
    uiStyle: { prompt: 'UI', refImageId: 'm-ui' },
    visualStyle: 'ink',
    originIdea: '作者最初的想法',
  } as Scenario
}

describe('prunePlaybackScenario', () => {
  it('只保留从 rootSceneId 可达的 scene（s1→s2→{s3,s4}），孤岛被丢', () => {
    const sc = makeFullScenario()
    const { scenario, includedScenes, droppedScenes } = prunePlaybackScenario(
      sc,
      { includeSubtitles: true },
    )
    expect(new Set(includedScenes)).toEqual(new Set(['s1', 's2', 's3', 's4']))
    expect(droppedScenes).toEqual(['orphan'])
    expect(Object.keys(scenario.scenes).sort()).toEqual(['s1', 's2', 's3', 's4'])
    expect(scenario.scenes.orphan).toBeUndefined()
  })

  it('scene 层：shots / sceneImages / sceneVideos / keyShotId / prompts / background 全部剥掉', () => {
    const sc = makeFullScenario()
    const { scenario } = prunePlaybackScenario(sc, { includeSubtitles: true })
    const s1 = scenario.scenes.s1!
    // 关键字段仍在
    expect(s1.media.ref).toBe('m-s1-video')
    expect(s1.durationMs).toBe(3000)
    expect(s1.audio?.[0]?.ref).toBe('m-bgm')
    expect(s1.minigames?.[0]?.minigameId).toBe('qte-click')
    expect(s1.branches).toHaveLength(1)
    expect(s1.characterIds).toEqual(['c1'])
    expect(s1.locationId).toBe('l1')
    // 剥掉的字段
    expect(s1.shots).toBeUndefined()
    expect(s1.sceneImages).toBeUndefined()
    expect(s1.sceneVideos).toBeUndefined()
    expect(s1.keyShotId).toBeUndefined()
    expect(s1.prompts).toBeUndefined()
    expect(s1.background).toBeUndefined()
  })

  it('剧本层：characters / locations / props / uiStyle / originIdea / visualStyle 全部丢弃', () => {
    const sc = makeFullScenario()
    const { scenario } = prunePlaybackScenario(sc, { includeSubtitles: true })
    expect(scenario.characters).toBeUndefined()
    expect(scenario.locations).toBeUndefined()
    expect(scenario.props).toBeUndefined()
    expect(scenario.uiStyle).toBeUndefined()
    expect(scenario.originIdea).toBeUndefined()
    expect(scenario.visualStyle).toBeUndefined()
    // 元数据保留
    expect(scenario.id).toBe('sc-prune')
    expect(scenario.title).toBe('瘦身测试')
    expect(scenario.synopsis).toBe('简介')
    expect(scenario.rootSceneId).toBe('s1')
    expect(scenario.defaultCharMs).toBe(40)
    expect(scenario.schemaVersion).toBe(3)
  })

  it('includeSubtitles=false 时 dialogue[] 被清空；=true 时原样保留', () => {
    const sc = makeFullScenario()

    const kept = prunePlaybackScenario(sc, { includeSubtitles: true }).scenario
    expect(kept.scenes.s1!.dialogue).toHaveLength(2)

    const stripped = prunePlaybackScenario(sc, { includeSubtitles: false }).scenario
    expect(stripped.scenes.s1!.dialogue).toEqual([])
    // 其它字段不受影响
    expect(stripped.scenes.s1!.media.ref).toBe('m-s1-video')
  })

  it('isEnding 保留（读包端据此关闭"断头"告警）', () => {
    const sc = makeFullScenario()
    const { scenario } = prunePlaybackScenario(sc, { includeSubtitles: true })
    expect(scenario.scenes.s3!.isEnding).toBe(true)
    expect(scenario.scenes.s4!.isEnding).toBeUndefined()
  })

  it('不修改原 scenario（纯函数、引用隔离）', () => {
    const sc = makeFullScenario()
    const before = JSON.stringify(sc)
    prunePlaybackScenario(sc, { includeSubtitles: false })
    expect(JSON.stringify(sc)).toBe(before)
  })

  it('rootSceneId 不存在 → 返回空 scenes', () => {
    const sc: Scenario = {
      ...makeFullScenario(),
      rootSceneId: 'no-such-scene',
    }
    const { includedScenes, scenario } = prunePlaybackScenario(sc, {
      includeSubtitles: true,
    })
    expect(includedScenes).toEqual([])
    expect(Object.keys(scenario.scenes)).toEqual([])
  })

  it('自环 / 循环分支不造成死循环', () => {
    const sc: Scenario = {
      id: 'sc-cycle',
      title: 'cycle',
      rootSceneId: 'a',
      defaultCharMs: 40,
      schemaVersion: 3,
      scenes: {
        a: {
          id: 'a',
          title: 'A',
          media: { kind: 'IMAGE_PROMPT', ref: '' },
          durationMs: 1000,
          dialogue: [],
          branches: [{ id: 'ba', kind: 'auto', targetSceneId: 'b' }],
        },
        b: {
          id: 'b',
          title: 'B',
          media: { kind: 'IMAGE_PROMPT', ref: '' },
          durationMs: 1000,
          dialogue: [],
          branches: [
            { id: 'bb', kind: 'auto', targetSceneId: 'a' },
            { id: 'bb2', kind: 'auto', targetSceneId: 'b' },
          ],
        },
      },
    }
    const { includedScenes } = prunePlaybackScenario(sc, {
      includeSubtitles: true,
    })
    expect(new Set(includedScenes)).toEqual(new Set(['a', 'b']))
  })

  it('branch 指向不存在的 scene → 跳过，不抛错', () => {
    const sc: Scenario = {
      id: 'sc-dangling',
      title: 'dangling',
      rootSceneId: 'a',
      defaultCharMs: 40,
      schemaVersion: 3,
      scenes: {
        a: {
          id: 'a',
          title: 'A',
          media: { kind: 'IMAGE_PROMPT', ref: '' },
          durationMs: 1000,
          dialogue: [],
          branches: [
            { id: 'bx', kind: 'auto', targetSceneId: 'ghost' },
          ],
        },
      },
    }
    const { includedScenes, droppedScenes } = prunePlaybackScenario(sc, {
      includeSubtitles: true,
    })
    expect(includedScenes).toEqual(['a'])
    expect(droppedScenes).toEqual([])
  })
})
