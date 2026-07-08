import { useScenarioStore } from '../../scenario/scenarioStore'
import { isModuleEnabled } from '../../scenario/moduleFlags'
import { ModuleShell } from './ModuleShell'
import { InventoryEditor } from './InventoryEditor'

/**
 * InventoryModule —— 「模块」中枢里的背包系统面板。
 *
 * 外壳 + 启用开关，内嵌物品编辑器（CRUD / 关联道具 / 生成透明图标抠图 / 场景热点放置）。
 */
export function InventoryModule() {
  const modules = useScenarioStore((s) => s.scenario.modules)
  const items = useScenarioStore((s) => s.scenario.items)
  const setModuleEnabled = useScenarioStore((s) => s.setModuleEnabled)
  const enabled = isModuleEnabled({ modules, items }, 'inventory')

  return (
    <ModuleShell
      title="INVENTORY · 背包系统"
      subtitle="在场景里搜寻拾取道具，用道具解锁节点、提升好感或触发结局。"
      enabled={enabled}
      onToggle={(next) => setModuleEnabled('inventory', next)}
    >
      <InventoryEditor />
    </ModuleShell>
  )
}
