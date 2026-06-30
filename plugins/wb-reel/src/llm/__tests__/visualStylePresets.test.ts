import { describe, expect, it } from 'vitest'
import {
  VISUAL_STYLE_PRESETS,
  VISUAL_STYLE_LIST,
  DEFAULT_VISUAL_STYLE,
  composeVisualPrompt,
  getAuthoringHint,
  type VisualStyle,
} from '../visualStylePresets'

describe('visualStylePresets', () => {
  describe('preset 表完整性', () => {
    it('六种风格全部存在 + 字段齐全', () => {
      const keys: VisualStyle[] = [
        'photoreal',
        'anime',
        'cartoon',
        'pixelart',
        'watercolor',
        'ink',
      ]
      for (const k of keys) {
        const p = VISUAL_STYLE_PRESETS[k]
        expect(p).toBeDefined()
        expect(p.id).toBe(k)
        expect(p.label.length).toBeGreaterThan(0)
        expect(p.hint.length).toBeGreaterThan(0)
        expect(p.swatch).toHaveLength(2)
        expect(p.promptPrefix.length).toBeGreaterThan(20)
        expect(p.authoringHint.length).toBeGreaterThan(0)
      }
    })
    it('VISUAL_STYLE_LIST 顺序稳定 · 六项', () => {
      expect(VISUAL_STYLE_LIST).toHaveLength(6)
    })
    it('默认风格是 photoreal', () => {
      expect(DEFAULT_VISUAL_STYLE).toBe('photoreal')
    })
  })

  describe('composeVisualPrompt', () => {
    it('style 为 undefined → 原样返回', () => {
      expect(composeVisualPrompt('一个老人在雪山顶', undefined)).toBe(
        '一个老人在雪山顶',
      )
    })
    it('style 为 null → 原样返回', () => {
      expect(composeVisualPrompt('一个老人在雪山顶', null)).toBe(
        '一个老人在雪山顶',
      )
    })
    it('未知风格值 → 原样返回（防御式）', () => {
      expect(
        composeVisualPrompt('x', 'bogus' as unknown as VisualStyle),
      ).toBe('x')
    })
    it('有风格 + 有 raw → 前缀 + 段落分隔 + raw（v6.4：双换行替代破折号）', () => {
      const out = composeVisualPrompt('一个老人在雪山顶', 'anime')
      expect(out.startsWith(VISUAL_STYLE_PRESETS.anime.promptPrefix)).toBe(true)
      expect(out.endsWith('一个老人在雪山顶')).toBe(true)
      expect(out).toContain('\n\n')
    })
    it('raw 为空串 → 只返回前缀（避免尾巴分隔符）', () => {
      const out = composeVisualPrompt('', 'watercolor')
      expect(out).toBe(VISUAL_STYLE_PRESETS.watercolor.promptPrefix)
    })
    it('六种风格都能成功注入', () => {
      for (const p of VISUAL_STYLE_LIST) {
        const out = composeVisualPrompt('TEST', p.id)
        expect(out).toContain(p.promptPrefix)
        expect(out).toContain('TEST')
      }
    })
  })

  describe('getAuthoringHint', () => {
    it('未传 → 空串', () => {
      expect(getAuthoringHint(undefined)).toBe('')
      expect(getAuthoringHint(null)).toBe('')
    })
    it('已知风格 → 返回对应的作者指令', () => {
      expect(getAuthoringHint('anime')).toBe(
        VISUAL_STYLE_PRESETS.anime.authoringHint,
      )
    })
    it('未知风格 → 空串', () => {
      expect(getAuthoringHint('bogus' as unknown as VisualStyle)).toBe('')
    })
  })

  describe('photoreal 风格不再生成期打码（v7）', () => {
    // v7（2026-06）· 作者要求：展示干净写实真人图，打码迁移到上传期 faceMaskTool。
    //   生成提示词里**不应**再出现任何像素马赛克指令。
    it('photoreal.promptPrefix 是干净写实摄影词，不含打码指令', () => {
      const prefix = VISUAL_STYLE_PRESETS.photoreal.promptPrefix
      expect(prefix).toMatch(/photorealistic|cinematic|8k/i)
      expect(prefix).not.toMatch(/pixel mosaic/i)
    })
    it('composeVisualPrompt(photoreal) 输出不含打码指令', () => {
      const out = composeVisualPrompt('一位宇航员站在月球', 'photoreal')
      expect(out).not.toMatch(/pixel mosaic/i)
      expect(out).toContain('一位宇航员站在月球')
    })
    it('所有风格的 promptPrefix 都不含打码指令', () => {
      for (const style of [
        'photoreal',
        'anime',
        'cartoon',
        'pixelart',
        'watercolor',
        'ink',
      ] as const) {
        const prefix = VISUAL_STYLE_PRESETS[style].promptPrefix
        expect(prefix).not.toMatch(/pixel mosaic/i)
      }
    })
  })

  describe('电影海报字段 · posterPrompt + tagline', () => {
    it('每个风格都有海报提示词与中文宣传语', () => {
      for (const p of VISUAL_STYLE_LIST) {
        expect(typeof p.posterPrompt).toBe('string')
        expect(p.posterPrompt.length).toBeGreaterThan(20)
        expect(typeof p.tagline).toBe('string')
        expect(p.tagline.length).toBeGreaterThan(0)
      }
    })
  })
})
