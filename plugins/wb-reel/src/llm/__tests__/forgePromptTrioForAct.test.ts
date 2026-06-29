/**
 * forgePromptTrioForAct + actBatchPipeline 单测。
 *
 * 覆盖：
 *   1. buildBatchUserPrompt：是否把 Act 信息 / 角色锚点 / scenes[] 都拼入
 *   2. normalizeActTrioRaw：
 *      · 正常路径
 *      · sceneId 缺失 → 按位置对齐 + 警告
 *      · scenes 数量为 0 → 抛错
 *      · image / video 缺失 → 用占位兜底
 *      · storyboard.shots 为空 → 跳过 + 警告
 *   3. estimateSceneOutputTokens：分档与单调性
 *   4. planBatches：
 *      · 不跨 Act
 *      · 单批 ≤ maxScenesPerBatch
 *      · 单批 estimatedOutputTokens ≤ maxBatchOutputTokens
 *   5. forgePromptTrioForAct（mock LLM）：完整端到端 mock 路径
 *   6. runActBatchPipeline（mock LLM）：byScene 映射 + failure 隔离 + 并发不抛错
 */

import { describe, it, expect, vi } from 'vitest'

import {
  buildBatchUserPrompt,
  normalizeActTrioRaw,
  forgePromptTrioForAct,
  type ForgePromptTrioForActArgs,
} from '../forgePromptTrioForAct'

import {
  estimateSceneOutputTokens,
  planBatches,
  runActBatchPipeline,
  DEFAULT_MAX_SCENES_PER_BATCH,
  HARD_MAX_SCENES_PER_BATCH,
  type ActBatchPipelineArgs,
} from '../actBatchPipeline'

import type { Character, Scene } from '../../scenario/types'
import type { TextClient, TextRequest } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeChar(id: string, name: string, prompt = ''): Character {
  return { id, name, prompt }
}

function makeScene(id: string, durationMs = 45_000, characterIds: string[] = []): Scene {
  return {
    id,
    title: `场景 ${id}`,
    media: { kind: 'image', prompt: `占位提示词 ${id}` },
    durationMs,
    dialogue: [],
    branches: [],
    characterIds,
    prompts: { scene: `占位提示词 ${id}` },
  } as Scene
}

function makeArgs(scenes = 3): ForgePromptTrioForActArgs {
  return {
    actId: 'act_01',
    actTitle: '第一幕 · 启程',
    actBeat: '主角离家',
    characters: [makeChar('c1', '阿楠', '黑色风衣，左眉有疤')],
    scenes: Array.from({ length: scenes }, (_, i) => ({
      sceneId: `s_${i + 1}`,
      title: `开场场景 ${i + 1}`,
      beat: `主角第 ${i + 1} 次出场`,
      sceneDurationSec: 45,
    })),
  }
}

/** 给 mock LLM 用的合法 batch trio JSON。 */
function buildValidTrioRaw(args: ForgePromptTrioForActArgs): string {
  return JSON.stringify({
    actId: args.actId,
    scenes: args.scenes.map((sc) => ({
      sceneId: sc.sceneId,
      image: `单帧 ${sc.title} 的画面提示词，2.39:1 变形宽银幕，胶片颗粒。`,
      storyboard: {
        shots: [
          {
            order: 0,
            framing: 'wide',
            cameraHint: 'Slow Boom Up · 24mm',
            durationSec: 10,
            bokehState: 'sharp',
            keyframeStrategy: 'single',
            prompt: `${sc.title} · shot 1 画面提示词`,
            audioHint: '远处水滴声，金属共鸣',
            dialogueText: '',
            subtext: '',
            performance: '',
            transitionHint: '共享霓虹反光',
          },
          {
            order: 1,
            framing: 'medium',
            cameraHint: 'Pan Right · 35mm',
            durationSec: 5,
            bokehState: 'blurred',
            keyframeStrategy: 'single',
            prompt: `${sc.title} · shot 2 画面提示词`,
            audioHint: '脚步声渐近',
            dialogueText: '',
            subtext: '',
            performance: '',
            transitionHint: '切到下一 scene',
          },
        ],
      },
      video: `[0-3 秒] 镜头推进，${sc.title}，余波是水珠回落。\n[4-8 秒] 切到中景，余像滞后。`,
    })),
  })
}

