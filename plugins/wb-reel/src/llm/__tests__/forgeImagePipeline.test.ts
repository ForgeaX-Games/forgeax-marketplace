import { describe, expect, it, vi } from 'vitest'
import {
  buildCharacterTurnaroundPrompt,
  buildCharacterHeadshotPrompt,
  buildCharacterFullbodyPrompt,
  isRealisticVisualStyle,
  buildLocationPrompt,
  buildLocationDerivedAnglePrompts,
  buildSceneKeyframePrompt,
  buildShotKeyframePrompt,
  pickPrimaryRef,
  pickPrimaryRefForShot,
  runForgeImagePipeline,
} from '../forgeImagePipeline'
import type { Character, Location, Scene, Scenario, Shot } from '../../scenario/types'
import type { ImageClient, ImageResult } from '../types'

/**
 * Forge 图像流水线测试 —— 三视图 / 场景图 / 关键帧的 prompt 模板和并发调度。
 *
 * 核心关注：
 *   - prompt 模板包含必要的约束词（三视图 / 空场 / 一致性）
 *   - 主 ref 选择：location > character > refImageId > undefined
 *   - 调度器会按顺序跑完三阶段（character → location → scene），不乱写回调
 */

function char(id: string, name: string, prompt: string, extras: Partial<Character> = {}): Character {
  return { id, name, prompt, ...extras }
}

function loc(id: string, name: string, prompt: string, extras: Partial<Location> = {}): Location {
  return { id, name, prompt, ...extras }
}

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: `Scene ${id}`,
    media: { kind: 'IMAGE_PROMPT', prompt: 'default prompt' },
    durationMs: 5000,
    dialogue: [],
    branches: [],
    ...overrides,
  }
}

function mkScenario(overrides: Partial<Scenario> = {}): Scenario {
  const s: Scenario = {
    id: 'sc-1',
    title: 'Test',
    rootSceneId: 's1',
    scenes: { s1: scene('s1') },
    defaultCharMs: 30,
    schemaVersion: 2,
    ...overrides,
  }
  return s
}

function mkImageResult(prompt: string): ImageResult {
  return {
    dataUrl: `data:image/png;base64,fake-${prompt.slice(0, 8)}`,
    mimeType: 'image/png',
    base64: 'fake',
    prompt,
    latencyMs: 1,
  }
}

function mkClient(): ImageClient {
  return {
    generate: vi.fn(async (req) => mkImageResult(req.prompt)),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'test',
    getProviderName: () => 'test',
  }
}

// ─── prompt 模板 ──────────────────────────────────────────────────

describe('buildCharacterTurnaroundPrompt', () => {
  it('多分格拼版：左上特写 + 左下两侧脸 + 右侧两全身', () => {
    const p = buildCharacterTurnaroundPrompt(char('c1', '林深', '穿白衬衫的少年'))
    // 多分格拼版
    expect(p).toMatch(/多分格|拼版|multi-panel|character sheet/i)
    // 左上大尺寸特写半身
    expect(p).toMatch(/特写|半身|close-up|bust|head-and-shoulders/i)
    // 侧脸 / 四分之三
    expect(p).toMatch(/侧脸|profile|四分之三|three-quarter/i)
    // 正面 + 背面全身
    expect(p).toMatch(/正面|front view/i)
    expect(p).toMatch(/背面|back view/i)
  })

  it('写塞角色名 + 外观气质', () => {
    const p = buildCharacterTurnaroundPrompt(char('c1', '林深', '穿白衬衫的少年'))
    expect(p).toMatch(/林深/)
    expect(p).toMatch(/白衬衫/)
  })

  it('prompt 为空时回退到兜底描述', () => {
    const p = buildCharacterTurnaroundPrompt(char('c1', '路人', ''))
    expect(p).toMatch(/普通现代人物|default/i)
  })

  // 作者定稿（2026-06）· 写实真人风格在生成期对每张可见脸的左半边五官打码。
  it('默认（写实）对每张脸左半边五官打码', () => {
    const p = buildCharacterTurnaroundPrompt(char('c1', '林深', '少年'))
    expect(p).toMatch(/马赛克|mosaic|像素化|pixelate/i)
    expect(p).toMatch(/左半|left half/i)
  })

  it('photoreal 同样走左半脸打码护栏', () => {
    const p = buildCharacterTurnaroundPrompt(char('c1', '林深', '少年'), {
      visualStyle: 'photoreal',
    })
    expect(p).toMatch(/马赛克|mosaic|像素化|pixelate/i)
    expect(p).toMatch(/左半|left half/i)
  })
})

