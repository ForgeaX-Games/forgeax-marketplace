/**
 * runActBatchUpgradeOnScenario 单测。
 *
 * 覆盖：
 *   1. orderScenesForUpgrade：BFS 顺序 + 不可达 scene 追尾 + 缺 root 兜底
 *   2. mergeTrioIntoScene：image/video/shots 写入策略 + 空值保留原值
 *   3. runActBatchUpgradeOnScenario：mock LLM → byScene 映射回 scenario.scenes
 *      + failures sceneIds 不被改写
 */

import { describe, it, expect, vi } from 'vitest'

import {
  orderScenesForUpgrade,
  mergeTrioIntoScene,
  runActBatchUpgradeOnScenario,
} from '../runActBatchUpgrade'

import type { Scenario, Scene, Shot } from '../../scenario/types'
import type { ActScenePromptTrio } from '../forgePromptTrioForAct'
import type { TextClient, TextRequest } from '../types'

function makeScene(
  id: string,
  branches: { targetSceneId: string }[] = [],
  overrides: Partial<Scene> = {},
): Scene {
  return {
    id,
    title: `场景 ${id}`,
    media: { kind: 'image', prompt: `原 image ${id}` },
    durationMs: 45_000,
    dialogue: [],
    branches: branches.map((b, i) => ({
      id: `b${i}`,
      label: '',
      kind: 'auto' as const,
      targetSceneId: b.targetSceneId,
    })) as Scene['branches'],
    prompts: { scene: `原 prompt ${id}`, video: `原 video ${id}` },
    ...overrides,
  } as Scene
}

function makeScenario(scenes: Record<string, Scene>, rootId: string): Scenario {
  return {
    id: 'sc01',
    title: 'demo',
    rootSceneId: rootId,
    scenes,
    defaultCharMs: 50,
    schemaVersion: 3,
  } as Scenario
}

