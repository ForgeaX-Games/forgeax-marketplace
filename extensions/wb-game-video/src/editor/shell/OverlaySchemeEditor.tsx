/**
 * OverlaySchemeEditor —— 单个「界面方案」（overlay）的展示 + 编辑。
 * 右栏两列：左 = 标题 + 画布（拖拽定位、选中）+ 组件清单（仅显示 + 选中联动，不含参数配置）；
 * 右 = 组件库（拖 chip 落地）。组件增删改经回调交给持有 scenario.ui.overlays 的上层（GraphConfigView）。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { Entity, Layout, Overlay, Variable } from '../../runtime/schema/graph-schema'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { ComponentLibrary } from './ComponentLibrary'
import { componentTypeLabel } from './editors'

const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
/** 组件行的删除 × ——小而醒目。 */
const rowDelBtn: CSSProperties = {
  flex: 'none',
  color: '#ff6b6b',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: '0 4px',
}

/** 引用角标：被 N 个节点挂载引用；0 = 未被引用（灰）。 */
export function UsageBadge({ count }: { count: number }): JSX.Element {
  const used = count > 0
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        background: used ? 'rgba(80,180,120,0.16)' : 'rgba(255,255,255,0.06)',
        color: used ? '#7fdda6' : '#8a8a8a',
        border: `1px solid ${used ? 'rgba(80,180,120,0.4)' : 'rgba(255,255,255,0.12)'}`,
      }}
      title={used ? `被 ${count} 个节点的 overlayNodes 引用` : '资源池里的闲置界面包（可保留）'}
    >
      {used ? `被 ${count} 个节点引用` : '未被引用'}
    </span>
  )
}

export interface OverlaySchemeEditorProps {
  overlayId: string
  overlay: Overlay
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  usageCount: number
  /** 锁定态（基础覆盖物单组件方案）：只可编辑 layout，不允许增删组件、不显组件库/删除。 */
  locked?: boolean
  onRename: (title: string) => void
  onRemove: () => void
  /** 组件库拖到画布落地：presetId + 归一落点；返回新 child id（用于选中）。 */
  onAddChild: (presetId: string, layout?: Partial<Layout>) => string | undefined | void
  onRemoveChild: (childId: string) => void
  onPatchChild: (
    childId: string,
    patch: { inputs?: Record<string, unknown>; component?: string; layout?: Partial<Layout> },
  ) => void
}

export function OverlaySchemeEditor({
  overlayId,
  overlay,
  entities,
  variables,
  usageCount,
  locked = false,
  onRename,
  onRemove,
  onAddChild,
  onRemoveChild,
  onPatchChild,
}: OverlaySchemeEditorProps): JSX.Element {
  const [selectedChildId, setSelectedChildId] = useState('')
  // 交互热区重叠冲突（DOM 实测，来自画布回调）——组件清单里对应行标红。
  const [warnIds, setWarnIds] = useState<Set<string>>(() => new Set())

  // Backspace/Delete 删除选中组件；经 onRemoveChild→setMeta 天然进 zundo 撤销历史。锁定态（基础覆盖物）不删。
  // 护栏：输入框/下拉/可编辑区、以及焦点在左侧方案列表（.gc-list）内一律放行给它们。
  // 选中组件的方向键 = 微调位置，由画布 OverlayCatalogPreview 处理；切换选中交回鼠标点选 / 左侧列表上下键。
  useEffect(() => {
    if (locked) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (!selectedChildId) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      if (t?.closest?.('.gc-list')) return
      e.preventDefault()
      onRemoveChild(selectedChildId)
      setSelectedChildId('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedChildId, onRemoveChild, locked])

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, overflow: 'auto', fontSize: 12, flex: 1, minWidth: 0 }}>
      {/* ── 左列：标题 + 画布 + 组件清单 ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <input
            value={overlay.title ?? ''}
            placeholder={overlayId}
            onChange={(e) => onRename(e.target.value)}
            style={{ flex: 1, fontWeight: 600 }}
          />
          <UsageBadge count={usageCount} />
          {!locked && <button style={del} onClick={onRemove}>删除</button>}
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>
          {overlayId}
          {locked && <span style={{ marginLeft: 8, color: '#c8955a' }}>· 基础组件方案（单组件，不可增删）</span>}
        </div>

        <OverlayCatalogPreview
          overlay={overlay}
          entities={entities}
          variables={variables}
          selectedChildId={selectedChildId}
          onSelectChild={setSelectedChildId}
          onAddChild={
            locked
              ? undefined
              : (presetId, layout) => {
                  const id = onAddChild(presetId, layout)
                  if (typeof id === 'string') setSelectedChildId(id)
                }
          }
          onPatchChildLayout={(childId, patch) => onPatchChild(childId, { layout: patch })}
          onPatchChildInputs={(childId, inputs) => onPatchChild(childId, { inputs })}
          onWarnChange={setWarnIds}
        />

        {/* 组件清单：仅显示画布里有哪些组件 + 与画布双向选中，不含参数配置。 */}
        <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>组件（{overlay.children.length}）</div>
          {overlay.children.length === 0 && (
            <div style={{ fontSize: 11, opacity: 0.5 }}>从右侧组件库拖组件到画布添加。</div>
          )}
          {overlay.children.map((child) => {
            const selected = child.id === selectedChildId
            const warn = warnIds.has(child.id)
            return (
              <div
                key={child.id}
                onPointerDown={() => setSelectedChildId(child.id)}
                title={child.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '5px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  border: `1px solid ${warn ? '#ff6b6b' : selected ? 'var(--gc-accent, #c8955a)' : 'transparent'}`,
                  background: selected ? 'rgba(200,149,90,0.12)' : warn ? 'rgba(255,107,107,0.08)' : 'transparent',
                }}
              >
                {/* 前方 active 标识：选中=实心强调点，未选中=暗点。 */}
                <span
                  style={{
                    flex: 'none',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: selected ? 'var(--gc-accent, #c8955a)' : 'rgba(255,255,255,0.2)',
                    boxShadow: selected ? '0 0 0 3px rgba(200,149,90,0.25)' : 'none',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? '#f6f1e9' : '#c9c0b2' }}>
                  {componentTypeLabel(child.component)}
                  <span style={{ opacity: 0.45, marginLeft: 6 }}>· {child.id}</span>
                </span>
                {warn && <span style={{ flex: 'none', color: '#ff6b6b', fontSize: 11 }} title="与另一交互组件热区重叠，运行时点击会互相遮挡">⚠</span>}
                {!locked && (
                  <button
                    style={rowDelBtn}
                    title="移除组件"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveChild(child.id)
                      if (selected) setSelectedChildId('')
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 右列：组件库（锁定态不显，改提示） ── */}
      {locked ? (
        <div style={{ minWidth: 150, width: 168, fontSize: 11, opacity: 0.5, lineHeight: 1.5 }}>
          基础组件方案锁定为单组件，不可增删；可在画布上调整其位置 / 尺寸。
        </div>
      ) : (
        <ComponentLibrary />
      )}
    </div>
  )
}
