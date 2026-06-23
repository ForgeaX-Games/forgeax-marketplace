import type { ModuleId, Scenario } from './types'

/**
 * moduleFlags —— 影游工坊「模块」中枢的单一事实来源。
 *
 * 设计原则 (2026-06 作者反馈「各模块要能独立开关，影响后续制作」):
 *   1. **旧数据零回归**: scenario.modules 缺省 / 某模块未显式写入 → 一律视为「启用」。
 *      只有作者在边栏把某模块显式关掉(写入 false)时，生产/运行时才会跳过它。
 *   2. **单一读取入口**: 所有「这个模块开了没」的判断都走 isModuleEnabled，
 *      生产链路读「生效后的配置」一律走 effectiveXxx，避免散落各处的 ?? 兜底语义漂移。
 *   3. **纯函数**: 只读 scenario，不碰 store / React，便于在生成线程与单测里直接用。
 */

/** isModuleEnabled 接受的最小剧本形状(modules + 内容字段，用于推断默认值)。 */
type ModuleScenarioLike = Pick<Scenario, 'modules'> &
  Partial<Pick<Scenario, 'variables' | 'items'>>

/**
 * 生产链路模块默认开 —— 旧剧本零回归。
 * 它们要么不注入内容(空配置无害)，要么本就是既有流程的一部分。
 */
const ALWAYS_ON_DEFAULT: ReadonlySet<ModuleId> = new Set<ModuleId>([
  'style',
  'director',
  'refs',
  'ui',
  'minigame',
])

/**
 * 模块「未显式设置时」的默认开关。
 *
 * - 生产链路模块(style/director/refs/ui/minigame): 默认开。
 * - 玩法内容模块(numeric/inventory): **按内容判定** ——
 *     · 作者已经搭过内容(有变量 / 有物品) → 默认开，避免「我做过的东西怎么是关的」；
 *     · 全新空剧本(无变量 / 无物品) → 默认关，必须作者主动 opt-in，
 *       否则边栏/面板显示成「已启用」却空空如也，造成「我没选它怎么就开了」的困惑。
 */
function moduleDefaultEnabled(
  scenario: ModuleScenarioLike | null | undefined,
  id: ModuleId,
): boolean {
  if (ALWAYS_ON_DEFAULT.has(id)) return true
  if (id === 'numeric') return Object.keys(scenario?.variables ?? {}).length > 0
  if (id === 'inventory') return Object.keys(scenario?.items ?? {}).length > 0
  return true
}

/** 某模块是否启用(未显式设置时取 moduleDefaultEnabled)。 */
export function isModuleEnabled(
  scenario: ModuleScenarioLike | null | undefined,
  id: ModuleId,
): boolean {
  const v = scenario?.modules?.[id]
  return v === undefined ? moduleDefaultEnabled(scenario, id) : v
}

/** 美术风格 —— 模块关掉时按「未设定」处理(生成不再注入风格前缀)。 */
export function effectiveVisualStyle(scenario: Scenario): Scenario['visualStyle'] {
  return isModuleEnabled(scenario, 'style') ? scenario.visualStyle : undefined
}

/** 导演流派 —— 模块关掉时返回 undefined(由调用方退回中性 / 不注入 persona)。 */
export function effectiveDirectorStyle(scenario: Scenario): Scenario['directorStyle'] {
  return isModuleEnabled(scenario, 'director') ? scenario.directorStyle : undefined
}

/** 自定义导演 persona —— 随导演模块开关。 */
export function effectiveDirectorCustomPersona(scenario: Scenario): string | undefined {
  return isModuleEnabled(scenario, 'director') ? scenario.directorCustomPersona : undefined
}

/** 界面风格 prompt —— 模块关掉时按空串处理(不注入 UI 风格)。 */
export function effectiveUiStylePrompt(scenario: Scenario): string {
  if (!isModuleEnabled(scenario, 'ui')) return ''
  return scenario.uiStyle?.prompt?.trim() ?? ''
}

/** 预选小游戏池 —— 模块关掉时按空池处理(剧情树剪辑不再提供小游戏)。 */
export function effectiveMinigameIds(scenario: Scenario): string[] {
  if (!isModuleEnabled(scenario, 'minigame')) return []
  return scenario.enabledMinigameIds ?? []
}
