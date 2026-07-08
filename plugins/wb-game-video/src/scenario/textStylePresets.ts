/**
 * 文字预设样式库（SSOT）—— 字幕 / 花字各一套内置预设。
 *
 * · 应用采用**快照**语义：`applyPreset` 深拷 `preset.style` 到目标 clip，之后各自独立
 *   微调；改预设不追溯已应用实例。
 * · 「默认字幕」预设的 style = {} —— 空样式表示「不覆盖」，让 DialogueBox 的 CSS 基线
 *   透出（历史像素级默认款，零回归）。
 * · 用户「+」新建的自定义预设持久化到 Scenario.textStylePresets，与内置合并展示。
 */
import type { Scenario, TextStyle, TextStylePreset } from './types'

/** 字幕「归位」到的默认画面位置（底部居中带）。不落 x/y = 归位态；此常量供预览渲染兜底。 */
export const SUBTITLE_DEFAULT_XY = { x: 0.5, y: 0.9 } as const

/** 字幕内置预设。首条「默认字幕」= 空 style（CSS 基线）。 */
export const SUBTITLE_STYLE_PRESETS: TextStylePreset[] = [
  { id: 'sub-default', name: '默认字幕', builtin: true, speakerPrefix: false, style: {} },
  {
    id: 'sub-dialogue',
    name: '对白',
    builtin: true,
    speakerPrefix: true,
    style: { fontFamily: 'sans', fontWeight: 500, color: '#ffffff', strokeColor: '#000000', strokeWidth: 1, fontSizePct: 5.2, align: 'center' },
  },
  {
    id: 'sub-narration',
    name: '旁白',
    builtin: true,
    speakerPrefix: false,
    style: { fontFamily: 'kai', fontWeight: 300, color: 'rgba(255,250,238,0.92)', strokeColor: '#000000', strokeWidth: 1, fontSizePct: 5, align: 'center' },
  },
  {
    id: 'sub-shout',
    name: '呼喊',
    builtin: true,
    speakerPrefix: false,
    style: { fontFamily: 'impact', fontWeight: 800, color: '#ffe14d', strokeColor: '#3a1d00', strokeWidth: 3, fontSizePct: 7, align: 'center' },
  },
  {
    id: 'sub-whisper',
    name: '心声',
    builtin: true,
    speakerPrefix: false,
    style: { fontFamily: 'kai', italic: true, fontWeight: 300, color: 'rgba(200,220,255,0.9)', strokeColor: '#001022', strokeWidth: 1, fontSizePct: 4.6, align: 'center' },
  },
]

/** 花字内置预设。首条「默认花字」= 现行 insertFactories 的兜底外观。 */
export const OVERLAY_STYLE_PRESETS: TextStylePreset[] = [
  {
    id: 'ovl-default',
    name: '默认花字',
    builtin: true,
    style: { fontFamily: 'impact', fontWeight: 700, color: '#ffffff', strokeColor: '#000000', strokeWidth: 3, fontSizePct: 7, align: 'center' },
  },
  {
    id: 'ovl-pop',
    name: '综艺',
    builtin: true,
    style: { fontFamily: 'rounded', fontWeight: 800, color: '#fff14d', strokeColor: '#d81e5b', strokeWidth: 4, fontSizePct: 8, align: 'center' },
  },
  {
    id: 'ovl-title',
    name: '标题',
    builtin: true,
    style: { fontFamily: 'impact', fontWeight: 900, color: '#ffffff', strokeColor: '#111111', strokeWidth: 2, fontSizePct: 11, align: 'center' },
  },
  {
    id: 'ovl-note',
    name: '注释',
    builtin: true,
    style: { fontFamily: 'sans', fontWeight: 500, color: '#ffffff', strokeColor: '#000000', strokeWidth: 1, fontSizePct: 4, align: 'center', bgColor: 'rgba(0,0,0,0.45)' },
  },
  {
    id: 'ovl-damage',
    name: '伤害数字',
    builtin: true,
    style: { fontFamily: 'impact', fontWeight: 900, color: '#ff5a5a', strokeColor: '#2a0000', strokeWidth: 3, fontSizePct: 9, align: 'center' },
  },
]

/** 内置 + 用户自定义合并（内置在前）。 */
export function resolveSubtitlePresets(scenario: Pick<Scenario, 'textStylePresets'> | undefined): TextStylePreset[] {
  return [...SUBTITLE_STYLE_PRESETS, ...(scenario?.textStylePresets?.subtitle ?? [])]
}

export function resolveOverlayPresets(scenario: Pick<Scenario, 'textStylePresets'> | undefined): TextStylePreset[] {
  return [...OVERLAY_STYLE_PRESETS, ...(scenario?.textStylePresets?.overlay ?? [])]
}

/** 快照应用：返回预设 style 的深拷贝（独立实例，改一份不影响另一份）。 */
export function snapshotPresetStyle(preset: TextStylePreset): TextStyle {
  return structuredClone(preset.style)
}

/** 找出与给定 style 完全一致的预设 id（用于高亮当前应用的预设格）。 */
export function matchPresetId(presets: TextStylePreset[], style: TextStyle | undefined): string | undefined {
  const norm = (s: TextStyle | undefined): string => JSON.stringify(sortedStyle(s ?? {}))
  const target = norm(style)
  return presets.find((p) => norm(p.style) === target)?.id
}

function sortedStyle(s: TextStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(s).sort()) {
    const v = (s as Record<string, unknown>)[k]
    if (v !== undefined && v !== null) out[k] = v
  }
  return out
}
