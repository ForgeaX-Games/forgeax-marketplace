/**
 * GraphConfigView —— 新引擎场景级配置中间页（界面 / 规则）。样式对齐旧配置 tab（CatalogShell：
 * 左栏列表 + 右栏预览）。与蓝图共用 graphScenario store；顶部工具条：保存 / 版本 / 重置。
 *
 * 两种形态（同一套 CatalogShell 壳）：
 *  - **界面**（overlays）：左栏为**树**——「自定义覆盖物」组头（带「＋方案」）→ 各方案叶子；
 *    点叶子右栏只渲染**那一个方案**（OverlaySchemeEditor）。方案增删改在本组件持有并写回
 *    scenario.ui.overlays。
 *  - **规则**（实体/变量/公式）：左栏多行扁平切换，右栏渲染 ScenarioInspector。
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameScenario, Layout, Overlay, OverlayChild } from '../../runtime/schema/graph-schema'
import { CatalogShell, type CatalogItem } from './CatalogShell'
import { ScenarioInspector, type ScenarioSection } from './ScenarioInspector'
import { OverlaySchemeEditor, UsageBadge, DuplicateBadge } from './OverlaySchemeEditor'
import { VersionPicker } from './VersionPicker'
import { useGraphScenario, graphUndo, graphRedo } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import { NEW_COMPONENT_PRESETS, BASE_HUD_PREFIX, listCustomSchemeIds, listBaseHudIds } from '../demo/builtin-schemes'
import { findDuplicateOverlays } from './overlay-dedup'
import { defaultsForComponent } from './editors'
import type { Formula } from '../persist/formula-authoring'

export interface ConfigTab {
  section: ScenarioSection
  label: string
}

/** 自动分配与 Record key 对齐的 id（新增方案用；用户不可手填）。 */
function allocId(prefix: string, existing: Record<string, unknown>): string {
  let i = Object.keys(existing).length
  let id = `${prefix}${i}`
  while (existing[id]) {
    i += 1
    id = `${prefix}${i}`
  }
  return id
}