// ─── P1-B：大头照 / 全身照 / 写实判定 ─────────────────────────────────

describe('buildCharacterHeadshotPrompt', () => {
  it('仅头肩单格、正脸/微侧、干净背景，不做三视图拼版', () => {
    const p = buildCharacterHeadshotPrompt(char('c1', '林深', '穿白衬衫的少年'))
    expect(p).toMatch(/大头照|headshot|portrait/i)
    expect(p).toMatch(/头部与肩部|head and shoulders|仅头/i)
    expect(p).toMatch(/正脸|frontal|微侧|three-quarter/i)
    // 单人单格，不是多分格拼版三视图
    expect(p).not.toMatch(/三视图|multi-panel|背面|back view/i)
  })
  it('写入角色名 + 外观气质；空 prompt 走兜底', () => {
    expect(buildCharacterHeadshotPrompt(char('c1', '林深', '白衬衫'))).toMatch(/林深/)
    expect(buildCharacterHeadshotPrompt(char('c1', '林深', '白衬衫'))).toMatch(/白衬衫/)
    expect(buildCharacterHeadshotPrompt(char('c1', '路人', ''))).toMatch(/普通现代人物|default/i)
  })
  it('风格分流：anime 注入二次元质感层', () => {
    const p = buildCharacterHeadshotPrompt(char('c1', '林深', '少年'), { visualStyle: 'anime' })
    expect(p).toMatch(/二次元|cel|赛璐珞/i)
  })
})

describe('buildCharacterFullbodyPrompt', () => {
  it('完整全身、正面站姿、完整服化道，单格非三连拼版', () => {
    const p = buildCharacterFullbodyPrompt(char('c1', '林深', '穿风衣'))
    expect(p).toMatch(/全身照|full[- ]?body|head-to-toe/i)
    expect(p).toMatch(/站姿|standing|站立/i)
    expect(p).toMatch(/服化道|wardrobe|服装/i)
    expect(p).not.toMatch(/三视图|multi-panel|正侧面|side profile/i)
  })
  it('写入角色名 + 外观气质', () => {
    const p = buildCharacterFullbodyPrompt(char('c1', '陈默', '黑色长款风衣'))
    expect(p).toMatch(/陈默/)
    expect(p).toMatch(/风衣/)
  })
})

