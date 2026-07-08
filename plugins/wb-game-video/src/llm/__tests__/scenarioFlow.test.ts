import { describe, expect, it, vi } from 'vitest'
import {
  forgeOutlineFromIdea,
  forgeScriptFromOutline,
  runIdeaToScriptFlow,
  parseOutlineJSON,
  assembleScriptFromActs,
  type Outline,
} from '../scenarioFlow'
import type { TextClient, TextRequest } from '../types'

/**
 * scenarioFlow 单测 —— 分三层：
 *   A. parseOutlineJSON / assembleScriptFromActs：纯函数
 *   B. forgeOutlineFromIdea / forgeScriptFromOutline：单 LLM 调用 + mock
 *   C. runIdeaToScriptFlow：orchestrator，多阶段串联 + 中间 onStage 事件
 *
 * 目标：作者只读 test 就能一眼看懂"一句话是怎么一路变成剧本文本的"。
 */

function mockClient(replies: string[]): TextClient & { calls: TextRequest[] } {
  const m = {
    calls: [] as TextRequest[],
    generate: vi.fn(async (req: TextRequest) => {
      m.calls.push(req)
      const i = m.calls.length - 1
      if (i >= replies.length) {
        throw new Error(`mock 没有第 ${i + 1} 次 generate 的回复`)
      }
      return replies[i]
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-opus',
    getProviderName: () => 'mock',
  }
  return m as unknown as TextClient & { calls: TextRequest[] }
}

// ============================================================================
// A. parseOutlineJSON
// ============================================================================

describe('parseOutlineJSON', () => {
  const goodRaw = JSON.stringify({
    title: '雨夜归人',
    synopsis: '男人雨夜回到旧居，门后的人不只一个。',
    tone: '民国手绘 · 潮湿胶片',
    protagonist: '中年男人，灰风衣',
    acts: [
      { id: 'act_01', title: '门前', beat: '他到达旧居门口，听见里面有声音。' },
      { id: 'act_02', title: '门内', beat: '门开了，她站在昏黄灯下。' },
      { id: 'act_03', title: '抉择', beat: '他必须决定是否说出真相。' },
    ],
  })

  it('解析合法 outline 返回归一化对象', () => {
    const o = parseOutlineJSON(goodRaw)
    expect(o.title).toBe('雨夜归人')
    expect(o.acts).toHaveLength(3)
    expect(o.acts[0]!.id).toBe('act_01')
  })

  it('容错：markdown 代码块包住的 JSON 也能解析', () => {
    const wrapped = '```json\n' + goodRaw + '\n```'
    const o = parseOutlineJSON(wrapped)
    expect(o.title).toBe('雨夜归人')
  })

  it('缺少 acts 抛 [OUTLINE_EMPTY]', () => {
    expect(() => parseOutlineJSON(JSON.stringify({ title: 'x', acts: [] }))).toThrow(
      /OUTLINE_EMPTY/,
    )
  })

  it('完全无法解析抛 [OUTLINE_PARSE]', () => {
    expect(() => parseOutlineJSON('not json at all')).toThrow(/OUTLINE_PARSE/)
  })

  it('acts 缺 id 自动补', () => {
    const o = parseOutlineJSON(
      JSON.stringify({
        title: 't',
        acts: [{ title: '门前', beat: 'x' }, { title: '门内', beat: 'y' }],
      }),
    )
    expect(o.acts[0]!.id).toBeTruthy()
    expect(o.acts[1]!.id).toBeTruthy()
    expect(o.acts[0]!.id).not.toBe(o.acts[1]!.id)
  })

  // ── v3.10: characterAliases —————————————————————————————
  // outline-architect 现在会顺带吐出每位角色的称谓表, 给下游 entity-resolution
  // 用. parseOutlineJSON 应当**宽松接住但严格清洗**:
  //   - 老 outline 没这个字段 → 不抛、不出现 characterAliases
  //   - 新 outline 有 → 清洗后挂上去
  //   - 单个 alias 项无效 → 丢弃, 不污染整张表
  //   - 同 name 的项跨条出现 → 合并 + 去重

  it('alias: 老 outline 缺 characterAliases 不抛错, 输出对象不含该字段', () => {
    const o = parseOutlineJSON(goodRaw)
    expect(o.characterAliases).toBeUndefined()
  })

  it('alias: 合法 characterAliases 被解析并归一化', () => {
    const raw = JSON.stringify({
      title: '雨夜归人',
      synopsis: 's',
      tone: 't',
      protagonist: 'p',
      acts: [{ id: 'a1', title: '门前', beat: 'x' }],
      characterAliases: [
        { name: '林深', aliases: ['他', '中年男人', '撑伞的男人'] },
        { name: '她', aliases: ['屋里的女人', '她'] },
      ],
    })
    const o = parseOutlineJSON(raw)
    expect(o.characterAliases).toHaveLength(2)
    expect(o.characterAliases![0]!.name).toBe('林深')
    expect(o.characterAliases![0]!.aliases).toContain('他')
    expect(o.characterAliases![0]!.aliases).toContain('撑伞的男人')
  })

  it('alias: 单条无效（缺 name / aliases 全空）被静默丢弃, 不影响其他条', () => {
    const raw = JSON.stringify({
      title: 't',
      acts: [{ id: 'a1', title: 'x', beat: 'y' }],
      characterAliases: [
        { name: '林深', aliases: ['他', '中年男人'] },
        { name: '', aliases: ['空 name 应被丢弃'] },
        { name: '空 aliases', aliases: [] },
        { name: '全空', aliases: ['', '   '] },
      ],
    })
    const o = parseOutlineJSON(raw)
    expect(o.characterAliases).toHaveLength(1)
    expect(o.characterAliases![0]!.name).toBe('林深')
  })

  it('alias: 同 name 跨条出现的 aliases 被合并去重', () => {
    const raw = JSON.stringify({
      title: 't',
      acts: [{ id: 'a1', title: 'x', beat: 'y' }],
      characterAliases: [
        { name: '林深', aliases: ['他', '中年男人'] },
        { name: '林深', aliases: ['他', '撑伞的男人'] },
      ],
    })
    const o = parseOutlineJSON(raw)
    expect(o.characterAliases).toHaveLength(1)
    const aliases = o.characterAliases![0]!.aliases
    expect(aliases).toContain('他')
    expect(aliases).toContain('中年男人')
    expect(aliases).toContain('撑伞的男人')
    // 去重: '他' 只出现一次
    expect(aliases.filter((a) => a === '他')).toHaveLength(1)
  })

  it('alias: characterAliases 不是数组 / 是空数组 都不挂上字段', () => {
    const rawBadShape = JSON.stringify({
      title: 't',
      acts: [{ id: 'a1', title: 'x', beat: 'y' }],
      characterAliases: 'not an array',
    })
    const rawEmpty = JSON.stringify({
      title: 't',
      acts: [{ id: 'a1', title: 'x', beat: 'y' }],
      characterAliases: [],
    })
    expect(parseOutlineJSON(rawBadShape).characterAliases).toBeUndefined()
    expect(parseOutlineJSON(rawEmpty).characterAliases).toBeUndefined()
  })
})

// ============================================================================
// 拼剧本文本（纯函数）
// ============================================================================

describe('assembleScriptFromActs', () => {
  const outline: Outline = {
    title: '雨夜归人',
    synopsis: '男人雨夜回到旧居。',
    tone: '民国手绘',
    protagonist: '中年男人',
    acts: [
      { id: 'a1', title: '门前', beat: '他到达。' },
      { id: 'a2', title: '门内', beat: '她出现。' },
    ],
  }

  it('把各幕扩写文本按顺序拼成完整剧本，带幕标题', () => {
    const script = assembleScriptFromActs(outline, [
      '雨声敲打着屋檐，他站在门前良久。\n"还要再等一下吗？"他问自己。',
      '门开了。她站在昏黄灯下。\n"我以为你不会来了。"',
    ])
    expect(script).toContain('# 雨夜归人')
    expect(script).toContain('## 第一幕 · 门前')
    expect(script).toContain('## 第二幕 · 门内')
    expect(script).toContain('雨声敲打着屋檐')
    expect(script).toContain('"我以为你不会来了。"')
    expect(script.indexOf('第一幕')).toBeLessThan(script.indexOf('第二幕'))
  })

  it('act 文本数量不匹配时抛错（契约违反）', () => {
    expect(() => assembleScriptFromActs(outline, ['只有一段'])).toThrow(
      /mismatch/i,
    )
  })
})

// ============================================================================
// B. forgeOutlineFromIdea
// ============================================================================

describe('forgeOutlineFromIdea', () => {
  const goodOutline = JSON.stringify({
    title: '雨夜归人',
    synopsis: '男人雨夜回到旧居。',
    tone: '民国手绘',
    protagonist: '中年男人',
    acts: [
      { id: 'a1', title: '门前', beat: '他到达。' },
      { id: 'a2', title: '门内', beat: '她出现。' },
      { id: 'a3', title: '抉择', beat: '他必须选择。' },
    ],
  })

  it('用 outline-architect skill 作为 systemPrompt', async () => {
    const llm = mockClient([goodOutline])
    await forgeOutlineFromIdea(llm, { idea: '雨夜男人回到旧居' })
    expect(llm.calls[0]!.systemPrompt).toMatch(/outline|大纲/i)
    expect(llm.calls[0]!.userPrompt).toContain('雨夜男人回到旧居')
    expect(llm.calls[0]!.jsonMode).toBe(true)
  })

  it('temperature 偏高（≥ 0.7），鼓励发散', async () => {
    const llm = mockClient([goodOutline])
    await forgeOutlineFromIdea(llm, { idea: 'x' })
    expect(llm.calls[0]!.temperature ?? 0).toBeGreaterThanOrEqual(0.7)
  })

  // v3.9.10：作者反馈 gemini-3.1-pro-preview forced-thinking 把 2000 的
  //   output 预算全部花在 thinking 上，导致 parts 里没 text。这里把大纲
  //   的 maxTokens 契约提到 8192 —— 给 thinking 留足粮草。
  it('maxTokens 给 forced-thinking 留足预算（≥ 8192）', async () => {
    const llm = mockClient([goodOutline])
    await forgeOutlineFromIdea(llm, { idea: 'x' })
    expect(llm.calls[0]!.maxTokens).toBeGreaterThanOrEqual(8192)
  })

  it('产出归一化 Outline', async () => {
    const llm = mockClient([goodOutline])
    const res = await forgeOutlineFromIdea(llm, { idea: 'x' })
    expect(res.outline.title).toBe('雨夜归人')
    expect(res.outline.acts).toHaveLength(3)
  })
})

// ============================================================================
// B2. forgeScriptFromOutline —— 单幕扩写
// ============================================================================

describe('forgeScriptFromOutline', () => {
  const outline: Outline = {
    title: '雨夜归人',
    synopsis: '男人雨夜回到旧居。',
    tone: '民国手绘',
    protagonist: '中年男人',
    acts: [
      { id: 'a1', title: '门前', beat: '他到达。' },
      { id: 'a2', title: '门内', beat: '她出现。' },
    ],
  }

  it('为每幕发一次 LLM 调用并返回拼好的剧本文本', async () => {
    const llm = mockClient([
      '雨打檐角，他站在旧居门前。\n"还是敲吧。"',
      '门开了。她静静看着他。',
    ])
    const res = await forgeScriptFromOutline(llm, { outline })
    expect(llm.calls).toHaveLength(2)
    expect(res.script).toContain('# 雨夜归人')
    expect(res.script).toContain('雨打檐角')
    expect(res.script).toContain('她静静看着他')
    expect(res.perAct).toHaveLength(2)
  })

  it('每幕 prompt 包含当前幕 beat 和整体 synopsis', async () => {
    const llm = mockClient(['段1', '段2'])
    await forgeScriptFromOutline(llm, { outline })
    expect(llm.calls[0]!.userPrompt).toContain('他到达。')
    expect(llm.calls[0]!.userPrompt).toContain('雨夜回到旧居')
    expect(llm.calls[1]!.userPrompt).toContain('她出现。')
  })

  it('每幕报 stage 进度', async () => {
    const llm = mockClient(['段1', '段2'])
    const stages: string[] = []
    await forgeScriptFromOutline(llm, {
      outline,
      onStage: (label) => stages.push(label),
    })
    expect(stages.join('|')).toMatch(/第一幕.*第二幕/)
  })

  it('可指定 only：只扩写某一幕（用于 reroll）', async () => {
    const llm = mockClient(['只重写了第 2 幕'])
    const res = await forgeScriptFromOutline(llm, {
      outline,
      only: 'a2',
      existing: ['原第一幕', '旧第二幕'],
    })
    expect(llm.calls).toHaveLength(1)
    expect(res.perAct).toEqual(['原第一幕', '只重写了第 2 幕'])
  })
})

// ============================================================================
// C. orchestrator：runIdeaToScriptFlow —— A → B 全链路
// ============================================================================

describe('runIdeaToScriptFlow', () => {
  const outlineReply = JSON.stringify({
    title: '雨夜归人',
    synopsis: '男人雨夜回到旧居。',
    tone: '民国手绘',
    protagonist: '中年男人',
    acts: [
      { id: 'a1', title: '门前', beat: '他到达。' },
      { id: 'a2', title: '门内', beat: '她出现。' },
    ],
  })

  it('按顺序调 1 次 outline + N 次 act 扩写，最后产出完整 script 文本', async () => {
    const llm = mockClient([outlineReply, '第一幕文本。', '第二幕文本。'])
    const res = await runIdeaToScriptFlow(llm, { idea: '雨夜男人' })

    expect(llm.calls).toHaveLength(3)
    expect(res.outline.acts).toHaveLength(2)
    expect(res.script).toContain('# 雨夜归人')
    expect(res.script).toContain('第一幕文本')
    expect(res.script).toContain('第二幕文本')
  })

  it('发射阶段事件：outline.start / outline.done / act[0..N].start / act[0..N].done / all.done', async () => {
    const llm = mockClient([outlineReply, '段1', '段2'])
    const events: string[] = []
    await runIdeaToScriptFlow(llm, {
      idea: 'x',
      onEvent: (ev) => events.push(ev.kind),
    })
    expect(events[0]).toBe('outline.start')
    expect(events).toContain('outline.done')
    expect(events.filter((e) => e === 'act.start')).toHaveLength(2)
    expect(events.filter((e) => e === 'act.done')).toHaveLength(2)
    expect(events[events.length - 1]).toBe('all.done')
  })

  it('outline 阶段失败时不进扩写阶段', async () => {
    const llm = mockClient(['this is not json'])
    await expect(runIdeaToScriptFlow(llm, { idea: 'x' })).rejects.toThrow(
      /OUTLINE_PARSE/,
    )
    expect(llm.calls).toHaveLength(1)
  })
})
