// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  conceptGenButtonLabel,
  conceptVariantCount,
  NPC_PROMPT_FORBIDDEN_KEYWORDS,
  shouldAutoRouteNpcToPixel,
  shouldSkipFinalSheetForNpc,
} from '../CharacterDesign'

describe('shouldAutoRouteNpcToPixel()', () => {
  it('returns false when there is no current image (no 设定图 = 没有“生成完”这个事件)', () => {
    expect(shouldAutoRouteNpcToPixel('npc', null, null)).toBe(false)
    expect(shouldAutoRouteNpcToPixel('npc', null, '')).toBe(false)
  })

  it('returns false for hero / undefined roles — 英雄保留「修改局部细节」+ 手动选管线流程', () => {
    expect(shouldAutoRouteNpcToPixel('hero', null, 'data:image/png;base64,AAA')).toBe(false)
    expect(shouldAutoRouteNpcToPixel(undefined, null, 'data:image/png;base64,AAA')).toBe(false)
    expect(shouldAutoRouteNpcToPixel(null, null, 'data:image/png;base64,AAA')).toBe(false)
  })

  it('returns true when an NPC just got a fresh final sheet', () => {
    expect(shouldAutoRouteNpcToPixel('npc', null, 'data:image/png;base64,AAA')).toBe(true)
  })

  it('returns false if the same image was already routed — 切回 tab 不应被反复弹走', () => {
    const img = 'data:image/png;base64,AAA'
    expect(shouldAutoRouteNpcToPixel('npc', img, img)).toBe(false)
  })

  it('returns true again when the NPC regenerates — last != current => 新图要再跳一次', () => {
    expect(
      shouldAutoRouteNpcToPixel(
        'npc',
        'data:image/png;base64,OLD',
        'data:image/png;base64,NEW',
      ),
    ).toBe(true)
  })
})

describe('conceptVariantCount()', () => {
  it('returns 4 for hero — 主角保留 4 张变体 A/B/C/D 挑', () => {
    expect(conceptVariantCount('hero')).toBe(4)
  })

  it('returns 1 for npc — 路人只出 1 张，不做挑图', () => {
    expect(conceptVariantCount('npc')).toBe(1)
  })

  it('defaults to 4 for undefined / null roles — 历史档案缺字段时按英雄流程处理', () => {
    expect(conceptVariantCount(undefined)).toBe(4)
    expect(conceptVariantCount(null)).toBe(4)
  })
})

describe('conceptGenButtonLabel()', () => {
  it('returns NPC-specific label for npc — 不显示「4 张」避免误导', () => {
    expect(conceptGenButtonLabel('npc')).toBe('🎨 生成 NPC 参考稿')
  })

  it('returns 4-variant label for hero — 主角保持 A/B/C/D 挑选语言', () => {
    expect(conceptGenButtonLabel('hero')).toBe('🎨 生成 4 张概念图')
  })

  it('defaults to 4-variant label for missing role — 兼容历史档案', () => {
    expect(conceptGenButtonLabel(undefined)).toBe('🎨 生成 4 张概念图')
    expect(conceptGenButtonLabel(null)).toBe('🎨 生成 4 张概念图')
  })
})

describe('shouldSkipFinalSheetForNpc()', () => {
  it('returns true for npc — NPC 的概念图本身就是最终设定，不需要再跑一次 Claude+Gemini', () => {
    expect(shouldSkipFinalSheetForNpc('npc')).toBe(true)
  })

  it('returns false for hero / undefined — 英雄仍然走完整 concept→final 流程', () => {
    expect(shouldSkipFinalSheetForNpc('hero')).toBe(false)
    expect(shouldSkipFinalSheetForNpc(undefined)).toBe(false)
    expect(shouldSkipFinalSheetForNpc(null)).toBe(false)
  })
})

describe('NPC_PROMPT_FORBIDDEN_KEYWORDS', () => {
  it('包含 reference sheet / turnaround 等会触发多视图的关键词', () => {
    expect(NPC_PROMPT_FORBIDDEN_KEYWORDS).toContain('character reference sheet')
    expect(NPC_PROMPT_FORBIDDEN_KEYWORDS).toContain('turnaround')
    expect(NPC_PROMPT_FORBIDDEN_KEYWORDS).toContain('multiple views')
    expect(NPC_PROMPT_FORBIDDEN_KEYWORDS.length).toBeGreaterThanOrEqual(5)
  })
})
