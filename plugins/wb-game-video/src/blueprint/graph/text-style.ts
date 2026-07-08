/**
 * 图原生文字预设库（SSOT）—— 字幕 / 花字各一套内置预设。图版对齐 legacy
 * `scenario/textStylePresets.ts`，但用 `GraphTextStyle`，与 legacy 解耦。
 *
 * · 应用采用**快照**语义：把 `preset.style` 深拷到目标元素 params.style，之后各自独立微调。
 * · 「默认字幕」预设 style = {} —— 空样式=不覆盖，让呈现层 CSS 基线透出。
 * · 用户「+」新建的自定义预设存 GameScenario.textStylePresets，与内置合并展示。
 */
import type { GameScenario, GraphTextStyle, GraphTextStylePreset } from './graph-schema'

/** 字幕「归位」默认画面位置（底部居中带）。不落 x/y = 归位态。 */
export const SUBTITLE_DEFAULT_XY = { x: 0.5, y: 0.9 } as const

/** 字幕内置预设。首条「默认字幕」= 空 style（CSS 基线）。 */
export const SUBTITLE_STYLE_PRESETS: GraphTextStylePreset[] = [
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

/** 花字内置预设。首条「默认花字」= 现行兜底外观。 */
export const OVERLAY_STYLE_PRESETS: GraphTextStylePreset[] = [
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

export type TextStyleGroup = 'subtitle' | 'overlay'

/** 内置 + 用户自定义合并（内置在前）。 */
export function resolvePresets(scenario: Pick<GameScenario, 'textStylePresets'> | undefined, group: TextStyleGroup): GraphTextStylePreset[] {
  const builtin = group === 'subtitle' ? SUBTITLE_STYLE_PRESETS : OVERLAY_STYLE_PRESETS
  return [...builtin, ...(scenario?.textStylePresets?.[group] ?? [])]
}

/** 快照应用：返回预设 style 的深拷贝（独立实例）。 */
export function snapshotPresetStyle(preset: GraphTextStylePreset): GraphTextStyle {
  return structuredClone(preset.style)
}

function sortedStyle(s: GraphTextStyle): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(s).sort()) {
    const v = (s as Record<string, unknown>)[k]
    if (v !== undefined && v !== null) out[k] = v
  }
  return out
}

/** 找出与给定 style 完全一致的预设 id（用于高亮当前应用的预设格）。 */
export function matchPresetId(presets: GraphTextStylePreset[], style: GraphTextStyle | undefined): string | undefined {
  const norm = (s: GraphTextStyle | undefined): string => JSON.stringify(sortedStyle(s ?? {}))
  const target = norm(style)
  return presets.find((p) => norm(p.style) === target)?.id
}
