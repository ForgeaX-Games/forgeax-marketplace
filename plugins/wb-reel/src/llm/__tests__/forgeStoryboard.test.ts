import { describe, it, expect } from 'vitest'
import {
  buildStoryboardUserPrompt,
  normalizeStoryboardShots,
  clampShotCount,
} from '../forgeStoryboard'
import type { Character, Location, Scene } from '../../scenario/types'

/**
 * forgeStoryboard 纯函数层测试。
 *
 * 覆盖：
 *   - user prompt 拼装包含所有必要块
 *   - shot normalize 正确对齐 framing / durationSec / bokehState
 *   - clampShotCount 范围约束
 */

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    title: `Scene ${id}`,
    media: { kind: 'IMAGE_PROMPT', prompt: 'default' },
    durationMs: 5000,
    dialogue: [],
    branches: [],
    ...overrides,
  }
}

describe('clampShotCount', () => {
  it('默认区间 [1, 12]（v4「少而长」：下限降到 1）', () => {
    expect(clampShotCount(0)).toBe(1)
    expect(clampShotCount(1)).toBe(1)
    expect(clampShotCount(6)).toBe(6)
    expect(clampShotCount(12)).toBe(12)
    expect(clampShotCount(99)).toBe(12)
  })

  it('NaN / Infinity 回退到 1', () => {
    expect(clampShotCount(Number.NaN)).toBe(1)
    expect(clampShotCount(Infinity)).toBe(1)
  })

  it('小数值取四舍五入', () => {
    expect(clampShotCount(5.4)).toBe(5)
    expect(clampShotCount(5.6)).toBe(6)
  })
})

