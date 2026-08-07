/**
 * GraphConfigView —— 新引擎场景级配置中间页（界面 / 规则）。
 * 与蓝图共用 graphScenario store。规则页保留顶部版本/保存条；界面画布不再显示该条。
 *
 * 两种形态：
 *  - **界面**（overlays）：目录只在应用左栏，主区直接渲染单个 OverlaySchemeEditor；
 *    选中态来自 uiSelection，方案内容仍写回 scenario.ui.overlays。
 *  - **规则**（实体/变量/公式）：左栏多行扁平切换，右栏渲染 ScenarioInspector。
 */
import { useEffect, useMemo } from 'react'
import type { GameScenario, Layout, Overlay, OverlayChild, UiTreeNode } from '../../runtime/schema/graph-schema'
import { CatalogShell } from './CatalogShell'
import { ScenarioInspector, type ScenarioSection } from './ScenarioInspector'
import { OverlaySchemeEditor } from './OverlaySchemeEditor'
import { VersionPicker } from './VersionPicker'
import { useGraphScenario, graphUndo, graphRedo } from '../persist/graphScenarioStore'
import {
  NEW_COMPONENT_PRESETS,
  BASE_HUD_PREFIX,
  listInterfaceCustomSchemeIds,
  listBaseHudIds,
} from '../demo/builtin-schemes'
import { findDuplicateOverlays } from './overlay-dedup'
import type { Formula } from '../persist/formula-authoring'
import { countOverlayReferences } from '../../graph/edit/overlay-edit'
import {
  ensureEntity,
  ensureEntityAttribute,
  ensureFormula,
  ensureVariable,
  type EntityAttributeCreateRequest,
  type EntityCreateRequest,
  type FormulaCreateRequest,
  type VariableCreateRequest,
} from './metaCatalog'
import type { ScenarioIdRename } from '../persist/scenario-id'
import { collectItemIds } from './itemCatalog'
import { overlayTitleExists } from './overlay-title'
import { ensureUiTree } from '../persist/ui-tree'
import { useUiSelection } from '../persist/uiSelectionStore'
import { executeUiNavCommand } from '../persist/uiNavSync'
import { useRuleSelection } from '../persist/ruleSelectionStore'

export interface ConfigTab {
  section: ScenarioSection
  label: string
}

function findSchemeNodeId(nodes: readonly UiTreeNode[], overlayId: string): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'scheme' && node.overlayId === overlayId) return node.id
    if (node.kind === 'folder') {
      const found = findSchemeNodeId(node.children, overlayId)
      if (found) return found
    }
  }
  return undefined
}