describe('isRealisticVisualStyle', () => {
  it('photoreal 与 undefined（默认 photoreal）视为写实', () => {
    expect(isRealisticVisualStyle('photoreal')).toBe(true)
    expect(isRealisticVisualStyle(undefined)).toBe(true)
  })
  it('anime / cartoon / pixelart / watercolor / ink 均非写实', () => {
    for (const vs of ['anime', 'cartoon', 'pixelart', 'watercolor', 'ink'] as const) {
      expect(isRealisticVisualStyle(vs)).toBe(false)
    }
  })

  it('visualStyle=photoreal：PBR / 次表面散射 / 8k 等写实技术词', () => {
    const p = buildCharacterTurnaroundPrompt(
      char('c1', '林深', '22岁东方法术修行者'),
      { visualStyle: 'photoreal' },
    )
    // 用户模板里的关键写实技术词
    expect(p).toMatch(/写实|photoreal|PBR|次表面散射|subsurface scattering|8k/i)
    expect(p).toMatch(/白色背景|white background|纯白|pure white/i)
  })

  it('visualStyle=anime：换成二次元风格引导（不出写实技术词）', () => {
    const p = buildCharacterTurnaroundPrompt(
      char('c1', '林深', '少年剑士'),
      { visualStyle: 'anime' },
    )
    expect(p).toMatch(/二次元|anime|cel shading|赛璐珞/i)
    expect(p).not.toMatch(/次表面散射|subsurface scattering/i)
    // 非写实风格：不走左半脸打码护栏
    expect(p).not.toMatch(/马赛克|mosaic|像素化|pixelate/i)
  })

  it('其他风格（cartoon/pixelart/watercolor/ink）共用通用拼版模板，且不打码', () => {
    for (const vs of ['cartoon', 'pixelart', 'watercolor', 'ink'] as const) {
      const p = buildCharacterTurnaroundPrompt(char('c1', '林深', '少年剑士'), { visualStyle: vs })
      // 多分格拼版：含正面/背面全身
      expect(p).toMatch(/多分格|拼版|multi-panel|character sheet/i)
      expect(p).toMatch(/正面|front view/i)
      expect(p).toMatch(/背面|back view/i)
      // 非写实：跳过左半脸打码
      expect(p).not.toMatch(/马赛克|mosaic|像素化|pixelate/i)
    }
  })

  // P2.6 · 渲染质感锚定 + 同风格差异化（防千篇一律）
  it('photoreal：质感层挂「禁套路差异化」+ 写实子风格档（纪实/柔光/胶片）', () => {
    const p = buildCharacterHeadshotPrompt(char('c1', '林深', '剑士'), { visualStyle: 'photoreal' })
    expect(p).toMatch(/差异化/)
    expect(p).toMatch(/套路/)
    expect(p).toMatch(/纪实|柔光|胶片/)
  })
  it('anime：质感层也挂差异化档，但仍不出写实技术词（次表面散射）', () => {
    const p = buildCharacterFullbodyPrompt(char('c1', '林深', '剑士'), { visualStyle: 'anime' })
    expect(p).toMatch(/差异化/)
    expect(p).not.toMatch(/次表面散射|subsurface scattering/i)
  })
})

describe('buildLocationPrompt', () => {
  it('v6.5：场所主图强调"信息密度高 + 主光源 + 空场"，让后续视角能基于此 i2i 转换', () => {
    const p = buildLocationPrompt(loc('l1', '旧仓库', '斑驳的水泥墙，吊灯'))
    // 场所名 + 原始描述应出现
    expect(p).toMatch(/旧仓库/)
    expect(p).toMatch(/水泥墙/)
    // v6.5 · 主图必须说"空场"，因为后面所有视角会用它做 reference image，
    // 主图里出现的"路人"会被 image model 误读到所有衍生视角
    expect(p).toMatch(/empty.*no people|no people/i)
    // 强调主图作为后续视角的"视觉锚"
    expect(p).toMatch(/anchor|reference|all other camera angles|other angles/i)
    // 保留 cinematic / establishing 这种正向空间语境
    expect(p).toMatch(/cinematic|establishing|composition/i)
  })
})

describe('buildLocationDerivedAnglePrompts', () => {
  it('v6.5：衍生视角 prompt 只描述相机变化，不重复场所内容（依赖 reference image）', () => {
    const angles = buildLocationDerivedAnglePrompts(loc('l1', '旧仓库', '斑驳的水泥墙'), 2)
    expect(angles).toHaveLength(2)
    for (const a of angles) {
      // 衍生 prompt 必须强调"和参考图同一空间"
      expect(a.fullPrompt).toMatch(/Same location as the reference image/i)
      // 不应该再喂 location.prompt 的原文 ——  这些信息已经在 reference 图里
      expect(a.fullPrompt).not.toMatch(/水泥墙/)
      expect(a.fullPrompt).not.toMatch(/旧仓库/)
    }
    // id 从 angle2 开始（angle1 留给主图）
    expect(angles.map((a) => a.id)).toEqual(['l1-angle2', 'l1-angle3'])
  })
})

