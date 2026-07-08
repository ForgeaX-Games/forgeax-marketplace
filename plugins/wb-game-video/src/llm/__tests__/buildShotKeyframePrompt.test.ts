import { describe, it, expect } from 'vitest'
import { buildShotKeyframePrompt } from '../forgeImagePipeline'
import type { Character, Location, Scene, Shot } from '../../scenario/types'

/**
 * buildShotKeyframePrompt A/B 双模测试（v3.8）
 *
 * 覆盖：
 *   - 老路径（不传 frame、keyframeStrategy='single' 或 undefined）行为兼容
 *   - frame='A' → 用 startFramePrompt + START FRAME 标签 + 守恒说明
 *   - frame='B' → 用 endFramePrompt + END FRAME 标签
 *   - 推断路径：keyframeStrategy='ab' 且未传 frame → 自动 A
 *   - A/B prompt 缺失 → fallback 到 shot.prompt（不崩）
 *   - cinematic widescreen letterbox 尾巴始终存在
 */

function char(id: string, name: string, prompt?: string): Character {
  return { id, name, prompt: prompt ?? '' }
}

function loc(id: string, name: string, prompt?: string): Location {
  return { id, name, prompt: prompt ?? '' }
}

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: `Scene ${id}`,
    media: { kind: 'IMAGE_PROMPT', prompt: 'default' },
    durationMs: 5000,
    dialogue: [],
    branches: [],
    background: '暴雨 废弃车站',
    prompts: { scene: '兜底场景描述' },
    ...overrides,
  }
}

function shot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: 'sh01',
    order: 0,
    framing: 'medium',
    prompt: '代表帧：艾伦转身',
    ...overrides,
  }
}

describe('buildShotKeyframePrompt · 老路径兼容', () => {
  it('不传 frame + keyframeStrategy=undefined → 用 shot.prompt 不输出 A/B 标签', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot(),
      characters: [],
    })
    expect(p).toMatch(/This shot shows: 代表帧：艾伦转身/)
    expect(p).not.toMatch(/START FRAME/)
    expect(p).not.toMatch(/END FRAME/)
  })

  it('keyframeStrategy="single" → 与老路径一致', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({ keyframeStrategy: 'single' }),
      characters: [],
    })
    expect(p).toMatch(/This shot shows:/)
    expect(p).not.toMatch(/START FRAME/)
  })

  it('electromagnetic rhetoric 始终包含 2.39:1 letterbox 尾巴', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot(),
      characters: [],
    })
    expect(p).toMatch(/2\.39:1 anamorphic letterbox/)
    expect(p).toMatch(/film grain/)
    expect(p).toMatch(/clean frame|high detail/)
  })
})

describe('buildShotKeyframePrompt · A/B 显式模式', () => {
  it('frame="A" + startFramePrompt → 标签 START FRAME (A) + 守恒说明', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        keyframeStrategy: 'ab',
        startFramePrompt: '门刚被推开一道缝，雨水开始飘入',
        endFramePrompt: '人已跨过门槛，雨水打湿肩头',
      }),
      characters: [],
      frame: 'A',
    })
    expect(p).toMatch(/START FRAME \(A\)/)
    expect(p).toMatch(/门刚被推开一道缝/)
    expect(p).not.toMatch(/END FRAME/)
    // 守恒约束文案
    expect(p).toMatch(/FIRST frame/)
    expect(p).toMatch(/same light source direction/)
    expect(p).toMatch(/never disappear/)
  })

  it('frame="B" + endFramePrompt → 标签 END FRAME (B) + 守恒说明', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        keyframeStrategy: 'ab',
        startFramePrompt: '门刚被推开',
        endFramePrompt: '人已跨过门槛',
      }),
      characters: [],
      frame: 'B',
    })
    expect(p).toMatch(/END FRAME \(B\)/)
    expect(p).toMatch(/人已跨过门槛/)
    expect(p).not.toMatch(/START FRAME/)
    expect(p).toMatch(/LAST frame/)
    expect(p).toMatch(/wet hair stays wet/)
  })

  it('frame="A" 时不输出 "This shot shows:"（防止双画面描述冲突）', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        keyframeStrategy: 'ab',
        startFramePrompt: 'A 帧描述',
        endFramePrompt: 'B 帧描述',
      }),
      characters: [],
      frame: 'A',
    })
    expect(p).not.toMatch(/This shot shows:/)
  })

  it('frame="A" 但 startFramePrompt 缺失 → fallback 到 shot.prompt 且仍加 START FRAME 标签', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        keyframeStrategy: 'ab',
        prompt: '镜头主画面：艾伦转身',
        // startFramePrompt 故意不传
      }),
      characters: [],
      frame: 'A',
    })
    expect(p).toMatch(/START FRAME \(A\)/)
    expect(p).toMatch(/镜头主画面：艾伦转身/)
  })
})

