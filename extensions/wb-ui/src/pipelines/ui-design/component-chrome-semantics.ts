/**
 * 组件语义 → 按钮底版（border-image）绑定 SSOT。
 * 所有预览/组件库中套用 buttonNormal / buttonPrimary 的 DOM 必须在此登记。
 */
import type { StylePresetId } from './model'
import { STYLE_PRESETS } from './model'
import { BUTTON_CHROME_TIERS, type ButtonChromeTier } from './button-chrome-spec'

export type ButtonChromeRole = 'normal' | 'primary'

export interface PreviewButtonChromeBinding {
  id: string
  component: string
  role: ButtonChromeRole
  tier: ButtonChromeTier
  /** 相对 `.uid-preview-stage.uid-chrome-btn-{role}` 的选择器 */
  selector: string
  /** 所属 UI 语义组（同组必须同 tier + 同 normal/primary 规则） */
  chromeGroup?: string
  /** @deprecated tabs-section 禁止单独 override；同组必须共用 tier border-width */
  borderWidth?: string
}

/**
 * 「标签与分段」区块 SSOT：页签 / 筛选 / 分段 / 分页 同一层级。
 * - 全部切换格（含 active）→ **同一 buttonNormal 底版**
 * - active 仅 CSS 强调（亮度/字重），**禁止** 换 buttonPrimary 底图
 * - 禁止分页单独走 background-fill、compact 档或 border-width override
 */
export const TABS_SECTION_CHROME_GROUP = 'tabs-section'

/** 页签/筛选/分段/分页共用：normal+primary 成对注入后才启用 border-image */
export const TABS_SECTION_CHROME_CLASS = 'uid-chrome-tabs-section'

/** 同层级切换控件统一 DOM 钩子 — chrome 只认这一类，禁止按组件类型分叉 */
export const TABS_SECTION_ITEM_CLASS = 'uid-clib-tabs-section-item'

/** 交互屏 / 原型里尚未加 item class 的 legacy 切换控件（与 item class 同语义） */
export const TABS_SECTION_LEGACY_SWITCH_SELECTORS = [
  '.upv-bag-tab',
  '.uid-clib-segment span',
  '.uid-chrome-pager > button',
  '.upv-shop-tabs button',
  '.gl-fps-topnav button',
  '.gl-fps-loadout-tabs button',
  '.gl-surv-topnav button',
  '.gl-arpg-tabs button',
  '.gl-race-track-topnav button',
  '.upv-map-filter button',
] as const

export const PROTO_GENRE_SHELL_CLASS = 'gl-proto-genre-shell'

export const TABS_SECTION_PAGER_ROOT_CLASS = 'uid-chrome-pager'

/** SSOT：tabs-section 全部切换格选择器（显式 class + legacy hooks） */
export function tabsSectionSwitchSelectors(): string {
  return [`.${TABS_SECTION_ITEM_CLASS}`, ...TABS_SECTION_LEGACY_SWITCH_SELECTORS].join(', ')
}

export function tabsSectionScopedSelectors(gate: string): string {
  return tabsSectionSwitchSelectors()
    .split(', ')
    .map((sel) => `${gate} ${sel}`)
    .join(',\n')
}

export function tabsSectionActiveScopedSelectors(gate: string): string {
  return tabsSectionSwitchSelectors()
    .split(', ')
    .map((sel) => `${gate} ${sel}.active`)
    .join(',\n')
}

export function tabsSectionItemClassNames(baseClass = '', active = false): string {
  const parts = [TABS_SECTION_ITEM_CLASS, baseClass, active ? 'active' : ''].filter(Boolean)
  return parts.join(' ')
}

export function previewTabsSectionHostGate(): string {
  return `.uid-preview-stage.${TABS_SECTION_CHROME_CLASS}`
}

export function protoTabsSectionHostGate(): string {
  return `.${PROTO_GENRE_SHELL_CLASS}.${TABS_SECTION_CHROME_CLASS}`
}

export function previewTabsSectionChromeGate(): string {
  return `${previewTabsSectionHostGate()}.uid-chrome-btn-normal`
}

export function protoTabsSectionChromeGate(): string {
  return `${protoTabsSectionHostGate()}.uid-chrome-btn-normal`
}

