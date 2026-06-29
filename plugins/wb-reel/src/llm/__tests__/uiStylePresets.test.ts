import { describe, expect, it } from 'vitest'
import {
  UI_STYLE_PRESETS,
  getUIStylePreset,
} from '../uiStylePresets'

describe('uiStylePresets', () => {
  it('至少 5 个预设且 id 唯一', () => {
    expect(UI_STYLE_PRESETS.length).toBeGreaterThanOrEqual(5)
    const ids = UI_STYLE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每项字段齐全且合法', () => {
    for (const p of UI_STYLE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.tagline.length).toBeGreaterThan(0)
      expect(p.promptText.length).toBeGreaterThan(10)
      expect(p.posterPrompt.length).toBeGreaterThan(20)
      expect(p.swatch).toHaveLength(2)
    }
  })

  it('getUIStylePreset 命中返回预设 / 未命中返回 null', () => {
    expect(getUIStylePreset('obsidian-glass')).not.toBeNull()
    expect(getUIStylePreset('nope')).toBeNull()
  })
})
