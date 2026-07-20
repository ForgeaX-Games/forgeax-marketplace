import { describe, it, expect } from 'vitest'
import {
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
  migrateV10ToV11,
  migrateScenarioToLatest,
  ensureSceneHasShots,
} from '../schemaMigrate'
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
  it('v1 → v10（链式迁移到最新版本）', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.schemaVersion).toBe(11)
  })
  it('v1 迁到最新后有空 uiAssets / hud 容器', () => {
    const out = migrateScenarioToLatest(mkV1())
    expect(out.uiAssets).toEqual({})
    expect(out.hud).toEqual([])
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

  it('版本号升到 9 并补齐空 uiAssets / hud', () => {
    const out = migrateV8ToV9(mkV8())
    expect(out.schemaVersion).toBe(9)
    expect(out.uiAssets).toEqual({})
    expect(out.hud).toEqual([])
  })

  it('已有 uiAssets / hud 时保留', () => {
    const v8: Scenario = {
      ...mkV8(),
      uiAssets: {
        ui1: {
          id: 'ui1',
          name: '主角血条',
          role: 'hp-bar',
          matte: 'screen-black',
          blendMode: 'screen',
          lifecycle: 'hud',
        },
      },
      hud: [{ id: 'h1', uiAssetId: 'ui1', anchor: { x: 0.2, y: 0.1 } }],
    }
    const out = migrateV8ToV9(v8)
    expect(out.uiAssets?.ui1?.name).toBe('主角血条')
    expect(out.hud?.[0]?.uiAssetId).toBe('ui1')
  })

  it('已经是 v9 时幂等返回（引用相等）', () => {
    const v9: Scenario = { ...mkV8(), schemaVersion: 9, uiAssets: {}, hud: [] }
    expect(migrateV8ToV9(v9)).toBe(v9)
  })
})

describe('migrateV9ToV10', () => {
  function mkV9(): Scenario {
    return { ...mkV1(), schemaVersion: 9, uiAssets: {}, hud: [] }
  }

  it('版本号升到 10（treeTheme 可选,迁移不写,保持内置外观）', () => {
    const out = migrateV9ToV10(mkV9())
    expect(out.schemaVersion).toBe(10)
    expect(out.treeTheme).toBeUndefined()
  })

  it('已有 treeTheme 时保留', () => {
    const v9: Scenario = {
      ...mkV9(),
      treeTheme: { preset: 'chinese', jumpScope: 'visited' },
    }
    const out = migrateV9ToV10(v9)
    expect(out.treeTheme?.preset).toBe('chinese')
    expect(out.treeTheme?.jumpScope).toBe('visited')
  })

  it('已经是 v10 时幂等返回（引用相等）', () => {
    const v10: Scenario = { ...mkV9(), schemaVersion: 10 }
    expect(migrateV9ToV10(v10)).toBe(v10)
  })
})

describe('migrateV10ToV11', () => {
  function mkV10(): Scenario {
    return { ...mkV1(), schemaVersion: 10, uiAssets: {}, hud: [] }
  }

  it('版本号升到 11 并建空 uiScreens（无全屏页面,向后兼容）', () => {
    const out = migrateV10ToV11(mkV10())
    expect(out.schemaVersion).toBe(11)
    expect(out.uiScreens).toEqual({})
  })

  it('已有 uiScreens 时保留', () => {
    const v10: Scenario = {
      ...mkV10(),
      uiScreens: {
        bag: { id: 'bag', name: '背包', kind: 'inventory' },
      },
    }
    const out = migrateV10ToV11(v10)
    expect(out.uiScreens?.bag?.kind).toBe('inventory')
  })

  it('已经是 v11 时幂等返回（引用相等）', () => {
    const v11: Scenario = { ...mkV10(), schemaVersion: 11, uiScreens: {} }
    expect(migrateV10ToV11(v11)).toBe(v11)
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

describe('normalizeDirectorStyle（旧导演 id → 原创 slug，版权安全重命名）', () => {
  it('旧真名 id 归一到新 slug（不丢用户已选风格）', () => {
    const s = { ...mkV1(), directorStyle: 'wong-karwai' } as unknown as Scenario
    const out = migrateScenarioToLatest(s)
    expect(out.directorStyle).toBe('mood-neon')
  })

  it('已是新 slug → 原样保留（幂等）', () => {
    const s = { ...mkV1(), directorStyle: 'minimal-epic' } as unknown as Scenario
    const out = migrateScenarioToLatest(s)
    expect(out.directorStyle).toBe('minimal-epic')
  })

  it('cyberpunk-neonoir / custom / 未设置 → 不动', () => {
    const cyber = migrateScenarioToLatest({
      ...mkV1(),
      directorStyle: 'cyberpunk-neonoir',
    } as unknown as Scenario)
    expect(cyber.directorStyle).toBe('cyberpunk-neonoir')
    const none = migrateScenarioToLatest(mkV1())
    expect(none.directorStyle).toBeUndefined()
  })
})