describe('buildStoryboardUserPrompt', () => {
  it('拼入标题 + 视觉风格 + 角色锚点 + 期望镜数', () => {
    const chars: Character[] = [
      { id: 'c1', name: '艾伦', prompt: '湿透风衣 做旧米色衬衫' },
    ]
    const s = scene('s1', {
      title: '03 · 雨夜告别',
      background: '废弃车站 · 暴雨雷暴',
      prompts: { scene: '手握船票等不到人' },
    })
    const prompt = buildStoryboardUserPrompt({
      scene: s,
      characters: chars,
      visualStyle: 'photoreal',
      desiredShotCount: 6,
    })
    expect(prompt).toMatch(/03 · 雨夜告别/)
    expect(prompt).toMatch(/photoreal/)
    expect(prompt).toMatch(/艾伦：湿透风衣 做旧米色衬衫/)
    expect(prompt).toMatch(/废弃车站 · 暴雨雷暴/)
    expect(prompt).toMatch(/手握船票等不到人/)
    expect(prompt).toMatch(/期望镜数】约 6 镜/)
  })

  it('无 location 时不输出"【场所】"标签', () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
    })
    expect(prompt).not.toMatch(/【场所】/)
  })

  it('有 location 时输出 name + 描述', () => {
    const l: Location = { id: 'l1', name: '废弃车站', prompt: '锈铁轨、积水' }
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
      location: l,
    })
    expect(prompt).toMatch(/【场所】废弃车站 —— 锈铁轨、积水/)
  })

  it('有 sceneText 时用三引号包裹、强调"逐字保留"', () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
      sceneText: '艾伦站在雨中："你答应过..."',
    })
    expect(prompt).toMatch(/逐字保留/)
    expect(prompt).toMatch(/"""/)
    expect(prompt).toMatch(/你答应过\.\.\./)
  })

  it('已有 scene.dialogue 时，会追加【已有台词】块', () => {
    const s = scene('s1', {
      dialogue: [
        {
          id: 'd1',
          role: 'protagonist',
          speaker: '艾伦',
          text: '你答应过……',
          startMs: 0,
        },
      ],
    })
    const prompt = buildStoryboardUserPrompt({
      scene: s,
      characters: [],
    })
    expect(prompt).toMatch(/【已有台词（按顺序，必须逐字保留 \+ 标注说话人）】/)
    expect(prompt).toMatch(/艾伦：你答应过……/)
  })
})

describe('normalizeStoryboardShots', () => {
  const sceneA = scene('s1', {
    prompts: { scene: '兜底场景描述' },
  })

  it('id 重签为 `<sceneId>-shNN-<token>`（每次拆镜唯一），order 按顺序', () => {
    const raw = [
      { framing: 'wide', prompt: 'a' },
      { framing: 'medium', prompt: 'b' },
      { framing: 'close', prompt: 'c' },
    ]
    const shots = normalizeStoryboardShots(raw, sceneA, [])
    // 形如 s1-sh01-<token>：稳定前缀 + 每次拆镜唯一的 token（防「重拆复用旧 id」）。
    expect(shots.map((s) => s.id)).toEqual([
      expect.stringMatching(/^s1-sh01-[a-z0-9]+$/),
      expect.stringMatching(/^s1-sh02-[a-z0-9]+$/),
      expect.stringMatching(/^s1-sh03-[a-z0-9]+$/),
    ])
    // 同一次拆镜内各镜共享同一 token（id 仍互不相同，靠镜号区分）。
    const tokens = shots.map((s) => s.id.split('-').pop())
    expect(new Set(tokens).size).toBe(1)
    // 两次拆镜的 token 不同 —— 新镜得到全新 id，旧编排视频不再误挂新卡。
    const again = normalizeStoryboardShots(raw, sceneA, [])
    expect(again[0]!.id).not.toBe(shots[0]!.id)
    expect(shots.map((s) => s.order)).toEqual([0, 1, 2])
  })

  it('framing 字典对齐：long/establishing → wide；closeup → close；乱七八糟 → medium', () => {
    const raw = [
      { framing: 'long shot', prompt: 'a' },
      { framing: 'CLOSEUP', prompt: 'b' },
      { framing: 'banana', prompt: 'c' },
      { framing: 'Over-The-Shoulder', prompt: 'd' },
    ]
    const shots = normalizeStoryboardShots(raw, sceneA, [])
    expect(shots[0]!.framing).toBe('wide')
    expect(shots[1]!.framing).toBe('close')
    expect(shots[2]!.framing).toBe('medium')
    expect(shots[3]!.framing).toBe('ots')
  })

  it('durationSec 吸附到 Seedance 合法区间 [4,15]，小数就近取整，越界夹到边界', () => {
    const raw = [
      { framing: 'wide', prompt: 'a', durationSec: 1 }, // 低于下限 → 4
      { framing: 'wide', prompt: 'a', durationSec: 5 },
      { framing: 'wide', prompt: 'a', durationSec: 10 },
      { framing: 'wide', prompt: 'a', durationSec: 30 }, // 超上限 → 15
      { framing: 'wide', prompt: 'a', durationSec: 5.6 }, // 小数 → 6
      { framing: 'wide', prompt: 'a', durationSec: 120 }, // 超 → 15
      { framing: 'wide', prompt: 'a', durationSec: 0 }, // 非法 → undefined
      { framing: 'wide', prompt: 'a', durationSec: -3 }, // 非法 → undefined
      { framing: 'wide', prompt: 'a' }, // 缺 → undefined
    ]
    const shots = normalizeStoryboardShots(raw, sceneA, [])
    expect(shots[0]!.durationSec).toBe(4)
    expect(shots[1]!.durationSec).toBe(5)
    expect(shots[2]!.durationSec).toBe(10)
    expect(shots[3]!.durationSec).toBe(15)
    expect(shots[4]!.durationSec).toBe(6)
    expect(shots[5]!.durationSec).toBe(15)
    expect(shots[6]!.durationSec).toBeUndefined()
    expect(shots[7]!.durationSec).toBeUndefined()
    expect(shots[8]!.durationSec).toBeUndefined()
  })

  it('bokehState 白名单 + 中文别名', () => {
    const raw = [
      { framing: 'wide', prompt: 'a', bokehState: 'sharp' },
      { framing: 'wide', prompt: 'a', bokehState: 'blur' },
      { framing: 'wide', prompt: 'a', bokehState: '清晰' },
      { framing: 'wide', prompt: 'a', bokehState: '模糊' },
      { framing: 'wide', prompt: 'a', bokehState: '动态' },
      { framing: 'wide', prompt: 'a', bokehState: 'nonsense' },
    ]
    const shots = normalizeStoryboardShots(raw, sceneA, [])
    expect(shots.map((s) => s.bokehState)).toEqual([
      'sharp',
      'blurred',
      'sharp',
      'blurred',
      'dynamic',
      undefined,
    ])
  })

  it('prompt 缺失时兜底到 scene.prompts.scene', () => {
    const raw = [{ framing: 'wide' }]
    const shots = normalizeStoryboardShots(raw, sceneA, [])
    expect(shots[0]!.prompt).toBe('兜底场景描述')
  })

  it('dialogueText / subtext / performance / audioHint 原样保留（去空白）', () => {
    const raw = [
      {
        framing: 'medium',
        prompt: 'a',
        dialogueText: '  你答应过……  ',
        subtext: '不敢相信现实',
        performance: '声音沙哑',
        audioHint: '雷声 + 雨水',
      },
    ]
    const shots = normalizeStoryboardShots(raw, sceneA, [])
    expect(shots[0]!.dialogueText).toBe('你答应过……')
    expect(shots[0]!.subtext).toBe('不敢相信现实')
    expect(shots[0]!.performance).toBe('声音沙哑')
    expect(shots[0]!.audioHint).toBe('雷声 + 雨水')
  })

  it('非对象 raw item → 记录告警但占位产出 Shot（不崩）', () => {
    const raw = [null as unknown, { framing: 'wide', prompt: 'ok' }]
    const warnings: string[] = []
    const shots = normalizeStoryboardShots(raw, sceneA, warnings)
    expect(shots).toHaveLength(2)
    expect(shots[0]!.prompt).toBe('兜底场景描述')
    expect(warnings.some((w) => w.includes('shot[0]'))).toBe(true)
  })

  it('characterIds 非字符串数组被忽略', () => {
    const raw = [
      { framing: 'wide', prompt: 'a', characterIds: ['c1', 42, 'c2'] },
      { framing: 'wide', prompt: 'a', characterIds: 'c1' },
    ]
    const shots = normalizeStoryboardShots(raw, sceneA, [])
    expect(shots[0]!.characterIds).toEqual(['c1', 'c2'])
    expect(shots[1]!.characterIds).toBeUndefined()
  })

  describe('v3.8 · A/B 双帧 + keyframeStrategy', () => {
    it('keyframeStrategy="single" → A/B 字段被丢弃', () => {
      const raw = [
        {
          framing: 'medium',
          prompt: 'mid',
          keyframeStrategy: 'single',
          startFramePrompt: 'ghost A',
          endFramePrompt: 'ghost B',
        },
      ]
      const warnings: string[] = []
      const shots = normalizeStoryboardShots(raw, sceneA, warnings)
      expect(shots[0]!.keyframeStrategy).toBe('single')
      expect(shots[0]!.startFramePrompt).toBeUndefined()
      expect(shots[0]!.endFramePrompt).toBeUndefined()
    })

    it('keyframeStrategy="ab" 且 A/B 齐全 → 原样保留', () => {
      const raw = [
        {
          framing: 'wide',
          prompt: 'mid',
          keyframeStrategy: 'ab',
          startFramePrompt: '门刚被推开',
          endFramePrompt: '人已跨过门槛',
        },
      ]
      const warnings: string[] = []
      const shots = normalizeStoryboardShots(raw, sceneA, warnings)
      expect(shots[0]!.keyframeStrategy).toBe('ab')
      expect(shots[0]!.startFramePrompt).toBe('门刚被推开')
      expect(shots[0]!.endFramePrompt).toBe('人已跨过门槛')
      expect(warnings).toHaveLength(0)
    })

    it('keyframeStrategy="ab" 但 A 缺失 → 降级 single 且告警', () => {
      const raw = [
        {
          framing: 'wide',
          prompt: 'mid',
          keyframeStrategy: 'ab',
          endFramePrompt: 'only B',
        },
      ]
      const warnings: string[] = []
      const shots = normalizeStoryboardShots(raw, sceneA, warnings)
      expect(shots[0]!.keyframeStrategy).toBe('single')
      expect(shots[0]!.startFramePrompt).toBeUndefined()
      expect(shots[0]!.endFramePrompt).toBeUndefined()
      expect(warnings.some((w) => w.includes('降级'))).toBe(true)
    })

    it('keyframeStrategy 非法字符串 → 保持 undefined', () => {
      const raw = [
        {
          framing: 'wide',
          prompt: 'mid',
          keyframeStrategy: 'triptych',
        },
      ]
      const shots = normalizeStoryboardShots(raw, sceneA, [])
      expect(shots[0]!.keyframeStrategy).toBeUndefined()
    })
  })
})

describe('computeShotQuota / sanitizeSceneDuration', () => {
  it('computeShotQuota 按「少而长」分档返回镜数（最终夹到 [1, 12]）', async () => {
    const { computeShotQuota } = await import('../forgeStoryboard')
    expect(computeShotQuota(5)).toBe(1) // ≤15 → 1
    expect(computeShotQuota(15)).toBe(1)
    expect(computeShotQuota(20)).toBe(2) // ≤30 → 2
    expect(computeShotQuota(30)).toBe(2)
    expect(computeShotQuota(45)).toBe(3) // ≤45 → 3
    expect(computeShotQuota(60)).toBe(4) // ≤60 → 4
    expect(computeShotQuota(120)).toBe(10) // >60 → ⌈120/13⌉=10
    expect(computeShotQuota(600)).toBe(12) // 超大 → ⌈600/13⌉=47，夹到 12
  })

  it('sanitizeSceneDuration 夹到 [5, 300]', async () => {
    const { sanitizeSceneDuration } = await import('../forgeStoryboard')
    expect(sanitizeSceneDuration(undefined)).toBe(60)
    expect(sanitizeSceneDuration(0)).toBe(60)
    expect(sanitizeSceneDuration(-10)).toBe(60)
    expect(sanitizeSceneDuration(Number.NaN)).toBe(60)
    expect(sanitizeSceneDuration(3)).toBe(5) // 低于最低档
    expect(sanitizeSceneDuration(45)).toBe(45)
    expect(sanitizeSceneDuration(500)).toBe(300)
  })
})

describe('buildStoryboardUserPrompt · v3.8 新增字段', () => {
  it('注入 persona header（显示 displayName + tagline）', async () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
      directorStyle: 'fincher-noir',
    })
    expect(prompt).toMatch(/【导演流派】芬奇 · 黑色惊悚/)
  })

  it('directorStyle=custom 且 custom 文本非空 → persona header 显示"自定义"', () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
      directorStyle: 'custom',
      directorCustomPersona: '我是做默片致敬的复古导演',
    })
    expect(prompt).toMatch(/【导演流派】自定义/)
  })

  it('未传 directorStyle → 使用默认（维伦纽瓦）', () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
    })
    expect(prompt).toMatch(/维伦纽瓦/)
  })

  it('sceneDurationSec 被注入且附带时长守恒说明', () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
      sceneDurationSec: 45,
    })
    expect(prompt).toMatch(/sceneDurationSec】45/)
    expect(prompt).toMatch(/±5s/)
  })

  it('未传 sceneDurationSec 时不输出该标签', () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
    })
    // 说明文案里会提到 sceneDurationSec 这个词，所以按标签形式检查
    expect(prompt).not.toMatch(/【场景目标总时长 sceneDurationSec】/)
  })

  it('输出契约尾部提示提到 A/B 守恒', () => {
    const prompt = buildStoryboardUserPrompt({
      scene: scene('s1'),
      characters: [],
    })
    expect(prompt).toMatch(/startFramePrompt \/ endFramePrompt/)
    expect(prompt).toMatch(/物理守恒/)
  })
})