export const TABS_SECTION_CHROME_PROFILE = {
  group: TABS_SECTION_CHROME_GROUP,
  label: '标签与分段',
  tier: 'medium' as ButtonChromeTier,
  /** 未选中 / 选中均用 buttonNormal；选中态不走 buttonPrimary */
  inactiveRole: 'normal' as ButtonChromeRole,
  activeRole: 'normal' as ButtonChromeRole,
  activeEmphasis: 'css-only' as const,
  memberIds: ['tabs-section-item'] as const,
}

/**
 * 对话长选项 SSOT：整行宽横条，专用 ultrawide long 底版（禁止拉伸 4:1 菜单按钮）。
 * normal / primary 成对；primary 仅 cap/色调强调，中心 plain 区必须保持可读。
 */
export const DIALOG_STRIP_CHROME_GROUP = 'dialog-strip'

export const DIALOG_STRIP_CHROME_CLASS = 'uid-chrome-dialog-strip'

export const DIALOG_STRIP_SWITCH_SELECTORS = [
  '.upv-dialog-opt:not(.primary)',
  '.upv-dialog-opt.primary',
] as const

export function dialogStripSwitchSelectors(role?: ButtonChromeRole): string {
  if (role === 'normal') return '.upv-dialog-opt:not(.primary)'
  if (role === 'primary') return '.upv-dialog-opt.primary'
  return DIALOG_STRIP_SWITCH_SELECTORS.join(', ')
}

export function dialogStripScopedSelectors(gate: string, role?: ButtonChromeRole): string {
  return dialogStripSwitchSelectors(role)
    .split(', ')
    .map((sel) => `${gate} ${sel}`)
    .join(',\n')
}

export function previewDialogStripHostGate(): string {
  return `.uid-preview-stage.${DIALOG_STRIP_CHROME_CLASS}`
}

export function protoDialogStripHostGate(): string {
  return `.${PROTO_GENRE_SHELL_CLASS}.${DIALOG_STRIP_CHROME_CLASS}`
}

export function previewDialogStripChromeGate(role: ButtonChromeRole): string {
  const assetGate = role === 'normal' ? 'uid-chrome-btn-normal-long' : 'uid-chrome-btn-primary-long'
  return `${previewDialogStripHostGate()}.${assetGate}`
}

export function protoDialogStripChromeGate(role: ButtonChromeRole): string {
  const assetGate = role === 'normal' ? 'uid-chrome-btn-normal-long' : 'uid-chrome-btn-primary-long'
  return `${protoDialogStripHostGate()}.${assetGate}`
}

export const DIALOG_STRIP_CHROME_PROFILE = {
  group: DIALOG_STRIP_CHROME_GROUP,
  label: '对话长选项',
  tier: 'long' as ButtonChromeTier,
  memberIds: ['dialog-secondary', 'dialog-primary'] as const,
}

/** 交互预览 + 组件库中共用的 chrome 绑定 */
export const PREVIEW_BUTTON_CHROME_BINDINGS: PreviewButtonChromeBinding[] = [
  // ── wide / normal ──
  { id: 'menu-secondary', component: '主菜单次级入口', role: 'normal', tier: 'wide', selector: '.upv-start-item:not(.primary)' },
  { id: 'pause-secondary', component: '暂停菜单次级项', role: 'normal', tier: 'wide', selector: '.upv-pause-item:not(.primary)' },
  { id: 'results-secondary', component: '结算屏次级按钮', role: 'normal', tier: 'wide', selector: '.upv-results-btn:not(.primary)' },
  { id: 'notify-prompt', component: '通知/确认弹窗按钮', role: 'normal', tier: 'wide', selector: '.uid-clib-notify-preview .uid-clib-notice.prompt button' },
  // ── long — dialog-strip（整行对话选项，专用 ultrawide 长条底版）──
  {
    id: 'dialog-secondary',
    component: '对话选项（非主选）',
    role: 'normal',
    tier: 'long',
    selector: '.upv-dialog-opt:not(.primary)',
    chromeGroup: DIALOG_STRIP_CHROME_GROUP,
  },
  // ── medium — tabs-section（页签 / 筛选 / 分段 / 分页 / 商店页签 / 顶栏页签 等全部切换格）──
  {
    id: 'tabs-section-item',
    component: '标签与分段·全部切换格（页签/筛选/分段/分页/原型屏内页签）',
    role: 'normal',
    tier: 'medium',
    selector: tabsSectionSwitchSelectors(),
    chromeGroup: TABS_SECTION_CHROME_GROUP,
  },
  // ── wide / primary ──
  { id: 'menu-primary', component: '主菜单 CTA', role: 'primary', tier: 'wide', selector: '.upv-start-item.primary' },
  { id: 'fps-match', component: 'FPS 开始匹配', role: 'primary', tier: 'wide', selector: '.gl-fps-match-btn' },
  { id: 'fps-loadout-confirm', component: 'FPS 配装确认', role: 'primary', tier: 'wide', selector: '.gl-fps-loadout-confirm' },
  { id: 'pause-primary', component: '暂停菜单主操作', role: 'primary', tier: 'wide', selector: '.upv-pause-item.primary' },
  { id: 'results-primary', component: '结算屏主 CTA', role: 'primary', tier: 'wide', selector: '.upv-results-btn.primary' },
  { id: 'shop-buy', component: '商店购买按钮', role: 'primary', tier: 'wide', selector: '.upv-shop-buy' },
  {
    id: 'dialog-primary',
    component: '对话主选项',
    role: 'primary',
    tier: 'long',
    selector: '.upv-dialog-opt.primary',
    chromeGroup: DIALOG_STRIP_CHROME_GROUP,
  },
  { id: 'ow-bag-action', component: '开放世界背包操作', role: 'primary', tier: 'wide', selector: '.gl-ow-bag-action' },
]

