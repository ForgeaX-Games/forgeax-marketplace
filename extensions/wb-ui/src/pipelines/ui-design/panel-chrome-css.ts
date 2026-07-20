/**
 * 面板框体 9-slice：方形 panel_texture 作为 border-image 铺到矩形宿主，禁止整图拉伸。
 */
export const PANEL_FRAME_SLICE = '22% 22% fill'
export const PANEL_FRAME_BORDER_WIDTH = '32px 36px'
export const PANEL_FRAME_REPEAT = 'stretch'

export function panelFrameCssPropertiesUrl(url: string, important = false): string {
  const imp = important ? ' !important' : ''
  return [
    `background-image: none${imp}`,
    `background-color: rgba(0,0,0,.18)${imp}`,
    `border-style: solid${imp}`,
    `border-color: transparent${imp}`,
    `border-width: ${PANEL_FRAME_BORDER_WIDTH}${imp}`,
    `border-image-source: url('${url}')${imp}`,
    `border-image-slice: ${PANEL_FRAME_SLICE}${imp}`,
    `border-image-width: ${PANEL_FRAME_BORDER_WIDTH}${imp}`,
    `border-image-repeat: ${PANEL_FRAME_REPEAT}${imp}`,
    `border-radius: 0${imp}`,
    `box-sizing: border-box${imp}`,
  ].join('; ')
}

export function inlinePanelFrameStyle(url: string): string {
  return `${panelFrameCssPropertiesUrl(url)};width:100%;min-height:152px`
}

export function buildPreviewPanelFrameCss(): string {
  return [
    `.uid-preview-stage.uid-chrome-panel-frame .uid-clib-panel-preview[data-uid-asset-view="panelTexture"] {`,
    '  background-image: none;',
    '  background-color: rgba(0,0,0,.18);',
    `  border-width: ${PANEL_FRAME_BORDER_WIDTH};`,
    '  border-style: solid;',
    '  border-color: transparent;',
    '  border-image-source: var(--uid-panel-texture);',
    `  border-image-slice: ${PANEL_FRAME_SLICE};`,
    `  border-image-width: ${PANEL_FRAME_BORDER_WIDTH};`,
    `  border-image-repeat: ${PANEL_FRAME_REPEAT};`,
    '  border-radius: 0;',
    '  background-size: unset;',
    '}',
    `.uid-preview-stage.uid-chrome-panel-frame .uid-clib-mini-card,`,
    `.uid-preview-stage.uid-chrome-panel-frame .uid-clib-notify-preview .uid-clib-notice {`,
    '  background-image: none;',
    `  border-width: ${PANEL_FRAME_BORDER_WIDTH};`,
    '  border-style: solid;',
    '  border-color: transparent;',
    '  border-image-source: var(--uid-panel-texture);',
    `  border-image-slice: ${PANEL_FRAME_SLICE};`,
    `  border-image-width: ${PANEL_FRAME_BORDER_WIDTH};`,
    `  border-image-repeat: ${PANEL_FRAME_REPEAT};`,
    '  border-radius: 0;',
    '}',
  ].join('\n')
}
