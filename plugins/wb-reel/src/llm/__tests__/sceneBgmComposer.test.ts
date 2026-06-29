import { describe, expect, it } from 'vitest'
import {
  composeSceneBgm,
  __test,
  type SceneBgmInput,
} from '../sceneBgmComposer'
import type { Scene, Scenario } from '../../scenario/types'
import type { TextClient } from '../types'

/*
 * sceneBgmComposer · 把 Scene → 影视级 BGM brief
 *
 * 测试覆盖契约:
 *   - llm=null -> heuristicFallback (永不抛, fallback=true)
 *   - validateAndNormalize 拒"突兀歌曲式" / 真人作曲家 / Hans Zimmer / [Verse] 段落标
 *   - validateAndNormalize 拒缺 BGM 纪律骨架 (no soft entry / no vocal pocket / no open tail)
 *   - composeUserPrompt 把 userHint 注入
 *   - heuristicFallback 在 userHint 非空时给 userHintMode=A, 空时给 'auto'
 */

const { validateAndNormalize, heuristicFallback, composeUserPrompt } = __test

// 一个"几乎无脑安全"的合规 brief, 用作合规基准 fixture
// 三类骨架都到位: opens (soft entry) + no vocals (pocket) + open-ended (tail)
// validateAndNormalize 还要求 brief 词数 ≥ 60, 这里凑到 ~70 词左右.
const SAFE_BRIEF = [
  'A quiet 72 BPM cinematic neo-noir instrumental piece with a slow swing feel.',
  'Instrumental with no vocals, sparse and airy throughout, leaving space for dialogue and city ambience.',
  'Opens from near silence with a single sustained pad as the night scene gradually unfolds across the rainy district.',
  'Featuring muted trumpet phrases answering upright bass walks beneath restrained brushed snare textures and warm tape hiss.',
  'Tail hovers on the pad alone, open-ended for cut, drifting without resolution into the next scene.',
].join(' ')

function safeFixture(over?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    brief: SAFE_BRIEF,
    moodTags: ['melancholic', 'introspective'],
    bpm: 72,
    genre: 'cinematic neo-noir',
    keyInstruments: ['muted trumpet', 'upright bass'],
    estDurationSec: 90,
    chineseSummary: '72 BPM 黑色电影底乐, 闷音小号 + 立式贝斯。',
    userHintMode: 'auto',
    ...(over ?? {}),
  }
}

function makeScene(over?: Partial<Scene>): Scene {
  return {
    id: 'sc1',
    title: '雨夜独行',
    durationMs: 12000,
    media: { kind: 'PLACEHOLDER' },
    dialogue: [],
    branches: [],
    background: '深夜旧城, 一个人撑伞走过霓虹街道',
    ...(over ?? {}),
  } as unknown as Scene
}

describe('validateAndNormalize · 合规基准', () => {
  it('safe fixture 通过', () => {
    const v = validateAndNormalize(safeFixture())
    expect(v).not.toBeNull()
    expect(v!.bpm).toBe(72)
    expect(v!.userHintMode).toBe('auto')
  })

  it('userHintMode 透传 A/B/C', () => {
    expect(validateAndNormalize(safeFixture({ userHintMode: 'A' }))!.userHintMode).toBe('A')
    expect(validateAndNormalize(safeFixture({ userHintMode: 'B' }))!.userHintMode).toBe('B')
    expect(validateAndNormalize(safeFixture({ userHintMode: 'C' }))!.userHintMode).toBe('C')
  })
})