export const PREVIEW_PAGER_CELL_SELECTOR =
  `${previewTabsSectionChromeGate()} .${TABS_SECTION_PAGER_ROOT_CLASS} > button`

/** @deprecated tabs-section active 不再换 primary 底图 */
export const PREVIEW_PAGER_ACTIVE_SELECTOR = PREVIEW_PAGER_CELL_SELECTOR

export const PREVIEW_PAGER_LAYOUT_SELECTOR =
  `${previewTabsSectionHostGate()} .${TABS_SECTION_PAGER_ROOT_CLASS} > button`

/** @deprecated 使用 PREVIEW_PAGER_CELL_SELECTOR */
export const PREVIEW_PAGER_CHROME_SELECTOR = PREVIEW_PAGER_CELL_SELECTOR

export const STYLE_PRESET_IDS: StylePresetId[] = STYLE_PRESETS.map((p) => p.id)

export function previewChromeStageClass(role: ButtonChromeRole): string {
  return `.uid-preview-stage.uid-chrome-btn-${role}`
}

export function previewChromeStageGate(binding: PreviewButtonChromeBinding): string {
  if (binding.chromeGroup === TABS_SECTION_CHROME_GROUP) {
    return previewTabsSectionChromeGate()
  }
  if (binding.chromeGroup === DIALOG_STRIP_CHROME_GROUP) {
    return previewDialogStripChromeGate(binding.role)
  }
  return previewChromeStageClass(binding.role)
}

export function previewChromeFullSelector(binding: PreviewButtonChromeBinding): string {
  if (binding.chromeGroup === TABS_SECTION_CHROME_GROUP) {
    return tabsSectionScopedSelectors(previewChromeStageGate(binding))
  }
  if (binding.chromeGroup === DIALOG_STRIP_CHROME_GROUP) {
    return dialogStripScopedSelectors(previewChromeStageGate(binding), binding.role)
  }
  return `${previewChromeStageGate(binding)} ${binding.selector}`
}

export function previewChromeSelectors(role: ButtonChromeRole, tier?: ButtonChromeTier): string {
  return PREVIEW_BUTTON_CHROME_BINDINGS
    .filter((b) => b.role === role && (tier == null || b.tier === tier))
    .map(previewChromeFullSelector)
    .join(',\n')
}

export function bindingsInChromeGroup(group: string): PreviewButtonChromeBinding[] {
  return PREVIEW_BUTTON_CHROME_BINDINGS.filter((b) => b.chromeGroup === group)
}

