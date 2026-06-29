/**
 * Phase 5 · actLoopbackContext + actBatchPipeline (sequential) 单测。
 *
 * 覆盖：
 *   1. buildLockedAnchorsPrompt：从 scenario 的 characters/locations/props/uiStyle 提取硬约束
 *   2. summarizeForPrecedingContext + buildPrecedingContextPrompt：摘要生成与裁剪
 *   3. resolveLoopbackStrategy：auto 阈值与显式覆盖
 *   4. forgePromptTrioForAct：lockedAnchors / precedingContext 注入到 user prompt
 *   5. runActBatchPipeline (sequential)：preceding context 顺序滚雪球喂下一批
 *   6. runActBatchUpgradeOnScenario：默认 auto 策略下 sequential 行为正确
 */

import { describe, it, expect } from 'vitest'

import {
  buildLockedAnchorsPrompt,
  summarizeForPrecedingContext,
  buildPrecedingContextPrompt,
} from '../actLoopbackContext'
import {
  resolveLoopbackStrategy,
  runActBatchUpgradeOnScenario,
} from '../runActBatchUpgrade'
import { runActBatchPipeline } from '../actBatchPipeline'
import { forgePromptTrioForAct } from '../forgePromptTrioForAct'

import type { Scenario, Scene } from '../../scenario/types'
import type { ActScenePromptTrio } from '../forgePromptTrioForAct'
import type { TextClient } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeScene(id: string, title = id, next?: string): Scene {
  return {
    id,
    title,
    media: { kind: 'image' },
    durationMs: 30_000,
    branches: next ? [{ id: `${id}_b`, label: '继续', nextSceneId: next }] : [],
  } as Scene
}

function makeScenario(): Scenario {
  return {
    id: 'sc01',
    title: '老火车站',
    synopsis: '一段民国黑白回忆',
    visualStyle: '民国手绘',
    rootSceneId: 's1',
    scenes: {
      s1: makeScene('s1', '场景一', 's2'),
      s2: makeScene('s2', '场景二', 's3'),
      s3: makeScene('s3', '场景三'),
    },
    characters: {
      c1: {
        id: 'c1',
        name: '阿楠',
        prompt: '黑色羊毛大衣，左眉有疤，颈间银项链',
      },
      c2: {
        id: 'c2',
        name: '老周',
        prompt: '', // 空 prompt 应被过滤
      },
    },
    locations: {
      l1: {
        id: 'l1',
        name: '老火车站',
        prompt: '青砖月台，铁轨锈迹，远端蒸汽机车头',
      },
    },
    props: {
      p1: {
        id: 'p1',
        name: '锈蚀火车票',
        prompt: '泛黄硬纸，边缘卷曲',
      },
    },
    uiStyle: { prompt: '暗黑民国手绘' },
  } as unknown as Scenario
}

function makeTrio(sceneId: string, image: string, video: string): ActScenePromptTrio {
  return {
    sceneId,
    image,
    video,
    shots: [
      { kind: 'wide', duration: 3, prompt: `${sceneId} 远景` },
      { kind: 'close', duration: 4, prompt: `${sceneId} 近景` },
    ],
    warnings: [],
  } as ActScenePromptTrio
}

