import { describe, expect, it } from 'vitest'
import { deriveSubtitleView, pickActiveLine } from '../subtitleSelect'
import type { DialogueLine } from '../../scenario/types'

/**
 * 字幕显示契约 ——
 *
 * 真实 bug 现场：用户反馈"场景描述（旁白）不显示，只显示台词"。
 * 这层测试钉死电影字幕的几个不变量：
 *   - narration 也是字幕的一部分（不渲染说话人但渲染文字）
 *   - 一时只显示一句
 *   - 重叠时最新覆盖最旧
 *   - endMs 之后字幕消失
 */

const D = (over: Partial<DialogueLine>): DialogueLine => ({
  id: 'd',
  role: 'narration',
  text: '...',
  startMs: 0,
  ...over,
})

describe('pickActiveLine', () => {
  it('elapsed=0 时如果有 startMs=0 的台词，取它', () => {
    const lines = [D({ id: 'a', startMs: 0, text: '一开始' })]
    expect(pickActiveLine(lines, 0)?.id).toBe('a')
  })

  it('elapsed 小于所有 startMs 时返 null', () => {
    const lines = [D({ id: 'a', startMs: 1000 })]
    expect(pickActiveLine(lines, 500)).toBeNull()
  })

  it('多句重叠：取 startMs 最大的（"最新覆盖"原则）', () => {
    const lines = [
      D({ id: 'a', startMs: 0 }),
      D({ id: 'b', startMs: 500 }),
      D({ id: 'c', startMs: 1200 }),
    ]
    expect(pickActiveLine(lines, 1500)?.id).toBe('c')
  })

  it('endMs 已过：那句不再 active', () => {
    const lines = [
      D({ id: 'a', startMs: 0, endMs: 1000 }),
      D({ id: 'b', startMs: 1100 }),
    ]
    expect(pickActiveLine(lines, 1500)?.id).toBe('b')
    expect(pickActiveLine(lines, 1050)).toBeNull() // a 已结束、b 还没开始
  })

  it('一句无 endMs：开始后永远 active（直到下一句覆盖）', () => {
    const lines = [D({ id: 'a', startMs: 0 })]
    expect(pickActiveLine(lines, 999_999)?.id).toBe('a')
  })

  it('空数组：返 null', () => {
    expect(pickActiveLine([], 100)).toBeNull()
  })
})

describe('deriveSubtitleView', () => {
  it('narration 类型：speaker=null、isNarration=true、line 非空', () => {
    const lines = [
      D({ id: 'n', role: 'narration', text: '雨从他来时就没停过', startMs: 0 }),
    ]
    const v = deriveSubtitleView(lines, 100)
    expect(v.line?.id).toBe('n')
    expect(v.speaker).toBeNull()
    expect(v.isNarration).toBe(true)
  })

  it('character 带 speaker：speaker 用原值', () => {
    const lines = [
      D({
        id: 'c',
        role: 'character',
        speaker: '苏念',
        text: '你来啦',
        startMs: 0,
      }),
    ]
    const v = deriveSubtitleView(lines, 100)
    expect(v.speaker).toBe('苏念')
    expect(v.isNarration).toBe(false)
  })

  it('protagonist 缺 speaker → fallback "主角"', () => {
    const lines = [
      D({ id: 'p', role: 'protagonist', text: '我来了', startMs: 0 }),
    ]
    const v = deriveSubtitleView(lines, 100)
    expect(v.speaker).toBe('主角')
  })

  it('character 缺 speaker → fallback "???"（提示作者填名字）', () => {
    const lines = [D({ id: 'c', role: 'character', text: '?', startMs: 0 })]
    const v = deriveSubtitleView(lines, 100)
    expect(v.speaker).toBe('???')
  })

  it('character speaker="" 空字符串视为缺失', () => {
    const lines = [
      D({
        id: 'c',
        role: 'character',
        speaker: '   ',
        text: 'x',
        startMs: 0,
      }),
    ]
    const v = deriveSubtitleView(lines, 100)
    expect(v.speaker).toBe('???')
  })

  it('当前没有 active：line/speaker 都为 null，isNarration=false', () => {
    const lines = [D({ id: 'a', startMs: 1000 })]
    const v = deriveSubtitleView(lines, 0)
    expect(v.line).toBeNull()
    expect(v.speaker).toBeNull()
    expect(v.isNarration).toBe(false)
  })

  // 关键回归：用户报告"场景描述（narration）没显示"
  // 旧 DialogueBox 的代码本身是渲染 narration 的，但如果 LLM 抽取时
  // 漏抽了 narration 自然没东西显示。这里把"narration 应当返回 line"
  // 这个契约钉死，UI 渲染规则在另一头钉。
  it('回归保护：narration 必须返回 line（而不是被当作 null）', () => {
    const lines = [
      D({
        id: 'n',
        role: 'narration',
        text: '门后传来她的笑声',
        startMs: 0,
      }),
    ]
    const v = deriveSubtitleView(lines, 100)
    expect(v.line).not.toBeNull()
    expect(v.line?.text).toBe('门后传来她的笑声')
  })
})
