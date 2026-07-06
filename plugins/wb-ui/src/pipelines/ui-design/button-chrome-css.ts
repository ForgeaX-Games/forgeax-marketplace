/**
 * 游戏 UI 按钮底版：CSS border-image 九宫格铺放。
 * 组件语义见 component-chrome-semantics.ts；生图规范见 docs/button-chrome-generation-spec.md
 */
import {
  BUTTON_CHROME_BORDER_WIDTH,
  BUTTON_CHROME_REPEAT,
  BUTTON_CHROME_SLICE,
  BUTTON_CHROME_TIERS,
  BUTTON_LONG_CHROME_SLICE,
  type ButtonChromeTier,
  PAGER_CHROME_BORDER_WIDTH,
  PAGER_CHROME_MIN_HEIGHT,
  PAGER_CHROME_MIN_WIDTH,
  SEGMENT_CHROME_BORDER_WIDTH,
  TAB_CHROME_BORDER_WIDTH,
} from './button-chrome-spec'
import {
  previewChromeFlatResetSelectors,
  previewChromeSelectors,
  previewGenreKitFlatResetSelectors,
  PREVIEW_BUTTON_CHROME_BINDINGS,
  previewChromeFullSelector,
  protoDialogStripChromeGate,
  protoTabsSectionChromeGate,
  tabsSectionScopedSelectors,
  dialogStripScopedSelectors,
} from './component-chrome-semantics'
import { buildDialogStripHostCss } from './dialog-strip-chrome-css'
import { buildPreviewPagerLayoutCss } from './pager-chrome-css'
import { buildTabsSectionHostCss } from './tabs-section-chrome-css'

export {
  BUTTON_CHROME_BORDER_WIDTH,
  BUTTON_CHROME_REPEAT,
  BUTTON_CHROME_SLICE,
  BUTTON_CHROME_TIERS,
  PAGER_CHROME_BORDER_WIDTH,
  PAGER_CHROME_MIN_HEIGHT,
  PAGER_CHROME_MIN_WIDTH,
  PAGER_CHROME_OVERLAY_FONT_PX,
  SEGMENT_CHROME_BORDER_WIDTH,
  TAB_CHROME_BORDER_WIDTH,
} from './button-chrome-spec'

export {
  PREVIEW_BUTTON_CHROME_BINDINGS,
  PREVIEW_PAGER_ACTIVE_SELECTOR,
  PREVIEW_PAGER_CHROME_SELECTOR,
  PREVIEW_PAGER_LAYOUT_SELECTOR,
  previewChromeFlatResetSelectors,
  previewChromeSelectors,
  previewGenreKitFlatResetSelectors,
  validatePreviewButtonChromeBindings,
  validateChromeGroupSemantics,
  TABS_SECTION_CHROME_GROUP,
  TABS_SECTION_CHROME_PROFILE,
  TABS_SECTION_CHROME_CLASS,
  TABS_SECTION_ITEM_CLASS,
  DIALOG_STRIP_CHROME_GROUP,
  DIALOG_STRIP_CHROME_CLASS,
  validateStyleTableCoverage,
  STYLE_PRESET_IDS,
} from './component-chrome-semantics'

function chromeVarName(role: 'normal' | 'primary', tier: ButtonChromeTier): string {
  if (tier === 'long') return role === 'normal' ? '--uid-btn-normal-long' : '--uid-btn-primary-long'
  return role === 'normal' ? '--uid-btn-normal' : '--uid-btn-primary'
}

function tierChromeSlice(tier: ButtonChromeTier): string {
  return tier === 'long' ? BUTTON_LONG_CHROME_SLICE : BUTTON_CHROME_SLICE
}

function chromeProps(
  varName: string,
  borderWidth: string,
  slice = BUTTON_CHROME_SLICE,
  important = false,
): string {
  const imp = important ? ' !important' : ''
  return [
    `background-image: none${imp}`,
    `background-color: transparent${imp}`,
    `border-style: solid${imp}`,
    `border-color: transparent${imp}`,
    `border-width: ${borderWidth}${imp}`,
    `border-image-source: var(${varName})${imp}`,
    `border-image-slice: ${slice}${imp}`,
    `border-image-width: ${borderWidth}${imp}`,
    `border-image-repeat: ${BUTTON_CHROME_REPEAT}${imp}`,
    `border-radius: 0${imp}`,
    `box-sizing: border-box${imp}`,
  ].join('; ')
}

export function buttonChromeCssProperties(varName: string, important = false, borderWidth = BUTTON_CHROME_BORDER_WIDTH): string {
  return chromeProps(varName, borderWidth, important)
}

