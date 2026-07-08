import type { EntityStatEffect, OverlayClip, Scenario, Scene, Settlement } from './types'

/** 蓝图「计算」组只读展示的结算飘字摘要（SSOT = overlays[].settlement）。 */
export interface PerformanceSettlementView {
  id: string
  atMs: number
  label: string
  damage: number | null
  displayText: string
  xPct: number
  yPct: number
}

/** settlement 里 hp 变动的绝对值（无则 0）。 */
export function settlementDamageValue(settlement: Settlement | undefined): number {
  const effect = settlement?.effects.find(
    (e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp',
  )
  return Math.abs(Number(effect?.value ?? 0))
}

/** settlement 的 hp 变动作用于 player 还是 boss。 */
export function settlementTargetKind(
  settlement: Settlement | undefined,
  scenario: Scenario,
): 'boss' | 'player' {
  const effect = settlement?.effects.find(
    (e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp',
  )
  const entity = effect ? scenario.entities?.[effect.entityId] : undefined
  return entity?.kind === 'player' ? 'player' : 'boss'
}

function formatMs(ms: number): string {
  const sec = Math.max(0, ms) / 1000
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`
}

/** 带结算的 overlay（有 settlement），按 startMs 升序。 */
function settledOverlays(scene: Scene): OverlayClip[] {
  return (scene.overlays ?? [])
    .filter((o): o is OverlayClip & { settlement: Settlement } => o.settlement !== undefined)
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
}

/** 从 Scene 读取结算点列表（供蓝图只读预览 + blueprint 编译）。 */
export function listPerformanceSettlements(scene: Scene): PerformanceSettlementView[] {
  return settledOverlays(scene).map((ov) => {
    const settlement = ov.settlement!
    const float = settlement.float
    const damage = settlement.effects.some((e) => e.kind === 'entityStat' && e.stat === 'hp')
      ? settlementDamageValue(settlement)
      : null
    const displayText =
      ov.content.trim() ||
      float?.text ||
      (damage != null && damage > 0 ? `-${damage}` : ov.label ?? '')
    return {
      id: ov.id,
      atMs: ov.startMs,
      label: ov.label ?? (ov.content.trim() || '结算'),
      damage,
      displayText,
      xPct: Math.round((ov.x ?? 0.5) * 100),
      yPct: Math.round((ov.y ?? 0.42) * 100),
    }
  })
}

/** 计算节点的判定结果摘要 —— 取非 auto 分支标签（≥2 条时在蓝图展示）。 */
export function branchOutcomeLabels(scene: Scene): string[] {
  const labels = scene.branches
    .filter((b) => b.kind !== 'auto')
    .map((b) => b.label?.trim() || b.targetSceneId)
    .filter(Boolean)
  if (labels.length >= 2) return labels
  if (labels.length === 1 && scene.branches.length === 1) return []
  return labels
}

export function formatSettlementTime(atMs: number): string {
  return formatMs(atMs)
}
