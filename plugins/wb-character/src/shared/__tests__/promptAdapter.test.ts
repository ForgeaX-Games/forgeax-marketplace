import { describe, it, expect } from 'vitest'
import { adaptPromptForImageModel, stripWeightSyntax } from '../promptAdapter'

/**
 * `adaptPromptForImageModel` 是"把一段现有的 Gemini-友好 prompt（带 booru/
 * LoRA 权重语法）转成 gpt-image-2 友好版本（自然语言、无权重语法）"的通用清洗器。
 *
 * 背景：pixel-char / vehicle-design 的 prompt-engine 各有 4-7 个硬编码模板，
 * 每个模板都有一大堆 `(masterpiece:1.4)` 这样的权重语法。全部重写成自然语言
 * 工程量太大；这个清洗器能覆盖大部分场景，把 Gemini 版本改造成 gpt-image-2
 * 可接受的形式，保留语义只去掉语法噪音。
 *
 * 契约：
 * 1. model === 'gemini' → 原样返回（不清洗，保持 Gemini 最佳输入）
 * 2. model === 'gpt-image-2' →
 *    a. 去掉所有 `(xxx:1.4)` 权重语法，保留 xxx
 *    b. 合并连续逗号成一个
 *    c. 清理多余空白
 * 3. stripWeightSyntax 单独暴露，方便单独测试子能力
 */

describe('stripWeightSyntax', () => {
  it('去掉简单 tag:权重', () => {
    expect(stripWeightSyntax('(masterpiece:1.4)')).toBe('masterpiece')
    expect(stripWeightSyntax('(best quality:1.4)')).toBe('best quality')
  })

  it('保留非权重的普通括号', () => {
    expect(stripWeightSyntax('hero (male version) in forest')).toBe('hero (male version) in forest')
  })

  it('同时处理多个权重', () => {
    const input = '(masterpiece:1.4), (best quality:1.3), hero'
    expect(stripWeightSyntax(input)).toBe('masterpiece, best quality, hero')
  })

  it('权重支持整数 / 小数', () => {
    expect(stripWeightSyntax('(foo:2)')).toBe('foo')
    expect(stripWeightSyntax('(bar:0.8)')).toBe('bar')
  })

  it('嵌套短语（多个冒号风险）不误伤 — 只识别结尾的 `:数字` 模式', () => {
    // `(colon: like this)` 不是权重语法，应保留
    expect(stripWeightSyntax('(colon: like this)')).toBe('(colon: like this)')
    // 真正权重
    expect(stripWeightSyntax('(only one creature:1.5)')).toBe('only one creature')
  })
})

describe('adaptPromptForImageModel', () => {
  const sample = '(masterpiece:1.4), (best quality:1.4), hero walking cycle, 4 directions, only one character'

  it('gemini：原样返回', () => {
    expect(adaptPromptForImageModel(sample, 'gemini')).toBe(sample)
  })

  it('gpt-image-2：去权重 + 压缩连续逗号', () => {
    const out = adaptPromptForImageModel(sample, 'gpt-image-2')
    expect(out).not.toMatch(/\(\w+[- \w]*:\d/) // 无权重语法
    expect(out).toContain('masterpiece')
    expect(out).toContain('hero walking cycle')
    expect(out).not.toMatch(/,\s*,/) // 无双逗号
  })

  it('gpt-image-2：保留整段文本的语义顺序', () => {
    const out = adaptPromptForImageModel(
      'A: first, (B:1.3), second, (C:0.9), third',
      'gpt-image-2',
    )
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'))
    expect(out.indexOf('second')).toBeLessThan(out.indexOf('third'))
    expect(out).toContain('B')
    expect(out).toContain('C')
  })

  it('gpt-image-2：空字符串不报错', () => {
    expect(adaptPromptForImageModel('', 'gpt-image-2')).toBe('')
  })
})
