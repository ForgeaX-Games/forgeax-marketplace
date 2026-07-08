/**
 * GraphConfigView —— 新引擎场景级配置中间页（界面 / 规则）。样式对齐旧配置 tab（CatalogShell：
 * 左栏分区列表 + 右栏预览）。与蓝图共用 graphScenario store；顶部工具条：保存 / 版本 / 重置。
 * 单分区（界面=全局HUD）左栏一行；多分区（规则=实体/变量/场景设置/反应规则）左栏多行切换。
 */
import { useEffect, useMemo, useState } from 'react'
import type { GameScenario } from '../graph-schema'
import { CatalogShell } from '../../../forge/CatalogTabs'
import { ScenarioInspector, type ScenarioSection } from './ScenarioInspector'
import { VersionPicker } from './VersionPicker'
import { useGraphScenario } from '../graphScenarioStore'

export interface ConfigTab {
  section: ScenarioSection
  label: string
}

export function GraphConfigView({ tabs, title = '配置', icon = '⚙', scenario }: { tabs: ConfigTab[]; title?: string; icon?: string; scenario: GameScenario }): JSX.Element {
  const game = useMemo(() => new URLSearchParams(location.search).get('game') ?? 'game-nodia-fighting', [])
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
  const nodeIds = graph.nodes.map((n) => n.id)

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
              <ScenarioInspector value={meta} nodeIds={nodeIds} section={active} onChange={setMeta} />
            </div>
          )}
        />
      </div>
    </div>
  )
}
