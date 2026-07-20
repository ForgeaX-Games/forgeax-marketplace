/**
 * 对话长选项：专用 long 档 border-image + 叠字可读性保护层。
 * 禁止复用 4:1 菜单短底版拉伸至整行宽度。
 */
import { BUTTON_CHROME_TIERS, DIALOG_STRIP_CHROME_MIN_HEIGHT } from './button-chrome-spec'
import {
  DIALOG_STRIP_CHROME_CLASS,
  previewDialogStripHostGate,
  protoDialogStripHostGate,
} from './component-chrome-semantics'

const overlayFontPx = BUTTON_CHROME_TIERS.long.overlayFontPx

const dialogOptSelectors = (hostGate: string) => [
  `${hostGate} .upv-dialog-opt`,
  `${hostGate} .gl-arpg-dialog-opt`,
].join(',\n')

/** chrome 注入后：整行宽、左对齐叠字、暗色 scrim 保证文字不被花纹底版淹没 */
export function buildDialogStripHostCss(hostGate = previewDialogStripHostGate()): string {
  const opts = dialogOptSelectors(hostGate)
  return [
    `${hostGate} .upv-dialog-options,`,
    `${hostGate} .gl-arpg-dialog-choices {`,
    ' display: flex;',
    ' flex-direction: column;',
    ' align-items: stretch;',
    ' gap: 10px;',
    ' width: 100%;',
    ' }',
    `${opts} {`,
    ' position: relative;',
    ' isolation: isolate;',
    ' width: 100%;',
    ' max-width: 100%;',
    ' box-sizing: border-box;',
    ` min-height: ${DIALOG_STRIP_CHROME_MIN_HEIGHT};`,
    ` height: ${DIALOG_STRIP_CHROME_MIN_HEIGHT};`,
    ' padding: 0 28px 0 22px;',
    ' margin: 0;',
    ' border-radius: 0;',
    ' background: transparent;',
    ' background-color: transparent;',
    ' border-color: transparent;',
    ' box-shadow: none;',
    ` font-size: ${overlayFontPx}px;`,
    ' font-weight: 700;',
    ' line-height: 1.2;',
    ' letter-spacing: 0.02em;',
    ' text-align: left;',
    ' display: flex;',
    ' align-items: center;',
    ' justify-content: flex-start;',
    ' gap: 10px;',
    ' color: rgba(255, 252, 244, .96);',
    ' text-shadow: 0 1px 2px rgba(0,0,0,.92), 0 0 12px rgba(0,0,0,.55);',
    ' overflow: hidden;',
    ' white-space: nowrap;',
    ' text-overflow: ellipsis;',
    ' }',
    `${opts}::before {`,
    ' content: "";',
    ' position: absolute;',
    ' inset: 2px 4px;',
    ' border-radius: 2px;',
    ' pointer-events: none;',
    ' z-index: 0;',
    ' background: linear-gradient(90deg, rgba(8,10,16,.72) 0%, rgba(8,10,16,.48) 38%, rgba(8,10,16,.18) 62%, transparent 88%);',
    ' }',
    `${opts}.primary::before {`,
    ' background: linear-gradient(90deg, rgba(6,8,12,.78) 0%, rgba(10,12,18,.52) 42%, rgba(12,14,20,.22) 68%, transparent 90%);',
    ' }',
    `${opts}.leave { opacity: .82; font-weight: 600; }`,
    `${opts} > * { position: relative; z-index: 1; }`,
    `${opts} .gl-arpg-dialog-opt-mark {`,
    ' flex-shrink: 0;',
    ' text-shadow: inherit;',
    ' }',
  ].join('\n')
}

export function buildProtoDialogStripHostCss(): string {
  return buildDialogStripHostCss(protoDialogStripHostGate())
}
