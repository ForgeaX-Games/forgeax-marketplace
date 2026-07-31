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
import { NEW_COMPONENTS } from '../../runtime/component-host/components/new'
import { STAGE_FILL_LAYOUT } from '../../runtime/schema/layout'

/** 基础覆盖物 方案 id 前缀：`base:<组件id>`，每份仅含该单组件、锁定不可增删。 */
export const BASE_HUD_PREFIX = 'base:'

export const SCHEME_STATIC_ID = 'scheme-static'
export const SCHEME_DYNAMIC_ID = 'scheme-dynamic'

/** 新规格组件均从外层 Layout 取得舞台盒，不再从 inputs 猜位置或尺寸。 */
function makeNewComponentPreset(component: string, id: string): OverlayChild {
  return {
    id,
    component,
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    // 显隐唯一 SSOT = window；不写 endMs 表示持续到节点结束。
    window: { startMs: 0 },
    // 组件默认值只由 manifest / renderer 解释；作者未填写时保持空 bag，让参数面板显示 placeholder。
    inputs: {},
  }
}

/** 静态组件方案：常驻展示（HUD 血条 / 字幕）。 */
const STATIC_SCHEME: Overlay = {
  id: SCHEME_STATIC_ID,
  title: '静态组件方案',
  children: [
    makeNewComponentPreset('battlePlayerHpBar', 'hp-player'),
    makeNewComponentPreset('battleEnemyHpBar', 'hp-boss'),
    makeNewComponentPreset('dialogue', 'line'),
  ],
}

/** 动态组件方案：交互 / 动画（QTE 叩击·防反 / 應默 / 技能条 / 飘字）。 */
const DYNAMIC_SCHEME: Overlay = {
  id: SCHEME_DYNAMIC_ID,
  title: '动态组件方案',
  children: [
    makeNewComponentPreset('inkKou', 'qte-kou'),
    makeNewComponentPreset('battleParry', 'qte-parry'),
    makeNewComponentPreset('inkYingMo', 'choice-yingmo'),
    makeNewComponentPreset('battleSkillBar', 'choice-skills'),
    makeNewComponentPreset('damageFloatText', 'damage-float'),
    makeNewComponentPreset('gainFloatText', 'gain-float'),
  ],
}

export const BUILTIN_SCHEMES: Overlay[] = [STATIC_SCHEME, DYNAMIC_SCHEME]

/**
 * 界面方案列表排序：内置方案（静态/动态）固定置顶，其余（项目自建 + demo 具名方案）按原有相对
 * 顺序跟后——`ensureBuiltinSchemes` 只在缺失时把内置方案 append 到 overlays 目录末尾（对象 key
 * 插入顺序），若不重排，UI 各处方案下拉/列表会看到内置方案沉底。凡是展示「界面方案」清单的地方
 * （NodeInspector 挂载/默认样式下拉、ScenarioInspector 目录列表…）都应过这层排序，保持同一顺序感。
 */
export function sortSchemeIds(ids: string[]): string[] {
  const builtinIds = BUILTIN_SCHEMES.map((s) => s.id)
  const builtin = builtinIds.filter((id) => ids.includes(id))
  const rest = ids.filter((id) => !builtinIds.includes(id))
  return [...builtin, ...rest]
}

/**
 * 界面 tab「自定义覆盖物」组 = 用户自由方案：排除 `node:*`（时间轴内容容器）与
 * `base:*`（基础覆盖物单组件方案），再走 `sortSchemeIds` 把内置方案置顶。
 */
export function listCustomSchemeIds(overlays: Record<string, Overlay> | undefined): string[] {
  return sortSchemeIds(
    Object.keys(overlays ?? {}).filter((id) => !id.startsWith('node:') && !id.startsWith(BASE_HUD_PREFIX)),
  )
}

/**
 * 界面 tab「基础覆盖物」组 = 组件库每组件一份 `base:<id>` 单组件方案；
 * 按组件库顺序排列，仅取目录里实际存在的。
 */