describe('orderScenesForUpgrade', () => {
  it('BFS 顺序：root 先，其次 root 的分支目标', () => {
    const scenes = {
      a: makeScene('a', [{ targetSceneId: 'b' }, { targetSceneId: 'c' }]),
      b: makeScene('b', [{ targetSceneId: 'd' }]),
      c: makeScene('c'),
      d: makeScene('d'),
    }
    const sc = makeScenario(scenes, 'a')
    expect(orderScenesForUpgrade(sc)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('不可达 scene 追尾', () => {
    const scenes = {
      a: makeScene('a', [{ targetSceneId: 'b' }]),
      b: makeScene('b'),
      orphan: makeScene('orphan'),
    }
    const sc = makeScenario(scenes, 'a')
    const order = orderScenesForUpgrade(sc)
    expect(order.slice(0, 2)).toEqual(['a', 'b'])
    expect(order).toContain('orphan')
    expect(order.indexOf('orphan')).toBe(2)
  })

  it('rootSceneId 缺失 / 不存在 → 全部 scenes 的写入序', () => {
    const scenes = {
      a: makeScene('a'),
      b: makeScene('b'),
    }
    const sc = makeScenario(scenes, 'missing')
    expect(orderScenesForUpgrade(sc).sort()).toEqual(['a', 'b'])
  })

  it('自环不会死循环', () => {
    const scenes = {
      a: makeScene('a', [{ targetSceneId: 'a' }, { targetSceneId: 'b' }]),
      b: makeScene('b'),
    }
    const sc = makeScenario(scenes, 'a')
    expect(orderScenesForUpgrade(sc)).toEqual(['a', 'b'])
  })
})

describe('mergeTrioIntoScene', () => {
  function makeTrio(overrides: Partial<ActScenePromptTrio> = {}): ActScenePromptTrio {
    return {
      sceneId: 's1',
      image: '新 image，2.39:1',
      shots: [{ id: 's1-sh01', order: 0, framing: 'wide', prompt: '新 shot' } as Shot],
      video: '[0-3 秒] 新 video',
      warnings: [],
      ...overrides,
    }
  }

  it('image / video / shots 都会被写入；media.prompt 同步', () => {
    const scene = makeScene('s1')
    const trio = makeTrio()
    const next = mergeTrioIntoScene(scene, trio)

    expect(next.prompts?.scene).toBe('新 image，2.39:1')
    expect(next.prompts?.video).toBe('[0-3 秒] 新 video')
    expect(next.shots).toHaveLength(1)
    expect(next.media.prompt).toBe('新 image，2.39:1')
  })

  it('shots 为空 → 保留原 shots', () => {
    const scene = makeScene('s1', [], {
      shots: [{ id: 's1-sh-old', order: 0, framing: 'medium', prompt: 'old' } as Shot],
    })
    const trio = makeTrio({ shots: [] })
    const next = mergeTrioIntoScene(scene, trio)

    expect(next.shots).toHaveLength(1)
    expect(next.shots![0]!.prompt).toBe('old')
  })

  it('image / video 空字符串 → 保留原值', () => {
    const scene = makeScene('s1')
    const trio = makeTrio({ image: '', video: '' })
    const next = mergeTrioIntoScene(scene, trio)

    expect(next.prompts?.scene).toBe('原 prompt s1')
    expect(next.prompts?.video).toBe('原 video s1')
    expect(next.media.prompt).toBe('原 prompt s1')
  })

  it('不改写 dialogue / branches', () => {
    const scene = makeScene('s1', [{ targetSceneId: 's2' }])
    const trio = makeTrio()
    const next = mergeTrioIntoScene(scene, trio)
    expect(next.branches).toBe(scene.branches)
    expect(next.dialogue).toBe(scene.dialogue)
  })
})

describe('runActBatchUpgradeOnScenario', () => {
  function makeMockLLM(rawFn: (req: TextRequest) => string): TextClient {
    return {
      getProviderName: () => 'mock',
      getModel: () => 'mock',
      generate: vi.fn(async (req: TextRequest) => rawFn(req)),
    } as unknown as TextClient
  }

  function buildSuccessRaw(req: TextRequest): string {
    const ids = Array.from(req.userPrompt.matchAll(/· sceneId: (\S+)/g)).map((m) => m[1]!)
    return JSON.stringify({
      actId: 'sc01_super',
      scenes: ids.map((sid) => ({
        sceneId: sid,
        image: `image_${sid}，2.39:1`,
        storyboard: {
          shots: [
            {
              order: 0,
              framing: 'medium',
              durationSec: 5,
              bokehState: 'sharp',
              keyframeStrategy: 'single',
              prompt: `shot_${sid}`,
              audioHint: '...',
              transitionHint: '...',
            },
          ],
        },
        video: `[0-2] video_${sid}`,
      })),
    })
  }

  it('成功路径：所有 scene 升级；prompts.video 写入；shots 替换', async () => {
    const scenes = {
      a: makeScene('a', [{ targetSceneId: 'b' }]),
      b: makeScene('b'),
    }
    const sc = makeScenario(scenes, 'a')
    const llm = makeMockLLM(buildSuccessRaw)

    const result = await runActBatchUpgradeOnScenario(llm, sc)

    expect(result.upgradedSceneIds.sort()).toEqual(['a', 'b'])
    expect(result.failedSceneIds).toEqual([])
    expect(result.scenario.scenes.a!.prompts?.scene).toMatch(/image_a/)
    expect(result.scenario.scenes.b!.prompts?.video).toMatch(/video_b/)
    expect(result.scenario.scenes.a!.shots).toHaveLength(1)
    // 原 scenario 引用不能被就地修改
    expect(sc.scenes.a!.prompts?.scene).toBe('原 prompt a')
  })

  it('整批失败：scenario 保持原值，failedSceneIds 列出', async () => {
    const scenes = {
      a: makeScene('a', [{ targetSceneId: 'b' }]),
      b: makeScene('b'),
    }
    const sc = makeScenario(scenes, 'a')
    const llm = makeMockLLM(() => '不是 JSON')

    const result = await runActBatchUpgradeOnScenario(llm, sc)

    expect(result.upgradedSceneIds).toEqual([])
    expect(result.failedSceneIds.sort()).toEqual(['a', 'b'])
    expect(result.scenario.scenes.a!.prompts?.scene).toBe('原 prompt a')
    expect(result.scenario.scenes.b!.prompts?.scene).toBe('原 prompt b')
  })

  it('空 scenario：直接返回带 warning，不调 LLM', async () => {
    const sc = makeScenario({}, '')
    const llm = makeMockLLM(buildSuccessRaw)

    const result = await runActBatchUpgradeOnScenario(llm, sc)

    expect(result.upgradedSceneIds).toEqual([])
    expect(result.warnings.some((w) => w.includes('没有可升级'))).toBe(true)
    expect(llm.generate).not.toHaveBeenCalled()
  })
})
