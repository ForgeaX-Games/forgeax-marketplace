import { describe, expect, it, vi } from 'vitest'
import {
  forgeScriptIndex,
  parseScriptIndexJSON,
  forgeProseToBeatsForChunk,
  parseChunkBeatsJSON,
  forgeProseToBeatsChunked,
  mergeBeatsAcrossChunks,
  quoteOverlapRatio,
  type ScriptIndex,
  type ChunkBeatsResult,
} from '../proseToBeatsChunked'
import { SKILLS } from '../skills'
import { planChunks } from '../../io/chunkPlanner'
import type { TextClient, TextRequest } from '../types'
import type { Chunk } from '../../io/chunkPlanner'

/**
 * proseToBeatsChunked 契约测试
 *
 * 关心点：
 *   1. forgeScriptIndex / forgeProseToBeatsForChunk 的 LLM 调用形态（system / user / temp / jsonMode）
 *   2. parser 的容错（少字段、字段错类型、计数越界）
 *   3. mergeBeatsAcrossChunks 的全文偏移还原 + 跨段去重 + 新角色收编
 *   4. 顶层 forgeProseToBeatsChunked 在部分 chunk 失败时仍返回部分结果
 */

interface MockClient extends TextClient {
  reqs: TextRequest[]
  setReplies(replies: string[]): void
}