export function listBaseHudIds(overlays: Record<string, Overlay> | undefined): string[] {
  const all = overlays ?? {}
  return NEW_COMPONENTS.map(({ id }) => `${BASE_HUD_PREFIX}${id}`).filter((id) => all[id])
}

/**
 * 界面 tab 两个分组（自定义覆盖物 + 基础覆盖物）打平后的有序 overlay id 列表。
 * 蓝图侧所有「挑一张 overlay」的选择器（NodeInspector 的 ＋挂载 / 默认样式、
 * NodePreviewStage 的「添加控件」栏）共用此列表，保证与界面 tab 完全一致、不漂移。
 */
export function listSchemeAndBaseOverlayIds(overlays: Record<string, Overlay> | undefined): string[] {
  return [...listCustomSchemeIds(overlays), ...listBaseHudIds(overlays)]
}

/** 「+ 组件」菜单：每项 = 一个组件预设模板（顶栏 component = 该组件的顶层 id）。 */
export const NEW_COMPONENT_PRESETS: Array<{
  id: string
  label: string
  make: (childId: string) => OverlayChild
}> = [
  {
    id: 'dialogue',
    label: '字幕',
    make: (id) => makeNewComponentPreset('dialogue', id),
  },
  { id: 'inkKou', label: 'QTE · 叩击', make: (id) => makeNewComponentPreset('inkKou', id) },
  { id: 'battleParry', label: 'QTE · 防反', make: (id) => makeNewComponentPreset('battleParry', id) },
  { id: 'inkYingMo', label: '选项 · 應默', make: (id) => makeNewComponentPreset('inkYingMo', id) },
  { id: 'battleSkillBar', label: '选项 · 技能条', make: (id) => makeNewComponentPreset('battleSkillBar', id) },
  { id: 'damageFloatText', label: '飘字 · 伤害', make: (id) => makeNewComponentPreset('damageFloatText', id) },
  { id: 'gainFloatText', label: '飘字 · 增益', make: (id) => makeNewComponentPreset('gainFloatText', id) },
  { id: 'battlePlayerHpBar', label: 'HUD · 我方血条', make: (id) => makeNewComponentPreset('battlePlayerHpBar', id) },
  { id: 'battleEnemyHpBar', label: 'HUD · 敌方血条', make: (id) => makeNewComponentPreset('battleEnemyHpBar', id) },
]

/**
 * 保证基础覆盖物存在于 overlays 目录。
 *
 * `BUILTIN_SCHEMES` 与 Nodia 方案仍作为可手动挂载的预设目录存在，但不自动写入项目数据。
 * 自定义覆盖物只有作者明确创建或挂载后才进入 `ui.overlays`。
 */
export function ensureBuiltinSchemes(
  overlays: Record<string, Overlay> | undefined,
): Record<string, Overlay> {
  return ensureBaseHudSchemes({ ...(overlays ?? {}) })
}

/** 基础覆盖物 单组件方案的 child：默认参数不落盘，由组件 manifest 作为 placeholder 展示。 */
function makeBaseHudChild(componentId: string): OverlayChild {
  const preset = NEW_COMPONENT_PRESETS.find((p) => p.id === componentId)
  if (preset) return preset.make(`${componentId}-0`)
  return {
    id: `${componentId}-0`,
    component: componentId,
    layout: { ...STAGE_FILL_LAYOUT },
    trigger: { when: 'enter' },
    window: { startMs: 0 },
    inputs: {},
  }
}

/**
 * 保证「基础覆盖物」方案存在：组件库每个可用组件各一份 `base:<id>` 单组件方案（缺失才补）。
 * 这些方案锁定为单组件（编辑器侧不允许增删组件），可编辑 inputs/layout。
 */
export function ensureBaseHudSchemes(
  overlays: Record<string, Overlay>,
): Record<string, Overlay> {
  const next = { ...overlays }
  for (const { id: componentId, definition } of NEW_COMPONENTS) {
    const id = `${BASE_HUD_PREFIX}${componentId}`
    if (!next[id]) {
      next[id] = {
        id,
        title: definition.label ?? componentId,
        children: [makeBaseHudChild(componentId)],
      }
    }
  }
  return next
}