describe('validateAndNormalize · 拒突兀歌曲式 / 侵权', () => {
  it('brief 含 [Verse] 段落标 -> 拒', () => {
    const bad = SAFE_BRIEF + ' [Verse] na na na'
    expect(validateAndNormalize(safeFixture({ brief: bad }))).toBeNull()
  })

  it('brief 含 [Chorus] -> 拒', () => {
    const bad = SAFE_BRIEF.replace('Tail hovers', '[Chorus] Tail hovers')
    expect(validateAndNormalize(safeFixture({ brief: bad }))).toBeNull()
  })

  it('brief 含真人作曲家名 (Hans Zimmer) -> 拒', () => {
    const bad = SAFE_BRIEF + ' Hans Zimmer style.'
    expect(validateAndNormalize(safeFixture({ brief: bad }))).toBeNull()
  })

  it('brief 含真实 OST 标题 (Inception) -> 拒', () => {
    const bad = SAFE_BRIEF + ' Sounds like Inception OST.'
    expect(validateAndNormalize(safeFixture({ brief: bad }))).toBeNull()
  })

  it('brief 含人声主导词 (vocal lead) -> 拒', () => {
    const bad = SAFE_BRIEF + ' Female vocal lead carries the melody.'
    expect(validateAndNormalize(safeFixture({ brief: bad }))).toBeNull()
  })
})

describe('validateAndNormalize · 拒 BGM 纪律缺失', () => {
  it('缺 soft entry 短语 -> 拒', () => {
    const bad =
      'A loud 72 BPM cinematic neo-noir instrumental piece. ' +
      'Instrumental with no vocals, sparse and airy, leaving space for dialogue. ' +
      'Slams in immediately with a hit on every beat. ' +
      'Featuring muted trumpet and upright bass answering between phrases. ' +
      'Tail hovers on the pad alone, open-ended for cut.'
    expect(validateAndNormalize(safeFixture({ brief: bad }))).toBeNull()
  })

  it('缺 open-ended tail 短语 -> 拒', () => {
    const bad =
      'A quiet 72 BPM cinematic neo-noir instrumental piece. ' +
      'Instrumental with no vocals, sparse and airy, leaving space for dialogue. ' +
      'Opens from near silence with a single sustained pad as the scene unfolds. ' +
      'Featuring muted trumpet and upright bass answering between phrases. ' +
      'Ends with a big climactic finale and full orchestra hit.'
    expect(validateAndNormalize(safeFixture({ brief: bad }))).toBeNull()
  })

  it('BPM 与 brief 内 "72 BPM" 不一致 -> 拒', () => {
    expect(validateAndNormalize(safeFixture({ bpm: 100 }))).toBeNull()
  })

  it('keyInstruments 含 brief 中没出现的乐器 -> 拒', () => {
    expect(
      validateAndNormalize(
        safeFixture({ keyInstruments: ['muted trumpet', 'sitar'] }),
      ),
    ).toBeNull()
  })

  it('keyInstruments 单词类 (drums) -> 拒', () => {
    // brief 含不含都拒, 因为单词无限定词违反"具体优先于宏大"
    const briefWithDrums = SAFE_BRIEF + ' Light drums.'
    expect(
      validateAndNormalize(
        safeFixture({ brief: briefWithDrums, keyInstruments: ['drums', 'muted trumpet'] }),
      ),
    ).toBeNull()
  })

  it('moodTags 全是空话词 (epic / massive) -> 拒', () => {
    expect(
      validateAndNormalize(safeFixture({ moodTags: ['epic', 'massive'] })),
    ).toBeNull()
  })

  it('chineseSummary 没有汉字 -> 拒', () => {
    expect(
      validateAndNormalize(safeFixture({ chineseSummary: 'no chinese chars here' })),
    ).toBeNull()
  })
})

describe('composeUserPrompt · userHint 优先级注入', () => {
  it('userHint 出现在 prompt 文本里 (优先级最高)', () => {
    const input: SceneBgmInput = {
      scenes: [makeScene()],
      userHint: '钢琴主导, 不要鼓',
    }
    const p = composeUserPrompt(input)
    expect(p).toContain('钢琴主导')
  })

  it('directorPersona / visualStyle 也出现在 prompt 中', () => {
    const input: SceneBgmInput = {
      scenes: [makeScene()],
      directorPersona: 'wong-karwai',
      visualStyle: 'photoreal',
    }
    const p = composeUserPrompt(input)
    expect(p).toContain('wong-karwai')
    expect(p).toContain('photoreal')
  })

  it('scenes background / title 都注入 prompt 上下文', () => {
    const input: SceneBgmInput = {
      scenes: [makeScene({ background: '霓虹巷子, 雨水反光' })],
    }
    const p = composeUserPrompt(input)
    expect(p).toContain('霓虹巷子')
  })
})

