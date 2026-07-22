/**
 * OverlaySchemeEditor —— 单个「界面方案」（overlay）的展示 + 编辑。
 * 右栏两列：左 = 画布（可拖拽定位/缩放）+ 组件参数列表；右 = 组件库（拖 chip 落地）。
 * 纯展示组件——所有增删改经回调交给持有 scenario.ui.overlays 的上层（GraphConfigView）。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { Entity, Layout, Overlay, Variable } from '../../runtime/schema/graph-schema'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { OverlayChildStyleEditor } from './OverlayChildStyleEditor'
import { ComponentLibrary } from './ComponentLibrary'

const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
/** 移除组件的 × 按钮——比默认删除文案更醒目、点击区更大。 */
const removeChildBtn: CSSProperties = {
  flex: 'none',
  marginTop: 2,
  color: '#ff6b6b',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1,
  padding: '2px 8px',
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
  onRename,
  onRemove,
  onAddChild,
  onRemoveChild,
  onPatchChild,
}: OverlaySchemeEditorProps): JSX.Element {
  const [selectedChildId, setSelectedChildId] = useState('')
  // 交互热区重叠冲突（DOM 实测，来自 preview 回调）——画布红框 + 参数列表标红提示。
  const [warnIds, setWarnIds] = useState<Set<string>>(() => new Set())

  // 画布选中组件后按 Backspace/Delete 删除当前组件；删除经 onRemoveChild→setMeta，天然进 zundo 撤销历史。
  // 输入框/下拉内不拦截（留给原生文本编辑）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (!selectedChildId) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      e.preventDefault()
      onRemoveChild(selectedChildId)
      setSelectedChildId('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedChildId, onRemoveChild])

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, overflow: 'auto', fontSize: 12, flex: 1, minWidth: 0 }}>
      {/* ── 左列：标题 + 画布 + 参数列表 ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <input
            value={overlay.title ?? ''}
            placeholder={overlayId}
            onChange={(e) => onRename(e.target.value)}
            style={{ flex: 1, fontWeight: 600 }}
          />
          <UsageBadge count={usageCount} />
          <button style={del} onClick={onRemove}>删除</button>
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 8 }}>{overlayId}</div>

        <OverlayCatalogPreview
          overlay={overlay}
          entities={entities}
          variables={variables}
          selectedChildId={selectedChildId}
          onSelectChild={setSelectedChildId}
          onAddChild={(presetId, layout) => {
            const id = onAddChild(presetId, layout)
            if (typeof id === 'string') setSelectedChildId(id)
          }}
          onPatchChildLayout={(childId, patch) => onPatchChild(childId, { layout: patch })}
          onWarnChange={setWarnIds}
        />

        <div style={{ marginTop: 10, borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>组件（{overlay.children.length}）</div>
          {warnIds.size > 0 && (
            <div style={{ fontSize: 11, color: '#ffd9d9', background: '#7a2020', border: '1px solid #ff6b6b', borderRadius: 4, padding: '4px 8px', marginBottom: 6 }}>
              ⚠ 有 {warnIds.size} 个交互组件热区重叠，运行时同一点击只会命中最上层、下层收不到。请错开位置，或右键画布「置顶/置底」调层级。
            </div>
          )}
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
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: `1px solid ${warn ? '#ff6b6b' : selected ? 'var(--gc-accent, #c8955a)' : 'transparent'}`,
                  background: warn ? 'rgba(255,107,107,0.08)' : selected ? 'rgba(200,149,90,0.08)' : 'transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <OverlayChildStyleEditor
                    child={child}
                    onPatchParams={(patch) => onPatchChild(child.id, { inputs: patch })}
                    onPatchComponent={(component) => onPatchChild(child.id, { component })}
                    onPatchLayout={(patch) => onPatchChild(child.id, { layout: patch })}
                  />
                </div>
                <button style={removeChildBtn} onClick={() => onRemoveChild(child.id)} title="移除组件">
                  ×
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 右列：组件库 ── */}
      <ComponentLibrary />
    </div>
  )
}