export function buttonChromeCssPropertiesUrl(
  url: string,
  important = false,
  borderWidth = BUTTON_CHROME_BORDER_WIDTH,
  slice = BUTTON_CHROME_SLICE,
): string {
  const imp = important ? ' !important' : ''
  return [
    `background-image: none${imp}`,
    `background-color: transparent${imp}`,
    `border-style: solid${imp}`,
    `border-color: transparent${imp}`,
    `border-width: ${borderWidth}${imp}`,
    `border-image-source: url('${url}')${imp}`,
    `border-image-slice: ${slice}${imp}`,
    `border-image-width: ${borderWidth}${imp}`,
    `border-image-repeat: ${BUTTON_CHROME_REPEAT}${imp}`,
    `border-radius: 0${imp}`,
    `box-sizing: border-box${imp}`,
  ].join('; ')
}

function chromeRule(selectors: string, varName: string, borderWidth: string, slice = BUTTON_CHROME_SLICE): string {
  return `${selectors} { ${chromeProps(varName, borderWidth, slice)} }`
}

function groupedChromeRules(role: 'normal' | 'primary', tier: ButtonChromeTier): string {
  const varName = chromeVarName(role, tier)
  const slice = tierChromeSlice(tier)
  const groups = new Map<string, string[]>()
  for (const b of PREVIEW_BUTTON_CHROME_BINDINGS) {
    if (b.role !== role || b.tier !== tier) continue
    const borderWidth = b.borderWidth ?? BUTTON_CHROME_TIERS[b.tier].borderWidth
    const list = groups.get(borderWidth) ?? []
    list.push(previewChromeFullSelector(b))
    groups.set(borderWidth, list)
  }
  return [...groups.entries()]
    .map(([borderWidth, selectors]) => chromeRule(selectors.join(',\n'), varName, borderWidth, slice))
    .join('\n')
}

export function buttonChromeRuleBlock(selectors: string, varName: string, important = false, borderWidth = BUTTON_CHROME_BORDER_WIDTH): string {
  return `${selectors} { ${buttonChromeCssProperties(varName, important, borderWidth)} }`
}

export function buttonChromeRuleBlockUrl(
  selectors: string,
  url: string,
  important = false,
  borderWidth = BUTTON_CHROME_BORDER_WIDTH,
  slice = BUTTON_CHROME_SLICE,
): string {
  return `${selectors} { ${buttonChromeCssPropertiesUrl(url, important, borderWidth, slice)} }`
}

export function inlineButtonChromeStyle(url: string): string {
  return `${buttonChromeCssPropertiesUrl(url)};color:#fff!important;text-shadow:0 2px 5px rgba(0,0,0,.78)`
}

export function inlineButtonChromeStylePrimary(url: string): string {
  return `${buttonChromeCssPropertiesUrl(url)};color:#fff!important;font-weight:700;text-shadow:0 2px 6px rgba(0,0,0,.85)`
}

/** 对话长选项专用 ultrawide 底版（slice 6% 侧 cap，禁止复用 4:1 菜单 slice） */
export function inlineButtonChromeStyleLong(url: string): string {
  const longBorder = BUTTON_CHROME_TIERS.long.borderWidth
  return `${buttonChromeCssPropertiesUrl(url, false, longBorder, BUTTON_LONG_CHROME_SLICE)};width:100%;max-width:100%;min-height:${BUTTON_CHROME_TIERS.long.deployHeight}px;color:#fff!important;text-shadow:0 1px 3px rgba(0,0,0,.92),0 0 10px rgba(0,0,0,.55)`
}

export function inlineButtonChromeStylePrimaryLong(url: string): string {
  const longBorder = BUTTON_CHROME_TIERS.long.borderWidth
  return `${buttonChromeCssPropertiesUrl(url, false, longBorder, BUTTON_LONG_CHROME_SLICE)};width:100%;max-width:100%;min-height:${BUTTON_CHROME_TIERS.long.deployHeight}px;color:#fff!important;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.92),0 0 10px rgba(0,0,0,.55)`
}

/** 组件物料区：整图 contain 预览 + 可点开放大（勿用 border-image，透明区会穿透点击） */
export function inlineLongStripMatViewStyle(url: string): string {
  return [
    `background-image:url('${url}')`,
    'background-size:contain',
    'background-repeat:no-repeat',
    'background-position:center',
    'width:100%',
    'max-width:100%',
    `min-height:${BUTTON_CHROME_TIERS.long.deployHeight}px`,
    'aspect-ratio:21/9',
    'max-height:96px',
    'border:none',
    'padding:0',
    'box-sizing:border-box',
    'cursor:zoom-in',
    'display:block',
  ].join(';')
}

/** @deprecated 使用 previewChromeSelectors('normal','wide') */
export const PREVIEW_BUTTON_WIDE_NORMAL_SELECTORS = previewChromeSelectors('normal', 'wide')
/** @deprecated 使用 previewChromeSelectors('normal','medium') */
export const PREVIEW_BUTTON_MEDIUM_NORMAL_SELECTORS = previewChromeSelectors('normal', 'medium')
/** @deprecated 使用 previewChromeSelectors('normal','compact') */
export const PREVIEW_BUTTON_COMPACT_NORMAL_SELECTORS = previewChromeSelectors('normal', 'compact')

