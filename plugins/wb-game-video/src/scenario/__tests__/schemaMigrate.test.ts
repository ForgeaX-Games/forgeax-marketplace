import { describe, it, expect } from 'vitest'
import {
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV10ToV11,
  migrateV12ToV13,
  migrateScenarioToLatest,
  ensureSceneHasShots,
  normalizeSceneArrays,
  normalizeUiHud,
  normalizeSceneQte,
} from '../schemaMigrate'
import { coerceHudRules } from '../gameplayTypes'
import type { Scenario, Scene } from '../types'

function mkV1(): Scenario {
  return {
    id: 'sc1',
    title: '测试',
    rootSceneId: 's1',
    scenes: {
      s1: {
        id: 's1',
        title: '开场',
        media: { kind: 'IMAGE_PROMPT', prompt: 'dark alley' },
        durationMs: 4000,
        dialogue: [],
        branches: [],
      },
    },
    defaultCharMs: 60,
    schemaVersion: 1,
    characters: {
      c1: { id: 'c1', name: '主角', prompt: 'teen girl', refImageId: 'img-old' },
    },
  }
}

describe('migrateV1ToV2', () => {
  it('版本号升到 2', () => {
    const out = migrateV1ToV2(mkV1())
    expect(out.schemaVersion).toBe(2)
  })

  it('补齐 locations 为空字典', () => {
    const out = migrateV1ToV2(mkV1())
    expect(out.locations).toEqual({})
  })

  it('保留 Character.refImageId（向前兼容）', () => {
    const out = migrateV1ToV2(mkV1())
    expect(out.characters?.c1?.refImageId).toBe('img-old')
    expect(out.characters?.c1?.turnaroundRefImageId).toBeUndefined()
  })

  it('已经是 v2 时幂等返回（引用相等）', () => {
    const v2: Scenario = { ...mkV1(), schemaVersion: 2, locations: {} }
    const out = migrateV1ToV2(v2)
    expect(out).toBe(v2)
  })

  it('不修改原 scenes/characters（浅拷贝顶层）', () => {
    const v1 = mkV1()
    const originalScenesRef = v1.scenes
    const out = migrateV1ToV2(v1)
    expect(out.scenes).toBe(originalScenesRef)
  })

  it('已有 locations 字段则保留', () => {
    const v1 = mkV1() as Scenario
    const withLoc: Scenario = {
      ...v1,
      locations: { l1: { id: 'l1', name: '厨房', prompt: 'cozy kitchen' } },
    }
    const out = migrateV1ToV2(withLoc)
    expect(out.locations?.l1?.name).toBe('厨房')
  })
})

describe('migrateScenarioToLatest', () => {
  it('v1 → v13（链式迁移到最新版本）', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.schemaVersion).toBe(13)
  })
  it('v1 迁到最新后有空 items 容器', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.items).toBeDefined()
    expect(out.items).toEqual({})
  })
  it('最新版幂等', () => {
    const v1 = mkV1()
    const latest = migrateScenarioToLatest(v1)
    expect(migrateScenarioToLatest(latest)).toBe(latest)
  })
  it('v1 迁到最新后有空 variables 容器', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.variables).toBeDefined()
  })
  it('v1 迁到 v5 后每个 scene 都有 shots 兜底', () => {
    const out = migrateScenarioToLatest(mkV1())
    const s1 = out.scenes.s1!
    expect(s1.shots).toBeDefined()
    expect(s1.shots?.length).toBe(1)
    expect(s1.shots?.[0]?.framing).toBe('medium')
    expect(s1.keyShotId).toBe('sh_01')
  })
  it('v1 迁到 v5 后每个 scene 都有 episodeId', () => {
    const out = migrateScenarioToLatest(mkV1())
    const s1 = out.scenes.s1!
    expect(s1.episodeId).toBe('ep-default')
  })
  it('v1 迁到 v5 后有默认集 ep-default', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.episodes).toBeDefined()
    expect(out.episodes?.length).toBe(1)
    expect(out.episodes?.[0]?.id).toBe('ep-default')
    expect(out.episodes?.[0]?.title).toBe('第一集')
  })
  it('v1 迁到 v5 后 outline / characterRelations 兜底为空数组', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.outline).toEqual([])
    expect(out.characterRelations).toEqual([])
  })
})

