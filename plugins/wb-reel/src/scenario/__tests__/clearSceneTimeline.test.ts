import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'

/**
 * clearSceneTimeline —— 一键清空时间轴上的 clip。
 *
 * 覆盖契约（v3.9.4 起 · 作者需求反转）：
 *   - 清 dialogue / qte / shots / audio / keyShotId / minigames
 *   - 若 media.kind === 'VIDEO' → media 重置为 PLACEHOLDER，
 *     同时清 videoOffsetMs / videoClipDurationMs / videoNaturalDurationMs
 *   - **保留** title / durationMs / background / characterIds / locationId /
 *     pos / branches（剧情树连线）/ sceneImages / sceneVideos（素材库）/
 *     IMAGE 系 media（作者的底图）
 *   - 别的 scene 不受影响
 *   - 全空场景调用一次 → 不产生新引用（避免无效订阅抖动）
 *
 * 设计理由：
 *   sceneImages / sceneVideos 是"作者的历史素材库"，清空时间轴只该抹"摆
 *   在时间轴上的 clip"，不该连坐把素材历史抹掉（v3.9.4 作者反馈 v3.4 做法
 *   过于激进）。branches 是剧情树拓扑边，不能动（早期版本误清过，作者反馈
 *   非常强烈）。
 */

function reset(): void {
  useScenarioStore.setState({
    scenario: getDemoScenario(),
    selectedSceneId: 'intro',
    selection: { kind: 'scene', sceneId: 'intro' },
    mode: 'editor',
  })
  useScenarioStore.temporal.getState().clear()
}