describe('buildSceneKeyframePrompt', () => {
  it('拼入 location + characters + uiStyle', () => {
    const p = buildSceneKeyframePrompt({
      scene: scene('s1', { prompts: { scene: '林深举剑劈向门' } }),
      location: loc('l1', '旧仓库', '破败'),
      characters: [char('c1', '林深', '少年')],
      uiStylePrompt: '暗黑水墨',
    })
    expect(p).toMatch(/暗黑水墨/)
    expect(p).toMatch(/旧仓库/)
    expect(p).toMatch(/林深/)
    expect(p).toMatch(/举剑劈向门/)
  })

  it('没有 location / characters 时只留场景和风格', () => {
    const p = buildSceneKeyframePrompt({
      scene: scene('s1', { prompts: { scene: '远景山脉' } }),
      characters: [],
    })
    expect(p).toMatch(/远景山脉/)
    expect(p).not.toMatch(/Location:/)
    expect(p).not.toMatch(/Characters present/)
  })
})

// ─── pickPrimaryRef ────────────────────────────────────────────────

describe('pickPrimaryRef', () => {
  it('location 基准图优先', () => {
    const scenario = mkScenario({
      locations: { l1: loc('l1', 'L', '', { refImageId: 'media-loc' }) },
      characters: { c1: char('c1', 'C', '', { turnaroundRefImageId: 'media-char' }) },
      scenes: {
        s1: scene('s1', { locationId: 'l1', characterIds: ['c1'] }),
      },
      rootSceneId: 's1',
    })
    const ref = pickPrimaryRef({
      scene: scenario.scenes.s1!,
      scenario,
      mediaLookup: (id) => (id === 'media-loc' ? 'url-loc' : 'url-char'),
    })
    expect(ref).toBe('url-loc')
  })

  it('没 location 时用主角 turnaround', () => {
    const scenario = mkScenario({
      characters: { c1: char('c1', 'C', '', { turnaroundRefImageId: 'media-char' }) },
      scenes: { s1: scene('s1', { characterIds: ['c1'] }) },
      rootSceneId: 's1',
    })
    const ref = pickPrimaryRef({
      scene: scenario.scenes.s1!,
      scenario,
      mediaLookup: (id) => (id === 'media-char' ? 'url-char' : undefined),
    })
    expect(ref).toBe('url-char')
  })

  it('都没时返回 undefined', () => {
    const scenario = mkScenario()
    const ref = pickPrimaryRef({
      scene: scenario.scenes.s1!,
      scenario,
      mediaLookup: () => undefined,
    })
    expect(ref).toBeUndefined()
  })
})

// ─── v3: buildShotKeyframePrompt + pickPrimaryRefForShot ────────────────