describe('migrateV2ToV3', () => {
  function mkV2(): Scenario {
    return { ...mkV1(), schemaVersion: 2, locations: {} }
  }

  it('版本号升到 3', () => {
    const out = migrateV2ToV3(mkV2())
    expect(out.schemaVersion).toBe(3)
  })

  it('为每个 scene 注入单镜兜底', () => {
    const out = migrateV2ToV3(mkV2())
    const s1 = out.scenes.s1!
    expect(s1.shots?.[0]).toMatchObject({
      id: 'sh_01',
      order: 0,
      framing: 'medium',
    })
    expect(s1.keyShotId).toBe('sh_01')
  })

  it('兜底镜头的 prompt 回退到 scene.media.prompt', () => {
    const out = migrateV2ToV3(mkV2())
    expect(out.scenes.s1!.shots?.[0]?.prompt).toBe('dark alley')
  })

  it('已经是 v3 时幂等返回（引用相等）', () => {
    const v3: Scenario = { ...mkV2(), schemaVersion: 3 }
    // v3 数据经 migrateV2ToV3 应直接返回（不走 v3→v4 的部分）
    expect(migrateV2ToV3(v3)).toBe(v3)
  })

  it('v2 的 dialogue 原样保留，不会变成 background', () => {
    const v2 = mkV2()
    const baseScene = v2.scenes.s1!
    const sceneWithNarration: Scene = {
      ...baseScene,
      dialogue: [
        {
          id: 'd1',
          role: 'narration',
          text: '雨夜，他站在门口',
          startMs: 0,
          endMs: 2000,
        },
      ],
    }
    const input: Scenario = {
      ...v2,
      scenes: { s1: sceneWithNarration },
    }
    const out = migrateV2ToV3(input)
    expect(out.scenes.s1!.dialogue.length).toBe(1)
    expect(out.scenes.s1!.background).toBeUndefined()
  })

  it('已有非空 shots 保留原样，并补 keyShotId', () => {
    const v2 = mkV2()
    const baseScene = v2.scenes.s1!
    const sceneWithShots: Scene = {
      ...baseScene,
      shots: [
        { id: 'custom', order: 0, framing: 'close', prompt: 'p1' },
        { id: 'custom2', order: 1, framing: 'wide', prompt: 'p2' },
      ],
    }
    const input: Scenario = { ...v2, scenes: { s1: sceneWithShots } }
    const out = migrateV2ToV3(input)
    expect(out.scenes.s1!.shots?.length).toBe(2)
    expect(out.scenes.s1!.shots?.[0]?.id).toBe('custom')
    expect(out.scenes.s1!.keyShotId).toBe('custom')
  })
})

describe('migrateV6ToV7', () => {
  function mkV6(): Scenario {
    return { ...mkV1(), schemaVersion: 6, variables: {} }
  }

  it('版本号升到 7 并补齐空 items', () => {
    const out = migrateV6ToV7(mkV6())
    expect(out.schemaVersion).toBe(7)
    expect(out.items).toEqual({})
  })

  it('已有 items 时保留', () => {
    const v6: Scenario = {
      ...mkV6(),
      items: { it1: { id: 'it1', name: '钥匙' } },
    }
    const out = migrateV6ToV7(v6)
    expect(out.items?.it1?.name).toBe('钥匙')
  })

  it('已经是 v7 时幂等返回（引用相等）', () => {
    const v7: Scenario = { ...mkV6(), schemaVersion: 7, items: {} }
    expect(migrateV6ToV7(v7)).toBe(v7)
  })
})

