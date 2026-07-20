/**
 * 「标签与分段」区块：同一层级共用 tabs-section SSOT + 同一套 buttonNormal border-image。
 * 供 workbench 预览（.uid-preview-stage）与原型 iframe（.gl-proto-genre-shell）共用。
 */
import { BUTTON_CHROME_TIERS, TAB_CHROME_MIN_HEIGHT, TAB_CHROME_MIN_WIDTH } from './button-chrome-spec'
import {
  previewTabsSectionHostGate,
  protoTabsSectionHostGate,
  TABS_SECTION_ITEM_CLASS,
  TABS_SECTION_PAGER_ROOT_CLASS,
  tabsSectionScopedSelectors,
  tabsSectionActiveScopedSelectors,
} from './component-chrome-semantics'

const overlayFontPx = BUTTON_CHROME_TIERS.medium.overlayFontPx
const pagerWidth = `${BUTTON_CHROME_TIERS.medium.deployWidth}px`

/** 注入 chrome 后：抹平 flat / kit 底版，统一叠字区几何（preview + proto 共用） */
export function buildTabsSectionHostCss(hostGate = previewTabsSectionHostGate()): string {
  const item = tabsSectionScopedSelectors(hostGate)
  const pagerItem = `${hostGate} .${TABS_SECTION_PAGER_ROOT_CLASS} > button`
  return [
    `${hostGate} .uid-clib-segment {`,
    ' display: flex;',
    ' flex-wrap: wrap;',
    ' align-items: center;',
    ' gap: 8px;',
    ' width: 100%;',
    ' border: 0;',
    ' background: transparent;',
    ' border-radius: 0;',
    ' overflow: visible;',
    ' padding: 0;',
    ' min-height: 0;',
    ' }',
    `${hostGate} .uid-clib-segment .${TABS_SECTION_ITEM_CLASS},`,
    `${hostGate} .uid-clib-segment span { border-right: 0; }`,
    `${hostGate} .upv-bag-tabs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }`,
    `${hostGate} .upv-shop-tabs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }`,
    `${hostGate} .upv-bag-tab,`,
    `${hostGate} .upv-bag-tab.active,`,
    `${hostGate} .upv-shop-tabs button,`,
    `${hostGate} .upv-shop-tabs button.active {`,
    ' background: transparent !important;',
    ' background-color: transparent !important;',
    ' border-color: transparent !important;',
    ' box-shadow: none !important;',
    ' }',
    `${hostGate} .uid-clib-tabs-preview .upv-bag-tab.active { color: inherit; }`,
    item,
    ' {',
    ' border-radius: 0;',
    ' background: transparent;',
    ' background-color: transparent;',
    ' border-color: transparent;',
    ' box-shadow: none;',
    ` height: ${TAB_CHROME_MIN_HEIGHT};`,
    ` min-height: ${TAB_CHROME_MIN_HEIGHT};`,
    ` max-height: ${TAB_CHROME_MIN_HEIGHT};`,
    ` min-width: ${TAB_CHROME_MIN_WIDTH};`,
    ' padding: 0 14px;',
    ' margin: 0;',
    ` font-size: ${overlayFontPx}px;`,
    ' line-height: 1;',
    ' letter-spacing: 0.04em;',
    ' text-align: center;',
    ' box-sizing: border-box;',
    ' display: inline-flex;',
    ' align-items: center;',
    ' justify-content: center;',
    ' color: rgba(242,244,247,.86);',
    ' opacity: 0.88;',
    ' filter: saturate(0.9);',
    ' transition: opacity .12s ease, filter .12s ease;',
    ' vertical-align: middle;',
    ' }',
    `${tabsSectionActiveScopedSelectors(hostGate)} {`,
    ' opacity: 1;',
    ' filter: brightness(1.1) saturate(1.06);',
    ' font-weight: 700;',
    ' color: rgba(255, 244, 220, .96);',
    ' text-shadow: 0 1px 3px rgba(0,0,0,.45);',
    ' }',
    `${pagerItem} {`,
    ` min-width: ${pagerWidth};`,
    ` max-width: ${pagerWidth};`,
    ` width: ${pagerWidth};`,
    ' padding: 0;',
    ` flex: 0 0 ${pagerWidth};`,
    ' overflow: hidden;',
    ' border-image-outset: 0;',
    ` font-size: ${BUTTON_CHROME_TIERS.compact.overlayFontPx}px;`,
    ' }',
  ].join('\n')
}

export function buildProtoTabsSectionHostCss(): string {
  return buildTabsSectionHostCss(protoTabsSectionHostGate())
}
