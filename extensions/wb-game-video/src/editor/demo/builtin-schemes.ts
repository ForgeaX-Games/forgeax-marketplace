/**
 * 内置「通用样式」方案 —— 两份自由 overlay，装齐现有全部组件预设，做「组件画廊 / 预设仓库」。
 *
 * 与普通 overlay 同一套数据格式（Overlay + OverlayChild），只是 id/标题固定、boot 时保证存在，
 * 免得后续因缺失某个皮肤预设被带偏。静态 = 常驻展示类；动态 = 交互/动画类。叩击/防反/應默/技能条
 * 各自是独立注册的顶层组件 id（`OverlayChild.component` 直接就是最终渲染的组件，无 inputs.component
 * 覆盖层）；各皮肤预设由对应 tsx 导出，本文件组装引用。
 *
 * 幂等：boot 只在缺失时补，用户可自由改内部 children；删掉整份下次 boot 会补回。
 */
import type { Overlay, OverlayChild } from '../../runtime/schema/graph-schema'
import {
  battleHpBarPreset,
  battleParryPreset,
  battleSkillBarPreset,
  inkKouPreset,
  inkYingMoPreset,
} from '../../runtime/skins/components'

export const SCHEME_STATIC_ID = 'scheme-static'
export const SCHEME_DYNAMIC_ID = 'scheme-dynamic'

/** 静态组件方案：常驻展示（HUD 血条 / 字幕）。 */
const STATIC_SCHEME: Overlay = {
  id: SCHEME_STATIC_ID,
  title: '静态组件方案',
  children: [
    battleHpBarPreset('hp-player', { bind: 'ent-player', label: '我方' }),
    battleHpBarPreset('hp-boss', { bind: 'ent-boss', label: '敌方' }),
    {
      id: 'line',
      component: 'dialogue',
      trigger: { when: 'enter' },
      inputs: { speaker: '角色', text: '这是一句字幕示例。' },
    },
  ],
}

/** 动态组件方案：交互 / 动画（QTE 叩击·防反 / 應默 / 技能条 / 飘字）。 */
const DYNAMIC_SCHEME: Overlay = {
  id: SCHEME_DYNAMIC_ID,
  title: '动态组件方案',
  children: [
    inkKouPreset('qte-kou'),
    battleParryPreset('qte-parry'),
    inkYingMoPreset('choice-yingmo'),
    battleSkillBarPreset('choice-skills'),
    {
      id: 'float',
      component: 'floatText',
      trigger: { when: 'enter' },
      inputs: { text: '+30', x: 0.5, y: 0.4, color: '#5fbf7f' },
    },
  ],
}

export const BUILTIN_SCHEMES: Overlay[] = [STATIC_SCHEME, DYNAMIC_SCHEME]

/** 「+ 组件」菜单：每项 = 一个组件预设模板（顶栏 component = 该组件的顶层 id）。 */
export const NEW_COMPONENT_PRESETS: Array<{
  id: string
  label: string
  make: (childId: string) => OverlayChild
}> = [
  {
    id: 'battleHpBar',
    label: 'HUD · 水墨血条',
    make: (id) => battleHpBarPreset(id, { bind: 'ent-player', label: '角色' }),
  },
  {
    id: 'dialogue',
    label: '字幕',
    make: (id) => ({
      id,
      component: 'dialogue',
      trigger: { when: 'enter' },
      inputs: { text: '字幕示例' },
    }),
  },
  {
    id: 'floatText',
    label: '飘字',
    make: (id) => ({
      id,
      component: 'floatText',
      trigger: { when: 'enter' },
      inputs: { text: '+30', x: 0.5, y: 0.4, color: '#5fbf7f' },
    }),
  },
  { id: 'inkKou', label: 'QTE · 叩击', make: inkKouPreset },
  { id: 'battleParry', label: 'QTE · 防反', make: battleParryPreset },
  { id: 'inkYingMo', label: '选项 · 應默', make: inkYingMoPreset },
  { id: 'battleSkillBar', label: '选项 · 技能条', make: battleSkillBarPreset },
]

/** 保证内置方案存在于 overlays 目录（缺失才补，不覆盖用户已改内容）。 */
export function ensureBuiltinSchemes(
  overlays: Record<string, Overlay> | undefined,
): Record<string, Overlay> {
  const next = { ...(overlays ?? {}) }
  for (const s of BUILTIN_SCHEMES) {
    if (!next[s.id]) next[s.id] = structuredClone(s)
  }
  return next
}
