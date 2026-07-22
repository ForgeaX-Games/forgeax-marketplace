/**
 * GraphConfigView —— 新引擎场景级配置中间页（界面 / 规则）。样式对齐旧配置 tab（CatalogShell：
 * 左栏分区列表 + 右栏预览）。与蓝图共用 graphScenario store；顶部工具条：保存 / 版本 / 重置。
 * 单分区（界面=全局HUD）左栏一行；多分区（规则=实体/变量/公式）左栏多行切换。
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import { CatalogShell } from './CatalogShell'
import { ScenarioInspector, type ScenarioSection } from './ScenarioInspector'
import { VersionPicker } from './VersionPicker'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import type { Formula } from '../persist/formula-authoring'

export interface ConfigTab {
  section: ScenarioSection
  label: string
}

export function GraphConfigView({ tabs, title = '配置', icon = '⚙', scenario }: { tabs: ConfigTab[]; title?: string; icon?: string; scenario: GameScenario }): JSX.Element {
  // 宿主 iframe 传 `?slug=`（见 gameScope.ts）；勿只读 `?game=`，否则会落到默认 demo 命名空间。
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const meta = useGraphScenario((s) => s.meta)
  const graph = useGraphScenario((s) => s.graph)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const savedTip = useGraphScenario((s) => s.savedTip)
  const setMeta = useGraphScenario((s) => s.setMeta)
  const doSave = useGraphScenario((s) => s.save)
  const reset = useGraphScenario((s) => s.reset)
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)

  useEffect(() => { ensureBoot(game, scenario) }, [game, scenario, ensureBoot])
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--work, #0e0c09)' }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--line-soft, #2e2924)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: 'var(--txt, #f6f1e9)' }}>
        <button onClick={() => doSave()}>💾 保存</button>
        <VersionPicker />
        <button onClick={() => { if (confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) reset() }}>↺ 重置</button>
        <span style={{ opacity: 0.6, fontSize: 11 }}>{savedTip}{isDraft ? ' · ⚠ 未保存草稿' : ''}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
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
      </div>
    </div>
  )
}