describe('buildShotKeyframePrompt', () => {
  function mkShot(overrides: Partial<Shot> = {}): Shot {
    return {
      id: 'sh_01',
      order: 0,
      framing: 'wide',
      prompt: '远景门前雨夜',
      ...overrides,
    }
  }

  it('framing 文字描述被拼入（human-readable）', () => {
    const wide = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'scene action' } }),
      shot: mkShot({ framing: 'wide' }),
      characters: [],
    })
    const close = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'scene action' } }),
      shot: mkShot({ framing: 'close' }),
      characters: [],
    })
    expect(wide).toMatch(/Wide establishing/i)
    expect(close).toMatch(/Close-up/i)
  })

  it('cameraHint 出现在 Camera direction 段', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot({ cameraHint: 'slow dolly-in, low angle' }),
      characters: [],
    })
    expect(p).toMatch(/Camera direction:.*slow dolly-in, low angle/)
  })

  it('transitionHint 出现在 Transition to next shot 段', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot({ transitionHint: 'match cut on the door handle' }),
      characters: [],
    })
    expect(p).toMatch(/Transition to next shot:.*match cut on the door handle/)
  })

  it('scene.background 拼到 Scene mood and staging 段（非空时）', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', {
        prompts: { scene: 'x' },
        background: '深夜，雨声密，巷口霓虹',
      }),
      shot: mkShot(),
      characters: [],
    })
    expect(p).toMatch(/Scene mood and staging: 深夜，雨声密，巷口霓虹/)
  })

  it('缺 cameraHint / transitionHint / background 时不留空行', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot(),
      characters: [],
    })
    expect(p).not.toMatch(/Camera direction:/)
    expect(p).not.toMatch(/Transition to next shot:/)
    expect(p).not.toMatch(/Scene mood and staging:/)
  })

  it('shotIndex/shotTotal 存在时打印 "Shot N of M"', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot(),
      characters: [],
      shotIndex: 1,
      shotTotal: 4,
    })
    expect(p).toMatch(/Shot 2 of 4/)
  })

  // v3.7: 分镜脚本扩展字段 —— 音效视觉化 / 表演外化 / 背景焦外散景 / letterbox
  it('audioHint 非空时，拼入 "Audio cues to externalize visually" 段并要求视觉证据', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot({ audioHint: '沉闷雷声 + 急促呼吸' }),
      characters: [],
    })
    expect(p).toMatch(/Audio cues to externalize visually/)
    expect(p).toMatch(/沉闷雷声 \+ 急促呼吸/)
    expect(p).toMatch(/visible physical evidence|physical cue/)
  })

  it('audioHint 缺省时不输出音效段', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot(),
      characters: [],
    })
    expect(p).not.toMatch(/Audio cues to externalize/)
  })

  it('dialogueText + subtext + performance 三者任一非空都触发 Performance 段', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot({
        dialogueText: '你答应过……',
        subtext: '不敢相信现实',
        performance: '声音沙哑 + 咬肌紧绷',
      }),
      characters: [],
    })
    expect(p).toMatch(/Performance & subtext/)
    expect(p).toMatch(/你答应过……/)
    expect(p).toMatch(/不敢相信现实/)
    expect(p).toMatch(/声音沙哑 \+ 咬肌紧绷/)
    // 不能把台词画成字幕
    expect(p).toMatch(/do NOT render text\/subtitles/)
  })

  it('Performance 段缺全部三字段时不输出', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot(),
      characters: [],
    })
    expect(p).not.toMatch(/Performance & subtext/)
  })

  it('bokehState=blurred 时拼入"光斑"描述要求', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot({ bokehState: 'blurred' }),
      characters: [],
    })
    expect(p).toMatch(/Background state: background deeply blurred/)
    expect(p).toMatch(/bokeh/i)
  })

  it('bokehState=dynamic 时拼入"动态光/粒子"描述', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot({ bokehState: 'dynamic' }),
      characters: [],
    })
    expect(p).toMatch(/Background state: background in motion/)
  })

  it('所有 shot 都必带 letterbox / 2.39:1 / film grain 收尾锚点', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot(),
      characters: [],
    })
    expect(p).toMatch(/2\.39:1/)
    expect(p).toMatch(/anamorphic letterbox/)
    expect(p).toMatch(/film grain/)
    expect(p).toMatch(/clean frame|high detail/)
  })

  it('characters 非空时采用"视觉锚点前置"格式（名字 + 外观描述）', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1', { prompts: { scene: 'x' } }),
      shot: mkShot(),
      characters: [char('c1', '艾伦', '湿透风衣 做旧米色衬衫')],
    })
    expect(p).toMatch(/visual anchors up-front/)
    expect(p).toMatch(/艾伦 \(湿透风衣 做旧米色衬衫\)/)
  })
})

