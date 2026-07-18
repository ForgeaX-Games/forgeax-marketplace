import { describe, it, expect } from 'vitest'
import { buildFinalSheetLayoutTemplate, type FinalSheetTemplateCtx } from '../finalSheetPromptStyles'

/**
 * "角色完整设定图" 的版式模板——Claude 拿到这段英文模板要照抄进最终的图像
 * prompt 里（见 CharacterDesign.buildSystemPrompt）。
 *
 * 为什么要按模型分叉：这段模板决定了 Claude 给 Gemini 还是 gpt-image-2 喂什么
 * 语言风格。Gemini 吃 `(x:1.4)` 权重 + 位置 tag + 逗号 tag 堆；gpt-image-2 吃
 * 自然语言分块描述。
 *
 * 契约：
 * - 两个版本都要包含 9 个关键版式区域（左上名字美宣、主体居中、左下装备拆解、
 *   右上技能演出、右中物品栏、右下侧背视图、配色条等）的指令词——否则布局会乱。
 * - 两个版本都要声明"浅灰 #e6e6e6 背景 / 无边框"。
 * - Gemini 版本保持原有 booru/LoRA 风格；gpt-image-2 版本禁止权重语法。
 */

const humanoidCtx: FinalSheetTemplateCtx = {
  charName: '凌',
  classZh: '剑客',
  classEn: 'Swordsman',
  combatEn: 'melee',
  worldZh: '东方奇幻',
  worldEn: 'eastern fantasy',
  speciesProfessionEn: 'human swordsman',
  centerSubject: '(MANDATORY complete full body from head to feet:1.6), male Swordsman',
  equipNoteEn: 'highly detailed outfit with material textures',
  styleDescEn: '2D Korean action game art, cel shaded',
  negativePromptLineEn: '',
}

describe('buildFinalSheetLayoutTemplate — Gemini 分支（现有基线）', () => {
  it('保留 booru 权重语法 (character design sheet:1.5)', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gemini')
    expect(t).toMatch(/\(character design sheet:1\.5\)/)
  })

  it('保留 masterpiece 权重前缀', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gemini')
    expect(t).toMatch(/\(masterpiece:1\.4\)/)
  })

  it('包含版式 Top-Left / Center Main / Bottom-Left / Bottom-Right 标签', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gemini')
    expect(t).toMatch(/Top-Left/)
    expect(t).toMatch(/Center Main/)
    expect(t).toMatch(/Bottom-Left/)
    expect(t).toMatch(/Bottom-Right/)
  })

  it('声明 #e6e6e6 浅灰背景', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gemini')
    expect(t).toMatch(/#e6e6e6/i)
  })
})

describe('buildFinalSheetLayoutTemplate — gpt-image-2 分支', () => {
  it('严格不含权重语法', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gpt-image-2')
    expect(t).not.toMatch(/\(\w+[- \w]*:\d/)
  })

  it('保留 9 块区域的自然语言描述（不需要照搬 Top-Left 这种 tag，但要有区域名或方位）', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gpt-image-2').toLowerCase()
    expect(t).toMatch(/top[- ]left|upper[- ]left/)
    expect(t).toMatch(/center|middle/)
    expect(t).toMatch(/bottom[- ]left|lower[- ]left/)
    expect(t).toMatch(/bottom[- ]right|lower[- ]right|bottom right|side view|back view/)
  })

  it('仍要声明 #e6e6e6 浅灰背景', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gpt-image-2')
    expect(t).toMatch(/#e6e6e6/i)
  })

  it('包含 "character reference sheet" / "design sheet" 自然语言 framing', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gpt-image-2').toLowerCase()
    expect(t).toMatch(/reference sheet|design sheet/)
  })

  it('包含 "no text overlays" / "no watermark" 约束', () => {
    const t = buildFinalSheetLayoutTemplate(humanoidCtx, 'gpt-image-2').toLowerCase()
    expect(t).toMatch(/no watermark/)
  })
})
