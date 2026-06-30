import { describe, expect, it } from 'vitest'
import {
  parseDialogueTextLine,
  realignSceneDialogue,
} from '../realignDialogue'
import type { DialogueLine, Scene, Shot } from '../types'

function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: 'sh',
    order: 0,
    framing: 'medium',
    prompt: 'p',
    ...over,
  } as Shot
}

function dia(over: Partial<DialogueLine> = {}): DialogueLine {
  return {
    id: 'd',
    role: 'character',
    text: '台词',
    startMs: 0,
    ...over,
  } as DialogueLine
}

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 'sc',
    title: 'sc',
    media: { kind: 'IMAGE_PROMPT', prompt: '' },
    durationMs: 12000,
    dialogue: [],
    branches: [],
    ...over,
  } as Scene
}

describe('parseDialogueTextLine', () => {
  it('解析「角色名：台词」（中文冒号）', () => {
    expect(parseDialogueTextLine('林夏：你真要走?')).toEqual({
      speaker: '林夏',
      text: '你真要走?',
    })
  })
  it('解析「角色名:台词」（英文冒号）', () => {
    expect(parseDialogueTextLine('Lin: hello')).toEqual({
      speaker: 'Lin',
      text: 'hello',
    })
  })
  it('无冒号 → 纯台词（无 speaker）', () => {
    expect(parseDialogueTextLine('潮水退去。')).toEqual({ text: '潮水退去。' })
  })
  it('空行 → null', () => {
    expect(parseDialogueTextLine('   ')).toBeNull()
  })
})

describe('realignSceneDialogue', () => {
  it('空台词原样返回', () => {
    const sc = scene({ dialogue: [] })
    expect(realignSceneDialogue(sc)).toEqual([])
  })

  it('按镜窗对齐：两句台词分到两个镜，时间落进各自镜窗内', () => {
    const sc = scene({
      durationMs: 20000,
      shots: [
        shot({ id: 'a', order: 0, startMs: 0, endMs: 8000, dialogueText: '林夏：你来了' }),
        shot({ id: 'b', order: 1, startMs: 8000, endMs: 20000, dialogueText: '沈舟：我没得选' }),
      ],
      dialogue: [
        dia({ id: 'd1', speaker: '林夏', text: '你来了', startMs: 200 }),
        dia({ id: 'd2', speaker: '沈舟', text: '我没得选', startMs: 1700 }),
      ],
    })
    const out = realignSceneDialogue(sc)
    const d1 = out.find((d) => d.id === 'd1')!
    const d2 = out.find((d) => d.id === 'd2')!
    expect(d1.startMs).toBeGreaterThanOrEqual(0)
    expect(d1.endMs!).toBeLessThanOrEqual(8000)
    expect(d2.startMs).toBeGreaterThanOrEqual(8000)
    expect(d2.endMs!).toBeLessThanOrEqual(20000)
  })

  it('同一镜多句：镜内顺序排开、不重叠、不超镜窗', () => {
    const sc = scene({
      durationMs: 15000,
      shots: [
        shot({
          id: 'a',
          order: 0,
          startMs: 0,
          endMs: 15000,
          dialogueText: '林夏：你真要走?\n沈舟：我没得选。',
        }),
      ],
      dialogue: [
        dia({ id: 'd1', speaker: '林夏', text: '你真要走?' }),
        dia({ id: 'd2', speaker: '沈舟', text: '我没得选。' }),
      ],
    })
    const out = realignSceneDialogue(sc)
    const d1 = out.find((d) => d.id === 'd1')!
    const d2 = out.find((d) => d.id === 'd2')!
    expect(d1.startMs).toBe(0)
    expect(d2.startMs).toBeGreaterThanOrEqual(d1.endMs!)
    expect(d2.endMs!).toBeLessThanOrEqual(15000)
  })

  it('未匹配台词（旁白）在相邻锚点之间插值补位，不丢句、顺序单调', () => {
    const sc = scene({
      durationMs: 20000,
      shots: [
        shot({ id: 'a', order: 0, startMs: 0, endMs: 8000, dialogueText: '林夏：你来了' }),
        shot({ id: 'b', order: 1, startMs: 12000, endMs: 20000, dialogueText: '沈舟：我没得选' }),
      ],
      dialogue: [
        dia({ id: 'd1', speaker: '林夏', text: '你来了' }),
        dia({ id: 'd2', role: 'narration', text: '潮水退去。' }), // 不在任何镜里
        dia({ id: 'd3', speaker: '沈舟', text: '我没得选' }),
      ],
    })
    const out = realignSceneDialogue(sc)
    expect(out).toHaveLength(3)
    const [a, b, c] = out
    expect(a!.startMs).toBeLessThanOrEqual(b!.startMs)
    expect(b!.startMs).toBeLessThanOrEqual(c!.startMs)
    // 旁白被塞进 d1 结束 ~ d3 开始 之间
    expect(b!.startMs).toBeGreaterThanOrEqual(a!.endMs!)
    expect(b!.endMs!).toBeLessThanOrEqual(c!.startMs)
  })

  it('无分镜窗 / dialogueText 全空：整体按字数铺满 durationMs（不再全挤开头）', () => {
    const sc = scene({
      durationMs: 12000,
      shots: undefined,
      dialogue: [
        dia({ id: 'd1', text: '第一句很短' }),
        dia({ id: 'd2', text: '第二句稍微长一点点内容' }),
        dia({ id: 'd3', text: '收尾' }),
      ],
    })
    const out = realignSceneDialogue(sc)
    expect(out[0]!.startMs).toBe(0)
    // 单调铺开，最后一句不超出场景
    expect(out[2]!.endMs!).toBeLessThanOrEqual(12000)
    expect(out[1]!.startMs).toBeGreaterThanOrEqual(out[0]!.endMs!)
    // 字多的句子占用更久
    const dur2 = out[1]!.endMs! - out[1]!.startMs
    const dur3 = out[2]!.endMs! - out[2]!.startMs
    expect(dur2).toBeGreaterThan(dur3)
  })

  it('所有 startMs/endMs 被夹进 [0, durationMs]', () => {
    const sc = scene({
      durationMs: 10000,
      shots: [shot({ id: 'a', order: 0, startMs: 0, endMs: 10000, dialogueText: '林夏：测试' })],
      dialogue: [dia({ id: 'd1', speaker: '林夏', text: '测试', startMs: 999999 })],
    })
    const out = realignSceneDialogue(sc)
    expect(out[0]!.startMs).toBeGreaterThanOrEqual(0)
    expect(out[0]!.endMs!).toBeLessThanOrEqual(10000)
  })
})
