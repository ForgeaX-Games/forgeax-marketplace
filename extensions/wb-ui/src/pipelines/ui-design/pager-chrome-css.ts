/**
 * 分页器布局：与 tabs-section 同 medium 档 border-image（见 component-chrome-semantics）。
 * 此文件只负责固定格尺寸，底图铺法与 .upv-bag-tab / .uid-clib-segment 完全一致。
 */
import {
  PAGER_CHROME_MIN_HEIGHT,
  PAGER_CHROME_MIN_WIDTH,
  PAGER_CHROME_OVERLAY_FONT_PX,
  TAB_CHROME_MIN_HEIGHT,
} from './button-chrome-spec'
import { PREVIEW_PAGER_LAYOUT_SELECTOR } from './component-chrome-semantics'

/** tabs-section 分页格：宽 72、高与页签对齐 40px；active/inactive 必须同格 */
export function buildPreviewPagerLayoutCss(): string {
  return `${PREVIEW_PAGER_LAYOUT_SELECTOR} {` +
    ` width: ${PAGER_CHROME_MIN_WIDTH} !important;` +
    ` height: ${PAGER_CHROME_MIN_HEIGHT} !important;` +
    ` min-width: ${PAGER_CHROME_MIN_WIDTH} !important;` +
    ` max-width: ${PAGER_CHROME_MIN_WIDTH} !important;` +
    ` min-height: ${TAB_CHROME_MIN_HEIGHT} !important;` +
    ` max-height: ${TAB_CHROME_MIN_HEIGHT} !important;` +
    ` flex: 0 0 ${PAGER_CHROME_MIN_WIDTH} !important;` +
    ` padding: 0 !important;` +
    ` margin: 0 !important;` +
    ` box-sizing: border-box !important;` +
    ` display: inline-flex !important;` +
    ` align-items: center !important;` +
    ` justify-content: center !important;` +
    ` overflow: hidden !important;` +
    ` border-image-outset: 0 !important;` +
    ` font-size: ${PAGER_CHROME_OVERLAY_FONT_PX}px !important;` +
    ` line-height: 1 !important;` +
    ' }'
}

/** @deprecated 使用 buildPreviewPagerLayoutCss；border-image 由 buildPreviewButtonChromeCss medium 档统一生成 */
export function buildPreviewPagerChromeCss(): string {
  return buildPreviewPagerLayoutCss()
}