describe('migrateV7ToV8', () => {
  function mkV7(): Scenario {
    return { ...mkV1(), schemaVersion: 7, items: {} }
  }

  it('版本号升到 8（后期效果字段可选，无需转换）', () => {
    const out = migrateV7ToV8(mkV7())
    expect(out.schemaVersion).toBe(8)
  })

  it('已经是 v8 时幂等返回（引用相等）', () => {
    const v8: Scenario = { ...mkV7(), schemaVersion: 8 }
    expect(migrateV7ToV8(v8)).toBe(v8)
  })
})

describe('migrateV8ToV9', () => {
  function mkV8(): Scenario {
    return { ...mkV1(), schemaVersion: 8, items: {} }
  }

  it('版本号升到 9（玩法字段可选，无需转换）', () => {
    const out = migrateV8ToV9(mkV8())
    expect(out.schemaVersion).toBe(9)
  })

  it('已经是 v9 时幂等返回（引用相等）', () => {
    const v9: Scenario = { ...mkV8(), schemaVersion: 9 }
    expect(migrateV8ToV9(v9)).toBe(v9)
  })

  it('不丢已有的玩法字段（entities/ui 原样保留）', () => {
    const v8: Scenario = {
      ...mkV8(),
      entities: { e1: { id: 'e1', name: '主角', kind: 'player', maxHp: 100 } },
      ui: { accentColor: '#ff0066' },
    }
    const out = migrateV8ToV9(v8)
    expect(out.entities?.e1?.maxHp).toBe(100)
    expect(out.ui?.accentColor).toBe('#ff0066')
  })

  it('低版本经链式迁移自动到 v13 且玩法字段缺省不报错', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.schemaVersion).toBe(13)
    expect(out.entities).toBeUndefined()
    expect(out.ui).toBeUndefined()
  })
})

describe('migrateV10ToV11（交互形态 presence 化）', () => {
  function mkV10WithScene(sceneExtra: Record<string, unknown>): Scenario {
    return {
      ...mkV1(),
      schemaVersion: 10,
      scenes: {
        s1: {
          id: 's1',
          title: '场景',
          media: { kind: 'PLACEHOLDER', meta: {} },
          durationMs: 4000,
          dialogue: [],
          branches: [],
          ...sceneExtra,
        } as unknown as Scene,
      },
    }
  }

  it('kind:choice 但无 decision、只有 auto 分支 → 不当作 choice（还原为普通 perf，不崩溃）', () => {
    // 复现历史脏数据（nodiaBlueprintDemo 的 enter 节点）：光有 kind:'choice' 标签，
    // 实为自动转场节点。旧实现会 migrateChoice(undefined) 读 optType 崩溃。
    const out = migrateV10ToV11(
      mkV10WithScene({
        kind: 'choice',
        branches: [{ id: 'b-auto', kind: 'auto', targetSceneId: 't', label: 'Out' }],
      }),
    )
    const s1 = out.scenes.s1 as unknown as Record<string, unknown>
    expect(s1.choice).toBeUndefined()
    expect(s1.kind).toBeUndefined()
  })

  it('kind:choice + decision → 生成 choice 字段', () => {
    const out = migrateV10ToV11(
      mkV10WithScene({
        kind: 'choice',
        decision: { optType: 'timed', prompt: '选一个', timeoutMs: 8000 },
        branches: [{ id: 'b1', kind: 'choice', targetSceneId: 't1', label: '甲' }],
      }),
    )
    const s1 = out.scenes.s1 as unknown as Record<string, unknown>
    const choice = s1.choice as Record<string, unknown> | undefined
    expect(choice).toBeDefined()
    expect(choice?.timed).toBe(true)
    expect(choice?.prompt).toBe('选一个')
  })

  it('无 decision 但有 choice 分支 → 仍当作 choice（choice 字段存在且为空壳）', () => {
    const out = migrateV10ToV11(
      mkV10WithScene({
        kind: 'choice',
        branches: [{ id: 'b1', kind: 'choice', targetSceneId: 't1', label: '甲' }],
      }),
    )
    const s1 = out.scenes.s1 as unknown as Record<string, unknown>
    expect(s1.choice).toBeDefined()
  })
})

