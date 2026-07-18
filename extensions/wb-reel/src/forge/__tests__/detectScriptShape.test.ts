import { describe, expect, it } from 'vitest'
import { detectScriptShape, SCRIPT_MIN_CHARS } from '../detectScriptShape'

/**
 * 入口判别器单测 —— 覆盖五档分类各自的"典型样本"。
 *
 * 用真实写作中可能出现的输入文本验证启发式，避免上线后第一次见到
 * 真实剧本就分类错误（误把结构化剧本当成小说去扩写 = 二创灾难）。
 *
 * 命名约定：
 *   describe('detectScriptShape · <类别>') 一组
 *   it 描述具体输入特征
 */

describe('detectScriptShape · too-short', () => {
  it('空字符串 → too-short / confidence 1', () => {
    const r = detectScriptShape('')
    expect(r.kind).toBe('too-short')
    expect(r.confidence).toBe(1)
  })

  it('短文本不足 SCRIPT_MIN_CHARS → too-short', () => {
    const r = detectScriptShape('就一句话')
    expect(r.kind).toBe('too-short')
    expect(r.signals.length).toBeLessThan(SCRIPT_MIN_CHARS)
  })
})

describe('detectScriptShape · structured-script', () => {
  it('多个场景标题 + 多处对白 → structured-script', () => {
    const text = [
      '# 雨夜',
      '',
      '场景 1：旧居门前',
      '',
      '雨水砸在青石板上。他站在门前已经五分钟。',
      '',
      '老王：「你确定要敲门？」',
      '',
      '林深：「我必须知道。」',
      '',
      '场景 2：屋内',
      '',
      '灯泡昏黄。',
      '',
      '阿芸：「外面好像有人。」',
    ].join('\n')

    const r = detectScriptShape(text)
    expect(r.kind).toBe('structured-script')
    expect(r.signals.headingCount).toBeGreaterThanOrEqual(2)
    expect(r.signals.dialogueCount).toBeGreaterThanOrEqual(3)
    expect(r.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('英文 SCENE/CHAPTER 标题也算结构化', () => {
    const text = [
      'Scene 1: Rainy night',
      '',
      'He stood in front of the door.',
      '',
      'Old Wang: "Are you sure?"',
      '',
      'Lin: "I must know."',
      '',
      'Scene 2: Inside',
      '',
      'Ayun: "There is someone outside."',
    ].join('\n')
    const r = detectScriptShape(text)
    expect(r.kind).toBe('structured-script')
  })
})

describe('detectScriptShape · prose-novel', () => {
  it('无标题、无对白前缀、长段落 → prose-novel', () => {
    // 三段连续叙事，每段 ≥ 60 字，无任何引号/冒号
    const text = [
      '雨水顺着檐角滴答砸在青石板上他站在门前已经五分钟灰风衣下摆被风掀起左眼那道疤在门灯的昏黄里显得比平时更深屋里隐约传来声响一个男人的声音他的手停在门环上犹豫了很久也没敲下去',
      '',
      '同一时刻屋内灯泡挂得低琥珀色的光打在她的旗袍肩线上她正往茶杯里添第三块糖手指停了一下她听见了什么外面好像有人的声音老人喝着茶没抬头说这种雨天哪里会有人她皱起眉走到窗边轻轻拉开一条缝',
      '',
      '门外的男人感觉到了什么他后退一步雨水从他帽檐倾泻而下他突然转身朝巷口走去他的身影很快被夜色吞没只剩门环还在风中轻轻摆动这是他第三次来到这扇门前但每一次都没能敲下去',
    ].join('\n')

    const r = detectScriptShape(text)
    expect(r.kind).toBe('prose-novel')
    expect(r.signals.headingCount).toBe(0)
    expect(r.signals.avgParagraphChars).toBeGreaterThanOrEqual(60)
    expect(r.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('带标点、无引号、无冒号前缀的小说体 → prose-novel', () => {
    // 模拟真实小说体（有句号、逗号、但没引号/冒号 = 没对白）
    const text = [
      '雨水顺着檐角滴答砸下，砸在青石板上。他站在门前已经五分钟，灰风衣下摆被风掀起。左眼那道疤在门灯的昏黄里显得比平时更深。屋里隐约传来声响。',
      '',
      '同一时刻，屋内灯泡挂得低，琥珀色的光打在她的旗袍肩线上。她正往茶杯里添第三块糖，手指停了一下，她听见了什么。外面好像有人的声音，但老人喝着茶没抬头。',
      '',
      '门外的男人感觉到了什么，他后退一步，雨水从他帽檐倾泻而下。他突然转身朝巷口走去，身影很快被夜色吞没，只剩门环还在风中轻轻摆动。这是他第三次来到这扇门前。',
    ].join('\n')
    const r = detectScriptShape(text)
    expect(r.kind).toBe('prose-novel')
    expect(r.signals.dialogueCount).toBeLessThanOrEqual(1)
  })
})

describe('detectScriptShape · mixed-with-tables', () => {
  it('含 markdown 表格 → mixed-with-tables（即便有标题也优先整理）', () => {
    const text = [
      '# 角色表',
      '',
      '| 姓名 | 年龄 | 身份 |',
      '|------|------|------|',
      '| 林深 | 32 | 私家侦探 |',
      '| 阿芸 | 24 | 旗袍店老板娘 |',
      '',
      '## 第一幕',
      '',
      '林深：「你确定要敲门？」',
    ].join('\n')

    const r = detectScriptShape(text)
    expect(r.kind).toBe('mixed-with-tables')
    expect(r.signals.mdTableRows).toBeGreaterThanOrEqual(2)
    expect(r.confidence).toBeGreaterThanOrEqual(0.85)
  })

  it('含 HTML <table> → mixed-with-tables', () => {
    const text = [
      '剧本节选',
      '',
      '<table>',
      '  <tr><td>林深</td><td>私家侦探</td></tr>',
      '  <tr><td>阿芸</td><td>店主</td></tr>',
      '</table>',
      '',
      '林深独自走进店里。',
    ].join('\n')

    const r = detectScriptShape(text)
    expect(r.kind).toBe('mixed-with-tables')
    expect(r.signals.htmlTableCount).toBeGreaterThanOrEqual(1)
  })
})

describe('detectScriptShape · unknown / 边界', () => {
  it('只有大纲（多标题、零对白）→ unknown', () => {
    const text = [
      '# 第一幕',
      '故事开始的地方',
      '',
      '# 第二幕',
      '冲突浮现',
      '',
      '# 第三幕',
      '抉择时刻',
    ].join('\n')

    const r = detectScriptShape(text)
    expect(r.kind).toBe('unknown')
    expect(r.signals.headingCount).toBeGreaterThanOrEqual(2)
    expect(r.signals.dialogueCount).toBe(0)
  })

  it('单标题 + 几句对白（单场景）→ unknown', () => {
    const text = [
      '# 雨夜的旧居门前',
      '',
      '林深站在门外。',
      '',
      '林深：「你来了？」',
      '',
      '阿芸：「我一直都在这里等着。」',
    ].join('\n')

    const r = detectScriptShape(text)
    expect(r.kind).toBe('unknown')
    expect(r.signals.headingCount).toBe(1)
    expect(r.signals.dialogueCount).toBeGreaterThanOrEqual(2)
  })

  it('短小说（≥30 字、平均段落短）—— 不算 prose-novel', () => {
    // 长度过 SCRIPT_MIN_CHARS（30），但平均段落 < 60 → 不命中 prose-novel
    // 多个短句一段、再加几短段，让 length ≥ 30 但 avgParagraphChars 低
    const text = [
      '他站在门前。',
      '雨很大。',
      '他没有敲门。',
      '',
      '最后他转身离开了。',
      '',
      '巷口传来狗叫声。',
      '',
      '他点了一支烟。',
    ].join('\n')
    const r = detectScriptShape(text)
    // 长度 ≥ 30 不会被 too-short 截；段落短 → 不是 prose-novel；无表格无标题 → unknown
    expect(r.kind).toBe('unknown')
  })
})

describe('detectScriptShape · 信号特征采集准确性', () => {
  it('Markdown 表格分隔行也算入 mdTableRows', () => {
    const text = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n')
    // 长度可能 < 30，但即使被 too-short 截胡，我们也能从外部直接调
    // 这里特地拼一段长内容确保能跑到主流程
    const padded =
      text +
      '\n\n' +
      '这是一段额外的叙事用来让总长度超过 SCRIPT_MIN_CHARS 阈值并且不被 too-short 截走以便我们能验证表格识别逻辑'
    const r = detectScriptShape(padded)
    expect(r.signals.mdTableRows).toBeGreaterThanOrEqual(2)
    expect(r.kind).toBe('mixed-with-tables')
  })

  it('元信息冒号行（"时间：xxx"）不算对白', () => {
    const text = [
      '# 第一幕',
      '',
      '时间：1947 年雨夜',
      '地点：上海法租界',
      '人物：林深、阿芸',
      '',
      '林深独自站在门前思索良久最终没有敲门便转身离开。',
    ].join('\n')
    const r = detectScriptShape(text)
    // 元信息行不应被算成对白
    expect(r.signals.dialogueCount).toBe(0)
  })

  it('reasons 至少给一条人话理由', () => {
    const text =
      '场景 1：雨夜\n\n林深：「你来了？」\n\n场景 2：屋内\n\n阿芸：「我一直在这里。」\n\n场景 3：门外\n\n林深：「我们走吧。」'
    const r = detectScriptShape(text)
    expect(r.reasons.length).toBeGreaterThan(0)
    expect(r.reasons.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
  })
})
