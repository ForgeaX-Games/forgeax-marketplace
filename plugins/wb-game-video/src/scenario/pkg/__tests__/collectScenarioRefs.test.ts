import { describe, expect, it } from 'vitest'
import { collectScenarioRefs, refLooksPackable } from '../collectScenarioRefs'
import type { Scenario } from '../../types'

/**
 * collectScenarioRefs 测试 —— 关键是**全字段覆盖**，
 * 漏一个字段会导致导出包里少了一个本地图/视频文件，对作者是严重 bug。
 *
 * 用一个巴掌大的假 scenario，把每个引用点都填上不同字符串，
 * 断言：
 *   1) 收集到的 cells 数量正确
 *   2) 每个 label 形如 `location/loc1/refImage` 可读
 *   3) set() 能真的写回原 scenario 对象
 *   4) 占位符（'none' / 空串 / undefined）被跳过
 */

function minimalScenario(): Scenario {
  return {
    id: 's1',
    title: 't',
    rootSceneId: 'sc1',
    defaultCharMs: 40,
    schemaVersion: 3,
    scenes: {
      sc1: {
        id: 'sc1',
        title: '开场',
        media: { kind: 'IMAGE_PROMPT', ref: 'm-scene-main' },
        durationMs: 3000,
        dialogue: [],
        branches: [],
        sceneImages: ['m-img1', 'm-img2', 'none'],
        sceneVideos: ['m-vid1'],
        audio: [
          {
            id: 'a1',
            role: 'bgm',
            ref: 'm-bgm',
            startMs: 0,
            durationMs: 3000,
          },
          {
            id: 'a2',
            role: 'sfx',
            ref: '', // 空串，应跳过
            startMs: 500,
            durationMs: 200,
          },
        ],
        shots: [
          {
            id: 'sh1',
            order: 0,
            framing: 'medium',
            prompt: 'p',
            keyframeMediaRef: 'm-kf1',
            startFrameMediaRef: 'm-sf1',
            endFrameMediaRef: 'm-ef1',
            videoMediaRef: 'm-shv1',
          },
          {
            id: 'sh2',
            order: 1,
            framing: 'wide',
            prompt: 'q',
            // 只有一部分字段 —— 其他字段 undefined 应跳过
            keyframeMediaRef: 'm-kf2',
          },
        ],
      },
    },
    characters: {
      c1: {
        id: 'c1',
        name: '书生',
        prompt: '',
        refImageId: 'm-c1-ref',
        turnaroundRefImageId: 'm-c1-turnaround',
      },
      c2: {
        id: 'c2',
        name: '仙女',
        prompt: '',
        // 没填参考图 → 应跳过
      },
    },
    locations: {
      loc1: {
        id: 'loc1',
        name: '女儿国',
        prompt: '',
        refImageId: 'm-loc1-ref',
        angleRefs: [
          { id: 'loc1-angle1', label: '宫殿', anglePrompt: '', mediaId: 'm-loc1-a1' },
          { id: 'loc1-angle2', label: '庭院', anglePrompt: '' }, // 无 mediaId → 跳过
          { id: 'loc1-angle3', label: '城门', anglePrompt: '', mediaId: 'm-loc1-a3' },
        ],
      },
    },
    props: {
      p1: {
        id: 'p1',
        name: '紫金钵',
        prompt: '',
        refImageId: 'm-prop-p1',
      },
    },
    uiStyle: {
      prompt: '',
      refImageId: 'm-ui-ref',
    },
  }
}

describe('refLooksPackable', () => {
  it('空串 / undefined / 占位符均返回 false', () => {
    expect(refLooksPackable('')).toBe(false)
    expect(refLooksPackable(undefined)).toBe(false)
    expect(refLooksPackable('none')).toBe(false)
    expect(refLooksPackable('__placeholder__')).toBe(false)
  })
  it('任意非空非占位值都打包（包括 mediaId / URL / data:）', () => {
    expect(refLooksPackable('m-xxx')).toBe(true)
    expect(refLooksPackable('/__reel__/assets/abc')).toBe(true)
    expect(refLooksPackable('https://cdn.example.com/x.mp4')).toBe(true)
    expect(refLooksPackable('data:image/png;base64,aa==')).toBe(true)
  })
})

