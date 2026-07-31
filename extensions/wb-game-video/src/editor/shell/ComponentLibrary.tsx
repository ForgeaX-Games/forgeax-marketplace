/**
 * ComponentLibrary —— 界面 tab 画布右侧「组件库」。
 * 直接读取 components/new 的唯一注册清单，
 * 渲染成可拖拽 chip；拖到画布（OverlayCatalogPreview 的 stage）落地为一个 child。
 * 纯展示：不持有方案数据，落地逻辑在 stage 的 onDrop 里（读 dataTransfer 的组件 id）。
 */
import type { JSX } from 'react'
import { NEW_COMPONENTS } from '../../runtime/component-host/components/new'
import { injectStyleOnce } from '../../styles/injectStyle'

/** 拖拽 MIME：库 chip → 画布落地时用它取组件 id。 */
export const OVERLAY_PRESET_MIME = 'application/x-overlay-preset'

const LIB_CSS = `
.ocl-root { display: flex; flex-direction: column; gap: 6px; min-width: 150px; width: 168px; overflow-y: auto; }
.ocl-title { font-size: 11px; font-weight: 600; opacity: .7; margin-bottom: 2px; }
.ocl-hint { font-size: 10px; opacity: .45; margin-bottom: 4px; line-height: 1.4; }
.ocl-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 9px; border-radius: 7px; cursor: grab; user-select: none;
  font-size: 12px;
  background: var(--gc-item, rgba(255,255,255,.03));
  border: 1px solid var(--gc-line, rgba(255,255,255,.1));
  color: var(--gc-txt, #f6f1e9);
  transition: background .12s, border-color .12s;
}
.ocl-chip:hover { background: var(--gc-item-hover, rgba(255,255,255,.07)); border-color: var(--gc-accent, #c8955a); }
.ocl-chip:active { cursor: grabbing; }
.ocl-chip-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--gc-accent, #c8955a); opacity: .8; }
`

export function ComponentLibrary(): JSX.Element {
  injectStyleOnce('overlay-component-library', LIB_CSS)
  return (
    <div className="ocl-root">
      <div className="ocl-title">组件库（{NEW_COMPONENTS.length}）</div>
      <div className="ocl-hint">拖到左侧画布落地；再拖动调整组件位置。</div>
      {NEW_COMPONENTS.map(({ id, definition }) => {
        const label = definition.label ?? id
        return (
          <div
            key={id}
            className="ocl-chip"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(OVERLAY_PRESET_MIME, id)
              e.dataTransfer.setData('text/plain', label)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            title={`拖到画布添加：${label}（${id}）`}
          >
            <span className="ocl-chip-dot" />
            {label}
          </div>
        )
      })}
    </div>
  )
}