describe('heuristicFallback · 永远合 BGM 纪律', () => {
  it('userHint 空 -> userHintMode=auto, fallback=true', () => {
    const out = heuristicFallback({ scenes: [makeScene()] })
    expect(out.fallback).toBe(true)
    expect(out.userHintMode).toBe('auto')
    expect(out.brief).toMatch(/Opens from/) // soft entry
    expect(out.brief).toMatch(/no vocals/) // vocal pocket
    expect(out.brief).toMatch(/open-ended/) // open tail
    expect(out.brief).toMatch(/\d{2,3} BPM/)
  })

  it('userHint 非空 -> userHintMode=A', () => {
    const out = heuristicFallback({
      scenes: [makeScene()],
      userHint: '钢琴, 不要鼓',
    })
    expect(out.userHintMode).toBe('A')
    expect(out.fallback).toBe(true)
  })

  it('blob 含"战斗" -> 选史诗 underscore profile', () => {
    const out = heuristicFallback({
      scenes: [makeScene({ background: '巷战追逐爆炸' })],
    })
    expect(out.genre).toMatch(/orchestral epic underscore/i)
    expect(out.bpm).toBe(120)
  })

  it('blob 含"温情" -> 选 warm folk profile', () => {
    const out = heuristicFallback({
      scenes: [makeScene({ background: '一家人重聚拥抱', title: '久别重逢' })],
    })
    expect(out.genre).toMatch(/warm folk score/i)
    expect(out.bpm).toBeLessThan(100)
  })
})

describe('composeSceneBgm · 端到端', () => {
  it('llm=null -> 走 heuristicFallback', async () => {
    const scenario: Scenario = { id: 'scn-1', scenes: { sc1: makeScene() } } as unknown as Scenario
    const out = await composeSceneBgm(null, {
      scenes: [scenario.scenes.sc1!],
      scenario,
    })
    expect(out.fallback).toBe(true)
    expect(out.brief.length).toBeGreaterThan(40)
  })

  it('scenes 为空 -> 直接 heuristicFallback', async () => {
    const out = await composeSceneBgm({} as unknown as TextClient, { scenes: [] })
    expect(out.fallback).toBe(true)
  })

  it('LLM 返回非法 JSON -> 重试 1 次后兜底, 不抛', async () => {
    let calls = 0
    const llm: TextClient = {
      generate: async () => {
        calls++
        return 'not json'
      },
    } as unknown as TextClient
    const out = await composeSceneBgm(llm, { scenes: [makeScene()] })
    expect(out.fallback).toBe(true)
    expect(calls).toBe(2) // initial + 1 retry
  })

  it('LLM 返回合规 JSON -> 不走 fallback, 字段透传', async () => {
    const llm: TextClient = {
      generate: async () => JSON.stringify(safeFixture()),
    } as unknown as TextClient
    const out = await composeSceneBgm(llm, { scenes: [makeScene()] })
    expect(out.fallback).toBe(false)
    expect(out.bpm).toBe(72)
    expect(out.genre).toBe('cinematic neo-noir')
  })

  it('LLM 返回突兀歌曲式 (有 [Verse]) -> 兜底, 不抛', async () => {
    const llm: TextClient = {
      generate: async () =>
        JSON.stringify(safeFixture({ brief: SAFE_BRIEF + ' [Verse] na na' })),
    } as unknown as TextClient
    const out = await composeSceneBgm(llm, { scenes: [makeScene()] })
    expect(out.fallback).toBe(true)
  })
})
