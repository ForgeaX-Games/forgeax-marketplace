import { describe, expect, it, vi } from 'vitest'
import { forgeProseToBeats, parseProseBeatsJSON } from '../promptForge'
import { SKILLS } from '../skills'
import type { TextClient, TextRequest } from '../types'

/**
 * forgeProseToBeats 契约测试
 *
 * 关心的是"调用 LLM 时塞了什么"和"输出怎么校验"，
 * 不关心模型生成质量（那是 LLM 自己的事）。
 *
 * 断言：
 *   1. systemPrompt = proseToBeats skill（不能错喂别的 skill）
 *   2. userPrompt 里包含原文（三引号包围）+ "忠于原文" 措辞
 *   3. userPrompt 里包含 hints（如果传了的话）
 *   4. temperature 低（≤ 0.4）；jsonMode = true
 *   5. parseProseBeatsJSON 在数量越界 / 全空 quote 时抛错
 */

function mockClient(reply: string): TextClient & { lastReq: TextRequest | null } {
  const m = {
    lastReq: null as TextRequest | null,
    generate: vi.fn(async (req: TextRequest) => {
      m.lastReq = req
      return reply
    }),
    ping: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
    getModel: () => 'mock-opus',
    getProviderName: () => 'mock',
  }
  return m as unknown as TextClient & { lastReq: TextRequest | null }
}

const SAMPLE_PROSE = `雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟，灰风衣下摆被风掀起。
左眼那道疤在门灯的昏黄里显得比平时更深。屋里隐约传来笑声——一个男人的声音。
他的手停在门环上。

灯泡挂得低，琥珀色的光打在阿芸的旗袍肩线上。她正往茶杯里添第三块糖，
手指停了一下——她听见了什么。"爸，外面好像有人。"
老人喝着茶没抬头："这种雨天……"

客厅深处的老钟敲了三下。林深垂下眼，喉结动了一下，终于开口。
他没有解释，只说了一句："对不起，我回来晚了三年。"`

/** 一份 LLM 可能返回的合法 beats JSON */
const VALID_BEATS_REPLY = JSON.stringify({
  title: '雨夜归人',
  synopsis: '林深雨夜回到旧居门前，听见屋内有男声犹豫不决，门开后才发现是阿芸的父亲，他终于说出迟到三年的道歉。',
  tone: '民国手绘字幕 · 潮湿胶片噪点 · 冷暖对比',
  protagonist: '林深，中年男人，灰风衣，左眼疤痕；三年后回到旧居，沉默寡言。',
  beats: [
    {
      id: 'beat_01',
      title: '门前',
      beat: '林深在雨夜到达旧居门口，听见屋内有男声——他从未想过她身边会有别人，手停在门环上。',
      quote: '雨水顺着檐角滴答砸在青石板上。林深站在门前已经五分钟……他的手停在门环上。',
    },
    {
      id: 'beat_02',
      title: '门内',
      beat: '门开了，阿芸站在昏黄灯下，屋里另一个男人是她的父亲——他多年的怀疑在三秒内崩塌。',
      quote: '灯泡挂得低，琥珀色的光打在阿芸的旗袍肩线上……老人喝着茶没抬头：「这种雨天……」',
    },
    {
      id: 'beat_03',
      title: '钟声',
      beat: '老钟敲了三下，林深说出迟到三年的道歉——这一句话他憋了太久。',
      quote: '客厅深处的老钟敲了三下……他没有解释，只说了一句：「对不起，我回来晚了三年。」',
    },
  ],
})