describe('buildShotKeyframePrompt · A/B 自动推断', () => {
  it('keyframeStrategy="ab" 且未传 frame → 自动 fallback 到 A（避免调用方忘传参数出混乱）', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        keyframeStrategy: 'ab',
        startFramePrompt: '门刚被推开',
        endFramePrompt: '人已跨过门槛',
      }),
      characters: [],
    })
    expect(p).toMatch(/START FRAME \(A\)/)
    expect(p).toMatch(/门刚被推开/)
  })

  it('keyframeStrategy=undefined + frame="A" → 显式 frame 仍生效（frame 显式优先于 strategy 推断）', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        prompt: '备用主画面',
      }),
      characters: [],
      frame: 'A',
    })
    // 没 startFramePrompt → fallback 到 shot.prompt
    expect(p).toMatch(/START FRAME \(A\)/)
    expect(p).toMatch(/备用主画面/)
  })

  it('frame="single" 显式传入 → 老路径（忽略 keyframeStrategy=ab）', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        keyframeStrategy: 'ab',
        startFramePrompt: 'A',
        endFramePrompt: 'B',
        prompt: '代表帧',
      }),
      characters: [],
      frame: 'single',
    })
    expect(p).toMatch(/This shot shows: 代表帧/)
    expect(p).not.toMatch(/START FRAME/)
    expect(p).not.toMatch(/END FRAME/)
  })
})

describe('buildShotKeyframePrompt · 辅助字段共存', () => {
  it('A 帧 + audioHint + performance + bokehState 共存，各段都在且顺序合理', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot({
        keyframeStrategy: 'ab',
        startFramePrompt: '门被推开',
        endFramePrompt: '人跨过门槛',
        audioHint: '雷声 + 雨水打铁皮',
        performance: '声音沙哑，肩膀绷紧',
        subtext: '他不敢相信她已经走了',
        bokehState: 'blurred',
        transitionHint: '硬切到反打',
      }),
      characters: [char('c1', '艾伦', '湿风衣 做旧米色衬衫')],
      location: loc('l1', '废弃车站', '锈铁轨 积水'),
      frame: 'A',
    })

    // 结构顺序检查
    const idxLocation = p.indexOf('Location:')
    const idxChars = p.indexOf('Characters present')
    const idxStart = p.indexOf('START FRAME (A)')
    const idxAudio = p.indexOf('Audio cues')
    const idxPerf = p.indexOf('Performance & subtext')
    const idxBokeh = p.indexOf('Background state:')
    const idxTrans = p.indexOf('Transition to next shot:')
    const idxCine = p.indexOf('2.39:1 anamorphic')

    expect(idxLocation).toBeGreaterThanOrEqual(0)
    expect(idxChars).toBeGreaterThan(idxLocation)
    expect(idxStart).toBeGreaterThan(idxChars)
    expect(idxAudio).toBeGreaterThan(idxStart)
    expect(idxPerf).toBeGreaterThan(idxAudio)
    expect(idxBokeh).toBeGreaterThan(idxPerf)
    expect(idxTrans).toBeGreaterThan(idxBokeh)
    expect(idxCine).toBeGreaterThan(idxTrans)

    expect(p).toMatch(/艾伦 \(湿风衣 做旧米色衬衫\)/)
    expect(p).toMatch(/废弃车站/)
    expect(p).toMatch(/雷声 \+ 雨水打铁皮/)
    expect(p).toMatch(/background deeply blurred/)
  })
})

describe('buildShotKeyframePrompt · 关键帧不再生成期打码（v7）', () => {
  // v7（2026-06）· 作者要求：关键帧展示干净写实图，不在提示词里画人脸马赛克。
  //   下游 Seedance 所需的人脸打码迁移到上传期 faceMaskTool。
  it('photoreal + 有角色 → 不再注入打码指令', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot(),
      characters: [char('c1', '艾伦', '湿风衣')],
      visualStyle: 'photoreal',
    })
    expect(p).not.toMatch(/Face privacy/i)
    expect(p).not.toMatch(/pixel mosaic/i)
    // 角色锚定段仍保留（用于一致性），只是不再带打码
    expect(p).toMatch(/Characters present/i)
  })

  it('photoreal + 无角色 → 不注入打码指令（纯场景图）', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot(),
      characters: [],
      visualStyle: 'photoreal',
    })
    expect(p).not.toMatch(/Face privacy/i)
    expect(p).not.toMatch(/pixel mosaic/i)
  })

  it('anime + 有角色 → 不注入打码指令', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot(),
      characters: [char('c1', '艾伦', '湿风衣')],
      visualStyle: 'anime',
    })
    expect(p).not.toMatch(/Face privacy/i)
  })

  it('不传 visualStyle + 有角色 → 不注入打码指令', () => {
    const p = buildShotKeyframePrompt({
      scene: scene('s1'),
      shot: shot(),
      characters: [char('c1', '艾伦')],
    })
    expect(p).not.toMatch(/Face privacy/i)
  })
})
