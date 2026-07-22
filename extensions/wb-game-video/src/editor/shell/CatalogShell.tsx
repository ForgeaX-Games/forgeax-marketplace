/**
 * CatalogShell —— 通用「左列表 + 右预览」外壳（graph 自带，解耦自旧 forge/CatalogTabs）。
 * 供 GraphConfigView（界面/规则）等配置页复用；样式沿用旧 gc-* 暖色栏目风（仅壳子集）。
 */
import type { ReactNode } from 'react'
import { injectStyleOnce } from '../../styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'

export interface CatalogItem {
  id: string
  label: string
}

export function CatalogShell<T extends CatalogItem>({
  icon,
  title,
  items,
  selectedId,
  onSelect,
  renderPreview,
  headAction,
  renderRowActions,
}: {
  icon: string
  title: string
  items: readonly T[]
  selectedId: string
  onSelect: (id: string) => void
  renderPreview: (item: T | undefined) => ReactNode
  /** 列表标题栏右侧动作槽（如「＋新建」入口）。 */
  headAction?: ReactNode
  /** 每行右侧的行内动作（hover/选中才显）；返回 null 则该行无动作。 */
  renderRowActions?: (id: string) => ReactNode
}) {
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  const selected = items.find((i) => i.id === selectedId)
  return (
    <div className="gc-tab">
      <aside className="gc-list" aria-label={title}>
        <div className="gc-list-head">
          <span className="gc-list-ico" aria-hidden>{icon}</span>
          <span className="gc-list-title">{title}</span>
          <span className="gc-list-count">{items.length}</span>
          {headAction && <span className="gc-list-head-action">{headAction}</span>}
        </div>
        <div className="gc-list-body">
          {items.map((it) => (
            <div
              key={it.id}
              role="button"
              tabIndex={0}
              className={`gc-row${it.id === selectedId ? ' is-on' : ''}`}
              onClick={() => onSelect(it.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(it.id)
                }
              }}
            >
              <span className="gc-row-mark" aria-hidden>✓</span>
              <span className="gc-row-label">{it.label}</span>
              {renderRowActions && (
                <span className="gc-row-actions" onClick={(e) => e.stopPropagation()}>
                  {renderRowActions(it.id)}
                </span>
              )}
            </div>
          ))}
        </div>
      </aside>
      <section className="gc-preview">{renderPreview(selected)}</section>
    </div>
  )
}