export const PREVIEW_BUTTON_NORMAL_SELECTORS = previewChromeSelectors('normal')

/** @deprecated 使用 previewChromeSelectors('primary','wide') */
export const PREVIEW_BUTTON_WIDE_PRIMARY_SELECTORS = previewChromeSelectors('primary', 'wide')
/** @deprecated 使用 previewChromeSelectors('primary','medium') */
export const PREVIEW_BUTTON_MEDIUM_PRIMARY_SELECTORS = previewChromeSelectors('primary', 'medium')
/** @deprecated 使用 previewChromeSelectors('primary','compact') */
export const PREVIEW_BUTTON_COMPACT_PRIMARY_SELECTORS = previewChromeSelectors('primary', 'compact')

export const PREVIEW_BUTTON_PRIMARY_SELECTORS = previewChromeSelectors('primary')

/** 原型 iframe：wide 档次按钮（不含 tabs-section / dialog-strip） */
export const PROTO_BUTTON_WIDE_NORMAL_SELECTORS = [
  '.gl-proto-genre-shell .upv-start-item:not(.primary)',
  '.gl-proto-genre-shell .upv-pause-item:not(.primary)',
  '.gl-proto-genre-shell .upv-results-btn:not(.primary)',
  '.gl-proto-genre-shell .gl-mmo-slot',
  '.gl-proto-genre-shell .upv-puzzle-dock-item',
  '.gl-proto-genre-shell .upv-puzzle-event',
].join(',\n')

/** 原型 iframe：dialog-strip long 档 */
export const PROTO_BUTTON_DIALOG_STRIP_NORMAL_SELECTORS =
  dialogStripScopedSelectors(protoDialogStripChromeGate('normal'), 'normal')
export const PROTO_BUTTON_DIALOG_STRIP_PRIMARY_SELECTORS =
  dialogStripScopedSelectors(protoDialogStripChromeGate('primary'), 'primary')

/** 原型 iframe：tabs-section medium 档（页签/筛选/分段/分页等，与 preview SSOT 同 gate） */
export const PROTO_BUTTON_TABS_SECTION_SELECTORS = tabsSectionScopedSelectors(protoTabsSectionChromeGate())

/** @deprecated 使用 PROTO_BUTTON_WIDE_NORMAL_SELECTORS + PROTO_BUTTON_TABS_SECTION_SELECTORS */
export const PROTO_BUTTON_NORMAL_SELECTORS = PROTO_BUTTON_WIDE_NORMAL_SELECTORS

export const PROTO_BUTTON_PRIMARY_SELECTORS = [
  '.gl-proto-genre-shell .upv-start-item.primary',
  '.gl-proto-genre-shell .upv-pause-item.primary',
  '.gl-proto-genre-shell .upv-results-btn.primary',
  '.gl-proto-genre-shell .upv-shop-buy',
  '.gl-proto-genre-shell .upv-puzzle-play',
  '.gl-proto-genre-shell .gl-puzzle-cta.primary',
  '.gl-proto-genre-shell .gl-fps-match-btn',
  '.gl-proto-genre-shell .gl-fps-loadout-confirm',
  '.gl-proto-genre-shell .gl-mmo-enter',
  '.gl-proto-genre-shell .gl-arpg-enter',
  '.gl-proto-genre-shell .gl-ow-bag-action',
].join(',\n')

const FLAT_RESET_PROPS =
  ' border-color: transparent !important;' +
  ' background: transparent !important;' +
  ' background-color: transparent !important;' +
  ' border-radius: 0 !important;' +
  ' box-shadow: none !important;' +
  ' }'

export function buildPreviewButtonChromeCss(): string {
  const text = 'color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.7);'
  const textPrimary = 'color: #fff; font-weight: 700; text-shadow: 0 1px 4px rgba(0,0,0,.8);'
  const flatReset = `${previewChromeFlatResetSelectors()} {${FLAT_RESET_PROPS}`
  const genreKitReset = `${previewGenreKitFlatResetSelectors()} {${FLAT_RESET_PROPS}`
  return [
    groupedChromeRules('normal', 'wide'),
    groupedChromeRules('normal', 'medium'),
    groupedChromeRules('normal', 'long'),
    `${PREVIEW_BUTTON_NORMAL_SELECTORS} { ${text} }`,
    groupedChromeRules('primary', 'wide'),
    groupedChromeRules('primary', 'medium'),
    groupedChromeRules('primary', 'long'),
    `${PREVIEW_BUTTON_PRIMARY_SELECTORS} { ${textPrimary} }`,
    flatReset,
    genreKitReset,
    buildTabsSectionHostCss(),
    buildDialogStripHostCss(),
    buildPreviewPagerLayoutCss(),
  ].join('\n')
}