describe('migrateV12ToV13（统一飘字 OverlayClip）', () => {
  function mkV12WithScene(sceneExtra: Record<string, unknown>): Scenario {
    return {
      ...mkV1(),
      schemaVersion: 12,
      scenes: {
        s1: {
          id: 's1',
          title: '开场',
          media: { kind: 'VIDEO', ref: 'm-1' },
          durationMs: 4000,
          dialogue: [],
          branches: [],
          ...sceneExtra,
        } as unknown as Scene,
      },
    }
  }

  it('版本号升到 13', () => {
    const out = migrateV12ToV13(mkV12WithScene({}))
    expect(out.schemaVersion).toBe(13)
  })

  it('已经是 v13 时幂等返回（引用相等）', () => {
    const v13: Scenario = { ...mkV12WithScene({}), schemaVersion: 13 }
    expect(migrateV12ToV13(v13)).toBe(v13)
  })

  it('textOverlays（花字）→ overlays kind=text，扁平样式收进 style，scale 折进 fontSizePct', () => {
    const out = migrateV12ToV13(
      mkV12WithScene({
        textOverlays: [
          {
            id: 'tx1',
            text: '标题',
            startMs: 500,
            endMs: 2000,
            x: 0.3,
            y: 0.2,
            scale: 2,
            rotation: 10,
            shadow: true,
            fontSizePct: 6,
            color: '#ff0000',
            fontWeight: 700,
          },
        ],
      }),
    )
    const ov = out.scenes.s1!.overlays?.[0]
    expect(ov?.kind).toBe('text')
    expect(ov?.content).toBe('标题')
    expect(ov?.x).toBe(0.3)
    expect(ov?.rotation).toBe(10)
    expect(ov?.style?.fontSizePct).toBe(12) // 6 * scale(2)
    expect(ov?.style?.color).toBe('#ff0000')
    expect(ov?.style?.shadow).toBe(true)
    // 旧扁平字段不再挂在 clip 顶层
    expect((ov as unknown as Record<string, unknown>).scale).toBeUndefined()
    expect((ov as unknown as Record<string, unknown>).fontSizePct).toBeUndefined()
  })

  it('stickerClips 各 kind 映射：numeric/emoji→text，builtin→icon，image→image', () => {
    const out = migrateV12ToV13(
      mkV12WithScene({
        stickerClips: [
          { id: 'n1', kind: 'numeric', text: '-100', startMs: 0, endMs: 900, x: 0.5, y: 0.4, sizePct: 10, color: '#f00' },
          { id: 'e1', kind: 'emoji', text: '🔥', startMs: 0, endMs: 900, x: 0.6, y: 0.5, sizePct: 8 },
          { id: 'b1', kind: 'builtin', presetId: 'arrow', startMs: 0, endMs: 900, x: 0.2, y: 0.2, sizePct: 12 },
          { id: 'i1', kind: 'image', mediaId: 'media-9', startMs: 0, endMs: 900, x: 0.8, y: 0.8, sizePct: 20 },
        ],
      }),
    )
    const byId = Object.fromEntries((out.scenes.s1!.overlays ?? []).map((o) => [o.id, o]))
    expect(byId.n1?.kind).toBe('text')
    expect(byId.n1?.content).toBe('-100')
    expect(byId.n1?.style?.fontSizePct).toBe(10)
    expect(byId.n1?.style?.color).toBe('#f00')
    expect(byId.e1?.kind).toBe('text')
    expect(byId.e1?.content).toBe('🔥')
    expect(byId.b1?.kind).toBe('icon')
    expect(byId.b1?.content).toBe('arrow')
    expect(byId.b1?.sizePct).toBe(12)
    expect(byId.i1?.kind).toBe('image')
    expect(byId.i1?.content).toBe('media-9')
  })

  it('performance.cues 按 id 配对已转出的 overlay 挂 settlement', () => {
    const out = migrateV12ToV13(
      mkV12WithScene({
        stickerClips: [{ id: 'shot1', kind: 'numeric', text: '-50', startMs: 1000, endMs: 1900, x: 0.5, y: 0.4 }],
        performance: {
          cues: [{ id: 'shot1', atMs: 1000, label: '命中', settlement: { effects: [{ id: 'e', kind: 'entityStat', entityId: 'b', stat: 'hp', op: 'add', value: -50 }] } }],
        },
      }),
    )
    const ov = out.scenes.s1!.overlays?.find((o) => o.id === 'shot1')
    expect(ov?.settlement?.effects?.length).toBe(1)
    expect(out.scenes.s1!.overlays?.length).toBe(1) // 未额外生成触发器
  })

  it('未配对 performance.cue → 不可见触发器（content=""，携带 settlement）', () => {
    const out = migrateV12ToV13(
      mkV12WithScene({
        performance: {
          cues: [{ id: 'logic1', atMs: 2000, label: '纯结算', settlement: { effects: [] } }],
        },
      }),
    )
    const ov = out.scenes.s1!.overlays?.[0]
    expect(ov?.content).toBe('')
    expect(ov?.startMs).toBe(2000)
    expect(ov?.label).toBe('纯结算')
    expect(ov?.settlement).toBeDefined()
  })

  it('删除旧字段 textOverlays / stickerClips / performance', () => {
    const out = migrateV12ToV13(
      mkV12WithScene({
        textOverlays: [{ id: 't', text: 'x', startMs: 0, x: 0.5, y: 0.5 }],
        stickerClips: [{ id: 's', kind: 'numeric', text: '1', startMs: 0, endMs: 1, x: 0.5, y: 0.5 }],
        performance: { cues: [] },
      }),
    )
    const raw = out.scenes.s1! as unknown as Record<string, unknown>
    expect(raw.textOverlays).toBeUndefined()
    expect(raw.stickerClips).toBeUndefined()
    expect(raw.performance).toBeUndefined()
  })
})