describe('forgeProseToBeats · 契约测试', () => {
  it('喂的是 proseToBeats skill，且原文被三引号包住', async () => {
    const client = mockClient(VALID_BEATS_REPLY)
    await forgeProseToBeats(client, { prose: SAMPLE_PROSE })

    expect(client.lastReq).not.toBeNull()
    expect(client.lastReq?.systemPrompt).toBe(SKILLS.proseToBeats)
    expect(client.lastReq?.userPrompt).toContain('"""')
    expect(client.lastReq?.userPrompt).toContain(SAMPLE_PROSE)
  })

  it('userPrompt 里强调"忠于原文"的铁律措辞', async () => {
    const client = mockClient(VALID_BEATS_REPLY)
    await forgeProseToBeats(client, { prose: SAMPLE_PROSE })
    const u = client.lastReq?.userPrompt ?? ''
    expect(u).toContain('不创作')
    expect(u).toMatch(/quote|原文/)
  })

  it('hints 有值时塞到 userPrompt（kind + reasons）', async () => {
    const client = mockClient(VALID_BEATS_REPLY)
    await forgeProseToBeats(client, {
      prose: SAMPLE_PROSE,
      hints: {
        kind: 'prose-novel',
        reasons: ['段落多但缺标题', '对白少'],
      },
    })
    const u = client.lastReq?.userPrompt ?? ''
    expect(u).toContain('prose-novel')
    expect(u).toContain('段落多但缺标题')
    expect(u).toContain('对白少')
  })

  it('hints 缺省也能跑（不抛错）', async () => {
    const client = mockClient(VALID_BEATS_REPLY)
    const res = await forgeProseToBeats(client, { prose: SAMPLE_PROSE })
    expect(res.beats.beats.length).toBeGreaterThanOrEqual(3)
  })

  it('温度低（≤ 0.4）以减少模型发挥', async () => {
    const client = mockClient(VALID_BEATS_REPLY)
    await forgeProseToBeats(client, { prose: SAMPLE_PROSE })
    expect(client.lastReq?.temperature).toBeLessThanOrEqual(0.4)
  })

  it('jsonMode 必须是 true（输出是 JSON）', async () => {
    const client = mockClient(VALID_BEATS_REPLY)
    await forgeProseToBeats(client, { prose: SAMPLE_PROSE })
    expect(client.lastReq?.jsonMode).toBe(true)
  })

  it('解析合法 reply 得到 beats 数组（id/title/beat/quote 完整）', async () => {
    const client = mockClient(VALID_BEATS_REPLY)
    const res = await forgeProseToBeats(client, { prose: SAMPLE_PROSE })
    expect(res.beats.title).toBe('雨夜归人')
    expect(res.beats.beats.length).toBe(3)
    expect(res.beats.beats[0]?.id).toBe('beat_01')
    expect(res.beats.beats[0]?.quote.length).toBeGreaterThan(0)
    expect(res.beats.beats[2]?.title).toBe('钟声')
  })

  it('空输入直接抛错（防止白调一次 LLM）', async () => {
    const client = mockClient('xx')
    await expect(forgeProseToBeats(client, { prose: '   ' })).rejects.toThrow(/BEATS/)
    expect((client.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })
})

describe('parseProseBeatsJSON · 解析守门', () => {
  it('剥掉 ```json ... ``` 围栏后再解析', () => {
    const raw = '```json\n' + VALID_BEATS_REPLY + '\n```'
    const beats = parseProseBeatsJSON(raw)
    expect(beats.beats.length).toBe(3)
  })

  it('beats 数 < 3 时抛 [BEATS_COUNT]', () => {
    const tooFew = JSON.stringify({
      title: 'x', synopsis: 'x', tone: 'x', protagonist: 'x',
      beats: [
        { id: 'beat_01', title: 'a', beat: 'aaa', quote: 'qqq' },
        { id: 'beat_02', title: 'b', beat: 'bbb', quote: 'qqq' },
      ],
    })
    expect(() => parseProseBeatsJSON(tooFew)).toThrow(/BEATS_COUNT/)
  })

  it('beats 数 > 6 时抛 [BEATS_COUNT]', () => {
    const tooMany = JSON.stringify({
      title: 'x', synopsis: 'x', tone: 'x', protagonist: 'x',
      beats: Array.from({ length: 7 }, (_, i) => ({
        id: `beat_0${i + 1}`,
        title: `t${i}`,
        beat: 'aaaa',
        quote: 'qqq',
      })),
    })
    expect(() => parseProseBeatsJSON(tooMany)).toThrow(/BEATS_COUNT/)
  })

  it('全部 beat 的 quote 都为空时抛 [BEATS_NO_QUOTE]', () => {
    const noQuote = JSON.stringify({
      title: 'x', synopsis: 'x', tone: 'x', protagonist: 'x',
      beats: [
        { id: 'beat_01', title: 'a', beat: 'aa', quote: '' },
        { id: 'beat_02', title: 'b', beat: 'bb', quote: '' },
        { id: 'beat_03', title: 'c', beat: 'cc', quote: '' },
      ],
    })
    expect(() => parseProseBeatsJSON(noQuote)).toThrow(/BEATS_NO_QUOTE/)
  })

  it('部分 beat 缺 quote 不抛（只要有一个非空就放过）', () => {
    const partial = JSON.stringify({
      title: 'x', synopsis: 'x', tone: 'x', protagonist: 'x',
      beats: [
        { id: 'beat_01', title: 'a', beat: 'aa', quote: '原文片段' },
        { id: 'beat_02', title: 'b', beat: 'bb', quote: '' },
        { id: 'beat_03', title: 'c', beat: 'cc', quote: '' },
      ],
    })
    const beats = parseProseBeatsJSON(partial)
    expect(beats.beats.length).toBe(3)
    expect(beats.beats[0]?.quote).toBe('原文片段')
  })

  it('id 缺失时自动按下标补（beat_01, beat_02, ...）', () => {
    const noIds = JSON.stringify({
      title: 'x', synopsis: 'x', tone: 'x', protagonist: 'x',
      beats: [
        { title: 'a', beat: 'aa', quote: 'q' },
        { title: 'b', beat: 'bb', quote: 'q' },
        { title: 'c', beat: 'cc', quote: 'q' },
      ],
    })
    const beats = parseProseBeatsJSON(noIds)
    expect(beats.beats[0]?.id).toBe('beat_01')
    expect(beats.beats[1]?.id).toBe('beat_02')
    expect(beats.beats[2]?.id).toBe('beat_03')
  })

  it('tone / protagonist 缺失时填 "原文未明示" 默认值', () => {
    const noToneProt = JSON.stringify({
      title: '故事',
      synopsis: '梗概',
      beats: [
        { id: 'beat_01', title: 'a', beat: 'aa', quote: 'q' },
        { id: 'beat_02', title: 'b', beat: 'bb', quote: 'q' },
        { id: 'beat_03', title: 'c', beat: 'cc', quote: 'q' },
      ],
    })
    const beats = parseProseBeatsJSON(noToneProt)
    expect(beats.tone).toBe('原文未明示')
    expect(beats.protagonist).toBe('原文未明示')
  })

  it('JSON 完全无法解析时抛 [BEATS_PARSE]', () => {
    expect(() => parseProseBeatsJSON('this is not json at all')).toThrow(
      /BEATS_PARSE/,
    )
  })
})