describe('pickPrimaryRefForShot', () => {
  it('location > shot.characterIds 第一个 > scene.characterIds 第一个', () => {
    const scenario = mkScenario({
      locations: { l1: loc('l1', 'L', '', { refImageId: 'media-loc' }) },
      characters: {
        c1: char('c1', 'C1', '', { turnaroundRefImageId: 'media-c1' }),
        c2: char('c2', 'C2', '', { turnaroundRefImageId: 'media-c2' }),
      },
      scenes: {
        s1: scene('s1', {
          locationId: 'l1',
          characterIds: ['c1'],
        }),
      },
      rootSceneId: 's1',
    })
    const ref = pickPrimaryRefForShot({
      scene: scenario.scenes.s1!,
      shot: {
        id: 'sh_01',
        order: 0,
        framing: 'medium',
        prompt: 'x',
        characterIds: ['c2'],
      },
      scenario,
      mediaLookup: (id) => ({ 'media-loc': 'url-loc', 'media-c1': 'url-c1', 'media-c2': 'url-c2' })[id],
    })
    // location 优先（有 refImageId）
    expect(ref).toBe('url-loc')
  })

  it('无 location 时 shot.characterIds 覆盖 scene.characterIds', () => {
    const scenario = mkScenario({
      characters: {
        c1: char('c1', 'C1', '', { turnaroundRefImageId: 'media-c1' }),
        c2: char('c2', 'C2', '', { turnaroundRefImageId: 'media-c2' }),
      },
      scenes: {
        s1: scene('s1', {
          characterIds: ['c1'],
        }),
      },
      rootSceneId: 's1',
    })
    const ref = pickPrimaryRefForShot({
      scene: scenario.scenes.s1!,
      shot: {
        id: 'sh_01',
        order: 0,
        framing: 'medium',
        prompt: 'x',
        characterIds: ['c2'], // 本镜只出 c2
      },
      scenario,
      mediaLookup: (id) => (id === 'media-c2' ? 'url-c2' : undefined),
    })
    expect(ref).toBe('url-c2')
  })

  it('shot 不带 characterIds 时回退到 scene.characterIds[0]', () => {
    const scenario = mkScenario({
      characters: {
        c1: char('c1', 'C1', '', { turnaroundRefImageId: 'media-c1' }),
      },
      scenes: { s1: scene('s1', { characterIds: ['c1'] }) },
      rootSceneId: 's1',
    })
    const ref = pickPrimaryRefForShot({
      scene: scenario.scenes.s1!,
      shot: { id: 'sh_01', order: 0, framing: 'medium', prompt: 'x' },
      scenario,
      mediaLookup: (id) => (id === 'media-c1' ? 'url-c1' : undefined),
    })
    expect(ref).toBe('url-c1')
  })
})

// ─── 流水线调度 ───────────────────────────────────────────────────

