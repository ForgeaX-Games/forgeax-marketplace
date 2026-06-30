// @vitest-environment happy-dom
/**
 * 怪物形态（`characterRole === 'monster'`）在角色设计里的行为。
 *
 * 怪物是这次模块化重构把 `pipelines/monster-gen` 并吞到「角色设计」后
 * 新加的一档——和 hero / npc 并列。
 *
 * 约束（跟 hero / npc 对比）：
 *   - 概念图张数：hero = 4 / npc = 1 / monster = 4（BOSS 需要挑图）
 *   - 是否跳过「修改局部细节」：hero 不跳 / npc 跳 / monster 跳
 *     （怪物的局部细节走 pixel-char 管线自己的编辑，不走英雄那套）
 *   - 是否自动跳到像素管线：hero 否 / npc 是 / monster 否
 *     （怪物需要让用户看完 4 张概念图挑一张 / 融合后再选管线）
 *   - 概念 prompt：必须是「单个怪物 solo creature 居中全身中性绿背景」，
 *     不能出现 `reference sheet` / `turnaround` 等会触发多视图的禁词。
 */
import { describe, expect, it } from 'vitest'
import {
  buildMonsterConceptPrompt,
  conceptGenButtonLabel,
  conceptVariantCount,
  NPC_PROMPT_FORBIDDEN_KEYWORDS,
  shouldAutoRouteNpcToPixel,
  shouldSkipFinalSheetForNpc,
} from '../CharacterDesign'

describe('conceptVariantCount() — monster', () => {
  it('returns 4 for monster — BOSS/精英值得挑图', () => {
    expect(conceptVariantCount('monster')).toBe(4)
  })
})

describe('conceptGenButtonLabel() — monster', () => {
  it('returns monster-specific label', () => {
    expect(conceptGenButtonLabel('monster')).toBe('🎨 生成 4 张怪物概念图')
  })
})

describe('shouldSkipFinalSheetForNpc() — monster', () => {
  it('returns true for monster — 怪物的概念图就是最终设定，不再跑一次 final sheet', () => {
    expect(shouldSkipFinalSheetForNpc('monster')).toBe(true)
  })
})

describe('shouldAutoRouteNpcToPixel() — monster', () => {
  it('returns false for monster — 怪物需要让用户看完 4 张概念图再选管线', () => {
    expect(shouldAutoRouteNpcToPixel('monster', null, 'data:image/png;base64,AAA')).toBe(false)
  })
})

describe('buildMonsterConceptPrompt()', () => {
  it('包含 solo creature 与中性背景关键词（适合后续切帧）', () => {
    const prompt = buildMonsterConceptPrompt({
      name: '影蛛',
      monsterCategory: '非人型',
      monsterSubCategory: '爬虫类',
      monsterRace: '蜘蛛',
      monsterBodyType: 'agile',
      monsterThreat: 'elite',
      worldSetting: 'fantasy',
    })
    expect(prompt).toMatch(/solo creature|single monster/i)
    expect(prompt).toMatch(/full body|full-body/i)
    expect(prompt).toMatch(/centered/i)
    // 中性背景 —— 便于 pixel-char 管线后续去背景、切序列帧
    expect(prompt).toMatch(/neutral|plain|green|grey|gray|background/i)
  })

  it('不包含 NPC 禁词（reference sheet / turnaround 会触发多视图）', () => {
    const prompt = buildMonsterConceptPrompt({
      name: '古龙',
      monsterCategory: '非人型',
      monsterSubCategory: '巨龙类',
      monsterRace: '古龙',
      monsterBodyType: 'giant',
      monsterThreat: 'boss',
      worldSetting: 'fantasy',
    })
    for (const forbidden of NPC_PROMPT_FORBIDDEN_KEYWORDS) {
      expect(prompt.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('BOSS 等级强调威慑 / 巨大 / 压迫感', () => {
    const bossPrompt = buildMonsterConceptPrompt({
      name: '深渊之王',
      monsterCategory: '混合',
      monsterSubCategory: '异化类',
      monsterRace: '夺心魔',
      monsterBodyType: 'giant',
      monsterThreat: 'boss',
      worldSetting: 'darkfantasy',
    })
    expect(bossPrompt).toMatch(/boss|imposing|menacing|towering|epic/i)
  })

  it('普通怪物不强调 BOSS 语言', () => {
    const normalPrompt = buildMonsterConceptPrompt({
      name: '哥布林兵',
      monsterCategory: '类人型',
      monsterSubCategory: '亚人',
      monsterRace: '哥布林',
      monsterBodyType: 'stocky',
      monsterThreat: 'normal',
      worldSetting: 'fantasy',
    })
    expect(normalPrompt).not.toMatch(/\bboss\b/i)
  })

  it('种族名被写入 prompt（关键识别词）', () => {
    const prompt = buildMonsterConceptPrompt({
      name: '史莱姆',
      monsterCategory: '非人型',
      monsterSubCategory: '异物',
      monsterRace: '史莱姆',
      monsterBodyType: 'compact',
      monsterThreat: 'normal',
      worldSetting: 'fantasy',
    })
    expect(prompt).toContain('史莱姆')
  })
})