describe('collectScenarioRefs · 全字段覆盖', () => {
  it('收集到的 cells 覆盖所有合法引用点且跳过空值', () => {
    const sc = minimalScenario()
    const cells = collectScenarioRefs(sc)

    const labels = cells.map((c) => c.label).sort()
    expect(labels).toEqual(
      [
        'character/c1/refImage',
        'character/c1/turnaround',
        'location/loc1/refImage',
        'location/loc1/angle1',
        'location/loc1/angle3',
        'prop/p1/refImage',
        'uiStyle/refImage',
        'scene/sc1/media',
        'scene/sc1/sceneImages/0',
        'scene/sc1/sceneImages/1',
        'scene/sc1/sceneVideos/0',
        'scene/sc1/audio/a1',
        'scene/sc1/shot/sh1/keyframe',
        'scene/sc1/shot/sh1/startFrame',
        'scene/sc1/shot/sh1/endFrame',
        'scene/sc1/shot/sh1/video',
        'scene/sc1/shot/sh2/keyframe',
      ].sort(),
    )
  })

  it('get() 返回的是当前字段的值', () => {
    const sc = minimalScenario()
    const cells = collectScenarioRefs(sc)
    const shot1Kf = cells.find((c) => c.label === 'scene/sc1/shot/sh1/keyframe')!
    expect(shot1Kf.get()).toBe('m-kf1')
  })

  it('set() 能真正改写到 scenario 对象（模拟打包后 URL 重写）', () => {
    const sc = minimalScenario()
    const cells = collectScenarioRefs(sc)

    for (const cell of cells) {
      cell.set(`pkg:${cell.get()}`)
    }

    expect(sc.characters!.c1!.refImageId).toBe('pkg:m-c1-ref')
    expect(sc.characters!.c1!.turnaroundRefImageId).toBe('pkg:m-c1-turnaround')
    expect(sc.locations!.loc1!.refImageId).toBe('pkg:m-loc1-ref')
    expect(sc.locations!.loc1!.angleRefs![0]!.mediaId).toBe('pkg:m-loc1-a1')
    expect(sc.locations!.loc1!.angleRefs![2]!.mediaId).toBe('pkg:m-loc1-a3')
    expect(sc.props!.p1!.refImageId).toBe('pkg:m-prop-p1')
    expect(sc.uiStyle!.refImageId).toBe('pkg:m-ui-ref')
    expect(sc.scenes.sc1!.media.ref).toBe('pkg:m-scene-main')
    expect(sc.scenes.sc1!.sceneImages).toEqual([
      'pkg:m-img1',
      'pkg:m-img2',
      'none', // 原样保留占位符
    ])
    expect(sc.scenes.sc1!.sceneVideos).toEqual(['pkg:m-vid1'])
    expect(sc.scenes.sc1!.audio![0]!.ref).toBe('pkg:m-bgm')
    expect(sc.scenes.sc1!.audio![1]!.ref).toBe('') // 原样保留空串
    const sh1 = sc.scenes.sc1!.shots![0]!
    expect(sh1.keyframeMediaRef).toBe('pkg:m-kf1')
    expect(sh1.startFrameMediaRef).toBe('pkg:m-sf1')
    expect(sh1.endFrameMediaRef).toBe('pkg:m-ef1')
    expect(sh1.videoMediaRef).toBe('pkg:m-shv1')
  })

  it('空 scenarios / 没有 shots / 没有 characters 等字段缺失也不抛', () => {
    const empty: Scenario = {
      id: 's',
      title: 't',
      rootSceneId: 'x',
      scenes: {},
      defaultCharMs: 40,
      schemaVersion: 3,
    }
    expect(collectScenarioRefs(empty)).toEqual([])
  })
})