describe('runForgeImagePipeline', () => {
  it('依次跑 characters / locations / scenes，回调正确分派', async () => {
    const client = mkClient()
    const scenario = mkScenario({
      characters: {
        c1: char('c1', 'A', 'alpha'),
        c2: char('c2', 'B', 'bravo'),
      },
      locations: { l1: loc('l1', 'L', 'alley') },
      scenes: {
        s1: scene('s1', { locationId: 'l1', characterIds: ['c1'] }),
      },
      rootSceneId: 's1',
    })

    const charCalls: string[] = []
    const locCalls: string[] = []
    const sceneCalls: string[] = []

    const summary = await runForgeImagePipeline({
      client,
      scenario,
      mediaLookup: () => undefined,
      onCharacterRef: (id) => charCalls.push(id),
      onLocationRef: (id) => locCalls.push(id),
      onSceneKeyframe: (id) => sceneCalls.push(id),
      concurrency: 2,
    })

    expect(charCalls.sort()).toEqual(['c1', 'c2'])
    expect(locCalls).toEqual(['l1'])
    expect(sceneCalls).toEqual(['s1'])
    expect(summary.characters.ok.map((x) => x.characterId).sort()).toEqual(['c1', 'c2'])
    // v6.5：location 展开成 1 主图 + 2 衍生 = 3 条 angleRefs（locationId 全为 l1）
    expect(summary.locations.ok.map((x) => x.locationId)).toEqual(['l1', 'l1', 'l1'])
    expect(summary.locations.ok.map((x) => x.angleId).sort()).toEqual([
      'l1-angle1', 'l1-angle2', 'l1-angle3',
    ])
    // 没有 shots[] 时 pipeline 会注入兜底 sh_01（所以正好 1 条 shot 任务）
    expect(summary.shots.ok.map((x) => x.sceneId)).toEqual(['s1'])
    expect(summary.shots.ok.map((x) => x.shotId)).toEqual(['sh_01'])
  })

  it('每个角色生成单张三视图定妆照，触发 onCharacterRef 一次', async () => {
    const calls: string[] = []
    const client: ImageClient = {
      generate: vi.fn(async (req) => {
        if (/三视图|设计参考稿|turnaround|front view, side view, back view/i.test(req.prompt)) {
          calls.push('turnaround')
        } else if (/大头照|headshot/i.test(req.prompt)) {
          calls.push('headshot')
        } else if (/全身照|full[- ]?body/i.test(req.prompt)) {
          calls.push('fullbody')
        }
        return mkImageResult(req.prompt)
      }),
      ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
      getModel: () => 'test',
      getProviderName: () => 'test',
    }
    const scenario = mkScenario({
      characters: { c1: char('c1', 'A', 'alpha') },
      scenes: { s1: scene('s1') },
      rootSceneId: 's1',
    })
    const refs: string[] = []
    await runForgeImagePipeline({
      client,
      scenario,
      mediaLookup: () => undefined,
      skipShots: true,
      onCharacterRef: (id) => refs.push(id),
    })
    // 只生成一张三视图，不再拆大头照/全身照两张
    expect(calls).toEqual(['turnaround'])
    expect(refs).toEqual(['c1'])
  })

  it('v6.5 · location 衍生视角必须基于主图 (i2i 锚点)', async () => {
    /*
     * 关键回归测试：作者反馈"主图 / 视角图各自漂"，根因就是衍生视角没传 ref.
     * 这条测试守护住"主图先生 → 衍生角度的 generate 调用必须带 referenceImageDataUrl
     * = 主图.dataUrl"这个语义合同，未来任何 refactor 把 ref 漏了都会被卡住.
     */
    const calls: Array<{ prompt: string; ref?: string }> = []
    const client: ImageClient = {
      generate: vi.fn(async (req) => {
        calls.push({ prompt: req.prompt, ref: req.referenceImageDataUrl })
        return mkImageResult(req.prompt)
      }),
      ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
      getModel: () => 'test',
      getProviderName: () => 'test',
    }
    const scenario = mkScenario({
      locations: { l1: loc('l1', '旧仓库', '斑驳的水泥墙') },
      scenes: { s1: scene('s1', { locationId: 'l1' }) },
      rootSceneId: 's1',
    })
    await runForgeImagePipeline({ client, scenario, mediaLookup: () => undefined })
    // 衍生视角通过特征 prompt "Same location as the reference image" 识别
    const derivedCalls = calls.filter((c) => /Same location as the reference image/i.test(c.prompt))
    expect(derivedCalls).toHaveLength(2)
    // 主图通过特征 prompt "all other camera angles" 识别（buildLocationPrompt 专属）
    const baseCalls = calls.filter((c) => /all other camera angles/i.test(c.prompt))
    expect(baseCalls).toHaveLength(1)
    expect(baseCalls[0]!.ref).toBeUndefined()
    // 衍生必须带 ref，且两张共用主图作 ref
    for (const dc of derivedCalls) {
      expect(dc.ref).toBeDefined()
      expect(dc.ref).toMatch(/^data:image/)
    }
    expect(derivedCalls[0]!.ref).toBe(derivedCalls[1]!.ref)
  })

  it('onProgress 汇总三阶段总步数', async () => {
    const client = mkClient()
    const scenario = mkScenario({
      characters: { c1: char('c1', 'A', '') },
      locations: { l1: loc('l1', 'L', '') },
      scenes: { s1: scene('s1') },
      rootSceneId: 's1',
    })
    const prog: Array<[number, number]> = []
    await runForgeImagePipeline({
      client,
      scenario,
      mediaLookup: () => undefined,
      onProgress: (done, total) => prog.push([done, total]),
    })
    // 1 character × 1（三视图） + 1 location × 3 angles + 1 shot = 5 total
    expect(prog[prog.length - 1]).toEqual([5, 5])
    expect(prog[0]![1]).toBe(5)
  })

  it('单个 character 失败不阻塞其他阶段', async () => {
    const client: ImageClient = {
      generate: vi.fn(async (req) => {
        if (req.prompt.includes('alpha')) throw new Error('boom')
        return mkImageResult(req.prompt)
      }),
      ping: async () => ({ ok: true, latencyMs: 1 }),
      getModel: () => 't',
      getProviderName: () => 't',
    }
    const scenario = mkScenario({
      characters: {
        c1: char('c1', 'A', 'alpha'),
        c2: char('c2', 'B', 'bravo'),
      },
      locations: { l1: loc('l1', 'L', 'ok') },
      scenes: { s1: scene('s1') },
      rootSceneId: 's1',
    })
    const summary = await runForgeImagePipeline({
      client,
      scenario,
      mediaLookup: () => undefined,
    })
    expect(summary.characters.ok.map((x) => x.characterId)).toEqual(['c2'])
    expect(summary.characters.failed).toHaveLength(1)
    // v3.6：1 location × 3 angles = 3 条
    expect(summary.locations.ok).toHaveLength(3)
    expect(summary.shots.ok).toHaveLength(1)
  })

  it('scene.shots.length > 1 时 → 每镜一条任务，isKeyShot 只在 keyShotId 上为 true', async () => {
    const client = mkClient()
    const scenario = mkScenario({
      characters: { c1: char('c1', 'A', '') },
      locations: { l1: loc('l1', 'L', '') },
      scenes: {
        s1: scene('s1', {
          locationId: 'l1',
          characterIds: ['c1'],
          shots: [
            { id: 'sh_01', order: 0, framing: 'wide', prompt: 'establish' },
            { id: 'sh_02', order: 1, framing: 'medium', prompt: 'reaction' },
            { id: 'sh_03', order: 2, framing: 'close', prompt: 'detail' },
          ],
          keyShotId: 'sh_02',
        }),
      },
      rootSceneId: 's1',
    })

    const shotCalls: Array<{ sceneId: string; shotId: string; isKeyShot: boolean }> = []
    const legacyCalls: string[] = []
    const summary = await runForgeImagePipeline({
      client,
      scenario,
      mediaLookup: () => undefined,
      onSceneShotKeyframe: (sceneId, shotId, _r, meta) => {
        shotCalls.push({ sceneId, shotId, isKeyShot: meta.isKeyShot })
      },
      onSceneKeyframe: (id) => legacyCalls.push(id),
    })

    expect(summary.shots.ok).toHaveLength(3)
    expect(shotCalls.map((x) => x.shotId).sort()).toEqual(['sh_01', 'sh_02', 'sh_03'])
    const keyHits = shotCalls.filter((x) => x.isKeyShot)
    expect(keyHits).toHaveLength(1)
    expect(keyHits[0]?.shotId).toBe('sh_02')
    // 老回调在 keyShot 完成时触发一次（向后兼容）
    expect(legacyCalls).toEqual(['s1'])
  })

  it('onProgress 的 total 以 shot 总数计', async () => {
    const client = mkClient()
    const scenario = mkScenario({
      characters: { c1: char('c1', 'A', '') },
      scenes: {
        s1: scene('s1', {
          characterIds: ['c1'],
          shots: [
            { id: 'sh_01', order: 0, framing: 'wide', prompt: 'p1' },
            { id: 'sh_02', order: 1, framing: 'close', prompt: 'p2' },
          ],
        }),
      },
      rootSceneId: 's1',
    })
    const prog: Array<[number, number]> = []
    await runForgeImagePipeline({
      client,
      scenario,
      mediaLookup: () => undefined,
      onProgress: (done, total) => prog.push([done, total]),
    })
    // 1 character × 1（三视图） + 0 location + 2 shots = 3 步
    expect(prog[prog.length - 1]).toEqual([3, 3])
  })
})
