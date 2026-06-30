import { useScenarioStore } from '../../scenario/scenarioStore'
import { isModuleEnabled } from '../../scenario/moduleFlags'
import { ModuleShell } from './ModuleShell'
import { NumericGraph } from './NumericGraph'

/**
 * NumericModule —— 「模块」中枢里的数值系统面板。
 *
 * 外壳 + 启用开关，内嵌专用紧凑节点图(全局变量 / 进入门槛 / 分支条件可视化编辑)。
 */
export function NumericModule() {
  const modules = useScenarioStore((s) => s.scenario.modules)
  const variables = useScenarioStore((s) => s.scenario.variables)
  const setModuleEnabled = useScenarioStore((s) => s.setModuleEnabled)
  const enabled = isModuleEnabled({ modules, variables }, 'numeric')

  return (
    <ModuleShell
      title="NUMERIC · 数值系统"
      subtitle="好感度 / 积分 / flag 等全局变量，驱动节点门槛、分支解锁与多结局分流。"
      enabled={enabled}
      onToggle={(next) => setModuleEnabled('numeric', next)}
    >
      <NumericGraph />
    </ModuleShell>
  )
}
