import { describe, it, expect } from 'vitest'
import {
  buildConceptStyleDirectives,
  buildFinalSheetStyleDirectives,
  type ConceptStyleCtx,
  type FinalSheetStyleCtx,
} from '../conceptPromptStyles'

/**
 * 「概设 4 张变体」和「完整设定图」的 image prompt 风格指令。
 *
 * 设计要点（每个 expect 对应一条契约）：
 *
 * - Gemini 分支保持原有 booru/LoRA 权重风格（`(masterpiece:1.4)`、`1girl`、
 *   逗号分隔 tag 堆），这是现有调用的基线，不能被无意改动。
 * - gpt-image-2 分支禁止使用权重语法 `(xxx:0-9.0-9)`——gpt-image-2 会把它当
 *   字面文本输出到图里或者直接忽略，一方面浪费 token 一方面降质。
 * - gpt-image-2 分支改用**自然语言完整句子**，并强化 "one character"、
 *   "full body" 这些结构化约束词。
 * - 两个分支都必须包含 "solo / one character" 约束——这是 character-editor
 *   所有阶段的铁律（否则会出多人图）。
 */

const humanoidCtx: ConceptStyleCtx = {
  isNonHumanoid: false,
  isDefault: true,
  worldEn: 'fantasy medieval',
  bodyTypeSilhouetteEn: 'standard humanoid silhouette',
  bodyTypeReferences: '',
  bodyTypeNegativeEn: '',
  artStyleZh: '',
  artStyleEn: '',
  artStyleKeywords: '',
}

const nonHumanoidCtx: ConceptStyleCtx = {
  ...humanoidCtx,
  isNonHumanoid: true,
  bodyTypeSilhouetteEn: 'crab-like exoskeleton silhouette',
  bodyTypeReferences: 'Hollow Knight, Ori',
  bodyTypeNegativeEn: 'no humanoid features, no human face',
}

describe('buildConceptStyleDirectives — Gemini 分支', () => {
  it('包含 booru 权重前缀 (masterpiece:1.4)（现有基线）', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gemini')
    expect(r.stylePrefix).toMatch(/\(masterpiece:1\.4\)/)
  })

  it('human 分支包含 LOL splash art 这个关键风格词（现有基线）', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gemini')
    expect(r.stylePrefix).toMatch(/LOL style/)
  })

  it('后缀里必须有 only one creature 约束', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gemini')
    expect(r.styleSuffix).toMatch(/only one creature/)
  })
})

describe('buildConceptStyleDirectives — gpt-image-2 分支', () => {
  it('prefix 严格不含权重语法 (x:0.0)', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gpt-image-2')
    expect(r.stylePrefix).not.toMatch(/\(\w+:\d/)
  })

  it('suffix 严格不含权重语法', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gpt-image-2')
    expect(r.styleSuffix).not.toMatch(/\(\w+:\d/)
  })

  it('prefix 不含 booru 数量 tag 1girl/1boy/solo', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gpt-image-2')
    // 注意：solo 作为"single"的 booru shorthand 不能在 gpt 版用；
    // 但自然语言 "single character" / "one character" 是允许的。
    expect(r.stylePrefix).not.toMatch(/\b1girl\b|\b1boy\b/)
    expect(r.stylePrefix).not.toMatch(/\bsolo\b/)
  })

  it('suffix 包含明确的"单一主体"自然语言约束', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gpt-image-2')
    expect(r.styleSuffix.toLowerCase()).toMatch(/one character|single character|only one/)
  })

  it('prefix 包含 "high quality"/"professional" 类自然语言质量词', () => {
    const r = buildConceptStyleDirectives(humanoidCtx, 'gpt-image-2')
    const lower = r.stylePrefix.toLowerCase()
    expect(lower).toMatch(/high quality|professional|masterpiece|ultra[- ]detailed/)
  })

  it('非人形分支明确要求不含 humanoid features', () => {
    const r = buildConceptStyleDirectives(nonHumanoidCtx, 'gpt-image-2')
    expect(r.styleSuffix.toLowerCase()).toMatch(/not human|no human|non[- ]human/)
  })
})

describe('buildFinalSheetStyleDirectives —— 4 方向/完整设定图', () => {
  const finalHumanoid: FinalSheetStyleCtx = {
    isNonHumanoid: false,
    backgroundColor: '#FFFFFF',
    bodyTypeSilhouetteEn: 'standard humanoid silhouette',
    bodyTypeNegativeEn: '',
  }

  it('Gemini 分支包含 LoRA 风格 T-pose / character sheet tag', () => {
    const r = buildFinalSheetStyleDirectives(finalHumanoid, 'gemini')
    expect(r.toLowerCase()).toMatch(/character sheet|t-pose|turnaround/)
  })

  it('gpt-image-2 分支用自然语言描述 character reference sheet', () => {
    const r = buildFinalSheetStyleDirectives(finalHumanoid, 'gpt-image-2')
    expect(r.toLowerCase()).toMatch(/reference sheet|character design sheet/)
    expect(r).not.toMatch(/\(\w+:\d/)
  })

  it('两个分支都显式声明背景色', () => {
    const g = buildFinalSheetStyleDirectives(finalHumanoid, 'gemini')
    const p = buildFinalSheetStyleDirectives(finalHumanoid, 'gpt-image-2')
    expect(g).toContain('#FFFFFF')
    expect(p).toContain('#FFFFFF')
  })
})
