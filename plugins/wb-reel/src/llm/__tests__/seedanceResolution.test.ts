import { describe, it, expect } from 'vitest'
import {
  resolveSeedanceResolution,
  toDisplayLabel,
  VIDEO_SIZE_CHOICES,
  DEFAULT_VIDEO_SIZE,
  type VideoSize,
} from '../seedanceResolution'

/**
 * 测试契约（2026-05 样例对齐后）：
 *   - resolveSeedanceResolution 纯函数；输入 VideoSize，输出 { resolution, ratio, pxWidth, pxHeight }
 *   - 不再降级、不再返回 warning / downgradedForI2V / originalTier —— 档位由 endpoint 决定
 *   - UI 下拉候选不含旧像素串
 */
describe('seedanceResolution · resolveSeedanceResolution', () => {
  describe('新档位语义', () => {
    it('1080p → 1080p 16:9 · 1920×1088', () => {
      const spec = resolveSeedanceResolution('1080p')
      expect(spec).toEqual({
        resolution: '1080p',
        ratio: '16:9',
        pxWidth: 1920,
        pxHeight: 1088,
      })
    })

    it('1080p-portrait → 1080p 9:16 · 1088×1920', () => {
      const spec = resolveSeedanceResolution('1080p-portrait')
      expect(spec.ratio).toBe('9:16')
      expect(spec.pxWidth).toBe(1088)
      expect(spec.pxHeight).toBe(1920)
    })

    it('720p-square → 720p 1:1 · 960×960', () => {
      const spec = resolveSeedanceResolution('720p-square')
      expect(spec.ratio).toBe('1:1')
      expect(spec.pxWidth).toBe(960)
      expect(spec.pxHeight).toBe(960)
    })

    it('480p → 480p 16:9 · 864×480', () => {
      const spec = resolveSeedanceResolution('480p')
      expect(spec.resolution).toBe('480p')
      expect(spec.pxWidth).toBe(864)
      expect(spec.pxHeight).toBe(480)
    })
  })

  describe('旧像素串别名（持久化兼容）', () => {
    it("'1280x720' 等价于 '720p'", () => {
      expect(resolveSeedanceResolution('1280x720')).toEqual(
        resolveSeedanceResolution('720p'),
      )
    })

    it("'720x1280' 等价于 '720p-portrait'", () => {
      expect(resolveSeedanceResolution('720x1280')).toEqual(
        resolveSeedanceResolution('720p-portrait'),
      )
    })

    it("'1024x1024' 等价于 '720p-square'", () => {
      expect(resolveSeedanceResolution('1024x1024')).toEqual(
        resolveSeedanceResolution('720p-square'),
      )
    })
  })

  describe('缺省与容错', () => {
    it('undefined → 默认 1080p 16:9', () => {
      const spec = resolveSeedanceResolution(undefined)
      expect(spec.resolution).toBe('1080p')
      expect(spec.ratio).toBe('16:9')
    })

    it('默认常量 DEFAULT_VIDEO_SIZE = 1080p', () => {
      expect(DEFAULT_VIDEO_SIZE).toBe('1080p')
    })

    it('unknown 字符串被 VideoSize 类型排除，但 runtime 兜底 1080p', () => {
      const spec = resolveSeedanceResolution(
        'garbage' as unknown as VideoSize,
      )
      expect(spec.resolution).toBe('1080p')
    })
  })
})

describe('seedanceResolution · UI helpers', () => {
  it('VIDEO_SIZE_CHOICES 不含旧像素串别名', () => {
    expect(VIDEO_SIZE_CHOICES).not.toContain('1280x720')
    expect(VIDEO_SIZE_CHOICES).not.toContain('720x1280')
    expect(VIDEO_SIZE_CHOICES).not.toContain('1024x1024')
  })

  it('VIDEO_SIZE_CHOICES 首位 = 默认 1080p', () => {
    expect(VIDEO_SIZE_CHOICES[0]).toBe('1080p')
    expect(VIDEO_SIZE_CHOICES[0]).toBe(DEFAULT_VIDEO_SIZE)
  })

  it('toDisplayLabel 所有新档位都返回含像素尺寸的字符串', () => {
    for (const size of VIDEO_SIZE_CHOICES) {
      const label = toDisplayLabel(size)
      expect(label).toMatch(/\d+×\d+/)
    }
  })

  it('toDisplayLabel 旧像素串也能出标签（兼容既有 UI）', () => {
    expect(toDisplayLabel('1280x720')).toContain('720p')
    expect(toDisplayLabel('720x1280')).toContain('720p')
    expect(toDisplayLabel('1024x1024')).toContain('720p')
  })
})