describe('ensureSceneHasShots', () => {
  const baseScene: Scene = {
    id: 's1',
    title: '开场',
    media: { kind: 'IMAGE_PROMPT', prompt: 'moody alley', ref: 'img-ref-1' },
    durationMs: 4000,
    dialogue: [],
    branches: [],
  }

  it('无 shots 时注入 sh_01 单镜，prompt 来自 media.prompt', () => {
    const out = ensureSceneHasShots(baseScene)
    expect(out.shots?.[0]?.prompt).toBe('moody alley')
    expect(out.shots?.[0]?.keyframeMediaRef).toBe('img-ref-1')
    expect(out.keyShotId).toBe('sh_01')
  })

  it('优先使用 prompts.scene', () => {
    const out = ensureSceneHasShots({
      ...baseScene,
      prompts: { scene: '更细致的 scene prompt' },
    })
    expect(out.shots?.[0]?.prompt).toBe('更细致的 scene prompt')
  })

  it('已有 shots 且 keyShotId 命中时幂等返回', () => {
    const withShots: Scene = {
      ...baseScene,
      shots: [{ id: 'sh_a', order: 0, framing: 'wide', prompt: 'x' }],
      keyShotId: 'sh_a',
    }
    expect(ensureSceneHasShots(withShots)).toBe(withShots)
  })

  it('已有 shots 但 keyShotId 指向不存在的 id 时，回退到 shots[0]', () => {
    const withShots: Scene = {
      ...baseScene,
      shots: [{ id: 'sh_a', order: 0, framing: 'wide', prompt: 'x' }],
      keyShotId: 'sh_ghost',
    }
    const out = ensureSceneHasShots(withShots)
    expect(out.keyShotId).toBe('sh_a')
  })
})