function makeMockLLM(rawFn: (req: TextRequest) => string): TextClient {
  return {
    getProviderName: () => 'mock-anthropic',
    getModel: () => 'mock-opus',
    generate: vi.fn(async (req: TextRequest) => rawFn(req)),
  } as unknown as TextClient
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. buildBatchUserPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe('buildBatchUserPrompt', () => {
  it('包含 Act 信息、角色锚点、所有 scene 的 sceneId / title / beat / 时长', () => {
    const args = makeArgs(3)
    const out = buildBatchUserPrompt(args, '维伦纽瓦·史诗派')

    expect(out).toContain('维伦纽瓦·史诗派')
    expect(out).toContain('· actId: act_01')
    expect(out).toContain('· 标题: 第一幕 · 启程')
    expect(out).toContain('· beat: 主角离家')
    expect(out).toContain('阿楠')
    expect(out).toContain('黑色风衣，左眉有疤')

    for (const sc of args.scenes) {
      expect(out).toContain(`· sceneId: ${sc.sceneId}`)
      expect(out).toContain(sc.title)
      expect(out).toContain(`· sceneDurationSec: 45`)
    }

    // 末尾必须有"输出契约"提醒
    expect(out).toMatch(/JSON\.parse 直接通过/)
  })

  it('keyProps 与 dialogue / sceneText 都能拼入', () => {
    const args: ForgePromptTrioForActArgs = {
      ...makeArgs(1),
      keyProps: ['锈蚀火车票', '红色围巾'],
    }
    args.scenes[0]!.dialogue = [{ role: 'character', speaker: '阿楠', text: '走吧。' }]
    args.scenes[0]!.sceneText = '阿楠把围巾紧了紧，转身离去。'
    const out = buildBatchUserPrompt(args, 'X')

    expect(out).toContain('锈蚀火车票')
    expect(out).toContain('阿楠把围巾紧了紧')
    expect(out).toContain('[character/阿楠] 走吧。')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. normalizeActTrioRaw
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeActTrioRaw', () => {
  it('正常路径：sceneId 一一对应，shots 经过归一化', () => {
    const args = makeArgs(2)
    const parsed = JSON.parse(buildValidTrioRaw(args))
    const result = normalizeActTrioRaw(parsed, args)

    expect(result.actId).toBe('act_01')
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0]!.sceneId).toBe('s_1')
    expect(result.scenes[0]!.shots.length).toBeGreaterThanOrEqual(2)
    expect(result.scenes[0]!.image).toContain('2.39:1')
    expect(result.scenes[0]!.video).toMatch(/\[0-3 秒\]/)
  })

  it('scenes 为空 → 抛错（调用方应回退老路径）', () => {
    const args = makeArgs(1)
    expect(() =>
      normalizeActTrioRaw({ actId: args.actId, scenes: [] }, args),
    ).toThrowError(/BATCH-TRIO-EMPTY/)
  })

  it('LLM 返回的 sceneId 缺失 → 按位置对齐并产出 warning', () => {
    const args = makeArgs(2)
    const raw = JSON.parse(buildValidTrioRaw(args))
    delete (raw.scenes[1] as Record<string, unknown>).sceneId
    const result = normalizeActTrioRaw(raw, args)

    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[1]!.sceneId).toBe('s_2')
    expect(result.warnings.some((w) => w.includes('s_2') && w.includes('按位置对齐'))).toBe(true)
  })

  it('image / video 缺失 → 占位兜底 + warning', () => {
    const args = makeArgs(1)
    const raw = JSON.parse(buildValidTrioRaw(args))
    raw.scenes[0].image = ''
    raw.scenes[0].video = ''
    const result = normalizeActTrioRaw(raw, args)

    expect(result.scenes[0]!.image).toMatch(/占位画面/)
    expect(result.scenes[0]!.video).toBe('')
    expect(result.scenes[0]!.warnings.some((w) => w.includes('image 缺失'))).toBe(true)
    expect(result.scenes[0]!.warnings.some((w) => w.includes('video 缺失'))).toBe(true)
  })

  it('storyboard.shots 为空 → 跳过镜头归一化 + warning', () => {
    const args = makeArgs(1)
    const raw = JSON.parse(buildValidTrioRaw(args))
    raw.scenes[0].storyboard = { shots: [] }
    const result = normalizeActTrioRaw(raw, args)

    expect(result.scenes[0]!.shots).toHaveLength(0)
    expect(result.scenes[0]!.warnings.some((w) => w.includes('storyboard.shots 为空'))).toBe(true)
  })

  it('LLM 返回的 actId 与输入不一致 → Act 级 warning（不阻塞）', () => {
    const args = makeArgs(1)
    const raw = JSON.parse(buildValidTrioRaw(args))
    raw.actId = 'wrong_act'
    const result = normalizeActTrioRaw(raw, args)

    expect(result.actId).toBe('act_01')
    expect(result.warnings.some((w) => w.includes('actId 不匹配'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2.5 normalizeActTrioRaw · P2.5 增强（时长守恒 / 镜数配额 / 放开档位 / 连续组 + 原文）
// ─────────────────────────────────────────────────────────────────────────────

/** 用自定义 shots 列表构造单 scene 的 batch trio JSON（sceneDurationSec 可调）。 */
function rawWithShots(
  sceneId: string,
  shots: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    actId: 'act_01',
    scenes: [
      {
        sceneId,
        image: `单帧画面提示词，2.39:1 变形宽银幕，胶片颗粒。`,
        storyboard: { shots },
        video: `[0-3 秒] 镜头推进。\n[4-8 秒] 切到中景。`,
      },
    ],
  }
}

function oneSceneArgs(sceneDurationSec: number): ForgePromptTrioForActArgs {
  const args = makeArgs(1)
  args.scenes[0]!.sceneId = 'sd1'
  args.scenes[0]!.sceneDurationSec = sceneDurationSec
  return args
}

describe('normalizeActTrioRaw · P2.5 守恒/配额校验', () => {
  it('时长守恒偏差 > 10s → scene warning（不阻塞）', () => {
    // 目标 45s，但两镜只有 5+5=10s → 偏差 35s
    const args = oneSceneArgs(45)
    const raw = rawWithShots('sd1', [
      { order: 0, framing: 'wide', durationSec: 5, prompt: 'p1' },
      { order: 1, framing: 'medium', durationSec: 5, prompt: 'p2' },
    ])
    const result = normalizeActTrioRaw(raw, args)
    expect(result.scenes[0]!.warnings.some((w) => w.includes('时长守恒偏差'))).toBe(true)
  })

  it('镜数配额偏离（quota≈10 实出 2）→ scene warning（不阻塞）', () => {
    const args = oneSceneArgs(120) // computeShotQuota(120)=⌈120/13⌉=10；实出 2 < ⌈10/2⌉=5
    const raw = rawWithShots('sd1', [
      { order: 0, framing: 'wide', durationSec: 15, prompt: 'p1' },
      { order: 1, framing: 'medium', durationSec: 15, prompt: 'p2' },
    ])
    const result = normalizeActTrioRaw(raw, args)
    expect(result.scenes[0]!.warnings.some((w) => w.includes('镜数配额偏离'))).toBe(true)
  })

  it('时长守恒 + 镜数都合理 → 不产出这两类 warning', () => {
    // 目标 20s（quota=3）；3 镜 7+7+6=20s
    const args = oneSceneArgs(20)
    const raw = rawWithShots('sd1', [
      { order: 0, framing: 'wide', durationSec: 7, prompt: 'p1' },
      { order: 1, framing: 'medium', durationSec: 7, prompt: 'p2' },
      { order: 2, framing: 'close', durationSec: 6, prompt: 'p3' },
    ])
    const result = normalizeActTrioRaw(raw, args)
    const w = result.scenes[0]!.warnings.join('\n')
    expect(w).not.toContain('时长守恒偏差')
    expect(w).not.toContain('镜数配额偏离')
  })

  it('单镜时长吸附到 Seedance 上限 15s（>15 的长镜被夹到 15，避免模型崩）', () => {
    const args = oneSceneArgs(60)
    const raw = rawWithShots('sd1', [
      { order: 0, framing: 'wide', durationSec: 30, prompt: 'p1' },
    ])
    const result = normalizeActTrioRaw(raw, args)
    expect(result.scenes[0]!.shots[0]!.durationSec).toBe(15)
  })

  it('continuityGroupId / sourceTextSpan 进契约：归一化后保留', () => {
    const args = oneSceneArgs(20)
    const raw = rawWithShots('sd1', [
      {
        order: 0,
        framing: 'wide',
        durationSec: 10,
        prompt: 'p1',
        continuityGroupId: 'grp-sd1-1',
        sourceTextSpan: '他推开门，灯光泼了一地。',
      },
    ])
    const result = normalizeActTrioRaw(raw, args)
    expect(result.scenes[0]!.shots[0]!.continuityGroupId).toBe('grp-sd1-1')
    expect(result.scenes[0]!.shots[0]!.sourceTextSpan).toBe('他推开门，灯光泼了一地。')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. forgePromptTrioForAct (mock LLM)
// ─────────────────────────────────────────────────────────────────────────────

describe('forgePromptTrioForAct', () => {
  it('mock LLM 端到端：返回 normalize 后的 trio', async () => {
    const args = makeArgs(2)
    const llm = makeMockLLM(() => buildValidTrioRaw(args))

    const result = await forgePromptTrioForAct(llm, args)

    expect(result.actId).toBe('act_01')
    expect(result.scenes).toHaveLength(2)
    expect(result.scenes[0]!.shots.length).toBeGreaterThanOrEqual(2)
    expect(llm.generate).toHaveBeenCalledTimes(1)

    const reqArg = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as TextRequest
    // serializePersonaToPrompt 注入的 persona 段必须出现（用 "# 导演流派：" 作为唯一 marker —
    // skill 文档里再怎么改写也不会出现这串前缀）
    expect(reqArg.systemPrompt).toMatch(/# 导演流派：/)
    expect(reqArg.systemPrompt).toContain('Batch Prompt Trio')
    expect(reqArg.userPrompt).toContain('· actId: act_01')
    expect(reqArg.jsonMode).toBe(true)
  })

  it('LLM 返回非 JSON → 抛错（调用方应 fallback）', async () => {
    const args = makeArgs(1)
    const llm = makeMockLLM(() => '这不是 JSON，模型瞎写了一段话')

    await expect(forgePromptTrioForAct(llm, args)).rejects.toThrowError(/BATCH-TRIO/)
  })

  it('scenes 为空 → 直接返回空结果，不调 LLM', async () => {
    const args: ForgePromptTrioForActArgs = { ...makeArgs(0), scenes: [] }
    const llm = makeMockLLM(() => '')

    const result = await forgePromptTrioForAct(llm, args)
    expect(result.scenes).toHaveLength(0)
    expect(llm.generate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. estimateSceneOutputTokens
// ─────────────────────────────────────────────────────────────────────────────

describe('estimateSceneOutputTokens', () => {
  it('随 sceneDurationSec 单调不减', () => {
    const samples = [10, 20, 40, 60, 90, 120]
    const tokens = samples.map((s) => estimateSceneOutputTokens(s))
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]!).toBeGreaterThanOrEqual(tokens[i - 1]!)
    }
  })

  it('上下界裁剪：极小/极大值会被 clamp', () => {
    const a = estimateSceneOutputTokens(2)
    const b = estimateSceneOutputTokens(10)
    const c = estimateSceneOutputTokens(9999)
    const d = estimateSceneOutputTokens(180)
    expect(a).toBe(b) // 都被 clamp 到 ≥10
    expect(c).toBe(d) // 都被 clamp 到 ≤180
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. planBatches
// ─────────────────────────────────────────────────────────────────────────────

describe('planBatches', () => {
  function buildArgs(actScenes: number[][]): ActBatchPipelineArgs {
    const scenesById: Record<string, Scene> = {}
    const acts = actScenes.map((sceneCount, i) => {
      const actId = `act_${i + 1}`
      const sceneIds = Array.from({ length: sceneCount.length }, (_, j) => {
        const sid = `${actId}_s${j + 1}`
        scenesById[sid] = makeScene(sid, sceneCount[j]! * 1000)
        return sid
      })
      return { actId, actTitle: `Act ${i + 1}`, sceneIds }
    })
    return {
      scenesById,
      charactersById: {},
      acts,
    }
  }

  it('不跨 Act：每个 Act 至少切出一个 batch', () => {
    const args = buildArgs([[45, 45], [45, 45, 45]])
    const batches = planBatches(args)
    expect(batches.filter((b) => b.actId === 'act_1')).toHaveLength(1)
    expect(batches.filter((b) => b.actId === 'act_2')).toHaveLength(1)
  })

  it('超过 maxScenesPerBatch → 拆多批，subBatchIndex 递增', () => {
    // 默认 max=6；放 14 个 scene 的 act 应拆成 ⌈14/6⌉=3 批
    const args = buildArgs([new Array(14).fill(45)])
    const batches = planBatches(args)
    expect(batches).toHaveLength(3)
    expect(batches[0]!.subBatchIndex).toBe(0)
    expect(batches[1]!.subBatchIndex).toBe(1)
    expect(batches[2]!.subBatchIndex).toBe(2)
    expect(batches[0]!.sceneIds.length).toBeLessThanOrEqual(DEFAULT_MAX_SCENES_PER_BATCH)
    expect(batches[2]!.sceneIds.length).toBeGreaterThan(0)
  })

  it('硬上限是 HARD_MAX_SCENES_PER_BATCH=8（即使作者把 max 设很高）', () => {
    const args = buildArgs([new Array(20).fill(30)])
    args.maxScenesPerBatch = 100 // 故意设很大
    const batches = planBatches(args)
    for (const b of batches) {
      expect(b.sceneIds.length).toBeLessThanOrEqual(HARD_MAX_SCENES_PER_BATCH)
    }
  })

  it('token 预算：超过 maxBatchOutputTokens 会提前 flush', () => {
    // 把每场设为 90s（输出 token 估算 ~3500*1.5 ≈ 较高）
    const args = buildArgs([new Array(8).fill(90)])
    args.maxBatchOutputTokens = 12000 // 故意设小，逼迫多批
    const batches = planBatches(args)
    expect(batches.length).toBeGreaterThan(1)
    for (const b of batches) {
      // 单批估算 ≤ 上限 + 单 scene 字数（最后一条进入时不会再减）
      expect(b.estimatedOutputTokens).toBeLessThanOrEqual(args.maxBatchOutputTokens + 7000)
    }
  })

  it('空 Act 直接跳过', () => {
    const args = buildArgs([[], [45]])
    const batches = planBatches(args)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.actId).toBe('act_2')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. runActBatchPipeline (mock LLM)
// ─────────────────────────────────────────────────────────────────────────────

describe('runActBatchPipeline', () => {
  it('成功路径：byScene 全部填齐', async () => {
    const scenesById: Record<string, Scene> = {
      a1_s1: makeScene('a1_s1', 30_000, ['c1']),
      a1_s2: makeScene('a1_s2', 45_000, ['c1']),
    }
    const charactersById: Record<string, Character> = {
      c1: makeChar('c1', '阿楠'),
    }

    const llm = makeMockLLM((req) => {
      // 解析 user prompt 里的 sceneId 顺序，回一个匹配的 trio
      const ids = Array.from(req.userPrompt.matchAll(/· sceneId: (\S+)/g)).map((m) => m[1]!)
      return JSON.stringify({
        actId: 'act_1',
        scenes: ids.map((sid) => ({
          sceneId: sid,
          image: `image for ${sid}，2.39:1 变形宽银幕`,
          storyboard: {
            shots: [
              {
                order: 0,
                framing: 'medium',
                durationSec: 5,
                bokehState: 'sharp',
                keyframeStrategy: 'single',
                prompt: `shot for ${sid}`,
                audioHint: '...',
                transitionHint: '...',
              },
            ],
          },
          video: `[0-2 秒] video for ${sid}`,
        })),
      })
    })

    const result = await runActBatchPipeline(llm, {
      scenesById,
      charactersById,
      acts: [{ actId: 'act_1', actTitle: 'A1', sceneIds: ['a1_s1', 'a1_s2'] }],
    })

    expect(Object.keys(result.byScene).sort()).toEqual(['a1_s1', 'a1_s2'])
    expect(result.failures).toHaveLength(0)
    expect(result.byScene.a1_s1!.image).toContain('image for a1_s1')
    expect(result.byScene.a1_s2!.shots).toHaveLength(1)
  })

  it('部分批次失败 → failures 记录，不影响其他批次的 byScene', async () => {
    // 两个 Act：第一个 act 的 LLM 返回非 JSON → 整批失败；第二个 act 正常
    const scenesById: Record<string, Scene> = {
      bad_s1: makeScene('bad_s1'),
      good_s1: makeScene('good_s1'),
    }
    const llm = makeMockLLM((req) => {
      if (req.userPrompt.includes('actId: bad_act')) {
        return '不是 JSON，故意让本批失败'
      }
      const ids = Array.from(req.userPrompt.matchAll(/· sceneId: (\S+)/g)).map((m) => m[1]!)
      return JSON.stringify({
        actId: 'good_act',
        scenes: ids.map((sid) => ({
          sceneId: sid,
          image: `image for ${sid}，2.39:1`,
          storyboard: {
            shots: [
              {
                order: 0,
                framing: 'medium',
                durationSec: 5,
                bokehState: 'sharp',
                keyframeStrategy: 'single',
                prompt: 'p',
                audioHint: '...',
                transitionHint: '...',
              },
            ],
          },
          video: '[0-2 秒] v',
        })),
      })
    })

    const failBatches: string[] = []
    const result = await runActBatchPipeline(llm, {
      scenesById,
      charactersById: {},
      acts: [
        { actId: 'bad_act', actTitle: 'BAD', sceneIds: ['bad_s1'] },
        { actId: 'good_act', actTitle: 'GOOD', sceneIds: ['good_s1'] },
      ],
      onBatchFail: (b) => failBatches.push(b.actId),
    })

    expect(result.failures).toHaveLength(1)
    expect(failBatches).toEqual(['bad_act'])
    expect(result.byScene.good_s1).toBeDefined()
    expect(result.byScene.bad_s1).toBeUndefined()
  })
})
