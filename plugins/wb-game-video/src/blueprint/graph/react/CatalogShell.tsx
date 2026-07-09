/**
 * CatalogShell —— 通用「左列表 + 右预览」外壳（graph 自带，解耦自旧 forge/CatalogTabs）。
 * 供 GraphConfigView（界面/规则）等配置页复用；样式沿用旧 gc-* 暖色栏目风（仅壳子集）。
 */
import type { ReactNode } from 'react'
import { injectStyleOnce } from '../../../styles/injectStyle'
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
}: {
  icon: string
  title: string
  items: readonly T[]
  selectedId: string
  onSelect: (id: string) => void
  renderPreview: (item: T | undefined) => ReactNode
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
        </div>
        <div className="gc-list-body">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`gc-row${it.id === selectedId ? ' is-on' : ''}`}
              onClick={() => onSelect(it.id)}
            >
              <span className="gc-row-mark" aria-hidden>✓</span>
              <span className="gc-row-label">{it.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="gc-preview">{renderPreview(selected)}</section>
    </div>
  )
}
