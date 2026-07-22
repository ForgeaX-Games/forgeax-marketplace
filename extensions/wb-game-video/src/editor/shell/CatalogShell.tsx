/**
 * CatalogShell —— 通用「左列表 + 右预览」外壳（graph 自带，解耦自旧 forge/CatalogTabs）。
 * 供 GraphConfigView（界面/规则）等配置页复用；样式沿用旧 gc-* 暖色栏目风（仅壳子集）。
 *
 * 两种列表形态（同一套 gc-* 皮）：
 *  - **扁平**：item 无 `children` → 一行可选（规则 tab：实体/变量/…）。
 *  - **分组/树**：item 带 `children` → 渲成可折叠组头 + 缩进叶子行，选中永远落在叶子
 *    （界面 tab：全局 HUD 组头 → 各方案叶子）。组头可挂 `action`（如「+方案」）。
 * `selectedId` / `renderPreview(selected)` 都以「扁平化后的叶子」为准，两形态一致。
 */
import { useState, type ReactNode } from 'react'
import { injectStyleOnce } from '../../styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'

export interface CatalogItem {
  id: string
  label: string
  /** 有 children ⇒ 本项是分组头（本身不可选），children 为可选叶子。 */
  children?: CatalogItem[]
  /** 叶子/行右侧角标（如引用数）。 */
  badge?: ReactNode
  /** 分组头右侧操作槽（如「+方案」按钮）。仅分组头用。 */
  action?: ReactNode
}

/** 扁平化出所有可选叶子（无 children 的项即自身叶子）。 */
function leavesOf(items: readonly CatalogItem[]): CatalogItem[] {
  return items.flatMap((it) => (it.children ? it.children : [it]))
}

function Leaf({
  item,
  selectedId,
  onSelect,
  indented = false,
  renderRowActions,
}: {
  item: CatalogItem
  selectedId: string
  onSelect: (id: string) => void
  indented?: boolean
  renderRowActions?: (id: string) => ReactNode
}): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`gc-row${indented ? ' is-leaf' : ''}${item.id === selectedId ? ' is-on' : ''}`}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(item.id)
        }
      }}
    >
      <span className="gc-row-mark" aria-hidden>✓</span>
      <span className="gc-row-label">{item.label}</span>
      {item.badge != null ? <span className="gc-row-badge">{item.badge}</span> : null}
      {renderRowActions && (
        <span className="gc-row-actions" onClick={(e) => e.stopPropagation()}>
          {renderRowActions(item.id)}
        </span>
      )}
    </div>
  )
}

function Group({
  group,
  selectedId,
  onSelect,
  renderRowActions,
}: {
  group: CatalogItem
  selectedId: string
  onSelect: (id: string) => void
  renderRowActions?: (id: string) => ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const children = group.children ?? []
  return (
    <div className="gc-group">
      <div className="gc-group-head">
        <button
          type="button"
          className="gc-group-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="gc-group-caret" aria-hidden>{open ? '▾' : '▸'}</span>
          <span className="gc-group-label">{group.label}</span>
          <span className="gc-group-count">{children.length}</span>
        </button>
        {group.action != null ? <span className="gc-group-action">{group.action}</span> : null}
      </div>
      {open ? (
        <div className="gc-group-children">
          {children.length === 0 ? (
            <div className="gc-group-empty">暂无方案</div>
          ) : (
            children.map((c) => (
              <Leaf key={c.id} item={c} selectedId={selectedId} onSelect={onSelect} renderRowActions={renderRowActions} indented />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export function CatalogShell({
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
  items: readonly CatalogItem[]
  selectedId: string
  onSelect: (id: string) => void
  renderPreview: (item: CatalogItem | undefined) => ReactNode
  /** 列表标题栏右侧动作槽（如「＋新建」入口）。 */
  headAction?: ReactNode
  /** 每行右侧的行内动作（hover/选中才显）；返回 null 则该行无动作。 */
  renderRowActions?: (id: string) => ReactNode
}): JSX.Element {
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  const leaves = leavesOf(items)
  const selected = leaves.find((i) => i.id === selectedId)
  return (
    <div className="gc-tab">
      <aside className="gc-list" aria-label={title}>
        <div className="gc-list-head">
          <span className="gc-list-ico" aria-hidden>{icon}</span>
          <span className="gc-list-title">{title}</span>
          <span className="gc-list-count">{leaves.length}</span>
          {headAction && <span className="gc-list-head-action">{headAction}</span>}
        </div>
        <div className="gc-list-body">
          {items.map((it) =>
            it.children ? (
              <Group key={it.id} group={it} selectedId={selectedId} onSelect={onSelect} renderRowActions={renderRowActions} />
            ) : (
              <Leaf key={it.id} item={it} selectedId={selectedId} onSelect={onSelect} renderRowActions={renderRowActions} />
            ),
          )}
        </div>
      </aside>
      <section className="gc-preview">{renderPreview(selected)}</section>
    </div>
  )
}