export function GraphConfigView({ tabs, title = '配置', icon = '⚙', scenario }: { tabs: ConfigTab[]; title?: string; icon?: string; scenario: GameScenario }): JSX.Element {
  // 宿主 iframe 传 `?slug=`（见 gameScope.ts）；勿只读 `?game=`，否则会落到默认 demo 命名空间。
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const meta = useGraphScenario((s) => s.meta)
  const graph = useGraphScenario((s) => s.graph)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const savedTip = useGraphScenario((s) => s.savedTip)
  const setMeta = useGraphScenario((s) => s.setMeta)
  const doCommit = useGraphScenario((s) => s.commit) // 保存 = 打版本
  const reset = useGraphScenario((s) => s.reset)
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)

  useEffect(() => { ensureBoot(game, scenario) }, [game, scenario, ensureBoot])

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
  const [active, setActive] = useState<ScenarioSection>(tabs[0]?.section ?? 'entities')
  // overlay 资源池「已用/未用」：统计每个 overlay 被多少节点挂载引用。
  const overlayUsage = useMemo(() => {
    const m: Record<string, number> = {}
    for (const n of graph.nodes) {
      for (const mount of n.data.overlayNodes ?? []) {
        m[mount.overlay] = (m[mount.overlay] ?? 0) + 1
      }
    }
    return m
  }, [graph.nodes])

  // ── 界面（overlays）形态：树 + 单方案编辑 ──
  const overlaysMode = tabs.length === 1 && tabs[0]?.section === 'overlays'
  const allOverlays = meta.ui?.overlays ?? {}
  // 内容重复标记：三类方案（自定义 / 内置 / 基础 base:*）在同一目录里互查，overlayId → 同内容的其它 id[]。
  // 只提示不处理（§8 人为最终权威）；纯派生，不落盘（§2 Derive）。
  const dupMap = useMemo(() => findDuplicateOverlays(allOverlays), [allOverlays])
  // 「自定义覆盖物」/「基础覆盖物」两组与蓝图侧选择器共用同一份派生（见 builtin-schemes），不各持一份漂移。
  const schemeIds = useMemo(() => listCustomSchemeIds(allOverlays), [allOverlays])
  const baseIds = useMemo(() => listBaseHudIds(allOverlays), [allOverlays])
  const [selectedOverlayId, setSelectedOverlayId] = useState('')
  // 选中项自愈：不在当前方案集（全局 + 基础）里（删除/首次）就落到第一个全局方案。
  const selectable = [...schemeIds, ...baseIds]
  const selOverlay = selectable.includes(selectedOverlayId) ? selectedOverlayId : (schemeIds[0] ?? baseIds[0] ?? '')
  // 基础覆盖物方案锁定：单组件，不允许增删组件（仅可编辑 layout）。
  const selLocked = selOverlay.startsWith(BASE_HUD_PREFIX)

  const setOverlays = (overlays: Record<string, Overlay>) => setMeta({ ...meta, ui: { ...meta.ui, overlays } })
  const addScheme = () => {
    const id = allocId('scheme-', allOverlays)
    setOverlays({ ...allOverlays, [id]: { id, title: '新方案', children: [] } })
    setSelectedOverlayId(id)
  }
  const renameScheme = (oid: string, title: string) => {
    const ov = allOverlays[oid]
    if (!ov) return
    setOverlays({ ...allOverlays, [oid]: { ...ov, title } })
  }
  const removeScheme = (oid: string) => {
    const { [oid]: _drop, ...rest } = allOverlays
    setOverlays(rest)
  }
  const addSchemeChild = (
    oid: string,
    componentId: string,
    place?: { inputs?: Record<string, unknown>; layout?: Partial<Layout> },
  ): string | undefined => {
    const ov = allOverlays[oid]
    if (!ov) return undefined
    const childId = `${componentId}-${Object.keys(ov.children).length}-${Date.now().toString(36)}`
    // 有精选 preset 用它（带更合适的默认 inputs/layout）；其余组件走通用 make（component + inputs 默认值）。
    const preset = NEW_COMPONENT_PRESETS.find((p) => p.id === componentId)
    const made: OverlayChild = preset
      ? preset.make(childId)
      // window 是显隐唯一 SSOT（运行时 el.window 存在即忽略 trigger）；不写 endMs = 到节点结束。
      : { id: childId, component: componentId, trigger: { when: 'enter' }, window: { startMs: 0 }, inputs: defaultsForComponent(componentId) }
    // 画布落点已按组件定位模式分好（inputs.x/y 或 layout.left/top）：各自浅合并进 preset 产物，
    // inputs 模式会覆盖 preset 自带的 x/y（如 floatText 的 0.5/0.4）为鼠标落点。
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
    setOverlays({ ...allOverlays, [oid]: { ...ov, children: ov.children.filter((c) => c.id !== childId) } })
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
                inputs: patch.inputs ? { ...c.inputs, ...patch.inputs } : c.inputs,
                layout: patch.layout ? { ...c.layout, ...patch.layout } : c.layout,
              },
        ),
      },
    })
  }

  const overlayTree: CatalogItem[] = [
    {
      id: '__overlays_group__',
      label: tabs[0]?.label ?? '自定义覆盖物',
      action: (
        <button type="button" className="gc-group-add" title="新建界面方案" onClick={addScheme}>
          ＋ 方案
        </button>
      ),
      children: schemeIds.map((id) => ({
        id,
        label: allOverlays[id]?.title || id,
        badge: (
          <>
            <DuplicateBadge others={dupMap.get(id) ?? []} compact />
            <UsageBadge count={overlayUsage[id] ?? 0} compact />
          </>
        ),
      })),
    },
    {
      id: '__base_hud_group__',
      label: '基础覆盖物',
      children: baseIds.map((id) => ({
        id,
        label: allOverlays[id]?.title || id.slice(BASE_HUD_PREFIX.length),
        badge: (
          <>
            <DuplicateBadge others={dupMap.get(id) ?? []} compact />
            <UsageBadge count={overlayUsage[id] ?? 0} compact />
          </>
        ),
      })),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--work, #0e0c09)' }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--line-soft, #2e2924)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: 'var(--txt, #f6f1e9)' }}>
        <VersionPicker />
        <button onClick={() => void doCommit()} title="保存当前内容并打一个新版本（vN）">💾 保存</button>
        <button onClick={() => { if (confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) reset() }}>↺ 重置</button>
        {isDraft ? (
          <span style={{ opacity: 0.85, fontSize: 12, color: '#ffc53d' }}>⚠ 未保存草稿</span>
        ) : null}
        {savedTip ? <span style={{ opacity: 0.6, fontSize: 11 }}>{savedTip}</span> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {overlaysMode ? (
          <CatalogShell
            icon={icon}
            title={title}
            items={overlayTree}
            selectedId={selOverlay}
            onSelect={setSelectedOverlayId}
            renderPreview={() => {
              const ov = allOverlays[selOverlay]
              if (!ov) {
                return (
                  <div style={{ flex: 1, padding: 18, opacity: 0.6, fontSize: 12 }}>
                    暂无界面方案。点左侧「＋ 方案」新建。
                  </div>
                )
              }
              return (
                <OverlaySchemeEditor
                  overlayId={selOverlay}
                  overlay={ov}
                  entities={meta.entities ?? {}}
                  variables={meta.variables ?? {}}
                  usageCount={overlayUsage[selOverlay] ?? 0}
                  locked={selLocked}
                  duplicateOf={dupMap.get(selOverlay) ?? []}
                  onRename={(t) => renameScheme(selOverlay, t)}
                  onRemove={() => removeScheme(selOverlay)}
                  onAddChild={(p, place) => addSchemeChild(selOverlay, p, place)}
                  onRemoveChild={(c) => removeSchemeChild(selOverlay, c)}
                  onPatchChild={(c, patch) => patchOverlayChild(selOverlay, c, patch)}
                />
              )
            }}
          />
        ) : (
          <CatalogShell
            icon={icon}
            title={title}
            items={tabs.map((t) => ({ id: t.section, label: t.label }))}
            selectedId={active}
            onSelect={(id) => setActive(id as ScenarioSection)}
            renderPreview={() => (
              <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
                {/* meta.formulas 在 schema 里存为 `Record<string, unknown>`（runtime ↛ editor）；这里窄化回 Formula 给 ScenarioInspector。 */}
                <ScenarioInspector
                  value={{ ...meta, formulas: meta.formulas as Record<string, Formula> | undefined }}
                  section={active}
                  overlayUsage={overlayUsage}
                  onChange={setMeta}
                />
              </div>
            )}
          />
        )}
      </div>
    </div>
  )
}