describe('normalizeSceneArrays', () => {
  function mkScenarioWithRawScenes(scenes: Record<string, unknown>): Scenario {
    return { ...mkV1(), scenes: scenes as Record<string, Scene> }
  }

  it('scene 缺 dialogue 时补空数组（修复 "sc.dialogue is not iterable" 崩溃）', () => {
    const scenario = mkScenarioWithRawScenes({
      s1: { id: 's1', title: '开场', media: { kind: 'IMAGE_PROMPT', prompt: '' }, durationMs: 4000, branches: [] },
    })
    const out = normalizeSceneArrays(scenario)
    expect(Array.isArray(out.scenes.s1.dialogue)).toBe(true)
    expect(out.scenes.s1.dialogue).toEqual([])
    expect(() => {
      for (const _ of out.scenes.s1.dialogue) void _
    }).not.toThrow()
  })

  it('scene 缺 branches 时补空数组', () => {
    const scenario = mkScenarioWithRawScenes({
      s1: { id: 's1', title: '开场', media: { kind: 'IMAGE_PROMPT', prompt: '' }, durationMs: 4000, dialogue: [] },
    })
    const out = normalizeSceneArrays(scenario)
    expect(Array.isArray(out.scenes.s1.branches)).toBe(true)
  })

  it('两个字段都齐时幂等返回（整份引用相等）', () => {
    const scenario = mkV1()
    expect(normalizeSceneArrays(scenario)).toBe(scenario)
  })

  it('链式迁移入口自动兜底缺字段的 scene', () => {
    const scenario = mkScenarioWithRawScenes({
      s1: { id: 's1', title: '开场', media: { kind: 'IMAGE_PROMPT', prompt: '' }, durationMs: 4000 },
    })
    const out = migrateScenarioToLatest(scenario)
    expect(out.scenes.s1.dialogue).toEqual([])
    expect(out.scenes.s1.branches).toEqual([])
  })
})

describe('coerceHudRules / normalizeUiHud', () => {
  it('数组形态原样保留有效规则', () => {
    const hud = [{ element: 'playerHp' as const, show: 'always' as const }]
    expect(coerceHudRules(hud)).toEqual(hud)
  })

  it('Record 形态转为 HudRule[]', () => {
    expect(
      coerceHudRules({ playerHp: 'always', bossHp: 'battle', junk: 'nope' }),
    ).toEqual([
      { element: 'playerHp', show: 'always' },
      { element: 'bossHp', show: 'battle' },
    ])
  })

  it('normalizeUiHud 修复非数组 hud 且 migrateScenarioToLatest 会调用', () => {
    const scenario = {
      ...mkV1(),
      schemaVersion: 9,
      ui: { hud: { playerHp: 'always' } },
    } as unknown as Scenario
    const out = normalizeUiHud(scenario)
    expect(out.ui?.hud).toEqual([{ element: 'playerHp', show: 'always' }])
    const migrated = migrateScenarioToLatest({
      ...mkV1(),
      schemaVersion: 9,
      ui: { hud: { score: 'qte' } },
    } as unknown as Scenario)
    expect(migrated.ui?.hud).toEqual([{ element: 'score', show: 'qte' }])
  })

  it('normalizeSceneQte 补齐缺 cues 的 qte 壳', () => {
    const scenario = {
      ...mkV1(),
      schemaVersion: 9,
      scenes: {
        s1: {
          ...mkV1().scenes.s1,
          qte: { timeoutMs: 3000, window: { perfect: 80, great: 160, good: 280 }, score: { perfect: 100, great: 60, good: 25, miss: -10 } },
        },
      },
    } as unknown as Scenario
    const out = normalizeSceneQte(scenario)
    expect(out.scenes.s1.qte?.cues).toEqual([])
  })
})