export function GraphConfigView({ tabs, title = '配置', icon = '⚙', scenario: _scenario }: { tabs: ConfigTab[]; title?: string; icon?: string; scenario: GameScenario }): JSX.Element {
  const meta = useGraphScenario((s) => s.meta)
  const blueprints = useGraphScenario((s) => s.blueprints)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const savedTip = useGraphScenario((s) => s.savedTip)
  const setMeta = useGraphScenario((s) => s.setMeta)
  const renameScenarioId = useGraphScenario((s) => s.renameScenarioId)
  const doCommit = useGraphScenario((s) => s.commit) // 保存 = 打版本
  const reset = useGraphScenario((s) => s.reset)

  // 键盘撤销/重做：Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 或 Ctrl+Y 重做；输入框内不拦截（留给原生文本撤销）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); graphUndo() }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); graphRedo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const overlaysMode = tabs.length === 1 && tabs[0]?.section === 'overlays'
  const activeRuleSection = useRuleSelection((state) => state.section)
  const activeRuleItemId = useRuleSelection((state) => state.itemId)
  const selectRule = useRuleSelection((state) => state.select)
  const active = overlaysMode
    ? (tabs[0]?.section ?? 'entities')
    : (tabs.some((tab) => tab.section === activeRuleSection) ? activeRuleSection : tabs[0]?.section ?? 'entities')
  // overlay 资源池「已用/未用」：统计每个 overlay 被多少节点挂载引用。
  const overlayUsage = useMemo(
    () => countOverlayReferences(Object.values(blueprints).map((doc) => doc.graph)),
    [blueprints],
  )
  const itemIds = useMemo(
    () => collectItemIds(meta.ui?.overlays, Object.values(blueprints).map((doc) => doc.graph)),
    [blueprints, meta.ui?.overlays],
  )

  // ── 界面（overlays）形态：树 + 单方案编辑 ──
  const allOverlays = meta.ui?.overlays ?? {}
  // 内容重复标记：三类方案（自定义 / 内置 / 基础 base:*）在同一目录里互查，overlayId → 同内容的其它 id[]。
  // 只提示不处理（§8 人为最终权威）；纯派生，不落盘（§2 Derive）。
  const dupMap = useMemo(() => findDuplicateOverlays(allOverlays), [allOverlays])
  // 界面 tab 保持新建方案置顶；其它方案选择器继续沿用通用排序。
  const schemeIds = useMemo(() => listInterfaceCustomSchemeIds(allOverlays), [allOverlays])
  const baseIds = useMemo(() => listBaseHudIds(allOverlays), [allOverlays])
  const selectedOverlayId = useUiSelection((state) => state.selectedOverlayId)
  const selectUiNode = useUiSelection((state) => state.selectUiNode)
  // 选中项自愈：不在当前方案集（全局 + 基础）里（删除/首次）就落到第一个全局方案。
  const selectable = [...schemeIds, ...baseIds]
  const selOverlay = selectedOverlayId && selectable.includes(selectedOverlayId)
    ? selectedOverlayId
    : (schemeIds[0] ?? baseIds[0] ?? '')
  const uiTree = ensureUiTree(meta.uiTree, allOverlays)
  useEffect(() => {
    if (!overlaysMode) return
    if (!selOverlay) {
      if (selectedOverlayId !== null) selectUiNode(null, null)
      return
    }
    if (selectedOverlayId === selOverlay) return
    selectUiNode(findSchemeNodeId(uiTree.root, selOverlay) ?? null, selOverlay)
  }, [overlaysMode, selOverlay, selectUiNode, selectedOverlayId, uiTree])
  // 基础覆盖物方案只锁结构：单组件不可增删；inputs/layout 可编辑。
  const selLocked = selOverlay.startsWith(BASE_HUD_PREFIX)

  const setOverlays = (overlays: Record<string, Overlay>) => {
    setMeta((current) => ({ ...current, ui: { ...current.ui, overlays } }))
  }
  const createEntityAttribute = (request: EntityAttributeCreateRequest) => {
    setMeta((current) => {
      const entities = ensureEntityAttribute(current.entities, request)
      return entities && entities !== current.entities ? { ...current, entities } : current
    })
  }
  const createEntity = (request: EntityCreateRequest) => {
    setMeta((current) => {
      const entities = ensureEntity(current.entities, request)
      return entities !== current.entities ? { ...current, entities } : current
    })
  }
  const createVariable = (request: VariableCreateRequest) => {
    setMeta((current) => {
      const variables = ensureVariable(current.variables, request)
      return variables !== current.variables ? { ...current, variables } : current
    })
  }
  const createFormula = (request: FormulaCreateRequest) => {
    setMeta((current) => {
      const currentFormulas = current.formulas as Record<string, Formula> | undefined
      const formulas = ensureFormula(currentFormulas, request)
      return formulas !== currentFormulas ? { ...current, formulas } : current
    })
  }
  const renameScheme = (oid: string, title: string) => {
    if (!allOverlays[oid]) return
    if (overlayTitleExists(allOverlays, title, oid)) {
      window.alert(`界面方案名称「${title.trim()}」已存在`)
      return
    }
    const nodeId = findSchemeNodeId(uiTree.root, oid)
    if (nodeId) executeUiNavCommand({ type: 'rename', nodeId, name: title })
  }
  const removeScheme = (oid: string) => {
    const nodeId = findSchemeNodeId(uiTree.root, oid)
    if (nodeId) executeUiNavCommand({ type: 'remove', nodeId })
  }
  const addSchemeChild = (
    oid: string,
    componentId: string,
    place?: { inputs?: Record<string, unknown>; layout?: Partial<Layout> },
  ): string | undefined => {
    const ov = allOverlays[oid]
    if (!ov) return undefined
    const childId = `${componentId}-${Object.keys(ov.children).length}-${Date.now().toString(36)}`
    // 默认参数不写进 inputs；两个参数面板统一从 manifest.default 读取 placeholder。
    const preset = NEW_COMPONENT_PRESETS.find((p) => p.id === componentId)
    const made: OverlayChild = preset
      ? preset.make(childId)
      : {
          id: childId,
          component: componentId,
          trigger: { when: 'enter' },
          window: { startMs: 0 },
          inputs: {},
        }
    // 新规格画布落点只写 layout；inputs 仅合并组件业务参数。
    const child: OverlayChild = place
      ? {
          ...made,
          inputs: place.inputs ? { ...made.inputs, ...place.inputs } : made.inputs,
          layout: place.layout ? { ...made.layout, ...place.layout } : made.layout,
        }
      : made
    setOverlays({ ...allOverlays, [oid]: { ...ov, children: [...ov.children, child] } })
    return childId
  }
  const removeSchemeChild = (oid: string, childId: string) => {
    const ov = allOverlays[oid]
    if (!ov) return
    const reactions = ov.reactions?.filter((reaction) => !reaction.when.id.startsWith(`${childId}:`))
    setOverlays({
      ...allOverlays,
      [oid]: {
        ...ov,
        children: ov.children.filter((c) => c.id !== childId),
        reactions: reactions?.length ? reactions : undefined,
      },
    })
  }
  const patchOverlayChild = (
    oid: string,
    childId: string,
    patch: { inputs?: Record<string, unknown>; component?: string; layout?: Partial<Layout> },
  ) => {
    const ov = allOverlays[oid]
    if (!ov) return
    setOverlays({
      ...allOverlays,
      [oid]: {
        ...ov,
        children: ov.children.map((c) =>
          c.id !== childId
            ? c
            : {
                ...c,
                ...(patch.component != null ? { component: patch.component } : {}),
                // 参数表传入的是下一份完整 inputs；不可浅合并，否则被删除的 key 会被旧值补回来。
                inputs: patch.inputs ?? c.inputs,
                layout: patch.layout ? { ...c.layout, ...patch.layout } : c.layout,
              },
        ),
      },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--work, #0e0c09)' }}>
      {!overlaysMode ? (
        <div style={{ padding: 8, borderBottom: '1px solid var(--line-soft, #2e2924)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: 'var(--txt, #f6f1e9)' }}>
          <VersionPicker />
          <button onClick={() => void doCommit()} title="保存当前内容并打一个新版本（vN）">💾 保存</button>
          <button onClick={() => { if (confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) reset() }}>↺ 重置</button>
          {isDraft ? (
            <span style={{ opacity: 0.85, fontSize: 12, color: '#ffc53d' }}>⚠ 未保存草稿</span>
          ) : null}
          {savedTip ? <span style={{ opacity: 0.6, fontSize: 11 }}>{savedTip}</span> : null}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {overlaysMode ? (
          (() => {
            const ov = allOverlays[selOverlay]
            if (!ov) {
              return (
                <div style={{ flex: 1, padding: 18, opacity: 0.6, fontSize: 12 }}>
                  暂无界面方案，请从左侧新建。
                </div>
              )
            }
            return (
              <OverlaySchemeEditor
                overlayId={selOverlay}
                overlay={ov}
                overlays={allOverlays}
                entities={meta.entities ?? {}}
                variables={meta.variables ?? {}}
                formulas={meta.formulas as Record<string, Formula> | undefined}
                itemIds={itemIds}
                usageCount={overlayUsage[selOverlay] ?? 0}
                locked={selLocked}
                duplicateOf={dupMap.get(selOverlay) ?? []}
                onRename={(t) => renameScheme(selOverlay, t)}
                onRemove={() => removeScheme(selOverlay)}
                onAddChild={(p, place) => addSchemeChild(selOverlay, p, place)}
                onRemoveChild={(c) => removeSchemeChild(selOverlay, c)}
                onPatchChild={(c, patch) => patchOverlayChild(selOverlay, c, patch)}
                onReactionsChange={(reactions) =>
                  setOverlays({ ...allOverlays, [selOverlay]: { ...ov, reactions } })}
                onCreateEntityAttribute={createEntityAttribute}
                onCreateEntity={createEntity}
                onCreateVariable={createVariable}
                onCreateFormula={createFormula}
              />
            )
          })()
        ) : (
          <CatalogShell
            icon={icon}
            title={title}
            items={tabs.map((t) => ({ id: t.section, label: t.label }))}
            selectedId={active}
            onSelect={(id) => selectRule(id as typeof activeRuleSection)}
            renderPreview={() => (
              <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                {/* meta.formulas 在 schema 里存为 `Record<string, unknown>`（runtime ↛ editor）；这里窄化回 Formula 给 ScenarioInspector。 */}
                <ScenarioInspector
                  value={{ ...meta, formulas: meta.formulas as Record<string, Formula> | undefined }}
                  section={active}
                  focusItemId={activeRuleItemId}
                  overlayUsage={overlayUsage}
                  onChange={setMeta}
                  onRenameId={(rename: ScenarioIdRename) => renameScenarioId(rename)}
                />
              </div>
            )}
          />
        )}
      </div>
    </div>
  )
}