/** 校验同组组件是否共用 tier 与 normal/primary 语义 */
export function validateChromeGroupSemantics(): string[] {
  const errors: string[] = []
  const groups = new Map<string, PreviewButtonChromeBinding[]>()
  for (const b of PREVIEW_BUTTON_CHROME_BINDINGS) {
    if (!b.chromeGroup) continue
    const list = groups.get(b.chromeGroup) ?? []
    list.push(b)
    groups.set(b.chromeGroup, list)
  }
  for (const [group, list] of groups) {
    const tiers = new Set(list.map((b) => b.tier))
    if (tiers.size > 1) errors.push(`chrome group "${group}" mixes tiers: ${[...tiers].join(', ')}`)
    if (group === TABS_SECTION_CHROME_GROUP) {
      if (list.length !== TABS_SECTION_CHROME_PROFILE.memberIds.length) {
        errors.push(`tabs-section must have exactly one normal binding for all switch cells`)
      }
      if (list.some((b) => b.role !== 'normal')) {
        errors.push(`tabs-section must not use buttonPrimary chrome — active is CSS-only`)
      }
      const borderOverrides = new Set(
        list.map((b) => b.borderWidth ?? BUTTON_CHROME_TIERS[b.tier].borderWidth),
      )
      if (borderOverrides.size > 1) errors.push(`chrome group "${group}" mixes border-width overrides`)
      continue
    }
    if (group === DIALOG_STRIP_CHROME_GROUP) {
      if (list.length !== DIALOG_STRIP_CHROME_PROFILE.memberIds.length) {
        errors.push(`dialog-strip must have normal + primary long bindings`)
      }
      if (!list.some((b) => b.role === 'normal') || !list.some((b) => b.role === 'primary')) {
        errors.push(`dialog-strip must include both normal-long and primary-long bindings`)
      }
      if (list.some((b) => b.tier !== 'long')) {
        errors.push(`dialog-strip bindings must use long tier — forbidden to stretch 4:1 menu plates`)
      }
      continue
    }
    const roles = new Set(list.map((b) => b.role))
    if (!roles.has('normal') || !roles.has('primary')) {
      errors.push(`chrome group "${group}" must include both normal and primary bindings`)
    }
    const borderOverrides = new Set(
      list.map((b) => b.borderWidth ?? BUTTON_CHROME_TIERS[b.tier].borderWidth),
    )
    if (borderOverrides.size > 1) {
      errors.push(`chrome group "${group}" mixes border-width overrides`)
    }
  }
  const tabs = bindingsInChromeGroup(TABS_SECTION_CHROME_GROUP)
  if (tabs.length !== TABS_SECTION_CHROME_PROFILE.memberIds.length) {
    errors.push(`tabs-section member count mismatch`)
  }
  for (const id of TABS_SECTION_CHROME_PROFILE.memberIds) {
    const b = tabs.find((x) => x.id === id)
    if (!b) errors.push(`tabs-section missing binding: ${id}`)
    else if (b.tier !== TABS_SECTION_CHROME_PROFILE.tier) {
      errors.push(`tabs-section ${id} tier must be ${TABS_SECTION_CHROME_PROFILE.tier}`)
    }
  }
  return errors
}

export function previewChromeFlatResetSelectors(): string {
  return PREVIEW_BUTTON_CHROME_BINDINGS.map(previewChromeFullSelector).join(',\n')
}

export function previewGenreKitFlatResetSelectors(): string {
  const genreScoped = PREVIEW_BUTTON_CHROME_BINDINGS.map((b) => {
    if (b.chromeGroup === TABS_SECTION_CHROME_GROUP) {
      return tabsSectionScopedSelectors(`${previewChromeStageGate(b)} .uid-clib-genre-preview`)
    }
    if (b.chromeGroup === DIALOG_STRIP_CHROME_GROUP) {
      return dialogStripScopedSelectors(`${previewDialogStripChromeGate(b.role)} .uid-clib-genre-preview`, b.role)
    }
    return `${previewChromeStageGate(b)} .uid-clib-genre-preview ${b.selector}`
  })
  return genreScoped.join(',\n')
}

export function validatePreviewButtonChromeBindings(): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const b of PREVIEW_BUTTON_CHROME_BINDINGS) {
    if (ids.has(b.id)) errors.push(`duplicate binding id: ${b.id}`)
    ids.add(b.id)
    if (!b.selector.trim()) errors.push(`empty selector: ${b.id}`)
  }
  return [...errors, ...validateChromeGroupSemantics()]
}

export function validateStyleTableCoverage(
  tables: Record<string, unknown>[],
  presetIds: readonly string[] = STYLE_PRESET_IDS,
): string[] {
  const errors: string[] = []
  for (const id of presetIds) {
    for (let i = 0; i < tables.length; i += 1) {
      if (!(id in tables[i])) errors.push(`missing preset "${id}" in style table index ${i}`)
    }
  }
  return errors
}