function mockClient(replies: string[]): MockClient {
  let cursor = 0
  const reqs: TextRequest[] = []
  const m = {
    reqs,
    setReplies(next: string[]) {
      replies = next
      cursor = 0
    },
    generate: vi.fn(async (req: TextRequest) => {
      reqs.push(req)
      const r = replies[cursor++] ?? ''
      // 模拟错误回复：以 ERR: 开头的把它抛成 Error
      if (r.startsWith('ERR:')) throw new Error(r.slice(4))
      return r
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-text',
    getProviderName: () => 'mock',
  }
  return m as unknown as MockClient
}

const SAMPLE_INDEX_REPLY = JSON.stringify({
  title: '雨夜归人',
  logline: '中年男人雨夜回到旧居寻她，却在门外听见另一个男声，他必须迈过自己的怀疑才能推开那扇门。',
  tone: '民国手绘字幕 · 潮湿胶片噪点 · 冷暖对比',
  timelineKind: 'linear',
  characters: [
    {
      id: 'lin_shen',
      displayName: '林深',
      aliases: ['他', '中年男人'],
      anchor: '中年男人，灰风衣，左眼疤痕，沉默寡言',
    },
    {
      id: 'a_yun',
      displayName: '阿芸',
      aliases: ['她'],
      anchor: '琥珀色旗袍，灯下身影瘦削',
    },
  ],
  scenes: [
    {
      id: 'old_courtyard_gate',
      displayName: '旧居门外',
      anchor: '雨夜青石板，门环旁灯笼',
    },
    {
      id: 'old_courtyard_inside',
      displayName: '旧居堂屋',
      anchor: '琥珀灯下旧木桌，墙上老钟',
    },
  ],
})

describe('parseScriptIndexJSON', () => {
  it('解析合法 JSON', () => {
    const idx = parseScriptIndexJSON(SAMPLE_INDEX_REPLY)
    expect(idx.title).toBe('雨夜归人')
    expect(idx.timelineKind).toBe('linear')
    expect(idx.characters).toHaveLength(2)
    expect(idx.characters[0]!.id).toBe('lin_shen')
    expect(idx.characters[0]!.aliases).toContain('他')
    expect(idx.scenes).toHaveLength(2)
  })

  it('剥 ```json 围栏', () => {
    const wrapped = '```json\n' + SAMPLE_INDEX_REPLY + '\n```'
    const idx = parseScriptIndexJSON(wrapped)
    expect(idx.title).toBe('雨夜归人')
  })

  it('characters / scenes 全空 → INDEX_EMPTY', () => {
    const empty = JSON.stringify({
      title: '空',
      logline: '',
      tone: '',
      timelineKind: 'linear',
      characters: [],
      scenes: [],
    })
    expect(() => parseScriptIndexJSON(empty)).toThrowError(/INDEX_EMPTY/)
  })

  it('完全坏的 JSON → INDEX_PARSE', () => {
    expect(() => parseScriptIndexJSON('not json at all')).toThrowError(
      /INDEX_PARSE/,
    )
  })

  it('未知 timelineKind 回退 linear', () => {
    const odd = JSON.stringify({
      title: 'x',
      logline: 'x',
      tone: 'x',
      timelineKind: 'wibble',
      characters: [{ id: 'a', displayName: 'a', aliases: [], anchor: 'a' }],
      scenes: [{ id: 'b', displayName: 'b', anchor: 'b' }],
    })
    expect(parseScriptIndexJSON(odd).timelineKind).toBe('linear')
  })

  it('字段缺失走兜底名字', () => {
    const partial = JSON.stringify({
      characters: [{}],
      scenes: [{}],
    })
    const idx = parseScriptIndexJSON(partial)
    expect(idx.title).toBe('未命名')
    expect(idx.characters[0]!.id).toBe('char_1')
    expect(idx.scenes[0]!.id).toBe('scene_1')
  })
})

describe('forgeScriptIndex', () => {
  it('systemPrompt = scriptIndexScanner skill；temperature 低；jsonMode 开', async () => {
    const llm = mockClient([SAMPLE_INDEX_REPLY])
    await forgeScriptIndex(llm, { fullText: '一段长文本' })
    expect(llm.reqs).toHaveLength(1)
    const req = llm.reqs[0]!
    expect(req.systemPrompt).toBe(SKILLS.scriptIndexScanner)
    expect(req.userPrompt).toContain('一段长文本')
    expect(req.temperature).toBeLessThanOrEqual(0.4)
    expect(req.jsonMode).toBe(true)
  })

  it('空原文抛 [INDEX]', async () => {
    const llm = mockClient([])
    await expect(forgeScriptIndex(llm, { fullText: '   ' })).rejects.toThrow(
      /\[INDEX\]/,
    )
  })
})

// ============================================================================
// Pass 2 · chunk beats
// ============================================================================

const FAKE_INDEX: ScriptIndex = {
  title: '雨夜归人',
  logline: 'logline',
  tone: 'tone',
  timelineKind: 'linear',
  characters: [
    { id: 'lin_shen', displayName: '林深', aliases: ['他'], anchor: 'a' },
    { id: 'a_yun', displayName: '阿芸', aliases: ['她'], anchor: 'b' },
  ],
  scenes: [
    { id: 'old_courtyard_gate', displayName: '旧居门外', anchor: 'c' },
    { id: 'old_courtyard_inside', displayName: '旧居堂屋', anchor: 'd' },
  ],
}

function fakeChunk(
  index: number,
  text: string,
  charStart: number,
  headingPath: string[] = [],
): Chunk {
  return {
    index,
    charStart,
    charEnd: charStart + text.length,
    text,
    headingPath,
    charCount: Array.from(text).length,
  }
}

const SAMPLE_CHUNK_REPLY = JSON.stringify({
  chunkIndex: 0,
  beats: [
    {
      id: 'ch00_beat_01',
      title: '门前',
      beat: '林深在雨夜到达旧居门口，听见屋内有男声——他从未想过阿芸身边会有别人。',
      quote: '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。',
      quoteOffset: 0,
      characterIds: ['lin_shen'],
      sceneId: 'old_courtyard_gate',
    },
  ],
  newCharacters: [],
  newScenes: [],
})

describe('parseChunkBeatsJSON', () => {
  it('解析合法 chunk beats JSON', () => {
    const chunk = fakeChunk(0, '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。', 0)
    const r = parseChunkBeatsJSON(SAMPLE_CHUNK_REPLY, chunk)
    expect(r.chunkIndex).toBe(0)
    expect(r.beats).toHaveLength(1)
    expect(r.beats[0]!.characterIds).toEqual(['lin_shen'])
    expect(r.beats[0]!.sceneId).toBe('old_courtyard_gate')
    expect(r.beats[0]!.quoteOffset).toBe(0)
  })

  it('beats 为空 → BEATS_CHUNK_EMPTY', () => {
    const chunk = fakeChunk(1, '...', 100)
    const empty = JSON.stringify({ chunkIndex: 1, beats: [] })
    expect(() => parseChunkBeatsJSON(empty, chunk)).toThrowError(
      /BEATS_CHUNK_EMPTY/,
    )
  })

  it('beats > 4 时静默截断到 4', () => {
    const chunk = fakeChunk(2, 'x', 0)
    const tooMany = JSON.stringify({
      chunkIndex: 2,
      beats: Array.from({ length: 8 }).map((_, i) => ({
        id: `b_${i}`,
        title: 't',
        beat: 'b',
        quote: 'q',
        quoteOffset: 0,
        characterIds: [],
        sceneId: '',
      })),
    })
    const r = parseChunkBeatsJSON(tooMany, chunk)
    expect(r.beats).toHaveLength(4)
  })

  it('坏 JSON 带 chunkIndex 在错误信息里', () => {
    const chunk = fakeChunk(7, 'x', 0)
    expect(() => parseChunkBeatsJSON('not json', chunk)).toThrowError(
      /BEATS_CHUNK_PARSE.*chunk #7/,
    )
  })
})

describe('forgeProseToBeatsForChunk', () => {
  it('user prompt 含 <global-index> / <chunk-text> / chunkIndex', async () => {
    const llm = mockClient([SAMPLE_CHUNK_REPLY])
    const chunk = fakeChunk(
      0,
      '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。',
      0,
      ['第一幕：雨夜'],
    )
    await forgeProseToBeatsForChunk(llm, { chunk, index: FAKE_INDEX })
    const req = llm.reqs[0]!
    expect(req.systemPrompt).toBe(SKILLS.proseToBeatsChunked)
    expect(req.userPrompt).toContain('<global-index>')
    expect(req.userPrompt).toContain('<chunk-text>')
    expect(req.userPrompt).toContain('chunkIndex = 0')
    expect(req.userPrompt).toContain('第一幕：雨夜')
    expect(req.userPrompt).toContain('lin_shen')
    expect(req.temperature).toBeLessThanOrEqual(0.4)
    expect(req.jsonMode).toBe(true)
  })
})

// ============================================================================
// quoteOverlapRatio + mergeBeatsAcrossChunks
// ============================================================================

describe('quoteOverlapRatio', () => {
  it('完全相同返回 1', () => {
    expect(quoteOverlapRatio('林深站在门前', '林深站在门前')).toBe(1)
  })

  it('完全无关返回 0 或极低', () => {
    expect(quoteOverlapRatio('林深站在门前', '苹果香蕉橙子')).toBeLessThan(0.2)
  })

  it('部分重叠 ≥ 60% 时被识别', () => {
    const a = '林深站在门前已经五分钟，雨水顺着檐角滴答'
    const b = '林深站在门前已经五分钟，雨水顺着'
    expect(quoteOverlapRatio(a, b)).toBeGreaterThanOrEqual(0.6)
  })

  it('空字符串返 0', () => {
    expect(quoteOverlapRatio('', 'x')).toBe(0)
    expect(quoteOverlapRatio('x', '')).toBe(0)
  })
})

describe('mergeBeatsAcrossChunks', () => {
  function buildChunkResults(): {
    chunks: Chunk[]
    chunkResults: ChunkBeatsResult[]
  } {
    const chunks = [
      fakeChunk(0, '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。', 0),
      fakeChunk(
        1,
        // 故意与 chunk 0 的 quote 整段重合，确保 LCS / min(len) ≥ 0.6
        '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。他的手停在门环上。',
        100,
      ),
      fakeChunk(2, '客厅深处的老钟敲了三下。', 200),
    ]
    const chunkResults: ChunkBeatsResult[] = [
      {
        chunkIndex: 0,
        beats: [
          {
            id: 'ch00_beat_01',
            chunkIndex: 0,
            title: '门前',
            beat: '林深在雨夜到达门口',
            quote: '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。',
            quoteOffset: 0,
            globalCharStart: 0,
            characterIds: ['lin_shen'],
            sceneId: 'old_courtyard_gate',
          },
        ],
        newCharacters: [],
        newScenes: [],
      },
      {
        chunkIndex: 1,
        beats: [
          {
            // 故意与 ch0 quote 高度重叠 → 应被去重
            id: 'ch01_beat_01',
            chunkIndex: 1,
            title: '门前',
            beat: '同一拍重复',
            quote:
              '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。他的手停在门环上。',
            quoteOffset: 0,
            globalCharStart: 0,
            characterIds: ['lin_shen', 'a_yun'],
            sceneId: 'old_courtyard_gate',
          },
        ],
        newCharacters: [],
        newScenes: [],
      },
      {
        chunkIndex: 2,
        beats: [
          {
            id: 'ch02_beat_01',
            chunkIndex: 2,
            title: '钟声',
            beat: '老钟三下，林深开口',
            quote: '客厅深处的老钟敲了三下。',
            quoteOffset: 0,
            globalCharStart: 0,
            characterIds: ['lin_shen'],
            sceneId: 'old_courtyard_inside',
          },
        ],
        newCharacters: [
          {
            id: 'father_su',
            displayName: '苏父',
            aliases: ['老人'],
            anchor: '老茶客，端着粗陶茶杯',
          },
        ],
        newScenes: [],
      },
    ]
    return { chunks, chunkResults }
  }

  it('还原 globalCharStart 为 chunk.charStart + quoteOffset', () => {
    const { chunks, chunkResults } = buildChunkResults()
    const out = mergeBeatsAcrossChunks(chunkResults, FAKE_INDEX, chunks)
    // 第三个 beat（chunk #2）→ globalCharStart = 200 + 0 = 200
    const ch2 = out.beats.find((b) => b.id === 'ch02_beat_01')!
    expect(ch2.globalCharStart).toBe(200)
  })

  it('跨段重叠 ≥ 60% 的 beats 被合并（保前者，characterIds 取并集）', () => {
    const { chunks, chunkResults } = buildChunkResults()
    const out = mergeBeatsAcrossChunks(chunkResults, FAKE_INDEX, chunks)
    const ids = out.beats.map((b) => b.id)
    expect(ids).toContain('ch00_beat_01')
    expect(ids).not.toContain('ch01_beat_01') // 被合并掉
    const merged = out.beats.find((b) => b.id === 'ch00_beat_01')!
    expect(merged.characterIds).toContain('lin_shen')
    expect(merged.characterIds).toContain('a_yun') // 来自 ch01 beat
  })

  it('beats 按 globalCharStart 递增排序', () => {
    const { chunks, chunkResults } = buildChunkResults()
    const out = mergeBeatsAcrossChunks(chunkResults, FAKE_INDEX, chunks)
    for (let i = 1; i < out.beats.length; i++) {
      expect(out.beats[i]!.globalCharStart).toBeGreaterThanOrEqual(
        out.beats[i - 1]!.globalCharStart,
      )
    }
  })

  it('newCharacters 被收编进 enrichedIndex 且不与已有 id 冲突', () => {
    const { chunks, chunkResults } = buildChunkResults()
    const out = mergeBeatsAcrossChunks(chunkResults, FAKE_INDEX, chunks)
    expect(out.mergedCharacters.map((c) => c.id)).toContain('father_su')
    expect(out.index.characters.map((c) => c.id)).toContain('father_su')
    expect(out.index.characters.map((c) => c.id)).toContain('lin_shen') // 原有保留
  })

  it('同一 newCharacter id 在多段重复出现，只收编一次', () => {
    const { chunks, chunkResults } = buildChunkResults()
    chunkResults[0]!.newCharacters.push({
      id: 'father_su',
      displayName: '苏父',
      aliases: [],
      anchor: 'duplicated',
    })
    const out = mergeBeatsAcrossChunks(chunkResults, FAKE_INDEX, chunks)
    const fatherCount = out.index.characters.filter(
      (c) => c.id === 'father_su',
    ).length
    expect(fatherCount).toBe(1)
  })
})

// ============================================================================
// orchestrator
// ============================================================================

describe('forgeProseToBeatsChunked', () => {
  function makeChunkReply(chunkIndex: number, quote: string): string {
    return JSON.stringify({
      chunkIndex,
      beats: [
        {
          id: `ch${String(chunkIndex).padStart(2, '0')}_beat_01`,
          title: '一拍',
          beat: '一拍发生的事',
          quote,
          quoteOffset: 0,
          characterIds: ['lin_shen'],
          sceneId: 'old_courtyard_gate',
        },
      ],
      newCharacters: [],
      newScenes: [],
    })
  }

  it('Pass 1 + Pass 2 串联跑通；onIndexReady / onChunkDone 触发', async () => {
    // 用真 chunkPlanner 切：足够长以触发分段
    const longProse =
      '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。'.repeat(500)
    const plan = planChunks(longProse)
    expect(plan.chunked).toBe(true)
    expect(plan.chunks.length).toBeGreaterThan(1)

    // 第 1 个回复是索引；后面每个 chunk 各一个回复
    const replies = [SAMPLE_INDEX_REPLY]
    for (const ch of plan.chunks) {
      replies.push(makeChunkReply(ch.index, ch.text.slice(0, 40)))
    }
    const llm = mockClient(replies)

    const onIndexReady = vi.fn()
    const onChunkDone = vi.fn()

    const result = await forgeProseToBeatsChunked(llm, {
      fullText: longProse,
      chunks: plan.chunks,
      onIndexReady,
      onChunkDone,
    })

    expect(onIndexReady).toHaveBeenCalledTimes(1)
    expect(onChunkDone).toHaveBeenCalledTimes(plan.chunks.length)
    // 每段都成功了（failures 为空）；至于 beats 数量，因为本测试故意让所有 chunk 的 quote 都重复同一句，
    // mergeBeatsAcrossChunks 会做高重叠去重 → 最少 1 条。这里只断言"非空 + 上限 = chunk 数"。
    expect(result.beats.length).toBeGreaterThanOrEqual(1)
    expect(result.beats.length).toBeLessThanOrEqual(plan.chunks.length)
    expect(result.failures).toHaveLength(0)
    expect(result.index.characters.map((c) => c.id)).toContain('lin_shen')
  })

  it('部分 chunk 失败时仍返回成功部分；failures 列表带 chunkIndex', async () => {
    // 故意用短一点 + 两段 chunk
    const longProse =
      '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟。'.repeat(500)
    const plan = planChunks(longProse)
    const replies: string[] = [SAMPLE_INDEX_REPLY]
    for (let i = 0; i < plan.chunks.length; i++) {
      // 偶数 chunk 成功，奇数失败
      replies.push(
        i % 2 === 0
          ? makeChunkReply(plan.chunks[i]!.index, plan.chunks[i]!.text.slice(0, 30))
          : 'ERR:LLM 模拟超时',
      )
    }
    const llm = mockClient(replies)

    const result = await forgeProseToBeatsChunked(llm, {
      fullText: longProse,
      chunks: plan.chunks,
    })

    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.beats.length).toBeLessThan(plan.chunks.length)
    // 任何 failure 必带 chunkIndex
    for (const f of result.failures) {
      expect(typeof f.chunkIndex).toBe('number')
      expect(f.reason.length).toBeGreaterThan(0)
    }
  })

  it('全部 chunk 都失败时抛 [CHUNKED_EMPTY]', async () => {
    const longProse = '雨水滴答。林深站在门前。'.repeat(800)
    const plan = planChunks(longProse)
    const replies: string[] = [SAMPLE_INDEX_REPLY]
    for (let i = 0; i < plan.chunks.length; i++) {
      replies.push('ERR:模拟全军覆没')
    }
    const llm = mockClient(replies)
    await expect(
      forgeProseToBeatsChunked(llm, {
        fullText: longProse,
        chunks: plan.chunks,
      }),
    ).rejects.toThrow(/CHUNKED_EMPTY/)
  })
})