describe('scenarioStore · clearSceneTimeline', () => {
  beforeEach(reset)
  afterEach(reset)

  it('清空 dialogue / shots / audio / qte / keyShotId（branches 保留不动）', () => {
    // demoScenario 的 intro 场景自带台词与分支；先把各类都补齐
    const api = useScenarioStore.getState()
    api.addShot('intro', { framing: 'medium', prompt: '镜头1' })
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            audio: [
              { id: 'a-1', role: 'bgm', ref: 'm-1', startMs: 0, durationMs: 500 },
            ],
            qte: {
              // 最小 QTE 占位（schema 字段用 as never 降压，这里只关心清空行为）
              kind: 'TAP',
              targetMs: 500,
              windowMs: 300,
              onSuccess: 'continue',
              onFail: 'continue',
            } as never,
            keyShotId: 'key-1',
          },
        },
      },
    }))

    const branchesBefore = useScenarioStore.getState().scenario.scenes.intro!.branches
    api.clearSceneTimeline('intro')

    const scene = useScenarioStore.getState().scenario.scenes.intro!
    expect(scene.dialogue).toEqual([])
    expect(scene.shots).toEqual([])
    expect(scene.audio).toEqual([])
    expect(scene.qte).toBeUndefined()
    expect(scene.keyShotId).toBeUndefined()
    // 关键回归：branches **原样保留**（demoScenario 的 intro 带分支，不该被抹）
    expect(scene.branches).toEqual(branchesBefore)
  })

  it('回归：清空不拆剧情树 —— intro 的所有出边 targetSceneId 保持不变', () => {
    // 作者反馈过"清空之后，前面的节点断开了显示成两行了"—— 根因是把
    // branches[] 清了。这里锁死：清空后出边列表 id/target 序列不能变。
    const api = useScenarioStore.getState()
    const before = useScenarioStore
      .getState()
      .scenario.scenes.intro!.branches.map((b) => ({ id: b.id, target: b.targetSceneId }))
    expect(before.length).toBeGreaterThan(0) // demoScenario 前置条件校验
    api.clearSceneTimeline('intro')
    const after = useScenarioStore
      .getState()
      .scenario.scenes.intro!.branches.map((b) => ({ id: b.id, target: b.targetSceneId }))
    expect(after).toEqual(before)
  })

  it('保留 scene 基础信息（title / media / durationMs / background / pos / characterIds / locationId）', () => {
    const api = useScenarioStore.getState()
    // 打点：人工给 intro 加一些保留字段
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            background: '雨夜霓虹',
            pos: { x: 120, y: 80 },
            characterIds: ['hero'],
            locationId: 'loc-1',
          },
        },
      },
    }))
    const before = useScenarioStore.getState().scenario.scenes.intro!
    const beforeTitle = before.title
    const beforeMedia = before.media
    const beforeDur = before.durationMs

    api.clearSceneTimeline('intro')

    const after = useScenarioStore.getState().scenario.scenes.intro!
    expect(after.title).toBe(beforeTitle)
    expect(after.media).toBe(beforeMedia)
    expect(after.durationMs).toBe(beforeDur)
    expect(after.background).toBe('雨夜霓虹')
    expect(after.pos).toEqual({ x: 120, y: 80 })
    expect(after.characterIds).toEqual(['hero'])
    expect(after.locationId).toBe('loc-1')
  })

  it('保留 sceneImages / sceneVideos（v3.9.4 · 作者改主意：素材库不连坐）', () => {
    const api = useScenarioStore.getState()
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            sceneImages: ['img-a', 'img-b'],
            sceneVideos: ['vid-a'],
          },
        },
      },
    }))

    api.clearSceneTimeline('intro')

    const after = useScenarioStore.getState().scenario.scenes.intro!
    // 素材库原样保留
    expect(after.sceneImages).toEqual(['img-a', 'img-b'])
    expect(after.sceneVideos).toEqual(['vid-a'])
  })

  it('isEmpty 判定不再看 sceneImages / sceneVideos —— 只有它们非空时视为已空（early-return）', () => {
    // v3.9.4：素材库不再被 clearSceneTimeline 涉及，因此"只有素材库非空"
    //         等价于"时间轴已空"，应该 early-return，scenario 引用保持不变。
    const api = useScenarioStore.getState()
    api.clearSceneTimeline('intro') // 先清一轮，拿到干净起点
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            sceneImages: ['img-only'],
            sceneVideos: [],
          },
        },
      },
    }))
    const before = useScenarioStore.getState().scenario
    api.clearSceneTimeline('intro')
    const after = useScenarioStore.getState().scenario
    expect(after).toBe(before) // 引用不变 = early-return
    expect(after.scenes.intro!.sceneImages).toEqual(['img-only']) // 素材原样
  })

  it('media.kind === "VIDEO" 时 → media 重置为 PLACEHOLDER 且清掉 trim 字段', () => {
    // 作者视角：VIDEO 轨上的蓝条就是时间轴 clip，清空必须把它抹掉。
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            media: { kind: 'VIDEO', ref: 'vid-ref' },
            videoOffsetMs: 500,
            videoClipDurationMs: 3000,
            videoNaturalDurationMs: 5000,
          },
        },
      },
    }))

    const api = useScenarioStore.getState()
    api.clearSceneTimeline('intro')

    const after = useScenarioStore.getState().scenario.scenes.intro!
    expect(after.media).toEqual({ kind: 'PLACEHOLDER' })
    expect(after.videoOffsetMs).toBeUndefined()
    expect(after.videoClipDurationMs).toBeUndefined()
    expect(after.videoNaturalDurationMs).toBeUndefined()
  })

  it('media.kind === "IMAGE_PROMPT" 不变 —— 底图不是时间轴产物', () => {
    const imgMedia = { kind: 'IMAGE_PROMPT' as const, prompt: 'x', ref: 'img-ref' }
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            media: imgMedia,
            // 同时放一条 dialogue 让 isEmpty=false 走到真正的清空分支
            dialogue: [{ id: 'd1', text: 't', startMs: 0, durationMs: 500 }],
          },
        },
      },
    }))
    const api = useScenarioStore.getState()
    api.clearSceneTimeline('intro')
    const after = useScenarioStore.getState().scenario.scenes.intro!
    expect(after.media).toBe(imgMedia) // 引用相等 —— 未动
  })

  it('不影响其他 scene', () => {
    const api = useScenarioStore.getState()
    const before = useScenarioStore.getState().scenario.scenes
    api.clearSceneTimeline('intro')
    const after = useScenarioStore.getState().scenario.scenes
    for (const id of Object.keys(after)) {
      if (id === 'intro') continue
      // 引用相等：别的 scene 原对象没被重建
      expect(after[id]).toBe(before[id])
    }
  })

  it('对已经全空的场景调用 —— scenario 引用保持不变', () => {
    const api = useScenarioStore.getState()
    api.clearSceneTimeline('intro')
    const snapshot1 = useScenarioStore.getState().scenario
    api.clearSceneTimeline('intro')
    const snapshot2 = useScenarioStore.getState().scenario
    expect(snapshot2).toBe(snapshot1)
  })

  it('未知 sceneId 安全返回（不抛）', () => {
    const api = useScenarioStore.getState()
    expect(() => api.clearSceneTimeline('no-such-scene')).not.toThrow()
  })

  /*
   * v3.9.2 · VIDEO 轨一并清。
   *
   * 作者反馈："我清空或删除视频后，这个视频轨道中的 ui 依旧存在"。
   * 根因：之前 clearSceneTimeline 一律保留 scene.media 引用 —— 但对于
   * VIDEO 场景，蓝条就是"时间轴 clip"语义的一部分，清空应该连同清。
   * 锁死契约：
   *   1) media.kind=VIDEO → 变成 PLACEHOLDER，ref 消失
   *   2) videoOffsetMs / videoClipDurationMs / videoNaturalDurationMs 一并删
   *   3) 只拖过视频、别的都没改时，点清空也要真正产生新引用
   *      （之前 isEmpty 判定没看 media.kind，按钮失灵）
   *   4) IMAGE_PROMPT / IMAGE_STATIC / PLACEHOLDER 的 scene.media 依然不动
   */
  it('VIDEO 场景清空：media 回 PLACEHOLDER，videoOffset/clip/natural 都删', () => {
    const api = useScenarioStore.getState()
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            media: { kind: 'VIDEO', ref: 'media-xyz' },
            videoOffsetMs: 500,
            videoClipDurationMs: 3000,
            videoNaturalDurationMs: 30_000,
          },
        },
      },
    }))
    api.clearSceneTimeline('intro')
    const after = useScenarioStore.getState().scenario.scenes.intro!
    expect(after.media).toEqual({ kind: 'PLACEHOLDER' })
    expect(after.videoOffsetMs).toBeUndefined()
    expect(after.videoClipDurationMs).toBeUndefined()
    expect(after.videoNaturalDurationMs).toBeUndefined()
  })

  it('只有 VIDEO、别字段全空时，clearSceneTimeline 真的清（isEmpty 不能 early-return）', () => {
    const api = useScenarioStore.getState()
    api.clearSceneTimeline('intro')
    useScenarioStore.setState((s) => ({
      scenario: {
        ...s.scenario,
        scenes: {
          ...s.scenario.scenes,
          intro: {
            ...s.scenario.scenes.intro!,
            media: { kind: 'VIDEO', ref: 'only-video' },
          },
        },
      },
    }))
    const before = useScenarioStore.getState().scenario
    api.clearSceneTimeline('intro')
    const after = useScenarioStore.getState().scenario
    expect(after).not.toBe(before)
    expect(after.scenes.intro!.media.kind).toBe('PLACEHOLDER')
  })

  it('IMAGE_PROMPT 的 media 不被清（底图保留，和作者直觉一致）', () => {
    // demoScenario.intro.media.kind === 'IMAGE_PROMPT'
    const api = useScenarioStore.getState()
    const mediaBefore = useScenarioStore.getState().scenario.scenes.intro!.media
    api.clearSceneTimeline('intro')
    const mediaAfter = useScenarioStore.getState().scenario.scenes.intro!.media
    // 引用不变 —— 未被重建
    expect(mediaAfter).toBe(mediaBefore)
  })
})