/** 一个会捕获每次调用 user prompt 的 mock LLM；返回固定 trio JSON。 */
function makeCapturingMock(buildResp: (sceneIds: string[]) => string) {
  const calls: { user: string; system: string }[] = []
  const llm = {
    getProviderName: () => 'mock',
    getModel: () => 'mock-trio',
    async generate(req: { systemPrompt: string; userPrompt: string }) {
      calls.push({ user: req.userPrompt, system: req.systemPrompt })
      const sceneIds = Array.from(req.userPrompt.matchAll(/sceneId[:：]\s*([a-zA-Z0-9_]+)/g)).map(
        (m) => m[1]!,
      )
      return buildResp(sceneIds)
    },
  } as unknown as TextClient
  return { llm, calls }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. buildLockedAnchorsPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe('buildLockedAnchorsPrompt', () => {
  it('提取 characters/locations/props/uiStyle 并标注硬约束', () => {
    const scenario = makeScenario()
    const text = buildLockedAnchorsPrompt(scenario)
    expect(text).toContain('LOCKED ANCHORS')
    expect(text).toContain('硬约束')
    expect(text).toContain('阿楠')
    expect(text).toContain('黑色羊毛大衣')
    expect(text).toContain('老火车站')
    expect(text).toContain('锈蚀火车票')
    expect(text).toContain('UI 风格：暗黑民国手绘')
    expect(text).toContain('视觉风格：民国手绘')
  })

  it('空 prompt 的角色被过滤', () => {
    const text = buildLockedAnchorsPrompt(makeScenario())
    expect(text).not.toContain('老周')
  })

  it('完全没有锚点时返回空字符串', () => {
    const empty: Scenario = {
      id: 'x',
      title: '',
      scenes: {},
      rootSceneId: '',
      characters: {},
      locations: {},
    } as unknown as Scenario
    expect(buildLockedAnchorsPrompt(empty)).toBe('')
  })

  // v3.10 · 锚点回流增强：aliases / anchor / appearanceVariants 必须出现在 LOCKED ANCHORS 文本中。
  // LLM 在多 Act batch trio 时靠这些字段把"那个男人/凶手装"这种模糊指代归一到 character.id，
  // 并能在 shot 级精确选用 variant。少了任何一项都会让一致性退化，所以测一遍。
  it('v3.10 · aliases / anchor / appearanceVariants 进入 LOCKED ANCHORS', () => {
    const scenario: Scenario = {
      id: 'sc01',
      title: 't',
      scenes: {},
      rootSceneId: '',
      characters: {
        c1: {
          id: 'c1',
          name: '李建',
          prompt: '黑色羊毛大衣',
          aliases: ['那个男人', '老李', '凶手'],
          anchor: '左眉疤痕、低哑嗓音',
          appearanceVariants: [
            { id: 'v-suit', label: '凶手装', prompt: '黑手套，带血迹', aliases: ['凶手'] },
            { id: 'v-clean', label: '常态', prompt: '' },
          ],
        },
      },
      props: {
        p1: {
          id: 'p1',
          name: '猎刀',
          prompt: '黑柄折叠刀',
          aliases: ['那把刀', '凶器'],
          anchor: '黑柄、刻 K 字母',
          variants: [
            { id: 'pv-broken', label: '断刃', prompt: '刃断成两截' },
          ],
        },
      },
    } as unknown as Scenario

    const text = buildLockedAnchorsPrompt(scenario)
    // 角色 alias / anchor / variant 都在
    expect(text).toContain('[c1]')
    expect(text).toContain('别名: 那个男人 / 老李 / 凶手')
    expect(text).toContain('识别锚: 左眉疤痕、低哑嗓音')
    expect(text).toContain('[v-suit]')
    expect(text).toContain('凶手装')
    expect(text).toContain('黑手套，带血迹')
    expect(text).toContain('characterVariantIds')
    // 道具 alias / anchor / variant
    expect(text).toContain('[p1]')
    expect(text).toContain('别名: 那把刀 / 凶器')
    expect(text).toContain('识别锚: 黑柄、刻 K 字母')
    expect(text).toContain('[pv-broken]')
    expect(text).toContain('断刃')
    expect(text).toContain('propVariantIds')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. summarizeForPrecedingContext + buildPrecedingContextPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe('summarizeForPrecedingContext / buildPrecedingContextPrompt', () => {
  it('生成简要摘要（image 取首句、video 取首个时间码段）', () => {
    const scenario = makeScenario()
    const trios = [
      makeTrio(
        's1',
        '民国手绘风格，阿楠站在月台，蒸汽弥漫，光影斑驳',
        '[0-3秒] 推近至阿楠，缓慢呼气\n[3-7秒] 镜头摇向远处机车',
      ),
    ]
    const summaries = summarizeForPrecedingContext(scenario.scenes, trios)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.sceneId).toBe('s1')
    expect(summaries[0]!.title).toBe('场景一')
    expect(summaries[0]!.imageGist).toContain('民国手绘风格')
    expect(summaries[0]!.imageGist.length).toBeLessThanOrEqual(60)
    expect(summaries[0]!.videoGist).toContain('[0-3')
  })

  it('buildPrecedingContextPrompt 在 ≤ maxItems 时全保留', () => {
    const scenario = makeScenario()
    const trios = [makeTrio('s1', 'A', 'B'), makeTrio('s2', 'C', 'D')]
    const summaries = summarizeForPrecedingContext(scenario.scenes, trios)
    const text = buildPrecedingContextPrompt(summaries, 12)
    expect(text).toContain('PRECEDING_ACT_CONTEXT')
    expect(text).toContain('s1')
    expect(text).toContain('s2')
  })

  it('超出 maxItems 时取首尾各一半', () => {
    const summaries = Array.from({ length: 20 }, (_, i) => ({
      sceneId: `s${i}`,
      title: `场景${i}`,
      imageGist: `image${i}`,
      videoGist: `video${i}`,
    }))
    const text = buildPrecedingContextPrompt(summaries, 6)
    // 期望：取前 3 + 后 3
    expect(text).toContain('s0')
    expect(text).toContain('s2')
    expect(text).toContain('s17')
    expect(text).toContain('s19')
    // 中间的应被裁剪
    expect(text).not.toContain('s10')
  })

  it('空 summaries 返回空字符串', () => {
    expect(buildPrecedingContextPrompt([])).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. resolveLoopbackStrategy
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveLoopbackStrategy', () => {
  it('显式 sequential / none 直接返回', () => {
    expect(resolveLoopbackStrategy('sequential', 100)).toBe('sequential')
    expect(resolveLoopbackStrategy('none', 1)).toBe('none')
  })

  it('auto / undefined 阈值 18', () => {
    expect(resolveLoopbackStrategy('auto', 18)).toBe('sequential')
    expect(resolveLoopbackStrategy('auto', 19)).toBe('none')
    expect(resolveLoopbackStrategy(undefined, 5)).toBe('sequential')
    expect(resolveLoopbackStrategy(undefined, 50)).toBe('none')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. forgePromptTrioForAct 注入 lockedAnchors / precedingContext
// ─────────────────────────────────────────────────────────────────────────────

describe('forgePromptTrioForAct · loopback 字段注入', () => {
  it('lockedAnchorsPrompt 与 precedingContextPrompt 都进入 user message', async () => {
    const { llm, calls } = makeCapturingMock((sceneIds) => {
      return JSON.stringify({
        scenes: sceneIds.map((sid) => ({
          sceneId: sid,
          image: `image-${sid}`,
          video: `[0-5秒] video-${sid}`,
          storyboard: [{ kind: 'wide', duration: 3, prompt: 'p' }],
        })),
      })
    })

    await forgePromptTrioForAct(llm, {
      actId: 'act1',
      actTitle: '第一幕',
      scenes: [
        { sceneId: 's1', title: '场景一', beat: '主角登场' },
      ],
      lockedAnchorsPrompt: '【LOCKED ANCHORS】角色阿楠：黑大衣',
      precedingContextPrompt: '【PRECEDING_ACT_CONTEXT】前情：s0 月台',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.user).toContain('LOCKED ANCHORS')
    expect(calls[0]!.user).toContain('黑大衣')
    expect(calls[0]!.user).toContain('PRECEDING_ACT_CONTEXT')
    expect(calls[0]!.user).toContain('s0 月台')
  })

  it('两个 loopback 字段都为空时不注入', async () => {
    const { llm, calls } = makeCapturingMock(() =>
      JSON.stringify({
        scenes: [
          {
            sceneId: 's1',
            image: 'img',
            video: '[0-5秒] vid',
            storyboard: [{ kind: 'wide', duration: 3, prompt: 'p' }],
          },
        ],
      }),
    )

    await forgePromptTrioForAct(llm, {
      actId: 'act1',
      actTitle: '第一幕',
      scenes: [{ sceneId: 's1', title: '场景一', beat: '主角登场' }],
    })

    expect(calls[0]!.user).not.toContain('LOCKED ANCHORS')
    expect(calls[0]!.user).not.toContain('PRECEDING_ACT_CONTEXT')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. runActBatchPipeline · sequential 滚雪球
// ─────────────────────────────────────────────────────────────────────────────

describe('runActBatchPipeline · sequential 滚雪球', () => {
  it('第二批的 user prompt 含第一批的 PRECEDING_ACT_CONTEXT 摘要', async () => {
    const scenario = makeScenario()
    // 强制每批 1 场，制造 3 批
    const { llm, calls } = makeCapturingMock((sceneIds) =>
      JSON.stringify({
        scenes: sceneIds.map((sid) => ({
          sceneId: sid,
          image: `民国手绘，${sid} 主角站定，光影分明`,
          video: `[0-3秒] ${sid} 推近\n[3-6秒] 摇镜`,
          storyboard: [{ kind: 'wide', duration: 3, prompt: 'p' }],
        })),
      }),
    )

    const result = await runActBatchPipeline(llm, {
      scenesById: scenario.scenes,
      charactersById: scenario.characters ?? {},
      locationsById: scenario.locations,
      acts: [
        {
          actId: 'act1',
          actTitle: '主线',
          sceneIds: ['s1', 's2', 's3'],
        },
      ],
      visualStyle: scenario.visualStyle,
      maxScenesPerBatch: 1,
      precedingContextStrategy: 'sequential',
      lockedAnchorsPrompt: '【LOCKED ANCHORS】test',
    })

    expect(result.batches).toHaveLength(3)
    expect(result.failures).toHaveLength(0)
    expect(Object.keys(result.byScene)).toEqual(['s1', 's2', 's3'])

    // 第一批：有 lockedAnchors，无 preceding
    expect(calls[0]!.user).toContain('LOCKED ANCHORS')
    expect(calls[0]!.user).not.toContain('PRECEDING_ACT_CONTEXT')

    // 第二批：preceding 应包含 s1 摘要
    expect(calls[1]!.user).toContain('PRECEDING_ACT_CONTEXT')
    expect(calls[1]!.user).toContain('s1')

    // 第三批：preceding 应包含 s1 + s2 摘要
    expect(calls[2]!.user).toContain('PRECEDING_ACT_CONTEXT')
    expect(calls[2]!.user).toContain('s1')
    expect(calls[2]!.user).toContain('s2')
  })

  it('sequential 模式下单批失败不影响后续批的 preceding 累积', async () => {
    const scenario = makeScenario()
    let callIdx = 0
    const llm = {
      getProviderName: () => 'mock',
      getModel: () => 'mock-trio',
      async generate(req: { systemPrompt: string; userPrompt: string }) {
        const sceneIds = Array.from(
          req.userPrompt.matchAll(/sceneId[:：]\s*([a-zA-Z0-9_]+)/g),
        ).map((m) => m[1]!)
        const i = callIdx++
        if (i === 1) {
          throw new Error('synthetic batch-2 failure')
        }
        return JSON.stringify({
          scenes: sceneIds.map((sid) => ({
            sceneId: sid,
            image: `img-${sid}`,
            video: `[0-3秒] vid-${sid}`,
            storyboard: [{ kind: 'wide', duration: 3, prompt: 'p' }],
          })),
        })
      },
    } as unknown as TextClient

    const result = await runActBatchPipeline(llm, {
      scenesById: scenario.scenes,
      charactersById: scenario.characters ?? {},
      locationsById: scenario.locations,
      acts: [
        { actId: 'act1', actTitle: '主线', sceneIds: ['s1', 's2', 's3'] },
      ],
      maxScenesPerBatch: 1,
      precedingContextStrategy: 'sequential',
    })

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.batch.sceneIds).toEqual(['s2'])
    // s1 + s3 应都成功
    expect(Object.keys(result.byScene).sort()).toEqual(['s1', 's3'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. runActBatchUpgradeOnScenario · auto 策略默认开启 sequential（小 scenario）
// ─────────────────────────────────────────────────────────────────────────────

describe('runActBatchUpgradeOnScenario · loopback 默认 auto', () => {
  it('小 scenario 默认走 sequential，且 lockedAnchors 来自 scenario', async () => {
    const scenario = makeScenario()
    const { llm, calls } = makeCapturingMock((sceneIds) =>
      JSON.stringify({
        scenes: sceneIds.map((sid) => ({
          sceneId: sid,
          image: `img-${sid}`,
          video: `[0-3秒] vid-${sid}`,
          storyboard: [{ kind: 'wide', duration: 3, prompt: 'p' }],
        })),
      }),
    )

    const result = await runActBatchUpgradeOnScenario(llm, scenario, {
      maxScenesPerBatch: 1, // 强制多批以观察 sequential 行为
    })

    expect(result.failedSceneIds).toEqual([])
    expect(result.upgradedSceneIds.sort()).toEqual(['s1', 's2', 's3'])

    // 每个 user prompt 都应包含从 scenario 提取的 LOCKED_ANCHORS
    for (const c of calls) {
      expect(c.user).toContain('LOCKED ANCHORS')
      expect(c.user).toContain('阿楠')
      expect(c.user).toContain('黑色羊毛大衣')
    }

    // 第二批起应有 PRECEDING_ACT_CONTEXT（默认 auto + 3 scenes ≤ 18 = sequential）
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[1]!.user).toContain('PRECEDING_ACT_CONTEXT')
  })

  it('显式 loopback: none 时不滚雪球（首批之外也无 preceding）', async () => {
    const scenario = makeScenario()
    const { llm, calls } = makeCapturingMock((sceneIds) =>
      JSON.stringify({
        scenes: sceneIds.map((sid) => ({
          sceneId: sid,
          image: `img-${sid}`,
          video: `[0-3秒] vid-${sid}`,
          storyboard: [{ kind: 'wide', duration: 3, prompt: 'p' }],
        })),
      }),
    )

    await runActBatchUpgradeOnScenario(llm, scenario, {
      maxScenesPerBatch: 1,
      loopback: 'none',
    })

    for (const c of calls) {
      expect(c.user).not.toContain('PRECEDING_ACT_CONTEXT')
      // lockedAnchors 仍应注入
      expect(c.user).toContain('LOCKED ANCHORS')
    }
  })
})
